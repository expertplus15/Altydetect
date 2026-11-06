import { describe, expect, it, vi } from "vitest";
import { createVeritasClient, VeritasError } from "./client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
}

const OUTPUT = {
  overall: { ai: 0.62, undetermined: 0.14, human: 0.24 },
  confidence: "medium",
  verdict_band: "likely_ai",
  language: "fr",
  sentences: [{ start: 0, end: 12, score: 0.8, band: "likely_ai" }],
  signals: { humanization: "none" },
  engine: { primary: "pangram" },
  word_count: 320,
};

describe("client Veritas", () => {
  it("envoie le jeton interne et valide la sortie du contrat", async () => {
    const fetch = fakeFetch(200, OUTPUT);
    const client = createVeritasClient({ baseUrl: "http://veritas:8001/", token: "tok", fetch });
    const out = await client.detect({ text: "Bonjour", plan: "pro" });
    expect(out).toEqual(OUTPUT);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://veritas:8001/internal/v1/detect");
    expect(init?.headers).toMatchObject({ "x-internal-token": "tok" });
    expect(JSON.parse(init?.body as string)).toEqual({ text: "Bonjour", plan: "pro" });
  });

  it("transforme TEXT_TOO_SHORT en VeritasError avec le minimum", async () => {
    const client = createVeritasClient({
      baseUrl: "http://v",
      token: "t",
      fetch: fakeFetch(422, { error: "TEXT_TOO_SHORT", min_words: 150 }),
    });
    await expect(client.detect({ text: "x" })).rejects.toMatchObject({
      status: 422,
      code: "TEXT_TOO_SHORT",
      minWords: 150,
    });
  });

  it("donne un code générique quand la réponse n'en a pas", async () => {
    const client = createVeritasClient({
      baseUrl: "http://v",
      token: "t",
      fetch: fakeFetch(500, {}),
    });
    const error = await client.detect({ text: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VeritasError);
    expect((error as VeritasError).code).toBe("VERITAS_ERROR");
  });

  it("refuse une sortie hors contrat", async () => {
    const client = createVeritasClient({
      baseUrl: "http://v",
      token: "t",
      fetch: fakeFetch(200, { ...OUTPUT, verdict_band: "ai" }),
    });
    await expect(client.detect({ text: "x" })).rejects.toThrow();
  });

  it("lit le rapport d'accord", async () => {
    const report = { threshold: 0.85, min_comparisons: 200, segments: [] };
    const client = createVeritasClient({
      baseUrl: "http://v",
      token: "t",
      fetch: fakeFetch(200, report),
    });
    expect(await client.agreement()).toEqual(report);
  });
});
