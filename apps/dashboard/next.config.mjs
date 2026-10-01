// Baseline hardening for the authenticated console. No script CSP: Clerk and
// Razorpay Checkout load their own scripts/frames and a wrong allowlist breaks
// sign-in or payment. frame-ancestors only controls who may frame the console
// (clickjacking on Billing/Cancel/key actions) — it doesn't restrict what we
// embed, so Razorpay's checkout iframe is unaffected.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  // intel-schema ships compiled dist; nothing to transpile from source.
  serverExternalPackages: ["postgres", "@google/genai"],
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    // The intelligence platform is retired (see app/_intelligence/README.md).
    // Send old bookmarks to the console home instead of a 404.
    // Retired intelligence pages + the pre-pivot SDK pillar pages
    // (app/_hidden/README.md) → console home.
    const retired = ["/forecast", "/insights", "/plugins", "/chat", "/detect", "/authz", "/webmcp-tools", "/knaph", "/analytics"]
      .map((source) => ({ source, destination: "/", permanent: false }));
    return [
      ...retired,
      { source: "/auth", destination: "/agents", permanent: false },
      // Access rules are gone — Agentronics authenticates, it never blocks.
      { source: "/configure/access-rules", destination: "/configure/authentication", permanent: false }
    ];
  }
};

export default nextConfig;
