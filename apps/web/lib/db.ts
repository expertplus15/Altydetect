import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

// Un seul client par processus (le rechargement à chaud de Next en recréerait sinon à chaque édition).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL manquante : voir .env.example.");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

function client(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

/**
 * Client créé à la première requête, pas à l'import : `next build` importe toutes les routes
 * pour collecter leur configuration, sans base de données (Vercel, CI).
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, property): unknown {
    const value: unknown = Reflect.get(client(), property);
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(client())
      : value;
  },
});
