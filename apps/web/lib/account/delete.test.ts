import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { deleteAccountData } from "./delete";

// Test d'intégration : vraie base, Stripe simulé.
describe.skipIf(!process.env.DATABASE_URL)("deleteAccountData", () => {
  const email = `delete-${Date.now()}@example.test`;

  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("supprime le client Stripe puis toutes les données du compte", async () => {
    const user = await db.user.create({
      data: {
        email,
        subscription: { create: { plan: "pro", stripeCustomerId: `cus_del_${Date.now()}` } },
        usage: { create: { periodStart: new Date(), rewriteDate: new Date() } },
        documents: {
          create: {
            title: "Doc",
            wordCount: 3,
            analyses: { create: { type: "rewrite", engine: "x", resultJson: {} } },
          },
        },
        sessions: {
          create: { sessionToken: `tok-${Date.now()}`, expires: new Date(Date.now() + 1e6) },
        },
      },
    });
    await db.privateSource.create({
      data: {
        workspaceId: user.id,
        title: "Réf",
        text: "Texte",
        wordCount: 1,
        fingerprints: { create: { hash: 1n, position: 0 } },
      },
    });
    const del = vi.fn(() => Promise.resolve({}));
    await deleteAccountData(user.id, { customers: { del } } as never);

    expect(del).toHaveBeenCalledOnce();
    expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
    for (const count of await Promise.all([
      db.subscription.count({ where: { userId: user.id } }),
      db.usage.count({ where: { userId: user.id } }),
      db.document.count({ where: { userId: user.id } }),
      db.session.count({ where: { userId: user.id } }),
      db.privateSource.count({ where: { workspaceId: user.id } }),
    ])) {
      expect(count).toBe(0);
    }
  });
});
