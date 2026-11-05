// Worker AltyDetect : exports PDF (file « reports ») et tâches planifiées (file « maintenance »).
// Lancement : pnpm -C apps/web worker (processus séparé du serveur web).
import { Queue, Worker } from "bullmq";
import { applyRetention } from "@/lib/history/retention";
import { processRewriteReport } from "@/lib/reports/process";
import {
  redisConnection,
  REPORTS_QUEUE,
  type RewriteReportJob,
  type RewriteReportResult,
} from "@/lib/reports/queue";

const connection = redisConnection();

const reports = new Worker<RewriteReportJob, RewriteReportResult>(
  REPORTS_QUEUE,
  async (job) => {
    try {
      return await processRewriteReport(job.id ?? "", job.data);
    } finally {
      // Le texte d'origine ne reste pas dans Redis après la génération (CLAUDE.md §4.5).
      if (job.data.original !== null) await job.updateData({ ...job.data, original: null });
    }
  },
  { connection, concurrency: 2 },
);

const MAINTENANCE_QUEUE = "maintenance";
const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
// Rétention de l'historique chaque jour à 03:15 UTC.
await maintenanceQueue.upsertJobScheduler(
  "retention-daily",
  { pattern: "15 3 * * *", tz: "UTC" },
  { name: "retention", opts: { removeOnComplete: 30, removeOnFail: 30 } },
);
const maintenance = new Worker(
  MAINTENANCE_QUEUE,
  async (job) => (job.name === "retention" ? { deleted: await applyRetention() } : null),
  { connection },
);

for (const worker of [reports, maintenance]) {
  worker.on("failed", (job, error) =>
    console.error(`[worker] ${worker.name} ${job?.id ?? "?"} : ${error.message}`),
  );
}
console.warn("[worker] prêt : files reports et maintenance.");

async function shutdown() {
  await Promise.all([reports.close(), maintenance.close(), maintenanceQueue.close()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
