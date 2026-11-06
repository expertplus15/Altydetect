import { describe, expect, it } from "vitest";
import { PRO_CATALOG } from "./catalog";
import { planPriceActions, type ExistingPrice } from "./seed";

const existing = (overrides: Partial<ExistingPrice>): ExistingPrice => ({
  id: "price_old",
  lookupKey: "altydetect_pro_monthly",
  unitAmount: 999,
  currency: "eur",
  recurringInterval: "month",
  active: true,
  ...overrides,
});

describe("stripe-seed", () => {
  it("crée tous les prix sur un compte vide", () => {
    const actions = planPriceActions(PRO_CATALOG, [], "eur");
    expect(actions.map((a) => a.kind)).toEqual(["create", "create"]);
  });

  it("garde un prix identique (le script peut tourner plusieurs fois)", () => {
    const actions = planPriceActions(PRO_CATALOG, [existing({})], "eur");
    expect(actions[0]).toEqual({
      kind: "keep",
      lookupKey: "altydetect_pro_monthly",
      priceId: "price_old",
    });
  });

  it("remplace un prix dont le montant a changé dans plans.ts", () => {
    const actions = planPriceActions(PRO_CATALOG, [existing({ unitAmount: 899 })], "eur");
    expect(actions[0]).toMatchObject({ kind: "create", replaces: "price_old" });
  });
});
