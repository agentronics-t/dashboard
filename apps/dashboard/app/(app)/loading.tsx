// Shown the moment you click a sidebar item, while the next page's data loads.
// It also lets Next prefetch every console route, so navigation feels instant
// instead of waiting for the server to finish rendering.
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="ag-skel" style={{ width: 220, height: 30, marginBottom: 12 }} />
      <div className="ag-skel" style={{ width: "min(520px, 80%)", height: 15, marginBottom: 26 }} />
      <div className="ag-grid-kpi">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="ag-skel" style={{ height: 104, borderRadius: "var(--radius-xl)" }} />
        ))}
      </div>
      <div className="ag-skel" style={{ height: 280, borderRadius: "var(--radius-xl)" }} />
    </div>
  );
}
