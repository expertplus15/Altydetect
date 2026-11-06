import { beforeAll, describe, expect, it } from "vitest";
import { signedReportPath, verifyReportLink } from "./signed-link";

beforeAll(() => {
  process.env.AUTH_SECRET ??= "test-secret-only-for-tests";
});

function parse(path: string) {
  const url = new URL(path, "http://localhost");
  return [url.searchParams.get("expires"), url.searchParams.get("signature")] as const;
}

describe("liens de rapport signés", () => {
  const now = new Date("2026-11-05T10:00:00Z");

  it("accepte le lien pendant 15 minutes pour le même utilisateur", () => {
    const [expires, signature] = parse(signedReportPath("job-1", "user-1", now));
    expect(
      verifyReportLink("job-1", "user-1", expires, signature, new Date("2026-11-05T10:14:59Z")),
    ).toBe(true);
    expect(
      verifyReportLink("job-1", "user-1", expires, signature, new Date("2026-11-05T10:15:01Z")),
    ).toBe(false);
  });

  it("refuse un autre utilisateur, un autre rapport ou une signature modifiée", () => {
    const [expires, signature] = parse(signedReportPath("job-1", "user-1", now));
    expect(verifyReportLink("job-1", "user-2", expires, signature, now)).toBe(false);
    expect(verifyReportLink("job-2", "user-1", expires, signature, now)).toBe(false);
    expect(verifyReportLink("job-1", "user-1", expires, `${signature}x`, now)).toBe(false);
    expect(verifyReportLink("job-1", "user-1", String(Number(expires) + 600), signature, now)).toBe(
      false,
    );
  });
});
