import "server-only";
import { countWords, LLM_MAX_INPUT_WORDS, plagiarismInputSchema } from "@altydetect/core";
import { IndexaError } from "@altydetect/plagiarism";
import { consumeDetectionQuota } from "@/lib/billing/quota";
import { releaseDetectionWords } from "@/lib/billing/quota-release";
import { getUserPlan } from "@/lib/billing/subscription";
import { getIndexa } from "@/lib/plagiarism/indexa";
import { refundFailedTask, rememberTask, saveResult, taskOwner } from "@/lib/plagiarism/tasks";
import { documentTitle } from "@/lib/server/document-title";

/**
 * Analyse de plagiat pour un compte (POST /internal/v1/plagiarism et sa passerelle
 * POST /api/v1/plagiarism, ADR-0019) : validation, offre, quota (mots de détection), tâche
 * confiée à Indexa. Réponse immédiate avec l'identifiant de tâche (CLAUDE.md §4.9).
 */
export async function submitPlagiarism(userId: string, input: unknown): Promise<Response> {
  const parsed = plagiarismInputSchema.omit({ workspace_id: true }).safeParse(input);
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

/**
 * État d'une tâche de plagiat du compte (GET /internal/v1/plagiarism/{taskId} et sa
 * passerelle) ; à la fin, résultat enregistré dans l'historique (une fois) ou mots rendus en cas
 * d'échec (une fois).
 */
export async function plagiarismTask(userId: string, taskId: string): Promise<Response> {
  const owner = await taskOwner(taskId);
  if (!owner || owner.userId !== userId)
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
