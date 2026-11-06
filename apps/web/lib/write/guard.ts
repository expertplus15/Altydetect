import "server-only";
import { auth } from "@/auth";
import { consumeRewriteQuota } from "@/lib/billing/quota";

export type Guard = { ok: true; userId: string } | { ok: false; response: Response };

/**
 * Accès aux outils d'écriture assistée : compte obligatoire ; les outils qui appellent le modèle
 * partagent le compteur quotidien de réécriture (vérifié et consommé avant l'appel).
 */
export async function guardWriteTool({
  consumesQuota,
}: {
  consumesQuota: boolean;
}): Promise<Guard> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, response: Response.json({ error: "UNAUTHENTICATED" }, { status: 401 }) };
  }
  if (consumesQuota) {
    const quota = await consumeRewriteQuota(session.user.id);
    if (!quota.allowed) {
      return {
        ok: false,
        response: Response.json(
          {
            error: "QUOTA_EXCEEDED",
            resetsAt: quota.resetsAt.toISOString(),
            limit: quota.limitHidden ? null : quota.limit,
          },
          { status: 429 },
        ),
      };
    }
  }
  return { ok: true, userId: session.user.id };
}
