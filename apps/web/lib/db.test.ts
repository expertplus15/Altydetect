import { afterAll, describe, expect, it } from "vitest";
import { db } from "./db";

// Test d'intégration : nécessite une base migrée (DATABASE_URL). Exécuté en CI.
describe.skipIf(!process.env.DATABASE_URL)("schéma Prisma", () => {
  const email = `db-test-${Date.now()}@example.test`;

  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("applique les valeurs par défaut de User et supprime en cascade", async () => {
    const user = await db.user.create({
      data: {
        email,
        documents: {
          create: {
            title: "Essai",
            wordCount: 12,
            analyses: { create: { type: "rewrite", engine: "test", resultJson: { ok: true } } },
          },
        },
      },
      include: { documents: true },
    });

    expect(user.locale).toBe("fr");
    expect(user.trainingOptIn).toBe(false);
    expect(user.documents[0]?.source).toBe("paste");
    // Le texte n'est jamais stocké par défaut (CLAUDE.md §4.5).
    expect(user.documents[0]?.text).toBeNull();

    await db.user.delete({ where: { id: user.id } });
    expect(await db.analysis.count({ where: { document: { userId: user.id } } })).toBe(0);
  });
});
