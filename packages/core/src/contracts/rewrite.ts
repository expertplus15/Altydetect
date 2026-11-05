import { z } from "zod";

// Contrat POST /internal/v1/rewrite (CLAUDE.md §5). Un changement = une nouvelle version (v2).

export const REWRITE_REGISTERS = ["academic", "professional", "simple", "faithful"] as const;
export type RewriteRegister = (typeof REWRITE_REGISTERS)[number];

export const rewriteInputSchema = z.object({
  text: z.string().trim().min(1).max(60000),
  register: z.enum(REWRITE_REGISTERS),
  intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  preserve_citations: z.boolean().default(true),
  variants: z.number().int().min(1).max(3).default(1),
});
export type RewriteInput = z.infer<typeof rewriteInputSchema>;

export const rewriteVariantSchema = z.object({
  text: z.string(),
  changes_summary: z.string(),
});

export const rewriteOutputSchema = z.object({
  variants: z.array(rewriteVariantSchema).min(1).max(3),
});
export type RewriteOutput = z.infer<typeof rewriteOutputSchema>;
export type RewriteVariant = z.infer<typeof rewriteVariantSchema>;
