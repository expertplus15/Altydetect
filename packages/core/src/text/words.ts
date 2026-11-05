// Comptage de mots partagé par l'éditeur, les quotas et les services.
// Un mot = une suite sans espace contenant au moins une lettre ou un chiffre.
// « l'évaluation » compte pour un mot, comme dans un traitement de texte ; « — » ou « : » seuls ne
// comptent pas.

const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  let count = 0;
  for (const token of text.split(/\s+/u)) {
    if (token && HAS_LETTER_OR_DIGIT.test(token)) count += 1;
  }
  return count;
}
