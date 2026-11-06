import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/metadata";

// L'espace connecté et les API ne sont pas indexés.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/api/", "/internal/", "/fr/app", "/en/app"] },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
