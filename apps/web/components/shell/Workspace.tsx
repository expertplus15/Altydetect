import type { ReactNode } from "react";

// Zone centrale + panneau de résultat (340–380 px). Sous 768 px, le panneau passe sous l'éditeur.
export function Workspace({
  main,
  panel,
  panelLabel,
}: {
  main: ReactNode;
  panel?: ReactNode;
  panelLabel?: string;
}) {
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <div className="min-w-0 flex-1 p-4 md:p-6">{main}</div>
      {panel && (
        <aside
          aria-label={panelLabel}
          className="border-t border-gray-200 p-4 md:w-[340px] md:shrink-0 md:border-l md:border-t-0 md:p-5 xl:w-[380px]"
        >
          {panel}
        </aside>
      )}
    </div>
  );
}
