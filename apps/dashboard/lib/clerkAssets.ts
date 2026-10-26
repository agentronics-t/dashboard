// Where Clerk's script and API live, so pages can start fetching them before
// React asks. The version is pinned so the script URL is cacheable for a year
// (the default "@5" URL is an uncached redirect on every visit); keep it on the
// major @clerk/nextjs expects (5.x for @clerk/nextjs 6) when upgrading, and
// update CLERK_API_VERSION to what that clerk-js sends (see its /v1 requests).
export const CLERK_JS_VERSION = "5.128.0";
const CLERK_API_VERSION = "2025-11-10";

// The Frontend API host (e.g. https://clerk.agentronics.dev), decoded from the
// publishable key: pk_live_<base64("clerk.example.com$")>.
export const clerkFrontendApi: string | null = (() => {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!key) return null;
  try {
    const host = Buffer.from(key.split("_")[2] ?? "", "base64").toString("utf8").replace(/\$$/, "");
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : null;
  } catch {
    return null;
  }
})();

export const clerkScriptUrl = clerkFrontendApi && `${clerkFrontendApi}/npm/@clerk/clerk-js@${CLERK_JS_VERSION}/dist/clerk.browser.js`;

/** The two calls clerk-js makes before it can draw anything, exactly as it sends them. */
export const clerkBootRequests = clerkFrontendApi
  ? ["environment", "client"].map((p) => `${clerkFrontendApi}/v1/${p}?__clerk_api_version=${CLERK_API_VERSION}&_clerk_js_version=${CLERK_JS_VERSION}`)
  : [];
