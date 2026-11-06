import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const web = (path: string) => fileURLToPath(new URL(`./apps/web/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "server-only": web("test/server-only.ts"),
      "@/": web(""),
    },
  },
  test: {
    include: ["scripts/**/*.test.ts", "packages/*/src/**/*.test.ts", "apps/web/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "apps/web/e2e/**"],
    // Les tests d'intégration partagent une seule base : pas d'exécution parallèle entre fichiers.
    fileParallelism: false,
    // Couverture minimale de 80 % sur packages/* (CLAUDE.md §9).
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      exclude: ["**/*.test.ts", "**/testing.ts"],
      reporter: ["text-summary", "text"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
