// Shared shapes for the Agent Nic pipeline. Everything here is plain JSON so
// it can live in LangGraph checkpoints.

export type FrameworkKind =
  | "next-app"
  | "next-pages"
  | "react-spa"
  | "static-html"
  | "nuxt"
  | "vue"
  | "sveltekit"
  | "astro"
  | "angular"
  | "remix"
  | "unknown";

export interface Framework {
  kind: FrameworkKind;
  /** Directory of the app inside the repo ("" = repo root). */
  root: string;
  typescript: boolean;
  /** Can Agent Nic write code for it today? */
  supported: boolean;
  /** Next.js App Router dir (app or src/app). */
  appDir?: string;
  /** Next.js Pages Router dir (pages or src/pages). */
  pagesDir?: string;
  /** SPA entry module (src/main.tsx…). */
  entry?: string;
  /** Import alias for the app's source root, e.g. "@/" → "src/". */
  aliases: Record<string, string>;
  label: string;
}

export interface PageInfo {
  route: string;
  file: string;
}

export interface FormField {
  name: string | null;
  type: string;
  label: string | null;
  required: boolean;
  options?: string[];
}

export interface FormAction {
  id: string;
  file: string;
  /** Character offset of the `<form` tag in `file` at the base commit. */
  pos: number;
  action: string | null;
  method: string | null;
  onSubmit: string | null;
  fields: FormField[];
  submitText: string | null;
  /** Native/FormData form whose inputs all have names — safe for declarative WebMCP. */
  declarativeReady: boolean;
  alreadyTool: boolean;
}

export interface ButtonAction {
  id: string;
  file: string;
  pos: number;
  text: string;
  handler: string;
}

export interface ApiCall {
  id: string;
  file: string;
  method: string;
  url: string;
  /** Up to ~40 lines of the enclosing function, so a tool can call the same API. */
  snippet: string;
}

export interface ServerAction {
  id: string;
  file: string;
  name: string;
  params: string;
}

export interface PageDigest {
  route: string;
  /** "*" when the actions live in a component shared by most pages. */
  files: string[];
  title: string | null;
  forms: FormAction[];
  buttons: ButtonAction[];
  calls: ApiCall[];
  serverActions: ServerAction[];
}

export type Risk = "read" | "write" | "payment" | "destructive";
export type AuthPolicy = "public" | "signed_in" | "scoped";

export interface ToolProposal {
  /** Row id in agent_nick_tools (set when stored). */
  id?: string;
  page: string;
  name: string;
  kind: "form" | "script";
  /** The digest action this tool wraps (f1, b2, c3, s1…). */
  sourceId: string;
  /** How a script tool reaches the action. */
  strategy: "fetch" | "server_action" | "dom" | "form";
  description: string;
  inputSchema: JsonSchema;
  risk: Risk;
  readOnly: boolean;
  consequential: boolean;
  auth: AuthPolicy;
  rationale: string;
  /** Declarative tools: per-field descriptions (toolparamdescription). */
  fieldDescriptions?: Record<string, string>;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[]; [k: string]: unknown }>;
  required?: string[];
}

/**
 * Site files: the Agent Readiness Score fixes that aren't tools — AI rules in
 * robots.txt, an llms.txt guide, a sitemap, schema.org structured data, a
 * Markdown version of each page, labels for icon-only buttons and unlabeled
 * fields — plus the Agentronics SDK, so the site reports to the console.
 */
export type SiteFixKind = "robots-ai" | "llms-txt" | "sitemap" | "structured-data" | "markdown" | "labels" | "sdk";
export const SITE_FIX_KINDS: SiteFixKind[] = ["robots-ai", "llms-txt", "sitemap", "structured-data", "markdown", "labels", "sdk"];

/** An element that gets an aria-label (see labels.ts). */
export interface LabelFix {
  file: string;
  key: string;
  kind: "control" | "field";
  tag: string;
  snippet: string;
  label: string;
}

/** The SDK settings written into the site: a publishable key (public by design) and the site id. */
export interface SdkInstall {
  publishableKey: string;
  siteId: string;
}

export interface SiteFacts {
  /** The public address of the site, when we could find it. */
  url: string | null;
  /** Where the address came from (GitHub homepage, package.json, metadataBase…). */
  urlSource: string | null;
  name: string;
  description: string | null;
}

/** Gemini's draft of llms.txt; rendered with the final site address at write time. */
export interface LlmsDraft {
  name: string;
  summary: string;
  sections: { title: string; links: { path: string; label: string; note: string }[] }[];
}

export interface SiteFix {
  kind: SiteFixKind;
  title: string;
  /** What the repo has today, in plain words. */
  found: string;
  /** What the PR adds. */
  plan: string;
  /** Files it creates or edits. */
  files: string[];
  /** A preview for the review (llms.txt text, the sitemap's routes, the JSON-LD). */
  preview: string;
}

export interface SitePlan {
  facts: SiteFacts;
  /** Missing pieces we can write. */
  fixes: SiteFix[];
  /** Pieces the repo already has. */
  present: SiteFixKind[];
  llms: LlmsDraft | null;
  /** Static routes for the sitemap. */
  routes: string[];
  /** Elements that get an aria-label (absent on runs planned before labels existed). */
  labels?: LabelFix[];
}

export interface ReviewDecision {
  tools: { id: string; approved: boolean; auth: AuthPolicy }[];
  /** Which site files to add (absent on runs reviewed before site files existed). */
  siteFiles?: { kind: SiteFixKind; approved: boolean }[];
  /** The address the sitemap and structured data use. */
  siteUrl?: string | null;
  approvedBy: string;
}

export interface FileChange {
  path: string;
  content: string;
  /** null → new file. */
  before: string | null;
  reason: string;
}
