// Prompts du module Écrire, en français et en anglais selon la langue du texte ou du sujet.

export type Lang = "fr" | "en";

const LEVELS: Record<Lang, Record<string, string>> = {
  fr: {
    secondary: "lycée",
    bachelor: "licence (premier cycle universitaire)",
    master: "master",
    professional: "écrit professionnel",
  },
  en: {
    secondary: "secondary school",
    bachelor: "undergraduate degree",
    master: "master's degree",
    professional: "professional writing",
  },
};

export function outlinePrompt(lang: Lang, subject: string, level: string) {
  if (lang === "fr") {
    return {
      system:
        "Tu es l'outil Écrire d'AltyDetect. Tu proposes des plans de travail clairs en français. Tu ne rédiges pas le texte : seulement un titre et des parties avec quelques points à développer.",
      user: [
        `Propose un plan pour un travail de niveau ${LEVELS.fr[level] ?? level}.`,
        "Donne un titre, puis 3 à 6 parties (introduction et conclusion comprises), chacune avec 2 à 4 points courts.",
        "Le plan suit une progression logique ; il n'invente ni chiffres ni sources.",
        "",
        `<sujet>${subject}</sujet>`,
      ].join("\n"),
    };
  }
  return {
    system:
      "You are AltyDetect's Write tool. You propose clear outlines in English. You don't write the text: only a title and sections with a few points to develop.",
    user: [
      `Propose an outline for a piece of work at ${LEVELS.en[level] ?? level} level.`,
      "Give a title, then 3 to 6 sections (introduction and conclusion included), each with 2 to 4 short points.",
      "The outline follows a logical progression; it invents no figures or sources.",
      "",
      `<sujet>${subject}</sujet>`,
    ].join("\n"),
  };
}

export function correctPrompt(lang: Lang, text: string) {
  if (lang === "fr") {
    return {
      system:
        "Tu es l'outil Corriger d'AltyDetect. Tu relèves les fautes d'orthographe, de grammaire, de ponctuation et de typographie française dans un texte, sans toucher au style.",
      user: [
        "Relève chaque faute du texte ci-dessous.",
        "- original : le passage fautif, recopié exactement (le plus court possible) ;",
        "- replacement : le passage corrigé ;",
        "- kind : spelling, grammar, punctuation ou typography ;",
        "- explanation : la règle en une phrase courte, en français ;",
        "- context : cinq à huit mots du texte autour de la faute, recopiés exactement.",
        "Ne propose pas de reformulation de style. S'il n'y a aucune faute, renvoie une liste vide.",
        "",
        "<texte>",
        text,
        "</texte>",
      ].join("\n"),
    };
  }
  return {
    system:
      "You are AltyDetect's Proofread tool. You find spelling, grammar, punctuation and typography mistakes in a text without touching the style.",
    user: [
      "List each mistake in the text below.",
      "- original: the faulty passage, copied exactly (as short as possible);",
      "- replacement: the corrected passage;",
      "- kind: spelling, grammar, punctuation or typography;",
      "- explanation: the rule in one short sentence, in English;",
      "- context: five to eight words of the text around the mistake, copied exactly.",
      "Don't suggest style rewording. If there are no mistakes, return an empty list.",
      "",
      "<texte>",
      text,
      "</texte>",
    ].join("\n"),
  };
}

const LENGTHS: Record<Lang, Record<"short" | "medium" | "long", string>> = {
  fr: {
    short: "en deux ou trois phrases",
    medium: "en un paragraphe d'environ 120 mots",
    long: "en trois à cinq paragraphes qui reprennent chaque partie du texte",
  },
  en: {
    short: "in two or three sentences",
    medium: "in one paragraph of about 120 words",
    long: "in three to five paragraphs covering each part of the text",
  },
};

export function summarizePrompt(lang: Lang, text: string, length: "short" | "medium" | "long") {
  if (lang === "fr") {
    return {
      system:
        "Tu es l'outil Résumer d'AltyDetect. Tu résumes fidèlement un texte en français, sans ajouter d'information ni d'opinion.",
      user: [
        `Résume ce texte ${LENGTHS.fr[length]}. Réponds uniquement avec le résumé.`,
        "",
        "<texte>",
        text,
        "</texte>",
      ].join("\n"),
    };
  }
  return {
    system:
      "You are AltyDetect's Summarize tool. You summarise a text faithfully in English, adding no information or opinion.",
    user: [
      `Summarise this text ${LENGTHS.en[length]}. Reply with the summary only.`,
      "",
      "<texte>",
      text,
      "</texte>",
    ].join("\n"),
  };
}
