import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image only. Vercel does its
  // own output tracing and `standalone` breaks its build step
  // (ENOENT next-server.js.nft.json), so skip it when building on Vercel.
  output: process.env.VERCEL ? undefined : "standalone",
  // Security headers applied to every response.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
