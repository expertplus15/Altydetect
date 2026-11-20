import { withApiKey } from "@/lib/api/gateway";
import { plagiarismTask } from "@/lib/plagiarism/run";

export const dynamic = "force-dynamic";

/** GET /api/v1/plagiarism/{taskId} : passerelle de GET /internal/v1/plagiarism/{taskId}. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { taskId } = await params;
  return withApiKey(request, (userId) => plagiarismTask(userId, taskId));
}
