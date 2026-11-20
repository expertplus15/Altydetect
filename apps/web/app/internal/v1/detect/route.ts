import { auth } from "@/auth";
import { runDetection } from "@/lib/detect/run";

export const dynamic = "force-dynamic";

/** POST /internal/v1/detect : détection pour le compte de la session (lib/detect/run.ts). */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  return runDetection(session.user.id, await request.json().catch(() => null));
}
