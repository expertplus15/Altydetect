import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FREE_REWRITE_REQUESTS_PER_DAY, startOfUtcDay } from "@altydetect/billing";
import { db } from "@/lib/db";
import { prismaQuotaStore } from "./quota";

// Test d'intégration du stockage SQL des quotas (vraie base, exécuté en CI).
describe.skipIf(!process.env.DATABASE_URL)("stockage SQL des quotas", () => {
  const email = `quota-${Date.now()}@example.test`;
  let userId: string;

  beforeAll(async () => {
    userId = (await db.user.create({ data: { email } })).id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("10 réécritures simultanées : exactement la limite passe", async () => {
    const day = startOfUtcDay(new Date("2026-11-10T12:00:00Z"));
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        prismaQuotaStore.addRewriteRequest(userId, day, FREE_REWRITE_REQUESTS_PER_DAY),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(FREE_REWRITE_REQUESTS_PER_DAY);
    expect((await prismaQuotaStore.getUsage(userId))?.rewriteRequestsToday).toBe(
      FREE_REWRITE_REQUESTS_PER_DAY,
    );
  });

  it("remet le compteur de réécriture à zéro le jour suivant", async () => {
    const next = startOfUtcDay(new Date("2026-11-11T00:00:00Z"));
    const record = await prismaQuotaStore.addRewriteRequest(userId, next, 3);
    expect(record?.rewriteRequestsToday).toBe(1);
    expect(record?.rewriteDate.toISOString().slice(0, 10)).toBe("2026-11-11");
  });

  it("ajoute des mots, refuse au-delà de la limite, puis repart à zéro à la période suivante", async () => {
    const nov = new Date("2026-11-01T00:00:00Z");
    expect(
      (await prismaQuotaStore.addDetectionWords(userId, nov, 4000, 5000))?.detectionWordsUsed,
    ).toBe(4000);
    expect(await prismaQuotaStore.addDetectionWords(userId, nov, 1001, 5000)).toBeNull();
    expect(
      (await prismaQuotaStore.addDetectionWords(userId, nov, 1000, 5000))?.detectionWordsUsed,
    ).toBe(5000);
    const dec = new Date("2026-12-01T00:00:00Z");
    const record = await prismaQuotaStore.addDetectionWords(userId, dec, 150, 5000);
    expect(record).toMatchObject({ detectionWordsUsed: 150, periodStart: dec });
  });

  it("mots simultanés : le total ne dépasse jamais la limite", async () => {
    const jan = new Date("2027-01-01T00:00:00Z");
    const results = await Promise.all(
      Array.from({ length: 8 }, () => prismaQuotaStore.addDetectionWords(userId, jan, 1000, 5000)),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await prismaQuotaStore.getUsage(userId))?.detectionWordsUsed).toBe(5000);
  });
});
