import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@agentronics/intel-schema/db";
import { AuthError, type AuthVerifier } from "./auth.ts";
import type { Executor } from "./executor.ts";
import { GitHubError, verifyWebhookSignature, type GitHub, type GitHubApp } from "./github/client.ts";
import { handleWebhook, markMerged, type FollowupDeps } from "./pipeline/followup.ts";
import { limitError, runsThisMonth, siteCount, tenantPlan } from "./plan.ts";
import type { ToolStrategy } from "@agentronics/intel-schema";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    tenantId: string;
    isAdmin: boolean;
    rawBody: string;
  }
}

export interface ServerDeps {
  db: Db;
  auth: AuthVerifier;
  app: Pick<GitHubApp, "userToken" | "userInstallations" | "installation">;
  github: (installationId: number) => GitHub;
  executor: Executor;
  followup: FollowupDeps;
  webhookSecret: string;
  /** Local dev: trust "dev-tenant:<uuid>" tokens (never in production — env refuses it). */
  devAuth?: boolean;
}

const ACTIVE = ["queued", "running", "awaiting_review"];


export function buildServer(deps: ServerDeps) {
  const { db, executor } = deps;
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
      redact: ["req.headers.authorization"]
    },
    bodyLimit: 2 * 1024 * 1024
  });

  // Keep the raw body: GitHub signs the exact bytes it sent.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    req.rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: "invalid_request", issues: err.issues });
    if (err instanceof GitHubError) {
      req.log.warn({ status: err.status, msg: err.message }, "github error");
      return reply.status(err.status === 404 ? 404 : 502).send({ error: "github_error", message: err.message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal_error", request_id: req.id });
  });

  app.get("/health", async () => ({ ok: true }));

  // ---- GitHub webhook (signed) -----------------------------------------------
  app.post("/github/webhook", async (req, reply) => {
    const sig = req.headers["x-hub-signature-256"];
    if (!verifyWebhookSignature(deps.webhookSecret, req.rawBody ?? "", typeof sig === "string" ? sig : undefined)) {
      return reply.status(401).send({ error: "invalid_signature" });
    }
    const event = String(req.headers["x-github-event"] ?? "");
    const result = await handleWebhook(deps.followup, event, req.body as Record<string, unknown>);
    req.log.info({ event, result }, "github webhook");
    return { ok: true, result };
  });

  // ---- console API (Clerk session) -------------------------------------------
  app.register(async (api) => {
    api.addHook("preHandler", async (req, reply) => {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) return reply.status(401).send({ error: "missing_bearer_token" });
      const dev = deps.devAuth ? /^Bearer dev-tenant:([0-9a-f-]{36})$/.exec(header) : null;
      if (dev?.[1]) {
        req.userId = "dev";
        req.isAdmin = true;
        req.tenantId = dev[1];
        return;
      }
      let ctx;
      try {
        ctx = await deps.auth.verify(header.slice("Bearer ".length));
      } catch (err) {
        if (!(err instanceof AuthError)) throw err;
        return reply.status(401).send({ error: "invalid_token" });
      }
      const [tenant] = await db
        .insert(schema.tenants)
        .values({ name: ctx.orgKey, clerkOrgId: ctx.orgKey })
        .onConflictDoUpdate({ target: schema.tenants.clerkOrgId, set: { clerkOrgId: ctx.orgKey } })
        .returning({ id: schema.tenants.id });
      req.userId = ctx.userId;
      req.isAdmin = ctx.isAdmin;
      req.tenantId = (tenant as { id: string }).id;
    });

    const requireAdmin = (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.isAdmin) {
        void reply.status(403).send({ error: "admin_required", message: "Only organization admins can do this." });
        return false;
      }
      return true;
    };

    const ownedInstallation = async (tenantId: string, installationId: number) => {
      const [row] = await db
        .select()
        .from(schema.githubInstallations)
        .where(
          and(
            eq(schema.githubInstallations.tenantId, tenantId),
            eq(schema.githubInstallations.installationId, installationId),
            isNull(schema.githubInstallations.deletedAt)
          )
        );
      return row ?? null;
    };

    /** Link a GitHub App installation — only after GitHub confirms this user can access it. */
    api.post("/v1/github/installations", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const body = z.object({ code: z.string().min(1).max(200), installationId: z.coerce.number().int().positive() }).parse(req.body);
      const userToken = await deps.app.userToken(body.code);
      const visible = await deps.app.userInstallations(userToken);
      const inst = visible.find((i) => i.id === body.installationId);
      if (!inst) return reply.status(403).send({ error: "installation_not_yours" });
      await db
        .insert(schema.githubInstallations)
        .values({
          tenantId: req.tenantId,
          installationId: inst.id,
          accountLogin: inst.account.login,
          accountType: inst.account.type,
          repositorySelection: inst.repository_selection,
          installedBy: req.userId
        })
        .onConflictDoUpdate({
          target: [schema.githubInstallations.tenantId, schema.githubInstallations.installationId],
          set: {
            accountLogin: inst.account.login,
            accountType: inst.account.type,
            repositorySelection: inst.repository_selection,
            deletedAt: null,
            suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null
          }
        });
      return { installationId: inst.id, account: inst.account.login };
    });

    /** Every repo the tenant's installations can see, flagged when already added. */
    api.get("/v1/github/repos", async (req) => {
      const installs = await db
        .select()
        .from(schema.githubInstallations)
        .where(and(eq(schema.githubInstallations.tenantId, req.tenantId), isNull(schema.githubInstallations.deletedAt)));
      const sites = await db
        .select({ repoId: schema.agentNickSites.repoId, id: schema.agentNickSites.id })
        .from(schema.agentNickSites)
        .where(eq(schema.agentNickSites.tenantId, req.tenantId));
      const siteByRepo = new Map(sites.map((s) => [s.repoId, s.id]));
      const lists = await Promise.all(
        installs.map(async (i) => {
          try {
            const repos = await deps.github(i.installationId).installationRepos();
            return repos.map((r) => ({ ...r, installationId: i.installationId, account: i.accountLogin, siteId: siteByRepo.get(r.id) ?? null }));
          } catch (err) {
            if (err instanceof GitHubError && (err.status === 404 || err.status === 401)) {
              await db.update(schema.githubInstallations).set({ deletedAt: new Date() }).where(eq(schema.githubInstallations.id, i.id));
              return [];
            }
            throw err;
          }
        })
      );
      return { repos: lists.flat().sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")) };
    });

    /** Hand a repo to Agent Nick (creates the site). */
    api.post("/v1/sites", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const body = z.object({ installationId: z.coerce.number().int().positive(), repoId: z.coerce.number().int().positive() }).parse(req.body);
      if (!(await ownedInstallation(req.tenantId, body.installationId))) return reply.status(404).send({ error: "installation_not_found" });
      const plan = await tenantPlan(db, req.tenantId);
      const maxSites = plan.limits.agentNickSites;
      if (maxSites !== null && (await siteCount(db, req.tenantId, body.repoId)) >= maxSites) {
        return reply
          .status(402)
          .send(limitError(`Your ${plan.name} plan includes ${maxSites} site${maxSites === 1 ? "" : "s"}.`, (p) => (p.limits.agentNickSites ?? Infinity) > maxSites));
      }
      const repo = await deps.github(body.installationId).repoById(body.repoId); // proves the installation can see it
      const [site] = await db
        .insert(schema.agentNickSites)
        .values({
          tenantId: req.tenantId,
          installationId: body.installationId,
          repoId: repo.id,
          repoFullName: repo.fullName,
          defaultBranch: repo.defaultBranch,
          isPrivate: repo.private,
          homepage: repo.homepage
        })
        .onConflictDoUpdate({
          target: [schema.agentNickSites.tenantId, schema.agentNickSites.repoId],
          set: { installationId: body.installationId, repoFullName: repo.fullName, defaultBranch: repo.defaultBranch, homepage: repo.homepage, updatedAt: new Date() }
        })
        .returning({ id: schema.agentNickSites.id });
      return { siteId: site?.id };
    });

    /** Start a pipeline run on a site. */
    api.post<{ Params: { id: string } }>("/v1/sites/:id/runs", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const siteId = z.string().uuid().parse(req.params.id);
      const [site] = await db
        .select()
        .from(schema.agentNickSites)
        .where(and(eq(schema.agentNickSites.id, siteId), eq(schema.agentNickSites.tenantId, req.tenantId)));
      if (!site) return reply.status(404).send({ error: "site_not_found" });
      if (!(await ownedInstallation(req.tenantId, site.installationId))) return reply.status(409).send({ error: "github_disconnected" });
      const [active] = await db
        .select({ id: schema.agentNickRuns.id })
        .from(schema.agentNickRuns)
        .where(and(eq(schema.agentNickRuns.siteId, siteId), inArray(schema.agentNickRuns.status, ACTIVE)))
        .orderBy(desc(schema.agentNickRuns.createdAt))
        .limit(1);
      if (active) return reply.status(409).send({ error: "run_in_progress", runId: active.id });
      const plan = await tenantPlan(db, req.tenantId);
      const maxRuns = plan.limits.agentNickRunsPerMonth;
      if (maxRuns !== null && (await runsThisMonth(db, req.tenantId)) >= maxRuns) {
        return reply
          .status(402)
          .send(limitError(`You've used ${maxRuns === 1 ? "the 1 Agent Nick run" : `all ${maxRuns} Agent Nick runs`} in your ${plan.name} plan this month.`, (p) => (p.limits.agentNickRunsPerMonth ?? Infinity) > maxRuns));
      }
      const [run] = await db
        .insert(schema.agentNickRuns)
        .values({ tenantId: req.tenantId, siteId, createdBy: req.userId })
        .returning({ id: schema.agentNickRuns.id });
      if (!run) throw new Error("could not create run");
      await db.update(schema.agentNickSites).set({ status: "running", lastRunId: run.id, updatedAt: new Date() }).where(eq(schema.agentNickSites.id, siteId));
      executor.dispatch("start", run.id);
      return reply.status(202).send({ runId: run.id });
    });

    /** The customer's review: which tools, who may use them. Resumes the paused graph. */
    api.post<{ Params: { id: string } }>("/v1/runs/:id/review", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const runId = z.string().uuid().parse(req.params.id);
      const body = z
        .object({
          tools: z
            .array(z.object({ id: z.string().uuid(), approved: z.boolean(), auth: z.enum(["public", "signed_in", "scoped"]) }))
            .max(100)
        })
        .parse(req.body);

      // Plan limits: how many tools, and which kinds, this workspace may ship.
      const plan = await tenantPlan(db, req.tenantId);
      const approvedIds = body.tools.filter((t) => t.approved).map((t) => t.id);
      const max = plan.limits.agentNickToolsPerSite;
      if (max !== null && approvedIds.length > max) {
        return reply
          .status(402)
          .send(limitError(`Your ${plan.name} plan includes up to ${max} tools per site; you approved ${approvedIds.length}.`, (p) => (p.limits.agentNickToolsPerSite ?? Infinity) >= approvedIds.length));
      }
      if (approvedIds.length) {
        const kinds = await db
          .select({ name: schema.agentNickTools.name, source: schema.agentNickTools.source })
          .from(schema.agentNickTools)
          .where(and(eq(schema.agentNickTools.runId, runId), inArray(schema.agentNickTools.id, approvedIds)));
        const locked = kinds.filter((k) => !plan.limits.agentNickStrategies.includes((k.source as { strategy: ToolStrategy }).strategy));
        if (locked.length) {
          const need = (locked[0]?.source as { strategy: ToolStrategy }).strategy;
          return reply
            .status(402)
            .send(limitError(`${locked.map((k) => k.name).join(", ")} ${locked.length === 1 ? "isn't" : "aren't"} included in your ${plan.name} plan.`, (p) => p.limits.agentNickStrategies.includes(need)));
        }
      }

      const decision = { tools: body.tools, approvedBy: req.userId };
      // Flip the status first so a double-submit can't resume the graph twice.
      const [run] = await db
        .update(schema.agentNickRuns)
        .set({ status: "running", step: "write", decision, updatedAt: new Date() })
        .where(and(eq(schema.agentNickRuns.id, runId), eq(schema.agentNickRuns.tenantId, req.tenantId), eq(schema.agentNickRuns.status, "awaiting_review")))
        .returning({ id: schema.agentNickRuns.id, siteId: schema.agentNickRuns.siteId });
      if (!run) return reply.status(409).send({ error: "not_awaiting_review" });

      for (const t of body.tools) {
        await db
          .update(schema.agentNickTools)
          .set({ approved: t.approved, auth: t.auth })
          .where(and(eq(schema.agentNickTools.id, t.id), eq(schema.agentNickTools.runId, runId)));
      }
      await db.update(schema.agentNickSites).set({ status: "running", updatedAt: new Date() }).where(eq(schema.agentNickSites.id, run.siteId));
      executor.dispatch("resume", runId);
      return reply.status(202).send({ ok: true });
    });

    api.post<{ Params: { id: string } }>("/v1/runs/:id/cancel", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const runId = z.string().uuid().parse(req.params.id);
      const [run] = await db
        .update(schema.agentNickRuns)
        .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(schema.agentNickRuns.id, runId), eq(schema.agentNickRuns.tenantId, req.tenantId), inArray(schema.agentNickRuns.status, ["queued", "awaiting_review"])))
        .returning({ siteId: schema.agentNickRuns.siteId });
      if (!run) return reply.status(409).send({ error: "cannot_cancel" });
      const [site] = await db.select({ liveSha: schema.agentNickSites.liveSha }).from(schema.agentNickSites).where(eq(schema.agentNickSites.id, run.siteId));
      await db
        .update(schema.agentNickSites)
        .set({ status: site?.liveSha ? "live" : "new", updatedAt: new Date() })
        .where(eq(schema.agentNickSites.id, run.siteId));
      return { ok: true };
    });

    /** "Accept" in the console: merge the PR (branch protection still applies). */
    api.post<{ Params: { id: string } }>("/v1/runs/:id/merge", async (req, reply) => {
      if (!requireAdmin(req, reply)) return;
      const runId = z.string().uuid().parse(req.params.id);
      const [hit] = await db
        .select({ run: schema.agentNickRuns, site: schema.agentNickSites })
        .from(schema.agentNickRuns)
        .innerJoin(schema.agentNickSites, eq(schema.agentNickRuns.siteId, schema.agentNickSites.id))
        .where(and(eq(schema.agentNickRuns.id, runId), eq(schema.agentNickRuns.tenantId, req.tenantId)));
      if (!hit?.run.prNumber || hit.run.status !== "pr_open") return reply.status(409).send({ error: "no_open_pr" });
      const gh = deps.github(hit.site.installationId);
      const pr = await gh.pull(hit.site.repoFullName, hit.run.prNumber);
      if (pr.state !== "open") return reply.status(409).send({ error: "pr_not_open" });
      if (pr.mergeable === false) {
        // Usually the default branch moved; GitHub can bring the branch up to date.
        await gh.updatePullBranch(hit.site.repoFullName, hit.run.prNumber).catch(() => undefined);
        return reply.status(409).send({ error: "merge_conflict", message: "The branch was out of date — we asked GitHub to update it. Try again in a minute, or resolve it on GitHub." });
      }
      try {
        const merged = await gh.mergePull(hit.site.repoFullName, hit.run.prNumber, `Make this site agent-ready (#${hit.run.prNumber})`);
        await markMerged(db, runId, hit.site.id, merged.sha, hit.run.toolsApproved);
        return { ok: true, sha: merged.sha };
      } catch (err) {
        if (err instanceof GitHubError && (err.status === 405 || err.status === 409)) {
          return reply.status(409).send({ error: "merge_blocked", message: err.message });
        }
        throw err;
      }
    });
  });

  return app;
}
