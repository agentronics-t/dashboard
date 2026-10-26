// "Markdown version for agents": every page also served as clean Markdown, and
// linked from the page with <link rel="alternate" type="text/markdown">.
//
//   static HTML      a .md file next to each page, converted at PR time
//   Next.js (App)    app/md/[[...path]]/route — /md/pricing is /pricing as Markdown
//   Next.js (Pages)  pages/api/md/[[...path]] — the same, as an API route
//   other apps       /index.md written from the llms.txt draft (the HTML is
//                    rendered by JavaScript, so there is nothing to convert)
//
// The converter is one TypeScript source (MARKDOWN_RUNTIME) that ships in the
// customer's repo for the Next.js routes and is compiled here for static pages,
// so both produce the same Markdown.

import ts from "typescript";

export const MARKDOWN_RUNTIME = String.raw`// HTML → Markdown for AI agents — added by Agentronics Agent Nic. No dependencies.
const DROP = /<(script|style|noscript|template|svg|iframe|canvas|select|textarea|button|head)\b[\s\S]*?<\/\1>/gi;
const FENCE = "\x60\x60\x60";

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, "&");
}

const strip = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function attr(tag: string, name: string): string | null {
  const m = new RegExp("\\s" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s>]+))", "i").exec(tag);
  return m ? decode(m[1] ?? m[2] ?? m[3] ?? "") : null;
}

function absolute(href: string, base: string): string {
  try {
    return base ? new URL(href, base).href : href;
  } catch {
    return href;
  }
}

/** Convert a page's HTML to Markdown: its title, then the main content (or the body). */
export function htmlToMarkdown(html: string, base = ""): string {
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  let s = main.replace(/<!--[\s\S]*?-->/g, "").replace(DROP, "");
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => "\n\n" + FENCE + "\n" + decode(code.replace(/<[^>]+>/g, "")).trim() + "\n" + FENCE + "\n\n");
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => "\n\n" + "#".repeat(Number(n)) + " " + strip(t) + "\n\n");
  s = s.replace(/<img\b[^>]*>/gi, (tag: string) => {
    const alt = attr(tag, "alt");
    const src = attr(tag, "src");
    return alt && src ? "![" + alt + "](" + absolute(src, base) + ")" : "";
  });
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs: string, inner: string) => {
    const text = strip(inner) || attr(" " + attrs, "aria-label") || "";
    const href = attr(" " + attrs, "href");
    if (!text) return "";
    return href && !/^(#|javascript:|mailto:$)/i.test(href) ? "[" + text + "](" + absolute(href, base) + ")" : text;
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, t: string) => (strip(t) ? "**" + strip(t) + "**" : ""));
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t: string, t: string) => (strip(t) ? "_" + strip(t) + "_" : ""));
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, t: string) => "\x60" + strip(t) + "\x60");
  s = s.replace(/<li\b[^>]*>/gi, "\n- ");
  s = s.replace(/<tr\b[^>]*>/gi, "\n|").replace(/<\/t[dh]>/gi, " |");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/?(p|div|section|article|header|footer|nav|aside|ul|ol|table|thead|tbody|blockquote|figure|form|fieldset|dl|dt|dd)\b[^>]*>/gi, "\n\n");
  s = decode(s.replace(/<[^>]+>/g, " "));
  const lines = s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l !== "-");
  const body = lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(- .*)\n\n(?=- )/gm, "$1\n")
    .trim();
  const head = title && !body.startsWith("# ") ? "# " + title + "\n\n" : "";
  return head + body + "\n";
}
`;

type Convert = (html: string, base?: string) => string;
let compiled: Convert | null = null;

/** The same converter, compiled once for use at PR time. */
export function htmlToMarkdown(html: string, base = ""): string {
  if (!compiled) {
    const js = ts.transpileModule(MARKDOWN_RUNTIME, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} as { htmlToMarkdown?: Convert } };
    new Function("module", "exports", js)(mod, mod.exports);
    compiled = mod.exports.htmlToMarkdown ?? null;
    if (!compiled) throw new Error("markdown runtime did not compile");
  }
  return compiled(html, base);
}

/** App Router route: /md/<path> serves /<path> as Markdown, converted from the page's own HTML. */
export function nextAppMarkdownRoute(importPath: string): string {
  return `// Markdown version of every page, for AI agents — added by Agentronics Agent Nic.
// /md is the home page, /md/pricing is /pricing. Each page links here with
// <link rel="alternate" type="text/markdown">.
import { htmlToMarkdown } from "${importPath}";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\\/md(?=\\/|$)/, "") || "/";
  const page = await fetch(new URL(path + url.search, url.origin), { headers: { accept: "text/html" } });
  if (!page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  const markdown = htmlToMarkdown(await page.text(), new URL(path, url.origin).href);
  return new Response(markdown, {
    headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=3600" }
  });
}
`;
}

/** Pages Router API route: /api/md/<path> serves /<path> as Markdown. */
export function nextPagesMarkdownRoute(importPath: string, typescript: boolean): string {
  return `// Markdown version of every page, for AI agents — added by Agentronics Agent Nic.
// /api/md is the home page, /api/md/pricing is /pricing.
${typescript ? `import type { NextApiRequest, NextApiResponse } from "next";\n` : ""}import { htmlToMarkdown } from "${importPath}";

export default async function handler(req${typescript ? ": NextApiRequest" : ""}, res${typescript ? ": NextApiResponse" : ""}) {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const origin = \`\${proto}://\${host}\`;
  const path = (req.url ?? "").split("?")[0]!.replace(/^\\/api\\/md(?=\\/|$)/, "") || "/";
  const page = await fetch(new URL(path, origin), { headers: { accept: "text/html" } });
  if (!page.ok || !(page.headers.get("content-type") ?? "").includes("text/html")) return res.status(404).send("Not found");
  res.setHeader("content-type", "text/markdown; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300, s-maxage=3600");
  res.send(htmlToMarkdown(await page.text(), new URL(path, origin).href));
}
`;
}

/** Client component that links the current page's Markdown version. */
export function markdownLinkComponent(kind: "next-app" | "next-pages", typescript: boolean): string {
  const src =
    kind === "next-app"
      ? `"use client";

// Links this page's Markdown version for AI agents — added by Agentronics Agent Nic.
import { usePathname } from "next/navigation";

export function AgentronicsMarkdownLink() {
  const pathname = usePathname();
  return <link rel="alternate" type="text/markdown" href={\`/md\${pathname === "/" ? "" : pathname}\`} />;
}
`
      : `// Links this page's Markdown version for AI agents — added by Agentronics Agent Nic.
import Head from "next/head";
import { useRouter } from "next/router";

export function AgentronicsMarkdownLink() {
  const path = useRouter().asPath.split(/[?#]/)[0] ?? "/";
  return (
    <Head>
      <link key="agentronics-markdown" rel="alternate" type="text/markdown" href={\`/api/md\${path === "/" ? "" : path}\`} />
    </Head>
  );
}
`;
  return typescript ? src : ts.transpileModule(src, { fileName: "m.tsx", compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve } }).outputText;
}
