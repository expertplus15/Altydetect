import type { DetectOutput, VeritasDetectRequest } from "@altydetect/core";
import { VeritasError } from "@altydetect/detect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// Test d'intégration : vraie base ; session et service Veritas simulés.
const state = vi.hoisted(() => ({
  userId: null as string | null,
  detect: null as ((request: VeritasDetectRequest) => Promise<DetectOutput>) | null,
  calls: [] as VeritasDetectRequest[],
}));
vi.mock("@/auth", () => ({
  auth: () => Promise.resolve(state.userId ? { user: { id: state.userId } } : null),
}));
vi.mock("@/lib/detect/veritas", () => ({
  getVeritas: () => ({
    detect: (request: VeritasDetectRequest) => {
      state.calls.push(request);
      return (state.detect as NonNullable<typeof state.detect>)(request);
    },
  }),
}));

const { POST } = await import("./route");

const TEXT = Array.from({ length: 200 }, (_, i) => `mot${i}`).join(" ");
const OUTPUT: DetectOutput = {
  overall: { ai: 0.62, undetermined: 0.14, human: 0.24 },
  confidence: "medium",
  verdict_band: "likely_ai",
  language: "fr",
  sentences: [{ start: 0, end: 4, score: 0.8, band: "likely_ai" }],
  signals: { humanization: "none" },
  engine: { primary: "pangram" },
  word_count: 200,
};
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/internal/v1/detect", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
const used = async (userId: string) =>
  (await db.usage.findUnique({ where: { userId } }))?.detectionWordsUsed ?? 0;

describe.skipIf(!process.env.DATABASE_URL)("route de détection", () => {
  const email = `detect-${Date.now()}@example.test`;
  let userId: string;

  beforeAll(async () => {
    userId = (await db.user.create({ data: { email } })).id;
  });
  beforeEach(async () => {
    state.userId = userId;
    state.calls = [];
    state.detect = () => Promise.resolve(OUTPUT);
    await db.usage.deleteMany({ where: { userId } });
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("exige un compte", async () => {
    state.userId = null;
    expect((await post({ text: TEXT })).status).toBe(401);
  });

  it("refuse moins de 150 mots sans appeler Veritas ni consommer de quota", async () => {
    const response = await post({ text: "trop court" });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "TEXT_TOO_SHORT", minWords: 150 });
    expect(state.calls).toEqual([]);
    expect(await used(userId)).toBe(0);
  });

  it("réserve l'analyse approfondie à Pro", async () => {
    expect((await post({ text: TEXT, mode: "deep" })).status).toBe(402);
    expect(state.calls).toEqual([]);
  });

  it("consomme les mots, transmet l'offre et enregistre le résultat sans le texte", async () => {
    const response = await post({ text: TEXT });
    expect(response.status).toBe(200);
    const body = (await response.json()) as DetectOutput & { analysisId: string };
    expect(body.verdict_band).toBe("likely_ai");
    expect(state.calls).toEqual([{ text: TEXT, language: "auto", mode: "standard", plan: "free" }]);
    expect(await used(userId)).toBe(200);

    const analysis = await db.analysis.findUniqueOrThrow({
      where: { id: body.analysisId },
      include: { document: true },
    });
    expect(analysis.type).toBe("detect");
    expect(analysis.engine).toBe("pangram");
    expect(analysis.document.text).toBeNull();
    expect(JSON.stringify(analysis.resultJson)).not.toContain("mot10 mot11");
  });

  it("garde le texte seulement avec keep_text", async () => {
    const body = (await (await post({ text: TEXT, keep_text: true })).json()) as {
      analysisId: string;
    };
    const analysis = await db.analysis.findUniqueOrThrow({
      where: { id: body.analysisId },
      include: { document: true },
    });
    expect(analysis.document.text).toBe(TEXT);
  });

  it("rend les mots quand Veritas ne répond pas", async () => {
    state.detect = () => Promise.reject(new VeritasError(503, "DETECTION_UNAVAILABLE"));
    const response = await post({ text: TEXT });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "DETECTION_UNAVAILABLE" });
    expect(await used(userId)).toBe(0);
  });

  it("rend les mots quand Veritas compte moins de 150 mots", async () => {
    state.detect = () => Promise.reject(new VeritasError(422, "TEXT_TOO_SHORT", 150));
    expect((await post({ text: TEXT })).status).toBe(422);
    expect(await used(userId)).toBe(0);
  });
});
