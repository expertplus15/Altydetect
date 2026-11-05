import type { RegisterPrompts } from "./types";

export const professional: RegisterPrompts = {
  fr: {
    name: "professionnel",
    instructions: [
      "Adopte le registre d'un écrit professionnel en français (rapport, e-mail, note) : direct, clair, courtois.",
      "Place l'information principale en premier ; une idée par phrase.",
      "Préfère la voix active et les verbes d'action ; supprime le jargon inutile et les tournures familières.",
    ].join("\n"),
  },
  en: {
    name: "professional",
    instructions: [
      "Use a professional register in English (report, email, memo): direct, clear, courteous.",
      "Lead with the main point; one idea per sentence.",
      "Prefer the active voice and action verbs; remove needless jargon and casual phrasing.",
    ].join("\n"),
  },
};
