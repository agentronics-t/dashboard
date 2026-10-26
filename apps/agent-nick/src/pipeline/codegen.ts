// Code generation. Almost all of it is deterministic: a data-agent-tool anchor
// on the forms and controls agents use, one tools module registered with
// document.modelContext.registerTool(), and a mount point per framework. The
// model only writes the body of tools that call an API or a server action
// (see handlers.ts).
//
// Every tool is imperative. The declarative form API (<form toolname>) was
// removed from the WebMCP spec on 2026-10-08 and lives on only as an explainer,
// so forms become tools that fill and submit the form.

import ts from "typescript";
import { parseSource } from "./extract.ts";
import type { RepoReader } from "./repo.ts";
import type { FileChange, Framework, PageDigest, SdkInstall, SiteFixKind, ToolProposal } from "./types.ts";

export interface Handler {
  /** Statements of `async execute(input, options)`; `input` and `signal` are in scope. */
  body: string;
}

export interface CodegenResult {
  changes: FileChange[];
  /** tool name → file it lives in */
  toolFiles: Record<string, string>;
  /** Things a human must do by hand (e.g. we couldn't find where to mount). */
  manualSteps: string[];
  /** Tools we could not wire (source code moved, unsupported shape…). */
  skipped: { name: string; reason: string }[];
  /** Files written for each site fix (llms.txt, sitemap, structured data) — see sitefiles.ts. */
  siteFiles?: Partial<Record<SiteFixKind, string[]>>;
  /** Files that load the Agentronics SDK (set when `sdk` is passed to generateCode). */
  sdkFiles?: string[];
}

/** The SDK's browser build, pinned: loaded from the CDN so the repo needs no new dependency (and no lockfile change). */
export const SDK_VERSION = "0.7.0";
export const SDK_CDN_URL = `https://cdn.jsdelivr.net/npm/@agentronics/sdk@${SDK_VERSION}/dist/index.global.js`;

interface Edit {
  pos: number;
  insert: string;
  /** Characters replaced at `pos` (default 0: a plain insert). */
  remove?: number;
}

const applyEdits = (text: string, edits: Edit[]) =>
  [...edits].sort((a, b) => b.pos - a.pos).reduce((t, e) => t.slice(0, e.pos) + e.insert + t.slice(e.pos + (e.remove ?? 0)), text);

/** An existing data-agent-tool attribute on the tag at `pos` (from an earlier run): where its value is. */
function existingAnchor(text: string, pos: number): { start: number; end: number; value: string } | null {
  const tagEnd = text.indexOf(">", pos);
  const tag = text.slice(pos, tagEnd === -1 ? pos + 400 : tagEnd);
  const m = /\sdata-agent-tool=(["'])([^"']*)\1/.exec(tag) ?? /\sdata-agent-tool=\{\s*(["'])([^"']*)\1\s*\}/.exec(tag);
  if (!m) return null;
  const start = pos + m.index + m[0].indexOf(m[1]!) + 1;
  return { start, end: start + m[2]!.length, value: m[2]! };
}

const isMarkup = (p: string) => /\.html?$/i.test(p);
const htmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** `<tag` attribute insertion point (right after the tag name) when `pos` still points at `<tag`. */
function afterTagName(text: string, pos: number): number | null {
  const m = /^<([A-Za-z][\w.:-]*)/.exec(text.slice(pos, pos + 80));
  return m ? pos + m[0].length : null;
}

function markupAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${htmlAttr(v)}"`))
    .join("");
}

export function relImport(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.replace(/\.(tsx?|jsx?|mjs)$/, "").split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const rel = [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Position right after the last import (or the "use client" directive, or 0). */
export function importInsertPos(text: string, path: string): number {
  const sf = parseSource(path, text);
  let pos = 0;
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) pos = s.getEnd();
    else if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && pos === 0) pos = s.getEnd();
    else break;
  }
  return pos;
}


