"use client";

import { useEffect, useState } from "react";

export function ThemeSetting() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const set = (next: boolean) => {
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ag-theme", next ? "dark" : "light");
    } catch {}
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <div>
        <div style={{ fontWeight: 500 }}>Theme</div>
        <div style={{ fontSize: 13, color: "var(--content-muted)" }}>Light or dark — applies instantly.</div>
      </div>
      <div style={{ display: "inline-flex", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
        {[
          { label: "Light", val: false },
          { label: "Dark", val: true }
        ].map((o) => (
          <button
            key={o.label}
            onClick={() => set(o.val)}
            style={{
              padding: "8px 16px",
              border: "none",
              background: dark === o.val ? "var(--brand-solid)" : "transparent",
              color: dark === o.val ? "#fff" : "var(--content-secondary)",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer"
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
