import { z } from "zod";

// Contrat POST /internal/v1/plagiarism (CLAUDE.md §5) et API de tâches d'Indexa.
// Source unique : ces schémas zod, exportés en JSON Schema (packages/core/schemas/), d'où sont
// générés les modèles Pydantic d'Indexa. Un changement de contrat = une nouvelle version.

export const PLAGIARISM_SCOPES = ["web", "private", "both"] as const;

export const plagiarismInputSchema = z.object({
  text: z.string().trim().min(1).max(60000),
  scope: z.enum(PLAGIARISM_SCOPES),
  /** Espace de la base privée (en phase 2 : l'identifiant de l'utilisateur). */
  workspace_id: z.string().min(1).max(64).optional(),
});
export type PlagiarismInput = z.infer<typeof plagiarismInputSchema>;

export const plagiarismMatchSchema = z.object({
  /** Positions dans le texte analysé (caractères, fin exclue). */
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  source_url: z.string().optional(),
  source_doc_id: z.string().optional(),
  /** Passage correspondant dans la source. */
  excerpt: z.string(),
  /** Proximité du passage avec la source, de 0 à 1. */
  score: z.number().min(0).max(1),
});
export type PlagiarismMatch = z.infer<typeof plagiarismMatchSchema>;

export const plagiarismOutputSchema = z.object({
  /** Part du texte couverte par des passages retrouvés, de 0 à 1. */
  similarity: z.number().min(0).max(1),
  matches: z.array(plagiarismMatchSchema),
  /** Référence du moteur, par exemple « IDX-WEB-1.0 ». */
  engine: z.string(),
});
export type PlagiarismOutput = z.infer<typeof plagiarismOutputSchema>;

export const TASK_STATUSES = ["queued", "running", "done", "failed"] as const;

export const plagiarismTaskSchema = z.object({
  task_id: z.string(),
  status: z.enum(TASK_STATUSES),
  /** Avancement de 0 à 1 pendant l'analyse. */
  progress: z.number().min(0).max(1).default(0),
  result: plagiarismOutputSchema.optional(),
  error: z.string().optional(),
});
export type PlagiarismTask = z.infer<typeof plagiarismTaskSchema>;

export const privateSourceInputSchema = z.object({
  workspace_id: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(400000),
});
export type PrivateSourceInput = z.infer<typeof privateSourceInputSchema>;

export const privateSourceSchema = z.object({
  source_id: z.string(),
  title: z.string(),
  word_count: z.number().int().min(0),
});
export type PrivateSource = z.infer<typeof privateSourceSchema>;

/** Schémas exportés vers Indexa (nom du modèle Pydantic → schéma). */
export const INDEXA_CONTRACTS = {
  PlagiarismInput: plagiarismInputSchema,
  PlagiarismMatch: plagiarismMatchSchema,
  PlagiarismOutput: plagiarismOutputSchema,
  PlagiarismTask: plagiarismTaskSchema,
  PrivateSourceInput: privateSourceInputSchema,
  PrivateSource: privateSourceSchema,
} as const;
