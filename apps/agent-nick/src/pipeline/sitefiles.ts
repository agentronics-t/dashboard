// Site files: the Agent Readiness Score fixes that aren't WebMCP tools.
//
//   llms.txt        — a short Markdown guide for AI tools (Gemini drafts it
//                     from the README and the page titles)
//   sitemap         — every static route (app/sitemap.ts on the Next.js App
//                     Router, a static sitemap.xml everywhere else), and a
//                     Sitemap: line in an existing robots.txt
//   structured data — schema.org Organization + WebSite JSON-LD in the root
//                     layout / _app / index.html
//
// `planSiteFiles` runs before the review: it checks what the repo already has
// and drafts what's missing, so the customer sees exactly what will be added.
// `writeSiteFiles` runs at write time, on top of the tool changes, so a file
// both features touch (the root layout) is edited once.

import ts from "typescript";
import type { Llm } from "../llm/gemini.ts";
import { importInsertPos, moduleDir, relImport, toJs, type CodegenResult } from "./codegen.ts";
import { parseSource } from "./extract.ts";
import type { RepoReader } from "./repo.ts";
import type { FileChange, Framework, LlmsDraft, PageDigest, PageInfo, SiteFacts, SiteFix, SiteFixKind, SitePlan } from "./types.ts";

const join = (...parts: string[]) => parts.filter(Boolean).join("/");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Where static files are served from: <app>/public, or the root of a plain HTML site. */
export function publicDir(fw: Framework): string {
  return fw.kind === "static-html" ? fw.root : join(fw.root, "public");
}

/** A real http(s) origin, normalised (no trailing slash), or null. */
export function normaliseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s)) return null;
    s = `https://${s}`;
  }
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".") || /(^|\.)localhost$|^127\.|^0\.0\.0\.0$/.test(u.hostname)) return null;
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/** Signed-in, account and auth pages: not for a sitemap or an llms.txt. */
const PRIVATE = /(^|\/)(dashboard|admin|account|settings|profile|billing|sign-?in|sign-?up|log-?in|log-?out|register|auth|callback|onboarding)(\/|$)/i;

/** Public static routes only — a sitemap can't list /products/[id] without the data behind it. */
export function staticRoutes(pages: PageInfo[]): string[] {
  const out = new Set<string>();
  for (const p of pages) {
    if (p.route.includes("[") || p.route.startsWith("/api") || /\/(404|500|_error)$/.test(p.route) || PRIVATE.test(p.route)) continue;
    out.add(p.route || "/");
  }
  return [...out].sort((a, b) => (a === "/" ? -1 : b === "/" ? 1 : a.localeCompare(b)));
}

async function packageJson(reader: RepoReader, fw: Framework): Promise<{ name?: string; description?: string; homepage?: string; deps: Set<string> }> {
  const text = await reader.read(join(fw.root, "package.json"));
  try {
    const j = JSON.parse(text ?? "{}") as { name?: string; description?: string; homepage?: string; dependencies?: object; devDependencies?: object };
    return { ...j, deps: new Set([...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})]) };
  } catch {
    return { deps: new Set() };
  }
}

/** The root layout / _app / _document / index.html — where site-wide things live. */
function rootFiles(reader: RepoReader, fw: Framework): string[] {
  const exts = [".tsx", ".jsx", ".js", ".ts"];
  if (fw.kind === "next-app" && fw.appDir) return exts.map((e) => `${fw.appDir}/layout${e}`).filter((p) => reader.has(p));
  if (fw.kind === "next-pages" && fw.pagesDir)
    return ["_app", "_document"].flatMap((n) => exts.map((e) => `${fw.pagesDir}/${n}${e}`)).filter((p) => reader.has(p));
  return spaIndexHtml(reader, fw) ? [spaIndexHtml(reader, fw) as string] : [];
}

/** index.html of a Vite app (root) or CRA app (public/), or of a plain HTML site. */
function spaIndexHtml(reader: RepoReader, fw: Framework): string | null {
  const candidates = fw.kind === "static-html" ? [join(fw.root, "index.html")] : [join(fw.root, "index.html"), join(fw.root, "public", "index.html")];
  return candidates.find((p) => reader.has(p)) ?? null;
}