/** Where generated files go: <app root>/src/agentronics or <app root>/agentronics. */
export function moduleDir(reader: RepoReader, fw: Framework): string {
  const base = fw.root ? `${fw.root}/` : "";
  if (fw.kind === "static-html") return fw.root;
  const hasSrc = reader.list(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}src/`)).length > 0;
  return `${base}${hasSrc ? "src/" : ""}agentronics`;
}

/**
 * The pathnames a page's tools register on. Plain HTML sites are reached as
 * /about.html as well as /about (and / as /index.html), so those match too.
 */
export const routeRegex = (route: string, staticHtml = false) => {
  if (route === "*") return ".*";
  if (route === "/" || route === "") return staticHtml ? "^/(index\\.html?)?$" : "^/$";
  const path = route
    .split("/")
    .map((seg) => (/^\[\[?\.\.\./.test(seg) ? ".*" : /^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return staticHtml ? `^${path}(\\.html?|/index\\.html?)?/?$` : `^${path}/?$`;
};

const DOM_HELPER = `
/** Fill the visible form/control for a UI-only action and trigger it, the way a person would. */
async function fillAndAct(anchor: string, page: string, input: ToolInput, signal: AbortSignal | null): Promise<unknown> {
  const el = document.querySelector<HTMLElement>(\`[data-agent-tool="\${anchor}"]\`);
  if (!el) return { error: \`This action is on \${page}. Open that page first, then call the tool again.\` };
  const scope: ParentNode = el instanceof HTMLFormElement ? el : (el.closest("form") ?? document);
  const missing: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    const control = scope.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      \`[name="\${CSS.escape(key)}"], #\${CSS.escape(key)}, [aria-label="\${CSS.escape(key)}"]\`
    );
    if (!control) {
      missing.push(key);
      continue;
    }
    if (control instanceof HTMLInputElement && (control.type === "checkbox" || control.type === "radio")) {
      if (control.checked !== Boolean(value)) control.click();
      continue;
    }
    // Use the native setter so frameworks with controlled inputs (React) see the change.
    const proto = Object.getPrototypeOf(control) as object;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(control, String(value ?? ""));
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (missing.length) return { error: \`Could not find fields: \${missing.join(", ")}.\` };
  signal?.throwIfAborted();
  if (el instanceof HTMLFormElement) el.requestSubmit();
  else el.click();
  // Return after the UI has had a moment to update, so the agent reads fresh state.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { ok: true, result: "Done. The page now shows the outcome." };
}
`;

/** "search_products" → "Search products" (WebMCP `title`, shown in browser UI). */
export const toolTitle = (name: string) => {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[_\-.\s]+/).filter(Boolean).join(" ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function toolLiteral(t: ToolProposal, execute: string, staticHtml: boolean): string {
  const annotations = [`readOnlyHint: ${t.readOnly}`, ...(t.consequential ? ["consequentialHint: true"] : [])].join(", ");
  return `  {
    pages: ${JSON.stringify([routeRegex(t.page, staticHtml)])},
    tool: {
      name: ${JSON.stringify(t.name)},
      title: ${JSON.stringify(toolTitle(t.name))},
      description: ${JSON.stringify(t.description)},
      inputSchema: ${JSON.stringify(t.inputSchema, null, 2).replace(/\n/g, "\n      ")},
      async execute(args: unknown, options?: { signal?: AbortSignal }): Promise<unknown> {
        const input = (args ?? {}) as ToolInput;
        const signal = options?.signal ?? null;
${execute
  .trim()
  .split("\n")
  .map((l) => `        ${l}`)
  .join("\n")}
      },
      annotations: { ${annotations} }
    }
  }`;
}

/** Loads the SDK's browser build once and starts it with the site's publishable key. */
function sdkLoader(sdk: SdkInstall): string {
  return `
// The Agentronics SDK: agent detection, your access rules and reviews from the
// console, and traces back to it. Loaded from the CDN (pinned version), so
// there is nothing to install. The publishable key is public by design: it can
// only send data from your site's own address.
const SDK_URL = ${JSON.stringify(SDK_CDN_URL)};
const SDK_OPTIONS = {
  publishableKey: ${JSON.stringify(sdk.publishableKey)},
  siteId: ${JSON.stringify(sdk.siteId)},
  trace: { gateway: true }
};

type AgentronicsGlobal = { init(options: typeof SDK_OPTIONS): AgentronicsClientLike };
let sdkClient: Promise<AgentronicsClientLike | null> | null = null;

/** The site's Agentronics client, started once per page load (null if the SDK can't load). */
export function connectAgentronics(): Promise<AgentronicsClientLike | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  sdkClient ??= new Promise((resolve) => {
    const w = window as unknown as { Agentronics?: AgentronicsGlobal; __agentronics?: AgentronicsClientLike };
    const start = () => {
      let started: AgentronicsClientLike | null = null;
      try {
        w.__agentronics ??= w.Agentronics?.init(SDK_OPTIONS);
        started = w.__agentronics ?? null;
      } catch {
        started = null;
      }
      if (!started) return resolve(null);
      const ready = started;
      // Your console's rules and descriptions first (briefly), so the tools publish with them.
      const synced = ready.syncConfig?.().catch(() => undefined) ?? Promise.resolve();
      void Promise.race([synced, new Promise((r) => setTimeout(r, 1500))]).then(() => resolve(ready));
    };
    if (w.__agentronics || w.Agentronics) return start();
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = start;
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return sdkClient;
}
`;
}

const NO_SDK = `
/** No Agentronics SDK on this site: tools register with the browser directly. */
export function connectAgentronics(): Promise<AgentronicsClientLike | null> {
  return Promise.resolve(null);
}
`;

/** The tools module (TypeScript source; transpiled for JavaScript projects). */
export function toolsModule(
  tools: ToolProposal[],
  handlers: Record<string, Handler>,
  imports: string[],
  opts: { staticHtml?: boolean; sdk?: SdkInstall | null } = {}
): string {
  const entries = tools.map((t) =>
    toolLiteral(
      t,
      t.strategy === "dom" || t.strategy === "form"
        ? `return fillAndAct(${JSON.stringify(t.name)}, ${JSON.stringify(t.page === "*" ? "this site" : t.page)}, input, signal);`
        : (handlers[t.name]?.body ?? `return { error: "Not available." };`),
      !!opts.staticHtml
    )
  );
  const needsDom = tools.some((t) => t.strategy === "dom" || t.strategy === "form");
  return `// WebMCP tools for this site — generated by Agentronics Agent Nic.
// Each tool is registered only on the pages it belongs to and unregistered
// (via AbortSignal) when the visitor navigates away. Browsers without WebMCP
// skip all of this. Spec: https://webmachinelearning.github.io/webmcp/
//
// With the Agentronics SDK the tools register through it (see
// connectAgentronics), so the rules, reviews and approved descriptions you
// manage in the console apply.
${imports.join("\n")}

type ToolInput = Record<string, unknown>;

interface ModelContextTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown> | unknown;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean };
}

interface ModelContextLike {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

/** The part of an Agentronics SDK client this module needs (no import, no dependency). */
export interface AgentronicsClientLike {
  registerTool(tool: ModelContextTool): () => void;
  publishToWebMcp(): unknown;
  /** Pull the rules, approved descriptions and site memory set in the console. */
  syncConfig?(): Promise<unknown>;
  /** Report the registered tools to the console. */
  syncTools?(): Promise<unknown>;
}

function modelContext(): ModelContextLike | null {
  if (typeof document === "undefined" || !("modelContext" in document)) return null;
  return (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? null;
}
${needsDom ? DOM_HELPER : ""}
${opts.sdk ? sdkLoader(opts.sdk) : NO_SDK}
const TOOLS: { pages: string[]; tool: ModelContextTool }[] = [
${entries.join(",\n")}
];

/** Register the tools that belong to \`pathname\`; abort \`signal\` to unregister them. */
export function registerAgentronicsTools(pathname: string, signal: AbortSignal, client?: AgentronicsClientLike): void {
  const here = TOOLS.filter(({ pages }) => pages.some((p) => new RegExp(p).test(pathname)));
  if (client) {
    const offs = here.map(({ tool }) => client.registerTool(tool));
    client.publishToWebMcp();
    if (here.length) void client.syncTools?.().catch(() => undefined);
    signal.addEventListener("abort", () => {
      offs.forEach((off) => off());
      client.publishToWebMcp();
    }, { once: true });
    return;
  }
  const mc = modelContext();
  if (!mc) return;
  for (const { tool } of here) {
    void Promise.resolve(mc.registerTool(tool, { signal })).catch(() => undefined);
  }
}

/** For apps without a router hook: register now and again after every navigation. */
export function startAgentronicsTools(): void {
  if (typeof window === "undefined") return;
  let controller = new AbortController();
  const sync = () => {
    controller.abort();
    controller = new AbortController();
    const { signal } = controller;
    void connectAgentronics().then((sdk) => {
      if (!signal.aborted) registerAgentronicsTools(window.location.pathname, signal, sdk ?? undefined);
    });
  };
  sync();
  window.addEventListener("popstate", sync);
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener("navigatesuccess", sync);
}
`;
}

export function toJs(source: string, fileName: string): string {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve }
  }).outputText;
}

