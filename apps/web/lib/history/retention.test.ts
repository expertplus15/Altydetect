import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { applyRetention, retentionCutoff } from "./retention";

describe("retentionCutoff", () => {
  it("7 jours en Gratuit, 12 mois en Pro", () => {
    const now = new Date("2026-11-05T03:15:00Z");
    expect(retentionCutoff("free", now)).toEqual(new Date("2026-10-29T03:15:00Z"));
    expect(retentionCutoff("pro", now)).toEqual(new Date("2025-11-05T03:15:00Z"));
  });
});

// Test d'intégration : vraie base.
describe.skipIf(!process.env.DATABASE_URL)("applyRetention", () => {
  const stamp = Date.now();
  const emails = [`ret-free-${stamp}@example.test`, `ret-pro-${stamp}@example.test`];
  const now = new Date("2026-11-05T03:15:00Z");
  const day = 24 * 60 * 60 * 1000;

  beforeAll(async () => {
    for (const [i, email] of emails.entries()) {
      const user = await db.user.create({ data: { email } });
      if (i === 1) await db.subscription.create({ data: { userId: user.id, plan: "pro" } });
      for (const age of [1, 8, 200, 400]) {
        await db.document.create({
          data: {
            userId: user.id,
            title: `${age} jours`,
            wordCount: 10,
            createdAt: new Date(now.getTime() - age * day),
          },
        });
      }
    }
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  });

  it("supprime ce qui dépasse la durée du plan, et rien d'autre", async () => {
    await applyRetention(now);
    const titles = async (email: string) =>
      (
        await db.document.findMany({ where: { user: { email } }, orderBy: { createdAt: "desc" } })
      ).map((d) => d.title);
    expect(await titles(emails[0] ?? "")).toEqual(["1 jours"]);
    expect(await titles(emails[1] ?? "")).toEqual(["1 jours", "8 jours", "200 jours"]);
  });
});
