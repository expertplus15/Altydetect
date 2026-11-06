import type { RewriteRegister } from "@altydetect/core";
import { academic } from "./academic";
import { faithful } from "./faithful";
import { professional } from "./professional";
import { simple } from "./simple";
import type { PromptLanguage, RegisterPrompts } from "./types";

export type { PromptLanguage, RegisterPrompt, RegisterPrompts } from "./types";

export const REGISTER_PROMPTS: Readonly<Record<RewriteRegister, RegisterPrompts>> = {
  academic,
  professional,
  simple,
  faithful,
};

const INTENSITY: Readonly<Record<PromptLanguage, Record<1 | 2 | 3, string>>> = {
  fr: {
    1: "Intensité légère : garde la structure des phrases, change seulement les mots et tournures qui le demandent.",
    2: "Intensité moyenne : reformule les phrases qui le méritent, réorganise si cela gagne en clarté.",
    3: "Intensité forte : réécris librement chaque phrase, en gardant exactement le même sens et les mêmes informations.",
  },
  en: {
    1: "Light intensity: keep the sentence structure, change only the words and phrases that need it.",
    2: "Medium intensity: rephrase sentences that need it, reorder where it improves clarity.",
    3: "Strong intensity: freely rewrite every sentence while keeping exactly the same meaning and information.",
  },
};

export function intensityInstruction(language: PromptLanguage, intensity: 1 | 2 | 3): string {
  return INTENSITY[language][intensity];
}

/** Partie fixe du prompt système (placée en premier pour le cache de prompt). */
export function systemPrompt(language: PromptLanguage): string {
  if (language === "fr") {
    return [
      "Tu es l'outil Réécrire d'AltyDetect. Tu améliores le style, le registre et la clarté d'un texte écrit en français, sans en changer le sens.",
      "Règles :",
      "- Écris dans la langue du texte d'origine (français).",
      "- N'ajoute aucune information, aucun exemple, aucune source ; n'en retire aucune.",
      "- Les marqueurs de la forme ⟦1⟧, ⟦2⟧… remplacent des passages protégés (citations, références, chiffres, URL). Recopie chaque marqueur exactement, une seule fois, à la place qui convient dans ta phrase. N'invente aucun marqueur.",
      "- Garde les paragraphes : sépare-les par une ligne vide.",
      "- Réponds uniquement avec le format demandé, sans introduction ni commentaire.",
    ].join("\n");
  }
  return [
    "You are AltyDetect's Rewrite tool. You improve the style, register and clarity of a text written in English without changing its meaning.",
    "Rules:",
    "- Write in the language of the original text (English).",
    "- Add no information, example or source; remove none.",
    "- Markers like ⟦1⟧, ⟦2⟧… stand for protected passages (quotations, references, figures, URLs). Copy each marker exactly, once, where it fits in your sentence. Never invent a marker.",
    "- Keep the paragraphs: separate them with a blank line.",
    "- Reply only in the requested format, with no introduction or comment.",
  ].join("\n");
}

/** Format de sortie : une balise par proposition, lisible au fil du flux. */
export function outputFormat(language: PromptLanguage, variants: number): string {
  const example = "<proposition>\n<texte>…</texte>\n<changements>…</changements>\n</proposition>";
  if (language === "fr") {
    return [
      `Rédige ${variants} proposition${variants > 1 ? "s" : ""}${variants > 1 ? " nettement différentes les unes des autres" : ""}.`,
      "Pour chacune, utilise exactement ce format :",
      example,
      "Dans <changements>, résume en une phrase courte ce que tu as modifié.",
    ].join("\n");
  }
  return [
    `Write ${variants} suggestion${variants > 1 ? "s, clearly different from one another" : ""}.`,
    "For each one, use exactly this format:",
    example,
    "In <changements>, summarise in one short sentence what you changed.",
  ].join("\n");
}
