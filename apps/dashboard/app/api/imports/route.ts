// Proxy "Run import now" → intel-api POST /v1/imports.
// In prod, forwards the Clerk session token (the API verifies it + scopes the
// tenant). In dev (no Clerk), calls the API unauthenticated only if INTEL_API_URL
// is a localhost/dev target; otherwise returns a clear message.
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const apiUrl = process.env.INTEL_API_URL;
  if (!apiUrl) {
    return NextResponse.json({ error: "INTEL_API_URL not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  if (!body?.connector_id) {
    return NextResponse.json({ error: "connector_id required" }, { status: 400 });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    const { auth } = await import("@clerk/nextjs/server");
    const { getToken } = await auth();
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "not signed in" }, { status: 401 });
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${apiUrl}/v1/imports`, {
    method: "POST",
    headers,
    body: JSON.stringify({ connector_id: body.connector_id })
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
