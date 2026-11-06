import { describe, expect, it } from "vitest";
import type { ParsedVariant } from "./parse";
import { RewriteError, runRewrite } from "./run";
import { fakeStreamFactory } from "./testing";

const INPUT = {
  text: "Comme le dit « tout change » (Durand, 2021), le gain est de 32 % et c'est vraiment bien.",
  register: "academic" as const,
  intensity: 2 as const,
  preserve_citations: true,
  variants: 2,
};

const REPLY =
  "<proposition>\n<texte>Ainsi que l'affirme ⟦1⟧ ⟦2⟧, le gain atteint ⟦3⟧, ce qui est remarquable.</texte>\n" +
  "<changements>Registre plus soutenu.</changements>\n</proposition>\n" +
  "<proposition>\n<texte>Selon ⟦1⟧ ⟦2⟧, on mesure un gain de ⟦3⟧ : le résultat est probant.</texte>\n" +
  "<changements>Phrase restructurée.</changements>\n</proposition>";

describe("runRewrite", () => {
  it("renvoie les propositions avec les passages protégés restaurés", async () => {
    const factory = fakeStreamFactory(REPLY);
    const result = await runRewrite(INPUT, factory);
    expect(result.output.variants).toEqual([
      {
        text: "Ainsi que l'affirme « tout change » (Durand, 2021), le gain atteint 32 %, ce qui est remarquable.",
        changes_summary: "Registre plus soutenu.",
      },
      {
        text: "Selon « tout change » (Durand, 2021), on mesure un gain de 32 % : le résultat est probant.",
        changes_summary: "Phrase restructurée.",
      },
    ]);
    expect(result.language).toBe("fr");
    expect(result.engine).toBe("claude-sonnet-5-5");
    // Le modèle n'a jamais reçu les passages protégés.
    expect(factory.requests[0]?.user).not.toContain("Durand");
  });

  it("diffuse la progression, sans marqueur coupé visible", async () => {
    const snapshots: ParsedVariant[][] = [];
    await runRewrite(INPUT, fakeStreamFactory(REPLY), { onProgress: (v) => snapshots.push(v) });
    expect(snapshots.length).toBeGreaterThan(10);
    for (const snapshot of snapshots) {
      for (const variant of snapshot) {
        expect(variant.text).not.toMatch(/⟦|<\/?[a-z]*$/);
      }
    }
    expect(snapshots.at(-1)?.map((v) => v.complete)).toEqual([true, true]);
  });

  it("écarte une proposition qui a perdu un passage protégé", async () => {
    const lossy = REPLY.replace("on mesure un gain de ⟦3⟧", "on mesure un gain net");
    const result = await runRewrite(INPUT, fakeStreamFactory(lossy));
    expect(result.output.variants).toHaveLength(1);
  });

  it("signale un refus du modèle", async () => {
    await expect(
      runRewrite(INPUT, fakeStreamFactory("", { stopReason: "refusal" })),
    ).rejects.toEqual(new RewriteError("REFUSED"));
  });

  it("signale une sortie inutilisable", async () => {
    await expect(runRewrite(INPUT, fakeStreamFactory("Voici votre texte."))).rejects.toEqual(
      new RewriteError("INVALID_OUTPUT"),
    );
  });

  it("garde les propositions complètes d'une sortie tronquée", async () => {
    const cut = REPLY.slice(0, REPLY.lastIndexOf("<proposition>") + 40);
    const result = await runRewrite(INPUT, fakeStreamFactory(cut, { stopReason: "max_tokens" }));
    expect(result.truncated).toBe(true);
    expect(result.output.variants).toHaveLength(1);
  });
});
