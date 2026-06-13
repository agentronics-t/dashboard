// Proxy connector create → intel-api POST /v1/connectors (the API writes the
// credential to Secret Manager; Neon only ever stores the ref).
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiUrl = process.env.INTEL_API_URL;
  if (!apiUrl) return NextResponse.json({ error: "INTEL_API_URL not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  if (!body?.type) return NextResponse.json({ error: "type required" }, { status: 400 });

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const { auth } = await import("@clerk/nextjs/server");
    const { getToken } = await auth();
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "not signed in" }, { status: 401 });
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${apiUrl}/v1/connectors`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type: body.type, config: body.config ?? {}, secret: body.secret })
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
