import { describe, expect, it } from "vitest";
import { plagiarismInputSchema, plagiarismTaskSchema } from "./plagiarism";

describe("contrat de plagiat", () => {
  it("valide une entrée et refuse un périmètre inconnu", () => {
    expect(plagiarismInputSchema.parse({ text: "Bonjour", scope: "web" })).toEqual({
      text: "Bonjour",
      scope: "web",
    });
    expect(plagiarismInputSchema.safeParse({ text: "Bonjour", scope: "partout" }).success).toBe(
      false,
    );
  });

  it("applique un avancement nul par défaut", () => {
    expect(plagiarismTaskSchema.parse({ task_id: "t", status: "queued" }).progress).toBe(0);
  });
});
