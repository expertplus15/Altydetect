import type { RegisterPrompts } from "./types";

export const simple: RegisterPrompts = {
  fr: {
    name: "simple",
    instructions: [
      "Rends le texte facile à lire pour un large public en français : phrases courtes, mots courants.",
      "Découpe les phrases longues ; explique ou remplace les termes techniques quand c'est possible sans perte de sens.",
      "Garde un ton naturel, sans infantiliser le lecteur.",
    ].join("\n"),
  },
  en: {
    name: "plain",
    instructions: [
      "Make the text easy to read for a wide audience in English: short sentences, everyday words.",
      "Split long sentences; explain or replace technical terms where possible without losing meaning.",
      "Keep a natural tone without talking down to the reader.",
    ].join("\n"),
  },
};
