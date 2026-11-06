import type { MetadataRoute } from "next";
import { getPathname } from "@/i18n/navigation";
import { routing, type AppPathname } from "@/i18n/routing";
import { siteUrl } from "@/lib/seo/metadata";

// Pages publiques, dans les deux langues, avec leurs variantes hreflang.
const PUBLIC_PAGES: { href: AppPathname; priority: number }[] = [
  { href: "/", priority: 1 },
  { href: "/tarifs", priority: 0.8 },
  { href: "/inscription", priority: 0.5 },
  { href: "/cgu", priority: 0.2 },
  { href: "/confidentialite", priority: 0.2 },
  { href: "/mentions-legales", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.flatMap(({ href, priority }) =>
    routing.locales.map((locale) => ({
      url: `${base}${getPathname({ href, locale })}`,
      priority,
      alternates: {
        languages: Object.fromEntries(
          routing.locales.map((l) => [l, `${base}${getPathname({ href, locale: l })}`]),
        ),
      },
    })),
  );
}