/** The site's public address: GitHub homepage, package.json, metadataBase, CNAME, or a canonical link. */
export async function findSiteUrl(reader: RepoReader, fw: Framework, githubHomepage: string | null): Promise<{ url: string | null; source: string | null }> {
  const pkg = await packageJson(reader, fw);
  const tries: [string | null | undefined, string][] = [
    [githubHomepage, "the repository's website on GitHub"],
    [pkg.homepage, "package.json homepage"]
  ];
  for (const [raw, source] of tries) {
    const url = normaliseUrl(raw);
    if (url) return { url, source };
  }
  for (const f of rootFiles(reader, fw)) {
    const text = (await reader.read(f)) ?? "";
    const m =
      /metadataBase:\s*new URL\(\s*["'`]([^"'`]+)["'`]/.exec(text) ??
      /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(text) ??
      /<meta[^>]+property=["']og:url["'][^>]*content=["']([^"']+)["']/i.exec(text);
    const url = normaliseUrl(m?.[1]);
    if (url) return { url, source: f };
  }
  for (const cname of [join(publicDir(fw), "CNAME"), "CNAME"]) {
    const url = reader.exists(cname) ? normaliseUrl(((await reader.read(cname, { anyFile: true })) ?? "").split("\n")[0]) : null;
    if (url) return { url, source: cname };
  }
  return { url: null, source: null };
}

/** What the repo already has. */
export async function auditSite(reader: RepoReader, fw: Framework, pages: PageInfo[]): Promise<Record<SiteFixKind, string | null>> {
  const base = fw.root ? `${esc(fw.root)}/` : "";
  const pkg = await packageJson(reader, fw);

  const llms =
    reader.listAll(new RegExp(`^${base}(public/)?llms(-full)?\\.txt$`))[0] ??
    (fw.appDir ? reader.list(new RegExp(`^${esc(fw.appDir)}/llms\\.txt/route\\.(t|j)s$`))[0] : undefined) ??
    null;

  const sitemapDep = ["next-sitemap", "@astrojs/sitemap", "vite-plugin-sitemap", "sitemap"].find((d) => pkg.deps.has(d));
  const sitemap =
    reader.listAll(new RegExp(`^${base}(public/)?sitemap[\\w-]*\\.xml$`))[0] ??
    (fw.appDir ? reader.list(new RegExp(`^${esc(fw.appDir)}/sitemap\\.(t|j)sx?$`))[0] : undefined) ??
    reader.listAll(new RegExp(`^${base}next-sitemap\\.config\\.(c|m)?js$`))[0] ??
    (sitemapDep ? `${sitemapDep} (package.json)` : null);

  // JSON-LD can live anywhere; check the site-wide files plus the pages themselves.
  const candidates = [...rootFiles(reader, fw), ...pages.map((p) => p.file)].slice(0, 60);
  const texts = await reader.readMany(candidates);
  const seoDep = ["next-seo", "schema-dts", "react-schemaorg"].find((d) => pkg.deps.has(d));
  let structured: string | null = seoDep ? `${seoDep} (package.json)` : null;
  for (const [path, text] of texts) {
    if (/application\/ld\+json|<JsonLd\b|ArticleJsonLd|OrganizationJsonLd/.test(text)) {
      structured = path;
      break;
    }
  }
  return { "llms-txt": llms, sitemap, "structured-data": structured };
}

/* ------------------------------- llms.txt -------------------------------- */

const LLMS_SYSTEM = `You write llms.txt files: a short Markdown guide that tells AI tools what a website is and where its key pages are.
Use only facts from the README, the package description and the page list. Never invent products, prices, people or claims.
- name: the site or product name as people say it.
- summary: one or two plain sentences on what the site offers and who it's for.
- sections: 1–4 groups (e.g. "Product", "Docs", "Company"), each with the most useful public pages. Only use paths from the page list.
- note: what a visitor finds on that page, in a few words.`;

const LLMS_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          links: {
            type: "array",
            items: { type: "object", properties: { path: { type: "string" }, label: { type: "string" }, note: { type: "string" } }, required: ["path", "label", "note"] }
          }
        },
        required: ["title", "links"]
      }
    }
  },
  required: ["name", "summary", "sections"]
} as const;

/** Keep Gemini's draft honest: known routes only, sane sizes. */
export function normaliseLlms(value: unknown, routes: string[], fallbackName: string): LlmsDraft {
  const v = value as Partial<LlmsDraft>;
  const known = new Set(routes);
  const sections = (Array.isArray(v.sections) ? v.sections : [])
    .slice(0, 4)
    .map((s) => ({
      title: clip(String(s?.title ?? "Pages").trim() || "Pages", 40),
      links: (Array.isArray(s?.links) ? s.links : [])
        .map((l) => ({ path: String(l?.path ?? "").trim(), label: clip(String(l?.label ?? "").trim(), 60), note: clip(String(l?.note ?? "").trim(), 140) }))
        .filter((l) => known.has(l.path) && l.label)
        .slice(0, 20)
    }))
    .filter((s) => s.links.length);
  const summary = clip(String(v.summary ?? "").replace(/\s+/g, " ").trim(), 400);
  if (!summary || !sections.length) throw new Error("llms.txt draft is empty");
  return { name: clip(String(v.name ?? "").trim() || fallbackName, 80), summary, sections };
}

/** No model, or the model failed: a plain list of the pages we know. */
export function fallbackLlms(facts: SiteFacts, routes: string[], titles: Map<string, string>): LlmsDraft {
  return {
    name: facts.name,
    summary: facts.description ?? `The ${facts.name} website.`,
    sections: [
      {
        title: "Pages",
        links: routes.slice(0, 20).map((r) => {
          const label = titles.get(r) ?? (r === "/" ? "Home" : r.slice(1).split("/").pop()!.replace(/[-_]/g, " "));
          return { path: r, label: label.charAt(0).toUpperCase() + label.slice(1), note: "" };
        })
      }
    ]
  };
}

export function renderLlms(draft: LlmsDraft, url: string | null): string {
  const href = (path: string) => (url ? `${url}${path === "/" ? "/" : path}` : path);
  const lines = [`# ${draft.name}`, "", `> ${draft.summary}`];
  for (const s of draft.sections) {
    lines.push("", `## ${s.title}`, "");
    for (const l of s.links) lines.push(`- [${l.label}](${href(l.path)})${l.note ? `: ${l.note}` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

/* ------------------------------ sitemap ---------------------------------- */

export function renderSitemapXml(url: string, routes: string[]): string {
  const xmlEsc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- Added by Agentronics Agent Nic: every static page, for search engines and AI agents. -->`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...routes.map((r) => `  <url><loc>${xmlEsc(`${url}${r === "/" ? "/" : r}`)}</loc></url>`),
    `</urlset>`,
    ""
  ].join("\n");
}

function nextSitemapModule(url: string, routes: string[], typescript: boolean): string {
  const source = `import type { MetadataRoute } from "next";

// Added by Agentronics Agent Nic: every static page, for search engines and AI agents.
// Set NEXT_PUBLIC_SITE_URL to change the address.
const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? ${JSON.stringify(url)}).replace(/\\/+$/, "");
const ROUTES = ${JSON.stringify(routes)};

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: \`\${BASE}\${route}\`,
    changeFrequency: "weekly",
    priority: route === "/" ? 1 : 0.7
  }));
}
`;
  return typescript ? source : toJs(source, "sitemap.ts");
}

/* --------------------------- structured data ----------------------------- */

export function jsonLd(facts: SiteFacts, url: string): Record<string, unknown> {
  const org: Record<string, unknown> = { "@type": "Organization", name: facts.name, url };
  if (facts.description) org.description = facts.description;
  return {
    "@context": "https://schema.org",
    "@graph": [org, { "@type": "WebSite", name: facts.name, url }]
  };
}

function structuredComponent(data: Record<string, unknown>, fw: Framework): string {
  const json = JSON.stringify(data, null, 2);
  const script = `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(DATA) }} />`;
  const source =
    fw.kind === "next-pages"
      ? `import Head from "next/head";

// Who this site is, as schema.org data that agents and search engines read — added by Agentronics Agent Nic.
const DATA = ${json};

export function AgentronicsStructuredData() {
  return (
    <Head>
      <script key="agentronics-structured-data" type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(DATA) }} />
    </Head>
  );
}
`
      : `// Who this site is, as schema.org data that agents and search engines read — added by Agentronics Agent Nic.
const DATA = ${json};

export function AgentronicsStructuredData() {
  return ${script};
}
`;
  return fw.typescript ? source : toJs(source, "s.tsx");
}

/* -------------------------------- plan ----------------------------------- */

const TITLES: Record<SiteFixKind, string> = {
  "llms-txt": "llms.txt guide for AI",
  sitemap: "Sitemap",
  "structured-data": "Structured data"
};

/** Before the review: what's missing, and a draft of each fix. */
export async function planSiteFiles(opts: {
  reader: RepoReader;
  fw: Framework;
  pages: PageInfo[];
  digests: PageDigest[];
  llm: Llm | null;
  repoFullName: string;
  githubHomepage: string | null;
}): Promise<SitePlan> {
  const { reader, fw, pages, digests, llm } = opts;
  const pkg = await packageJson(reader, fw);
  const found = await findSiteUrl(reader, fw, opts.githubHomepage);
  const routes = staticRoutes(pages);
  const titles = new Map(digests.filter((d) => d.title).map((d) => [d.route, d.title as string]));
  const repoName = opts.repoFullName.split("/").pop() ?? opts.repoFullName;
  const prettyName = (pkg.name && !pkg.name.startsWith("@") ? pkg.name : repoName).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const facts: SiteFacts = { url: found.url, urlSource: found.source, name: prettyName, description: pkg.description?.trim() || null };

  const have = await auditSite(reader, fw, pages);
  const present = (Object.keys(have) as SiteFixKind[]).filter((k) => have[k]);
  const missing = (Object.keys(have) as SiteFixKind[]).filter((k) => !have[k]);

  // llms.txt doubles as the source of the site's name and one-line description.
  let llms: LlmsDraft | null = null;
  if (missing.includes("llms-txt") || missing.includes("structured-data")) {
    const readme = reader.listAll(new RegExp(`^${fw.root ? `${esc(fw.root)}/` : ""}readme(\\.md)?$`, "i"))[0] ?? reader.listAll(/^readme(\.md)?$/i)[0];
    const readmeText = readme ? ((await reader.read(readme, { anyFile: true })) ?? "").slice(0, 6000) : "";
    if (llm && routes.length) {
      try {
        llms = await llm.json({
          system: LLMS_SYSTEM,
          prompt: [
            `Repository: ${opts.repoFullName}`,
            pkg.description ? `package.json description: ${pkg.description}` : "",
            `Pages (path: title):\n${routes.map((r) => `${r}: ${titles.get(r) ?? ""}`).join("\n")}`,
            readmeText ? `README:\n${readmeText}` : "No README."
          ]
            .filter(Boolean)
            .join("\n\n"),
          schema: LLMS_SCHEMA as unknown as Record<string, unknown>,
          effort: "low",
          parse: (v) => normaliseLlms(v, routes, facts.name)
        });
      } catch {
        llms = null;
      }
    }
    llms ??= fallbackLlms(facts, routes, titles);
    facts.name = llms.name;
    facts.description ??= llms.summary;
  }

  const pub = publicDir(fw);
  const dir = moduleDir(reader, fw);
  const tsx = fw.typescript ? "tsx" : "jsx";
  const url = facts.url ?? "https://your-site.example";
  const fixes: SiteFix[] = [];

  if (!have["llms-txt"] && llms) {
    fixes.push({
      kind: "llms-txt",
      title: TITLES["llms-txt"],
      found: "No llms.txt in the repo.",
      plan: "Add /llms.txt: who you are and links to your key pages, so AI tools can find their way around.",
      files: [join(pub, "llms.txt")],
      preview: renderLlms(llms, facts.url)
    });
  }
  if (!have.sitemap && routes.length) {
    const nextApp = fw.kind === "next-app" && fw.appDir;
    const robots = [join(pub, "robots.txt")].find((p) => reader.exists(p));
    fixes.push({
      kind: "sitemap",
      title: TITLES.sitemap,
      found: "No sitemap in the repo.",
      plan: `Add a sitemap with your ${routes.length} static page${routes.length === 1 ? "" : "s"}${robots ? " and point robots.txt at it" : ""}, so agents find every page, not just the ones linked from the home page.`,
      files: [nextApp ? `${fw.appDir}/sitemap.${fw.typescript ? "ts" : "js"}` : join(pub, "sitemap.xml"), ...(robots ? [robots] : [])],
      preview: routes.map((r) => `${url}${r === "/" ? "/" : r}`).join("\n")
    });
  }
  if (!have["structured-data"]) {
    const root = rootFiles(reader, fw)[0];
    const files =
      fw.kind === "next-app" || fw.kind === "next-pages"
        ? [`${dir}/AgentronicsStructuredData.${tsx}`, root ?? (fw.kind === "next-pages" ? `${fw.pagesDir}/_app.${tsx}` : "")]
        : [spaIndexHtml(reader, fw) ?? ""];
    if (files.every(Boolean)) {
      fixes.push({
        kind: "structured-data",
        title: TITLES["structured-data"],
        found: "No schema.org structured data found.",
        plan: "Add schema.org Organization and WebSite data (JSON-LD), so agents know who you are without guessing.",
        files,
        preview: JSON.stringify(jsonLd(facts, url), null, 2)
      });
    }
  }
  return { facts, fixes, present, llms, routes };
}

/* -------------------------------- write ---------------------------------- */

/** Edit a file the tool changes may already have edited (so both land in one change), or the repo's copy. */
async function editFile(result: CodegenResult, reader: RepoReader, path: string, reason: string, fn: (text: string) => string | null, anyFile = false): Promise<boolean> {
  const existing = result.changes.find((c) => c.path === path);
  const text = existing ? existing.content : await reader.read(path, { anyFile });
  if (text === null) return false;
  const next = fn(text);
  if (next === null || next === text) return false;
  if (existing) {
    existing.content = next;
    existing.reason = `${existing.reason}; ${reason}`;
  } else result.changes.push({ path, content: next, before: text, reason });
  return true;
}

/** Insert `<Element />` next to `{children}` / `<Component …/>` (or before </body>), plus its import. */
function mountNextTo(path: string, text: string, importLine: string, element: string, anchor: "children" | "Component"): string | null {
  const sf = parseSource(path, text);
  let found: ts.Node | null = null;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (anchor === "children" && ts.isJsxExpression(n) && n.expression && ts.isIdentifier(n.expression) && n.expression.text === "children") found = n;
    else if (anchor === "Component" && ts.isJsxSelfClosingElement(n) && n.tagName.getText(sf) === "Component") found = n;
    n.forEachChild(visit);
  };
  visit(sf);
  let edited: string;
  if (found) {
    const node = found as ts.Node;
    const inJsx = ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent);
    // `return <Component {...pageProps} />` has no JSX parent: wrap both in a fragment.
    edited = inJsx
      ? `${text.slice(0, node.getEnd())}\n        ${element}${text.slice(node.getEnd())}`
      : `${text.slice(0, node.getStart(sf))}<>\n      ${node.getText(sf)}\n      ${element}\n    </>${text.slice(node.getEnd())}`;
  } else {
    const body = text.lastIndexOf("</body>");
    if (body === -1) return null;
    edited = `${text.slice(0, body)}\n        ${element}${text.slice(body)}`;
  }
  const imp = importInsertPos(edited, path);
  return `${edited.slice(0, imp)}\n${importLine}${edited.slice(imp)}`;
}

/** At write time: add the approved site files on top of the tool changes. */
export async function writeSiteFiles(opts: {
  result: CodegenResult;
  reader: RepoReader;
  fw: Framework;
  plan: SitePlan;
  kinds: SiteFixKind[];
  url: string | null;
}): Promise<void> {
  const { result, reader, fw, plan } = opts;
  const url = normaliseUrl(opts.url) ?? plan.facts.url;
  const facts = { ...plan.facts, url };
  const pub = publicDir(fw);
  const written: Partial<Record<SiteFixKind, string[]>> = {};
  const add = (kind: SiteFixKind, c: FileChange) => {
    result.changes.push(c);
    (written[kind] ??= []).push(c.path);
  };
  const want = (k: SiteFixKind) => opts.kinds.includes(k) && plan.fixes.some((f) => f.kind === k);

  if (want("llms-txt") && plan.llms) {
    add("llms-txt", { path: join(pub, "llms.txt"), content: renderLlms(plan.llms, url), before: null, reason: "llms.txt guide for AI tools" });
  }

  if (want("sitemap") && url) {
    if (fw.kind === "next-app" && fw.appDir) {
      const path = `${fw.appDir}/sitemap.${fw.typescript ? "ts" : "js"}`;
      add("sitemap", { path, content: nextSitemapModule(url, plan.routes, fw.typescript), before: null, reason: "Sitemap of every static page" });
    } else {
      add("sitemap", { path: join(pub, "sitemap.xml"), content: renderSitemapXml(url, plan.routes), before: null, reason: "Sitemap of every static page" });
    }
    const robots = join(pub, "robots.txt");
    if (reader.exists(robots)) {
      const ok = await editFile(
        result,
        reader,
        robots,
        "points to the sitemap",
        (t) => (/^\s*sitemap\s*:/im.test(t) ? null : `${t}${t.endsWith("\n") ? "" : "\n"}\nSitemap: ${url}/sitemap.xml\n`),
        true
      );
      if (ok) (written.sitemap ??= []).push(robots);
    } else if (fw.appDir && reader.list(new RegExp(`^${esc(fw.appDir)}/robots\\.(t|j)s$`)).length) {
      result.manualSteps.push(`Add \`sitemap: "${url}/sitemap.xml"\` to the object your \`${fw.appDir}/robots\` file returns.`);
    }
  } else if (want("sitemap")) {
    result.manualSteps.push("Add your site's address in the review to get a sitemap.");
  }

  if (want("structured-data") && url) {
    const data = jsonLd(facts, url);
    if (fw.kind === "next-app" || fw.kind === "next-pages") {
      const dir = moduleDir(reader, fw);
      const tsx = fw.typescript ? "tsx" : "jsx";
      const compPath = `${dir}/AgentronicsStructuredData.${tsx}`;
      const element = "<AgentronicsStructuredData />";
      const importFrom = (file: string) => `import { AgentronicsStructuredData } from "${relImport(file, compPath)}";`;
      // the file that renders it: root layout (App Router) or _app (Pages Router; ours if the tools just created one)
      const host =
        fw.kind === "next-app" && fw.appDir
          ? [".tsx", ".jsx", ".js"].map((e) => `${fw.appDir}/layout${e}`).find((p) => reader.has(p)) ?? null
          : [".tsx", ".jsx", ".js"].map((e) => `${fw.pagesDir}/_app${e}`).find((p) => reader.has(p) || result.changes.some((c) => c.path === p)) ?? null;
      let mountedIn: string | null = null;
      if (host) {
        const ok = await editFile(result, reader, host, "structured data", (t) =>
          mountNextTo(host, t, importFrom(host), element, fw.kind === "next-app" ? "children" : "Component")
        );
        if (ok) mountedIn = host;
      } else if (fw.kind === "next-pages" && fw.pagesDir) {
        mountedIn = `${fw.pagesDir}/_app.${tsx}`;
        result.changes.push({
          path: mountedIn,
          before: null,
          reason: "Custom App to add the structured data",
          content: `${fw.typescript ? `import type { AppProps } from "next/app";\n` : ""}${importFrom(mountedIn)}

export default function App({ Component, pageProps }${fw.typescript ? ": AppProps" : ""}) {
  return (
    <>
      <Component {...pageProps} />
      ${element}
    </>
  );
}
`
        });
      }
      if (mountedIn) {
        add("structured-data", { path: compPath, content: structuredComponent(data, fw), before: null, reason: "schema.org structured data" });
        written["structured-data"]!.push(mountedIn);
      } else {
        result.manualSteps.push(`Render \`${element}\` from \`${compPath}\` once in your root layout (we couldn't find a safe place to add it).`);
      }
    } else {
      const index = spaIndexHtml(reader, fw);
      const block = `    <script type="application/ld+json">\n${JSON.stringify(data, null, 2)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")}\n    </script>\n`;
      const ok =
        !!index &&
        (await editFile(result, reader, index, "structured data", (t) => {
          const at = t.search(/<\/head>/i);
          if (at === -1) return null;
          const lineStart = t.lastIndexOf("\n", at) + 1;
          return `${t.slice(0, lineStart)}${block}${t.slice(lineStart)}`;
        }));
      if (ok && index) (written["structured-data"] ??= []).push(index);
      else result.manualSteps.push("Add the schema.org JSON-LD from the run page to the <head> of your home page.");
    }
  }
  result.siteFiles = written;
}
