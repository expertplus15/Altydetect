import { describe, expect, it, vi } from "vitest";
import { createIndexaClient, IndexaError } from "./client";

function fakeFetch(status: number, body: unknown) {
  return vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
    Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status })),
  );
}

describe("client Indexa", () => {
  it("envoie le jeton interne et valide la tâche renvoyée", async () => {
    const fetch = fakeFetch(202, { task_id: "plg_1", status: "queued", progress: 0 });
    const client = createIndexaClient({ baseUrl: "http://indexa:8002/", token: "tok", fetch });
    const task = await client.submit({ text: "Bonjour", scope: "web" });
    expect(task).toEqual({ task_id: "plg_1", status: "queued", progress: 0 });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://indexa:8002/internal/v1/plagiarism");
    expect(init?.headers).toMatchObject({ "x-internal-token": "tok" });
  });

  it("renvoie le résultat d'une tâche terminée", async () => {
    const fetch = fakeFetch(200, {
      task_id: "plg_1",
      status: "done",
      progress: 1,
      result: {
        similarity: 0.2,
        matches: [{ start: 0, end: 5, source_url: "https://ex.fr", excerpt: "x", score: 1 }],
        engine: "IDX-WEB-1.0",
      },
    });
    const task = await createIndexaClient({ baseUrl: "http://i", token: "t", fetch }).task("plg_1");
    expect(task.result?.matches[0]?.source_url).toBe("https://ex.fr");
  });

  it("transforme une erreur HTTP en IndexaError avec son code", async () => {
    const client = createIndexaClient({
      baseUrl: "http://i",
      token: "t",
      fetch: fakeFetch(404, { detail: "tâche inconnue ou expirée" }),
    });
    await expect(client.task("x")).rejects.toEqual(
      new IndexaError(404, "tâche inconnue ou expirée"),
    );
  });

  it("refuse une réponse hors contrat", async () => {
    const client = createIndexaClient({
      baseUrl: "http://i",
      token: "t",
      fetch: fakeFetch(200, { task_id: "x", status: "bizarre" }),
    });
    await expect(client.task("x")).rejects.toThrow();
  });

  it("supprime une source de la base privée", async () => {
    const fetch = fakeFetch(204, null);
    await createIndexaClient({ baseUrl: "http://i", token: "t", fetch }).deleteSource(
      "u 1",
      "src_1",
    );
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "http://i/internal/v1/private-sources/src_1?workspace_id=u%201",
    );
  });
});
