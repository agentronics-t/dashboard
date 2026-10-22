// Code generation. Almost all of it is deterministic: declarative attributes
// on existing <form> tags, a data-agent-tool anchor for UI actions, one tools
// module, and a mount point per framework. The model only writes the body of
// tools that call an API or a server action (see handlers.ts).

import ts from "typescript";
import { CONTROL_TAG, parseSource } from "./extract.ts";
import type { RepoReader } from "./repo.ts";
import type { FileChange, Framework, PageDigest, ToolProposal } from "./types.ts";

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
}

interface Edit {
  pos: number;
  insert: string;
}

const applyEdits = (text: string, edits: Edit[]) =>
  [...edits].sort((a, b) => b.pos - a.pos).reduce((t, e) => t.slice(0, e.pos) + e.insert + t.slice(e.pos), text);

const isMarkup = (p: string) => /\.html?$/i.test(p);
const htmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** `<tag` attribute insertion point (right after the tag name) when `pos` still points at `<tag`. */
function afterTagName(text: string, pos: number): number | null {
  const m = /^<([A-Za-z][\w.:-]*)/.exec(text.slice(pos, pos + 80));
  return m ? pos + m[0].length : null;
}

/** JSX can't type unknown DOM attributes, so they go in as a spread (no excess-property check). */
function jsxAttrs(attrs: Record<string, string>): string {
  const body = Object.entries(attrs)
    .map(([k, v]) => `${/^[a-z]+$/.test(k) ? k : JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ");
  return ` {...{ ${body} }}`;
}

function markupAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => (v === "" ? ` ${k}` : ` ${k}="${htmlAttr(v)}"`))
    .join("");
}

function relImport(fromFile: string, toFile: string): string {
  const from = fromFile.split("/").slice(0, -1);
  const to = toFile.replace(/\.(tsx?|jsx?|mjs)$/, "").split("/");
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const rel = [...from.slice(i).map(() => ".."), ...to.slice(i)].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Position right after the last import (or the "use client" directive, or 0). */
function importInsertPos(text: string, path: string): number {
  const sf = parseSource(path, text);
  let pos = 0;
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) pos = s.getEnd();
    else if (ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && pos === 0) pos = s.getEnd();
    else break;
  }
  return pos;
}

function findJsxAt(sf: ts.SourceFile, pos: number): ts.JsxElement | ts.JsxSelfClosingElement | null {
  let hit: ts.JsxElement | ts.JsxSelfClosingElement | null = null;
  const visit = (n: ts.Node) => {
    if (hit) return;
    if ((ts.isJsxElement(n) && n.openingElement.getStart(sf) === pos) || (ts.isJsxSelfClosingElement(n) && n.getStart(sf) === pos)) {
      hit = n as ts.JsxElement | ts.JsxSelfClosingElement;
      return;
    }
    if (n.getStart(sf) <= pos && pos < n.getEnd()) n.forEachChild(visit);
  };
  visit(sf);
  return hit;
}

/** Edits that put `toolparamdescription` on named controls inside the form at `formPos`. */
function fieldDescriptionEdits(path: string, text: string, formPos: number, descriptions: Record<string, string>): Edit[] {
  const edits: Edit[] = [];
  if (isMarkup(path)) {
    const end = text.indexOf("</form>", formPos);
    const body = text.slice(formPos, end === -1 ? undefined : end);
    for (const m of body.matchAll(/<(input|select|textarea)\b[^>]*\bname\s*=\s*["']([^"']+)["']/gi)) {
      const d = m[2] ? descriptions[m[2]] : undefined;
      if (d && m.index !== undefined) edits.push({ pos: formPos + m.index + 1 + (m[1]?.length ?? 0), insert: markupAttrs({ toolparamdescription: d }) });
    }
    return edits;
  }
  const sf = parseSource(path, text);
  const form = findJsxAt(sf, formPos);
  if (!form) return edits;
  const visit = (n: ts.Node) => {
    const o = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
    if (o && CONTROL_TAG.test(o.tagName.getText(sf))) {
      const nameAttr = o.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "name");
      const init = nameAttr?.initializer;
      const name = init && ts.isStringLiteral(init) ? init.text : null;
      const d = name ? descriptions[name] : undefined;
      if (d) edits.push({ pos: o.tagName.getEnd(), insert: jsxAttrs({ toolparamdescription: d }) });
    }
    n.forEachChild(visit);
  };
  form.forEachChild(visit);
  return edits;
}

/** Where generated files go: <app root>/src/agentronics or <app root>/agentronics. */
function moduleDir(reader: RepoReader, fw: Framework): string {
  const base = fw.root ? `${fw.root}/` : "";
  if (fw.kind === "static-html") return fw.root;
  const hasSrc = reader.list(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}src/`)).length > 0;
  return `${base}${hasSrc ? "src/" : ""}agentronics`;
}

const routeRegex = (route: string) =>
  route === "*"
    ? ".*"
    : `^${route
        .split("/")
        .map((seg) =>
          /^\[\[?\.\.\./.test(seg) ? ".*" : /^\[.+\]$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        )
        .join("/")}/?$`;

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

