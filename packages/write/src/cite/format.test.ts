import { citationFieldsSchema, type CitationFields } from "@altydetect/core";
import { describe, expect, it } from "vitest";
import { formatCitation, missingFields } from "./format";

const fields = (value: Partial<CitationFields> & Pick<CitationFields, "type" | "title">) =>
  citationFieldsSchema.parse(value);

const ARTICLE = fields({
  type: "article",
  authors: [
    { family: "Durand", given: "Marie-Claire" },
    { family: "Martin", given: "Paul" },
  ],
  title: "L'évaluation formative au collège",
  year: "2021",
  container: "Revue française de pédagogie",
  volume: "212",
  issue: "3",
  pages: "45-62",
  doi: "10.4000/rfp.1234",
});

const BOOK = fields({
  type: "book",
  authors: [{ family: "Hattie", given: "John" }],
  title: "Visible Learning",
  year: "2009",
  publisher: "Routledge",
});

const WEB = fields({
  type: "web",
  title: "Repères et références statistiques 2025",
  year: "2025",
  container: "Ministère de l'Éducation nationale",
  url: "https://www.education.gouv.fr/rers-2025",
  accessed: "2026-11-05",
});

describe("formatCitation", () => {
  it("APA 7", () => {
    expect(formatCitation("apa7", ARTICLE)).toBe(
      "Durand, M. C., & Martin, P. (2021). L'évaluation formative au collège. *Revue française de pédagogie*, *212*(3), 45-62. https://doi.org/10.4000/rfp.1234",
    );
    expect(formatCitation("apa7", BOOK)).toBe("Hattie, J. (2009). *Visible Learning*. Routledge.");
  });

  it("MLA 9", () => {
    expect(formatCitation("mla9", ARTICLE)).toBe(
      "Durand, Marie-Claire, and Paul Martin. “L'évaluation formative au collège.” *Revue française de pédagogie*, vol. 212, no. 3, 2021, pp. 45-62, https://doi.org/10.4000/rfp.1234.",
    );
    const three = { ...ARTICLE, authors: [...ARTICLE.authors, { family: "Leroy", given: "Anne" }] };
    expect(formatCitation("mla9", three)).toMatch(/^Durand, Marie-Claire, et al\. /);
  });

  it("Chicago auteur-date", () => {
    expect(formatCitation("chicago", ARTICLE)).toBe(
      "Durand, Marie-Claire, and Paul Martin. 2021. “L'évaluation formative au collège.” *Revue française de pédagogie* 212 (3): 45-62. https://doi.org/10.4000/rfp.1234.",
    );
  });

  it("ISO 690 en français, avec date de consultation", () => {
    expect(formatCitation("iso690", WEB, "fr")).toBe(
      "*Repères et références statistiques 2025* [en ligne]. Ministère de l'Éducation nationale. 2025. Disponible à l'adresse : https://www.education.gouv.fr/rers-2025 [consulté le 2026-11-05]",
    );
    expect(formatCitation("iso690", ARTICLE, "fr")).toBe(
      "DURAND, Marie-Claire, MARTIN, Paul. L'évaluation formative au collège. *Revue française de pédagogie* [en ligne]. 2021, vol. 212, n° 3, p. 45-62. Disponible à l'adresse : https://doi.org/10.4000/rfp.1234",
    );
  });

  it("APA sans auteur : titre en tête, « s.d. » en français, « n.d. » en anglais", () => {
    expect(formatCitation("apa7", WEB)).toBe(
      "*Repères et références statistiques 2025*. (2025). Ministère de l'Éducation nationale. https://www.education.gouv.fr/rers-2025",
    );
    const undated = fields({
      type: "book",
      authors: [{ family: "Hattie", given: "" }],
      title: "Visible Learning",
    });
    expect(formatCitation("apa7", undated, "fr")).toBe("Hattie. (s.d.). *Visible Learning*.");
    expect(formatCitation("apa7", undated, "en")).toBe("Hattie. (n.d.). *Visible Learning*.");
  });

  it("APA : plus de 20 auteurs, les 19 premiers puis le dernier", () => {
    const many = {
      ...ARTICLE,
      authors: Array.from({ length: 22 }, (_, i) => ({ family: `Nom${i + 1}`, given: "Jean" })),
    };
    const result = formatCitation("apa7", many);
    expect(result).toContain("Nom19, J., … Nom22, J. (2021).");
    expect(result).not.toContain("Nom20");
  });

  it("MLA 9 : livre et page web, lien rattaché à la date", () => {
    expect(formatCitation("mla9", BOOK)).toBe("Hattie, John. *Visible Learning*. Routledge, 2009.");
    const web = { ...WEB, authors: [{ family: "Leroy", given: "Anne" }] };
    expect(formatCitation("mla9", web)).toBe(
      "Leroy, Anne. “Repères et références statistiques 2025.” *Ministère de l'Éducation nationale*, 2025, www.education.gouv.fr/rers-2025.",
    );
  });

  it("Chicago : livre, et « n.d. » sans date", () => {
    expect(formatCitation("chicago", BOOK)).toBe(
      "Hattie, John. 2009. *Visible Learning*. Routledge.",
    );
    const undated = { ...WEB, year: "", authors: [{ family: "Leroy", given: "Anne" }] };
    expect(formatCitation("chicago", undated)).toBe(
      "Leroy, Anne. n.d. “Repères et références statistiques 2025.” Ministère de l'Éducation nationale. https://www.education.gouv.fr/rers-2025.",
    );
  });

  it("ISO 690 : livre en anglais, « et al » au-delà de trois auteurs", () => {
    expect(formatCitation("iso690", BOOK, "en")).toBe(
      "HATTIE, John. *Visible Learning*. Routledge, 2009.",
    );
    const four = {
      ...ARTICLE,
      doi: "",
      authors: Array.from({ length: 4 }, (_, i) => ({ family: `Nom${i + 1}`, given: "" })),
    };
    expect(formatCitation("iso690", four)).toMatch(/^NOM1, NOM2, NOM3 et al\. /);
  });

  it("signale les champs manquants", () => {
    expect(missingFields(WEB)).toEqual(["authors"]);
    expect(missingFields(fields({ type: "book", title: "Sans éditeur" }))).toEqual([
      "authors",
      "year",
      "publisher",
    ]);
  });
});
