// Action extraction — the TypeScript parser, not a model. Each page becomes a
// compact digest (forms, buttons, API calls, server actions) of a few hundred
// tokens, which is all the model ever sees of the codebase.

import ts from "typescript";
import { resolveImport, type RepoReader } from "./repo.ts";
import type {
  ApiCall,
  ButtonAction,
  FormAction,
  FormField,
  Framework,
  PageDigest,
  PageInfo,
  ServerAction
} from "./types.ts";

const MAX_IMPORTS_PER_PAGE = 8;
const MAX_BUTTONS_PER_FILE = 12;
const MAX_CALLS_PER_FILE = 10;

interface FileActions {
  title: string | null;
  forms: Omit<FormAction, "id">[];
  buttons: Omit<ButtonAction, "id">[];
  calls: Omit<ApiCall, "id">[];
  serverActions: Omit<ServerAction, "id">[];
  imports: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function scriptKind(path: string): ts.ScriptKind {
  if (path.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (path.endsWith(".ts")) return ts.ScriptKind.TS;
  if (path.endsWith(".jsx")) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JSX; // .js/.mjs often contain JSX in React projects
}

export function parseSource(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
}

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

const tagName = (el: JsxTag) => el.tagName.getText();

function attr(el: JsxTag, name: string): ts.JsxAttribute | undefined {
  return el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name
  );
}

/** Literal attribute value, `{expr}` text, "" for bare attributes, null when absent. */
function attrValue(el: JsxTag, name: string): string | null {
  const a = attr(el, name);
  if (!a) return null;
  const init = a.initializer;
  if (!init) return "";
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const e = init.expression;
    return ts.isStringLiteralLike(e) ? e.text : e.getText();
  }
  return init.getText();
}

/** A literal attribute value; null when the attribute is absent, undefined when it's computed. */
function literalAttr(el: JsxTag, name: string): string | null | undefined {
  const a = attr(el, name);
  if (!a) return null;
  const init = a.initializer;
  if (!init) return "";
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) return init.expression.text;
  return undefined;
}

function jsxText(node: ts.Node): string {
  const parts: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxText(n)) parts.push(n.getText());
    else if (ts.isJsxExpression(n) && n.expression && ts.isStringLiteralLike(n.expression)) parts.push(n.expression.text);
    n.forEachChild(visit);
  };
  visit(node);
  return squash(parts.join(" "));
}

// Native controls plus the component names UI kits (shadcn, MUI, Chakra…) give them.
export const CONTROL_TAG = /^(input|select|textarea|Input|Textarea|TextArea|Select|NativeSelect|Checkbox|Switch)$/;
const LABEL_TAG = /^(label|Label|FormLabel)$/;

const openingOf = (n: ts.Node): JsxTag | null =>
  ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;

function enclosingFunctionText(node: ts.Node, sf: ts.SourceFile): string {
  let n: ts.Node | undefined = node;
  while (n && !ts.isFunctionLike(n)) n = n.parent;
  const text = (n ?? node).getText(sf);
  return text.split("\n").slice(0, 40).join("\n");
}

