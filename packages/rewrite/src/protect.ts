// Protection des citations (option preserve_citations) : les passages à conserver mot pour mot
// sont remplacés par des marqueurs ⟦n⟧ avant l'envoi au modèle, puis restaurés. Le modèle ne
// peut donc pas les modifier ; un marqueur perdu est détecté.

const URL = String.raw`(?:https?:\/\/|www\.)[^\s<>"«»]+[^\s<>"«».,;:!?)\]]`;
const QUOTE_FR = String.raw`«[^«»]{1,800}»`;
const QUOTE_CURLY = String.raw`“[^“”]{1,800}”`;
const QUOTE_STRAIGHT = String.raw`"[^"\n]{1,800}"`;
// Références : parenthèses ou crochets contenant un chiffre (année, page, numéro de note).
const REF_PAREN = String.raw`\([^()\n]{0,200}\d[^()\n]{0,200}\)`;
const REF_BRACKET = String.raw`\[[^\[\]\n]{1,200}\]`;
// Nombres, avec séparateurs et unité éventuelle (32 %, 1 200 €, 3,5).
const NUMBER = String.raw`\d+(?:[   ,.]\d+)*(?:[   ]?(?:%|€|\$))?`;

const PROTECTED = new RegExp(
  [URL, QUOTE_FR, QUOTE_CURLY, QUOTE_STRAIGHT, REF_PAREN, REF_BRACKET, NUMBER].join("|"),
  "gu",
);

export const MARKER = (index: number) => `⟦${index}⟧`;
const MARKER_PATTERN = /⟦(\d+)⟧/g;

export interface Protected {
  masked: string;
  spans: string[];
}

export function protectSpans(text: string): Protected {
  const spans: string[] = [];
  const masked = text.replace(PROTECTED, (match) => {
    spans.push(match);
    return MARKER(spans.length);
  });
  return { masked, spans };
}

export interface Restored {
  text: string;
  /** Numéros des passages protégés absents de la réponse du modèle. */
  missing: number[];
}

export function restoreSpans(text: string, spans: readonly string[]): Restored {
  const seen = new Set<number>();
  const restored = text.replace(MARKER_PATTERN, (marker, digits: string) => {
    const index = Number(digits);
    const span = spans[index - 1];
    if (span === undefined) return marker;
    seen.add(index);
    return span;
  });
  const missing = spans.map((_, i) => i + 1).filter((i) => !seen.has(i));
  return { text: restored, missing };
}

/** Pour l'affichage en direct : masque un marqueur coupé en fin de flux (« ⟦1 »). */
export function restorePartial(text: string, spans: readonly string[]): string {
  return restoreSpans(text.replace(/⟦\d*$/, ""), spans).text;
}
