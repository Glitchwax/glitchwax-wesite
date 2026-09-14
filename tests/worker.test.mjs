/**
 * Offline checks for src/worker.js — no network, no Cloudflare, no secrets.
 *
 * Run: node tests/worker.test.mjs
 *
 * Every outbound fetch is stubbed, so these assert the Worker's own rules:
 * the public-POST guard (A-12), the storefront RPC switch and its fallback
 * (A-13), SMS consent evidence (A-14), the Square webhook's failed-lookup
 * behaviour (A-49) and the visitor-hash salt (A-71).
 */

import assert from "node:assert/strict";
import worker from "../src/worker.js";

let failures = 0;
let passes = 0;

async function test(name, fn) {
  try {
    await fn();
    passes += 1;
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.message}`);
    return;
  }
  console.log(`ok    ${name}`);
}

const BASE_ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_test",
  SQUARE_ENVIRONMENT: "production",
  SQUARE_LOCATION_ID: "LOC",
  SQUARE_ACCESS_TOKEN: "square-token"
};

/** Records every fetch the Worker makes and answers from a routing table. */
function stubFetch(routes) {
  const calls = [];

  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const body = init.body ? JSON.parse(init.body) : null;

    calls.push({ url, body, headers: init.headers || {} });

    for (const [match, answer] of routes) {
      if (url.includes(match)) {
        const result = typeof answer === "function" ? answer(body) : answer;

        return new Response(JSON.stringify(result.body ?? {}), {
          status: result.status ?? 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    throw new Error(`Unexpected fetch to ${url}`);
  };

  return calls;
}

function makeCtx() {
  const pending = [];

  return {
    ctx: { waitUntil: (promise) => pending.push(promise) },
    settle: () => Promise.allSettled(pending)
  };
}

function post(path, body, headers = {}) {
  return new Request(`https://glitchwax.com${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

const SUBSCRIBE_BODY = { email: "rider@example.com", phone: "612-555-0134", smsConsent: true };

// --------------------------------------------------------------------------
// A-12 guard
// --------------------------------------------------------------------------

await test("A-12 text/plain POST is refused with 415", async () => {
  stubFetch([]);
  const request = new Request("https://glitchwax.com/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ kind: "review", rating: 5, name: "Rider" })
  });
  const response = await worker.fetch(request, { ...BASE_ENV }, makeCtx().ctx);

  assert.equal(response.status, 415);
});

await test("A-12 a cross-site Origin is refused with 403", async () => {
  stubFetch([]);
  const response = await worker.fetch(
    post("/api/subscribe", SUBSCRIBE_BODY, { Origin: "https://evil.example" }),
    { ...BASE_ENV },
    makeCtx().ctx
  );

  assert.equal(response.status, 403);
});

await test("A-12 the site's own Origin passes", async () => {
  stubFetch([["/rest/v1/subscribers", { status: 201 }]]);
  const response = await worker.fetch(
    post("/api/subscribe", SUBSCRIBE_BODY, { Origin: "https://glitchwax.com" }),
    { ...BASE_ENV },
    makeCtx().ctx
  );

  assert.equal(response.status, 200);
});

await test("A-12 over the rate limit answers 429", async () => {
  stubFetch([]);
  const env = { ...BASE_ENV, RL_FORMS: { limit: async () => ({ success: false }) } };
  const response = await worker.fetch(post("/api/contact", {}), env, makeCtx().ctx);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "60");
});

await test("A-12 checkout uses its own limiter and keys by route+IP", async () => {
  stubFetch([]);
  const keys = [];
  const env = {
    ...BASE_ENV,
    RL_CHECKOUT: {
      limit: async ({ key }) => {
        keys.push(key);
        return { success: false };
      }
    }
  };
  const request = new Request("https://glitchwax.com/api/create-checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: JSON.stringify({ stickOWaxWhiteQty: 1 })
  });
  const response = await worker.fetch(request, env, makeCtx().ctx);

  assert.equal(response.status, 429);
  assert.deepEqual(keys, ["checkout:203.0.113.9"]);
});

await test("A-12 no rate-limit binding = no limit (checkout still works)", async () => {
  const calls = stubFetch([
    [
      "/v2/online-checkout/payment-links",
      { body: { payment_link: { url: "https://square.link/x" } } }
    ],
    ["/rest/v1/site_visits", { status: 201 }]
  ]);
  const { ctx, settle } = makeCtx();
  const response = await worker.fetch(
    post("/api/create-checkout", { stickOWaxWhiteQty: 1 }),
    { ...BASE_ENV },
    ctx
  );
  await settle();

  assert.equal(response.status, 200);
  assert.equal((await response.json()).checkoutUrl, "https://square.link/x");
  assert.ok(calls.some((call) => call.url.includes("payment-links")));
});

