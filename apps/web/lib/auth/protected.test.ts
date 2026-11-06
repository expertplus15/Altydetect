import { describe, expect, it } from "vitest";
import { isProtectedPath, safeCallbackUrl, signInRedirectPath } from "./protected";

describe("isProtectedPath", () => {
  it("protège /app dans les deux langues", () => {
    expect(isProtectedPath("/fr/app")).toBe(true);
    expect(isProtectedPath("/en/app/history")).toBe(true);
    expect(isProtectedPath("/fr/app/reecrire")).toBe(true);
  });

  it("laisse passer les pages publiques", () => {
    expect(isProtectedPath("/fr")).toBe(false);
    expect(isProtectedPath("/fr/tarifs")).toBe(false);
    expect(isProtectedPath("/fr/application")).toBe(false);
  });
});

describe("signInRedirectPath", () => {
  it("renvoie vers la connexion dans la bonne langue avec la page demandée", () => {
    expect(signInRedirectPath("/fr/app/compte", "")).toBe(
      "/fr/connexion?callbackUrl=%2Ffr%2Fapp%2Fcompte",
    );
    expect(signInRedirectPath("/en/app/history", "?type=rewrite")).toBe(
      "/en/sign-in?callbackUrl=%2Fen%2Fapp%2Fhistory%3Ftype%3Drewrite",
    );
  });
});

describe("safeCallbackUrl", () => {
  it("refuse les adresses externes", () => {
    expect(safeCallbackUrl("https://evil.example", "/fr/app")).toBe("/fr/app");
    expect(safeCallbackUrl("//evil.example", "/fr/app")).toBe("/fr/app");
    expect(safeCallbackUrl("/\\evil.example", "/fr/app")).toBe("/fr/app");
    expect(safeCallbackUrl(null, "/fr/app")).toBe("/fr/app");
  });

  it("garde un chemin local", () => {
    expect(safeCallbackUrl("/en/app/rewrite", "/fr/app")).toBe("/en/app/rewrite");
  });
});
