// Framework + page discovery — plain code, no model. File conventions and
// package.json tell us almost everything, and they are free to read.

import type { RepoReader } from "./repo.ts";
import type { Framework, FrameworkKind, PageInfo } from "./types.ts";

const LABELS: Record<FrameworkKind, string> = {
  "next-app": "Next.js (App Router)",
  "next-pages": "Next.js (Pages Router)",
  "react-spa": "React (single-page app)",
  "static-html": "Static HTML",
  nuxt: "Nuxt",
  vue: "Vue",
  sveltekit: "SvelteKit",
  astro: "Astro",
  angular: "Angular",
  remix: "Remix / React Router framework",
  unknown: "Unknown"
};

const SUPPORTED = new Set<FrameworkKind>(["next-app", "next-pages", "react-spa", "static-html"]);

interface Pkg {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const join = (root: string, p: string) => (root ? `${root}/${p}` : p);

function kindFromDeps(deps: Record<string, string>): FrameworkKind | null {
  if (deps.next) return "next-app"; // refined to app/pages below
  if (deps.nuxt) return "nuxt";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps.astro) return "astro";
  if (deps["@angular/core"]) return "angular";
  if (deps["@remix-run/react"] || deps["@react-router/dev"]) return "remix";
  if (deps.react && deps["react-dom"]) return "react-spa";
  if (deps.vue) return "vue";
  return null;
}

const PRIORITY: FrameworkKind[] = ["next-app", "nuxt", "sveltekit", "astro", "remix", "react-spa", "vue", "angular"];

/** Pick the web app in the repo (the shallowest, most specific one in a monorepo). */
export async function detectFramework(reader: RepoReader): Promise<Framework> {
  const pkgPaths = reader.list(/(^|\/)package\.json$/).sort((a, b) => a.split("/").length - b.split("/").length);
  const pkgs = await reader.readMany(pkgPaths.slice(0, 40));

  let best: { kind: FrameworkKind; root: string } | null = null;
  for (const path of pkgPaths) {
    const text = pkgs.get(path);
    if (!text) continue;
    let pkg: Pkg;
    try {
      pkg = JSON.parse(text) as Pkg;
    } catch {
      continue;
    }
    const kind = kindFromDeps({ ...pkg.dependencies, ...pkg.devDependencies });
    if (!kind) continue;
    const root = path.split("/").slice(0, -1).join("/");
    if (!best || PRIORITY.indexOf(kind) < PRIORITY.indexOf(best.kind)) best = { kind, root };
  }

  if (!best) {
    const html = reader.list(/\.html?$/i);
    const root = html.length ? commonDir(html) : "";
    return finish(reader, html.length ? "static-html" : "unknown", root);
  }
  return finish(reader, best.kind, best.root);
}

function commonDir(paths: string[]): string {
  const split = paths.map((p) => p.split("/").slice(0, -1));
  const first = split[0] ?? [];
  let i = 0;
  while (i < first.length && split.every((s) => s[i] === first[i])) i++;
  return first.slice(0, i).join("/");
}

async function finish(reader: RepoReader, kind: FrameworkKind, root: string): Promise<Framework> {
  const typescript = reader.has(join(root, "tsconfig.json"));
  const aliases = await readAliases(reader, root);
  const fw: Framework = { kind, root, typescript, supported: false, aliases, label: LABELS[kind] };

  if (kind === "next-app") {
    const appDir = ["src/app", "app"].map((d) => join(root, d)).find((d) => reader.list(new RegExp(`^${esc(d)}/`)).length);
    const pagesDir = ["src/pages", "pages"]
      .map((d) => join(root, d))
      .find((d) => reader.list(new RegExp(`^${esc(d)}/`)).length);
    if (appDir) fw.appDir = appDir;
    else if (pagesDir) {
      fw.kind = "next-pages";
      fw.label = LABELS["next-pages"];
      fw.pagesDir = pagesDir;
    }
  }
  if (fw.kind === "react-spa") {
    const entry = ["src/main.tsx", "src/main.jsx", "src/index.tsx", "src/index.jsx", "src/main.ts", "src/main.js", "src/index.js"]
      .map((p) => join(root, p))
      .find((p) => reader.has(p));
    if (entry) fw.entry = entry;
  }
  fw.supported =
    SUPPORTED.has(fw.kind) &&
    (fw.kind !== "next-app" || !!fw.appDir) &&
    (fw.kind !== "react-spa" || !!fw.entry);
  return fw;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** tsconfig/jsconfig `paths` → prefix map ("@/" → "src/"); defaults to Next's "@/". */
async function readAliases(reader: RepoReader, root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of ["tsconfig.json", "jsconfig.json"]) {
    const text = await reader.read(join(root, name));
    if (!text) continue;
    try {
      // tsconfig allows comments and trailing commas.
      const json = JSON.parse(text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, "$1").replace(/,(\s*[}\]])/g, "$1")) as {
        compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
      };
      const baseUrl = json.compilerOptions?.baseUrl ?? ".";
      for (const [key, targets] of Object.entries(json.compilerOptions?.paths ?? {})) {
        const target = targets[0];
        if (!key.endsWith("/*") || !target?.endsWith("/*")) continue;
        const dir = [root, baseUrl, target.slice(0, -2)]
          .join("/")
          .split("/")
          .filter((s) => s && s !== ".")
          .join("/");
        out[key.slice(0, -1)] = dir ? `${dir}/` : "";
      }
    } catch {
      /* unparseable config — fall back to defaults */
    }
  }
  if (!Object.keys(out).length) {
    out["@/"] = reader.list(new RegExp(`^${esc(join(root, "src"))}/`)).length ? `${join(root, "src")}/` : root ? `${root}/` : "";
  }
  return out;
}

