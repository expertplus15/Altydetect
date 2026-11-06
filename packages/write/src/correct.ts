import type { Correction, CorrectionDraft } from "@altydetect/core";

/**
 * Place les corrections dans le texte. Le modèle ne donne pas de positions (peu fiables) :
 * chaque correction est cherchée par son passage d'origine, au plus près de son contexte, sans
 * chevaucher une correction déjà placée. Une correction introuvable ou sans effet est écartée.
 */
export function locateCorrections(text: string, drafts: readonly CorrectionDraft[]): Correction[] {
  const placed: Correction[] = [];
  const overlaps = (start: number, end: number) =>
    placed.some((c) => start < c.end && end > c.start);
  const isLetter = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);
  // Occurrence en mot entier : pas de lettre collée avant ni après (« a » hors de « souhaiterais »).
  const wholeWord = (start: number, length: number) =>
    !isLetter(text[start - 1]) && !isLetter(text[start + length]);

  for (const draft of drafts) {
    const { original } = draft;
    if (!original || original === draft.replacement) continue;

    const candidates: number[] = [];
    // 1. Position exacte dans le contexte fourni par le modèle.
    const contextAt = draft.context ? text.indexOf(draft.context) : -1;
    const inContext = contextAt >= 0 ? draft.context.indexOf(original) : -1;
    if (inContext >= 0) candidates.push(contextAt + inContext);
    // 2. Sinon, toutes les occurrences, mots entiers d'abord, les plus proches du contexte d'abord.
    const all: number[] = [];
    for (let i = text.indexOf(original); i >= 0; i = text.indexOf(original, i + 1)) all.push(i);
    const near = (i: number) => (contextAt >= 0 ? Math.abs(i - contextAt) : i);
    all.sort(
      (a, b) =>
        Number(wholeWord(b, original.length)) - Number(wholeWord(a, original.length)) ||
        near(a) - near(b),
    );
    candidates.push(...all);

    const start = candidates.find((i) => !overlaps(i, i + original.length));
    if (start === undefined) continue;
    placed.push({
      start,
      end: start + original.length,
      original,
      replacement: draft.replacement,
      kind: draft.kind,
      explanation: draft.explanation,
    });
  }
  return placed.sort((a, b) => a.start - b.start);
}

/** Applique des corrections (positions dans le texte d'origine). */
export function applyCorrections(text: string, corrections: readonly Correction[]): string {
  let result = text;
  for (const c of [...corrections].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, c.start) + c.replacement + result.slice(c.end);
  }
  return result;
}
