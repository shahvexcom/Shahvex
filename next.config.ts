import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.SHAHVEX_NEXT_DIST_DIR || ".next",
  reactCompiler: true,
  async headers() {
    return [{ source: "/test/agent/:path*", headers: [
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
    ] }];
  },
  // Keep the server-side PDF parser on its Node export. Bundling it makes
  // Turbopack choose the browser worker and fails on PDF extraction.
  serverExternalPackages: ["pdf-parse", "playwright", "playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
