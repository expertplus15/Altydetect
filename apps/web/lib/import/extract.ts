import "server-only";
import { countWords } from "@altydetect/core";

// Extraction du texte d'un fichier importé. Le fichier reste en mémoire : il n'est jamais écrit
// sur disque ni dans un stockage, il disparaît à la fin de la requête.

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export type ImportError =
  "FILE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "EMPTY_TEXT" | "EXTRACTION_FAILED";

export type ImportResult =
  | { ok: true; source: "pdf" | "docx"; title: string; text: string; wordCount: number }
  | { ok: false; error: ImportError };

/** Type réel du fichier, d'après ses premiers octets (l'extension seule ne suffit pas). */
export function detectFileType(bytes: Uint8Array): "pdf" | "docx" | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"; // %PDF
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "docx"; // archive ZIP (format Office Open XML)
  }
  return null;
}

/** Nettoie le texte extrait : fins de ligne, espaces en trop, coupures de mots en fin de ligne. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function titleFrom(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return (base || "Document").slice(0, 120);
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  return (await mammoth.extractRawText({ buffer })).value;
}

export async function extractText(file: {
  name: string;
  bytes: Uint8Array;
}): Promise<ImportResult> {
  if (file.bytes.byteLength > MAX_IMPORT_BYTES) {
    return { ok: false, error: "FILE_TOO_LARGE" };
  }
  const type = detectFileType(file.bytes);
  const extension = file.name.toLowerCase().split(".").pop();
  if (!type || extension !== type) {
    return { ok: false, error: "UNSUPPORTED_TYPE" };
  }
  let raw: string;
  try {
    const buffer = Buffer.from(file.bytes);
    raw = type === "pdf" ? await extractPdf(buffer) : await extractDocx(buffer);
  } catch {
    return { ok: false, error: "EXTRACTION_FAILED" };
  }
  const text = normalizeExtractedText(raw);
  const wordCount = countWords(text);
  if (wordCount === 0) {
    // PDF scanné sans couche texte, par exemple.
    return { ok: false, error: "EMPTY_TEXT" };
  }
  return { ok: true, source: type, title: titleFrom(file.name), text, wordCount };
}
