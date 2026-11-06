/**
 * Exporte les contrats d'Indexa (schémas zod de @altydetect/core) en JSON Schema, puis génère
 * les modèles Pydantic v2 de services/indexa. Les deux sorties sont commitées ; la CI vérifie
 * qu'elles sont à jour (pnpm contracts:check).
 *
 * Usage : pnpm contracts:generate
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { INDEXA_CONTRACTS } from "@altydetect/core";

const root = fileURLToPath(new URL("..", import.meta.url));
const schemaPath = `${root}packages/core/schemas/indexa.json`;
const modelsPath = `${root}services/indexa/src/indexa/contracts.py`;

// Un seul document JSON Schema, une définition par modèle ; les schémas imbriqués sont des
// références ($ref) et non des copies.
const registry = z.registry<{ id: string }>();
for (const [name, schema] of Object.entries(INDEXA_CONTRACTS)) registry.add(schema, { id: name });
const { schemas } = z.toJSONSchema(registry, { io: "input", uri: (id) => `#/$defs/${id}` }) as {
  schemas: Record<string, Record<string, unknown>>;
};
const definitions = Object.fromEntries(
  Object.entries(schemas).map(([name, json]) => {
    const copy = { ...json };
    delete copy.$schema;
    delete copy.$id;
    return [name, copy];
  }),
);
mkdirSync(`${root}packages/core/schemas`, { recursive: true });
writeFileSync(
  schemaPath,
  `${JSON.stringify({ $schema: "https://json-schema.org/draft/2020-12/schema", title: "IndexaContracts", $defs: definitions }, null, 2)}\n`,
);

execFileSync(
  "uv",
  [
    "run",
    "--no-sync",
    "datamodel-codegen",
    "--input",
    schemaPath,
    "--input-file-type",
    "jsonschema",
    "--output",
    modelsPath,
    "--output-model-type",
    "pydantic_v2.BaseModel",
    "--target-python-version",
    "3.12",
    "--use-standard-collections",
    "--use-union-operator",
    "--use-annotated",
    "--field-constraints",
    "--disable-timestamp",
    "--custom-file-header",
    "# Généré par scripts/export-contracts.ts à partir des schémas zod de @altydetect/core.\n# Ne pas modifier à la main : pnpm contracts:generate.",
  ],
  { cwd: root, stdio: "inherit" },
);
console.log(`Contrats exportés : ${schemaPath} → ${modelsPath}`);
