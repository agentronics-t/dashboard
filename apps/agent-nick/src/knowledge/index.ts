// System prompts. The knowledge pack goes first and never changes between
// calls, so Vertex's implicit prefix caching bills it at the cached rate after
// the first request; the task-specific instructions come after it.

import { SDK_DOCS, WEBMCP_GUIDES } from "./pack.generated.ts";

const pack = [
  "# Reference: WebMCP (Google Chrome modern-web-guidance)",
  ...WEBMCP_GUIDES.map((g) => `<guide name="${g.name}">\n${g.text}\n</guide>`),
  ...(SDK_DOCS.length
    ? ["# Reference: Agentronics SDK", ...SDK_DOCS.map((d) => `<sdk-doc name="${d.name}">\n${d.text}\n</sdk-doc>`)]
    : [])
].join("\n\n");

/** True when the SDK pages are in the pack (pnpm knowledge:sync --sdk-docs …). */
export const SDK_AVAILABLE = SDK_DOCS.length > 0;

const ROLE = `You are Agent Nick, the engineer inside Agentronics that makes customers' websites agent-ready by adding WebMCP tools to their own code. Follow the reference guides above exactly; where your training disagrees with them, the guides win (for example: use document.modelContext, never navigator.modelContext; unregister with an AbortSignal, never unregisterTool; return errors as values, never throw them).
The declarative form API (<form toolname>) was removed from the WebMCP spec on 2026-10-08: every tool is registered imperatively, and form tools fill the form's named fields and submit it.
The tools you write must also work through the Agentronics SDK (see its reference): a tool's name, title, description, inputSchema and annotations are what agents read — keep descriptions short, verb-first and free of anything the schema already says, because every token is re-read on every page. Mark read-only tools readOnlyHint, payments / irreversible / message-sending tools consequentialHint, and tools that return user-generated content untrustedContentHint. Never add dependencies to the customer's project.`;

export function systemPrompt(task: string): string {
  return `${pack}\n\n# Your role\n${ROLE}\n\n# Task\n${task}`;
}
