"""Forecasting: cloud retrain on every run, swappable behind `Forecaster`.

Primary: Holt-Winters ETS (additive trend + 7-day additive seasonality) —
daily agent-traffic counts are short weekly-seasonal series, which ETS models
well and retrains in milliseconds (the contract retrains every pipeline run).
Fallback: seasonal-naive when history is too short to fit ETS.

p10/p50/p90 from empirical in-sample residual quantiles, clipped at zero.
Backtest: MAPE of p50 over a held-out final week when history allows.
"""

from __future__ import annotations

import pickle
from dataclasses import dataclass
from typing import Protocol

import numpy as np
import pandas as pd

HORIZON_DAYS = 14
MIN_ETS_DAYS = 14
BACKTEST_HOLDOUT_DAYS = 7


@dataclass
class ForecastResult:
    """forecast: DataFrame[date, p10, p50, p90] for HORIZON_DAYS ahead."""

    forecast: pd.DataFrame
    model_version: str
    artifact: bytes
    metadata: dict


class Forecaster(Protocol):
    def fit_predict(self, series: pd.Series) -> ForecastResult: ...


def _to_daily(series: pd.Series) -> pd.Series:
    """Reindex to a contiguous daily series (missing days = 0 traffic)."""
    s = series.copy()
    s.index = pd.to_datetime(s.index)
    s = s.sort_index()
    full = pd.date_range(s.index.min(), s.index.max(), freq="D")
    return s.reindex(full, fill_value=0).astype(float)


def _quantile_bands(p50: np.ndarray, residuals: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    q10 = np.quantile(residuals, 0.10) if len(residuals) else 0.0
    q90 = np.quantile(residuals, 0.90) if len(residuals) else 0.0
    return np.clip(p50 + q10, 0, None), np.clip(p50 + q90, 0, None)


def _result_frame(last_date: pd.Timestamp, p50: np.ndarray, residuals: np.ndarray) -> pd.DataFrame:
    p50 = np.clip(p50, 0, None)
    p10, p90 = _quantile_bands(p50, residuals)
    dates = pd.date_range(last_date + pd.Timedelta(days=1), periods=len(p50), freq="D")
    return pd.DataFrame(
        {
            "date": dates.strftime("%Y-%m-%d"),
            "p10": np.minimum(p10, p50),
            "p50": p50,
            "p90": np.maximum(p90, p50),
        }
    )


def _mape(actual: np.ndarray, predicted: np.ndarray) -> float | None:
    mask = actual != 0
    if not mask.any():
        return None
    return float(np.mean(np.abs((actual[mask] - predicted[mask]) / actual[mask])))


class EtsForecaster:
    """Holt-Winters; additive trend + weekly additive seasonality."""

    model_version = "ets-hw-v1"

    def _fit(self, s: pd.Series):
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        seasonal = "add" if len(s) >= 2 * 7 else None
        model = ExponentialSmoothing(
            s,
            trend="add",
            seasonal=seasonal,
            seasonal_periods=7 if seasonal else None,
            initialization_method="estimated",
        )
        return model.fit(optimized=True)

    def fit_predict(self, series: pd.Series) -> ForecastResult:
        s = _to_daily(series)

        # Backtest on a held-out final week when there is enough history.
        mape = None
        if len(s) >= MIN_ETS_DAYS + BACKTEST_HOLDOUT_DAYS:
            train, holdout = s[:-BACKTEST_HOLDOUT_DAYS], s[-BACKTEST_HOLDOUT_DAYS:]
            try:
                bt = self._fit(train).forecast(BACKTEST_HOLDOUT_DAYS)
                mape = _mape(holdout.to_numpy(), np.clip(bt.to_numpy(), 0, None))
            except Exception:  # noqa: BLE001 — backtest is advisory only
                mape = None

        fitted = self._fit(s)
        p50 = fitted.forecast(HORIZON_DAYS).to_numpy()
        residuals = (s - fitted.fittedvalues).to_numpy()

        return ForecastResult(
            forecast=_result_frame(s.index[-1], p50, residuals),
            model_version=self.model_version,
            artifact=pickle.dumps(fitted.params),
            metadata={
                "model_version": self.model_version,
                "train_start": s.index[0].strftime("%Y-%m-%d"),
                "train_end": s.index[-1].strftime("%Y-%m-%d"),
                "train_days": int(len(s)),
                "horizon_days": HORIZON_DAYS,
                "backtest_mape": mape,
            },
        )


class SeasonalNaiveForecaster:
    """p50 = value one week earlier (or last value); bands from history spread."""

    model_version = "snaive-v1"

    def fit_predict(self, series: pd.Series) -> ForecastResult:
        s = _to_daily(series)
        values = s.to_numpy()
        p50 = np.array(
            [
                values[-7 + (h % 7)] if len(values) >= 7 else values[-1]
                for h in range(HORIZON_DAYS)
            ],
            dtype=float,
        )
        residuals = values - values.mean() if len(values) > 1 else np.zeros(1)

        return ForecastResult(
            forecast=_result_frame(s.index[-1], p50, residuals),
            model_version=self.model_version,
            artifact=pickle.dumps({"last_week": values[-7:].tolist()}),
            metadata={
                "model_version": self.model_version,
                "train_start": s.index[0].strftime("%Y-%m-%d"),
                "train_end": s.index[-1].strftime("%Y-%m-%d"),
                "train_days": int(len(s)),
                "horizon_days": HORIZON_DAYS,
                "backtest_mape": None,
            },
        )


def select_forecaster(series: pd.Series) -> Forecaster:
    """ETS when there is enough history to fit it; seasonal-naive otherwise."""
    if len(_to_daily(series)) >= MIN_ETS_DAYS:
        return EtsForecaster()
    return SeasonalNaiveForecaster()
