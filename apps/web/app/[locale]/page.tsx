import type { Metadata } from "next";
import { PRO_PRICE_YEARLY_EUR } from "@altydetect/billing";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { HomeTrial } from "@/components/public/HomeTrial";
import { PublicFooter } from "@/components/public/PublicFooter";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Link } from "@/i18n/navigation";
import { localizedAlternates, siteUrl } from "@/lib/seo/metadata";

type Locale = "fr" | "en";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale, namespace: "home" });
  return {
    metadataBase: new URL(siteUrl()),
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: localizedAlternates("/", locale),
    openGraph: {
      title: t("metaTitle"),
      description: t("metaDescription"),
      locale: locale === "fr" ? "fr_FR" : "en_GB",
      type: "website",
      siteName: "AltyDetect",
    },
  };
}

const SAMPLE: Record<Locale, string> = {
  fr: "Notre entreprise elle fait des solutions logicielles pour les PME et on est vraiment très bons pour aider les gens à gérer leur stock. Depuis 2019 on a plus de 400 clients qui sont contents, et on veut maintenant aller sur le marché belge.",
  en: "Our company does software stuff for small businesses and we are really good at helping people manage their stock. Since 2019 we got more than 400 happy customers and now we want to go to the Belgian market.",
};

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  const format = await getFormatter();
  const price = format.number(PRO_PRICE_YEARLY_EUR / 12, { style: "currency", currency: "EUR" });

  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <PublicHeader />
      <main className="flex flex-col">
        <section className="flex flex-col items-center gap-4 px-4 pb-8 pt-14 text-center md:px-8 md:pt-16">
          <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-accent">
            {t("eyebrow")}
          </span>
          <h1 className="max-w-3xl text-balance text-3xl font-bold leading-tight tracking-tight md:text-[46px]">
            {t("promise")}
          </h1>
          <p className="max-w-xl text-[17px] leading-relaxed text-gray-600">{t("lead")}</p>
        </section>

        <section aria-label={t("eyebrow")} className="mx-auto w-full max-w-6xl px-4 md:px-8">
          <div className="overflow-hidden rounded-2xl border border-gray-300 shadow-[0_12px_32px_-18px_rgba(20,26,38,0.35)]">
            <HomeTrial sample={SAMPLE[locale]} />
          </div>
        </section>

        <section
          aria-labelledby="commitments"
          className="mx-auto w-full max-w-5xl px-4 pt-16 md:px-8"
        >
          <h2 id="commitments" className="sr-only">
            {t("commitments")}
          </h2>
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            {(["c1", "c2", "c3"] as const).map((key) => (
              <div key={key} className="flex flex-col gap-2.5 border-t-2 border-gray-900 pt-4">
                <h3 className="text-lg font-semibold">{t(`${key}Title`)}</h3>
                <p className="leading-relaxed text-gray-600">{t(`${key}Body`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-4 pb-20 pt-12 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-gray-50 px-6 py-6 md:px-8">
            <div className="flex flex-col gap-1">
              <b className="text-lg">{t("pricingTitle", { price })}</b>
              <span className="text-gray-600">{t("pricingBody")}</span>
            </div>
            <Link
              href="/tarifs"
              className="inline-flex h-11 items-center rounded-lg border border-accent px-5 font-semibold text-accent hover:bg-accent/5"
            >
              {t("pricingCta")}
            </Link>
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
