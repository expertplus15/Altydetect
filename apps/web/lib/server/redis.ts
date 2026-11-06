import "server-only";
import { Redis } from "ioredis";

// Un seul client Redis par processus.
const globalForRedis = globalThis as unknown as { redis?: Redis };

function createClient(): Redis {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL manquante : voir .env.example.");
  }
  return new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
}

export function getRedis(): Redis {
  globalForRedis.redis ??= createClient();
  return globalForRedis.redis;
}
