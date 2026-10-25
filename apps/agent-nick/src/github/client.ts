// Minimal GitHub REST client for the Agent Nic GitHub App — fetch only, no
// git binary and no clone: we read trees/blobs and write blobs → tree → commit
// → ref → pull request through the API.

import { createSign, timingSafeEqual, createHmac } from "node:crypto";

export class GitHubError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  mode: string;
}

export interface RepoSummary {
  id: number;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  homepage: string | null;
  pushedAt: string | null;
  description: string | null;
}

interface RawRepo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  homepage: string | null;
  pushed_at: string | null;
  description: string | null;
}

const toRepo = (r: RawRepo): RepoSummary => ({
  id: r.id,
  fullName: r.full_name,
  private: r.private,
  defaultBranch: r.default_branch,
  homepage: r.homepage || null,
  pushedAt: r.pushed_at,
  description: r.description
});

type TokenSource = string | null | (() => Promise<string>);

/** A token-scoped GitHub API client (installation token, user token, or none). */
export class GitHub {
  private readonly token: TokenSource;
  private readonly apiBase: string;
  constructor(token: TokenSource, apiBase = "https://api.github.com") {
    this.token = token;
    this.apiBase = apiBase;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = typeof this.token === "function" ? await this.token() : this.token;
    const res = await fetch(path.startsWith("http") ? path : `${this.apiBase}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "agentronics-agent-nick",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      const msg = (data as { message?: string } | undefined)?.message ?? res.statusText;
      throw new GitHubError(`GitHub ${method} ${path} → ${res.status}: ${msg}`, res.status, data);
    }
    return data as T;
  }

  /** Repos this installation can see (all, or the ones the user selected). */
  async installationRepos(limit = 300): Promise<RepoSummary[]> {
    const out: RepoSummary[] = [];
    for (let page = 1; out.length < limit; page++) {
      const r = await this.request<{ repositories: RawRepo[] }>(
        "GET",
        `/installation/repositories?per_page=100&page=${page}`
      );
      out.push(...r.repositories.map(toRepo));
      if (r.repositories.length < 100) break;
    }
    return out.slice(0, limit);
  }

  async repoById(id: number): Promise<RepoSummary> {
    return toRepo(await this.request<RawRepo>("GET", `/repositories/${id}`));
  }

  async repo(fullName: string): Promise<RepoSummary> {
    return toRepo(await this.request<RawRepo>("GET", `/repos/${fullName}`));
  }

  /** Head commit of a branch and its root tree. */
  async branchHead(fullName: string, branch: string): Promise<{ sha: string; treeSha: string }> {
    const ref = await this.request<{ object: { sha: string } }>(
      "GET",
      `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`
    );
    const commit = await this.request<{ tree: { sha: string } }>(
      "GET",
      `/repos/${fullName}/git/commits/${ref.object.sha}`
    );
    return { sha: ref.object.sha, treeSha: commit.tree.sha };
  }

  /** The whole file tree in one call (GitHub truncates past ~100k entries / 7 MB). */
  async tree(fullName: string, treeSha: string): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const t = await this.request<{ tree: TreeEntry[]; truncated: boolean }>(
      "GET",
      `/repos/${fullName}/git/trees/${treeSha}?recursive=1`
    );
    return { entries: t.tree, truncated: t.truncated };
  }

  async blobText(fullName: string, sha: string): Promise<string> {
    const b = await this.request<{ content: string; encoding: string }>(
      "GET",
      `/repos/${fullName}/git/blobs/${sha}`
    );
    return b.encoding === "base64" ? Buffer.from(b.content, "base64").toString("utf8") : b.content;
  }

  /**
   * One commit with all `files` on top of `parentSha`, then point `branch` at
   * it (created if missing, fast-forwarded otherwise). Returns the commit sha.
   */
  async commitFiles(opts: {
    fullName: string;
    branch: string;
    parentSha: string;
    baseTreeSha: string;
    message: string;
    files: { path: string; content: string }[];
    createBranch: boolean;
  }): Promise<string> {
    const { fullName } = opts;
    const tree = await Promise.all(
      opts.files.map(async (f) => {
        const blob = await this.request<{ sha: string }>("POST", `/repos/${fullName}/git/blobs`, {
          content: f.content,
          encoding: "utf-8"
        });
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      })
    );
    const newTree = await this.request<{ sha: string }>("POST", `/repos/${fullName}/git/trees`, {
      base_tree: opts.baseTreeSha,
      tree
    });
    const commit = await this.request<{ sha: string }>("POST", `/repos/${fullName}/git/commits`, {
      message: opts.message,
      tree: newTree.sha,
      parents: [opts.parentSha]
    });
    if (opts.createBranch) {
      await this.request("POST", `/repos/${fullName}/git/refs`, {
        ref: `refs/heads/${opts.branch}`,
        sha: commit.sha
      });
    } else {
      await this.request("PATCH", `/repos/${fullName}/git/refs/heads/${encodeURIComponent(opts.branch)}`, {
        sha: commit.sha,
        force: false
      });
    }
    return commit.sha;
  }

  async createPull(fullName: string, p: { title: string; head: string; base: string; body: string }) {
    return this.request<{ number: number; html_url: string; head: { sha: string } }>(
      "POST",
      `/repos/${fullName}/pulls`,
      { ...p, maintainer_can_modify: true }
    );
  }

  async pull(fullName: string, n: number) {
    return this.request<{
      number: number;
      state: string;
      merged: boolean;
      mergeable: boolean | null;
      additions: number;
      deletions: number;
      changed_files: number;
      head: { sha: string; ref: string };
      merge_commit_sha: string | null;
    }>("GET", `/repos/${fullName}/pulls/${n}`);
  }

  async mergePull(fullName: string, n: number, title: string) {
    return this.request<{ sha: string; merged: boolean; message: string }>(
      "PUT",
      `/repos/${fullName}/pulls/${n}/merge`,
      { merge_method: "squash", commit_title: title }
    );
  }

  /** Bring a PR branch up to date with its base (GitHub merges base into head). */
  async updatePullBranch(fullName: string, n: number) {
    return this.request("PUT", `/repos/${fullName}/pulls/${n}/update-branch`, {});
  }

  async checkRuns(fullName: string, ref: string) {
    return this.request<{
      check_runs: {
        id: number;
        name: string;
        status: string;
        conclusion: string | null;
        output: { title: string | null; summary: string | null; text: string | null };
      }[];
    }>("GET", `/repos/${fullName}/commits/${ref}/check-runs?per_page=100`);
  }

  async checkRunAnnotations(fullName: string, id: number) {
    return this.request<{ path: string; start_line: number; message: string; annotation_level: string }[]>(
      "GET",
      `/repos/${fullName}/check-runs/${id}/annotations?per_page=50`
    );
  }
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** RS256 app JWT (10 min max lifetime; backdated 60s for clock drift). */
export function appJwt(appId: string, privateKeyPem: string, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(privateKeyPem))}`;
}

export interface InstallationInfo {
  id: number;
  account: { login: string; type: string };
  repository_selection: "all" | "selected";
  suspended_at: string | null;
}

export interface GitHubAppConfig {
  appId: string;
  slug: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
  apiBase?: string;
}

export class GitHubApp {
  private tokens = new Map<number, { token: string; expiresAt: number }>();
  private readonly cfg: GitHubAppConfig;

  constructor(cfg: GitHubAppConfig) {
    this.cfg = cfg;
  }

  get installUrl(): string {
    return `https://github.com/apps/${this.cfg.slug}/installations/new`;
  }

  private asApp(): GitHub {
    return new GitHub(appJwt(this.cfg.appId, this.cfg.privateKey), this.cfg.apiBase);
  }

  async installation(id: number): Promise<InstallationInfo> {
    return this.asApp().request<InstallationInfo>("GET", `/app/installations/${id}`);
  }

  /** Installation access token, cached until 5 minutes before it expires. */
  async installationToken(id: number): Promise<string> {
    const hit = this.tokens.get(id);
    if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return hit.token;
    const t = await this.asApp().request<{ token: string; expires_at: string }>(
      "POST",
      `/app/installations/${id}/access_tokens`
    );
    this.tokens.set(id, { token: t.token, expiresAt: Date.parse(t.expires_at) });
    return t.token;
  }

  forInstallation(id: number): GitHub {
    return new GitHub(() => this.installationToken(id), this.cfg.apiBase);
  }

  /** Exchange the install-time OAuth `code` for a short-lived user token. */
  async userToken(code: string): Promise<string> {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code
      })
    });
    const data = (await res.json()) as { access_token?: string; error?: string };
    if (!data.access_token) throw new GitHubError(`oauth exchange failed: ${data.error ?? res.status}`, 400, data);
    return data.access_token;
  }

  /** Installations of THIS app the user can access — proves an installation id is theirs. */
  async userInstallations(userToken: string): Promise<InstallationInfo[]> {
    const gh = new GitHub(userToken, this.cfg.apiBase);
    const out: InstallationInfo[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await gh.request<{ installations: InstallationInfo[] }>(
        "GET",
        `/user/installations?per_page=100&page=${page}`
      );
      out.push(...r.installations);
      if (r.installations.length < 100) break;
    }
    return out;
  }
}

/** X-Hub-Signature-256 check over the raw request body. */
export function verifyWebhookSignature(secret: string, rawBody: string | Buffer, header: string | undefined): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
