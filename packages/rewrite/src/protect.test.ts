import { describe, expect, it } from "vitest";
import { protectSpans, restorePartial, restoreSpans } from "./protect";

const SAMPLE =
  "Comme le dit « l'évaluation formative change la relation à l'erreur » (Durand, 2021, p. 48), " +
  "les élèves progressent [12]. On observe un gain de 32 %, soit 1 200 € par classe. " +
  'Données : https://data.education.gouv.fr/enquete. Il a dit "merci" (vraiment).';

describe("protection des citations", () => {
  it("protège citations, références, chiffres et URL", () => {
    const { masked, spans } = protectSpans(SAMPLE);
    expect(spans).toEqual([
      "« l'évaluation formative change la relation à l'erreur »",
      "(Durand, 2021, p. 48)",
      "[12]",
      "32 %",
      "1 200 €",
      "https://data.education.gouv.fr/enquete",
      '"merci"',
    ]);
    expect(masked).toContain("Comme le dit ⟦1⟧ ⟦2⟧, les élèves progressent ⟦3⟧.");
    // Une parenthèse sans chiffre reste modifiable.
    expect(masked).toContain("(vraiment)");
    expect(masked).not.toMatch(/\d{2}/);
  });

  it("restaure tous les passages et signale ceux qui manquent", () => {
    const { masked, spans } = protectSpans(SAMPLE);
    expect(restoreSpans(masked, spans)).toEqual({ text: SAMPLE, missing: [] });
    const rewritten = "Selon ⟦1⟧ ⟦2⟧, le gain atteint ⟦4⟧.";
    const result = restoreSpans(rewritten, spans);
    expect(result.text).toContain("(Durand, 2021, p. 48)");
    expect(result.missing).toEqual([3, 5, 6, 7]);
  });

  it("garde l'URL sans la ponctuation finale", () => {
    expect(protectSpans("Voir www.exemple.fr.").spans).toEqual(["www.exemple.fr"]);
  });

  it("masque un marqueur coupé en fin de flux", () => {
    expect(restorePartial("Le gain atteint ⟦1", ["32 %"])).toBe("Le gain atteint ");
    expect(restorePartial("Le gain atteint ⟦1⟧", ["32 %"])).toBe("Le gain atteint 32 %");
  });
});