export function extractFromSource(path: string, text: string): FileActions {
  const sf = parseSource(path, text);
  const out: FileActions = { title: null, forms: [], buttons: [], calls: [], serverActions: [], imports: [] };
  const labelsFor = new Map<string, string>();

  // "use server" modules: every exported async function is a callable action.
  const useServer = sf.statements.some(
    (s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use server"
  );

  const visit = (node: ts.Node, insideForm: boolean) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly) {
      out.imports.push(node.moduleSpecifier.text);
    }

    if (useServer && ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      out.serverActions.push({ file: path, name: node.name.text, params: clip(squash(node.parameters.map((p) => p.getText(sf)).join(", ")), 160) });
    }

    if (ts.isCallExpression(node) && out.calls.length < MAX_CALLS_PER_FILE) {
      const callee = node.expression.getText(sf);
      const m = /^(fetch|\$fetch|ky|axios|api|client|http)(?:\.(get|post|put|patch|delete|request))?$/.exec(callee);
      const first = node.arguments[0];
      if (m && first && (callee === "fetch" || callee === "$fetch" || m[2])) {
        let method = (m[2] ?? "GET").toUpperCase();
        const opts = node.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const p of opts.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "method") {
              method = p.initializer.getText(sf).replace(/['"`]/g, "").toUpperCase();
            }
          }
        }
        const url = ts.isStringLiteralLike(first) ? first.text : first.getText(sf);
        out.calls.push({ file: path, method, url: clip(url, 150), snippet: enclosingFunctionText(node, sf) });
      }
    }

    const el = openingOf(node);
    if (el) {
      const name = tagName(el);
      if (LABEL_TAG.test(name)) {
        const forId = attrValue(el, "htmlFor");
        if (forId) labelsFor.set(forId, jsxText(node));
      }
      if (name === "h1" && !out.title) out.title = clip(jsxText(node), 80) || null;
      if (name === "form") {
        out.forms.push(readForm(node, el, path, sf));
        node.forEachChild((c) => visit(c, true));
        return;
      }
      if (!insideForm && /^(button|Button|a)$/.test(name) && out.buttons.length < MAX_BUTTONS_PER_FILE) {
        const handler = attrValue(el, "onClick");
        if (handler) {
          out.buttons.push({ file: path, pos: el.getStart(sf), text: clip(jsxText(node), 60), handler: clip(squash(handler), 140) });
        }
      }
    }
    node.forEachChild((c) => visit(c, insideForm));
  };
  visit(sf, false);

  // Labels are often declared after the inputs they describe.
  for (const form of out.forms) {
    for (const f of form.fields) {
      const id = (f as FormField & { _id?: string })._id;
      if (!f.label && id && labelsFor.has(id)) f.label = labelsFor.get(id) ?? null;
      delete (f as FormField & { _id?: string })._id;
    }
  }
  return out;
}

function readForm(node: ts.Node, el: JsxTag, path: string, sf: ts.SourceFile): Omit<FormAction, "id"> {
  const fields: (FormField & { _id?: string; controlled?: boolean })[] = [];
  let submitText: string | null = null;

  const walk = (n: ts.Node, labelText: string | null) => {
    const o = openingOf(n);
    let label = labelText;
    if (o) {
      const t = tagName(o);
      if (LABEL_TAG.test(t)) label = jsxText(n);
      if (CONTROL_TAG.test(t)) {
        const lower = t.toLowerCase();
        const type = /^(input|checkbox|switch)$/.test(lower)
          ? (attrValue(o, "type") ?? (lower === "input" ? "text" : "checkbox"))
          : lower.includes("select")
            ? "select"
            : "textarea";
        if (!["submit", "button", "reset", "hidden", "image"].includes(type)) {
          let options: string[] = [];
          if (type === "select") {
            // Only literal values make an enum. Options rendered from data
            // (<option value={c.slug}>) would turn into the text "c.slug", so a
            // select with any of those gets no enum at all. Empty values ("All")
            // just mean "leave it out".
            let dynamic = false;
            n.forEachChild(function opt(c) {
              const oo = openingOf(c);
              if (oo && tagName(oo) === "option") {
                const v = literalAttr(oo, "value");
                if (v === undefined) dynamic = true;
                else options.push(v ?? jsxText(c).trim());
              }
              if (ts.isJsxExpression(c) && c.expression && /<option\b/.test(c.getText())) dynamic = true; // {items.map(i => <option …>)}
              c.forEachChild(opt);
            });
            options = dynamic ? [] : options.filter((v) => v !== "");
          }
          const id = attrValue(o, "id");
          fields.push({
            name: attrValue(o, "name"),
            type,
            label: label ?? attrValue(o, "aria-label") ?? attrValue(o, "placeholder"),
            required: attrValue(o, "required") !== null,
            ...(options.length ? { options: options.slice(0, 20) } : {}),
            ...(id ? { _id: id } : {}),
            controlled: attrValue(o, "value") !== null && attrValue(o, "onChange") !== null
          });
        } else if (type === "submit") {
          submitText = attrValue(o, "value") ?? submitText;
        }
      }
      if ((t === "button" || t === "Button") && !submitText && attrValue(o, "type") !== "button") {
        submitText = clip(jsxText(n), 40) || null;
      }
    }
    n.forEachChild((c) => walk(c, label));
  };
  node.forEachChild((c) => walk(c, null));

  const action = attrValue(el, "action");
  const named = fields.length > 0 && fields.every((f) => f.name);
  const controlled = fields.some((f) => f.controlled);
  return {
    file: path,
    pos: el.getStart(sf),
    action: action === null ? null : clip(action, 120),
    method: attrValue(el, "method"),
    onSubmit: (() => {
      const h = attrValue(el, "onSubmit");
      return h === null ? null : clip(squash(h), 140);
    })(),
    fields: fields.map(({ controlled: _c, ...f }) => f),
    submitText,
    declarativeReady: named && (action !== null || !controlled),
    alreadyTool: attrValue(el, "toolname") !== null
  };
}

