import { defineConfig, devices } from "@playwright/test";

// Parcours de bout en bout sur l'application construite (next build) :
// Stripe simulé (e2e/stripe-mock.mjs), modèle simulé (ALTY_LLM=fake), e-mails déposés dans Redis,
// Indexa avec une recherche web simulée.
// Prérequis : PostgreSQL migré et Redis (DATABASE_URL, REDIS_URL).
const PORT = 3200;
const env = {
  ALTY_E2E: "1",
  ALTY_LLM: "fake",
  AUTH_EMAIL_TRANSPORT: "log",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-not-for-production-0123456789",
  AUTH_URL: `http://localhost:${PORT}`,
  AUTH_GOOGLE_ID: "e2e",
  AUTH_GOOGLE_SECRET: "e2e",
  NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
  STRIPE_SECRET_KEY: "sk_test_e2e",
  STRIPE_WEBHOOK_SECRET: "whsec_e2e",
  STRIPE_API_BASE: "http://localhost:12111",
  APP_URL: `http://localhost:${PORT}`,
  INDEXA_URL: "http://localhost:8002",
  INDEXA_INTERNAL_TOKEN: "e2e-indexa-token",
  INDEXA_SEARCH_PROVIDER: "fixtures",
  INDEXA_FIXTURES_PATH: new URL(
    "../../services/indexa/tests/fixtures/web-pages.json",
    import.meta.url,
  ).pathname,
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
};

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", acceptDownloads: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/stripe-mock.mjs",
      url: "http://localhost:12111/__health",
      env,
      reuseExistingServer: false,
    },
    { command: "pnpm worker", env, reuseExistingServer: false, wait: { stderr: /prêt/ } },
    // Indexa (plagiat) : API et worker RQ, recherche web simulée sur un corpus local.
    {
      command: "uv run --no-sync --package indexa uvicorn indexa.main:app --port 8002",
      url: "http://localhost:8002/health",
      env,
      reuseExistingServer: false,
    },
    {
      command: "uv run --no-sync --package indexa rq worker indexa --url $REDIS_URL",
      env,
      reuseExistingServer: false,
      wait: { stdout: /Listening on|indexa/ },
    },
    {
      command: `pnpm start -p ${PORT}`,
      url: `http://localhost:${PORT}/fr`,
      env,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
