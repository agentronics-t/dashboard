// Site files: the Agent Readiness Score fixes that aren't WebMCP tools.
//
//   AI rules        — robots.txt names the AI agents that browse for people and
//                     states a Content-Signal (search, AI answers, no training)
//   llms.txt        — a short Markdown guide for AI tools (Gemini drafts it
//                     from the README and the page titles)
//   sitemap         — every static route (app/sitemap.ts on the Next.js App
//                     Router, a static sitemap.xml everywhere else), and a
//                     Sitemap: line in an existing robots.txt
//   structured data — schema.org Organization + WebSite JSON-LD in the root
//                     layout / _app / index.html
//   Markdown        — every page as Markdown, linked from the page (markdown.ts)
//   labels          — aria-labels for icon-only buttons and unlabeled fields (labels.ts)
//   SDK             — the Agentronics SDK on every page with a publishable key
//                     made for the site, so events reach the console once the
//                     PR is merged (written by codegen.ts with the tools)
//
// `planSiteFiles` runs before the review: it checks what the repo already has
// and drafts what's missing, so the customer sees exactly what will be added.
// `writeSiteFiles` runs at write time, on top of the tool changes, so a file
// both features touch (the root layout) is edited once.

import ts from "typescript";
import type { Llm } from "../llm/gemini.ts";
import { importInsertPos, moduleDir, relImport, SDK_CDN_URL, toJs, type CodegenResult } from "./codegen.ts";
import { parseSource } from "./extract.ts";
import { applyLabels, findLabelTargets } from "./labels.ts";
import { htmlToMarkdown, MARKDOWN_RUNTIME, markdownLinkComponent, nextAppMarkdownRoute, nextPagesMarkdownRoute } from "./markdown.ts";
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
export async function findSiteUrl(
  reader: RepoReader,
  fw: Framework,
  githubHomepage: string | null,
  deployUrl: string | null = null
): Promise<{ url: string | null; source: string | null }> {
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
  const deployed = normaliseUrl(deployUrl);
  if (deployed) return { url: deployed, source: "your latest production deployment" };
  return { url: null, source: null };
}

/* ------------------------------ robots.txt ------------------------------ */

/** The agents that browse and search for people — the ones a site wants to let in. */
export const AI_USER_AGENTS = ["ChatGPT-User", "OAI-SearchBot", "Claude-User", "Claude-SearchBot", "Perplexity-User", "PerplexityBot"];
const AI_NAMES = /^\s*user-agent\s*:\s*(gptbot|chatgpt-user|oai-searchbot|claudebot|claude-user|claude-searchbot|anthropic-ai|perplexitybot|perplexity-user|google-extended|applebot-extended|ccbot|meta-externalagent|amazonbot|duckassistbot|mistralai-user)\b/im;

/** robots.txt already speaks to AI agents (names one, or declares a Content-Signal). */
export const robotsTalksToAi = (text: string) => AI_NAMES.test(text) || /^\s*content-signal\s*:/im.test(text);

/** The rules of the `User-agent: *` group, so AI agents keep the same limits as everyone else. */
function starRules(text: string): string[] {
  const rules: string[] = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    if (key === "user-agent") {
      if (!lastWasAgent) inStar = false;
      if (m[2]!.trim() === "*") inStar = true;
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (inStar && (key === "allow" || key === "disallow")) rules.push(`${key === "allow" ? "Allow" : "Disallow"}: ${m[2]!.trim()}`);
    }
  }
  return rules;
}

