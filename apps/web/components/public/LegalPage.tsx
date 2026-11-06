import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import type { AppPathname } from "@/i18n/routing";
import { localizedAlternates, siteUrl } from "@/lib/seo/metadata";
import { PublicFooter } from "./PublicFooter";
import { PublicHeader } from "./PublicHeader";

export type LegalKind = "terms" | "privacy" | "notice";
export const LEGAL_HREF: Record<LegalKind, AppPathname> = {
  terms: "/cgu",
  privacy: "/confidentialite",
  notice: "/mentions-legales",
};

export async function legalMetadata(kind: LegalKind, locale: "fr" | "en"): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "legal" });
  return {
    metadataBase: new URL(siteUrl()),
    title: `${t(`${kind}.title`)} — AltyDetect`,
    alternates: localizedAlternates(LEGAL_HREF[kind], locale),
  };
}

// Pages légales. Les mentions entre crochets sont à compléter avant la mise en ligne.
export async function LegalPage({ kind }: { kind: LegalKind }) {
  const t = await getTranslations("legal");
  const sections = t.raw(`${kind}.sections`) as { h: string; p: string }[];
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-12 md:px-8">
        <h1 className="text-3xl font-bold tracking-tight">{t(`${kind}.title`)}</h1>
        <p role="note" className="rounded-lg bg-gray-100 px-4 py-2.5 text-sm text-gray-700">
          {t("draft")}
        </p>
        {sections.map((section) => (
          <section key={section.h} className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold">{section.h}</h2>
            <p className="leading-relaxed text-gray-700">{section.p}</p>
          </section>
        ))}
      </main>
      <PublicFooter />
    </div>
  );
}
