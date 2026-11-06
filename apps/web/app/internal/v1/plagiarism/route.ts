import { countWords, LLM_MAX_INPUT_WORDS, plagiarismInputSchema } from "@altydetect/core";
import { IndexaError } from "@altydetect/plagiarism";
import { auth } from "@/auth";
import { consumeDetectionQuota } from "@/lib/billing/quota";
import { releaseDetectionWords } from "@/lib/billing/quota-release";
import { getUserPlan } from "@/lib/billing/subscription";
import { getIndexa } from "@/lib/plagiarism/indexa";
import { rememberTask } from "@/lib/plagiarism/tasks";
import { documentTitle } from "@/lib/server/document-title";

export const dynamic = "force-dynamic";

/**
 * POST /internal/v1/plagiarism : contrôle d'accès et de quota (mots de détection), puis analyse
 * confiée à Indexa. Réponse immédiate avec l'identifiant de tâche (CLAUDE.md §4.9).
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const userId = session.user.id;

  const parsed = plagiarismInputSchema
    .omit({ workspace_id: true })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "INVALID_INPUT" }, { status: 400 });
  const { text, scope } = parsed.data;
  const words = countWords(text);
  if (words > LLM_MAX_INPUT_WORDS) {
    return Response.json(
      { error: "TEXT_TOO_LONG", maxWords: LLM_MAX_INPUT_WORDS },
      { status: 413 },
    );
  }
  // Base privée : réservée à Pro.
  if (scope !== "web" && (await getUserPlan(userId)).plan !== "pro") {
    return Response.json({ error: "UPGRADE_REQUIRED" }, { status: 402 });
  }

  const quota = await consumeDetectionQuota(userId, words);
  if (!quota.allowed) {
    return Response.json(
      {
        error: quota.reason,
        resetsAt: quota.resetsAt.toISOString(),
        used: quota.used,
        limit: quota.limit,
      },
      { status: quota.reason === "TEXT_TOO_SHORT" ? 422 : 429 },
    );
  }

  try {
    const task = await getIndexa().submit({
      text,
      scope,
      ...(scope !== "web" ? { workspace_id: userId } : {}),
    });
    await rememberTask(task.task_id, {
      userId,
      title: documentTitle(text),
      wordCount: words,
      scope,
    });
    return Response.json(task, { status: 202 });
  } catch (error) {
    await releaseDetectionWords(userId, words);
    const status = error instanceof IndexaError && error.status < 500 ? 422 : 502;
    return Response.json({ error: "INDEXA_UNAVAILABLE" }, { status });
  }
}
