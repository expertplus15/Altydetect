import {
  plagiarismTaskSchema,
  privateSourceSchema,
  type PlagiarismInput,
  type PlagiarismTask,
  type PrivateSource,
  type PrivateSourceInput,
} from "@altydetect/core";

// Client TypeScript du service Indexa (routes /internal/v1/*), protégé par le jeton interne.

export class IndexaError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Indexa : ${status} ${code}`);
    this.name = "IndexaError";
  }
}

export interface IndexaClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Délai maximal d'un appel, en millisecondes. */
  timeoutMs?: number;
}

export interface IndexaClient {
  submit: (input: PlagiarismInput) => Promise<PlagiarismTask>;
  task: (taskId: string) => Promise<PlagiarismTask>;
  addSource: (input: PrivateSourceInput) => Promise<PrivateSource>;
  deleteSource: (workspaceId: string, sourceId: string) => Promise<void>;
}

export function createIndexaClient(options: IndexaClientOptions): IndexaClient {
  const doFetch = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/, "");

  async function call(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await doFetch(`${base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-internal-token": options.token,
        ...init.headers,
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
    if (response.status === 204) return null;
    const body = (await response.json().catch(() => ({}))) as { detail?: unknown };
    if (!response.ok) {
      throw new IndexaError(
        response.status,
        typeof body.detail === "string" ? body.detail : "INDEXA_ERROR",
      );
    }
    return body;
  }

  return {
    submit: async (input) =>
      plagiarismTaskSchema.parse(
        await call("/internal/v1/plagiarism", { method: "POST", body: JSON.stringify(input) }),
      ),
    task: async (taskId) =>
      plagiarismTaskSchema.parse(
        await call(`/internal/v1/plagiarism/tasks/${encodeURIComponent(taskId)}`),
      ),
    addSource: async (input) =>
      privateSourceSchema.parse(
        await call("/internal/v1/private-sources", { method: "POST", body: JSON.stringify(input) }),
      ),
    deleteSource: async (workspaceId, sourceId) => {
      await call(
        `/internal/v1/private-sources/${encodeURIComponent(sourceId)}?workspace_id=${encodeURIComponent(workspaceId)}`,
        { method: "DELETE" },
      );
    },
  };
}
