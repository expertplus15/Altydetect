export type PromptLanguage = "fr" | "en";

export interface RegisterPrompt {
  /** Nom du registre dans la langue du texte. */
  name: string;
  /** Consignes propres au registre. */
  instructions: string;
}

export type RegisterPrompts = Readonly<Record<PromptLanguage, RegisterPrompt>>;
