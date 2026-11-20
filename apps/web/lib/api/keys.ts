import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";

// Clés de l'API publique (ADR-0019) : « alty_ » + 32 caractères base 62. Seule l'empreinte
// SHA-256 est enregistrée ; la clé complète n'est rendue qu'une fois, à sa création.

export const API_KEY_PREFIX = "alty_";
export const API_KEY_LENGTH = 32;
/** Nombre maximal de clés actives (non révoquées) par compte. */
export const MAX_ACTIVE_API_KEYS = 5;
/** Longueur maximale du nom donné à une clé. */
export const API_KEY_NAME_MAX = 60;

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_PATTERN = new RegExp(`^${API_KEY_PREFIX}[0-9A-Za-z]{${API_KEY_LENGTH}}$`);

/** Nouvelle clé aléatoire (tirage sans biais : octets ≥ 248 rejetés). */
export function generateApiKey(): string {
  let out = "";
  while (out.length < API_KEY_LENGTH) {
    for (const byte of randomBytes(API_KEY_LENGTH)) {
      if (byte < 248 && out.length < API_KEY_LENGTH) out += ALPHABET[byte % 62];
    }
  }
  return API_KEY_PREFIX + out;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Début affiché de la clé : préfixe + 6 caractères. */
export function displayPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 6);
}

export function isWellFormedApiKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/** Clé lue dans l'en-tête Authorization: Bearer <clé>, ou null. */
export function bearerKey(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

export function isPublicApiEnabled(): boolean {
  return process.env.PUBLIC_API_ENABLED === "true";
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export type CreateApiKeyResult =
  | { ok: true; key: string; summary: ApiKeySummary }
  | { ok: false; reason: "LIMIT_REACHED" | "INVALID_NAME" };

/** Crée une clé ; la valeur complète n'est rendue qu'ici. */
export async function createApiKey(userId: string, name: string): Promise<CreateApiKeyResult> {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > API_KEY_NAME_MAX)
    return { ok: false, reason: "INVALID_NAME" };
  const active = await db.apiKey.count({ where: { userId, revokedAt: null } });
  if (active >= MAX_ACTIVE_API_KEYS) return { ok: false, reason: "LIMIT_REACHED" };
  const key = generateApiKey();
  const row = await db.apiKey.create({
    data: { userId, name: cleanName, prefix: displayPrefix(key), hash: hashApiKey(key) },
  });
  return {
    ok: true,
    key,
    summary: {
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
    },
  };
}

/** Clés actives d'un compte, les plus récentes d'abord. */
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  return db.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true },
  });
}

/** Révoque une clé du compte ; sans effet sur la clé d'un autre compte. */
export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const { count } = await db.apiKey.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return count === 1;
}

/** Compte propriétaire d'une clé active, ou null. Met à jour la date de dernière utilisation. */
export async function authenticateApiKey(key: string | null): Promise<string | null> {
  if (!key || !isWellFormedApiKey(key)) return null;
  const row = await db.apiKey.findUnique({ where: { hash: hashApiKey(key) } });
  if (!row || row.revokedAt) return null;
  await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return row.userId;
}
