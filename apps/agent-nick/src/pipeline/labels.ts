// Labels for icon-only buttons and links, and for form fields with no label —
// the Agent Readiness checks "Buttons and links have labels" and "Form fields
// have labels". Agents (and screen readers) read the accessible name; an icon
// or a placeholder isn't one.
//
// `findLabelTargets` runs before the review on the repo's files. Field labels
// come from the placeholder or the field name; button and link labels from
// Gemini, which sees the surrounding code, with a guess from the href, class
// names or icon as the fallback. `applyLabels` runs at write time on the
// current text (other steps may have edited the file), re-finding each element
// by a key that ignores Agent Nic's own attributes.

import ts from "typescript";
import type { Llm } from "../llm/gemini.ts";
import { parseSource } from "./extract.ts";

export interface LabelTarget {
  file: string;
  /** Identifies the element across edits: tag, attributes (minus data-agent-tool) and text. */
  key: string;
  kind: "control" | "field";
  tag: string;
  /** Opening tag (or a little code around it), for the review and for Gemini. */
  snippet: string;
  label: string;
}

interface Found {
  pos: number;
  key: string;
  kind: "control" | "field";
  tag: string;
  snippet: string;
  guess: string | null;
}

const isMarkup = (p: string) => /\.html?$/i.test(p);
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const withoutOurs = (attrs: string) => squash(attrs.replace(/(^|\s)(data-agent-tool|aria-label)=(\{[^}]*\}|"[^"]*"|'[^']*')/g, "$1"));
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function humanize(s: string): string {
  const words = s
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[_\-.\s/]+/)
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

const BRANDS: Record<string, string> = {
  instagram: "Instagram",
  youtube: "YouTube",
  youtu: "YouTube",
  whatsapp: "WhatsApp",
  wa: "WhatsApp",
  facebook: "Facebook",
  twitter: "X (Twitter)",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  github: "GitHub",
  tiktok: "TikTok",
  pinterest: "Pinterest",
  discord: "Discord",
  telegram: "Telegram",
  t: "Telegram",
  threads: "Threads",
  medium: "Medium",
  reddit: "Reddit"
};

const WORDS: [RegExp, string][] = [
  [/\b(menu|hamburger|burger|nav-?toggle|navbar-toggler)\b/i, "Open menu"],
  [/\bclose|dismiss\b/i, "Close"],
  [/\bsearch\b/i, "Search"],
  [/\b(cart|basket|bag)\b/i, "Cart"],
  [/\b(account|user|profile|avatar)\b/i, "Account"],
  [/\b(theme|dark-?mode)\b/i, "Switch theme"],
  [/\b(prev|previous|back)\b/i, "Previous"],
  [/\bnext\b/i, "Next"],
  [/\b(play)\b/i, "Play"],
  [/\b(share)\b/i, "Share"],
  [/\b(wishlist|favou?rite|heart)\b/i, "Add to wishlist"],
  [/\b(newsletter|subscribe)\b/i, "Subscribe"]
];

/** A label from what the element links to, its classes, or the icon it shows. */
export function guessControlLabel(tag: string, attrs: string, inner: string, around: string): string | null {
  const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]([^"'`]*)["'`]\s*\})/.exec(attrs);
  const target = href?.[1] ?? href?.[2] ?? href?.[3] ?? null;
  if (target) {
    if (/^tel:/i.test(target)) return "Call us";
    if (/^mailto:/i.test(target)) return "Email us";
    const ext = /^https?:\/\/(?:www\.)?([^/]+)/i.exec(target);
    if (ext) {
      const host = ext[1]!.toLowerCase();
      const name = host.split(".").slice(-2, -1)[0] ?? host;
      return BRANDS[name] ?? humanize(name);
    }
    const seg = target.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? "";
    if (!seg || /^index(\.html?)?$/i.test(seg)) return "Home";
    return humanize(seg);
  }
  const hay = `${attrs} ${inner}`;
  for (const [re, label] of WORDS) if (re.test(hay)) return label;
  // <SearchIcon />, <ShoppingCart />, <IconMenu2 />
  const icon = /<([A-Z][A-Za-z0-9]*)/.exec(inner)?.[1];
  if (icon) {
    const name = humanize(icon.replace(/^Icon|Icon$/g, "").replace(/\d+$/, ""));
    if (name && name.length > 1) return name;
  }
  if (tag === "button" && /type\s*=\s*["']?submit/i.test(attrs)) return /newsletter|subscribe/i.test(around) ? "Subscribe" : "Submit";
  return null;
}

export function guessFieldLabel(attrs: string, tag: string): string {
  const get = (n: string) => new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\})`, "i").exec(attrs);
  const pick = (m: RegExpExecArray | null) => (m ? (m[1] ?? m[2] ?? m[3] ?? "").trim() : "");
  const placeholder = pick(get("placeholder")).replace(/[.…:]+$/, "").replace(/^(e\.g\.|eg)\s.*$/i, "");
  if (placeholder && !/@|^\d/.test(placeholder)) return clip(placeholder, 50);
  const name = pick(get("name")) || pick(get("id"));
  if (name) return humanize(name.replace(/\[\]$/, ""));
  const type = pick(get("type"));
  return type && type !== "text" ? humanize(type) : tag === "select" ? "Choose an option" : "Text";
}

/* ------------------------------ plain HTML ------------------------------- */

function hasAccessibleName(attrs: string, inner: string): boolean {
  if (/\saria-(label|labelledby)\s*=\s*["']?[^"'\s>]/i.test(attrs) || /\stitle\s*=\s*["'][^"']+/i.test(attrs)) return true;
  const text = inner.replace(/<(svg|style|script)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").trim();
  if (text) return true;
  if ((inner.match(/<img\b[^>]*>/gi) ?? []).some((t) => /\salt\s*=\s*["'][^"']+/i.test(t))) return true;
  return /<svg\b[^>]*aria-label\s*=\s*["'][^"']+/i.test(inner) || /<title>[^<]+<\/title>/i.test(inner);
}

function findInMarkup(text: string): Found[] {
  const out: Found[] = [];
  const re = /<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const [, tag, attrs, inner] = m as unknown as [string, string, string, string];
    if (tag.toLowerCase() === "a" && !/\shref\s*=/i.test(attrs)) continue;
    if (/aria-hidden\s*=\s*["']true|\shidden(\s|=|$)/i.test(attrs) || hasAccessibleName(attrs, inner)) continue;
    const around = text.slice(Math.max(0, m.index - 300), m.index);
    out.push({
      pos: m.index + 1 + tag.length,
      key: `${tag.toLowerCase()}|${withoutOurs(attrs)}|${withoutOurs(inner).slice(0, 120)}`,
      kind: "control",
      tag: tag.toLowerCase(),
      snippet: clip(squash(`<${tag}${attrs}>`), 160),
      guess: guessControlLabel(tag.toLowerCase(), attrs, inner, around)
    });
  }
  const labelFor = new Set([...text.matchAll(/<label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map((x) => x[1]));
  const wrapped = [...text.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map((x) => [x.index, x.index + x[0].length] as const);
  const fields = /<(input|select|textarea)\b([^>]*)>/gi;
  for (let m = fields.exec(text); m; m = fields.exec(text)) {
    const [, rawTag, attrs] = m as unknown as [string, string, string];
    const tag = rawTag.toLowerCase();
    const type = (/\stype\s*=\s*["']?([a-z-]+)/i.exec(attrs)?.[1] ?? "text").toLowerCase();
    if (tag === "input" && ["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
    if (/aria-hidden\s*=\s*["']true|tabindex\s*=\s*["']-1/i.test(attrs)) continue;
    if (/\saria-(label|labelledby)\s*=|\stitle\s*=/i.test(attrs)) continue;
    const id = /\sid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if ((id && labelFor.has(id)) || wrapped.some(([a, b]) => m!.index > a && m!.index < b)) continue;
    out.push({
      pos: m.index + 1 + rawTag.length,
      key: `${tag}|${withoutOurs(attrs)}`,
      kind: "field",
      tag,
      snippet: clip(squash(m[0]), 160),
      guess: guessFieldLabel(attrs, tag)
    });
  }
  return out;
}

/* --------------------------------- JSX ----------------------------------- */

type JsxTag = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function jsxAttrs(el: JsxTag) {
  return el.attributes.properties;
}

function jsxHas(el: JsxTag, ...names: string[]) {
  return jsxAttrs(el).some((p) => ts.isJsxAttribute(p) && names.includes(p.name.getText()));
}

/** Do this element's children render text (or something we can't see, like {label})? Attributes don't count. */
function rendersName(node: ts.JsxElement): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxText(n) && n.text.trim()) found = true;
    else if (ts.isJsxExpression(n) && n.expression) found = true;
    else if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === "img" && jsxHas(n, "alt")) found = true;
    else if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && /^(title|svg)$/.test(n.tagName.getText()) && jsxHas(n, "aria-label")) found = true;
    else if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === "title") found = true;
    else if (ts.isJsxAttributes(n)) return;
    else n.forEachChild(visit);
  };
  node.children.forEach(visit);
  return found;
}

function findInJsx(path: string, text: string): Found[] {
  if (!/<(a|button|Link|input|select|textarea)\b/.test(text)) return [];
  const sf = parseSource(path, text);
  const out: Found[] = [];
  const linkNames = new Set(["a", "button"]);
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) && /^["'](next\/link|react-router(-dom)?|@remix-run\/react)["']$/.test(s.moduleSpecifier.getText(sf))) {
      const d = s.importClause?.name?.text;
      if (d) linkNames.add(d);
      const named = s.importClause?.namedBindings;
      if (named && ts.isNamedImports(named)) for (const e of named.elements) if (/^(Link|NavLink)$/.test((e.propertyName ?? e.name).text)) linkNames.add(e.name.text);
    }
  }
  const htmlFor = new Set([...text.matchAll(/htmlFor\s*=\s*["{]\s*["'`]?([\w-]+)/g)].map((m) => m[1]));
  const insideLabel = (n: ts.Node) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === "label") return true;
    return false;
  };
  const attrsText = (el: JsxTag) => el.attributes.getText(sf);
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const el = ts.isJsxElement(n) ? n.openingElement : n;
      const name = el.tagName.getText(sf);
      const spread = jsxAttrs(el).some((p) => ts.isJsxSpreadAttribute(p));
      if (linkNames.has(name) && !spread && !jsxHas(el, "aria-label", "aria-labelledby", "title", "aria-hidden")) {
        const isLink = name !== "button";
        const ok = !isLink || jsxHas(el, "href", "to");
        if (ok && ts.isJsxElement(n) && !rendersName(n)) {
          const inner = n.children.map((c) => c.getText(sf)).join("");
          const around = text.slice(Math.max(0, n.getStart(sf) - 400), n.getStart(sf));
          out.push({
            pos: el.tagName.getEnd(),
            key: `${name}|${withoutOurs(attrsText(el))}|${withoutOurs(inner).slice(0, 120)}`,
            kind: "control",
            tag: name,
            snippet: clip(squash(n.getText(sf)), 220),
            guess: guessControlLabel(isLink ? "a" : "button", attrsText(el), inner, around)
          });
        }
      }
      if (/^(input|select|textarea)$/.test(name) && !spread && !jsxHas(el, "aria-label", "aria-labelledby", "title", "aria-hidden")) {
        const a = attrsText(el);
        const type = (/\btype\s*=\s*["']([a-z-]+)/i.exec(a)?.[1] ?? "text").toLowerCase();
        const id = /\bid\s*=\s*["']([\w-]+)/.exec(a)?.[1];
        const skip = (name === "input" && ["hidden", "submit", "button", "image", "reset"].includes(type)) || (id && htmlFor.has(id)) || insideLabel(n);
        if (!skip) {
          out.push({ pos: el.tagName.getEnd(), key: `${name}|${withoutOurs(a)}`, kind: "field", tag: name, snippet: clip(squash(el.getText(sf)), 160), guess: guessFieldLabel(a, name) });
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return out;
}

const find = (path: string, text: string) => (isMarkup(path) ? findInMarkup(text) : findInJsx(path, text));

/* ------------------------------ plan / apply ----------------------------- */

const LABEL_SYSTEM = `You name icon-only buttons and links so AI agents and screen readers know what they do.
For each item, write a short label (2–5 words) that says what clicking it does or where it goes, e.g. "Open menu", "Cart", "Instagram", "Subscribe to the newsletter".
Use the code around it and the guess. Plain words, no quotes, no punctuation at the end.`;

const LABEL_SCHEMA = {
  type: "object",
  properties: { labels: { type: "array", items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" } }, required: ["id", "label"] } } },
  required: ["labels"]
} as const;

/** A label we're willing to put in someone's markup. */
export function cleanLabel(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/[<>{}"`\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[.!:;,]+$/, "")
    .trim();
  return s.length >= 2 && s.length <= 60 ? s : null;
}

/** Before the review: every unlabeled control and field, with the label we'll add. */
export async function findLabelTargets(opts: { texts: Map<string, string>; llm: Llm | null; limit?: number }): Promise<LabelTarget[]> {
  const limit = opts.limit ?? 120;
  const found: (Found & { file: string })[] = [];
  const seen = new Set<string>();
  for (const [file, text] of opts.texts) {
    for (const f of find(file, text)) {
      const id = `${file}#${f.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({ ...f, file });
      if (found.length >= limit) break;
    }
    if (found.length >= limit) break;
  }
  const controls = found.filter((f) => f.kind === "control");
  const named = new Map<number, string>();
  if (opts.llm && controls.length) {
    try {
      const labels = await opts.llm.json({
        system: LABEL_SYSTEM,
        prompt: controls.map((c, i) => `id: ${i}\nfile: ${c.file}\nguess: ${c.guess ?? "none"}\ncode: ${c.snippet}`).join("\n\n"),
        schema: LABEL_SCHEMA as unknown as Record<string, unknown>,
        effort: "low",
        parse: (v) => (v as { labels?: { id: string; label: string }[] }).labels ?? []
      });
      for (const l of labels) {
        const label = cleanLabel(l.label);
        const i = Number(l.id);
        if (label && Number.isInteger(i) && controls[i]) named.set(i, label);
      }
    } catch {
      // fall back to the guesses
    }
  }
  const out: LabelTarget[] = [];
  for (const f of found) {
    const label = f.kind === "control" ? named.get(controls.indexOf(f)) ?? cleanLabel(f.guess) : cleanLabel(f.guess);
    if (label) out.push({ file: f.file, key: f.key, kind: f.kind, tag: f.tag, snippet: f.snippet, label });
  }
  return out;
}

const htmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Add aria-label to the elements in `text` that `targets` name; returns null when nothing changed. */
export function applyLabels(file: string, text: string, targets: LabelTarget[]): string | null {
  const byKey = new Map(targets.filter((t) => t.file === file).map((t) => [t.key, t.label]));
  if (!byKey.size) return null;
  const edits = find(file, text)
    .filter((f) => byKey.has(f.key))
    .map((f) => ({ pos: f.pos, insert: isMarkup(file) ? ` aria-label="${htmlAttr(byKey.get(f.key)!)}"` : ` aria-label=${JSON.stringify(byKey.get(f.key)!)}` }));
  if (!edits.length) return null;
  return edits.sort((a, b) => b.pos - a.pos).reduce((t, e) => t.slice(0, e.pos) + e.insert + t.slice(e.pos), text);
}
