import { describe, expect, it } from "vitest";
import {
  FREE_DETECTION_WORDS_PER_MONTH,
  FREE_REWRITE_REQUESTS_PER_DAY,
  PRO_DETECTION_WORDS_PER_MONTH,
  PRO_REWRITE_FAIR_USE_PER_DAY,
} from "./config/plans";
import {
  addMonthsClamped,
  createMemoryQuotaStore,
  createQuota,
  detectionPeriod,
  type PlanSnapshot,
  type QuotaStore,
} from "./quota";

const d = (iso: string) => new Date(iso);
const FREE: PlanSnapshot = { plan: "free", interval: null, currentPeriodEnd: null };
const pro = (end: string, interval: "monthly" | "yearly" = "monthly"): PlanSnapshot => ({
  plan: "pro",
  interval,
  currentPeriodEnd: d(end),
});

function setup(plan: PlanSnapshot, start: string) {
  let now = d(start);
  const store = createMemoryQuotaStore({ u: plan });
  const quota = createQuota(store, () => now);
  return { store, quota, at: (iso: string) => (now = d(iso)) };
}

describe("addMonthsClamped", () => {
  it("ramène au dernier jour du mois", () => {
    expect(addMonthsClamped(d("2027-01-31T10:00:00Z"), 1)).toEqual(d("2027-02-28T10:00:00Z"));
    expect(addMonthsClamped(d("2028-01-31T10:00:00Z"), 1)).toEqual(d("2028-02-29T10:00:00Z"));
    expect(addMonthsClamped(d("2027-03-31T00:00:00Z"), -4)).toEqual(d("2026-11-30T00:00:00Z"));
  });
});

describe("detectionPeriod", () => {
  it("Gratuit : du 1er du mois UTC au 1er du mois suivant", () => {
    expect(detectionPeriod(FREE, d("2026-11-30T23:59:59.999Z"))).toEqual({
      start: d("2026-11-01T00:00:00Z"),
      end: d("2026-12-01T00:00:00Z"),
    });
    expect(detectionPeriod(FREE, d("2026-12-01T00:00:00Z")).start).toEqual(
      d("2026-12-01T00:00:00Z"),
    );
    expect(detectionPeriod(FREE, d("2026-12-31T12:00:00Z")).end).toEqual(d("2027-01-01T00:00:00Z"));
  });

  it("Pro : fenêtres mensuelles alignées sur current_period_end", () => {
    const plan = pro("2026-12-15T10:00:00Z");
    expect(detectionPeriod(plan, d("2026-11-20T00:00:00Z"))).toEqual({
      start: d("2026-11-15T10:00:00Z"),
      end: d("2026-12-15T10:00:00Z"),
    });
    // Une milliseconde avant l'ancre : encore la fenêtre précédente.
    expect(detectionPeriod(plan, d("2026-11-15T09:59:59.999Z")).start).toEqual(
      d("2026-10-15T10:00:00Z"),
    );
    // Exactement à l'ancre : nouvelle fenêtre.
    expect(detectionPeriod(plan, d("2026-11-15T10:00:00Z")).start).toEqual(
      d("2026-11-15T10:00:00Z"),
    );
  });

  it("Pro annuel : le quota reste mensuel, aligné sur le jour de renouvellement", () => {
    const plan = pro("2027-03-31T08:00:00Z", "yearly");
    expect(detectionPeriod(plan, d("2026-12-05T00:00:00Z"))).toEqual({
      start: d("2026-11-30T08:00:00Z"),
      end: d("2026-12-31T08:00:00Z"),
    });
  });

  it("Pro avec une date Stripe dépassée (webhook en retard) : continue mois par mois", () => {
    expect(detectionPeriod(pro("2026-10-01T00:00:00Z"), d("2026-11-10T00:00:00Z"))).toEqual({
      start: d("2026-11-01T00:00:00Z"),
      end: d("2026-12-01T00:00:00Z"),
    });
  });
});

