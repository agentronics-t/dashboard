import "server-only";

const LOCATION = process.env.VERTEX_LOCATION || "asia-south1";
const PROJECT = process.env.GCP_PROJECT;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-005";
export const EMBED_DIMENSIONS = 768;

// Workload Identity Federation (production): Vercel's per-request OIDC token is
// exchanged for a short-lived token of a GCP service account, so no SA key
// exists anywhere (the org policy blocks key creation anyway). Needs:
//   GCP_WORKLOAD_IDENTITY_PROVIDER = projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>
//   GCP_SERVICE_ACCOUNT_EMAIL      = the SA with roles/aiplatform.user
const WIF_PROVIDER = process.env.GCP_WORKLOAD_IDENTITY_PROVIDER;
const WIF_SA = process.env.GCP_SERVICE_ACCOUNT_EMAIL;

// Enabled only when we actually have credentials: WIF on Vercel, an SA key, or
// ADC (GOOGLE_APPLICATION_CREDENTIALS locally / on a GCP box). Without them,
// callers use the deterministic retrieval-only fallback instead of erroring.
export function vertexConfigured(): boolean {
  return !!PROJECT && ((!!WIF_PROVIDER && !!WIF_SA) || !!process.env.GOOGLE_GENAI_SA_KEY || !!process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

type AuthOptions = { authClient?: import("google-auth-library").AuthClient; credentials?: Record<string, unknown> };
let auth: Promise<AuthOptions | undefined> | null = null;

/** googleAuthOptions for the genai client, built once per server instance. */
function authOptions(): Promise<AuthOptions | undefined> {
  auth ??= (async () => {
    if (WIF_PROVIDER && WIF_SA) {
      const [{ ExternalAccountClient }, { getVercelOidcToken }] = await Promise.all([import("google-auth-library"), import("@vercel/oidc")]);
      const authClient = ExternalAccountClient.fromJSON({
        type: "external_account",
        audience: `//iam.googleapis.com/${WIF_PROVIDER}`,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        token_url: "https://sts.googleapis.com/v1/token",
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${WIF_SA}:generateAccessToken`,
        subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() }
      });
      if (!authClient) throw new Error("Workload Identity Federation config is invalid");
      return { authClient };
    }
    const key = process.env.GOOGLE_GENAI_SA_KEY;
    return key ? { credentials: JSON.parse(key) } : undefined;
  })();
  return auth;
}

// Lazy genai client (Vertex mode, never an API key).
async function client(location = LOCATION) {
  const [{ GoogleGenAI }, googleAuthOptions] = await Promise.all([import("@google/genai"), authOptions()]);
  return new GoogleGenAI({ vertexai: true, project: PROJECT, location, ...(googleAuthOptions ? { googleAuthOptions } : {}) });
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
    const ai = await client(process.env.PROCEDURAL_LOCATION || "global");
    const res = await ai.models.generateContent({
      model: process.env.PROCEDURAL_MODEL || "gemini-3.8-flash",
      contents: prompt,
      config: { systemInstruction: system, temperature: 0.2, responseMimeType: "application/json", responseJsonSchema: schema }
    });
    return res.text ? (JSON.parse(res.text) as T) : null;
  } catch (err) {
    // Callers fall back; log so a broken credential setup is visible.
    console.error("vertex generateJson failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}
