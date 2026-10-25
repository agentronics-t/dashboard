// Tool proposal — the first of only two places a model is used. Page digests
// go in (in parallel batches), typed tool proposals come out, and plain code
// then enforces the rules the model must not get wrong.

import { z } from "zod";
import { systemPrompt } from "../knowledge/index.ts";
import type { Llm } from "../llm/gemini.ts";
import type { AuthPolicy, FormAction, JsonSchema, PageDigest, Risk, ToolProposal } from "./types.ts";

const MAX_TOOLS = 40;
const BATCH_CHARS = 24_000;

const TASK = `You receive digests of a website's pages, extracted from its source code. Each digest lists the page route ("*" means site-wide components such as the header) and its actions, each with an id:
- forms (f…): fields, submit text, and declarativeReady (true = native form whose inputs all have names, so a tool can fill and submit it field by field)
- buttons (b…): visible text and the onClick handler expression
- calls (c…): HTTP calls the page makes (method + URL)
- serverActions (s…): server functions the page can call (name + parameters)

Propose the WebMCP tools an AI agent acting for a visitor would actually use on this site: finding and reading content, searching, filtering, checking availability or prices, adding to a cart, booking, contacting, subscribing and similar real tasks.

Rules:
- Each tool wraps exactly one action: set sourceId to that action's id and page to the digest's route.
- kind "form" (strategy "form") ONLY for a form with declarativeReady true — the tool fills its named fields and submits it. Everything else is kind "script" with strategy:
  "fetch" when a call (c…) performs the action against the site's own relative URL,
  "server_action" when a server action (s…) performs it,
  "dom" when the action only exists as UI (the tool fills inputs and clicks the element).
- Skip: sign-in/sign-up/password forms, payment-card entry, navigation-only links, menus, theme toggles, cookie banners, analytics and anything already covered by another tool.
- name: snake_case verb_object (e.g. search_products, add_to_cart, get_order_status). Specific, not generic.
- description: what the tool does and when to use it, in one or two sentences. Never repeat parameter names, types, enums, defaults or limits — those belong in the schema (see the guides).
- inputSchemaJson: a JSON Schema object as a JSON string: {"type":"object","properties":{...},"required":[...]}. Accept raw user input (no agent math). Every property needs a description of what the value means. For kind "form" mirror the form's named fields.
- fieldDescriptions (kind "form" only): a short meaning for any field whose label is unclear, e.g. with sample values.
- risk: "read" (no state change), "write" (reversible change), "payment" (moves money or places an order), "destructive" (deletes or is irreversible, or sends messages to real people).
- rationale: one short sentence on why an agent would use it.
- Propose at most 15 tools per batch; prefer the most useful.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          page: { type: "string" },
          sourceId: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["form", "script"] },
          strategy: { type: "string", enum: ["form", "fetch", "server_action", "dom"] },
          description: { type: "string" },
          inputSchemaJson: { type: "string" },
          risk: { type: "string", enum: ["read", "write", "payment", "destructive"] },
          rationale: { type: "string" },
          fieldDescriptions: {
            type: "array",
            items: {
              type: "object",
              properties: { field: { type: "string" }, description: { type: "string" } },
              required: ["field", "description"]
            }
          }
        },
        required: ["page", "sourceId", "name", "kind", "strategy", "description", "inputSchemaJson", "risk", "rationale"]
      }
    }
  },
  required: ["tools"]
} as const;

const rawTool = z.object({
  page: z.string(),
  sourceId: z.string(),
  name: z.string(),
  kind: z.enum(["form", "script"]),
  strategy: z.enum(["form", "fetch", "server_action", "dom"]),
  description: z.string().min(1),
  inputSchemaJson: z.string(),
  risk: z.enum(["read", "write", "payment", "destructive"]),
  rationale: z.string(),
  fieldDescriptions: z.array(z.object({ field: z.string(), description: z.string() })).optional()
});
const rawResponse = z.object({ tools: z.array(rawTool) });
type RawTool = z.infer<typeof rawTool>;

/** What the model sees of a digest: no file paths, offsets or code. */
function compact(d: PageDigest) {
  return {
    route: d.route,
    title: d.title,
    forms: d.forms.map((f) => ({
      id: f.id,
      action: f.action,
      method: f.method,
      onSubmit: f.onSubmit,
      fields: f.fields,
      submit: f.submitText,
      declarativeReady: f.declarativeReady
    })),
    buttons: d.buttons.map((b) => ({ id: b.id, text: b.text, onClick: b.handler })),
    calls: d.calls.map((c) => ({ id: c.id, method: c.method, url: c.url })),
    serverActions: d.serverActions.map((s) => ({ id: s.id, name: s.name, params: s.params }))
  };
}

export function batchDigests(digests: PageDigest[]): PageDigest[][] {
  const batches: PageDigest[][] = [];
  let cur: PageDigest[] = [];
  let size = 0;
  for (const d of digests) {
    const n = JSON.stringify(compact(d)).length;
    if (cur.length && size + n > BATCH_CHARS) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(d);
    size += n;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const SENSITIVE_FIELD = /pass(word)?|card|cvc|cvv|iban|ssn|otp|pin\b/i;

const DEFAULT_AUTH: Record<Risk, AuthPolicy> = {
  read: "public",
  write: "signed_in",
  payment: "scoped",
  destructive: "scoped"
};

const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "tool_$1")
    .slice(0, 64) || "tool";

export function formSchema(form: FormAction, descriptions: Record<string, string>): JsonSchema {
  const properties: JsonSchema["properties"] = {};
  const required: string[] = [];
  for (const f of form.fields) {
    if (!f.name) continue;
    const type = f.type === "number" || f.type === "range" ? "number" : f.type === "checkbox" ? "boolean" : "string";
    const description = descriptions[f.name] ?? f.label;
    properties[f.name] = {
      type,
      ...(description ? { description } : {}),
      ...(f.options?.length ? { enum: f.options } : {})
    };
    if (f.required) required.push(f.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

function parseSchema(json: string): JsonSchema {
  const fallback: JsonSchema = { type: "object", properties: {} };
  try {
    const s = JSON.parse(json) as Partial<JsonSchema>;
    if (s.type !== "object" || typeof s.properties !== "object" || s.properties === null) return fallback;
    const required = (s.required ?? []).filter((r) => r in (s.properties ?? {}));
    return { type: "object", properties: s.properties, ...(required.length ? { required } : {}) };
  } catch {
    return fallback;
  }
}

/** Apply the rules the model must not get wrong; drop what doesn't map back to real code. */
export function normalize(raw: RawTool[], digests: PageDigest[]): ToolProposal[] {
  const actions = new Map<string, { page: string; form?: FormAction; kind: string }>();
  for (const d of digests) {
    for (const f of d.forms) actions.set(f.id, { page: d.route, form: f, kind: "form" });
    for (const b of d.buttons) actions.set(b.id, { page: d.route, kind: "button" });
    for (const c of d.calls) actions.set(c.id, { page: d.route, kind: "call" });
    for (const s of d.serverActions) actions.set(s.id, { page: d.route, kind: "server" });
  }

  const names = new Set<string>();
  const sources = new Set<string>();
  const out: ToolProposal[] = [];
  for (const t of raw) {
    const action = actions.get(t.sourceId);
    if (!action || sources.has(t.sourceId)) continue;
    if (action.form?.fields.some((f) => SENSITIVE_FIELD.test(`${f.name ?? ""} ${f.type} ${f.label ?? ""}`))) continue;

    let kind = t.kind;
    let strategy = t.strategy;
    if (kind === "form" && !action.form?.declarativeReady) {
      kind = "script";
      strategy = "dom";
    }
    if (kind === "script") {
      if (strategy === "form") strategy = "dom";
      if (strategy === "fetch" && action.kind !== "call") strategy = "dom";
      if (strategy === "server_action" && action.kind !== "server") strategy = "dom";
    } else {
      strategy = "form";
    }

    let name = snake(t.name);
    for (let i = 2; names.has(name); i++) name = `${snake(t.name).slice(0, 60)}_${i}`;

    const fieldDescriptions = Object.fromEntries((t.fieldDescriptions ?? []).map((f) => [f.field, f.description.trim()]));
    const inputSchema = kind === "form" && action.form ? formSchema(action.form, fieldDescriptions) : parseSchema(t.inputSchemaJson);

    names.add(name);
    sources.add(t.sourceId);
    out.push({
      page: action.page,
      name,
      kind,
      sourceId: t.sourceId,
      strategy,
      description: t.description.trim(),
      inputSchema,
      risk: t.risk,
      readOnly: t.risk === "read",
      consequential: t.risk === "payment" || t.risk === "destructive",
      auth: DEFAULT_AUTH[t.risk],
      rationale: t.rationale.trim(),
      ...(kind === "form" && Object.keys(fieldDescriptions).length ? { fieldDescriptions } : {})
    });
    if (out.length >= MAX_TOOLS) break;
  }
  return out;
}

export async function proposeTools(llm: Llm, siteName: string, digests: PageDigest[]): Promise<ToolProposal[]> {
  const system = systemPrompt(TASK);
  const batches = batchDigests(digests);
  const results = await Promise.all(
    batches.map((batch) =>
      llm.json({
        system,
        prompt: `Site: ${siteName}\nPage digests (JSON):\n${JSON.stringify(batch.map(compact))}`,
        schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        effort: "low",
        parse: (v) => rawResponse.parse(v).tools
      })
    )
  );
  return normalize(results.flat(), digests);
}
