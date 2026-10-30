"use client";

import { Children, useState, type ReactNode } from "react";

/** Shows the first `step` children, then `step` more per click. */
export function ShowMore({ children, step = 20 }: { children: ReactNode; step?: number }) {
  const items = Children.toArray(children);
  const [shown, setShown] = useState(step);
  return (
    <>
      {items.slice(0, shown)}
      {items.length > shown && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, paddingTop: 12 }}>
          <button type="button" className="ag-btn ag-btn-sm" onClick={() => setShown((n) => n + step)}>
            Show {Math.min(step, items.length - shown)} more ↓
          </button>
          <span className="ag-muted" style={{ fontSize: 12.5 }}>
            {shown} of {items.length}
          </span>
        </div>
      )}
    </>
  );
}
