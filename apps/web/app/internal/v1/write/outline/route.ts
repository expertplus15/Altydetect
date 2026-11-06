import { countWords, outlineInputSchema } from "@altydetect/core";
import { runOutline } from "@altydetect/write";
import { getStreamFactory } from "@/lib/llm/stream";
import { handleWriteTool } from "@/lib/write/handle";

export const dynamic = "force-dynamic";

// POST /internal/v1/write/outline : plan à partir d'un sujet et d'un niveau.
export async function POST(request: Request): Promise<Response> {
  const parsed = outlineInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  return handleWriteTool({
    tool: "outline",
    titleSource: parsed.data.subject,
    wordCount: countWords(parsed.data.subject),
    run: () => runOutline(parsed.data, getStreamFactory(), request.signal),
  });
}
