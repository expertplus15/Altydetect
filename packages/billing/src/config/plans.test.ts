import { describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  PRO_PRICE_MONTHLY_EUR,
  PRO_PRICE_YEARLY_EUR,
  PRO_PRICES_CENTS,
  TEAM_PRICE_MONTHLY_EUR,
  API_PRICE_PER_1000_WORDS_EUR,
} from "./plans";

describe("plans", () => {
  it("le prix annuel Pro correspond à 7,99 €/mois, soit −20 % du mensuel", () => {
    expect(PRO_PRICE_YEARLY_EUR / 12).toBeCloseTo(7.99, 2);
    expect(1 - PRO_PRICE_YEARLY_EUR / (PRO_PRICE_MONTHLY_EUR * 12)).toBeCloseTo(0.2, 2);
  });

  it("convertit les prix en centimes entiers", () => {
    expect(PRO_PRICES_CENTS).toEqual({ monthly: 999, yearly: 9588 });
  });

  it("Pro offre plus que Gratuit sur chaque limite", () => {
    expect(PLAN_LIMITS.pro.detectionWordsPerMonth).toBeGreaterThan(
      PLAN_LIMITS.free.detectionWordsPerMonth,
    );
    expect(PLAN_LIMITS.pro.rewriteRequestsPerDay).toBeGreaterThan(
      PLAN_LIMITS.free.rewriteRequestsPerDay,
    );
    expect(PLAN_LIMITS.pro.historyDays).toBeGreaterThan(PLAN_LIMITS.free.historyDays);
  });

  it("Équipe et API restent à définir", () => {
    expect(TEAM_PRICE_MONTHLY_EUR).toBeNull();
    expect(API_PRICE_PER_1000_WORDS_EUR).toBeNull();
  });
});