function toolLiteral(t: ToolProposal, execute: string): string {
  const annotations = [`readOnlyHint: ${t.readOnly}`, ...(t.consequential ? ["consequentialHint: true"] : [])].join(", ");
  return `  {
    pages: ${JSON.stringify([routeRegex(t.page)])},
    tool: {
      name: ${JSON.stringify(t.name)},
      description: ${JSON.stringify(t.description)},
      inputSchema: ${JSON.stringify(t.inputSchema, null, 2).replace(/\n/g, "\n      ")},
      async execute(input: ToolInput, options?: { signal?: AbortSignal }): Promise<unknown> {
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

/** The tools module (TypeScript source; transpiled for JavaScript projects). */
export function toolsModule(tools: ToolProposal[], handlers: Record<string, Handler>, imports: string[]): string {
  const entries = tools.map((t) =>
    toolLiteral(
      t,
      t.strategy === "dom"
        ? `return fillAndAct(${JSON.stringify(t.name)}, ${JSON.stringify(t.page === "*" ? "this site" : t.page)}, input, signal);`
        : (handlers[t.name]?.body ?? `return { error: "Not available." };`)
    )
  );
  const needsDom = tools.some((t) => t.strategy === "dom");
  return `// WebMCP tools for this site — generated by Agentronics Agent Nick.
// Each tool is registered only on the pages it belongs to and unregistered
// (via AbortSignal) when the visitor navigates away. Browsers without WebMCP
// skip all of this. Spec: https://webmachinelearning.github.io/webmcp/
${imports.join("\n")}

type ToolInput = Record<string, unknown>;

interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: object;
  execute(input: ToolInput, options?: { signal?: AbortSignal }): Promise<unknown> | unknown;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean };
}

