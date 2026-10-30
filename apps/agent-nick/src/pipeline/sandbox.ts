// Trial run of each handler Gemini writes, before anything is pushed: call it
// the way an agent would and check it does the job. Catches what reading the
// code can't — a handler that rejects a valid call (the search tool that
// refused an empty search), throws, returns nothing, or never calls the
// site's API.
//
// The code comes from a model reading a customer's repository, so it never
// runs in this process: it runs in QuickJS compiled to WebAssembly, which can
// only see the fakes defined below (fetch, FormData, URL, location, a blank
// document) — no network, files, environment or Node APIs — under a memory
// cap and a deadline.

import ts from "typescript";
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-cjs-release-sync";
import type { JsonSchema, ToolProposal } from "./types.ts";

let quickjs: Promise<QuickJSWASMModule> | null = null;
// (A CommonJS module: its default export is the variant, which TypeScript can't see through.)
const engine = () => (quickjs ??= newQuickJSWASMModuleFromVariant(variant as unknown as Parameters<typeof newQuickJSWASMModuleFromVariant>[0]));

// The browser, faked: every request answers 200 with an empty JSON list.
const PRELUDE = String.raw`
const __calls = { fetch: 0, action: 0 };
class Headers {
  constructor(h) { this._h = {}; if (h) for (const [k, v] of (h instanceof Headers ? Object.entries(h._h) : Array.isArray(h) ? h : Object.entries(h))) this._h[String(k).toLowerCase()] = String(v); }
  get(k) { return this._h[String(k).toLowerCase()] ?? null; } has(k) { return String(k).toLowerCase() in this._h; }
  set(k, v) { this._h[String(k).toLowerCase()] = String(v); } append(k, v) { this.set(k, v); } delete(k) { delete this._h[String(k).toLowerCase()]; }
  forEach(f) { for (const k in this._h) f(this._h[k], k); } entries() { return Object.entries(this._h)[Symbol.iterator](); } [Symbol.iterator]() { return this.entries(); }
}
class URLSearchParams {
  constructor(init) {
    this._e = [];
    if (typeof init === "string") for (const p of init.replace(/^\?/, "").split("&").filter(Boolean)) { const [k, v = ""] = p.split("="); this._e.push([decodeURIComponent(k), decodeURIComponent(v)]); }
    else if (init && typeof init[Symbol.iterator] === "function") for (const [k, v] of init) this._e.push([String(k), String(v)]);
    else if (init) for (const k of Object.keys(init)) this._e.push([k, String(init[k])]);
  }
  append(k, v) { this._e.push([String(k), String(v)]); } set(k, v) { this.delete(k); this.append(k, v); } delete(k) { this._e = this._e.filter((e) => e[0] !== k); }
  get(k) { const e = this._e.find((e) => e[0] === k); return e ? e[1] : null; } getAll(k) { return this._e.filter((e) => e[0] === k).map((e) => e[1]); } has(k) { return this._e.some((e) => e[0] === k); }
  forEach(f) { for (const [k, v] of this._e) f(v, k); } entries() { return this._e[Symbol.iterator](); } [Symbol.iterator]() { return this.entries(); }
  toString() { return this._e.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&"); }
}
class URL {
  constructor(u, base) {
    u = String(u);
    const abs = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : String(base ?? location.origin).replace(/\/+$/, "").replace(/^(https?:\/\/[^/]+).*$/, "$1") + (u.startsWith("/") ? u : "/" + u);
    const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(abs) ?? [abs, "https:", "", abs, "", ""];
    this.protocol = m[1]; this.host = m[2]; this.hostname = m[2].replace(/:\d+$/, ""); this.pathname = m[3] || "/"; this.hash = m[5] || "";
    this.origin = this.protocol + "//" + this.host; this.searchParams = new URLSearchParams(m[4] || "");
  }
  get search() { const q = this.searchParams.toString(); return q ? "?" + q : ""; }
  get href() { return this.origin + this.pathname + this.search + this.hash; }
  toString() { return this.href; } toJSON() { return this.href; }
}
class FormData {
  constructor() { this._e = []; }
  append(k, v) { this._e.push([String(k), v]); } set(k, v) { this.delete(k); this.append(k, v); } delete(k) { this._e = this._e.filter((e) => e[0] !== k); }
  get(k) { const e = this._e.find((e) => e[0] === k); return e ? e[1] : null; } getAll(k) { return this._e.filter((e) => e[0] === k).map((e) => e[1]); } has(k) { return this._e.some((e) => e[0] === k); }
  entries() { return this._e[Symbol.iterator](); } keys() { return this._e.map((e) => e[0])[Symbol.iterator](); } [Symbol.iterator]() { return this.entries(); }
}
const BODY = '{"ok":true,"items":[],"results":[],"data":[],"products":[]}';
class Response {
  constructor(body = BODY, init = {}) { this._b = String(body); this.status = init.status ?? 200; this.ok = this.status < 400; this.statusText = "OK"; this.headers = new Headers({ "content-type": "application/json" }); this.redirected = false; this.url = ""; }
  async json() { return JSON.parse(this._b); } async text() { return this._b; } clone() { return new Response(this._b, { status: this.status }); }
}
const fetch = async (url) => { __calls.fetch++; return new Response(); };
const signalStub = () => ({ aborted: false, reason: undefined, throwIfAborted() {}, addEventListener() {}, removeEventListener() {} });
class AbortController { constructor() { this.signal = signalStub(); } abort() { this.signal.aborted = true; } }
const AbortSignal = { timeout: () => signalStub(), any: () => signalStub(), abort: () => ({ ...signalStub(), aborted: true }) };
const location = new URL("https://shop.example/");
const storage = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, clear() {} }; };
const localStorage = storage(), sessionStorage = storage();
const document = { cookie: "", title: "", querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, getElementsByName: () => [], createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), body: { appendChild() {} }, documentElement: {}, addEventListener() {}, dispatchEvent() { return true; } };
const window = globalThis, self = globalThis;
const navigator = { userAgent: "AgentNicTrial/1.0", language: "en" };
const history = { pushState() {}, replaceState() {}, back() {} };
const console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const setTimeout = (f, ms, ...a) => { Promise.resolve().then(() => f(...a)); return 1; };
const clearTimeout = () => {}, setInterval = () => 1, clearInterval = () => {};
const structuredClone = (v) => JSON.parse(JSON.stringify(v));
const crypto = { randomUUID: () => "00000000-0000-4000-8000-000000000000", getRandomValues: (a) => a };
class Event { constructor(type, init) { this.type = type; this.detail = init?.detail; } }
class CustomEvent extends Event {}
const dispatchEvent = () => true;
const btoa = (s) => s, atob = (s) => s;
`;

