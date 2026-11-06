import { describe, expect, it } from "vitest";
import { buildMagicLinkEmail, localeFromMagicLink } from "./email";

const link = (callback: string) =>
  `https://altydetect.com/api/auth/callback/resend?token=abc&callbackUrl=${encodeURIComponent(callback)}`;

describe("e-mail de connexion", () => {
  it("choisit la langue de la page d'origine", () => {
    expect(localeFromMagicLink(link("/en/app/rewrite"))).toBe("en");
    expect(localeFromMagicLink(link("/fr/app"))).toBe("fr");
    expect(localeFromMagicLink("https://altydetect.com/api/auth/callback/resend?token=abc")).toBe(
      "fr",
    );
  });

  it("rédige l'e-mail en français et en anglais", () => {
    const fr = buildMagicLinkEmail("fr", link("/fr/app"));
    const en = buildMagicLinkEmail("en", link("/en/app"));
    expect(fr.subject).toContain("altydetect.com");
    expect(fr.text).toContain("token=abc");
    expect(fr.html).toContain('lang="fr"');
    expect(en.html).toContain('lang="en"');
    expect(fr.subject).not.toBe(en.subject);
  });

  it("échappe le lien dans le HTML", () => {
    const { html } = buildMagicLinkEmail("fr", 'https://altydetect.com/x?a="><script>');
    expect(html).not.toContain("<script>");
  });
});
