"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { upgradeFor } from "@agentronics/intel-schema";
import { schema } from "@agentronics/intel-schema/db";
import { getWorkspacePlan } from "@/lib/billing";
import { getToolDescriptions, getTools } from "@/lib/pillars";
import { db, getTenantId, requireWorkspaceAdmin } from "@/lib/tenant";
import { descriptorTokens } from "@/lib/toolTokens";
import { generateJson } from "@/lib/vertex";

// What a good WebMCP tool description looks like (from Google's WebMCP
// guidance): say what the tool does and when to use it, in plain words, and
// leave parameter details to the input schema.
const SYSTEM = `You rewrite descriptions of WebMCP tools — functions a website exposes to AI agents.
An agent reads every tool's description on every page, so each word costs tokens on every call.
Rewrite each description so that it:
- starts with a verb and says what the tool does and when an agent should use it;
- keeps every fact an agent needs to choose the tool correctly (side effects, what it returns, whether the user must confirm);
- drops filler ("This tool allows you to…", "Use this function in order to…"), marketing words, and anything already in the input schema (parameter names, types, formats);
- is at most 2 short sentences and never longer than the original;
- never invents behaviour that the original doesn't state.
If the original is already tight, return it unchanged. Answer in JSON.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tools: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          rationale: { type: "string", description: "One short clause: what changed." }
        },
        required: ["name", "description", "rationale"]
      }
    }
  },
  required: ["tools"]
};

const FILLER = [
  /^(this|the) (tool|function|action) (allows|lets|enables) (you|the (user|agent)) to\s+/i,
  /^(use|call) this (tool|function) (to|in order to)\s+/i,
  /^(this|the) (tool|function) (is used to|will)\s+/i,
  /^allows? (you|the (user|agent)) to\s+/i
];

/** Deterministic tightening when Gemini isn't available: strip filler, keep two sentences. */
function tighten(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  for (const re of FILLER) t = t.replace(re, "");
  t = t.charAt(0).toUpperCase() + t.slice(1);
  const sentences = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  t = sentences.slice(0, 2).join(" ").trim();
  return t.length < text.trim().length ? t : text.trim();
}

/**
 * Write optimised descriptions for a site's tools (all, or the named ones) and
 * store them as suggestions next to the originals. Approved suggestions are
 * served to the SDK by POST /v1/sdk/config.
 */
export async function suggestDescriptions(siteId: string, toolNames?: string[]): Promise<{ suggested: number; model: string }> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const { spec } = await getWorkspacePlan(tenantId);
  if (!spec.features.siteMemory) {
    const next = upgradeFor((p) => p.features.siteMemory);
    throw new Error(`Procedural memory isn't included in the ${spec.name} plan${next ? ` — upgrade to ${next.name}` : ""}.`);
  }

  // A plain "rewrite" leaves approved descriptions alone; name a tool to redo it.
  const approved = new Set(
    (await getToolDescriptions(tenantId)).filter((d) => d.siteId === siteId && d.status === "approved").map((d) => d.toolName)
  );
  const tools = (await getTools(tenantId)).filter(
    (t) =>
      t.siteId === siteId &&
      (t.description ?? "").trim() &&
      (toolNames?.length ? toolNames.includes(t.toolName) : !approved.has(t.toolName))
  );
  if (!tools.length) return { suggested: 0, model: "none" };

  const payload = tools.map((t) => ({ name: t.toolName, title: t.title, description: t.description, inputSchema: t.inputSchema }));
  const ai = await generateJson<{ tools: { name: string; description: string; rationale: string }[] }>(
    SYSTEM,
    `Rewrite these tool descriptions:\n${JSON.stringify(payload, null, 2)}`,
    RESPONSE_SCHEMA
  );
  const model = ai ? process.env.PROCEDURAL_MODEL || "gemini-3.8-flash" : "rules";
  const byName = new Map((ai?.tools ?? []).map((t) => [t.name, t]));

  let suggested = 0;
  for (const t of tools) {
    const original = t.description!.trim();
    const fromAi = byName.get(t.toolName);
    let text = (fromAi?.description ?? tighten(original)).trim().slice(0, 2000);
    const base = { name: t.toolName, title: t.title, inputSchema: t.inputSchema, annotations: t.annotations };
    const originalTokens = descriptorTokens({ ...base, description: original });
    let suggestedTokens = descriptorTokens({ ...base, description: text });
    // Never suggest something longer than what's there.
    if (!text || suggestedTokens > originalTokens) {
      text = original;
      suggestedTokens = originalTokens;
    }
    const values = {
      original,
      suggested: text,
      originalTokens,
      suggestedTokens,
      rationale: text === original ? "Already concise." : (fromAi?.rationale?.slice(0, 300) ?? "Removed filler; kept the first two sentences."),
      // Nothing to approve when the rewrite is the original.
      status: text === original ? "rejected" : "suggested",
      model,
      decidedAt: null
    };
    await db()
      .insert(schema.sdkToolDescriptions)
      .values({ tenantId, siteId, toolName: t.toolName, ...values })
      .onConflictDoUpdate({
        target: [schema.sdkToolDescriptions.tenantId, schema.sdkToolDescriptions.siteId, schema.sdkToolDescriptions.toolName],
        set: { ...values, createdAt: new Date() }
      });
    suggested += 1;
  }
  revalidatePath("/knaph");
  return { suggested, model };
}

/** Approve (optionally after editing), reject, or reset a suggestion. */
export async function decideDescription(
  input: { siteId: string; toolName: string; decision: "approved" | "rejected" | "suggested"; text?: string }
): Promise<void> {
  await requireWorkspaceAdmin();
  const tenantId = await getTenantId();
  const where = and(
    eq(schema.sdkToolDescriptions.tenantId, tenantId),
    eq(schema.sdkToolDescriptions.siteId, input.siteId),
    eq(schema.sdkToolDescriptions.toolName, input.toolName)
  );
  const set: Partial<typeof schema.sdkToolDescriptions.$inferInsert> = {
    status: input.decision,
    decidedAt: input.decision === "suggested" ? null : new Date()
  };
  if (input.text !== undefined) {
    const text = input.text.replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!text) throw new Error("The description can't be empty.");
    const [row] = await db().select().from(schema.sdkToolDescriptions).where(where);
    const tool = (await getTools(tenantId)).find((t) => t.siteId === input.siteId && t.toolName === input.toolName);
    if (row && tool) {
      set.suggested = text;
      set.suggestedTokens = descriptorTokens({ name: tool.toolName, title: tool.title, inputSchema: tool.inputSchema, annotations: tool.annotations, description: text });
      set.rationale = "Edited by you.";
    }
  }
  await db().update(schema.sdkToolDescriptions).set(set).where(where);
  revalidatePath("/knaph");
}
