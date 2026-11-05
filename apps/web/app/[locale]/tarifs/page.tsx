import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  FREE_DETECTION_WORDS_PER_MONTH,
  FREE_HISTORY_DAYS,
  FREE_REWRITE_REQUESTS_PER_DAY,
  PRO_DETECTION_WORDS_PER_MONTH,
  PRO_HISTORY_MONTHS,
  PRO_PRICE_MONTHLY_EUR,
  PRO_PRICE_YEARLY_EUR,
} from "@altydetect/billing";
import { auth } from "@/auth";
import { PricingPlans } from "@/components/pricing/PricingPlans";
import { PublicHeader } from "@/components/public/PublicHeader";
import { getUserPlan } from "@/lib/billing/subscription";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as "fr" | "en", namespace: "pricing" });
  const format = await getFormatter({ locale: locale as "fr" | "en" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription", {
      yearlyMonthly: format.number(PRO_PRICE_YEARLY_EUR / 12, {
        style: "currency",
        currency: "EUR",
      }),
    }),
  };
}

export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as "fr" | "en");
  const { checkout } = await searchParams;
  const t = await getTranslations("pricing");
  const session = await auth();
  const isPro = session?.user?.id ? (await getUserPlan(session.user.id)).plan === "pro" : false;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <PublicHeader />
      <main className="flex flex-col gap-16 px-4 pb-20 pt-14 md:px-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h1 className="text-balance text-3xl font-bold tracking-tight text-gray-900 md:text-[40px]">
            {t("title")}
          </h1>
          <p className="max-w-xl text-gray-600">{t("subtitle")}</p>
          {checkout === "cancelled" && (
            <p role="status" className="rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700">
              {t("cancelled")}
            </p>
          )}
        </div>
        <PricingPlans
          isPro={isPro}
          numbers={{
            monthlyEur: PRO_PRICE_MONTHLY_EUR,
            yearlyEur: PRO_PRICE_YEARLY_EUR,
            freeRewritesPerDay: FREE_REWRITE_REQUESTS_PER_DAY,
            freeDetectionWords: FREE_DETECTION_WORDS_PER_MONTH,
            freeHistoryDays: FREE_HISTORY_DAYS,
            proDetectionWords: PRO_DETECTION_WORDS_PER_MONTH,
            proHistoryMonths: PRO_HISTORY_MONTHS,
          }}
        />
        <section className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          <h2 className="text-xl font-semibold text-gray-900">{t("faqTitle")}</h2>
          {(["cancel", "data", "quota"] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1.5 border-t border-gray-200 pt-4">
              <h3 className="font-semibold text-gray-900">{t(`faq.${key}Q`)}</h3>
              <p className="leading-relaxed text-gray-600">{t(`faq.${key}A`)}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