interface ModelContextLike {
  registerTool(tool: ModelContextTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

function modelContext(): ModelContextLike | null {
  if (typeof document === "undefined" || !("modelContext" in document)) return null;
  return (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? null;
}
${needsDom ? DOM_HELPER : ""}
const TOOLS: { pages: string[]; tool: ModelContextTool }[] = [
${entries.join(",\n")}
];

/** Register the tools that belong to \`pathname\`; abort \`signal\` to unregister them. */
export function registerAgentronicsTools(pathname: string, signal: AbortSignal): void {
  const mc = modelContext();
  if (!mc) return;
  for (const { pages, tool } of TOOLS) {
    if (!pages.some((p) => new RegExp(p).test(pathname))) continue;
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
    registerAgentronicsTools(window.location.pathname, controller.signal);
  };
  sync();
  window.addEventListener("popstate", sync);
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener("navigatesuccess", sync);
}
`;
}

function toJs(source: string, fileName: string): string {
  return ts.transpileModule(source, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve }
  }).outputText;
}

const NEXT_APP_MOUNT = `"use client";

// Registers this site's WebMCP tools for the current route — added by Agentronics Agent Nick.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { registerAgentronicsTools } from "./webmcp-tools";

export function AgentronicsWebMcp() {
  const pathname = usePathname();
  useEffect(() => {
    const controller = new AbortController();
    registerAgentronicsTools(pathname, controller.signal);
    return () => controller.abort();
  }, [pathname]);
  return null;
}
`;

const NEXT_PAGES_MOUNT = `// Registers this site's WebMCP tools for the current route — added by Agentronics Agent Nick.
import { useEffect } from "react";
import { useRouter } from "next/router";
import { registerAgentronicsTools } from "./webmcp-tools";

export function AgentronicsWebMcp() {
  const { asPath } = useRouter();
  const pathname = asPath.split(/[?#]/)[0] ?? "/";
  useEffect(() => {
    const controller = new AbortController();
    registerAgentronicsTools(pathname, controller.signal);
    return () => controller.abort();
  }, [pathname]);
  return null;
}
`;

/** Insert `<AgentronicsWebMcp />` next to `{children}` (layout) or `<Component …/>` (_app). */
function mountEdits(path: string, text: string, importSpec: string, anchor: "children" | "Component"): Edit[] | null {
  const sf = parseSource(path, text);
  let at: number | null = null;
  const visit = (n: ts.Node) => {
    if (at !== null) return;
    if (anchor === "children" && ts.isJsxExpression(n) && n.expression && ts.isIdentifier(n.expression) && n.expression.text === "children") {
      at = n.getEnd();
    } else if (anchor === "Component" && ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === "Component") {
      at = n.getEnd();
    }
    n.forEachChild(visit);
  };
  visit(sf);
  if (at === null) {
    const body = text.lastIndexOf("</body>");
    if (body === -1) return null;
    at = body;
  }
  return [
    { pos: importInsertPos(text, path), insert: `\nimport { AgentronicsWebMcp } from "${importSpec}";` },
    { pos: at, insert: "\n        <AgentronicsWebMcp />" }
  ];
}

export async function generateCode(opts: {
  reader: RepoReader;
  fw: Framework;
  digests: PageDigest[];
  tools: ToolProposal[];
  handlers: Record<string, Handler>;
}): Promise<CodegenResult> {
  const { reader, fw, digests, tools, handlers } = opts;
  const result: CodegenResult = { changes: [], toolFiles: {}, manualSteps: [], skipped: [] };
  const edits = new Map<string, Edit[]>();
  const addEdit = (path: string, e: Edit[]) => edits.set(path, [...(edits.get(path) ?? []), ...e]);

  const forms = new Map(digests.flatMap((d) => d.forms.map((f) => [f.id, f] as const)));
  const buttons = new Map(digests.flatMap((d) => d.buttons.map((b) => [b.id, b] as const)));
  const actions = new Map(digests.flatMap((d) => d.serverActions.map((s) => [s.id, s] as const)));

  // 1) Declarative form tools and UI anchors: attribute edits on existing files.
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
    if (t.strategy === "form") {
      const attrs: Record<string, string> = { toolname: t.name, tooldescription: t.description };
      if (t.readOnly) attrs.toolautosubmit = "";
      addEdit(target.file, [{ pos: insertAt, insert: markup ? markupAttrs(attrs) : jsxAttrs(attrs) }]);
      if (t.fieldDescriptions) addEdit(target.file, fieldDescriptionEdits(target.file, text, target.pos, t.fieldDescriptions));
    } else {
      addEdit(target.file, [{ pos: insertAt, insert: markup ? markupAttrs({ "data-agent-tool": t.name }) : ` data-agent-tool=${JSON.stringify(t.name)}` }]);
    }
    result.toolFiles[t.name] = target.file;
  }

  // 2) Script tools → one module, plus a mount point.
  const scriptTools = tools.filter((t) => t.kind === "script" && !result.skipped.some((s) => s.name === t.name));
  if (scriptTools.length) {
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
      importLines
    );
    if (fw.kind === "static-html") source = `${toJs(source, "agentronics-webmcp.ts")}\nstartAgentronicsTools();\n`;
    else if (!fw.typescript) source = toJs(source, "webmcp-tools.ts");
    result.changes.push({ path: modulePath, content: source, before: null, reason: "WebMCP tools module" });
    for (const t of scriptTools) result.toolFiles[t.name] = modulePath;

    const mounted = await mount(reader, fw, dir, modulePath, scriptTools, addEdit, result);
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
  result: CodegenResult
): Promise<boolean> {
  const tsx = fw.typescript ? "tsx" : "jsx";
  if (fw.kind === "next-app" && fw.appDir) {
    const layout = [".tsx", ".jsx", ".js"].map((e) => `${fw.appDir}/layout${e}`).find((p) => reader.has(p));
    if (!layout) return false;
    const mountPath = `${dir}/AgentronicsWebMcp.${tsx}`;
    const text = await reader.read(layout);
    const e = text === null ? null : mountEdits(layout, text, relImport(layout, mountPath), "children");
    if (!e) return false;
    result.changes.push({ path: mountPath, content: fw.typescript ? NEXT_APP_MOUNT : toJs(NEXT_APP_MOUNT, "m.tsx"), before: null, reason: "Registers tools per route" });
    addEdit(layout, e);
    return true;
  }
  if (fw.kind === "next-pages" && fw.pagesDir) {
    const mountPath = `${dir}/AgentronicsWebMcp.${tsx}`;
    const app = [".tsx", ".jsx", ".js"].map((e) => `${fw.pagesDir}/_app${e}`).find((p) => reader.has(p));
    result.changes.push({ path: mountPath, content: fw.typescript ? NEXT_PAGES_MOUNT : toJs(NEXT_PAGES_MOUNT, "m.tsx"), before: null, reason: "Registers tools per route" });
    if (app) {
      const text = await reader.read(app);
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
    addEdit(fw.entry, [
      { pos: importInsertPos(text, fw.entry), insert: `\nimport { startAgentronicsTools } from "${relImport(fw.entry, modulePath)}";` },
      { pos: text.length, insert: `${text.endsWith("\n") ? "" : "\n"}\n// Agentronics Agent Nick: expose this app's WebMCP tools.\nstartAgentronicsTools();\n` }
    ]);
    return true;
  }
  if (fw.kind === "static-html") {
    const pages = new Set(scriptTools.map((t) => t.page));
    const htmlFiles = reader
      .list(/\.html?$/i)
      .filter((f) => {
        const route = `/${f.slice(fw.root ? fw.root.length + 1 : 0).replace(/\.html?$/i, "").replace(/(^|\/)index$/, "")}`.replace(/\/+$/, "") || "/";
        return pages.has("*") || pages.has(route);
      });
    let any = false;
    for (const file of htmlFiles) {
      const text = await reader.read(file);
      const at = text?.lastIndexOf("</body>") ?? -1;
      if (text === null || at === -1) continue;
      addEdit(file, [{ pos: at, insert: `  <script type="module" src="${relImport(file, modulePath)}.js"></script>\n` }]);
      any = true;
    }
    return any;
  }
  return false;
}
