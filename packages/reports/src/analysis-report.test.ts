import { describe, expect, it } from "vitest";
import { highlightSegments, renderAnalysisReport } from "./analysis-report";

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
});
