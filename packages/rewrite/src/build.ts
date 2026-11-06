import { detectLanguage, type RewriteInput } from "@altydetect/core";
import { intensityInstruction, outputFormat, REGISTER_PROMPTS, systemPrompt } from "./prompts";
import { protectSpans } from "./protect";

export interface RewriteRequest {
  language: "fr" | "en";
  system: string;
  /** Message utilisateur : consignes variables puis texte (masqué si preserve_citations). */
  user: string;
  /** Passages protégés, dans l'ordre des marqueurs ⟦1⟧, ⟦2⟧… */
  spans: string[];
}

/** Construit la requête au modèle. Fonction pure : testée sans appel réseau. */
export function buildRewriteRequest(input: RewriteInput): RewriteRequest {
  const language = detectLanguage(input.text);
  const register = REGISTER_PROMPTS[input.register][language];
  const { masked, spans } = input.preserve_citations
    ? protectSpans(input.text)
    : { masked: input.text, spans: [] };

  const heading = language === "fr" ? "Registre" : "Register";
  const user = [
    `${heading} : ${register.name}`,
    register.instructions,
    intensityInstruction(language, input.intensity),
    outputFormat(language, input.variants),
    "",
    "<texte_original>",
    masked,
    "</texte_original>",
  ].join("\n");

  return { language, system: systemPrompt(language), user, spans };
}
