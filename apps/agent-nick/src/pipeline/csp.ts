// A site with a Content-Security-Policy blocks the Agentronics SDK unless the
// policy allows its script (the CDN) and its API. When Agent Nic installs the
// SDK it adds both hosts to every policy it can find in the repo: Next.js
// headers(), middleware, vercel.json, netlify.toml, _headers files and
// <meta http-equiv> tags. A policy assembled in a way it can't safely edit
// becomes a manual step in the pull request instead of a silent failure.

import { SDK_CDN_ORIGIN, SDK_API_ORIGIN } from "./codegen.ts";

const NEEDS: Record<string, string> = { "script-src": SDK_CDN_ORIGIN, "connect-src": SDK_API_ORIGIN };

// Where policies live. Source files are only edited inside string literals.
export const CSP_FILES = /(^|\/)(next\.config\.(js|mjs|cjs|ts)|middleware\.(t|j)sx?|vercel\.json|netlify\.toml|_headers|[^/]+\.html?|layout\.(t|j)sx?|_document\.(t|j)sx?|server\.(t|j)s|astro\.config\.(m?js|ts))$/;

/** Does a source list already let `host` through? */
function allows(sources: string[], host: string): boolean {
  const h = host.replace(/^https?:\/\//, "");
  return sources.some((s) => s === "*" || s === "https:" || s === host || s === h || s === `https://*.${h.split(".").slice(1).join(".")}` || s === `*.${h.split(".").slice(1).join(".")}`);
}

/**
 * Add the SDK's hosts to one policy string ("default-src 'self'; script-src …").
 * A directive that's missing falls back to default-src, so it's added as a copy
 * of default-src plus the host. Returns null when nothing needs to change.
 */
export function patchPolicy(policy: string, elsewhere: Set<string> = new Set()): string | null {
  const parts = policy.split(";").map((p) => p.trim()).filter(Boolean);
  const directives = parts.map((p) => {
    const [name = "", ...sources] = p.split(/\s+/);
    return { name: name.toLowerCase(), sources };
  });
  const find = (n: string) => directives.find((d) => d.name === n);
  const fallback = find("default-src");
  let changed = false;
  for (const [name, host] of Object.entries(NEEDS)) {
    const d = find(name);
    if (d) {
      if (!allows(d.sources, host) && !d.sources.includes("'none'")) {
        d.sources.push(host);
        changed = true;
      } else if (d.sources.includes("'none'")) {
        d.sources.splice(d.sources.indexOf("'none'"), 1, host);
        changed = true;
      }
    } else if (fallback && !elsewhere.has(name) && !allows(fallback.sources, host)) {
      // (Not when another string in the file already has this directive: a
      // policy built from parts would end up with two, and the first one wins.)
      directives.push({ name, sources: [...fallback.sources.filter((s) => s !== "'none'"), host] });
      changed = true;
    }
  }
  // script-src-elem, when present, wins over script-src for <script src>.
  const elem = find("script-src-elem");
  if (elem && !allows(elem.sources, SDK_CDN_ORIGIN)) {
    elem.sources.push(SDK_CDN_ORIGIN);
    changed = true;
  }
  if (!changed) return null;
  const out = directives.map((d) => [d.name, ...d.sources].join(" ")).join("; ");
  return /;\s*$/.test(policy) ? `${out};` : out;
}

const DIRECTIVE = /(^|[\s;])(default-src|script-src|connect-src|script-src-elem)\s/i;

/**
 * Patch every policy-looking string in a file. Returns the new text (null if
 * unchanged) and whether the file mentions a policy we couldn't edit.
 */
export function patchCspInFile(path: string, text: string): { text: string | null; unpatched: boolean } {
  const mentions = /content-security-policy/i.test(text) && /(^|[\s;"'`])(default-src|script-src|connect-src|script-src-elem)\s/i.test(text);
  if (!mentions) return { text: null, unpatched: false };
  let next = text;
  let found = false;
  // Directives present anywhere in the file (policies are often built from parts).
  const elsewhere = new Set([...text.matchAll(/(?:^|[\s;"'`])(script-src|connect-src)\s/gi)].map((m) => m[1]!.toLowerCase()));
  // Plain string literals (and HTML attribute values / TOML / _headers lines).
  const literal = /(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
  next = next.replace(literal, (whole, q: string, body: string) => {
    if (!DIRECTIVE.test(` ${body} `) || (q === "`" && body.includes("${"))) return whole;
    found = true;
    const own = new Set([...body.matchAll(/(?:^|[\s;])(script-src|connect-src)\s/gi)].map((m) => m[1]!.toLowerCase()));
    const patched = patchPolicy(body, new Set([...elsewhere].filter((d) => !own.has(d))));
    return patched === null ? whole : `${q}${patched}${q}`;
  });
  // _headers files: `Content-Security-Policy: default-src 'self'; …` (no quotes).
  if (/(^|\/)_headers$/.test(path)) {
    next = next.replace(/^(\s*Content-Security-Policy:\s*)(.+)$/gim, (whole, head: string, body: string) => {
      found = true;
      const patched = patchPolicy(body);
      return patched === null ? whole : `${head}${patched}`;
    });
  }
  return { text: next === text ? null : next, unpatched: !found };
}
