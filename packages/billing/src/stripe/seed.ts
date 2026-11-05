import type { CatalogPrice } from "./catalog";

// Plan d'action du script scripts/stripe-seed.ts, séparé des appels Stripe pour être testé.

export interface ExistingPrice {
  id: string;
  lookupKey: string | null;
  unitAmount: number | null;
  currency: string;
  recurringInterval: string | null;
  active: boolean;
}

export type SeedAction =
  | { kind: "keep"; lookupKey: string; priceId: string }
  | { kind: "create"; price: CatalogPrice; replaces: string | null };

/** Garde un prix identique ; sinon en crée un nouveau qui reprend la lookup_key. */
export function planPriceActions(
  catalog: readonly CatalogPrice[],
  existing: readonly ExistingPrice[],
  currency: string,
): SeedAction[] {
  return catalog.map((price) => {
    const current = existing.find((p) => p.active && p.lookupKey === price.lookupKey);
    const same =
      current &&
      current.unitAmount === price.unitAmount &&
      current.currency === currency &&
      current.recurringInterval === price.recurring.interval;
    if (current && same) {
      return { kind: "keep", lookupKey: price.lookupKey, priceId: current.id };
    }
    return { kind: "create", price, replaces: current?.id ?? null };
  });
}
