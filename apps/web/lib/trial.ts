import "server-only";
import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

// Essai sans compte : une utilisation de l'éditeur par navigateur, résultat gardé 24 h dans Redis
// (jamais en base), puis proposé à l'enregistrement après inscription.

export const TRIAL_COOKIE = "alty_trial";
export const TRIAL_RESULT_TTL_SECONDS = 24 * 60 * 60;
/** Garde-fou contre la création de cookies en boucle : essais par adresse IP et par jour. */
export const TRIAL_MAX_PER_IP_PER_DAY = 5;

export interface TrialResult {
  type: "rewrite" | "write";
  title: string;
  wordCount: number;
  engine: string;
  result: unknown;
}

export function newTrialId(): string {
  return randomBytes(18).toString("base64url");
}

const usedKey = (id: string) => `trial:used:${id}`;
const resultKey = (id: string) => `trial:result:${id}`;
const ipKey = (ip: string, day: string) => `trial:ip:${day}:${ip}`;

export type TrialCheck = "ok" | "already_used" | "ip_limit";

/** Réserve l'essai de ce navigateur. Atomique : deux requêtes simultanées ne passent pas toutes les deux. */
export async function consumeTrial(
  redis: Redis,
  trialId: string,
  ip: string,
  now: Date = new Date(),
): Promise<TrialCheck> {
  const day = now.toISOString().slice(0, 10);
  const ipCount = await redis.incr(ipKey(ip, day));
  if (ipCount === 1) {
    await redis.expire(ipKey(ip, day), 26 * 60 * 60);
  }
  if (ipCount > TRIAL_MAX_PER_IP_PER_DAY) {
    return "ip_limit";
  }
  const reserved = await redis.set(usedKey(trialId), "1", "EX", 365 * 24 * 60 * 60, "NX");
  return reserved === "OK" ? "ok" : "already_used";
}

export async function hasUsedTrial(redis: Redis, trialId: string): Promise<boolean> {
  return (await redis.exists(usedKey(trialId))) === 1;
}

export async function saveTrialResult(redis: Redis, trialId: string, result: TrialResult) {
  await redis.set(resultKey(trialId), JSON.stringify(result), "EX", TRIAL_RESULT_TTL_SECONDS);
}

export async function getTrialResult(redis: Redis, trialId: string): Promise<TrialResult | null> {
  const raw = await redis.get(resultKey(trialId));
  return raw ? (JSON.parse(raw) as TrialResult) : null;
}

/** Lit et supprime le résultat en une opération (enregistré au plus une fois). */
export async function takeTrialResult(redis: Redis, trialId: string): Promise<TrialResult | null> {
  const raw = await redis.getdel(resultKey(trialId));
  return raw ? (JSON.parse(raw) as TrialResult) : null;
}
