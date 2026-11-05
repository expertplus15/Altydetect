import type { PlagiarismTask } from "@altydetect/core";
import { IndexaError, type IndexaClient } from "@altydetect/plagiarism";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// Test d'intégration : vraie base et vrai Redis ; session et service Indexa simulés.
const state = vi.hoisted(() => ({
  userId: null as string | null,
  submit: null as ((input: unknown) => Promise<PlagiarismTask>) | null,
  task: null as ((id: string) => Promise<PlagiarismTask>) | null,
}));
vi.mock("@/auth", () => ({
  auth: () => Promise.resolve(state.userId ? { user: { id: state.userId } } : null),
}));
vi.mock("@/lib/plagiarism/indexa", () => ({
  getIndexa: (): Partial<IndexaClient> => ({
    submit: (input) => (state.submit as NonNullable<typeof state.submit>)(input),
    task: (id) => (state.task as NonNullable<typeof state.task>)(id),
  }),
}));

const submitRoute = await import("./route");
const taskRoute = await import("./[taskId]/route");

const TEXT = Array.from({ length: 200 }, (_, i) => `mot${i}`).join(" ");
const post = (body: unknown) =>
  submitRoute.POST(
    new Request("http://localhost/internal/v1/plagiarism", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
const get = (taskId: string) =>
  taskRoute.GET(new Request("http://localhost"), { params: Promise.resolve({ taskId }) });
const used = async (userId: string) =>
  (await db.usage.findUnique({ where: { userId } }))?.detectionWordsUsed ?? 0;

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)("routes de plagiat", () => {
  const email = `plagiarism-${Date.now()}@example.test`;
  let userId: string;
  let taskId: string;

  beforeAll(async () => {
    userId = (await db.user.create({ data: { email } })).id;
  });
  beforeEach(() => {
    state.userId = userId;
    taskId = `plg_test_${Math.random().toString(36).slice(2)}`;
    state.submit = () => Promise.resolve({ task_id: taskId, status: "queued", progress: 0 });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("exige un compte", async () => {
    state.userId = null;
    expect((await post({ text: TEXT, scope: "web" })).status).toBe(401);
  });

  it("refuse un texte de moins de 150 mots sans consommer de quota", async () => {
    const response = await post({ text: "trop court", scope: "web" });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "TEXT_TOO_SHORT" });
    expect(await used(userId)).toBe(0);
  });

  it("réserve la base privée à Pro", async () => {
    expect((await post({ text: TEXT, scope: "private" })).status).toBe(402);
  });

  it("met l'analyse en file, consomme les mots, puis enregistre le résultat une seule fois", async () => {
    const response = await post({ text: TEXT, scope: "web" });
    expect(response.status).toBe(202);
    expect(await used(userId)).toBe(200);

    state.task = () =>
      Promise.resolve({
        task_id: taskId,
        status: "done",
        progress: 1,
        result: {
          similarity: 0.1,
          matches: [{ start: 0, end: 4, source_url: "https://ex.fr", excerpt: "mot0", score: 1 }],
          engine: "IDX-WEB-1.0",
        },
      });
    const first = (await (await get(taskId)).json()) as { analysisId: string };
    const second = (await (await get(taskId)).json()) as { analysisId: string };
    expect(first.analysisId).toBeTruthy();
    expect(second.analysisId).toBe(first.analysisId);
    const analyses = await db.analysis.findMany({
      where: { document: { userId }, type: "plagiarism" },
    });
    expect(analyses).toHaveLength(1);
    expect(analyses[0]?.engine).toBe("IDX-WEB-1.0");
  });

  it("rend les mots une seule fois quand l'analyse échoue", async () => {
    await post({ text: TEXT, scope: "web" });
    const before = await used(userId);
    state.task = () =>
      Promise.resolve({
        task_id: taskId,
        status: "failed",
        progress: 0.3,
        error: "ANALYSIS_FAILED",
      });
    await get(taskId);
    await get(taskId);
    expect(await used(userId)).toBe(before - 200);
  });

  it("rend les mots quand Indexa ne répond pas", async () => {
    const before = await used(userId);
    state.submit = () => Promise.reject(new IndexaError(503, "INDISPONIBLE"));
    expect((await post({ text: TEXT, scope: "web" })).status).toBe(502);
    expect(await used(userId)).toBe(before);
  });

  it("refuse de suivre la tâche d'un autre utilisateur", async () => {
    await post({ text: TEXT, scope: "web" });
    state.userId = "autre-utilisateur";
    expect((await get(taskId)).status).toBe(404);
  });
});
