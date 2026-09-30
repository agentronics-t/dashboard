/** @type {import('next').NextConfig} */
const nextConfig = {
  // intel-schema ships compiled dist; nothing to transpile from source.
  serverExternalPackages: ["postgres", "@google/genai"],
  eslint: { ignoreDuringBuilds: true },
  async redirects() {
    // The intelligence platform is retired (see app/_intelligence/README.md).
    // Send old bookmarks to the console home instead of a 404.
    return ["/forecast", "/insights", "/plugins", "/chat"].map((source) => ({
      source,
      destination: "/",
      permanent: false
    }));
  }
};

export default nextConfig;
