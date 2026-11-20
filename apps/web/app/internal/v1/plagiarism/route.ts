import { auth } from "@/auth";
import { submitPlagiarism } from "@/lib/plagiarism/run";

export const dynamic = "force-dynamic";

/** POST /internal/v1/plagiarism : analyse pour le compte de la session (lib/plagiarism/run.ts). */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  return submitPlagiarism(session.user.id, await request.json().catch(() => null));
}
