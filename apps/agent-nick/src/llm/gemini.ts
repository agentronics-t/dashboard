// Gemini on Vertex AI (Model Garden) — the only model Agent Nick calls.
// Every call is one structured-output request: JSON in, JSON out, no agent
// loop. Usage is accumulated so each run shows what it cost.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { OAuth2Client } from "google-auth-library";
import type { Env } from "../env.ts";

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export type Effort = "low" | "medium" | "high";

const LEVEL: Record<Effort, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH
};

/** Vertex bills implicitly-cached input at a 90% discount. */
const CACHED_INPUT_RATE = 0.1;

export interface JsonCall<T> {
  system: string;
  prompt: string;
  /** JSON Schema for the response (Gemini structured output). */
  schema: Record<string, unknown>;
  effort: Effort;
  /** Validate/convert the parsed JSON; throw to trigger one retry. */
  parse: (value: unknown) => T;
}

export interface Llm {
  json<T>(call: JsonCall<T>): Promise<T>;
  readonly usage: Usage;
}

type GeminiEnv = Pick<
  Env,
  "GCP_PROJECT" | "VERTEX_LOCATION" | "GEMINI_MODEL" | "GOOGLE_GENAI_SA_KEY" | "GOOGLE_ACCESS_TOKEN" | "GEMINI_PRICE_IN" | "GEMINI_PRICE_OUT"
>;

/** SA JSON (off-GCP), a dev access token, or nothing (ADC / the Cloud Run service account). */
function authOptions(env: GeminiEnv) {
  if (env.GOOGLE_GENAI_SA_KEY) return { googleAuthOptions: { credentials: JSON.parse(env.GOOGLE_GENAI_SA_KEY) as Record<string, string> } };
  if (env.GOOGLE_ACCESS_TOKEN) {
    const authClient = new OAuth2Client();
    authClient.setCredentials({ access_token: env.GOOGLE_ACCESS_TOKEN });
    return { googleAuthOptions: { authClient } };
  }
  return {};
}

export class Gemini implements Llm {
  readonly usage: Usage = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
  private readonly ai: GoogleGenAI;
  private readonly env: GeminiEnv;

  constructor(env: GeminiEnv) {
    this.env = env;
    this.ai = new GoogleGenAI({ vertexai: true, project: env.GCP_PROJECT, location: env.VERTEX_LOCATION, ...authOptions(env) });
  }

  async json<T>(call: JsonCall<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await this.ai.models.generateContent({
          model: this.env.GEMINI_MODEL,
          contents: [{ role: "user", parts: [{ text: call.prompt }] }],
          config: {
            systemInstruction: call.system,
            responseMimeType: "application/json",
            responseJsonSchema: call.schema,
            thinkingConfig: { thinkingLevel: LEVEL[call.effort] },
            maxOutputTokens: 32_768
          }
        });
        this.record(res.usageMetadata);
        const text = res.text;
        if (!text) throw new Error(`empty response (finish: ${res.candidates?.[0]?.finishReason ?? "unknown"})`);
        return call.parse(JSON.parse(text));
      } catch (err) {
        lastError = err;
        const status = (err as { status?: number }).status;
        // Client errors (bad request, auth) won't improve on retry.
        if (status && status >= 400 && status < 500 && status !== 429) break;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private record(u: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined) {
    if (!u) return;
    const prompt = u.promptTokenCount ?? 0;
    const cached = u.cachedContentTokenCount ?? 0;
    const out = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    this.usage.tokensIn += prompt;
    this.usage.tokensOut += out;
    this.usage.costUsd +=
      ((prompt - cached + cached * CACHED_INPUT_RATE) * this.env.GEMINI_PRICE_IN + out * this.env.GEMINI_PRICE_OUT) / 1_000_000;
  }
}
