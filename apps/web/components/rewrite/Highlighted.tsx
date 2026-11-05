import { protectSpans } from "@altydetect/rewrite/protect";

// Affiche un texte en surlignant les passages protégés (citations, références, chiffres, URL).
export function Highlighted({ text, enabled }: { text: string; enabled: boolean }) {
  if (!enabled) return <>{text}</>;
  const { masked, spans } = protectSpans(text);
  const parts = masked.split(/⟦(\d+)⟧/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark key={index} className="rounded bg-accent/10 px-0.5 text-inherit">
            {spans[Number(part) - 1]}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}