await test("A-12 a GET keeps answering 405, not 415", async () => {
  stubFetch([]);
  const response = await worker.fetch(
    new Request("https://glitchwax.com/api/feedback"),
    { ...BASE_ENV },
    makeCtx().ctx
  );

  assert.equal(response.status, 405);
});

// --------------------------------------------------------------------------
// A-12 Turnstile
// --------------------------------------------------------------------------

await test("A-12 Turnstile: a missing token is refused when both keys are set", async () => {
  stubFetch([]);
  const env = {
    ...BASE_ENV,
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret"
  };
  const response = await worker.fetch(post("/api/subscribe", SUBSCRIBE_BODY), env, makeCtx().ctx);

  assert.equal(response.status, 400);
});

await test("A-12 Turnstile: half-configured never blocks a submission", async () => {
  stubFetch([["/rest/v1/subscribers", { status: 201 }]]);
  const env = { ...BASE_ENV, TURNSTILE_SITE_KEY: "site" };
  const response = await worker.fetch(post("/api/subscribe", SUBSCRIBE_BODY), env, makeCtx().ctx);

  assert.equal(response.status, 200);
});

await test("A-12 Turnstile: a verified token goes through", async () => {
  const calls = stubFetch([
    ["turnstile/v0/siteverify", { body: { success: true } }],
    ["/rest/v1/subscribers", { status: 201 }]
  ]);
  const env = {
    ...BASE_ENV,
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret"
  };
  const response = await worker.fetch(
    post("/api/subscribe", { ...SUBSCRIBE_BODY, turnstileToken: "token" }),
    env,
    makeCtx().ctx
  );

  assert.equal(response.status, 200);
  assert.ok(calls.some((call) => call.url.includes("siteverify")));
});

// --------------------------------------------------------------------------
// A-13 / A-14 storefront writes
// --------------------------------------------------------------------------

await test("A-13 with the secret set, writes go to the RPC", async () => {
  const calls = stubFetch([["/rest/v1/rpc/sf_subscribe", { status: 200, body: {} }]]);
  const env = { ...BASE_ENV, STOREFRONT_WRITE_SECRET: "shared" };
  const response = await worker.fetch(post("/api/subscribe", SUBSCRIBE_BODY), env, makeCtx().ctx);

  assert.equal(response.status, 200);
  const call = calls.find((entry) => entry.url.includes("rpc/sf_subscribe"));
  assert.ok(call, "sf_subscribe was not called");
  assert.equal(call.body.p_secret, "shared");
  assert.equal(call.body.p_row.email, "rider@example.com");
  assert.equal(call.body.p_row.phone, "+16125550134");
  assert.equal(typeof call.body.p_row.ip_hash, "string");
});

await test("A-14 SMS consent evidence rides along with the RPC row", async () => {
  const calls = stubFetch([["/rest/v1/rpc/sf_subscribe", { status: 200, body: {} }]]);
  const env = { ...BASE_ENV, STOREFRONT_WRITE_SECRET: "shared" };
  const request = new Request("https://glitchwax.com/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "TestBrowser/1.0" },
    body: JSON.stringify(SUBSCRIBE_BODY)
  });
  const response = await worker.fetch(request, env, makeCtx().ctx);
  const row = calls.find((entry) => entry.url.includes("sf_subscribe")).body.p_row;

  assert.equal(row.sms_consent, true);
  assert.equal(typeof row.sms_consent_at, "string");
  assert.equal(typeof row.consent_ip_hash, "string");
  assert.equal(row.consent_user_agent, "TestBrowser/1.0");
  assert.match(row.consent_text_version, /^\d{4}-\d{2}-\d{2}/);

  // And the reply must not claim the number is confirmed.
  const message = (await response.json()).message;
  assert.match(message, /confirm/i);
});