const NEXT_APP_MOUNT = `"use client";

// Starts the Agentronics SDK and registers this site's WebMCP tools for the
// current route — added by Agentronics Agent Nic.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { connectAgentronics, registerAgentronicsTools } from "./webmcp-tools";

export function AgentronicsWebMcp() {
  const pathname = usePathname();
  useEffect(() => {
    const controller = new AbortController();
    void connectAgentronics().then((sdk) => {
      if (!controller.signal.aborted) registerAgentronicsTools(pathname, controller.signal, sdk ?? undefined);
    });
    return () => controller.abort();
  }, [pathname]);
  return null;
}
`;

const NEXT_PAGES_MOUNT = `// Starts the Agentronics SDK and registers this site's WebMCP tools for the
// current route — added by Agentronics Agent Nic.
import { useEffect } from "react";
import { useRouter } from "next/router";
import { connectAgentronics, registerAgentronicsTools } from "./webmcp-tools";

export function AgentronicsWebMcp() {
  const { asPath } = useRouter();
  const pathname = asPath.split(/[?#]/)[0] ?? "/";
  useEffect(() => {
    const controller = new AbortController();
    void connectAgentronics().then((sdk) => {
      if (!controller.signal.aborted) registerAgentronicsTools(pathname, controller.signal, sdk ?? undefined);
    });
    return () => controller.abort();
  }, [pathname]);
  return null;
}
`;

