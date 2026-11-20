import { auth } from "@/auth";
import { plagiarismTask } from "@/lib/plagiarism/run";

export const dynamic = "force-dynamic";

// GET /internal/v1/plagiarism/{taskId} : état de l'analyse du compte de la session.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  return plagiarismTask(session.user.id, (await params).taskId);
}
