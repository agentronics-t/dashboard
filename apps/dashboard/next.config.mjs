/** @type {import('next').NextConfig} */
const nextConfig = {
  // intel-schema ships compiled dist; nothing to transpile from source.
  serverExternalPackages: ["postgres", "@google/genai"],
  eslint: { ignoreDuringBuilds: true }
};

export default nextConfig;
