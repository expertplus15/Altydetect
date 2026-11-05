import { describe, expect, it } from "vitest";
import { metadataFromHtml } from "./metadata";

describe("metadataFromHtml", () => {
  it("lit les balises citation_* d'un article", () => {
    const html = `<html><head><title>Ignoré</title>
      <meta name="citation_title" content="L&#39;évaluation formative au collège">
      <meta name="citation_author" content="Durand, Marie">
      <meta name="citation_author" content="Paul Martin">
      <meta name="citation_journal_title" content="Revue française de pédagogie">
      <meta name="citation_publication_date" content="2021/09/15">
      <meta name="citation_volume" content="212"><meta name="citation_issue" content="3">
      <meta name="citation_firstpage" content="45"><meta name="citation_lastpage" content="62">
      <meta name="citation_doi" content="10.4000/rfp.1234"></head></html>`;
    expect(metadataFromHtml(html, "https://journals.example/rfp/1234", "2026-11-05")).toEqual({
      type: "article",
      authors: [
        { family: "Durand", given: "Marie" },
        { family: "Martin", given: "Paul" },
      ],
      title: "L'évaluation formative au collège",
      year: "2021",
      container: "Revue française de pédagogie",
      volume: "212",
      issue: "3",
      pages: "45-62",
      publisher: "",
      url: "https://journals.example/rfp/1234",
      doi: "10.4000/rfp.1234",
      accessed: "2026-11-05",
    });
  });

  it("se rabat sur Open Graph et <title> pour une page web", () => {
    const html = `<title>Repères 2025 &amp; statistiques</title><meta property="og:site_name" content="education.gouv.fr">`;
    expect(
      metadataFromHtml(html, "https://www.education.gouv.fr/rers", "2026-11-05"),
    ).toMatchObject({
      type: "web",
      title: "Repères 2025 & statistiques",
      container: "education.gouv.fr",
      authors: [],
    });
  });
});
