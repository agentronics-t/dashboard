// The Agent Nic pipeline drawn from the run's event log: six steps, each a box
// with its name, coloured by state. The run log underneath has the details.
import type { Run, RunEvent } from "@/lib/agentNick";

type State = "pending" | "running" | "waiting" | "done" | "failed";

/** What the customer sees: six steps, each covering one or more of the service's steps. */
export const STEPS: { id: string; label: string; parts: string[] }[] = [
  { id: "read", label: "Read your code", parts: ["read", "framework", "pages", "actions"] },
  { id: "plan", label: "Plan the fixes", parts: ["site", "propose"] },
  { id: "review", label: "Your review", parts: ["review"] },
  { id: "write", label: "Write the code", parts: ["write", "validate"] },
  { id: "pr", label: "Pull request", parts: ["pr", "ci"] },
  { id: "live", label: "Live", parts: ["live"] }
];

const KIND_STATE: Record<string, State> = { start: "running", done: "done", fail: "failed", wait: "waiting" };
const GLYPH: Record<State, string> = { pending: "", running: "•", waiting: "!", done: "✓", failed: "✕" };

/** The state of each of the service's steps (read, framework, … ci, live). */
export function stepStates(run: Run, events: RunEvent[]): Record<string, { state: State; detail: string | null }> {
  const out: Record<string, { state: State; detail: string | null }> = {};
  for (const e of events) {
    const prev = out[e.step];
    const state = KIND_STATE[e.kind] ?? prev?.state ?? "running";
    out[e.step] = { state, detail: e.message };
  }
  // CI and live are driven by webhooks; reflect the run's own fields too.
  if (run.status === "pr_open" && !out.ci) out.ci = { state: "waiting", detail: "Waiting for your CI checks" };
  if (run.ciStatus === "success") out.ci = { state: "done", detail: out.ci?.detail ?? "Checks passed" };
  if (run.ciStatus === "failure" && run.status === "pr_open") out.ci = { state: "failed", detail: out.ci?.detail ?? "A check failed" };
  if (run.ciStatus === "none" && run.status === "pr_open") out.ci = { state: "done", detail: "No CI checks on this repo" };
  if (run.status === "pr_open") out.live = { state: "waiting", detail: "Accept the pull request to go live" };
  if (run.status === "merged") out.live = { state: "done", detail: out.live?.detail ?? "Merged" };
  if (run.status === "ready") out.ci = { state: "pending", detail: "Dry run — nothing pushed" };
  // A step that "started" but the run has moved on (or ended) is no longer running.
  const finished = ["failed", "cancelled", "closed"].includes(run.status);
  for (const [id, cur] of Object.entries(out)) {
    if (cur.state === "running" && (finished || id !== run.step)) out[id] = { ...cur, state: finished ? "failed" : "done" };
  }
  return out;
}

/** One shown step's state from its parts: failed > waiting > running > done (all parts) > pending. */
function groupState(parts: (State | undefined)[]): State {
  if (parts.includes("failed")) return "failed";
  if (parts.includes("waiting")) return "waiting";
  if (parts.includes("running")) return "running";
  if (parts.length && parts.every((p) => p === "done")) return "done";
  return parts.some((p) => p === "done") ? "running" : "pending";
}

export function Pipeline({ run, events }: { run: Run; events: RunEvent[] }) {
  const states = stepStates(run, events);
  return (
    <ol className="ag-flow ag-flow--compact" aria-label="Agent Nic pipeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {STEPS.map((s, i) => {
        // The CI part only exists once a PR is open; don't let its absence hold "Pull request" back.
        const parts = s.parts.filter((p) => p !== "ci" || states.ci).map((p) => states[p]?.state);
        const state = groupState(parts);
        return (
          <li key={s.id} className="ag-node" data-state={state} aria-current={state === "running" || state === "waiting" ? "step" : undefined}>
            <div className="ag-node-head">
              <span className="ag-dot" aria-hidden>
                {GLYPH[state] || i + 1}
              </span>
              <div className="ag-node-label">{s.label}</div>
            </div>
            {s.id === "live" && run.status === "pr_open" && run.prUrl && (
              // Opens the PR at GitHub's merge box; merging there is what makes it live.
              <a className="ag-btn ag-btn-sm ag-btn-primary" href={`${run.prUrl}#partial-pull-merging`} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
                Merge on GitHub ↗
              </a>
            )}
            <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              {state}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const KIND_LABEL: Record<string, string> = { start: "started", done: "done", fail: "failed", wait: "waiting", info: "note" };

export function RunLog({ events }: { events: RunEvent[] }) {
  if (!events.length) return <p className="ag-muted" style={{ margin: 0 }}>Starting…</p>;
  return (
    <ul className="ag-log">
      {[...events].reverse().map((e) => (
        <li key={e.id}>
          <span className="ag-muted">{new Date(e.createdAt).toLocaleTimeString("en-US", { hour12: false })}</span>
          <span style={{ color: e.kind === "fail" ? "var(--danger)" : e.kind === "done" ? "var(--success)" : e.kind === "wait" ? "var(--warning)" : "var(--content-secondary)" }}>
            {e.step} · {KIND_LABEL[e.kind] ?? e.kind}
          </span>
          <span style={{ fontFamily: "var(--font-sans)", overflowWrap: "anywhere" }}>{e.message}</span>
        </li>
      ))}
    </ul>
  );
}

const STATUS_KIND: Record<string, string> = {
  queued: "queued",
  running: "running",
  awaiting_review: "warning",
  pr_open: "info",
  merged: "succeeded",
  live: "succeeded",
  ready: "info",
  failed: "failed",
  closed: "queued",
  cancelled: "queued",
  new: "queued"
};
const STATUS_LABEL: Record<string, string> = {
  awaiting_review: "needs review",
  pr_open: "PR open",
  merged: "live",
  ready: "dry run",
  new: "not started"
};

export function statusBadgeProps(status: string) {
  return { kind: STATUS_KIND[status] ?? "queued", label: STATUS_LABEL[status] ?? status.replace(/_/g, " ") };
}