const SAMPLE_BY_NAME: [RegExp, unknown][] = [
  [/e-?mail/i, "agent@example.com"],
  [/url|link|website/i, "https://example.com"],
  [/phone|mobile|tel/i, "5550100"],
  [/date/i, "2026-11-01"],
  [/zip|pin|postal/i, "560001"],
  [/qty|quantity|count|amount|price/i, 1]
];

function sample(name: string, prop: JsonSchema["properties"][string]): unknown {
  if (prop.enum?.length) return prop.enum[0];
  const t = String(prop.type);
  if (t === "number" || t === "integer") return 1;
  if (t === "boolean") return true;
  if (t === "array") return [];
  if (t === "object") return {};
  const byName = SAMPLE_BY_NAME.find(([re]) => re.test(name))?.[1];
  return typeof byName === "string" ? byName : "test";
}

/** The two calls every handler gets: only the required fields, then every field. */
export function trialInputs(schema: JsonSchema): { label: string; input: Record<string, unknown> }[] {
  const required = new Set(schema.required ?? []);
  const props = Object.entries(schema.properties ?? {});
  const minimal = Object.fromEntries(props.filter(([k]) => required.has(k)).map(([k, p]) => [k, sample(k, p)]));
  const full = Object.fromEntries(props.map(([k, p]) => [k, sample(k, p)]));
  return props.length > Object.keys(minimal).length
    ? [
        { label: required.size ? "only its required fields" : "no arguments", input: minimal },
        { label: "every field", input: full }
      ]
    : [{ label: "every field", input: full }];
}

type Outcome = { threw: string } | { value: unknown; calls: { fetch: number; action: number } } | { stuck: true };

