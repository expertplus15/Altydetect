import { describe, expect, it, vi } from "vitest";

// Le client n'est créé qu'à la première requête : importer le module sans DATABASE_URL (build
// Next.js, Vercel) ne doit pas échouer ; la première requête, elle, signale la variable absente.
describe("client de base paresseux", () => {
  it("s'importe sans DATABASE_URL et échoue clairement à la première requête", async () => {
    vi.resetModules();
    vi.stubEnv("DATABASE_URL", "");
    const globalForPrisma = globalThis as unknown as { prisma?: unknown };
    const saved = globalForPrisma.prisma;
    delete globalForPrisma.prisma;
    try {
      const { db } = await import("./db");
      expect(() => db.user).toThrow("DATABASE_URL manquante");
    } finally {
      globalForPrisma.prisma = saved;
      vi.unstubAllEnvs();
    }
  });
});
