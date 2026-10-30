// The second (and last) model step: write the body of each tool that calls an
// API or a server action. One batched call; bodies are then checked by code
// (syntax + the guide's rules) and repaired once if needed.

import ts from "typescript";
import { z } from "zod";
import { systemPrompt } from "../knowledge/index.ts";
import type { Llm } from "../llm/gemini.ts";
import type { Handler } from "./codegen.ts";
import type { PageDigest, ToolProposal } from "./types.ts";

const TASK = `Write the body of the execute function for each WebMCP tool below. The body is pasted inside:

  async execute(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown> {
    const signal = options?.signal ?? null; // AbortSignal | null
    <YOUR BODY>
  }

Rules (from the guides — follow them exactly):
- Read arguments from \`input\`, validate them in code (the browser does not validate against inputSchema or apply defaults), and return a structured error value such as { error: "...", hint: "..." } for bad input or failed requests. Never throw for those.
- Only reject what the schema marks required. A missing optional argument is not an error: do what the site does when that field is left empty (an empty search lists everything, no category means all categories).
- strategy "fetch": call the site's own API exactly as the existing code does (same method, same relative URL, same body shape and headers), passing \`signal\` to fetch. Return the parsed JSON (or a short summary of it).
- strategy "server_action": the server action is already imported under its own name; call it with arguments built from \`input\` (mirror how the existing code calls it, FormData included) and return its result.
- Only re-throw when \`signal?.aborted\` is true.
- TypeScript, no imports, no new globals, no comments longer than one line, no console logging, no secrets.
- Return the shortest correct body.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    handlers: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, body: { type: "string" } },
        required: ["name", "body"]
      }
    }
  },
  required: ["handlers"]
};

const parseResponse = (v: unknown) => z.object({ handlers: z.array(z.object({ name: z.string(), body: z.string() })) }).parse(v).handlers;

function context(t: ToolProposal, digests: PageDigest[]) {
  for (const d of digests) {
    const call = d.calls.find((c) => c.id === t.sourceId);
    if (call) return { kind: "fetch", method: call.method, url: call.url, existingCode: call.snippet };
    const sa = d.serverActions.find((s) => s.id === t.sourceId);
    if (sa) return { kind: "server_action", callAs: sa.name, params: sa.params };
  }
  return null;
}

/** Problems with one handler body; empty when it's good to ship. */
export function checkHandler(t: ToolProposal, body: string): string[] {
  const issues: string[] = [];
  const wrapped = `async function __tool(input: Record<string, unknown>, signal: AbortSignal | null): Promise<unknown> {\n${body}\n}`;
  const out = ts.transpileModule(wrapped, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022 } });
  for (const d of out.diagnostics ?? []) issues.push(`syntax: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  if (/navigator\.modelContext|unregisterTool|provideContext/.test(body)) issues.push("uses a removed WebMCP API");
  if (/\bimport\s|\brequire\(/.test(body)) issues.push("contains an import");
  if (/\bfetch\s*\(/.test(body) && !/\bsignal\b/.test(body.slice(body.search(/\bfetch\s*\(/)))) issues.push("fetch() must pass `signal`");
  // `throw` is only allowed for cancellation.
  const throws = [...body.matchAll(/\bthrow\b/g)].length;
  const abortThrows = [...body.matchAll(/aborted[\s\S]{0,80}?\bthrow\b|\bthrowIfAborted\(/g)].length;
  if (throws > abortThrows) issues.push("throws instead of returning an error value");
  if (!/\breturn\b/.test(body)) issues.push("never returns a result");
  if (t.strategy === "fetch" && !/\bfetch\s*\(/.test(body)) issues.push("strategy fetch but no fetch() call");
  return issues;
}

export async function writeHandlers(
  llm: Llm,
  tools: ToolProposal[],
  digests: PageDigest[]
): Promise<{ handlers: Record<string, Handler>; failed: { name: string; issues: string[] }[] }> {
  const targets = tools.filter((t) => t.strategy === "fetch" || t.strategy === "server_action");
  const handlers: Record<string, Handler> = {};
  if (!targets.length) return { handlers, failed: [] };

  const system = systemPrompt(TASK);
  const spec = (t: ToolProposal, extra?: object) => ({
    name: t.name,
    strategy: t.strategy,
    description: t.description,
    inputSchema: t.inputSchema,
    source: context(t, digests),
    ...extra
  });

  const first = await llm.json({
    system,
    prompt: `Tools (JSON):\n${JSON.stringify(targets.map((t) => spec(t)))}`,
    schema: RESPONSE_SCHEMA,
    effort: "medium",
    parse: parseResponse
  });
  const byName = new Map(first.map((h) => [h.name, h.body]));

  // One repair round for anything that fails the checks.
  const broken = targets
    .map((t) => ({ t, body: byName.get(t.name) ?? "", issues: checkHandler(t, byName.get(t.name) ?? "") }))
    .filter((x) => x.issues.length);
  if (broken.length) {
    const fixed = await llm.json({
      system,
      prompt: `These handler bodies failed review. Fix every listed issue and return corrected bodies.\n${JSON.stringify(
        broken.map(({ t, body, issues }) => spec(t, { previousBody: body, issues }))
      )}`,
      schema: RESPONSE_SCHEMA,
      effort: "medium",
      parse: parseResponse
    }).catch(() => []);
    for (const h of fixed) byName.set(h.name, h.body);
  }

  const failed: { name: string; issues: string[] }[] = [];
  for (const t of targets) {
    const body = byName.get(t.name) ?? "";
    const issues = checkHandler(t, body);
    if (issues.length) failed.push({ name: t.name, issues });
    else handlers[t.name] = { body };
  }
  return { handlers, failed };
}
