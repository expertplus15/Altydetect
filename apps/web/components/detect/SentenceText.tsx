import type { SentenceScore, VerdictBand } from "@altydetect/core";

// Classes des trois états : ils diffèrent par la luminosité, pas seulement par la teinte
// (orange foncé / gris / bleu clair, CLAUDE.md §8).
export const BAND_STYLES: Record<VerdictBand, { mark: string; text: string; bar: string }> = {
  likely_ai: { mark: "bg-state-ai/20", text: "text-state-ai", bar: "bg-state-ai" },
  undetermined: {
    mark: "bg-state-undetermined/10",
    text: "text-state-undetermined",
    bar: "bg-state-undetermined/60",
  },
  likely_human: {
    mark: "bg-state-human/[0.07]",
    text: "text-state-human",
    bar: "bg-state-human/30",
  },
};

/** Texte analysé, chaque phrase surlignée selon sa bande. */
export function SentenceText({
  text,
  sentences,
  describe,
  bandName,
}: {
  text: string;
  sentences: SentenceScore[];
  /** Description d'une phrase (infobulle) : état et probabilité. */
  describe: (sentence: SentenceScore) => string;
  /** Nom de l'état, lu après la phrase par les lecteurs d'écran. */
  bandName: (band: VerdictBand) => string;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, sentence] of [...sentences].sort((a, b) => a.start - b.start).entries()) {
    if (sentence.end <= cursor || sentence.start >= text.length) continue;
    const start = Math.max(sentence.start, cursor);
    if (start > cursor) parts.push(text.slice(cursor, start));
    const end = Math.min(sentence.end, text.length);
    const label = describe(sentence);
    parts.push(
      <mark
        key={`${index}-${start}`}
        title={label}
        data-band={sentence.band}
        className={`rounded px-0.5 text-inherit ${BAND_STYLES[sentence.band].mark}`}
      >
        {text.slice(start, end)}
        <span className="sr-only"> ({bandName(sentence.band)})</span>
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return (
    <div className="whitespace-pre-wrap text-[15.5px] leading-[1.75] text-gray-900">{parts}</div>
  );
}
