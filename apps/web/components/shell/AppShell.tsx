import type { ReactNode } from "react";
import { AppHeader, type HeaderData } from "./AppHeader";
import { Sidebar, type RecentDocument } from "./Sidebar";

// Coquille à trois zones (CLAUDE.md §8) : en-tête, barre latérale, contenu (éditeur + panneau).
export function AppShell({
  header,
  recents,
  children,
}: {
  header: HeaderData;
  recents: RecentDocument[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <AppHeader data={header} />
      <div className="flex flex-1">
        <Sidebar recents={recents} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
