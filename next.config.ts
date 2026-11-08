import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Keep the server-side PDF parser on its Node export. Bundling it makes
  // Turbopack choose the browser worker and fails on PDF extraction.
  serverExternalPackages: ["pdf-parse", "playwright", "playwright-core", "@sparticuz/chromium"],
};

export default nextConfig;
