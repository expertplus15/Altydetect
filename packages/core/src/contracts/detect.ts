import { z } from "zod";

// Contrat POST /internal/v1/detect (CLAUDE.md §5) et API interne de Veritas.
// Source unique : ces schémas zod, exportés en JSON Schema (packages/core/schemas/veritas.json),
// d'où sont générés les modèles Pydantic de Veritas. Un changement de contrat = une version.

/** Nombre minimal de mots pour obtenir un score : en dessous, erreur TEXT_TOO_SHORT. */
export const DETECT_MIN_WORDS = 150;

export const DETECT_LANGUAGES = ["auto", "fr", "en"] as const;
export const DETECT_MODES = ["standard", "deep"] as const;
export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export const VERDICT_BANDS = ["likely_ai", "undetermined", "likely_human"] as const;
export const HUMANIZATION_LEVELS = ["none", "weak", "strong"] as const;
export const DETECT_PLANS = ["free", "pro"] as const;

export const verdictBandSchema = z.enum(VERDICT_BANDS);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export type ConfidenceLevel = z.infer<typeof confidenceSchema>;
export type VerdictBand = z.infer<typeof verdictBandSchema>;

export const detectInputSchema = z.object({
  text: z.string().trim().min(1).max(60000),
  language: z.enum(DETECT_LANGUAGES).default("auto"),
  mode: z.enum(DETECT_MODES).default("standard"),
  /** Conserver une copie du texte dans l'historique (CLAUDE.md §4.5). */
  keep_text: z.boolean().default(false),
});
export type DetectInput = z.input<typeof detectInputSchema>;

/** Requête envoyée par l'application web à Veritas : le contrat, plus l'offre (aiguillage). */
export const veritasDetectRequestSchema = detectInputSchema.omit({ keep_text: true }).extend({
  plan: z.enum(DETECT_PLANS).default("free"),
});
export type VeritasDetectRequest = z.input<typeof veritasDetectRequestSchema>;

/** Répartition du texte entre les trois états ; la somme vaut 1. */
export const overallSchema = z.object({
  ai: z.number().min(0).max(1),
  undetermined: z.number().min(0).max(1),
  human: z.number().min(0).max(1),
});

export const sentenceScoreSchema = z.object({
  /** Positions dans le texte analysé (caractères, fin exclue). */
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  /** Probabilité que la phrase soit générée par une IA, de 0 à 1. */
  score: z.number().min(0).max(1),
  band: verdictBandSchema,
});
export type SentenceScore = z.infer<typeof sentenceScoreSchema>;

export const detectSignalsSchema = z.object({
  probable_model: z.string().optional(),
  /** Indice de reformulation d'un texte généré (VRT-HUM, phase 4) ; « none » avant. */
  humanization: z.enum(HUMANIZATION_LEVELS).default("none"),
});

export const detectEngineSchema = z.object({
  /** Référence de celui qui a répondu : « VRT-DET-FR-0.1 », « pangram »… */
  primary: z.string(),
  secondary: z.string().optional(),
  /** Accord entre les deux avis, de 0 à 1, quand les deux ont tourné. */
  agreement: z.number().min(0).max(1).optional(),
});

export const detectOutputSchema = z.object({
  overall: overallSchema,
  confidence: confidenceSchema,
  verdict_band: verdictBandSchema,
  /** Langue détectée (ou demandée) du texte analysé. */
  language: z.string(),
  sentences: z.array(sentenceScoreSchema),
  signals: detectSignalsSchema,
  engine: detectEngineSchema,
  word_count: z.number().int().min(0),
});
export type DetectOutput = z.infer<typeof detectOutputSchema>;

export const DETECT_ERRORS = [
  "TEXT_TOO_SHORT",
  "UNSUPPORTED_LANGUAGE",
  "DETECTION_UNAVAILABLE",
] as const;
export type DetectErrorCode = (typeof DETECT_ERRORS)[number];

export const detectErrorSchema = z.object({
  error: z.enum(DETECT_ERRORS),
  min_words: z.number().int().optional(),
});

/** Accord entre Veritas et le fournisseur externe, par segment (mode fantôme). */
export const segmentAgreementSchema = z.object({
  segment: z.string(),
  comparisons: z.number().int().min(0),
  concordant: z.number().int().min(0),
  /** Part des comparaisons où les deux avis tombent dans la même bande. */
  rate: z.number().min(0).max(1),
  /** Vrai quand le taux atteint le seuil d'accord et que l'échantillon est suffisant. */
  gate_passed: z.boolean(),
});

export const agreementReportSchema = z.object({
  threshold: z.number().min(0).max(1),
  min_comparisons: z.number().int().min(1),
  segments: z.array(segmentAgreementSchema),
});
export type AgreementReport = z.infer<typeof agreementReportSchema>;

/** Schémas exportés vers Veritas (nom du modèle Pydantic → schéma). */
export const VERITAS_CONTRACTS = {
  VerdictBand: verdictBandSchema,
  Confidence: confidenceSchema,
  DetectInput: detectInputSchema,
  VeritasDetectRequest: veritasDetectRequestSchema,
  Overall: overallSchema,
  SentenceScore: sentenceScoreSchema,
  DetectSignals: detectSignalsSchema,
  DetectEngine: detectEngineSchema,
  DetectOutput: detectOutputSchema,
  DetectError: detectErrorSchema,
  SegmentAgreement: segmentAgreementSchema,
  AgreementReport: agreementReportSchema,
} as const;
