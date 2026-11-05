import { PRO_PRICES_CENTS, type BillingInterval } from "../config/plans";

// Catalogue Stripe dérivé de plans.ts. Créé par scripts/stripe-seed.ts, jamais à la main.
// Les prix sont retrouvés par lookup_key : changer un montant crée un nouveau prix et
// transfère la clé, sans toucher au code.

export const STRIPE_CURRENCY = "eur";
export const PRO_PRODUCT_KEY = "altydetect_pro";

export const PRO_PRICE_LOOKUP_KEYS: Readonly<Record<BillingInterval, string>> = {
  monthly: "altydetect_pro_monthly",
  yearly: "altydetect_pro_yearly",
};

export interface CatalogPrice {
  lookupKey: string;
  interval: BillingInterval;
  unitAmount: number;
  recurring: { interval: "month" | "year"; interval_count: 1 };
}

export const PRO_CATALOG: readonly CatalogPrice[] = (["monthly", "yearly"] as const).map(
  (interval) => ({
    lookupKey: PRO_PRICE_LOOKUP_KEYS[interval],
    interval,
    unitAmount: PRO_PRICES_CENTS[interval],
    recurring: { interval: interval === "monthly" ? "month" : "year", interval_count: 1 },
  }),
);

export function intervalFromLookupKey(
  lookupKey: string | null | undefined,
): BillingInterval | null {
  if (lookupKey === PRO_PRICE_LOOKUP_KEYS.monthly) return "monthly";
  if (lookupKey === PRO_PRICE_LOOKUP_KEYS.yearly) return "yearly";
  return null;
}
