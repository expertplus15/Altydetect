// Configuration ESLint unique du monorepo (format « flat config »).
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "**/.venv/**",
      "**/*.mjs",
      "**/generated/**",
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    // Les assertions sur des fonctions simulées (vi.fn) sont des références de méthode.
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/unbound-method": "off" },
  },
  {
    files: ["scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
