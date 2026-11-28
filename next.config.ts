import type { NextConfig } from "next";

const STATIC_ASSET_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

// Development only: extra hosts that may load dev-server assets, for a local stack behind a
// tunnel (`local-stack.mjs up --public-url`). `next build` and `next start` ignore it.
const devAllowedOrigins = (process.env.CADENCE_DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devAllowedOrigins.length > 0 ? { allowedDevOrigins: devAllowedOrigins } : {}),
  transpilePackages: ["@cadence/core", "@cadence/ui"],
  experimental: {
    // Keep framework checks on the compiler API; standalone typecheck uses TypeScript 7.
    useTypeScriptCli: false,
    serverActions: {
      // A 3 MiB ZIP encodes to 4 MiB. Reserve 256 KiB for form fields
      // while staying below Vercel's 4.5 MB function request cap.
      bodySizeLimit: "4.25mb",
    },
  },
  images: {
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },
  async headers() {
    return [
      {
        source: "/brand/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: STATIC_ASSET_CACHE,
          },
        ],
      },
      {
        source: "/sounds/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: STATIC_ASSET_CACHE,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
