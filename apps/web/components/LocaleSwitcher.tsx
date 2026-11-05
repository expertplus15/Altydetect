"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { saveUserLocale } from "@/lib/server/locale-actions";

// Sélecteur FR | EN. Connecté, la langue choisie est aussi enregistrée sur le compte.
export function LocaleSwitcher({ persist = false }: { persist?: boolean }) {
  const t = useTranslations("header");
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(locale: (typeof routing.locales)[number]) {
    if (locale === current) return;
    startTransition(async () => {
      if (persist) await saveUserLocale(locale);
      router.replace(pathname, { locale });
    });
  }

  return (
    <div role="group" aria-label={t("languageSwitcher")} className="flex items-center text-sm">
      {routing.locales.map((locale, index) => (
        <span key={locale} className="flex items-center">
          {index > 0 && (
            <span aria-hidden className="text-gray-400">
              |
            </span>
          )}
          <button
            type="button"
            onClick={() => choose(locale)}
            disabled={pending}
            aria-pressed={locale === current}
            className={`inline-flex h-11 min-w-11 items-center justify-center rounded-md px-2 uppercase ${
              locale === current ? "font-bold text-accent" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            {locale}
          </button>
        </span>
      ))}
    </div>
  );
}
