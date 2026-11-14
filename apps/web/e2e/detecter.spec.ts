import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { closeHelpers, localePath, query, signUp, typeInEditor } from "./helpers";

// Phase 3 : détection (fournisseur simulé), résultat en probabilité, analyse approfondie (Pro),
// rapport PDF, historique.

test.afterAll(closeHelpers);

const SENTENCES = [
  "Les enseignants observent une progression nette des élèves au cours de l'année.",
  "Cette évolution tient surtout à la régularité des retours qu'ils reçoivent.",
  "Chaque semaine, un court bilan permet de corriger les méthodes de travail.",
  "Les familles disent mieux comprendre les attentes de l'école grâce à ces bilans.",
  "Il reste toutefois des écarts importants entre les établissements étudiés.",
];
// 20 phrases, environ 240 mots.
const TEXT = Array.from({ length: 20 }, (_, i) => SENTENCES[i % SENTENCES.length]).join(" ");
const BANDS = /^(Probablement IA|Indéterminé|Probablement humain)$/;

test("détection d'un texte, analyse approfondie, rapport PDF et historique", async ({ page }) => {
  const email = await signUp(page, "fr", "e2e-detecter");
  await page.goto(localePath("fr", "/app/detecter"));
  await expect(page.getByRole("heading", { name: "Détecter" })).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Résultat de la détection" });

  // Moins de 150 mots : aucun score.
  await typeInEditor(page, SENTENCES.join(" "));
  await panel.getByRole("button", { name: "Analyser" }).click();
  await expect(panel.getByRole("alert")).toContainText("au moins 150 mots");
  await expect(page.getByTestId("verdict-band")).toHaveCount(0);

  // Analyse approfondie réservée à Pro.
  await expect(panel.getByRole("button", { name: "Approfondie" })).toBeDisabled();

  // Texte suffisant : probabilité, confiance, répartition, mise en garde, phrases colorées.
  await typeInEditor(page, TEXT);
  await panel.getByRole("button", { name: "Analyser" }).click();
  await expect(page.getByTestId("verdict-band")).toHaveText(BANDS, { timeout: 30_000 });
  await expect(panel.getByText(/^Confiance : (élevée|moyenne|faible)$/)).toBeVisible();
  await expect(page.getByTestId("detect-disclaimer")).toHaveText(
    "Un détecteur donne une probabilité, pas une preuve. Ce résultat doit être croisé avec d'autres éléments avant toute décision.",
  );
  await expect(panel.getByText("Moteur partenaire")).toBeVisible();
  await expect(page.locator("mark[data-band]")).toHaveCount(20);
  const used = await query<{ detection_words_used: number }>(
    "select detection_words_used from usage u join users x on x.id = u.user_id where x.email = $1",
    [email],
  );
  expect(used[0]?.detection_words_used).toBeGreaterThan(200);

  // Pro : analyse approfondie (deux avis), puis rapport PDF.
  await query(
    "insert into subscriptions (id, user_id, plan, status, updated_at) select 'sub-' || id, id, 'pro', 'active', now() from users where email = $1",
    [email],
  );
  await page.reload();
  await typeInEditor(page, TEXT);
  await panel.getByRole("button", { name: "Approfondie" }).click();
  await panel.getByRole("button", { name: "Analyser" }).click();
  await expect(page.getByTestId("verdict-band")).toHaveText(BANDS, { timeout: 30_000 });
  await expect(panel.getByText("VRT-DET-FR-E2E")).toBeVisible();
  await expect(panel.getByText("Accord entre les moteurs")).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Exporter en PDF" }).click();
  const download = await downloadPromise;
  expect((await readFile(await download.path())).subarray(0, 5).toString()).toBe("%PDF-");

  // Historique : deux détections, sans le texte (keep_text non demandé), comparaison
  // enregistrée sans le texte.
  const rows = await query<{ text: string | null }>(
    "select d.text from analyses a join documents d on d.id = a.document_id join users u on u.id = d.user_id where u.email = $1 and a.type = 'detect'",
    [email],
  );
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.text === null)).toBe(true);
  await page.goto("/fr/app/historique?type=detect");
  await expect(page.getByRole("cell", { name: "Détection" })).toHaveCount(2);
});

test("English interface: result states are translated", async ({ page }) => {
  // Inscription complète avant d'ouvrir Détecter : sans attendre la page « vérifiez votre
  // boîte » ni l'espace connecté, le lien pouvait être ouvert avant l'écriture du jeton et la
  // page affichait le formulaire de connexion (échec intermittent en CI).
  await signUp(page, "en", "e2e-detect-en");
  await page.goto(localePath("en", "/app/detecter"));
  await typeInEditor(page, TEXT);
  await page
    .getByRole("complementary", { name: "Detection result" })
    .getByRole("button", { name: "Analyze" })
    .click();
  await expect(page.getByTestId("verdict-band")).toHaveText(
    /^(Likely AI|Undetermined|Likely human)$/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("detect-disclaimer")).toContainText("not proof");
});
