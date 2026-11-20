import { withApiKey } from "@/lib/api/gateway";
import { submitPlagiarism } from "@/lib/plagiarism/run";

export const dynamic = "force-dynamic";

/** POST /api/v1/plagiarism : passerelle de POST /internal/v1/plagiarism (ADR-0019). */
export async function POST(request: Request): Promise<Response> {
  return withApiKey(request, async (userId) =>
    submitPlagiarism(userId, await request.json().catch(() => null)),
  );
}