/** The group Agent Nic adds: named AI agents, the site's usual rules, and a Content-Signal. */
export function aiRobotsBlock(existing: string | null): string {
  const rules = existing ? starRules(existing) : [];
  return [
    "# AI agents that browse and search for people: the same pages as everyone else.",
    "# Content-Signal (contentsignals.org): show in search and AI answers, don't train on it.",
    "# Added by Agentronics Agent Nic.",
    ...AI_USER_AGENTS.map((a) => `User-agent: ${a}`),
    "Content-Signal: search=yes, ai-input=yes, ai-train=no",
    ...(rules.length ? rules : ["Allow: /"]),
    ""
  ].join("\n");
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
  const robotsPath = join(publicDir(fw), "robots.txt");
  const robotsText = reader.exists(robotsPath) ? await reader.read(robotsPath, { anyFile: true }) : null;
  const robotsModule = fw.appDir ? reader.list(new RegExp(`^${esc(fw.appDir)}/robots\\.(t|j)s$`))[0] : undefined;
  const robotsModuleText = robotsModule ? await reader.read(robotsModule) : null;
  const robotsAi = robotsText && robotsTalksToAi(robotsText) ? robotsPath : robotsModuleText && /content-signal|chatgpt-user|claude-user|gptbot/i.test(robotsModuleText) ? robotsModule! : null;

  const markdown =
    [...texts].find(([, t]) => /type=["']text\/markdown["']|["']text\/markdown["']/.test(t))?.[0] ??
    (fw.appDir ? reader.list(new RegExp(`^${esc(fw.appDir)}/md/`))[0] : undefined) ??
    null;

  const sdkDep = ["@agentronics/sdk", "@agentronics/react"].find((d) => pkg.deps.has(d));
  const sdk = sdkDep ? `${sdkDep} (package.json)` : [...texts].find(([, t]) => /@agentronics\/sdk|Agentronics\.init\(/.test(t))?.[0] ?? null;

  // Labels are found per element in planSiteFiles.
  return { "robots-ai": robotsAi, "llms-txt": llms, sitemap, "structured-data": structured, markdown, labels: null, sdk };
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
  "robots-ai": "AI rules in robots.txt",
  "llms-txt": "llms.txt guide for AI",
  sitemap: "Sitemap",
  "structured-data": "Structured data",
  markdown: "Markdown version of each page",
  labels: "Labels for buttons and fields",
  sdk: "Agentronics SDK (events in your console)"
};

/** The files whose buttons and fields get labels: the HTML pages, or the app's components. */
function labelFiles(reader: RepoReader, fw: Framework, pages: PageInfo[]): string[] {
  if (fw.kind === "static-html") return pages.filter((p) => !PRIVATE.test(p.route)).map((p) => p.file).slice(0, 60);
  const base = fw.root ? `${esc(fw.root)}/` : "";
  return reader
    .list(new RegExp(`^${base}.*\\.(tsx|jsx)$`))
    .filter((f) => !/(^|\/)(__tests__|tests?|stories|storybook)\/|\.(test|spec|stories)\.(t|j)sx$/.test(f) && !/(^|\/)agentronics\//.test(f))
    .slice(0, 250);
}

/** The Markdown fix for this framework: the files it adds, or null if we can't add it here. */
function markdownFiles(reader: RepoReader, fw: Framework, pages: PageInfo[], llms: LlmsDraft | null): string[] | null {
  const dir = moduleDir(reader, fw);
  const ext = fw.typescript ? "ts" : "js";
  const tsx = fw.typescript ? "tsx" : "jsx";
  if (fw.kind === "static-html") {
    const html = pages.filter((p) => !PRIVATE.test(p.route) && !/\/(404|500)$/.test(p.route)).map((p) => p.file);
    return html.length ? html.flatMap((f) => [f.replace(/\.html?$/i, ".md"), f]) : null;
  }
  if (fw.kind === "next-app" && fw.appDir) {
    const layout = rootFiles(reader, fw)[0];
    if (!layout || reader.list(new RegExp(`^${esc(fw.appDir)}/md(/|\\.)`)).length) return null;
    return [`${fw.appDir}/md/[[...path]]/route.${ext}`, `${dir}/markdown.${ext}`, `${dir}/AgentronicsMarkdownLink.${tsx}`, layout];
  }
  if (fw.kind === "next-pages" && fw.pagesDir) {
    if (reader.list(new RegExp(`^${esc(fw.pagesDir)}/api/md(/|\\.)`)).length) return null;
    const app = [".tsx", ".jsx", ".js"].map((e) => `${fw.pagesDir}/_app${e}`).find((p) => reader.has(p)) ?? `${fw.pagesDir}/_app.${tsx}`;
    return [`${fw.pagesDir}/api/md/[[...path]].${ext}`, `${dir}/markdown.${ext}`, `${dir}/AgentronicsMarkdownLink.${tsx}`, app];
  }
  const index = spaIndexHtml(reader, fw);
  return index && llms ? [join(publicDir(fw), "index.md"), index] : null;
}

/** Where the SDK lands: the tools module and its mount point (see codegen.ts). */
function sdkFilesFor(reader: RepoReader, fw: Framework): string[] {
  const dir = moduleDir(reader, fw);
  const tsx = fw.typescript ? "tsx" : "jsx";
  if (fw.kind === "static-html") return [join(dir, "agentronics-webmcp.js"), "every page (one script tag)"];
  const module = `${dir}/webmcp-tools.${fw.typescript ? "ts" : "js"}`;
  if (fw.kind === "next-app") return [module, `${dir}/AgentronicsWebMcp.${tsx}`, rootFiles(reader, fw)[0] ?? `${fw.appDir}/layout.${tsx}`];
  if (fw.kind === "next-pages") return [module, `${dir}/AgentronicsWebMcp.${tsx}`, `${fw.pagesDir}/_app.${tsx}`];
  return [module, fw.entry ?? "your entry file"];
}

/** Before the review: what's missing, and a draft of each fix. */
export async function planSiteFiles(opts: {
  reader: RepoReader;
  fw: Framework;
  pages: PageInfo[];
  digests: PageDigest[];
  llm: Llm | null;
  repoFullName: string;
  githubHomepage: string | null;
  /** Looked up only when nothing in the repo names the address. */
  deployUrl?: () => Promise<string | null>;
}): Promise<SitePlan> {
  const { reader, fw, pages, digests, llm } = opts;
  const pkg = await packageJson(reader, fw);
  let found = await findSiteUrl(reader, fw, opts.githubHomepage);
  if (!found.url && opts.deployUrl) found = await findSiteUrl(reader, fw, null, await opts.deployUrl().catch(() => null));
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
  if (!have["robots-ai"]) {
    const robots = join(pub, "robots.txt");
    const robotsModule = fw.appDir ? reader.list(new RegExp(`^${esc(fw.appDir)}/robots\\.(t|j)s$`))[0] : undefined;
    // An app/robots.ts builds robots.txt in code; we don't rewrite that.
    if (!robotsModule) {
      const existing = reader.exists(robots) ? await reader.read(robots, { anyFile: true }) : null;
      fixes.unshift({
        kind: "robots-ai",
        title: TITLES["robots-ai"],
        found: existing === null ? "No robots.txt." : "robots.txt is written for search engines only. It says nothing to AI agents.",
        plan: `${existing === null ? "Add a robots.txt that names" : "Name"} the AI agents that browse for people (ChatGPT, Claude, Perplexity), keep your usual rules for them, and state your AI usage preference: show in search and AI answers, no training. Change the Content-Signal line if you prefer otherwise.`,
        files: [robots],
        preview: aiRobotsBlock(existing)
      });
    }
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
  if (!have.markdown) {
    const files = markdownFiles(reader, fw, pages, llms);
    if (files) {
      const how =
        fw.kind === "static-html"
          ? `a .md copy of each of your ${files.length / 2} page${files.length === 2 ? "" : "s"}, linked from the page`
          : fw.kind === "next-app"
            ? "a /md route that serves any page as Markdown (/md/pricing is /pricing), linked from every page"
            : fw.kind === "next-pages"
              ? "an /api/md route that serves any page as Markdown, linked from every page"
              : "/index.md (from the llms.txt draft), linked from the home page";
      fixes.push({
        kind: "markdown",
        title: TITLES.markdown,
        found: "Agents only get your HTML. No clean Markdown version.",
        plan: `Add ${how}, so agents read your content without the page's code around it.`,
        // Not trimmed: for plain HTML this is the list of pages that get a .md copy.
        files: files.filter((f, i) => files.indexOf(f) === i),
        preview:
          fw.kind === "static-html"
            ? htmlToMarkdown((await reader.read(files[1]!)) ?? "", facts.url ?? "").slice(0, 1500)
            : `<link rel="alternate" type="text/markdown" href="${fw.kind === "next-pages" ? "/api/md" : fw.kind === "next-app" ? "/md" : "/index.md"}…">`
      });
    }
  }

  const labels = await findLabelTargets({ texts: await reader.readMany(labelFiles(reader, fw, pages)), llm });
  if (labels.length) {
    const controls = labels.filter((l) => l.kind === "control").length;
    const fields = labels.length - controls;
    const files = [...new Set(labels.map((l) => l.file))];
    fixes.push({
      kind: "labels",
      title: TITLES.labels,
      found: [controls ? `${controls} button${controls === 1 ? "" : "s"} or link${controls === 1 ? "" : "s"} with only an icon` : "", fields ? `${fields} form field${fields === 1 ? "" : "s"} with no label` : ""]
        .filter(Boolean)
        .join(", ") + ".",
      plan: "Add an aria-label to each, so agents (and screen readers) know what every button does and what every field wants. Nothing visible changes.",
      files: files.slice(0, 12),
      preview: labels.slice(0, 40).map((l) => `${l.file}: ${l.snippet.slice(0, 90)}  →  "${l.label}"`).join("\n")
    });
  } else present.push("labels");

  if (!have.sdk) {
    fixes.push({
      kind: "sdk",
      title: TITLES.sdk,
      found: "The Agentronics SDK isn't on the site, so nothing reaches your console.",
      plan: `Load the Agentronics SDK on every page with a publishable key Agent Nic creates for ${facts.url ?? "your site's address"}. Agent visits, tool calls and the access rules you set here start working as soon as you merge. No keys to copy, nothing to install.`,
      files: sdkFilesFor(reader, fw),
      preview: `<script src="${SDK_CDN_URL}">\nAgentronics.init({ publishableKey: "agtx_pk_live_… (created when you approve)", siteId: "${facts.url ? new URL(facts.url).hostname : "your-site"}", trace: { gateway: true } })`
    });
  }
  return { facts, fixes, present, llms, routes, labels };
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
  return imp === 0 ? `${importLine}\n${/^import /.test(edited) ? "" : "\n"}${edited}` : `${edited.slice(0, imp)}\n${importLine}${edited.slice(imp)}`;
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
  const robots = join(pub, "robots.txt");
  const hasRobots = () => reader.exists(robots) || result.changes.some((c) => c.path === robots);

  if (want("robots-ai")) {
    if (reader.exists(robots)) {
      const ok = await editFile(result, reader, robots, "AI agent rules", (t) => (robotsTalksToAi(t) ? null : `${t}${t.endsWith("\n") ? "" : "\n"}\n${aiRobotsBlock(t)}`), true);
      if (ok) written["robots-ai"] = [robots];
    } else {
      add("robots-ai", { path: robots, content: `User-agent: *\nAllow: /\n\n${aiRobotsBlock(null)}`, before: null, reason: "robots.txt with AI agent rules" });
    }
  }

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
    if (hasRobots()) {
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
      const mountedIn = await mountInNextRoot(result, reader, fw, compPath, "AgentronicsStructuredData", "structured data");
      if (mountedIn) {
        add("structured-data", { path: compPath, content: structuredComponent(data, fw), before: null, reason: "schema.org structured data" });
        written["structured-data"]!.push(mountedIn);
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
          return beforeHeadEnd(t, block);
        }));
      if (ok && index) (written["structured-data"] ??= []).push(index);
      else result.manualSteps.push("Add the schema.org JSON-LD from the run page to the <head> of your home page.");
    }
  }

  if (want("markdown")) await writeMarkdown(result, reader, fw, plan, url, (c) => add("markdown", c), (p) => (written.markdown ??= []).push(p));

  if (want("labels") && plan.labels?.length) {
    for (const file of [...new Set(plan.labels.map((l) => l.file))]) {
      const ok = await editFile(result, reader, file, "labels for agents", (t) => applyLabels(file, t, plan.labels!));
      if (ok) (written.labels ??= []).push(file);
    }
  }

  // The SDK is written with the tools (codegen.ts); record its files under this fix.
  if (opts.kinds.includes("sdk") && result.sdkFiles?.length) written.sdk = result.sdkFiles;
  result.siteFiles = written;
}

/** Insert `block` (whole lines) just before </head>; null if there's no </head>. */
function beforeHeadEnd(t: string, block: string): string | null {
  const at = t.search(/<\/head>/i);
  if (at === -1) return null;
  const lineStart = t.lastIndexOf("\n", at) + 1;
  return `${t.slice(0, lineStart)}${block}${t.slice(lineStart)}`;
}

/**
 * Render `<Name />` once on every page of a Next.js app: next to {children} in
 * the root layout (App Router) or <Component /> in _app (Pages Router — ours
 * if another step just created it, a new one if there is none). Returns the
 * file it went into, or null (with a manual step) when there's no safe place.
 */
async function mountInNextRoot(result: CodegenResult, reader: RepoReader, fw: Framework, compPath: string, name: string, what: string): Promise<string | null> {
  const tsx = fw.typescript ? "tsx" : "jsx";
  const element = `<${name} />`;
  const importFrom = (file: string) => `import { ${name} } from "${relImport(file, compPath)}";`;
  const host =
    fw.kind === "next-app" && fw.appDir
      ? [".tsx", ".jsx", ".js"].map((e) => `${fw.appDir}/layout${e}`).find((p) => reader.has(p)) ?? null
      : [".tsx", ".jsx", ".js"].map((e) => `${fw.pagesDir}/_app${e}`).find((p) => reader.has(p) || result.changes.some((c) => c.path === p)) ?? null;
  if (host) {
    const current = result.changes.find((c) => c.path === host)?.content ?? (await reader.read(host)) ?? "";
    if (current.includes(`<${name}`)) return host; // mounted by an earlier run
    const ok = await editFile(result, reader, host, what, (t) => mountNextTo(host, t, importFrom(host), element, fw.kind === "next-app" ? "children" : "Component"));
    if (ok) return host;
  } else if (fw.kind === "next-pages" && fw.pagesDir) {
    const path = `${fw.pagesDir}/_app.${tsx}`;
    result.changes.push({
      path,
      before: null,
      reason: `Custom App to add the ${what}`,
      content: `${fw.typescript ? `import type { AppProps } from "next/app";\n` : ""}${importFrom(path)}

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
    return path;
  }
  result.manualSteps.push(`Render \`${element}\` from \`${compPath}\` once in your root layout (we couldn't find a safe place to add it).`);
  return null;
}

/** The Markdown version: .md files for plain HTML, a converting route for Next.js, /index.md elsewhere. */
async function writeMarkdown(
  result: CodegenResult,
  reader: RepoReader,
  fw: Framework,
  plan: SitePlan,
  url: string | null,
  add: (c: FileChange) => void,
  touched: (path: string) => void
): Promise<void> {
  const dir = moduleDir(reader, fw);
  const ext = fw.typescript ? "ts" : "js";
  const tsx = fw.typescript ? "tsx" : "jsx";
  const link = (href: string) => `    <link rel="alternate" type="text/markdown" href="${href}">\n`;

  if (fw.kind === "static-html") {
    const pages = plan.fixes.find((f) => f.kind === "markdown")?.files.filter((f) => /\.html?$/i.test(f)) ?? [];
    for (const file of pages) {
      const html = await reader.read(file);
      if (html === null) continue;
      const md = file.replace(/\.html?$/i, ".md");
      const route = `/${file.slice(fw.root ? fw.root.length + 1 : 0)}`.replace(/(^|\/)index\.html?$/i, "$1");
      add({ path: md, content: htmlToMarkdown(html, url ? `${url}${route}` : ""), before: null, reason: "Markdown version of the page for AI agents" });
      const href = md.split("/").pop()!;
      const ok = await editFile(result, reader, file, "links its Markdown version", (t) => (/type=["']text\/markdown["']/.test(t) ? null : beforeHeadEnd(t, link(href))));
      if (ok) touched(file);
    }
    return;
  }
  if (fw.kind === "next-app" || fw.kind === "next-pages") {
    const runtime = `${dir}/markdown.${ext}`;
    const route = fw.kind === "next-app" ? `${fw.appDir}/md/[[...path]]/route.${ext}` : `${fw.pagesDir}/api/md/[[...path]].${ext}`;
    const linkPath = `${dir}/AgentronicsMarkdownLink.${tsx}`;
    add({ path: runtime, content: fw.typescript ? MARKDOWN_RUNTIME : toJs(MARKDOWN_RUNTIME, "markdown.ts"), before: null, reason: "HTML → Markdown for AI agents" });
    const routeSrc = fw.kind === "next-app" ? nextAppMarkdownRoute(relImport(route, runtime)) : nextPagesMarkdownRoute(relImport(route, runtime), fw.typescript);
    add({ path: route, content: fw.typescript || fw.kind === "next-pages" ? routeSrc : toJs(routeSrc, "route.ts"), before: null, reason: "Serves each page as Markdown" });
    add({ path: linkPath, content: markdownLinkComponent(fw.kind, fw.typescript), before: null, reason: "Links each page's Markdown version" });
    const host = await mountInNextRoot(result, reader, fw, linkPath, "AgentronicsMarkdownLink", "Markdown link");
    if (host) touched(host);
    return;
  }
  const index = spaIndexHtml(reader, fw);
  if (!index || !plan.llms) return;
  add({ path: join(publicDir(fw), "index.md"), content: renderLlms(plan.llms, url), before: null, reason: "Markdown version of the home page for AI agents" });
  const ok = await editFile(result, reader, index, "links the Markdown version", (t) => beforeHeadEnd(t, link("/index.md")));
  if (ok) touched(index);
}
