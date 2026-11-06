import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Les packages du monorepo sont publiés en TypeScript source.
  transpilePackages: [
    "@altydetect/billing",
    "@altydetect/core",
    "@altydetect/rewrite",
    "@altydetect/write",
  ],
  // Bibliothèques Node chargées telles quelles côté serveur (pdf.js et son worker).
  serverExternalPackages: ["pdf-parse", "mammoth", "@react-pdf/renderer", "bullmq"],
};

export default withNextIntl(nextConfig);
