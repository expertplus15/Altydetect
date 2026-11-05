import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  closeHelpers,
  magicLink,
  query,
  resetTrialLimits,
  typeInEditor,
  uniqueEmail,
} from "./helpers";

// Porte de sortie de la phase 1 : essai sans compte → inscription → réécriture → passage à Pro
// (Stripe en mode test, simulé) → export PDF → résiliation, en français puis en anglais.

test.beforeAll(resetTrialLimits);
test.afterAll(closeHelpers);

const TEXT_FR =
  "Les résultats de l'enquête montrent que la méthode est vraiment très efficace. " +
  "Comme le dit « l'évaluation change tout » (Durand, 2021), le gain atteint 32 %.";

test("parcours complet en français", async ({ page }) => {
  const email = uniqueEmail("e2e-fr");

  // 1. Essai sans compte sur la page d'accueil.
  await page.goto("/fr");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Améliorez le style");
  await page
    .getByRole("complementary", { name: "Réglages de réécriture" })
    .getByRole("button", { name: "Réécrire" })
    .click();
  await expect(
    page.getByText("Créez un compte gratuit pour enregistrer ce résultat"),
  ).toBeVisible();

  // 2. Inscription par lien magique, puis enregistrement du résultat de l'essai.
  await page.getByRole("link", { name: "Créer un compte gratuit" }).click();
  await expect(page).toHaveURL(/\/fr\/inscription/);
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByRole("button", { name: "Recevoir le lien" }).click();
  await expect(page).toHaveURL(/\/fr\/connexion\/verifier/);
  await page.goto(await magicLink(email));
  await expect(page).toHaveURL(/\/fr\/app\/reecrire/);
  await page.getByRole("button", { name: "Enregistrer dans l'historique" }).click();
  await expect(page.getByRole("button", { name: "Enregistrer dans l'historique" })).toBeHidden();
  expect(
    await query(
      "select d.id from documents d join users u on u.id = d.user_id where u.email = $1",
      [email],
    ),
  ).toHaveLength(1);

  // 3. Réécriture dans l'espace connecté (Gratuit : une proposition, citations protégées).
  await typeInEditor(page, TEXT_FR);
  await page.getByRole("button", { name: "Professionnel" }).click();
  await page
    .getByRole("complementary", { name: "Réglages de réécriture" })
    .getByRole("button", { name: "Réécrire" })
    .click();
  const proposal = page.getByRole("region", { name: "Proposition" });
  await expect(proposal.locator("mark")).toHaveText([
    "« l'évaluation change tout »",
    "(Durand, 2021)",
    "32 %",
  ]);
  await expect(page.getByText("2 réécritures restantes aujourd'hui")).toBeVisible();

  // 4. Passage à Pro (mensuel) via Stripe Checkout.
  await page.goto("/fr/tarifs");
  await page.getByRole("button", { name: "Mensuel" }).click();
  await expect(page.getByText("9,99 €")).toBeVisible();
  await page.getByRole("button", { name: "Passer à Pro" }).click();
  await expect(page.getByRole("heading", { name: "Paiement simulé" })).toBeVisible();
  await page.getByRole("button", { name: "Payer" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/compte\?checkout=success/);
  await expect(page.getByText("Bienvenue dans Pro")).toBeVisible();
  await expect(page.getByText("(mensuel)")).toBeVisible();

  // 5. Réécriture Pro (3 propositions) puis export PDF.
  await page.goto("/fr/app/reecrire");
  await typeInEditor(page, TEXT_FR);
  await page.getByLabel("Nombre de propositions").selectOption("3");
  await page
    .getByRole("complementary", { name: "Réglages de réécriture" })
    .getByRole("button", { name: "Réécrire" })
    .click();
  await expect(page.getByText("Proposition 1 / 3")).toBeVisible();
  await page.getByRole("button", { name: "Proposition suivante" }).click();
  await expect(page.getByText("Proposition 2 / 3")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter en PDF" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^altydetect-reecriture-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdf = await readFile(await download.path());
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

  // 6. Résiliation en un clic depuis le portail client, puis fin de période.
  await page.goto("/fr/app/compte");
  await page.getByRole("button", { name: "Gérer l'abonnement et les factures" }).click();
  await page.getByRole("button", { name: "Résilier l'abonnement" }).click();
  await expect(page).toHaveURL(/\/fr\/app\/compte/);
  await expect(page.getByText(/Résilié\s*: Pro reste actif jusqu'au/)).toBeVisible();
  const rows = await query<{ stripe_customer_id: string }>(
    "select s.stripe_customer_id from subscriptions s join users u on u.id = s.user_id where u.email = $1",
    [email],
  );
  const customer = rows[0]?.stripe_customer_id ?? "";
  await fetch(`http://localhost:12111/__test/end-period/${customer}`, { method: "POST" });
  await page.reload();
  await expect(page.getByText("Gratuit", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Passer à Pro" }).first()).toBeVisible();
});

test("parcours en anglais", async ({ page }) => {
  const email = uniqueEmail("e2e-en");
  await page.goto("/en/sign-up");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send me the link" }).click();
  await expect(page).toHaveURL(/\/en\/sign-in\/check-email/);
  await page.goto(await magicLink(email));
  await expect(page).toHaveURL(/\/en\/app\/rewrite/);
  expect(
    (await query<{ locale: string }>("select locale from users where email = $1", [email]))[0]
      ?.locale,
  ).toBe("en");

  await typeInEditor(
    page,
    "The results of the survey show that the method is really effective, with a 32% gain.",
  );
  await page
    .getByRole("complementary", { name: "Rewrite settings" })
    .getByRole("button", { name: "Rewrite" })
    .click();
  await expect(page.getByRole("region", { name: "Suggestion" })).toContainText(
    "The results of the survey",
  );

  await page.goto("/en/pricing");
  await page.getByRole("button", { name: "Upgrade to Pro" }).click();
  await page.getByRole("button", { name: "Payer" }).click();
  await expect(page).toHaveURL(/\/en\/app\/account\?checkout=success/);
  await expect(page.getByText("Welcome to Pro")).toBeVisible();
  await page.getByRole("button", { name: "Manage subscription and invoices" }).click();
  await page.getByRole("button", { name: "Résilier l'abonnement" }).click();
  await expect(page.getByText(/Cancelled: Pro stays active until/)).toBeVisible();
});
