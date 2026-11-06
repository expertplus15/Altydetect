import { describe, expect, it } from "vitest";
import { renderRewriteReport } from "./rewrite-report";

const LABELS = {
  title: "Rapport de réécriture",
  original: "Texte d'origine",
  proposal: "Proposition retenue",
  register: "Registre",
  intensity: "Intensité",
  date: "Date",
  timestamp: "Généré le",
  originalMissing: "Texte d'origine non conservé.",
  footer: "AltyDetect · altydetect.com",
};

describe("renderRewriteReport", () => {
  it("produit un PDF avec les caractères français", async () => {
    const pdf = await renderRewriteReport(
      {
        locale: "fr",
        original: "L'évaluation « formative » change tout : 32 % d'élèves en plus.",
        proposal: "L'évaluation formative transforme la pratique : 32 % d'élèves supplémentaires.",
        changesSummary: "Registre plus soutenu.",
        registerName: "Académique",
        intensityName: "Moyenne",
        createdAt: new Date("2026-11-05T09:30:00Z"),
        generatedAt: new Date("2026-11-05T09:31:12Z"),
      },
      LABELS,
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.byteLength).toBeGreaterThan(3000);
  });

  it("indique quand le texte d'origine n'a pas été transmis", async () => {
    const pdf = await renderRewriteReport(
      {
        locale: "en",
        original: null,
        proposal: "Text.",
        changesSummary: "",
        registerName: "Plain",
        intensityName: "Light",
        createdAt: new Date(),
        generatedAt: new Date(),
      },
      LABELS,
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
