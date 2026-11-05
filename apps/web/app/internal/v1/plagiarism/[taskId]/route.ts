import { IndexaError } from "@altydetect/plagiarism";
import { auth } from "@/auth";
import { getIndexa } from "@/lib/plagiarism/indexa";
import { refundFailedTask, saveResult, taskOwner } from "@/lib/plagiarism/tasks";

export const dynamic = "force-dynamic";

// GET /internal/v1/plagiarism/{taskId} : état de l'analyse ; à la fin, résultat enregistré dans
// l'historique (une fois) ou mots rendus en cas d'échec (une fois).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const { taskId } = await params;
  const owner = await taskOwner(taskId);
  if (!owner || owner.userId !== session.user.id)
    return Response.json({ error: "NOT_FOUND" }, { status: 404 });

  try {
    const task = await getIndexa().task(taskId);
    if (task.status === "done" && task.result) {
      const analysisId = await saveResult(taskId, owner, task.result);
      return Response.json({ ...task, analysisId });
    }
    if (task.status === "failed") await refundFailedTask(taskId, owner);
    return Response.json(task);
  } catch (error) {
    if (error instanceof IndexaError && error.status === 404) {
      await refundFailedTask(taskId, owner);
      return Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ error: "INDEXA_UNAVAILABLE" }, { status: 502 });
  }
}
