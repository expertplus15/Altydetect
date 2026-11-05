import type { RegisterPrompts } from "./types";

export const faithful: RegisterPrompts = {
  fr: {
    name: "fidèle",
    instructions: [
      "Conserve le style, le ton et la structure de l'auteur en français.",
      "Corrige l'orthographe, la grammaire, la ponctuation et la typographie française (espaces insécables, guillemets « »).",
      "Ne reformule une phrase que si elle est incorrecte ou ambiguë.",
    ].join("\n"),
  },
  en: {
    name: "faithful",
    instructions: [
      "Keep the author's style, tone and structure in English.",
      "Fix spelling, grammar and punctuation.",
      "Only rephrase a sentence if it is incorrect or ambiguous.",
    ].join("\n"),
  },
};
