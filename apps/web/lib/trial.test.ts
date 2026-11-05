import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  consumeTrial,
  getTrialResult,
  hasUsedTrial,
  newTrialId,
  saveTrialResult,
  takeTrialResult,
  TRIAL_MAX_PER_IP_PER_DAY,
} from "./trial";

// Test d'intégration : nécessite Redis (REDIS_URL). Exécuté en CI.
describe.skipIf(!process.env.REDIS_URL)("essai sans compte", () => {
  const redis = new Redis(process.env.REDIS_URL ?? "");
  let ip: string;

  beforeEach(() => {
    ip = `test-${newTrialId()}`;
  });

  afterAll(async () => {
    await redis.quit();
  });

  it("n'autorise qu'un essai par navigateur", async () => {
    const id = newTrialId();
    expect(await hasUsedTrial(redis, id)).toBe(false);
    expect(await consumeTrial(redis, id, ip)).toBe("ok");
    expect(await consumeTrial(redis, id, ip)).toBe("already_used");
    expect(await hasUsedTrial(redis, id)).toBe(true);
  });

  it("limite les essais par adresse IP et par jour", async () => {
    for (let i = 0; i < TRIAL_MAX_PER_IP_PER_DAY; i++) {
      expect(await consumeTrial(redis, newTrialId(), ip)).toBe("ok");
    }
    expect(await consumeTrial(redis, newTrialId(), ip)).toBe("ip_limit");
  });

  it("garde le résultat et ne le rend qu'une fois", async () => {
    const id = newTrialId();
    const result = {
      type: "rewrite" as const,
      title: "Essai",
      wordCount: 40,
      engine: "x",
      result: { v: 1 },
    };
    await saveTrialResult(redis, id, result);
    expect(await getTrialResult(redis, id)).toEqual(result);
    expect(await takeTrialResult(redis, id)).toEqual(result);
    expect(await takeTrialResult(redis, id)).toBeNull();
  });
});
