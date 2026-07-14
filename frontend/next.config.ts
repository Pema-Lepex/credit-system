import type { NextConfig } from "next";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const apiOrigin = new URL(API_URL);

const nextConfig: NextConfig = {
  reactStrictMode: true,

  eslint: {
    /**
     * Lint is its own gate (`npm run lint`), not a build gate. Feature agents are
     * building in parallel and a stylistic rule failing the *build* blocks a
     * deploy over something that isn't a defect. Type errors still fail the build
     * — those are defects.
     */
    ignoreDuringBuilds: true,
  },

  images: {
    /**
     * Uploads are served by the API today and by S3/R2 later (the backend's
     * storage_key is deliberately backend-agnostic). Only that one origin is
     * allowed — a wildcard here would turn the app into an open image proxy.
     */
    remotePatterns: [
      {
        protocol: apiOrigin.protocol.replace(":", "") as "http" | "https",
        hostname: apiOrigin.hostname,
        port: apiOrigin.port || undefined,
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
