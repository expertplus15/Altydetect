import { countWords, LLM_MAX_INPUT_WORDS, summarizeInputSchema } from "@altydetect/core";
import { runSummarize } from "@altydetect/write";
import { getStreamFactory } from "@/lib/llm/stream";
import { handleWriteTool } from "@/lib/write/handle";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /internal/v1/write/summarize : résumé court, moyen ou long.
export async function POST(request: Request): Promise<Response> {
  const parsed = summarizeInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const words = countWords(parsed.data.text);
  if (words > LLM_MAX_INPUT_WORDS) {
    return Response.json(
      { error: "TEXT_TOO_LONG", maxWords: LLM_MAX_INPUT_WORDS },
      { status: 413 },
    );
  }
  return handleWriteTool({
    tool: "summarize",
    titleSource: parsed.data.text,
    wordCount: words,
    run: () => runSummarize(parsed.data, getStreamFactory(), request.signal),
  });
}
