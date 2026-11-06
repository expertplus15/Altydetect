import { expect, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import pg from "pg";

// Outils des tests de bout en bout : boîte e-mail simulée (Redis) et lecture de la base.

// Connexions ouvertes à la demande et refermées après chaque fichier de test.
let redisClient: Redis | null = null;
let poolClient: pg.Pool | null = null;
const redis = () => (redisClient ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379"));
const pool = () => (poolClient ??= new pg.Pool({ connectionString: process.env.DATABASE_URL }));

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

/** Lien de connexion déposé par AUTH_EMAIL_TRANSPORT=log. */
export async function magicLink(email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const link = await redis().get(`test:magic-link:${email.toLowerCase()}`);
    if (link) return link;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Aucun lien de connexion pour ${email}`);
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool().query<T>(sql, params)).rows;
}

/** Saisit un texte dans l'éditeur Tiptap (remplace le contenu). */
export async function typeInEditor(page: Page, text: string, index = 0): Promise<void> {
  const editor = page.getByRole("textbox").nth(index);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text);
  await expect(editor).toContainText(text.slice(0, 20));
}

/** Remet à zéro les limites d'essai par adresse IP (les tests partent tous de localhost). */
export async function resetTrialLimits(): Promise<void> {
  const keys = await redis().keys("trial:ip:*");
  if (keys.length) await redis().del(...keys);
}

export async function closeHelpers(): Promise<void> {
  await redisClient?.quit();
  await poolClient?.end();
  redisClient = null;
  poolClient = null;
}
