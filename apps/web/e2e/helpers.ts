import { expect, type Page } from "@playwright/test";
import { Redis } from "ioredis";
import pg from "pg";
import { routing, type AppLocale, type AppPathname } from "../i18n/routing";
import en from "../messages/en.json" with { type: "json" };
import fr from "../messages/fr.json" with { type: "json" };

// Outils des tests de bout en bout : boîte e-mail simulée (Redis) et lecture de la base.

// Connexions ouvertes à la demande et refermées après chaque fichier de test.
let redisClient: Redis | null = null;
let poolClient: pg.Pool | null = null;
const redis = () => (redisClient ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379"));
const pool = () => (poolClient ??= new pg.Pool({ connectionString: process.env.DATABASE_URL }));

export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;

/**
 * Lien de connexion déposé par AUTH_EMAIL_TRANSPORT=log, rendu seulement quand il est utilisable.
 *
 * Auth.js envoie le lien et enregistre le jeton en base en parallèle (`Promise.all` dans
 * @auth/core, signin/send-token) : le lien peut être dans Redis avant que le jeton soit écrit
 * dans `verification_tokens`. Ouvert trop tôt, le lien échoue (`?error=Verification`) et le
 * test continue déconnecté, sur le formulaire de connexion. On attend donc les deux.
 */
export async function magicLink(email: string): Promise<string> {
  const identifier = email.toLowerCase();
  for (let i = 0; i < 50; i++) {
    const link = await redis().get(`test:magic-link:${identifier}`);
    if (
      link &&
      (await query("select 1 from verification_tokens where identifier = $1", [identifier])).length
    ) {
      return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Aucun lien de connexion utilisable pour ${email}`);
}

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await pool().query<T>(sql, params)).rows;
}

const MESSAGES = { fr, en } as const;

/** Adresse traduite d'une page (clé française de `routing.pathnames`). */
export function localePath(locale: AppLocale, pathname: AppPathname): string {
  const target = routing.pathnames[pathname];
  return `/${locale}${typeof target === "string" ? target : target[locale]}`;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Inscription par lien magique, libellés lus dans les messages next-intl. Chaque étape attend
 * son état (page « vérifiez votre boîte », puis espace connecté) : un échec de connexion est
 * signalé ici, pas plus loin sur une page inattendue.
 */
export async function signUp(page: Page, locale: AppLocale, prefix: string): Promise<string> {
  const email = uniqueEmail(prefix);
  const t = MESSAGES[locale].auth;
  await page.goto(localePath(locale, "/inscription"));
  await page.getByLabel(t.emailLabel).fill(email);
  await page.getByRole("button", { name: t.sendLink }).click();
  await expect(page).toHaveURL(new RegExp(escapeRegExp(localePath(locale, "/connexion/verifier"))));
  await page.goto(await magicLink(email));
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(localePath(locale, "/app"))}(/|$)`));
  return email;
}

/**
 * Saisit un texte dans l'éditeur Tiptap (remplace le contenu). Vise l'éditeur lui-même et non
 * le premier champ de la page : sur une autre page (formulaire de connexion…), l'échec est net.
 */
export async function typeInEditor(page: Page, text: string, index = 0): Promise<void> {
  const editor = page.getByTestId("editor").nth(index);
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