/** Insert `<AgentronicsWebMcp />` next to `{children}` (layout) or `<Component …/>` (_app). */
function mountEdits(path: string, text: string, importSpec: string, anchor: "children" | "Component"): Edit[] | null {
  const sf = parseSource(path, text);
  let found: ts.Node | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (anchor === "children" && ts.isJsxExpression(n) && n.expression && ts.isIdentifier(n.expression) && n.expression.text === "children") {
      found = n;
    } else if (anchor === "Component" && ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === "Component") {
      found = n;
    }
    n.forEachChild(visit);
  };
  visit(sf);
  const at = importInsertPos(text, path);
  // No imports yet: the import goes on the first line, then a blank line.
  const imp = { pos: at, insert: at === 0 ? `import { AgentronicsWebMcp } from "${importSpec}";\n\n` : `\nimport { AgentronicsWebMcp } from "${importSpec}";` };
  if (found) {
    const node = found as ts.Node;
    // `return <Component {...pageProps} />` has no JSX parent: wrap both in a fragment.
    if (!ts.isJsxElement(node.parent) && !ts.isJsxFragment(node.parent)) {
      return [imp, { pos: node.getStart(sf), insert: "<>\n      " }, { pos: node.getEnd(), insert: "\n      <AgentronicsWebMcp />\n    </>" }];
    }
    return [imp, { pos: node.getEnd(), insert: "\n        <AgentronicsWebMcp />" }];
  }
  const body = text.lastIndexOf("</body>");
  if (body === -1) return null;
  return [imp, { pos: body, insert: "\n        <AgentronicsWebMcp />" }];
}