await test("A-14 no ticked box = no consent evidence", async () => {
  const calls = stubFetch([["/rest/v1/rpc/sf_subscribe", { status: 200, body: {} }]]);
  const env = { ...BASE_ENV, STOREFRONT_WRITE_SECRET: "shared" };
  await worker.fetch(
    post("/api/subscribe", { email: "rider@example.com" }),
    env,
    makeCtx().ctx
  );
  const row = calls.find((entry) => entry.url.includes("sf_subscribe")).body.p_row;

  assert.equal(row.sms_consent, false);
  assert.equal(row.consent_ip_hash, null);
  assert.equal(row.consent_text_version, null);
});

await test("A-13 a 404 from the RPC falls back to the direct insert", async () => {
  const calls = stubFetch([
    ["/rest/v1/rpc/sf_feedback", { status: 404, body: { code: "PGRST202" } }],
    ["/rest/v1/feedback", { status: 201 }]
  ]);
  const env = { ...BASE_ENV, STOREFRONT_WRITE_SECRET: "shared" };
  const response = await worker.fetch(
    post("/api/feedback", { kind: "review", rating: 5, name: "Rider", message: "It rips" }),
    env,
    makeCtx().ctx
  );

  assert.equal(response.status, 200);
  const insert = calls.find(
    (entry) => entry.url.endsWith("/rest/v1/feedback")
  );
  assert.ok(insert, "no fallback insert");
  // The extra columns do not exist until migration 057 — they must not be sent.
  assert.equal(insert.body.ip_hash, undefined);
  assert.equal(insert.body.rating, 5);
});

await test("A-13 without the secret nothing changes: direct insert only", async () => {
  const calls = stubFetch([["/rest/v1/feedback", { status: 201 }]]);
  const response = await worker.fetch(
    post("/api/feedback", { kind: "review", rating: 4, name: "Rider" }),
    { ...BASE_ENV },
    makeCtx().ctx
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith("/rest/v1/feedback"));
  assert.equal(calls[0].body.ip_hash, undefined);
});

await test("A-13 an RPC error other than 404 does NOT fall back", async () => {
  const calls = stubFetch([
    ["/rest/v1/rpc/sf_feedback", { status: 403, body: { message: "bad secret" } }]
  ]);
  const env = { ...BASE_ENV, STOREFRONT_WRITE_SECRET: "wrong" };
  const response = await worker.fetch(
    post("/api/feedback", { kind: "review", rating: 5, name: "Rider" }),
    env,
    makeCtx().ctx
  );

  assert.equal(response.status, 500);
  assert.equal(calls.length, 1);
});

await test("A-13 a duplicate subscriber reads as 'already on the list'", async () => {
  stubFetch([["/rest/v1/rpc/sf_subscribe", { status: 200, body: { duplicate: true } }]]);
  const env = { ...BASE_ENV, STOREFRONT_WRITE_SECRET: "shared" };
  const response = await worker.fetch(post("/api/subscribe", SUBSCRIBE_BODY), env, makeCtx().ctx);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.message, /already/i);
});

await test("A-13 page views go through sf_log_visit with an ip_hash", async () => {
  const calls = stubFetch([["/rest/v1/rpc/sf_log_visit", { status: 200, body: {} }]]);
  const env = {
    ...BASE_ENV,
    STOREFRONT_WRITE_SECRET: "shared",
    ASSETS: {
      fetch: async () =>
        new Response("<html><head></head><body></body></html>", {
          headers: { "Content-Type": "text/html" }
        })
    }
  };
  const { ctx, settle } = makeCtx();
  await worker.fetch(new Request("https://glitchwax.com/store?ref=magic.meeks"), env, ctx);
  await settle();

  const call = calls.find((entry) => entry.url.includes("sf_log_visit"));
  assert.ok(call, "sf_log_visit was not called");
  assert.equal(call.body.p_row.ref, "magic.meeks");
  assert.equal(typeof call.body.p_row.ip_hash, "string");
});

// --------------------------------------------------------------------------
// A-71 visitor hash salt
// --------------------------------------------------------------------------

await test("A-71 VISITOR_HASH_SALT changes the hash; without it the old one stands", async () => {
  async function hashWith(env) {
    const calls = stubFetch([["/rest/v1/site_visits", { status: 201 }]]);
    const { ctx, settle } = makeCtx();
    const request = new Request("https://glitchwax.com/", {
      headers: { "CF-Connecting-IP": "198.51.100.4", "User-Agent": "TestBrowser/1.0" }
    });
    await worker.fetch(
      request,
      {
        ...env,
        ASSETS: {
          fetch: async () =>
            new Response("<html></html>", { headers: { "Content-Type": "text/html" } })
        }
      },
      ctx
    );
    await settle();

    return calls.find((entry) => entry.url.includes("site_visits")).body.visitor_hash;
  }

  const legacy = await hashWith({ ...BASE_ENV });
  const sameAgain = await hashWith({ ...BASE_ENV });
  const dedicated = await hashWith({ ...BASE_ENV, VISITOR_HASH_SALT: "dedicated-salt" });

  assert.equal(legacy, sameAgain);
  assert.notEqual(legacy, dedicated);
  assert.equal(legacy.length, 32);
});

