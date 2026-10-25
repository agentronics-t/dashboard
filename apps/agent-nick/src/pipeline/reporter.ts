// Writes each step's progress to agent_nick_events / agent_nick_runs — the
// console polls these rows to draw the live pipeline.

import { eq, sql } from "drizzle-orm";
import { schema, type Db } from "@agentronics/intel-schema/db";
import type { Usage } from "../llm/gemini.ts";

export type StepId =
  | "read"
  | "framework"
  | "pages"
  | "actions"
  | "site"
  | "propose"
  | "review"
  | "write"
  | "validate"
  | "pr"
  | "ci"
  | "live";

type RunPatch = Partial<typeof schema.agentNickRuns.$inferInsert>;

export class RunReporter {
  private readonly db: Db;
  readonly runId: string;
  constructor(db: Db, runId: string) {
    this.db = db;
    this.runId = runId;
  }

  private async event(step: StepId, kind: string, message: string, data?: unknown) {
    await this.db.insert(schema.agentNickEvents).values({
      runId: this.runId,
      step,
      kind,
      message: message.slice(0, 2000),
      ...(data === undefined ? {} : { data })
    });
  }

  async start(step: StepId, message: string, data?: unknown) {
    await this.update({ step, status: "running" });
    await this.event(step, "start", message, data);
  }

  done = (step: StepId, message: string, data?: unknown) => this.event(step, "done", message, data);
  info = (step: StepId, message: string, data?: unknown) => this.event(step, "info", message, data);

  async wait(step: StepId, message: string, status: string) {
    await this.update({ step, status });
    await this.event(step, "wait", message);
  }

  async fail(step: StepId, message: string) {
    await this.update({ step, status: "failed", error: message.slice(0, 2000), finishedAt: new Date() });
    await this.event(step, "fail", message);
  }

  async update(patch: RunPatch) {
    await this.db
      .update(schema.agentNickRuns)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.agentNickRuns.id, this.runId));
  }

  /** Add the model usage spent since `before`. */
  async addUsage(before: Usage, after: Usage) {
    const dIn = after.tokensIn - before.tokensIn;
    const dOut = after.tokensOut - before.tokensOut;
    const dCost = after.costUsd - before.costUsd;
    if (!dIn && !dOut) return;
    await this.db
      .update(schema.agentNickRuns)
      .set({
        tokensIn: sql`${schema.agentNickRuns.tokensIn} + ${dIn}`,
        tokensOut: sql`${schema.agentNickRuns.tokensOut} + ${dOut}`,
        costUsd: sql`${schema.agentNickRuns.costUsd} + ${dCost}`
      })
      .where(eq(schema.agentNickRuns.id, this.runId));
  }
}
