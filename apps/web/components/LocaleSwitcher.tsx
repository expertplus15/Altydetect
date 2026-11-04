"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

// Sélecteur FR | EN. La préférence sera mémorisée sur le compte avec l'authentification.
export function LocaleSwitcher() {
  const t = useTranslations("header");
  const current = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("languageSwitcher")} className="flex items-center text-sm">
      {routing.locales.map((locale, index) => (
        <span key={locale} className="flex items-center">
          {index > 0 && (
            <span aria-hidden className="px-1 text-gray-400">
              |
            </span>
          )}
          <Link
            href={pathname}
            locale={locale}
            aria-current={locale === current ? "true" : undefined}
            className={`inline-flex h-11 min-w-11 items-center justify-center rounded-md px-2 uppercase ${
              locale === current ? "font-semibold text-accent" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {locale}
          </Link>
        </span>
      ))}
    </nav>
  );
}