/** Very small HTML reader for static sites (forms + inline onclick buttons). */
export function extractFromHtml(path: string, html: string): FileActions {
  const out: FileActions = { title: null, forms: [], buttons: [], calls: [], serverActions: [], imports: [] };
  const attrs = (tag: string) => {
    const map: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g)) {
      const key = m[1];
      if (key) map[key.toLowerCase()] = m[3] ?? m[4] ?? (m[2] ?? "").replace(/^['"]|['"]$/g, "");
    }
    return map;
  };
  const strip = (s: string) => squash(s.replace(/<[^>]+>/g, " "));
  out.title = (() => {
    const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html) ?? /<title>([\s\S]*?)<\/title>/i.exec(html);
    return m?.[1] ? clip(strip(m[1]), 80) : null;
  })();
  const labels = new Map<string, string>();
  for (const m of html.matchAll(/<label([^>]*)>([\s\S]*?)<\/label>/gi)) {
    const a = attrs(m[1] ?? "");
    if (a.for) labels.set(a.for, strip(m[2] ?? ""));
  }
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const a = attrs(m[1] ?? "");
    const body = m[2] ?? "";
    const fields: FormField[] = [];
    for (const f of body.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const fa = attrs(f[2] ?? "");
      const type = f[1]?.toLowerCase() === "input" ? (fa.type ?? "text") : (f[1] ?? "text").toLowerCase();
      if (["submit", "button", "reset", "hidden", "image"].includes(type)) continue;
      fields.push({
        name: fa.name ?? null,
        type,
        label: (fa.id && labels.get(fa.id)) || fa["aria-label"] || fa.placeholder || null,
        required: "required" in fa
      });
    }
    const submit = /<button[^>]*>([\s\S]*?)<\/button>/i.exec(body);
    out.forms.push({
      file: path,
      pos: m.index ?? 0,
      action: a.action ?? null,
      method: a.method ?? null,
      onSubmit: a.onsubmit ?? null,
      fields,
      submitText: submit?.[1] ? clip(strip(submit[1]), 40) : null,
      declarativeReady: fields.length > 0 && fields.every((f) => f.name),
      alreadyTool: "toolname" in a
    });
  }
  for (const m of html.matchAll(/<button\b([^>]*\bonclick\s*=[^>]*)>([\s\S]*?)<\/button>/gi)) {
    if (out.buttons.length >= MAX_BUTTONS_PER_FILE) break;
    out.buttons.push({ file: path, pos: m.index ?? 0, text: clip(strip(m[2] ?? ""), 60), handler: clip(attrs(m[1] ?? "").onclick ?? "", 140) });
  }
  return out;
}

const isMarkup = (p: string) => /\.html?$/i.test(p);

/**
 * Digest every page. Files imported by more than one page (headers, search
 * bars, cart drawers) are reported once, under the "*" (site-wide) digest.
 */
