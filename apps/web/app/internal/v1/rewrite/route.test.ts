import { fakeStreamFactory } from "@altydetect/rewrite/testing";
import type { StreamFactory } from "@altydetect/core/llm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// Test d'intégration : vraie base et vrai Redis ; session, cookies et modèle simulés.
const state = vi.hoisted(() => ({
  userId: null as string | null,
  cookies: new Map<string, string>(),
  factory: null as StreamFactory | null,
}));

vi.mock("@/auth", () => ({
  auth: () => Promise.resolve(state.userId ? { user: { id: state.userId } } : null),
}));
vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined,
      set: (name: string, value: string) => state.cookies.set(name, value),
    }),
}));
vi.mock("@/lib/llm/stream", () => ({ getStreamFactory: () => state.factory }));

const { POST } = await import("./route");

const REPLY = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `<proposition><texte>Version ${i + 1} : le gain atteint ⟦1⟧.</texte><changements>Style ${i + 1}.</changements></proposition>`,
  ).join("");

function call(body: unknown, { stream = false, ip = "203.0.113.7" } = {}) {
  return POST(
    new Request("http://localhost/internal/v1/rewrite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": ip,
        ...(stream ? { accept: "text/event-stream" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

const BODY = {
  text: "On observe un gain de 32 % sur l'année, ce qui est vraiment beaucoup.",
  register: "academic",
  intensity: 2,
  variants: 3,
};

describe.skipIf(!process.env.DATABASE_URL || !process.env.REDIS_URL)(
  "POST /internal/v1/rewrite",
  () => {
    const email = `rewrite-route-${Date.now()}@example.test`;
    let userId: string;

    beforeAll(async () => {
      userId = (await db.user.create({ data: { email } })).id;
    });
    beforeEach(() => {
      state.userId = userId;
      state.cookies.clear();
      state.factory = fakeStreamFactory(REPLY(3));
    });
    afterAll(async () => {
      await db.user.deleteMany({ where: { email } });
      await db.$disconnect();
    });

    it("refuse une entrée invalide", async () => {
      expect((await call({ text: "x", register: "poetic", intensity: 2 })).status).toBe(400);
    });

    it("Gratuit : une proposition, enregistrée dans l'historique sans le texte original", async () => {
      const response = await call(BODY);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { variants: { text: string }[] };
      expect(body.variants).toEqual([
        { text: "Version 1 : le gain atteint 32 %.", changes_summary: "Style 1." },
      ]);
      const doc = await db.document.findFirstOrThrow({
        where: { userId },
        include: { analyses: true },
      });
      expect(doc.text).toBeNull();
      expect(doc.wordCount).toBe(13);
      expect(doc.analyses[0]?.type).toBe("rewrite");
    });

    it("Gratuit : refuse au-delà de 3 réécritures par jour, avant d'appeler le modèle", async () => {
      await call(BODY);
      await call(BODY);
      const factory = fakeStreamFactory(REPLY(1));
      state.factory = factory;
      const response = await call(BODY);
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ error: "QUOTA_EXCEEDED", limit: 3 });
      expect(factory.requests).toHaveLength(0);
    });

    it("Pro : jusqu'à 3 propositions, limite d'usage non affichée", async () => {
      await db.subscription.create({ data: { userId, plan: "pro", status: "active" } });
      const body = (await (await call(BODY)).json()) as { variants: unknown[] };
      expect(body.variants).toHaveLength(3);
    });

    it("rend la réécriture consommée quand le modèle refuse", async () => {
      const before = (await db.usage.findUniqueOrThrow({ where: { userId } })).rewriteRequestsToday;
      state.factory = fakeStreamFactory("", { stopReason: "refusal" });
      const response = await call(BODY);
      expect(response.status).toBe(422);
      expect((await db.usage.findUniqueOrThrow({ where: { userId } })).rewriteRequestsToday).toBe(
        before,
      );
    });

    it("diffuse la progression en SSE puis le résultat final", async () => {
      const response = await call(BODY, { stream: true });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const text = await response.text();
      expect(text).toContain("event: progress");
      expect(text).toMatch(/event: done\ndata: .*"documentId":"[^"]+"/);
    });

    it("essai sans compte : une fois, puis inscription demandée", async () => {
      state.userId = null;
      const ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
      const first = await call(BODY, { ip });
      expect(first.status).toBe(200);
      expect(((await first.json()) as { variants: unknown[] }).variants).toHaveLength(1);
      expect(state.cookies.get("alty_trial")).toBeTruthy();
      const second = await call(BODY, { ip });
      expect(second.status).toBe(403);
      expect(await second.json()).toEqual({ error: "SIGN_UP_REQUIRED" });
    });
  },
);
