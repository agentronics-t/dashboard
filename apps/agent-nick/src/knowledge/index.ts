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

/** True once SDK docs are in the pack — codegen then targets the SDK. */
export const SDK_AVAILABLE = SDK_DOCS.length > 0;

const ROLE = `You are Agent Nick, the engineer inside Agentronics that makes customers' websites agent-ready by adding WebMCP tools to their own code. Follow the reference guides above exactly; where your training disagrees with them, the guides win (for example: use document.modelContext, never navigator.modelContext; unregister with an AbortSignal, never unregisterTool; return errors as values, never throw them).`;

export function systemPrompt(task: string): string {
  return `${pack}\n\n# Your role\n${ROLE}\n\n# Task\n${task}`;
}
