import "server-only";

const LOCATION = process.env.VERTEX_LOCATION || "asia-south1";
const PROJECT = process.env.GCP_PROJECT;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-005";
export const EMBED_DIMENSIONS = 768;

// Enabled only when we actually have credentials: an SA key (Vercel) or ADC
// (GOOGLE_APPLICATION_CREDENTIALS on a GCP box). Without them, callers use the
// deterministic retrieval-only fallback instead of erroring.
export function vertexConfigured(): boolean {
  return !!PROJECT && (!!process.env.GOOGLE_GENAI_SA_KEY || !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

// Lazy genai client (Vertex mode, SA auth — never an API key). On Vercel,
// GOOGLE_GENAI_SA_KEY holds the SA JSON; locally falls back to ADC.
async function client() {
  const { GoogleGenAI } = await import("@google/genai");
  const key = process.env.GOOGLE_GENAI_SA_KEY;
  const googleAuthOptions = key ? { credentials: JSON.parse(key) } : undefined;
  return new GoogleGenAI({
    vertexai: true,
    project: PROJECT,
    location: LOCATION,
    ...(googleAuthOptions ? { googleAuthOptions } : {})
  });
}

export async function embed(text: string): Promise<number[] | null> {
  if (!vertexConfigured()) return null;
  try {
    const ai = await client();
    const res = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: text,
      config: { outputDimensionality: EMBED_DIMENSIONS }
    });
    const values = res.embeddings?.[0]?.values;
    return values && values.length === EMBED_DIMENSIONS ? values : null;
  } catch {
    return null;
  }
}

/** Stream Gemini answer tokens. Caller wraps into a Response stream. */
export async function* streamAnswer(system: string, prompt: string): AsyncGenerator<string> {
  const ai = await client();
  const stream = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { systemInstruction: system, temperature: 0.3, maxOutputTokens: 1024 }
  });
  for await (const chunk of stream) {
    if (chunk.text) yield chunk.text;
  }
}

/**
 * One structured-output Gemini call (JSON matching `schema`). Returns null when
 * Vertex isn't configured or the call fails, so callers can fall back.
 * Uses PROCEDURAL_MODEL (default gemini-3.8-flash) in the `global` location.
 */
export async function generateJson<T>(system: string, prompt: string, schema: Record<string, unknown>): Promise<T | null> {
  if (!vertexConfigured()) return null;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const key = process.env.GOOGLE_GENAI_SA_KEY;
    const ai = new GoogleGenAI({
      vertexai: true,
      project: PROJECT,
      location: process.env.PROCEDURAL_LOCATION || "global",
      ...(key ? { googleAuthOptions: { credentials: JSON.parse(key) } } : {})
    });
    const res = await ai.models.generateContent({
      model: process.env.PROCEDURAL_MODEL || "gemini-3.8-flash",
      contents: prompt,
      config: { systemInstruction: system, temperature: 0.2, responseMimeType: "application/json", responseJsonSchema: schema }
    });
    return res.text ? (JSON.parse(res.text) as T) : null;
  } catch {
    return null;
  }
}
