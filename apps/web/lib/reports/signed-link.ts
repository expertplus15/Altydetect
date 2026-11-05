import { createHmac, timingSafeEqual } from "node:crypto";

// Liens de téléchargement des rapports : signés (HMAC) et valables 15 minutes.

export const REPORT_LINK_TTL_SECONDS = 15 * 60;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET manquante : voir .env.example.");
  return value;
}

function sign(jobId: string, userId: string, expires: number): string {
  return createHmac("sha256", secret())
    .update(`report:${jobId}:${userId}:${expires}`)
    .digest("base64url");
}

export function signedReportPath(jobId: string, userId: string, now: Date = new Date()): string {
  const expires = Math.floor(now.getTime() / 1000) + REPORT_LINK_TTL_SECONDS;
  return `/api/reports/${encodeURIComponent(jobId)}/download?expires=${expires}&signature=${sign(jobId, userId, expires)}`;
}

export function verifyReportLink(
  jobId: string,
  userId: string,
  expires: string | null,
  signature: string | null,
  now: Date = new Date(),
): boolean {
  const exp = Number(expires);
  if (!signature || !Number.isInteger(exp) || exp < Math.floor(now.getTime() / 1000)) return false;
  const expected = Buffer.from(sign(jobId, userId, exp));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
