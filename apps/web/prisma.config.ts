import { defineConfig } from "prisma/config";

// Les migrations vivent dans infra/ (CLAUDE.md §3).
// SHADOW_DATABASE_URL sert à `prisma migrate diff` en CI pour vérifier que les migrations
// correspondent au schéma.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "../../infra/migrations" },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {}),
  },
});
