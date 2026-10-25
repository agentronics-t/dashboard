// The Agent Nic pipeline drawn from the run's event log: one node per step,
// coloured by state, with the step's latest message underneath.
import type { Run, RunEvent } from "@/lib/agentNick";

type State = "pending" | "running" | "waiting" | "done" | "failed";

export const STEPS: { id: string; label: string; who: string }[] = [
  { id: "connect", label: "Connect repo", who: "You" },
  { id: "read", label: "Read the code", who: "GitHub API · no clone" },
  { id: "framework", label: "Framework", who: "Code" },
  { id: "pages", label: "Find pages", who: "Code" },
  { id: "actions", label: "Find actions", who: "Code" },
  { id: "site", label: "Site files", who: "Code + Gemini" },
  { id: "propose", label: "Propose tools", who: "Gemini 3.8 Flash" },
  { id: "review", label: "Your review", who: "You · tools, access, plan" },
  { id: "write", label: "Write code", who: "Templates + Gemini" },
  { id: "validate", label: "Validate", who: "Code" },
  { id: "pr", label: "Pull request", who: "GitHub" },
  { id: "ci", label: "CI checks", who: "Your CI" },
  { id: "live", label: "Live", who: "You merge" }
];

const KIND_STATE: Record<string, State> = { start: "running", done: "done", fail: "failed", wait: "waiting" };
const GLYPH: Record<State, string> = { pending: "", running: "•", waiting: "!", done: "✓", failed: "✕" };

export function stepStates(run: Run, events: RunEvent[]): Record<string, { state: State; detail: string | null }> {
  const out: Record<string, { state: State; detail: string | null }> = { connect: { state: "done", detail: "Repository linked" } };
  for (const e of events) {
    const prev = out[e.step];
    const state = KIND_STATE[e.kind] ?? prev?.state ?? "running";
    out[e.step] = { state, detail: e.message };
  }
  // CI and live are driven by webhooks; reflect the run's own fields too.
  if (run.status === "pr_open" && !out.ci) out.ci = { state: "waiting", detail: "Waiting for your CI checks" };
  if (run.ciStatus === "success") out.ci = { state: "done", detail: out.ci?.detail ?? "Checks passed" };
  if (run.ciStatus === "none" && run.status === "pr_open") out.ci = { state: "done", detail: "No CI checks on this repo" };
  if (run.status === "pr_open") out.live = { state: "waiting", detail: "Accept the pull request to go live" };
  if (run.status === "merged") out.live = { state: "done", detail: out.live?.detail ?? "Merged" };
  if (run.status === "ready") out.ci = { state: "pending", detail: "Dry run — nothing pushed" };
  // A step that "started" but the run has moved on (or ended) is no longer running.
  const finished = ["failed", "cancelled", "closed"].includes(run.status);
  for (const s of STEPS) {
    const cur = out[s.id];
    if (cur?.state === "running" && (finished || s.id !== run.step)) out[s.id] = { ...cur, state: finished ? "failed" : "done" };
  }
  return out;
}

export function Pipeline({ run, events }: { run: Run; events: RunEvent[] }) {
  const states = stepStates(run, events);
  return (
    <ol className="ag-flow" aria-label="Agent Nic pipeline" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {STEPS.map((s, i) => {
        const st = states[s.id] ?? { state: "pending" as State, detail: null };
        return (
          <li key={s.id} className="ag-node" data-state={st.state} aria-current={st.state === "running" || st.state === "waiting" ? "step" : undefined}>
            <div className="ag-node-head">
              <span className="ag-dot" aria-hidden>
                {GLYPH[st.state] || i + 1}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="ag-node-label">{s.label}</div>
                <div className="ag-node-who">{s.who}</div>
              </div>
            </div>
            {st.detail && <div className="ag-node-detail">{st.detail}</div>}
            <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
              {st.state}
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
