import "server-only";
import type { PlagiarismOutput } from "@altydetect/core";
import { releaseDetectionWords } from "@/lib/billing/quota-release";
import { db } from "@/lib/db";
import { getRedis } from "@/lib/server/redis";

// Suivi côté application des analyses confiées à Indexa : à qui appartient la tâche, et
// enregistrement du résultat (une seule fois) ou remboursement des mots (une seule fois).

const TTL_SECONDS = 2 * 60 * 60;

export interface TaskOwner {
  userId: string;
  title: string;
  wordCount: number;
  scope: "web" | "private" | "both";
}

const ownerKey = (taskId: string) => `plagiarism:task:${taskId}`;
const settledKey = (taskId: string) => `plagiarism:settled:${taskId}`;

export async function rememberTask(taskId: string, owner: TaskOwner): Promise<void> {
  await getRedis().set(ownerKey(taskId), JSON.stringify(owner), "EX", TTL_SECONDS);
}

export async function taskOwner(taskId: string): Promise<TaskOwner | null> {
  const raw = await getRedis().get(ownerKey(taskId));
  return raw ? (JSON.parse(raw) as TaskOwner) : null;
}

/** Réserve le traitement final d'une tâche : vrai la première fois seulement. */
async function settleOnce(taskId: string, value: string): Promise<boolean> {
  return (await getRedis().set(settledKey(taskId), value, "EX", TTL_SECONDS, "NX")) === "OK";
}

export async function settledAnalysisId(taskId: string): Promise<string | null> {
  const value = await getRedis().get(settledKey(taskId));
  return value?.startsWith("analysis:") ? value.slice("analysis:".length) : null;
}

/** Enregistre le résultat dans l'historique (sans le texte analysé) ; renvoie l'analyse. */
export async function saveResult(
  taskId: string,
  owner: TaskOwner,
  result: PlagiarismOutput,
): Promise<string | null> {
  if (!(await settleOnce(taskId, "pending"))) return settledAnalysisId(taskId);
  const document = await db.document.create({
    data: {
      userId: owner.userId,
      title: owner.title,
      wordCount: owner.wordCount,
      analyses: {
        create: {
          type: "plagiarism",
          engine: result.engine,
          resultJson: { scope: owner.scope, output: result },
        },
      },
    },
    include: { analyses: { select: { id: true } } },
  });
  const analysisId = document.analyses[0]?.id ?? null;
  await getRedis().set(settledKey(taskId), `analysis:${analysisId}`, "EX", TTL_SECONDS);
  return analysisId;
}

/** Rend les mots consommés quand l'analyse a échoué. */
export async function refundFailedTask(taskId: string, owner: TaskOwner): Promise<void> {
  if (await settleOnce(taskId, "refunded")) {
    await releaseDetectionWords(owner.userId, owner.wordCount);
  }
}