async function runOnce(js: string, input: Record<string, unknown>): Promise<Outcome> {
  const runtime = (await engine()).newRuntime();
  runtime.setMemoryLimit(32 * 1024 * 1024);
  runtime.setMaxStackSize(1024 * 1024);
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + 1500));
  const vm = runtime.newContext();
  try {
    const code = `${PRELUDE}\n${js}\nglobalThis.__out = null;\n(async () => {\n  try { const value = await __tool(${JSON.stringify(input)}, signalStub()); globalThis.__out = JSON.stringify({ value: value === undefined ? "__undefined__" : value, calls: __calls }); }\n  catch (e) { globalThis.__out = JSON.stringify({ threw: String((e && e.message) || e) }); }\n})();`;
    const res = vm.evalCode(code, "handler.js");
    if (res.error) {
      const err = vm.dump(res.error) as { message?: string } | string;
      res.error.dispose();
      return { threw: typeof err === "string" ? err : (err?.message ?? "could not run") };
    }
    res.value.dispose();
    for (let i = 0; i < 1000; i++) {
      const jobs = runtime.executePendingJobs();
      if (jobs.error) {
        jobs.error.dispose();
        break;
      }
      if (jobs.value === 0) break;
    }
    const out = vm.evalCode("globalThis.__out");
    if (out.error) {
      out.error.dispose();
      return { stuck: true };
    }
    const raw = vm.dump(out.value) as string | null;
    out.value.dispose();
    if (!raw) return { stuck: true };
    const parsed = JSON.parse(raw) as { threw?: string; value?: unknown; calls?: { fetch: number; action: number } };
    if (parsed.threw !== undefined) return { threw: parsed.threw };
    return { value: parsed.value === "__undefined__" ? undefined : parsed.value, calls: parsed.calls ?? { fetch: 0, action: 0 } };
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}

// An error value that's about the input, not about the (fake, empty) response.
const INPUT_COMPLAINT = /required|missing|provide|must (be|include|have)|is empty|invalid|expected|at least one|either/i;

/** Problems found by calling the handler; empty when it behaves. */
export async function trialRun(t: ToolProposal, body: string, opts: { serverAction?: string } = {}): Promise<string[]> {
  const action = opts.serverAction && /^[A-Za-z_$][\w$]*$/.test(opts.serverAction) ? opts.serverAction : null;
  const wrapped = `${action ? `const ${action} = async (...args) => { __calls.action++; return { ok: true }; };\n` : ""}async function __tool(input, signal) {\n${body}\n}`;
  const js = ts.transpileModule(wrapped, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const issues: string[] = [];
  let calledApi = false;
  for (const { label, input } of trialInputs(t.inputSchema)) {
    let outcome: Outcome;
    try {
      outcome = await runOnce(js, input);
    } catch (err) {
      // The sandbox itself failed (not the handler): don't hold the tool back for it.
      console.warn("agent-nick: trial run unavailable", err instanceof Error ? err.message : err);
      return [];
    }
    const call = `${JSON.stringify(input)} (${label})`;
    if ("stuck" in outcome) {
      issues.push(`never finishes when called with ${call}`);
      continue;
    }
    if ("threw" in outcome) {
      // A browser global this fake page lacks isn't the handler's fault.
      if (/is not defined/.test(outcome.threw)) continue;
      if (/interrupted/i.test(outcome.threw)) issues.push(`never finishes when called with ${call}`);
      else issues.push(`throws when called with ${call}: ${outcome.threw}`);
      continue;
    }
    if (outcome.value === undefined) issues.push(`returns nothing when called with ${call}`);
    const error = outcome.value && typeof outcome.value === "object" ? (outcome.value as { error?: unknown }).error : undefined;
    if (typeof error === "string" && INPUT_COMPLAINT.test(error)) {
      issues.push(`rejects a valid call ${call} with "${error}": only reject what the schema marks required; leave optional fields out of the request instead`);
    }
    if (outcome.calls.fetch > 0 || outcome.calls.action > 0) calledApi = true;
  }
  if (!issues.length && !calledApi) {
    if (t.strategy === "fetch") issues.push("never calls the site's API (fetch) for a valid call");
    if (t.strategy === "server_action" && action) issues.push(`never calls the server action ${action} for a valid call`);
  }
  return issues;
}
