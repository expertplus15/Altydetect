import "server-only";
import { getUserPlan } from "@/lib/billing/subscription";
import { authenticateApiKey, bearerKey, isPublicApiEnabled } from "./keys";

/**
 * Passerelle de l'API publique (ADR-0019) : accès fermé sans PUBLIC_API_ENABLED (404), clé
 * valide exigée (401), comptes Pro seulement (402). Le traitement est ensuite exactement celui
 * de l'endpoint interne, appelé avec le compte de la clé.
 */
export async function withApiKey(
  request: Request,
  handler: (userId: string) => Promise<Response>,
): Promise<Response> {
  if (!isPublicApiEnabled()) return Response.json({ error: "NOT_FOUND" }, { status: 404 });
  const userId = await authenticateApiKey(bearerKey(request));
  if (!userId) {
    return Response.json(
      { error: "INVALID_API_KEY" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="altydetect"' } },
    );
  }
  if ((await getUserPlan(userId)).plan !== "pro") {
    return Response.json({ error: "UPGRADE_REQUIRED" }, { status: 402 });
  }
  return handler(userId);
}
