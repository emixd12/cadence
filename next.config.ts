import type { NextConfig } from "next";

const STATIC_ASSET_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
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
