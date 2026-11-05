import { describe, expect, it } from "vitest";
import { PRO_CATALOG, intervalFromLookupKey } from "./catalog";

describe("catalogue Stripe", () => {
  it("dérive les prix Pro de plans.ts, sans essai ni abonnement hebdomadaire", () => {
    expect(PRO_CATALOG).toEqual([
      {
        lookupKey: "altydetect_pro_monthly",
        interval: "monthly",
        unitAmount: 999,
        recurring: { interval: "month", interval_count: 1 },
      },
      {
        lookupKey: "altydetect_pro_yearly",
        interval: "yearly",
        unitAmount: 9588,
        recurring: { interval: "year", interval_count: 1 },
      },
    ]);
    expect(PRO_CATALOG.some((p) => (p.recurring.interval as string) === "week")).toBe(false);
  });

  it("retrouve la période depuis la clé du prix", () => {
    expect(intervalFromLookupKey("altydetect_pro_monthly")).toBe("monthly");
    expect(intervalFromLookupKey("autre")).toBeNull();
  });
});
