import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Les packages du monorepo sont publiés en TypeScript source.
  transpilePackages: ["@altydetect/billing", "@altydetect/core"],
};

export default withNextIntl(nextConfig);
