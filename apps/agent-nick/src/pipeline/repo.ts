// Read-only view of a repo at one commit, through the GitHub API (no clone).
// One call lists every path; file bodies are fetched lazily, only for the
// files a later step actually needs, and cached for the rest of the run.

import type { GitHub, TreeEntry } from "../github/client.ts";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".output",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__tests__",
  "__mocks__",
  "storybook-static"
]);

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro|html?)$/i;
const MAX_FILE_BYTES = 300_000;

export interface RepoFile {
  path: string;
  sha: string;
  size: number;
}

export class RepoReader {
  /** Source files (code + package/tsconfig) — what the analysis steps read. */
  readonly files: RepoFile[];
  private readonly byPath: Map<string, RepoFile>;
  /** Every file outside ignored dirs (README, robots.txt, llms.txt, sitemap.xml, CNAME…). */
  private readonly allByPath: Map<string, RepoFile>;
  private readonly cache = new Map<string, Promise<string | null>>();
  private readonly gh: GitHub;
  readonly fullName: string;

  constructor(gh: GitHub, fullName: string, entries: TreeEntry[]) {
    this.gh = gh;
    this.fullName = fullName;
    const all = entries
      .filter((e) => e.type === "blob")
      .filter((e) => !e.path.split("/").some((seg) => IGNORED_DIRS.has(seg)))
      .map((e) => ({ path: e.path, sha: e.sha, size: e.size ?? 0 }));
    this.allByPath = new Map(all.map((f) => [f.path, f]));
    this.files = all.filter((f) => CODE_EXT.test(f.path) || /(^|\/)(package\.json|tsconfig\.json|jsconfig\.json)$/.test(f.path));
    this.byPath = new Map(this.files.map((f) => [f.path, f]));
  }

  /** Any file in the repo, not just source files. */
  exists(path: string): boolean {
    return this.allByPath.has(path);
  }

  listAll(re: RegExp): string[] {
    return [...this.allByPath.keys()].filter((p) => re.test(p));
  }

  has(path: string): boolean {
    return this.byPath.has(path);
  }

  list(re: RegExp): string[] {
    return this.files.filter((f) => re.test(f.path)).map((f) => f.path);
  }

  /** Text of a source file — or, with `anyFile`, of any file in the repo. */
  read(path: string, { anyFile = false }: { anyFile?: boolean } = {}): Promise<string | null> {
    const key = anyFile ? `*${path}` : path;
    let p = this.cache.get(key);
    if (!p) {
      const f = (anyFile ? this.allByPath : this.byPath).get(path);
      p =
        !f || f.size > MAX_FILE_BYTES
          ? Promise.resolve(null)
          : this.gh.blobText(this.fullName, f.sha).catch(() => null);
      this.cache.set(key, p);
    }
    return p;
  }

  async readMany(paths: string[], concurrency = 8): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const queue = [...new Set(paths)];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
          const text = await this.read(p);
          if (text !== null) out.set(p, text);
        }
      })
    );
    return out;
  }
}

/** Resolve a relative or aliased import to a file in the repo, or null. */
export function resolveImport(
  reader: Pick<RepoReader, "has">,
  fromFile: string,
  spec: string,
  aliases: Record<string, string>
): string | null {
  let base: string | null = null;
  if (spec.startsWith(".")) {
    const dir = fromFile.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "..") dir.pop();
      else if (part !== ".") dir.push(part);
    }
    base = dir.join("/");
  } else {
    for (const [prefix, target] of Object.entries(aliases)) {
      if (spec.startsWith(prefix)) {
        base = `${target}${spec.slice(prefix.length)}`.replace(/^\/+/, "");
        break;
      }
    }
  }
  if (base === null) return null;
  const candidates = [
    base,
    ...[".tsx", ".ts", ".jsx", ".js", ".mjs"].map((e) => base + e),
    ...["/index.tsx", "/index.ts", "/index.jsx", "/index.js"].map((e) => base + e)
  ];
  return candidates.find((c) => reader.has(c)) ?? null;
}
