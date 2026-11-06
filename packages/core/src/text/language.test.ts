import { describe, expect, it } from "vitest";
import { detectLanguage } from "./language";

describe("detectLanguage", () => {
  it("reconnaît le français", () => {
    expect(detectLanguage("Les résultats de l'enquête montrent que la méthode est efficace.")).toBe(
      "fr",
    );
  });
  it("reconnaît l'anglais", () => {
    expect(detectLanguage("The results of the survey show that the method is effective.")).toBe(
      "en",
    );
  });
  it("choisit le français par défaut quand rien ne tranche", () => {
    expect(detectLanguage("OK 2026")).toBe("fr");
  });
});