export async function generateCode(opts: {
  reader: RepoReader;
  fw: Framework;
  digests: PageDigest[];
  tools: ToolProposal[];
  handlers: Record<string, Handler>;
  /** Also load the Agentronics SDK on every page, with this key. */
  sdk?: SdkInstall | null;
}): Promise<CodegenResult> {
  const { reader, fw, digests, tools, handlers } = opts;
  const sdk = opts.sdk ?? null;
  const result: CodegenResult = { changes: [], toolFiles: {}, manualSteps: [], skipped: [] };
  const edits = new Map<string, Edit[]>();
  const addEdit = (path: string, e: Edit[]) => edits.set(path, [...(edits.get(path) ?? []), ...e]);

  const forms = new Map(digests.flatMap((d) => d.forms.map((f) => [f.id, f] as const)));
  const buttons = new Map(digests.flatMap((d) => d.buttons.map((b) => [b.id, b] as const)));
  const actions = new Map(digests.flatMap((d) => d.serverActions.map((s) => [s.id, s] as const)));

  // 1) Anchors on the forms and controls that form / on-page tools act on.
  for (const t of tools) {
    if (t.strategy !== "form" && t.strategy !== "dom") continue;
    const target = forms.get(t.sourceId) ?? buttons.get(t.sourceId);
    if (!target) {
      result.skipped.push({ name: t.name, reason: "Source action not found" });
      continue;
    }
    const text = await reader.read(target.file);
    const insertAt = text === null ? null : afterTagName(text, target.pos);
    if (text === null || insertAt === null) {
      result.skipped.push({ name: t.name, reason: "Code changed under the scan" });
      continue;
    }
    const markup = isMarkup(target.file);
    // Re-run: the element already has an anchor — keep it, renamed if the tool's name changed.
    const prev = existingAnchor(text, target.pos);
    if (prev) {
      if (prev.value !== t.name) addEdit(target.file, [{ pos: prev.start, insert: t.name, remove: prev.end - prev.start }]);
      continue;
    }
    addEdit(target.file, [{ pos: insertAt, insert: markup ? markupAttrs({ "data-agent-tool": t.name }) : ` data-agent-tool=${JSON.stringify(t.name)}` }]);
  }

  // 2) Every tool → one module, plus a mount point (the SDK rides on the same module).
  const scriptTools = tools.filter((t) => !result.skipped.some((s) => s.name === t.name));
  if (scriptTools.length || sdk) {
    const dir = moduleDir(reader, fw);
    const ext = fw.typescript ? "ts" : "js";
    const modulePath = `${dir ? `${dir}/` : ""}${fw.kind === "static-html" ? "agentronics-webmcp" : "webmcp-tools"}.${fw.kind === "static-html" ? "js" : ext}`;

    const importLines: string[] = [];
    if (fw.kind !== "static-html") {
      const byFile = new Map<string, Set<string>>();
      for (const t of scriptTools) {
        if (t.strategy !== "server_action") continue;
        const sa = actions.get(t.sourceId);
        if (sa) byFile.set(sa.file, (byFile.get(sa.file) ?? new Set()).add(sa.name));
      }
      for (const [file, names] of byFile) importLines.push(`import { ${[...names].join(", ")} } from "${relImport(modulePath, file)}";`);
    }

    let source = toolsModule(
      scriptTools.filter((t) => fw.kind !== "static-html" || t.strategy !== "server_action"),
      handlers,
      importLines,
      { staticHtml: fw.kind === "static-html", sdk }
    );
    if (fw.kind === "static-html") source = `${toJs(source, "agentronics-webmcp.ts")}\nstartAgentronicsTools();\n`;
    else if (!fw.typescript) source = toJs(source, "webmcp-tools.ts");
    result.changes.push({ path: modulePath, content: source, before: null, reason: sdk ? "WebMCP tools and the Agentronics SDK" : "WebMCP tools module" });
    for (const t of scriptTools) result.toolFiles[t.name] = modulePath;
    if (sdk) result.sdkFiles = [modulePath];

    const mounted = await mount(reader, fw, dir, modulePath, scriptTools, addEdit, result, !!sdk);
    if (!mounted) {
      result.manualSteps.push(
        `Call \`startAgentronicsTools()\` from \`${modulePath}\` once when your app starts (we couldn't find a safe place to add it).`
      );
    }
  }

  // 3) Apply attribute/mount edits to existing files.
  for (const [path, list] of edits) {
    const before = await reader.read(path);
    if (before === null) continue;
    result.changes.push({ path, content: applyEdits(before, list), before, reason: "WebMCP attributes / mount" });
  }
  return result;
}