export async function digestPages(reader: RepoReader, fw: Framework, pages: PageInfo[]): Promise<PageDigest[]> {
  const parsed = new Map<string, FileActions>();
  const parse = async (path: string): Promise<FileActions | null> => {
    if (parsed.has(path)) return parsed.get(path) ?? null;
    const text = await reader.read(path);
    if (text === null) return null;
    let fa: FileActions;
    try {
      fa = isMarkup(path) ? extractFromHtml(path, text) : extractFromSource(path, text);
    } catch {
      return null;
    }
    parsed.set(path, fa);
    return fa;
  };

  // Each page's file plus the local components it imports (one level deep).
  await reader.readMany(pages.map((p) => p.file));
  const pageFiles = new Map<string, string[]>();
  for (const page of pages) {
    const fa = await parse(page.file);
    const local = (fa?.imports ?? [])
      .map((spec) => resolveImport(reader, page.file, spec, fw.aliases))
      .filter((p): p is string => !!p && /\.(tsx|jsx|js)$/.test(p))
      .slice(0, MAX_IMPORTS_PER_PAGE);
    pageFiles.set(page.route, [page.file, ...local]);
  }
  await reader.readMany([...pageFiles.values()].flat());

  // Layout-level components (and anything shared by 2+ pages) are site-wide.
  const globalFiles = new Set<string>(await layoutImports(reader, fw, parse));
  const usage = new Map<string, number>();
  for (const files of pageFiles.values()) for (const f of files.slice(1)) usage.set(f, (usage.get(f) ?? 0) + 1);
  for (const [f, n] of usage) if (n > 1) globalFiles.add(f);

  const counters = { f: 0, b: 0, c: 0, s: 0 };
  const build = async (route: string, files: string[], title: string | null): Promise<PageDigest> => {
    const d: PageDigest = { route, files, title, forms: [], buttons: [], calls: [], serverActions: [] };
    for (const file of files) {
      const fa = await parse(file);
      if (!fa) continue;
      d.title ??= fa.title;
      d.forms.push(...fa.forms.filter((f) => !f.alreadyTool).map((f) => ({ ...f, id: `f${++counters.f}` })));
      d.buttons.push(...fa.buttons.map((b) => ({ ...b, id: `b${++counters.b}` })));
      d.calls.push(...fa.calls.map((c) => ({ ...c, id: `c${++counters.c}` })));
      // Server actions are pulled in through imports below, not by being on the page.
      for (const spec of fa.imports) {
        const target = resolveImport(reader, file, spec, fw.aliases);
        if (!target || target === file) continue;
        const ta = await parse(target);
        for (const sa of ta?.serverActions ?? []) {
          if (!d.serverActions.some((x) => x.file === sa.file && x.name === sa.name)) {
            d.serverActions.push({ ...sa, id: `s${++counters.s}` });
          }
        }
      }
    }
    return d;
  };

  const digests: PageDigest[] = [];
  if (globalFiles.size) digests.push(await build("*", [...globalFiles], null));
  for (const page of pages) {
    const files = (pageFiles.get(page.route) ?? [page.file]).filter((f, i) => i === 0 || !globalFiles.has(f));
    digests.push(await build(page.route, files, null));
  }
  return digests.filter((d) => d.forms.length || d.buttons.length || d.calls.length || d.serverActions.length);
}

async function layoutImports(
  reader: RepoReader,
  fw: Framework,
  parse: (p: string) => Promise<FileActions | null>
): Promise<string[]> {
  const shells: string[] = [];
  if (fw.kind === "next-app" && fw.appDir) shells.push(...[".tsx", ".jsx", ".js"].map((e) => `${fw.appDir}/layout${e}`));
  if (fw.kind === "next-pages" && fw.pagesDir) shells.push(...[".tsx", ".jsx", ".js"].map((e) => `${fw.pagesDir}/_app${e}`));
  if (fw.kind === "react-spa") shells.push(...["App.tsx", "App.jsx"].map((f) => `${fw.root ? `${fw.root}/` : ""}src/${f}`));
  const shell = shells.find((s) => reader.has(s));
  if (!shell) return [];
  const fa = await parse(shell);
  const out = (fa?.imports ?? [])
    .map((spec) => resolveImport(reader, shell, spec, fw.aliases))
    .filter((p): p is string => !!p && /\.(tsx|jsx)$/.test(p));
  await reader.readMany(out);
  return out;
}

/** Counts for the run summary. */
export function countActions(digests: PageDigest[]): number {
  return digests.reduce((n, d) => n + d.forms.length + d.buttons.length + d.calls.length + d.serverActions.length, 0);
}
