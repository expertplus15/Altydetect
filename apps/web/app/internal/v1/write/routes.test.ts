import type { StreamFactory } from "@altydetect/core/llm";
import { fakeStreamFactory } from "@altydetect/core/llm/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// Test d'intégration des routes Écrire : vraie base ; session et modèle simulés.
const state = vi.hoisted(() => ({
  userId: null as string | null,
  factory: null as StreamFactory | null,
}));
vi.mock("@/auth", () => ({
  auth: () => Promise.resolve(state.userId ? { user: { id: state.userId } } : null),
}));
vi.mock("@/lib/llm/stream", () => ({ getStreamFactory: () => state.factory }));

const outline = await import("./outline/route");
const correct = await import("./correct/route");
const cite = await import("./cite/route");

const post = (handler: { POST: (r: Request) => Promise<Response> }, body: unknown) =>
  handler.POST(
    new Request("http://localhost/internal", { method: "POST", body: JSON.stringify(body) }),
  );

describe.skipIf(!process.env.DATABASE_URL)("routes /internal/v1/write/*", () => {
  const email = `write-routes-${Date.now()}@example.test`;
  let userId: string;

  beforeAll(async () => {
    userId = (await db.user.create({ data: { email } })).id;
  });
  beforeEach(() => {
    state.userId = userId;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it("exige un compte", async () => {
    state.userId = null;
    expect((await post(cite, {})).status).toBe(401);
  });

  it("plan : renvoie le plan et l'enregistre dans l'historique", async () => {
    state.factory = fakeStreamFactory(
      JSON.stringify({ title: "Plan", sections: [{ heading: "Introduction", points: ["A"] }] }),
    );
    const response = await post(outline, { subject: "L'évaluation formative", level: "master" });
    expect(await response.json()).toEqual({
      title: "Plan",
      sections: [{ heading: "Introduction", points: ["A"] }],
    });
    const analysis = await db.analysis.findFirstOrThrow({ where: { document: { userId } } });
    expect(analysis).toMatchObject({ type: "write", resultJson: { tool: "outline" } });
  });

  it("correction : positions calculées côté serveur", async () => {
    state.factory = fakeStreamFactory(
      JSON.stringify({
        corrections: [
          {
            original: "a",
            replacement: "à",
            kind: "spelling",
            explanation: "Préposition.",
            context: "mettre a profit",
          },
        ],
      }),
    );
    const response = await post(correct, { text: "Je souhaite mettre a profit." });
    expect(await response.json()).toEqual({
      corrections: [
        {
          start: 19,
          end: 20,
          original: "a",
          replacement: "à",
          kind: "spelling",
          explanation: "Préposition.",
        },
      ],
    });
  });

  it("partage le compteur quotidien de réécriture (Gratuit : 3 par jour)", async () => {
    state.factory = fakeStreamFactory(JSON.stringify({ corrections: [] }));
    const third = await post(correct, { text: "Texte correct." });
    expect(third.status).toBe(200);
    const fourth = await post(correct, { text: "Texte correct." });
    expect(fourth.status).toBe(429);
  });

  it("citation : mise en forme sans modèle ni quota", async () => {
    const response = await post(cite, {
      style: "apa7",
      source: {
        kind: "fields",
        fields: {
          type: "book",
          title: "Visible Learning",
          authors: [{ family: "Hattie", given: "John" }],
          year: "2009",
          publisher: "Routledge",
        },
      },
    });
    expect(await response.json()).toMatchObject({
      citation: "Hattie, J. (2009). *Visible Learning.* Routledge.",
      missing: [],
    });
  });

  it("citation : refuse une URL vers le réseau interne", async () => {
    const response = await post(cite, {
      style: "mla9",
      source: { kind: "url", url: "http://127.0.0.1:5432/" },
    });
    expect(await response.json()).toEqual({ error: "BLOCKED_ADDRESS" });
  });
});
