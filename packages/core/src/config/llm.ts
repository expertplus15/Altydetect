// Configuration LLM unique (CLAUDE.md §2) : le modèle n'est écrit nulle part ailleurs.

/** Modèle des modules Réécrire et Écrire : Claude Sonnet 5.5 (choix validé en phase 1). */
export const LLM_MODEL = "claude-sonnet-5-5";

/**
 * Effort de raisonnement. « low » suffit pour la reformulation et la correction, avec une
 * latence faible ; à mesurer avant de l'augmenter.
 */
export const LLM_EFFORT = "low" as const;

/** Plafond de sortie d'une réécriture (jusqu'à 3 propositions d'un texte long). */
export const LLM_MAX_TOKENS = 32000;

/**
 * Repli côté serveur sur refus de sécurité : Anthropic choisit le modèle de repli selon la
 * catégorie du refus (API Claude uniquement).
 */
export const LLM_FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

/** Longueur maximale d'un texte envoyé aux modules d'écriture, en mots. */
export const LLM_MAX_INPUT_WORDS = 6000;
