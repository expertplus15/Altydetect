import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { closeHelpers, magicLink, query, typeInEditor, uniqueEmail } from "./helpers";

// Phase 2 : base privée, analyse de plagiat (web et base privée), rapport PDF combiné.

test.afterAll(closeHelpers);

const COPIED =
  "Dans les classes observées, les enseignants donnent un retour régulier et précis, ce qui permet à chacun de corriger ses méthodes avant l'examen final.";
const PRIVATE =
  "Mon mémoire montre que la motivation progresse nettement quand la classe travaille en petits groupes autonomes chaque semaine.";
const FILLER = Array.from({ length: 140 }, (_, i) => `réflexion${i}`).join(" ");

test("analyse de plagiat sur le web et la base privée, puis rapport PDF", async ({ page }) => {
  const email = uniqueEmail("e2e-plagiat");
  await page.goto("/fr/inscription");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page).toHaveURL(/\/fr\/connexion\/verifier/);
  await page.goto(await magicLink(email));
  await expect(page).toHaveURL(/\/fr\/app\/reecrire/);
  // Pro (la souscription Stripe est couverte par le parcours de la phase 1).
  await query(
    "insert into subscriptions (id, user_id, plan, status, updated_at) select 'sub-' || id, id, 'pro', 'active', now() from users where email = $1",
    [email],
  );

  // Base privée : un document de référence.
  await page.goto("/fr/app/plagiat");
  await page.getByRole("tab", { name: "Base privée" }).click();
  await page.getByLabel("Titre du document").fill("Mémoire 2024 de Léa");
  await page
    .getByLabel("Texte du document")
    .fill(`${PRIVATE} Selon trois enquêtes menées en 2023.`);
  await page.getByRole("button", { name: "Ajouter à ma base privée" }).click();
  await expect(page.getByText("Document ajouté à votre base privée.")).toBeVisible();

  // Analyse sur les deux périmètres.
  await page.getByRole("tab", { name: "Analyse" }).click();
  await typeInEditor(page, `${COPIED} ${FILLER} ${PRIVATE}`);
  await page.getByRole("button", { name: "Les deux" }).click();
  await page
    .getByRole("complementary", { name: "Analyse de plagiat" })
    .getByRole("button", { name: "Analyser" })
    .click();
  await expect(page.getByText("Similarité")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: "revue.example" })).toBeVisible();
  await expect(page.getByText("Mémoire 2024 de Léa")).toBeVisible();
  await expect(page.locator("mark")).toHaveCount(2);
  const used = await query<{ detection_words_used: number }>(
    "select detection_words_used from usage u join users x on x.id = u.user_id where x.email = $1",
    [email],
  );
  expect(used[0]?.detection_words_used).toBeGreaterThan(150);

  // Rapport PDF combiné.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter en PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^altydetect-analyse-\d{4}-\d{2}-\d{2}\.pdf$/);
  expect((await readFile(await download.path())).subarray(0, 5).toString()).toBe("%PDF-");

  // Historique : l'analyse de plagiat y figure.
  expect(
    await query(
      "select a.id from analyses a join documents d on d.id = a.document_id join users u on u.id = d.user_id where u.email = $1 and a.type = 'plagiarism'",
      [email],
    ),
  ).toHaveLength(1);
});