describe("quota de détection", () => {
  it(`refuse sous ${150} mots sans rien consommer`, async () => {
    const { quota, store } = setup(FREE, "2026-11-10T12:00:00Z");
    const result = await quota.consumeDetectionQuota("u", 149);
    expect(result).toMatchObject({ allowed: false, reason: "TEXT_TOO_SHORT", used: 0 });
    expect(store.usage.size).toBe(0);
    expect((await quota.consumeDetectionQuota("u", 150)).allowed).toBe(true);
  });

  it("Gratuit : autorise jusqu'à la limite exacte, puis refuse", async () => {
    const { quota } = setup(FREE, "2026-11-10T12:00:00Z");
    expect(
      await quota.consumeDetectionQuota("u", FREE_DETECTION_WORDS_PER_MONTH - 200),
    ).toMatchObject({ allowed: true, used: FREE_DETECTION_WORDS_PER_MONTH - 200 });
    expect((await quota.consumeDetectionQuota("u", 200)).remaining).toBe(0);
    expect(await quota.checkDetectionQuota("u", 150)).toMatchObject({
      allowed: false,
      reason: "QUOTA_EXCEEDED",
      used: FREE_DETECTION_WORDS_PER_MONTH,
      resetsAt: d("2026-12-01T00:00:00Z"),
    });
  });

  it("refuse un texte qui dépasserait le reste, sans consommer", async () => {
    const { quota } = setup(FREE, "2026-11-10T12:00:00Z");
    await quota.consumeDetectionQuota("u", 4900);
    expect((await quota.consumeDetectionQuota("u", 200)).allowed).toBe(false);
    expect((await quota.checkDetectionQuota("u", 150)).used).toBe(4900);
  });

  it("Gratuit : remet à zéro le 1er du mois à minuit UTC", async () => {
    const { quota, at } = setup(FREE, "2026-11-30T23:00:00Z");
    await quota.consumeDetectionQuota("u", FREE_DETECTION_WORDS_PER_MONTH);
    at("2026-11-30T23:59:59.999Z");
    expect((await quota.checkDetectionQuota("u", 150)).allowed).toBe(false);
    at("2026-12-01T00:00:00Z");
    expect(await quota.consumeDetectionQuota("u", 150)).toMatchObject({ allowed: true, used: 150 });
  });

  it("Pro : remet à zéro à la date anniversaire de l'abonnement", async () => {
    const { quota, at } = setup(pro("2026-12-15T10:00:00Z"), "2026-12-15T09:00:00Z");
    await quota.consumeDetectionQuota("u", PRO_DETECTION_WORDS_PER_MONTH);
    expect((await quota.checkDetectionQuota("u", 150)).allowed).toBe(false);
    at("2026-12-15T10:00:00Z");
    expect((await quota.checkDetectionQuota("u", 150)).allowed).toBe(true);
  });

  it("passage à Pro en cours de mois : la nouvelle période repart à zéro", async () => {
    const { quota, store, at } = setup(FREE, "2026-11-03T08:00:00Z");
    await quota.consumeDetectionQuota("u", FREE_DETECTION_WORDS_PER_MONTH);
    at("2026-11-05T09:00:00Z");
    store.setPlan("u", pro("2026-12-05T09:00:00Z"));
    expect(await quota.checkDetectionQuota("u", 150)).toMatchObject({
      allowed: true,
      used: 0,
      limit: PRO_DETECTION_WORDS_PER_MONTH,
    });
  });

  it("retour en Gratuit : les mots déjà utilisés dans le mois restent comptés", async () => {
    const { quota, store, at } = setup(pro("2026-12-05T09:00:00Z"), "2026-11-10T00:00:00Z");
    await quota.consumeDetectionQuota("u", 8000);
    at("2026-11-20T00:00:00Z");
    store.setPlan("u", FREE);
    expect(await quota.checkDetectionQuota("u", 150)).toMatchObject({ allowed: false, used: 8000 });
  });

  it("reste juste quand le stockage refuse (requête concurrente)", async () => {
    const base = createMemoryQuotaStore({ u: FREE });
    const racing: QuotaStore = { ...base, addDetectionWords: () => Promise.resolve(null) };
    const quota = createQuota(racing, () => d("2026-11-10T00:00:00Z"));
    expect(await quota.consumeDetectionQuota("u", 300)).toMatchObject({
      allowed: false,
      reason: "QUOTA_EXCEEDED",
    });
  });
});

describe("quota de réécriture", () => {
  it(`Gratuit : ${FREE_REWRITE_REQUESTS_PER_DAY} par jour, remis à zéro à minuit UTC`, async () => {
    const { quota, at } = setup(FREE, "2026-11-10T08:00:00Z");
    for (let i = 1; i <= FREE_REWRITE_REQUESTS_PER_DAY; i++) {
      expect(await quota.consumeRewriteQuota("u")).toMatchObject({ allowed: true, used: i });
    }
    const refused = await quota.consumeRewriteQuota("u");
    expect(refused).toMatchObject({
      allowed: false,
      reason: "QUOTA_EXCEEDED",
      resetsAt: d("2026-11-11T00:00:00Z"),
      limitHidden: false,
    });
    at("2026-11-10T23:59:59.999Z");
    expect((await quota.checkRewriteQuota("u")).allowed).toBe(false);
    at("2026-11-11T00:00:00Z");
    expect(await quota.consumeRewriteQuota("u")).toMatchObject({ allowed: true, used: 1 });
  });

  it("Pro : limite d'usage équitable, signalée comme non affichée", async () => {
    const { quota } = setup(pro("2026-12-15T10:00:00Z"), "2026-11-10T08:00:00Z");
    expect(await quota.checkRewriteQuota("u")).toMatchObject({
      allowed: true,
      limit: PRO_REWRITE_FAIR_USE_PER_DAY,
      limitHidden: true,
    });
  });

  it("blocage doux : un quota de détection épuisé n'empêche pas de réécrire", async () => {
    const { quota } = setup(FREE, "2026-11-10T08:00:00Z");
    await quota.consumeDetectionQuota("u", FREE_DETECTION_WORDS_PER_MONTH);
    expect((await quota.checkDetectionQuota("u", 150)).allowed).toBe(false);
    expect((await quota.consumeRewriteQuota("u")).allowed).toBe(true);
  });

  it("check ne consomme rien", async () => {
    const { quota } = setup(FREE, "2026-11-10T08:00:00Z");
    await quota.checkRewriteQuota("u");
    await quota.checkRewriteQuota("u");
    expect((await quota.checkRewriteQuota("u")).used).toBe(0);
  });
});
