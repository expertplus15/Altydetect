import type { DetectOutput, PlagiarismTask, VeritasDetectRequest } from "@altydetect/core";
import type { IndexaClient } from "@altydetect/plagiarism";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";
import { db } from "@/lib/db";

// Test d'intégration de la passerelle (ADR-0019) : vraie base et vrai Redis ; Veritas et
// Indexa simulés. Les routes publiques appellent les mêmes traitements que les routes internes.
const state = vi.hoisted(() => ({ calls: [] as VeritasDetectRequest[] }));
const OUTPUT: DetectOutput = {
  overall: { ai: 0.62, undetermined: 0.14, human: 0.24 },
  confidence: "medium",
  verdict_band: "likely_ai",
  language: "fr",
  sentences: [{ start: 0, end: 4, score: 0.8, band: "likely_ai" }],
  signals: { humanization: "none" },
  engine: { primary: "VRT-DET-FR-0.6" },
  word_count: 200,
};
vi.mock("@/lib/detect/veritas", () => ({
  getVeritas: () => ({
    detect: (request: VeritasDetectRequest) => {
      state.calls.push(request);
      return Promise.resolve(OUTPUT);
    },
  }),
}));
vi.mock("@/lib/plagiarism/indexa", () => ({
  getIndexa: (): Partial<IndexaClient> => ({
    submit: () =>
      Promise.resolve<PlagiarismTask>({ task_id: "plg_api_test", status: "queued", progress: 0 }),
    task: () =>
      Promise.resolve<PlagiarismTask>({ task_id: "plg_api_test", status: "running", progress: 50 }),
  }),
}));

const detectRoute = await import("./detect/route");
const plagiarismRoute = await import("./plagiarism/route");
const taskRoute = await import("./plagiarism/[taskId]/route");

const TEXT = Array.from({ length: 200 }, (_, i) => `mot${i}`).join(" ");
const request = (key: string | null, body?: unknown) =>
  new Request("http://localhost/api/v1", {
    method: body === undefined ? "GET" : "POST",
    headers: key ? { authorization: `Bearer ${key}` } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)("API publique v1", () => {
  const stamp = Date.now();
  const proEmail = `api-pro-${stamp}@example.test`;
  const freeEmail = `api-free-${stamp}@example.test`;
  let proKey: string;
  let freeKey: string;
  let proId: string;

  beforeAll(async () => {
    const pro = await db.user.create({
      data: { email: proEmail, subscription: { create: { plan: "pro", status: "active" } } },
    });
    const free = await db.user.create({ data: { email: freeEmail } });
    proId = pro.id;
    const created = await createApiKey(pro.id, "test");
    const other = await createApiKey(free.id, "test");
    if (!created.ok || !other.ok) throw new Error("clé non créée");
    proKey = created.key;
    freeKey = other.key;
  });
  beforeEach(() => {
    process.env.PUBLIC_API_ENABLED = "true";
    state.calls = [];
  });
  afterEach(() => {
    delete process.env.PUBLIC_API_ENABLED;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { in: [proEmail, freeEmail] } } });
    await db.$disconnect();
  });

  it("reste fermée sans PUBLIC_API_ENABLED", async () => {
    delete process.env.PUBLIC_API_ENABLED;
    const response = await detectRoute.POST(request(proKey, { text: TEXT }));
    expect(response.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("exige une clé valide", async () => {
    for (const key of [null, "alty_inconnue", `alty_${"0".repeat(32)}`]) {
      const response = await detectRoute.POST(request(key, { text: TEXT }));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "INVALID_API_KEY" });
    }
  });

  it("est réservée à Pro", async () => {
    const response = await detectRoute.POST(request(freeKey, { text: TEXT }));
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({ error: "UPGRADE_REQUIRED" });
  });

  it("sert la détection avec le même contrat et le même quota que l'interface", async () => {
    const response = await detectRoute.POST(request(proKey, { text: TEXT }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as DetectOutput & { analysisId: string };
    expect(body.verdict_band).toBe("likely_ai");
    expect(body.analysisId).toBeTruthy();
    expect(state.calls[0]?.plan).toBe("pro");
    const usage = await db.usage.findUnique({ where: { userId: proId } });
    expect(usage?.detectionWordsUsed).toBe(200);
    const key = await db.apiKey.findFirstOrThrow({ where: { userId: proId } });
    expect(key.lastUsedAt).not.toBeNull();
    // Mêmes erreurs que l'endpoint interne.
    const short = await detectRoute.POST(request(proKey, { text: "trop court" }));
    expect(short.status).toBe(422);
  });

  it("sert le plagiat : tâche, puis état de la tâche du seul compte propriétaire", async () => {
    const submitted = await plagiarismRoute.POST(request(proKey, { text: TEXT, scope: "web" }));
    expect(submitted.status).toBe(202);
    const params = { params: Promise.resolve({ taskId: "plg_api_test" }) };
    const task = await taskRoute.GET(request(proKey), params);
    expect(task.status).toBe(200);
    expect(await task.json()).toMatchObject({ status: "running" });
  });

  it("refuse une clé révoquée", async () => {
    const extra = await createApiKey(proId, "à révoquer");
    if (!extra.ok) throw new Error("clé non créée");
    expect(await revokeApiKey(proId, extra.summary.id)).toBe(true);
    const response = await detectRoute.POST(request(extra.key, { text: TEXT }));
    expect(response.status).toBe(401);
  });

  it("limite le nombre de clés actives", async () => {
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await createApiKey(proId, `clé ${i}`));
    expect(results.filter((r) => !r.ok)).not.toHaveLength(0);
    expect(await db.apiKey.count({ where: { userId: proId, revokedAt: null } })).toBe(5);
  });
});
