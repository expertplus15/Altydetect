import { describe, expect, it } from "vitest";
import { detectInputSchema, detectOutputSchema, veritasDetectRequestSchema } from "./detect";

describe("contrat de détection", () => {
  it("applique les valeurs par défaut de l'entrée", () => {
    expect(detectInputSchema.parse({ text: " Un texte. " })).toEqual({
      text: "Un texte.",
      language: "auto",
      mode: "standard",
      keep_text: false,
    });
  });

  it("refuse un mode inconnu", () => {
    expect(detectInputSchema.safeParse({ text: "x", mode: "fast" }).success).toBe(false);
  });

  it("ajoute l'offre à la requête envoyée à Veritas, sans keep_text", () => {
    const parsed = veritasDetectRequestSchema.parse({ text: "x", plan: "pro", keep_text: true });
    expect(parsed).toEqual({ text: "x", language: "auto", mode: "standard", plan: "pro" });
  });

  it("valide une sortie complète et refuse une bande inconnue", () => {
    const output = {
      overall: { ai: 0.62, undetermined: 0.14, human: 0.24 },
      confidence: "medium",
      verdict_band: "likely_ai",
      language: "fr",
      sentences: [{ start: 0, end: 40, score: 0.8, band: "likely_ai" }],
      signals: { humanization: "none" },
      engine: { primary: "pangram", secondary: "VRT-DET-FR-0.1", agreement: 0.9 },
      word_count: 1284,
    };
    expect(detectOutputSchema.parse(output)).toEqual(output);
    expect(detectOutputSchema.safeParse({ ...output, verdict_band: "ai" }).success).toBe(false);
  });
});
