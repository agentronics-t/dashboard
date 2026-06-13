"""Forecaster tests on synthetic series, including the printed backtest."""

import numpy as np
import pandas as pd
from intel_ml.forecast import (
    HORIZON_DAYS,
    EtsForecaster,
    SeasonalNaiveForecaster,
    select_forecaster,
)


def synthetic_series(days: int, seed: int = 7) -> pd.Series:
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2026-03-01", periods=days, freq="D")
    weekly = 100 + 40 * np.sin(2 * np.pi * np.arange(days) / 7)
    trend = np.linspace(0, 30, days)
    noise = rng.normal(0, 8, days)
    return pd.Series(np.clip(weekly + trend + noise, 0, None), index=dates.strftime("%Y-%m-%d"))


def test_ets_forecast_shape_and_quantiles():
    result = EtsForecaster().fit_predict(synthetic_series(60))
    f = result.forecast
    assert len(f) == HORIZON_DAYS
    assert list(f.columns) == ["date", "p10", "p50", "p90"]
    assert (f["p10"] <= f["p50"]).all() and (f["p50"] <= f["p90"]).all()
    assert (f["p10"] >= 0).all()
    assert f["date"].iloc[0] > synthetic_series(60).index[-1]


def test_ets_backtest_mape_reported_and_reasonable():
    result = EtsForecaster().fit_predict(synthetic_series(90))
    mape = result.metadata["backtest_mape"]
    assert mape is not None
    print(f"\nBACKTEST REPORT: ets-hw-v1 held-out 7d MAPE = {mape:.3f}")
    # weekly-seasonal synthetic data: ETS should track well
    assert mape < 0.30


def test_ets_artifact_and_metadata():
    result = EtsForecaster().fit_predict(synthetic_series(40))
    assert result.model_version == "ets-hw-v1"
    assert len(result.artifact) > 0
    assert result.metadata["train_days"] == 40
    assert result.metadata["horizon_days"] == HORIZON_DAYS


def test_seasonal_naive_for_short_series():
    series = synthetic_series(8)
    assert isinstance(select_forecaster(series), SeasonalNaiveForecaster)
    result = SeasonalNaiveForecaster().fit_predict(series)
    assert len(result.forecast) == HORIZON_DAYS
    assert (result.forecast["p10"] <= result.forecast["p90"]).all()


def test_selector_prefers_ets_with_history():
    assert isinstance(select_forecaster(synthetic_series(30)), EtsForecaster)


def test_deterministic():
    a = EtsForecaster().fit_predict(synthetic_series(45)).forecast
    b = EtsForecaster().fit_predict(synthetic_series(45)).forecast
    pd.testing.assert_frame_equal(a, b)


def test_gap_filling():
    series = synthetic_series(30)
    gappy = series.drop(series.index[10:13])  # 3 missing days -> zeros
    result = EtsForecaster().fit_predict(gappy)
    assert result.metadata["train_days"] == 30
