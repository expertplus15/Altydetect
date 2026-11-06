import "server-only";

/** Adresse IP du client derrière le proxy d'hébergement (première de X-Forwarded-For). */
export function requestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}
