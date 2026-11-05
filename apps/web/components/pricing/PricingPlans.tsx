"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";

export interface PricingNumbers {
  monthlyEur: number;
  yearlyEur: number;
  freeRewritesPerDay: number;
  freeDetectionWords: number;
  freeHistoryDays: number;
  proDetectionWords: number;
  proHistoryMonths: number;
}

// Grille des tarifs (maquette « Tarifs ») : Gratuit, Pro mis en avant, Équipe et API « Bientôt ».
export function PricingPlans({ numbers, isPro }: { numbers: PricingNumbers; isPro: boolean }) {
  const t = useTranslations("pricing");
  const format = useFormatter();
  const locale = useLocale();
  const [interval, setInterval] = useState<"monthly" | "yearly">("yearly");
  const eur = (value: number) =>
    format.number(value, {
      style: "currency",
      currency: "EUR",
      ...(Number.isInteger(value) ? { maximumFractionDigits: 0 } : {}),
    });
  const proMonthly = interval === "yearly" ? numbers.yearlyEur / 12 : numbers.monthlyEur;

  const toggle = (value: "monthly" | "yearly") =>
    `h-10 rounded-lg px-4 text-sm ${
      interval === value ? "bg-white font-semibold text-gray-900 shadow-sm" : "text-gray-600"
    }`;

  return (
    <div className="flex flex-col items-center gap-8">
      <div
        role="group"
        aria-label={t("period")}
        className="inline-grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1"
      >
        <button
          type="button"
          aria-pressed={interval === "monthly"}
          onClick={() => setInterval("monthly")}
          className={toggle("monthly")}
        >
          {t("monthly")}
        </button>
        <button
          type="button"
          aria-pressed={interval === "yearly"}
          onClick={() => setInterval("yearly")}
          className={toggle("yearly")}
        >
          {t("yearly")}
        </button>
      </div>

      <div className="grid w-full max-w-6xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PlanCard name={t("free.name")} price={eur(0)} note={t("free.tagline")}>
          <Link
            href="/inscription"
            className="flex h-11 items-center justify-center rounded-lg border border-gray-300 font-semibold text-gray-900 hover:bg-gray-50"
          >
            {t("free.cta")}
          </Link>
          <Features
            items={[
              t("free.rewrites", { count: numbers.freeRewritesPerDay }),
              t("free.write"),
              t("free.detection", { words: format.number(numbers.freeDetectionWords) }),
              t("free.history", { days: numbers.freeHistoryDays }),
            ]}
          />
        </PlanCard>

        <PlanCard
          featured
          badge={t("recommended")}
          name={t("pro.name")}
          price={eur(proMonthly)}
          perMonth={t("perMonth")}
          note={
            interval === "yearly"
              ? t("billedYearly", { amount: eur(numbers.yearlyEur) })
              : t("billedMonthly")
          }
        >
          {isPro ? (
            <p className="flex h-11 items-center justify-center rounded-lg bg-accent/10 font-semibold text-accent">
              {t("pro.current")}
            </p>
          ) : (
            <form action="/api/billing/checkout" method="post">
              <input type="hidden" name="interval" value={interval} />
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="h-11 w-full rounded-lg bg-accent font-semibold text-white hover:opacity-90"
              >
                {t("pro.cta")}
              </button>
            </form>
          )}
          <Features
            items={[
              t("pro.rewrites"),
              t("pro.variants"),
              t("pro.detection", { words: format.number(numbers.proDetectionWords) }),
              t("pro.files"),
              t("pro.history", { months: numbers.proHistoryMonths }),
            ]}
          />
        </PlanCard>

        <PlanCard
          soon={t("soon")}
          name={t("team.name")}
          price={t("priceToCome")}
          note={t("team.tagline")}
        >
          <Features muted items={[t("team.f1"), t("team.f2"), t("team.f3")]} />
        </PlanCard>

        <PlanCard
          soon={t("soon")}
          name={t("api.name")}
          price={t("priceToCome")}
          note={t("api.tagline")}
        >
          <Features muted items={[t("api.f1"), t("api.f2"), t("api.f3")]} />
        </PlanCard>
      </div>
    </div>
  );
}

function PlanCard({
  name,
  price,
  perMonth,
  note,
  featured,
  badge,
  soon,
  children,
}: {
  name: string;
  price: string;
  perMonth?: string;
  note: string;
  featured?: boolean;
  badge?: string;
  soon?: string;
  children: React.ReactNode;
}) {
  const frame = featured
    ? "relative border-2 border-accent p-[23px] shadow-[0_14px_34px_-20px_rgba(29,78,216,0.55)]"
    : soon
      ? "border border-dashed border-gray-300 bg-gray-50 p-6"
      : "border border-gray-200 p-6";
  return (
    <section className={`flex flex-col gap-4 rounded-2xl ${frame}`}>
      {badge && (
        <span className="absolute -top-3.5 left-5 inline-flex h-7 items-center rounded-full bg-accent px-2.5 text-xs font-semibold text-white">
          {badge}
        </span>
      )}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">{name}</h2>
        {soon && (
          <span className="rounded-full border border-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-600">
            {soon}
          </span>
        )}
      </div>
      <p className="flex items-baseline gap-1.5">
        <span
          className={
            soon
              ? "text-xl font-semibold text-gray-600"
              : "text-4xl font-bold tracking-tight tabular-nums text-gray-900"
          }
        >
          {price}
        </span>
        {perMonth && <span className="text-gray-600">{perMonth}</span>}
      </p>
      <p className="min-h-5 text-sm text-gray-600">{note}</p>
      {children}
    </section>
  );
}

function Features({ items, muted }: { items: string[]; muted?: boolean }) {
  return (
    <ul
      className={`flex flex-col gap-2.5 text-sm leading-snug ${muted ? "text-gray-600" : "text-gray-800"}`}
    >
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
