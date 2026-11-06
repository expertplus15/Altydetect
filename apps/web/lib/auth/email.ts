import "server-only";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import { getRedis } from "@/lib/server/redis";
import { localeFromPath } from "./protected";

const MESSAGES = { fr, en } as const;

/** Langue de l'e-mail : celle de la page qui a demandé le lien (callbackUrl). */
export function localeFromMagicLink(url: string): "fr" | "en" {
  try {
    const callback = new URL(url).searchParams.get("callbackUrl");
    return callback ? localeFromPath(new URL(callback, url).pathname) : "fr";
  } catch {
    return "fr";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function buildMagicLinkEmail(locale: "fr" | "en", url: string) {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.magicLink" });
  const host = new URL(url).host;
  const safeUrl = escapeHtml(url);
  const subject = t("subject", { host });
  const text = `${t("intro")}\n\n${url}\n\n${t("ignore")}`;
  const html = `<!doctype html><html lang="${locale}"><body style="margin:0;background:#f5f7fb;font-family:Inter,Arial,sans-serif;color:#141a26">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px">
<tr><td style="font-size:18px;font-weight:700;padding-bottom:16px">AltyDetect</td></tr>
<tr><td style="font-size:15px;line-height:1.6;padding-bottom:24px">${escapeHtml(t("intro"))}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${safeUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(t("button"))}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#586174">${escapeHtml(t("ignore"))}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Clé Redis où le transport « log » dépose le dernier lien (tests de bout en bout uniquement). */
export function testMagicLinkKey(email: string): string {
  return `test:magic-link:${email.toLowerCase()}`;
}

/**
 * Envoie le lien magique. AUTH_EMAIL_TRANSPORT=log (refusé en production) dépose le lien dans
 * Redis au lieu de l'envoyer : utilisé par les tests Playwright.
 */
export async function sendMagicLink(params: {
  identifier: string;
  url: string;
  provider: { apiKey?: string; from?: string };
}): Promise<void> {
  const { identifier, url, provider } = params;
  if (process.env.AUTH_EMAIL_TRANSPORT === "log") {
    if (process.env.NODE_ENV === "production" && process.env.ALTY_E2E !== "1") {
      throw new Error("AUTH_EMAIL_TRANSPORT=log est interdit en production.");
    }
    await getRedis().set(testMagicLinkKey(identifier), url, "EX", 600);
    return;
  }

  const { subject, text, html } = buildMagicLinkEmail(localeFromMagicLink(url), url);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: provider.from, to: identifier, subject, html, text }),
  });
  if (!response.ok) {
    throw new Error(`Resend : envoi refusé (${response.status}).`);
  }
}
