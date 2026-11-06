import type { RewriteVariant } from "@altydetect/core";
import { restorePartial, restoreSpans } from "./protect";

export interface ParsedVariant extends RewriteVariant {
  complete: boolean;
}

const TEXT = /<texte>([\s\S]*?)(?:<\/texte>|$)/;
const CHANGES = /<changements>([\s\S]*?)(?:<\/changements>|$)/;

/**
 * Lit les propositions dans la sortie du modèle, terminée ou en cours de flux.
 * Les marqueurs protégés sont restaurés ; une balise coupée en fin de flux est ignorée.
 */
export function parseVariants(output: string, spans: readonly string[]): ParsedVariant[] {
  const blocks = output.split("<proposition>").slice(1);
  return blocks.map((block) => {
    const complete = block.includes("</proposition>");
    const clean = (value: string | undefined) =>
      restorePartial((value ?? "").replace(/<\/?[a-z]*$/i, ""), spans).trim();
    return {
      text: clean(TEXT.exec(block)?.[1]),
      changes_summary: clean(CHANGES.exec(block)?.[1]),
      complete,
    };
  });
}

export interface FinalVariants {
  variants: RewriteVariant[];
  /** Vrai si une proposition a perdu un passage protégé (elle est alors écartée). */
  droppedForMissingSpans: number;
}

/** Résultat final : propositions complètes, avec tous les passages protégés présents. */
export function finalizeVariants(output: string, spans: readonly string[]): FinalVariants {
  const blocks = output.split("<proposition>").slice(1);
  const variants: RewriteVariant[] = [];
  let dropped = 0;
  for (const block of blocks) {
    const text = TEXT.exec(block)?.[1]?.trim();
    if (!text || !block.includes("</texte>")) continue;
    const restored = restoreSpans(text, spans);
    if (restored.missing.length > 0) {
      dropped += 1;
      continue;
    }
    variants.push({
      text: restored.text,
      changes_summary: restoreSpans(CHANGES.exec(block)?.[1]?.trim() ?? "", spans).text,
    });
  }
  return { variants, droppedForMissingSpans: dropped };
}