async function mount(
  reader: RepoReader,
  fw: Framework,
  dir: string,
  modulePath: string,
  scriptTools: ToolProposal[],
  addEdit: (path: string, e: Edit[]) => void,
  result: CodegenResult,
  everyPage = false
): Promise<boolean> {
  const tsx = fw.typescript ? "tsx" : "jsx";
  if (fw.kind === "next-app" && fw.appDir) {
    const layout = [".tsx", ".jsx", ".js"].map((e) => `${fw.appDir}/layout${e}`).find((p) => reader.has(p));
    if (!layout) return false;
    const mountPath = `${dir}/AgentronicsWebMcp.${tsx}`;
    const text = await reader.read(layout);
    // Mounted by an earlier run: refresh the component, leave the layout alone.
    const already = text?.includes("<AgentronicsWebMcp") ?? false;
    const e = text === null || already ? null : mountEdits(layout, text, relImport(layout, mountPath), "children");
    if (!e && !already) return false;
    result.changes.push({ path: mountPath, content: fw.typescript ? NEXT_APP_MOUNT : toJs(NEXT_APP_MOUNT, "m.tsx"), before: null, reason: "Registers tools per route" });
    if (e) addEdit(layout, e);
    return true;
  }
  if (fw.kind === "next-pages" && fw.pagesDir) {
    const mountPath = `${dir}/AgentronicsWebMcp.${tsx}`;
    const app = [".tsx", ".jsx", ".js"].map((e) => `${fw.pagesDir}/_app${e}`).find((p) => reader.has(p));
    result.changes.push({ path: mountPath, content: fw.typescript ? NEXT_PAGES_MOUNT : toJs(NEXT_PAGES_MOUNT, "m.tsx"), before: null, reason: "Registers tools per route" });
    if (app) {
      const text = await reader.read(app);
      if (text?.includes("<AgentronicsWebMcp")) return true;
      const e = text === null ? null : mountEdits(app, text, relImport(app, mountPath), "Component");
      if (!e) return false;
      addEdit(app, e);
    } else {
      const path = `${fw.pagesDir}/_app.${tsx}`;
      const content = `${fw.typescript ? `import type { AppProps } from "next/app";\n` : ""}import { AgentronicsWebMcp } from "${relImport(path, mountPath)}";

export default function App({ Component, pageProps }${fw.typescript ? ": AppProps" : ""}) {
  return (
    <>
      <Component {...pageProps} />
      <AgentronicsWebMcp />
    </>
  );
}
`;
      result.changes.push({ path, content, before: null, reason: "Custom App to mount the tools" });
    }
    return true;
  }
  if (fw.kind === "react-spa" && fw.entry) {
    const text = await reader.read(fw.entry);
    if (text === null) return false;
    if (text.includes("startAgentronicsTools(")) return true;
    addEdit(fw.entry, [
      { pos: importInsertPos(text, fw.entry), insert: `\nimport { startAgentronicsTools } from "${relImport(fw.entry, modulePath)}";` },
      { pos: text.length, insert: `${text.endsWith("\n") ? "" : "\n"}\n// Agentronics Agent Nic: expose this app's WebMCP tools.\nstartAgentronicsTools();\n` }
    ]);
    return true;
  }
  if (fw.kind === "static-html") {
    const pages = new Set(scriptTools.map((t) => t.page));
    const htmlFiles = reader
      .list(/\.html?$/i)
      .filter((f) => {
        const route = `/${f.slice(fw.root ? fw.root.length + 1 : 0).replace(/\.html?$/i, "").replace(/(^|\/)index$/, "")}`.replace(/\/+$/, "") || "/";
        // The SDK goes on every page; tools only on the pages they belong to.
        return everyPage || pages.has("*") || pages.has(route);
      });
    let any = false;
    for (const file of htmlFiles) {
      const text = await reader.read(file);
      const at = text?.lastIndexOf("</body>") ?? -1;
      if (text === null || at === -1) continue;
      const src = `${relImport(file, modulePath)}.js`;
      any = true;
      if (text.includes(`src="${src}"`)) continue; // added by an earlier run
      addEdit(file, [{ pos: at, insert: `  <script type="module" src="${src}"></script>\n` }]);
    }
    return any;
  }
  return false;
}
