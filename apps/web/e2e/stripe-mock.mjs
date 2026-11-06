// Stripe simulé pour les tests de bout en bout : API minimale (prix, Checkout, portail,
// abonnements, clients), pages de paiement et de portail factices, et webhooks signés envoyés à
// l'application avec le vrai format Stripe. Aucun appel réseau vers Stripe.
import { createServer } from "node:http";
import Stripe from "stripe";

const PORT = Number(process.env.STRIPE_MOCK_PORT ?? 12111);
const APP = process.env.APP_URL ?? "http://localhost:3200";
const SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_e2e";
const stripe = new Stripe("sk_test_mock");
const BASE = `http://localhost:${PORT}`;

const PRICES = {
  altydetect_pro_monthly: {
    id: "price_e2e_monthly",
    lookup_key: "altydetect_pro_monthly",
    interval: "month",
  },
  altydetect_pro_yearly: {
    id: "price_e2e_yearly",
    lookup_key: "altydetect_pro_yearly",
    interval: "year",
  },
};
const sessions = new Map();
const subscriptions = new Map(); // par client
let counter = 0;
// Identifiants uniques d'un lancement à l'autre (la base de test garde les précédents).
const RUN = Date.now().toString(36);
const nextId = (prefix) => `${prefix}_e2e_${RUN}_${++counter}`;

async function sendWebhook(type, object) {
  const payload = JSON.stringify({ id: nextId("evt"), object: "event", type, data: { object } });
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  const response = await fetch(`${APP}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "stripe-signature": header, "content-type": "application/json" },
    body: payload,
  });
  if (!response.ok) throw new Error(`webhook ${type} refusé : ${response.status}`);
}

function readBody(request) {
  return new Promise((resolve) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => resolve(new URLSearchParams(body)));
  });
}

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};
const html = (response, body) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Stripe simulé</title><body>${body}</body></html>`,
  );
};
const redirect = (response, location) => {
  response.writeHead(303, { location });
  response.end();
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", BASE);
  const path = url.pathname;
  try {
    // --- API ---
    if (request.method === "GET" && path === "/v1/prices") {
      const keys = url.searchParams
        .getAll("lookup_keys[]")
        .concat(url.searchParams.getAll("lookup_keys[0]"));
      return json(response, 200, {
        object: "list",
        data: keys.map((k) => PRICES[k]).filter(Boolean),
        has_more: false,
      });
    }
    if (request.method === "POST" && path === "/v1/checkout/sessions") {
      const form = await readBody(request);
      const id = nextId("cs");
      sessions.set(id, {
        id,
        price: form.get("line_items[0][price]"),
        userId: form.get("client_reference_id"),
        customer: form.get("customer") ?? nextId("cus"),
        success: form.get("success_url"),
        cancel: form.get("cancel_url"),
      });
      return json(response, 200, { id, object: "checkout.session", url: `${BASE}/checkout/${id}` });
    }
    const subscriptionMatch = /^\/v1\/subscriptions\/(.+)$/.exec(path);
    if (request.method === "GET" && subscriptionMatch) {
      const subscription = [...subscriptions.values()].find((s) => s.id === subscriptionMatch[1]);
      return subscription
        ? json(response, 200, subscription)
        : json(response, 404, {
            error: { type: "invalid_request_error", code: "resource_missing" },
          });
    }
    if (request.method === "POST" && path === "/v1/billing_portal/sessions") {
      const form = await readBody(request);
      const customer = form.get("customer");
      return json(response, 200, {
        object: "billing_portal.session",
        url: `${BASE}/portal/${customer}?return=${encodeURIComponent(form.get("return_url") ?? APP)}`,
      });
    }
    const customerMatch = /^\/v1\/customers\/(.+)$/.exec(path);
    if (request.method === "DELETE" && customerMatch) {
      subscriptions.delete(customerMatch[1]);
      return json(response, 200, { id: customerMatch[1], object: "customer", deleted: true });
    }

    // --- Page de paiement ---
    const checkoutMatch = /^\/checkout\/([^/]+)(\/pay)?$/.exec(path);
    if (checkoutMatch) {
      const session = sessions.get(checkoutMatch[1]);
      if (!session) return json(response, 404, {});
      if (request.method === "GET") {
        return html(
          response,
          `<h1>Paiement simulé</h1><p>Prix : ${session.price}</p>
          <form method="post" action="/checkout/${session.id}/pay"><button type="submit">Payer</button></form>
          <a href="${session.cancel}">Annuler</a>`,
        );
      }
      const price = Object.values(PRICES).find((p) => p.id === session.price);
      const subscription = {
        id: nextId("sub"),
        object: "subscription",
        customer: session.customer,
        status: "active",
        cancel_at_period_end: false,
        items: {
          object: "list",
          data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price }],
        },
      };
      subscriptions.set(session.customer, subscription);
      await sendWebhook("checkout.session.completed", {
        id: session.id,
        object: "checkout.session",
        mode: "subscription",
        client_reference_id: session.userId,
        customer: session.customer,
        subscription: subscription.id,
      });
      return redirect(response, session.success);
    }

    // --- Portail client ---
    const portalMatch = /^\/portal\/([^/]+)(\/cancel)?$/.exec(path);
    if (portalMatch) {
      const customer = portalMatch[1];
      const back = url.searchParams.get("return") ?? APP;
      if (request.method === "GET") {
        return html(
          response,
          `<h1>Portail client simulé</h1>
          <form method="post" action="/portal/${customer}/cancel?return=${encodeURIComponent(back)}"><button type="submit">Résilier l'abonnement</button></form>
          <a href="${back}">Retour</a>`,
        );
      }
      const subscription = subscriptions.get(customer);
      if (subscription) {
        subscription.cancel_at_period_end = true;
        await sendWebhook("customer.subscription.updated", subscription);
      }
      return redirect(response, back);
    }

    // --- Commande de test : fin de période (Stripe supprime l'abonnement résilié) ---
    const endMatch = /^\/__test\/end-period\/(.+)$/.exec(path);
    if (request.method === "POST" && endMatch) {
      const subscription = subscriptions.get(endMatch[1]);
      if (!subscription) return json(response, 404, {});
      subscription.status = "canceled";
      await sendWebhook("customer.subscription.deleted", subscription);
      subscriptions.delete(endMatch[1]);
      return json(response, 200, { ok: true });
    }
    if (path === "/__health") return json(response, 200, { ok: true });
    return json(response, 404, {
      error: { type: "invalid_request_error", message: `${request.method} ${path} non simulé` },
    });
  } catch (error) {
    return json(response, 500, { error: { message: String(error) } });
  }
});

server.listen(PORT, () => console.warn(`[stripe-mock] prêt sur ${BASE}`));
