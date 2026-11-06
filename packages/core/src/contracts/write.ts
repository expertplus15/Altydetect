import { z } from "zod";

// Contrats du module Écrire (POST /internal/v1/write/*). Un changement = une nouvelle version.

export const WRITE_LEVELS = ["secondary", "bachelor", "master", "professional"] as const;

export const outlineInputSchema = z.object({
  subject: z.string().trim().min(3).max(300),
  level: z.enum(WRITE_LEVELS),
  /** Langue du plan ; « auto » suit la langue du sujet. */
  language: z.enum(["auto", "fr", "en"]).default("auto"),
});
export type OutlineInput = z.infer<typeof outlineInputSchema>;

// Schémas de sortie du modèle : objets stricts, sans contrainte de longueur (structured outputs).
export const outlineOutputSchema = z.strictObject({
  title: z.string(),
  sections: z.array(z.strictObject({ heading: z.string(), points: z.array(z.string()) })),
});
export type OutlineOutput = z.infer<typeof outlineOutputSchema>;

export const correctInputSchema = z.object({ text: z.string().trim().min(1).max(60000) });
export type CorrectInput = z.infer<typeof correctInputSchema>;

export const CORRECTION_KINDS = ["spelling", "grammar", "punctuation", "typography"] as const;

/** Correction telle que le modèle la renvoie (sans position). */
export const correctionDraftSchema = z.strictObject({
  original: z.string(),
  replacement: z.string(),
  kind: z.enum(CORRECTION_KINDS),
  explanation: z.string(),
  /** Quelques mots autour de l'erreur, pour la retrouver si elle apparaît plusieurs fois. */
  context: z.string(),
});
export const correctionDraftsSchema = z.strictObject({
  corrections: z.array(correctionDraftSchema),
});
export type CorrectionDraft = z.infer<typeof correctionDraftSchema>;

export const correctionSchema = z.object({
  start: z.number().int(),
  end: z.number().int(),
  original: z.string(),
  replacement: z.string(),
  kind: z.enum(CORRECTION_KINDS),
  explanation: z.string(),
});
export type Correction = z.infer<typeof correctionSchema>;
export interface CorrectOutput {
  corrections: Correction[];
}

export const SUMMARY_LENGTHS = ["short", "medium", "long"] as const;
export const summarizeInputSchema = z.object({
  text: z.string().trim().min(1).max(60000),
  length: z.enum(SUMMARY_LENGTHS),
});
export type SummarizeInput = z.infer<typeof summarizeInputSchema>;
export interface SummarizeOutput {
  summary: string;
}

export const CITATION_STYLES = ["apa7", "mla9", "chicago", "iso690"] as const;
export type CitationStyle = (typeof CITATION_STYLES)[number];

export const citationFieldsSchema = z.object({
  type: z.enum(["article", "book", "web"]),
  authors: z
    .array(
      z.object({
        family: z.string().trim().min(1).max(120),
        given: z.string().trim().max(120).default(""),
      }),
    )
    .max(30)
    .default([]),
  title: z.string().trim().min(1).max(500),
  year: z.string().trim().max(20).default(""),
  container: z.string().trim().max(300).default(""),
  volume: z.string().trim().max(20).default(""),
  issue: z.string().trim().max(20).default(""),
  pages: z.string().trim().max(30).default(""),
  publisher: z.string().trim().max(200).default(""),
  url: z.string().trim().max(2000).default(""),
  doi: z.string().trim().max(200).default(""),
  /** Date de consultation (AAAA-MM-JJ), pour les pages web. */
  accessed: z.string().trim().max(10).default(""),
});
export type CitationFields = z.infer<typeof citationFieldsSchema>;

export const citeInputSchema = z.object({
  style: z.enum(CITATION_STYLES),
  /** Langue des mentions (« consulté le », « disponible à l'adresse »). */
  locale: z.enum(["fr", "en"]).default("fr"),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("url"), url: z.url({ protocol: /^https?$/ }).max(2000) }),
    z.object({ kind: z.literal("fields"), fields: citationFieldsSchema }),
  ]),
});
export type CiteInput = z.infer<typeof citeInputSchema>;
export interface CiteOutput {
  /** Référence mise en forme ; l'italique est noté *ainsi*. */
  citation: string;
  fields: CitationFields;
  /** Champs recommandés par la norme mais absents. */
  missing: string[];
}
