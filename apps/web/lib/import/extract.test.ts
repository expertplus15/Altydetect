import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectFileType, extractText, MAX_IMPORT_BYTES, normalizeExtractedText } from "./extract";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url)));

describe("import de fichiers", () => {
  it("extrait le texte d'un DOCX", async () => {
    const result = await extractText({ name: "Mémoire.docx", bytes: fixture("memoire.docx") });
    expect(result).toMatchObject({ ok: true, source: "docx", title: "Mémoire" });
    if (result.ok) {
      expect(result.text).toContain("gain de 32 %");
      expect(result.text).toContain("Deuxième paragraphe");
      expect(result.wordCount).toBe(13);
    }
  });

  it("extrait le texte d'un PDF", async () => {
    const result = await extractText({ name: "enquete.pdf", bytes: fixture("enquete.pdf") });
    expect(result).toMatchObject({ ok: true, source: "pdf", title: "enquete" });
    if (result.ok) expect(result.text).toContain("montrent un gain");
  });

  it("refuse un fichier de plus de 10 Mo", async () => {
    const bytes = new Uint8Array(MAX_IMPORT_BYTES + 1);
    bytes.set([0x25, 0x50, 0x44, 0x46]);
    expect(await extractText({ name: "gros.pdf", bytes })).toEqual({
      ok: false,
      error: "FILE_TOO_LARGE",
    });
  });

  it("refuse un fichier dont le contenu ne correspond pas à l'extension", async () => {
    expect(await extractText({ name: "faux.pdf", bytes: fixture("memoire.docx") })).toEqual({
      ok: false,
      error: "UNSUPPORTED_TYPE",
    });
    expect(
      await extractText({ name: "notes.txt", bytes: new TextEncoder().encode("bonjour") }),
    ).toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
  });

  it("signale un PDF illisible", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.4 cassé");
    expect(await extractText({ name: "casse.pdf", bytes })).toEqual({
      ok: false,
      error: "EXTRACTION_FAILED",
    });
  });

  it("reconnaît les types par leurs premiers octets", () => {
    expect(detectFileType(fixture("enquete.pdf"))).toBe("pdf");
    expect(detectFileType(fixture("memoire.docx"))).toBe("docx");
    expect(detectFileType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it("recolle les mots coupés en fin de ligne et réduit les blancs", () => {
    expect(normalizeExtractedText("éva-\nluation  formative\r\n\n\n\nfin  ")).toBe(
      "évaluation formative\n\nfin",
    );
  });
});
