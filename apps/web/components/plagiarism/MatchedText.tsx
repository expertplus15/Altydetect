import type { PlagiarismMatch } from "@altydetect/core";

// Texte analysé, passages retrouvés surlignés (les chevauchements sont fusionnés pour l'affichage).
export function MatchedText({
  text,
  matches,
  activeIndex,
}: {
  text: string;
  matches: PlagiarismMatch[];
  activeIndex: number | null;
}) {
  const ranges = matches
    .map((m, index) => ({ start: m.start, end: m.end, index }))
    .sort((a, b) => a.start - b.start);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.end <= cursor) continue;
    const start = Math.max(range.start, cursor);
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={`${range.index}-${start}`}
        id={`match-${range.index}`}
        className={`rounded px-0.5 text-inherit ${activeIndex === range.index ? "bg-state-ai/30 ring-2 ring-state-ai" : "bg-state-ai/15"}`}
      >
        {text.slice(start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return (
    <div className="whitespace-pre-wrap text-[15.5px] leading-[1.75] text-gray-900">{parts}</div>
  );
}
