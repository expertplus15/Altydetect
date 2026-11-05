import type { RegisterPrompts } from "./types";

export const academic: RegisterPrompts = {
  fr: {
    name: "académique",
    instructions: [
      "Adopte le registre d'un écrit universitaire en français : ton neutre et précis, vocabulaire exact, phrases complètes.",
      "Remplace les formules familières ou vagues (« vraiment », « plein de », « faire des choses ») par des termes précis.",
      "Rends explicites les liens logiques (en effet, toutefois, ainsi) sans en abuser.",
      "N'emploie pas la première personne du singulier sauf si le texte l'utilise déjà.",
    ].join("\n"),
  },
  en: {
    name: "academic",
    instructions: [
      "Use the register of academic writing in English: neutral, precise tone, exact vocabulary, complete sentences.",
      'Replace casual or vague wording ("really", "a lot of", "do things") with precise terms.',
      "Make logical links explicit (however, therefore, thus) without overusing them.",
      "Avoid the first person singular unless the text already uses it.",
    ].join("\n"),
  },
};
