import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  bearerKey,
  displayPrefix,
  generateApiKey,
  hashApiKey,
  isWellFormedApiKey,
} from "./keys";

describe("clés d'API (ADR-0019)", () => {
  it("génère des clés alty_ de 32 caractères base 62, toutes différentes", () => {
    const keys = Array.from({ length: 200 }, () => generateApiKey());
    for (const key of keys) {
      expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
      expect(key).toHaveLength(API_KEY_PREFIX.length + 32);
      expect(isWellFormedApiKey(key)).toBe(true);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("n'enregistre qu'une empreinte stable et un préfixe court", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).not.toContain(key.slice(5));
    expect(displayPrefix(key)).toBe(key.slice(0, 11));
  });

  it("refuse les clés mal formées", () => {
    for (const bad of [
      "",
      "alty_",
      "alty_court",
      `sk_${"a".repeat(32)}`,
      `alty_${"é".repeat(32)}`,
    ]) {
      expect(isWellFormedApiKey(bad)).toBe(false);
    }
  });

  it("lit la clé dans l'en-tête Authorization: Bearer", () => {
    const request = (value?: string) =>
      new Request("http://localhost", value ? { headers: { authorization: value } } : {});
    expect(bearerKey(request("Bearer alty_abc"))).toBe("alty_abc");
    expect(bearerKey(request("bearer   alty_abc  "))).toBe("alty_abc");
    expect(bearerKey(request("Basic xyz"))).toBeNull();
    expect(bearerKey(request())).toBeNull();
  });
});
