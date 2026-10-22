// Shared shapes for the Agent Nick pipeline. Everything here is plain JSON so
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
  /** Can Agent Nick write code for it today? */
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

export interface ReviewDecision {
  tools: { id: string; approved: boolean; auth: AuthPolicy }[];
  approvedBy: string;
}

export interface FileChange {
  path: string;
  content: string;
  /** null → new file. */
  before: string | null;
  reason: string;
}
