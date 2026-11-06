import "server-only";
import { Queue } from "bullmq";

// File des rapports PDF. Les jobs (texte d'origine compris) sont supprimés de Redis dès qu'ils
// sont traités : le texte ne transite que le temps de la génération (CLAUDE.md §4.5).

export const REPORTS_QUEUE = "reports";

export interface RewriteReportJob {
  userId: string;
  /** rewrite : rapport de réécriture ; analysis : rapport combiné (plagiat, puis détection). */
  kind?: "rewrite" | "analysis";
  analysisId: string;
  variantIndex: number;
  /** Texte d'origine fourni par le navigateur pour ce rapport ; jamais stocké en base. */
  original: string | null;
  locale: "fr" | "en";
}

export interface RewriteReportResult {
  /** Clé Redis du PDF généré (valable 15 minutes). */
  pdfKey: string;
}

export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}

let queue: Queue<RewriteReportJob, RewriteReportResult> | null = null;

export function reportsQueue(): Queue<RewriteReportJob, RewriteReportResult> {
  queue ??= new Queue<RewriteReportJob, RewriteReportResult>(REPORTS_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "fixed", delay: 2000 },
      // Résultat conservé 15 minutes (statut), données du job effacées à la fin.
      removeOnComplete: { age: 15 * 60 },
      removeOnFail: { age: 15 * 60 },
    },
  });
  return queue;
}

export const pdfRedisKey = (jobId: string) => `report:pdf:${jobId}`;
