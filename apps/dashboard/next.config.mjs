/** @type {import('next').NextConfig} */
const nextConfig = {
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
    return [...retired, { source: "/auth", destination: "/agents", permanent: false }];
  }
};

export default nextConfig;
