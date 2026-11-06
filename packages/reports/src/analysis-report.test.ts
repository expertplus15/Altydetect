import { describe, expect, it } from "vitest";
import { bandSegments, highlightSegments, renderAnalysisReport } from "./analysis-report";

const LABELS = {
  title: "Rapport d'analyse",
  date: "Date",
  timestamp: "Généré le",
  engine: "Moteur",
  scope: "Périmètre",
  plagiarism: "Plagiat",
  similarity: "Similarité",
  sources: "Sources",
  source: "Source",
  passages: "Passages",
  bestScore: "Meilleur score",
  text: "Texte analysé",
  textMissing: "Texte non joint.",
  noMatch: "Aucune source.",
  detection: "Détection IA",
  detectionPending: "Bientôt disponible.",
  disclaimer: "Une similarité n'est pas une preuve.",
  footer: "AltyDetect",
};

describe("rapport d'analyse", () => {
  it("découpe le texte en passages surlignés, chevauchements fusionnés", () => {
    expect(
      highlightSegments("abcdefghij", [
        { start: 2, end: 5 },
        { start: 4, end: 7 },
        { start: 8, end: 9 },
      ]),
    ).toEqual([
      { text: "ab", marked: false },
      { text: "cde", marked: true },
      { text: "fg", marked: true },
      { text: "h", marked: false },
      { text: "i", marked: true },
      { text: "j", marked: false },
    ]);
  });

  it("produit un PDF avec sources et texte surligné", async () => {
    const pdf = await renderAnalysisReport(
      {
        locale: "fr",
        scopeName: "Web et base privée",
        engine: "IDX-PRV-1.0,IDX-WEB-1.0",
        createdAt: new Date("2026-11-05T10:00:00Z"),
        generatedAt: new Date("2026-11-05T10:05:00Z"),
        plagiarism: {
          similarity: 0.23,
          text: "Dans les classes observées, les enseignants donnent un retour régulier. Fin.",
          matches: [{ start: 0, end: 70, sourceLabel: "revue.example" }],
          sources: [
            { label: "revue.example", url: "https://revue.example/a", passages: 1, bestScore: 1 },
          ],
        },
      },
      LABELS,
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("découpe le texte par phrase avec sa bande", () => {
    expect(
      bandSegments("Une. Deux. Trois", [
        { start: 0, end: 4, band: "likely_ai" },
        { start: 5, end: 10, band: "likely_human" },
        { start: 11, end: 99, band: "undetermined" },
      ]),
    ).toEqual([
      { text: "Une.", band: "likely_ai" },
      { text: " ", band: null },
      { text: "Deux.", band: "likely_human" },
      { text: " ", band: null },
      { text: "Trois", band: "undetermined" },
    ]);
  });

  it("produit un PDF de détection seule, sans périmètre de plagiat", async () => {
    const pdf = await renderAnalysisReport(
      {
        locale: "en",
        scopeName: null,
        engine: "pangram",
        createdAt: new Date("2026-11-06T10:00:00Z"),
        generatedAt: new Date("2026-11-06T10:05:00Z"),
        detection: {
          overall: { ai: 0.62, undetermined: 0.14, human: 0.24 },
          verdictBand: "likely_ai",
          languageName: "French",
          wordCount: 320,
          text: "Une phrase. Une autre.",
          sentences: [
            { start: 0, end: 11, band: "likely_ai" },
            { start: 12, end: 22, band: "likely_human" },
          ],
        },
      },
      {
        ...LABELS,
        detect: {
          bands: {
            likely_ai: "Likely AI",
            undetermined: "Undetermined",
            likely_human: "Likely human",
          },
          distribution: "Distribution",
          verdict: "Result",
          confidence: "Confidence",
          confidenceName: "Medium",
          language: "Language",
          words: "Words",
          text: "Text",
          disclaimer: "A detector gives a probability, not proof.",
        },
      },
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
