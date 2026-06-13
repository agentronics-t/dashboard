// Agent chat: embed question → pgvector top-k over insights → pull aggregates →
// stream a grounded Gemini answer. Degrades to a retrieval-only answer when
// Vertex isn't configured, so the feature is usable in dev.
import { schema } from "@agentronics/intel-schema/db";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getTopAgents, getTrafficSeries } from "@/lib/queries";
import { db, getTenantId } from "@/lib/tenant";
import { embed, streamAnswer, vertexConfigured } from "@/lib/vertex";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYSTEM = `You are the Agentronics analyst. Answer questions about the customer's AI-agent traffic using ONLY the context provided (retrieved insights + aggregate numbers). Never invent figures. Lanes: webmcp = MCP-endpoint agents, webbotauth = verified agents, stealth = unverified automated. Be concise, use markdown.`;

export async function POST(req: Request) {
  const { question } = await req.json().catch(() => ({ question: "" }));
  if (!question || typeof question !== "string") {
    return new Response("question required", { status: 400 });
  }
  const tenantId = await getTenantId();

  // 1. Retrieve relevant insights via pgvector (cosine) when we can embed.
  let insightRows: { title: string; body_md: string }[] = [];
  const qVec = await embed(question);
  if (qVec) {
    const vecLiteral = `[${qVec.join(",")}]`;
    insightRows = await db()
      .select({ title: schema.insights.title, body_md: schema.insights.bodyMd })
      .from(schema.insights)
      .where(and(eq(schema.insights.tenantId, tenantId), sql`${schema.insights.embedding} is not null`))
      .orderBy(sql`${schema.insights.embedding} <=> ${vecLiteral}::vector`)
      .limit(5);
  } else {
    insightRows = await db()
      .select({ title: schema.insights.title, body_md: schema.insights.bodyMd })
      .from(schema.insights)
      .where(eq(schema.insights.tenantId, tenantId))
      .orderBy(desc(schema.insights.createdAt))
      .limit(5);
  }

  // 2. Pull aggregates for grounding.
  const [traffic, topAgents] = await Promise.all([
    getTrafficSeries(tenantId, 30),
    getTopAgents(tenantId, 30, 5)
  ]);
  const totals = traffic.reduce(
    (a, d) => ({ requests: a.requests + d.requests, blocked: a.blocked + d.blocked, stealth: a.stealth + d.stealth }),
    { requests: 0, blocked: 0, stealth: 0 }
  );

  const context = JSON.stringify(
    {
      last_30d: totals,
      top_agents: topAgents.map((a) => ({ agent: a.agent, requests: a.requests, blocked: a.blocked, lane: a.lane })),
      insights: insightRows
    },
    null,
    2
  );
  const prompt = `Question: ${question}\n\nContext:\n${context}`;

  // 3. Stream the answer (or a deterministic fallback).
  const encoder = new TextEncoder();
  if (!vertexConfigured()) {
    const fallback =
      insightRows.length || totals.requests
        ? `**Retrieval-only answer** (Vertex not configured):\n\nOver the last 30 days: ${totals.requests.toLocaleString()} requests, ${totals.blocked.toLocaleString()} blocked.\n\nMost relevant insights:\n${insightRows.map((r) => `- **${r.title}**`).join("\n") || "- (none yet)"}`
        : "No data yet — run an import first.";
    return new Response(encoder.encode(fallback), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const token of streamAnswer(SYSTEM, prompt)) {
          controller.enqueue(encoder.encode(token));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`\n\n_(error: ${e instanceof Error ? e.message : "stream failed"})_`));
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
