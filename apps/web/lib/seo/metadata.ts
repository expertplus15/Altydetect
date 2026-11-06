import type { Metadata } from "next";
import { getPathname } from "@/i18n/navigation";
import { routing, type AppPathname } from "@/i18n/routing";

export function siteUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** Adresse canonique et variantes de langue (hreflang) d'une page publique. */
export function localizedAlternates(
  href: AppPathname,
  locale: "fr" | "en",
): Metadata["alternates"] {
  const languages = Object.fromEntries(
    routing.locales.map((l) => [l, `${siteUrl()}${getPathname({ href, locale: l })}`]),
  );
  return {
    canonical: `${siteUrl()}${getPathname({ href, locale })}`,
    languages: { ...languages, "x-default": languages.fr },
  };
}
