import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { requireUser } from "@/lib/server/session";
import { getWorkspaceData } from "@/lib/server/workspace-data";

// Espace connecté : session vérifiée côté serveur à chaque requête.
export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const { header, recents } = await getWorkspaceData(user);
  return (
    <AppShell header={header} recents={recents}>
      {children}
    </AppShell>
  );
}
