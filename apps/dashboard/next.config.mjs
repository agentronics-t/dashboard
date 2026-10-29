// Baseline hardening for the authenticated console. No script CSP: Clerk loads
// its own scripts/frames and a wrong allowlist breaks sign-in. frame-ancestors
// only controls who may frame the console (clickjacking on key actions).
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
  // Sidebar links prefetch whole pages (components/Sidebar.tsx). Keep prefetched
  // and visited pages for 30 s so switching sections is instant; pages with a
  // "Live" badge refresh themselves, and server actions clear this cache.
  experimental: { staleTimes: { dynamic: 30, static: 30 } },
  async redirects() {
    // The intelligence platform is retired (see app/_intelligence/README.md).
    const retired = ["/forecast", "/insights", "/plugins", "/chat"].map((source) => ({ source, destination: "/", permanent: false }));
    // Pages from the short-lived auth-only console → their governance-console equivalents.
    const authOnly = [
      { source: "/agents/:path*", destination: "/detect" },
      { source: "/configure/api-keys", destination: "/settings" },
      { source: "/configure/:path*", destination: "/auth" },
      { source: "/billing", destination: "/settings" },
      { source: "/help", destination: "/overview" }
    ].map((r) => ({ ...r, permanent: false }));
    // Agent Nick was renamed Agent Nic. Old links and the GitHub App's registered
    // callback (/agent-nick/github/callback) keep working; the query string passes through.
    const renamed = [
      { source: "/agent-nick", destination: "/agent-nic", permanent: true },
      { source: "/agent-nick/:path*", destination: "/agent-nic/:path*", permanent: true }
    ];
    return [...retired, ...authOnly, ...renamed];
  }

};

export default nextConfig;
