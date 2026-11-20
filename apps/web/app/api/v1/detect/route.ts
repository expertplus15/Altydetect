import { withApiKey } from "@/lib/api/gateway";
import { runDetection } from "@/lib/detect/run";

export const dynamic = "force-dynamic";

/** POST /api/v1/detect : passerelle de POST /internal/v1/detect, par clé d'API (ADR-0019). */
export async function POST(request: Request): Promise<Response> {
  return withApiKey(request, async (userId) =>
    runDetection(userId, await request.json().catch(() => null)),
  );
}