const PAGE_EXT = /\.(tsx|jsx|ts|js)$/;

/** Routes and their page files, by each framework's file conventions. Capped at `max`. */
export function discoverPages(reader: RepoReader, fw: Framework, max = 80): PageInfo[] {
  let pages: PageInfo[] = [];

  if (fw.kind === "next-app" && fw.appDir) {
    const prefix = `${fw.appDir}/`;
    pages = reader
      .list(new RegExp(`^${esc(prefix)}(.*/)?page\\.(tsx|jsx|ts|js|mdx)$`))
      .map((file) => {
        const segs = file
          .slice(prefix.length)
          .split("/")
          .slice(0, -1)
          .filter((s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
        return { route: `/${segs.join("/")}`, file };
      })
      .filter((p) => !p.route.split("/").some((s) => s.startsWith("_")));
  } else if (fw.kind === "next-pages" && fw.pagesDir) {
    const prefix = `${fw.pagesDir}/`;
    pages = reader
      .list(new RegExp(`^${esc(prefix)}.*\\.(tsx|jsx|ts|js)$`))
      .filter((f) => !/\/(_app|_document|_error|404|500)\.\w+$/.test(f) && !f.startsWith(`${prefix}api/`))
      .map((file) => {
        const route = file.slice(prefix.length).replace(PAGE_EXT, "").replace(/(^|\/)index$/, "");
        return { route: `/${route}`, file };
      });
  } else if (fw.kind === "react-spa") {
    // SPAs route in code; conventional page folders give the best map for free.
    const src = join(fw.root, "src");
    const dirs = ["pages", "routes", "views", "screens"].map((d) => `${src}/${d}/`);
    pages = reader
      .list(new RegExp(`^${esc(src)}/(pages|routes|views|screens)/.*\\.(tsx|jsx)$`))
      .filter((f) => !/\.(test|spec|stories)\./.test(f))
      .map((file) => {
        const dir = dirs.find((d) => file.startsWith(d)) ?? "";
        const route = file.slice(dir.length).replace(PAGE_EXT, "").replace(/(^|\/)(index|Index)$/, "");
        return { route: `/${route.replace(/Page$/, "").toLowerCase()}`, file };
      });
    if (!pages.length) {
      const app = ["App.tsx", "App.jsx"].map((f) => `${src}/${f}`).find((f) => reader.has(f));
      if (app) pages = [{ route: "/", file: app }];
    }
  } else if (fw.kind === "static-html") {
    const prefix = fw.root ? `${fw.root}/` : "";
    pages = reader.list(/\.html?$/i).map((file) => {
      const route = file.slice(prefix.length).replace(/\.html?$/i, "").replace(/(^|\/)index$/, "");
      return { route: `/${route}`, file };
    });
  }

  // Shallow, static routes first: they are the pages people and agents use most.
  return pages
    .map((p) => ({ ...p, route: p.route.replace(/\/+$/, "") || "/" }))
    .sort((a, b) => score(a.route) - score(b.route) || a.route.localeCompare(b.route))
    .slice(0, max);
}

const score = (route: string) => route.split("/").length + (route.includes("[") ? 2 : 0);
