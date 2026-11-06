import {
  agreementReportSchema,
  detectOutputSchema,
  type AgreementReport,
  type DetectOutput,
  type VeritasDetectRequest,
} from "@altydetect/core";

// Client TypeScript du service Veritas (routes /internal/v1/*), protégé par le jeton interne.
// Veritas choisit lui-même qui répond (fournisseur externe, Veritas, ou les deux).

export class VeritasError extends Error {
  constructor(
    readonly status: number,
    /** TEXT_TOO_SHORT, DETECTION_UNAVAILABLE… ou VERITAS_ERROR. */
    readonly code: string,
    readonly minWords?: number,
  ) {
    super(`Veritas : ${status} ${code}`);
    this.name = "VeritasError";
  }
}

export interface VeritasClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  /** Délai maximal d'un appel, en millisecondes. */
  timeoutMs?: number;
}

export interface VeritasClient {
  detect: (request: VeritasDetectRequest) => Promise<DetectOutput>;
  agreement: () => Promise<AgreementReport>;
}

export function createVeritasClient(options: VeritasClientOptions): VeritasClient {
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
      signal: AbortSignal.timeout(options.timeoutMs ?? 60000),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: unknown;
      min_words?: unknown;
    };
    if (!response.ok) {
      throw new VeritasError(
        response.status,
        typeof body.error === "string" ? body.error : "VERITAS_ERROR",
        typeof body.min_words === "number" ? body.min_words : undefined,
      );
    }
    return body;
  }

  return {
    detect: async (request) =>
      detectOutputSchema.parse(
        await call("/internal/v1/detect", { method: "POST", body: JSON.stringify(request) }),
      ),
    agreement: async () => agreementReportSchema.parse(await call("/internal/v1/detect/agreement")),
  };
}
