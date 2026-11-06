import { REWRITE_REGISTERS } from "@altydetect/core";
import { describe, expect, it } from "vitest";
import { buildRewriteRequest } from "../build";
import { REGISTER_PROMPTS, systemPrompt } from "./index";

const FR_TEXT =
  "Les résultats de l'enquête montrent que la méthode est vraiment très efficace. " +
  "Comme le dit « l'évaluation change tout » (Durand, 2021), le gain atteint 32 %.";
const EN_TEXT =
  "The results of the survey show that the method is really effective. " +
  'As "assessment changes everything" (Smith, 2021) shows, the gain reaches 32%.';

// Vocabulaire interdit (CLAUDE.md §7), y compris dans les prompts.
const FORBIDDEN = /contourner|bypass|indétectable|undetectable|tromper|détecteur|detector|humaniz/i;

describe("prompts de réécriture", () => {
  it("existe pour chaque registre, en français et en anglais", () => {
    for (const register of REWRITE_REGISTERS) {
      for (const language of ["fr", "en"] as const) {
        const prompt = REGISTER_PROMPTS[register][language];
        expect(prompt.name.length).toBeGreaterThan(2);
        expect(prompt.instructions.length).toBeGreaterThan(40);
      }
    }
  });

  it("ne contient aucun terme du vocabulaire interdit", () => {
    const all = [
      systemPrompt("fr"),
      systemPrompt("en"),
      ...REWRITE_REGISTERS.flatMap((r) => [
        REGISTER_PROMPTS[r].fr.instructions,
        REGISTER_PROMPTS[r].en.instructions,
      ]),
    ].join("\n");
    expect(all).not.toMatch(FORBIDDEN);
  });

  it("rédige la requête dans la langue détectée du texte", () => {
    const fr = buildRewriteRequest({
      text: FR_TEXT,
      register: "academic",
      intensity: 2,
      preserve_citations: true,
      variants: 1,
    });
    const en = buildRewriteRequest({
      text: EN_TEXT,
      register: "academic",
      intensity: 2,
      preserve_citations: true,
      variants: 1,
    });
    expect(fr.language).toBe("fr");
    expect(fr.system).toContain("en français");
    expect(fr.user).toContain("Registre : académique");
    expect(fr.user).toContain("Intensité moyenne");
    expect(en.language).toBe("en");
    expect(en.system).toContain("in English");
    expect(en.user).toContain("Register : academic");
    expect(en.user).toContain("Medium intensity");
  });

  it("masque citations, références et chiffres quand preserve_citations est actif", () => {
    const request = buildRewriteRequest({
      text: FR_TEXT,
      register: "simple",
      intensity: 3,
      preserve_citations: true,
      variants: 1,
    });
    expect(request.spans).toEqual(["« l'évaluation change tout »", "(Durand, 2021)", "32 %"]);
    expect(request.user).toContain("Comme le dit ⟦1⟧ ⟦2⟧, le gain atteint ⟦3⟧.");
    expect(request.user).not.toContain("Durand");
    expect(request.system).toContain("⟦1⟧");
  });

  it("envoie le texte tel quel sans preserve_citations", () => {
    const request = buildRewriteRequest({
      text: FR_TEXT,
      register: "simple",
      intensity: 1,
      preserve_citations: false,
      variants: 1,
    });
    expect(request.spans).toEqual([]);
    expect(request.user).toContain("(Durand, 2021)");
  });

  it("demande le bon nombre de propositions et le format balisé", () => {
    const request = buildRewriteRequest({
      text: FR_TEXT,
      register: "professional",
      intensity: 2,
      preserve_citations: true,
      variants: 3,
    });
    expect(request.user).toContain("Rédige 3 propositions nettement différentes");
    expect(request.user).toContain("<proposition>");
    expect(request.user).toContain("<changements>");
    // Le prompt système ne varie pas avec la requête : il reste cacheable.
    expect(request.system).toBe(systemPrompt("fr"));
  });
});
