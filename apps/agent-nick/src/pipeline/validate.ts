// Last check before anything is pushed: every changed file must still parse,
// and the generated module must follow the WebMCP guide's hard rules. The
// customer's own CI runs the real build and tests on the PR.

import ts from "typescript";
import type { FileChange } from "./types.ts";

export interface FileIssue {
  path: string;
  issues: string[];
}

function jsonLdIssues(content: string): string[] {
  const issues: string[] = [];
  for (const m of content.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(m[1] ?? "");
    } catch {
      issues.push("JSON-LD block is not valid JSON");
    }
  }
  return issues;
}

function syntaxIssues(path: string, content: string): string[] {
  if (/\.html?$/i.test(path)) {
    const opens = (content.match(/<script\b/gi) ?? []).length;
    const closes = (content.match(/<\/script>/gi) ?? []).length;
    return [...(opens === closes ? [] : ["unbalanced <script> tags"]), ...jsonLdIssues(content)];
  }
  if (/(^|\/)llms\.txt$/.test(path)) return /^# \S/.test(content) && /\]\(/.test(content) ? [] : ["llms.txt needs a # title and at least one link"];
  if (/\.xml$/i.test(path)) {
    const urls = (content.match(/<loc>/g) ?? []).length;
    return /<urlset[\s>]/.test(content) && /<\/urlset>\s*$/.test(content) && urls > 0 ? [] : ["sitemap.xml is not a valid <urlset> with at least one <loc>"];
  }
  if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) return [];
  const out = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.Preserve }
  });
  return (out.diagnostics ?? []).map((d) => {
    const pos = d.start !== undefined && d.file ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    return `${pos ? `line ${pos.line + 1}: ` : ""}${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

function moduleIssues(content: string): string[] {
  const issues: string[] = [];
  if (!/"modelContext" in document/.test(content)) issues.push("missing WebMCP feature detection");
  if (/navigator\.modelContext|unregisterTool\(|provideContext\(/.test(content)) issues.push("uses a removed WebMCP API");
  if (!/registerTool\(tool, \{ signal \}\)/.test(content)) issues.push("tools are not registered with an AbortSignal");
  return issues;
}

export function validateChanges(changes: FileChange[]): FileIssue[] {
  const problems: FileIssue[] = [];
  for (const c of changes) {
    const issues = syntaxIssues(c.path, c.content);
    if (/(webmcp-tools|agentronics-webmcp)\.(t|j)s$/.test(c.path)) issues.push(...moduleIssues(c.content));
    if (issues.length) problems.push({ path: c.path, issues });
  }
  return problems;
}

/** Rough line diff for the summary (GitHub's own numbers replace it once the PR exists). */
export function diffStat(changes: FileChange[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const c of changes) {
    const after = c.content.split("\n");
    if (c.before === null) {
      additions += after.length;
      continue;
    }
    const before = new Map<string, number>();
    for (const l of c.before.split("\n")) before.set(l, (before.get(l) ?? 0) + 1);
    for (const l of after) {
      const n = before.get(l) ?? 0;
      if (n > 0) before.set(l, n - 1);
      else additions++;
    }
    for (const n of before.values()) deletions += n;
  }
  return { additions, deletions };
}