// --------------------------------------------------------------------------
// A-49 Square webhook
// --------------------------------------------------------------------------

const WEBHOOK_KEY = "webhook-signature-key";

async function signedWebhookRequest(payload) {
  const rawBody = JSON.stringify(payload);
  const url = "https://glitchwax.com/api/square-webhook";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(url + rawBody)
  );
  const header = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-square-hmacsha256-signature": header
    },
    body: rawBody
  });
}

const PAID_EVENT = {
  type: "payment.updated",
  data: { object: { payment: { id: "pay_1", order_id: "ord_1", status: "COMPLETED" } } }
};

await test("A-49 a failed order lookup announces nothing and still answers 200", async () => {
  const calls = stubFetch([
    ["/v2/orders/ord_1", { status: 500, body: { errors: [{ code: "INTERNAL" }] } }],
    ["/api/notify", { status: 200 }]
  ]);
  const env = {
    ...BASE_ENV,
    SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
    NOTIFY_RELAY_SECRET: "relay"
  };
  const { ctx, settle } = makeCtx();
  const response = await worker.fetch(await signedWebhookRequest(PAID_EVENT), env, ctx);
  await settle();

  assert.equal(response.status, 200);
  assert.ok(!calls.some((call) => call.url.includes("/api/notify")), "relay was called anyway");
});

await test("A-49 an empty order body announces nothing", async () => {
  const calls = stubFetch([
    ["/v2/orders/ord_1", { status: 200, body: {} }],
    ["/api/notify", { status: 200 }]
  ]);
  const env = {
    ...BASE_ENV,
    SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
    NOTIFY_RELAY_SECRET: "relay"
  };
  const { ctx, settle } = makeCtx();
  await worker.fetch(await signedWebhookRequest(PAID_EVENT), env, ctx);
  await settle();

  assert.ok(!calls.some((call) => call.url.includes("/api/notify")));
});

await test("A-12 the order text carries no customer-written text", async () => {
  const calls = stubFetch([
    [
      "/v2/orders/ord_1",
      {
        status: 200,
        body: {
          order: {
            total_money: { amount: 1695 },
            line_items: [{ quantity: "1", name: "Stick O Wax" }],
            reference_id: "magic.meeks",
            fulfillments: [
              {
                shipment_details: {
                  recipient: { display_name: "Jane Customer", address_line_1: "1 Main St" }
                }
              }
            ],
            service_charges: [{ name: "Shipping", total_money: { amount: 595 } }]
          }
        }
      }
    ],
    ["/api/notify", { status: 200 }]
  ]);
  const env = {
    ...BASE_ENV,
    SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
    NOTIFY_RELAY_SECRET: "relay"
  };
  const { ctx, settle } = makeCtx();
  await worker.fetch(await signedWebhookRequest(PAID_EVENT), env, ctx);
  await settle();

  const notify = calls.find((call) => call.url.includes("/api/notify"));
  assert.ok(notify, "relay was not called");
  assert.equal(notify.body.title, "New order $16.95");
  assert.ok(!/Jane Customer/.test(notify.body.body), "buyer name is in the text");
  assert.ok(!/Main St/.test(notify.body.body), "address is in the text");
  assert.match(notify.body.body, /Stick O Wax/);
  assert.equal(notify.body.dedupe_key, "order:ord_1");
});

await test("A-49 a bad signature is rejected before any lookup", async () => {
  const calls = stubFetch([]);
  const env = { ...BASE_ENV, SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY };
  const request = new Request("https://glitchwax.com/api/square-webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-square-hmacsha256-signature": "nope"
    },
    body: JSON.stringify(PAID_EVENT)
  });
  const response = await worker.fetch(request, env, makeCtx().ctx);

  assert.equal(response.status, 401);
  assert.equal(calls.length, 0);
});

console.log(`\n${passes} passed, ${failures} failed`);

if (failures > 0) {
  process.exit(1);
}
