const STICK_O_WAX_WHITE_VARIATION_ID = "J4L4WTWW4JO7UTEHUYQVR7LZ";
const STICK_O_WAX_BLACK_VARIATION_ID = "RFCS5LTZIC5TPJLRQZJUSCJN";

const DOUBLE_PACK_WHITE_VARIATION_ID = "ZWBSYUZ6PGFILSV5S5BZ7BFG";
const DOUBLE_PACK_BLUE_RED_VARIATION_ID = "3BC6J4JGF7YPNFI5X7M7M3VT";
const DOUBLE_PACK_YELLOW_VARIATION_ID = "25BFW2NOMJ3OCMXQNPCBTBM6";

// Attribution + first-party analytics (2026-09-12).
//
// ?ref=<code> on ANY inbound link (a rider's handle, a campaign code) is kept
// in a first-party cookie for 30 days and carried into the Square order as
// reference_id, so the dashboard can credit the sale. Every HTML page view and
// every checkout start is also recorded server-side into Supabase
// (site_visits, insert-only publishable key) — no client script, no third-party
// tag, no consent banner. If Supabase is unreachable the page still serves;
// logging never blocks or fails a request.
const REF_COOKIE = "gw_ref";
const REF_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const REF_PATTERN = /^[a-z0-9_.-]{1,40}$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-checkout") {
      return handleCreateCheckout(request, env, ctx);
    }

    if (url.pathname === "/api/contact") {
      return handleContactForm(request, env);
    }

    if (url.pathname === "/api/subscribe") {
      return handleSubscribe(request, env);
    }

    if (url.pathname === "/api/square-webhook") {
      return handleSquareWebhook(request, env, ctx);
    }

    const response = await env.ASSETS.fetch(request);

    if (!isHtmlNavigation(request, response)) {
      return response;
    }

    const ref = sanitizeRef(url.searchParams.get("ref"));

    ctx.waitUntil(logPageView(request, env, url, ref));

    if (!ref) {
      return response;
    }

    const withCookie = new Response(response.body, response);
    withCookie.headers.append(
      "Set-Cookie",
      `${REF_COOKIE}=${ref}; Max-Age=${REF_MAX_AGE_SECONDS}; Path=/; SameSite=Lax; Secure`
    );
    return withCookie;
  }
};

function sanitizeRef(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().replace(/^@/, "").toLowerCase();

  return REF_PATTERN.test(cleaned) ? cleaned : null;
}

function readCookie(request, name) {
  const header = request.headers.get("Cookie") || "";

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");

    if (key === name) {
      return rest.join("=");
    }
  }

  return null;
}

// Only top-level HTML navigations count as a visit — not asset fetches, not
// prefetches, not API calls.
function isHtmlNavigation(request, response) {
  if (request.method !== "GET" || !response.ok) {
    return false;
  }

  const contentType = response.headers.get("Content-Type") || "";

  if (!contentType.includes("text/html")) {
    return false;
  }

  const dest = request.headers.get("Sec-Fetch-Dest");

  return !dest || dest === "document";
}

const BOT_PATTERN =
  /bot|crawl|spider|slurp|preview|fetch|headless|python|curl|wget|lighthouse|pingdom|monitor|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|quora|outbrain|pinterest|vkshare|w3c_validator|apache-httpclient|okhttp|go-http-client|java\//i;

function classifyDevice(userAgent) {
  if (!userAgent) {
    return "other";
  }

  if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry/i.test(userAgent)) {
    return "mobile";
  }

  if (/ipad|android|tablet|macintosh|windows nt|x11|linux|cros/i.test(userAgent)) {
    return "desktop";
  }

  return "other";
}

// Salted daily hash of IP + user agent: lets the dashboard count unique
// visitors per day without storing either value, and cannot be reversed.
async function visitorHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";
  const day = new Date().toISOString().slice(0, 10);
  // An existing Worker secret doubles as the salt: it is never stored, only
  // hashed, and SHA-256 output cannot be turned back into it.
  const salt = env.VISITOR_SALT || env.SQUARE_ACCESS_TOKEN || "glitchwax";

  const data = new TextEncoder().encode(`${salt}|${day}|${ip}|${userAgent}`);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

function clip(value, maxLength) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  return value.slice(0, maxLength);
}

function referrerHost(referrer) {
  if (!referrer) {
    return null;
  }

  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");

    return host === "glitchwax.com" ? null : host;
  } catch (error) {
    return null;
  }
}

function normalizePath(pathname) {
  const path = pathname.replace(/\.html$/, "").replace(/\/index$/, "/");

  return path || "/";
}

async function logPageView(request, env, url, ref) {
  const userAgent = request.headers.get("User-Agent") || "";
  const referrer = request.headers.get("Referer") || "";
  const params = url.searchParams;

  return logVisit(env, {
    kind: "pageview",
    path: clip(normalizePath(url.pathname), 200),
    referrer_host: referrerHost(referrer),
    referrer: clip(referrer, 500),
    utm_source: clip(params.get("utm_source"), 100),
    utm_medium: clip(params.get("utm_medium"), 100),
    utm_campaign: clip(params.get("utm_campaign"), 100),
    utm_content: clip(params.get("utm_content"), 100),
    ref: ref || sanitizeRef(readCookie(request, REF_COOKIE)),
    country: clip(request.cf && request.cf.country, 2),
    device: classifyDevice(userAgent),
    is_bot: BOT_PATTERN.test(userAgent),
    visitor_hash: await visitorHash(request, env)
  });
}

async function logVisit(env, row) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return;
  }

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/site_visits`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });

    if (!response.ok) {
      console.error("site_visits insert failed.", {
        status: response.status,
        body: (await response.text()).slice(0, 300)
      });
    }
  } catch (error) {
    console.error("site_visits insert error.", {
      message: error.message
    });
  }
}

async function handleContactForm(request, env) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405 }
    );
  }

  try {
    const missingConfig = [];

    if (!env.CONTACT_EMAIL) {
      missingConfig.push("CONTACT_EMAIL binding");
    }

    if (!env.CONTACT_FROM_EMAIL) {
      missingConfig.push("CONTACT_FROM_EMAIL variable");
    }

    if (!env.CONTACT_TO_EMAIL) {
      missingConfig.push("CONTACT_TO_EMAIL variable");
    }

    if (missingConfig.length > 0) {
      console.error("Missing contact form configuration.", {
        missing: missingConfig
      });

      return Response.json(
        { error: "Contact form is not configured yet." },
        { status: 500 }
      );
    }

    const body = await request.json();

    const validation = validateContactSubmission(body);

    if (!validation.isValid) {
      return Response.json(
        { error: validation.message },
        { status: 400 }
      );
    }

    const contact = validation.contact;

    const emailSubject = "New Glitch Wax contact form message";

    const emailBody =
`New message from the Glitch Wax website contact form.

Name:
${contact.name}

Email:
${contact.email}

Phone:
${contact.phone}

Comment:
${contact.comment}

Submitted:
${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} Central Time`;

    await env.CONTACT_EMAIL.send({
      to: env.CONTACT_TO_EMAIL,
      from: env.CONTACT_FROM_EMAIL,
      subject: emailSubject,
      replyTo: contact.email,
      text: emailBody
    });

    return Response.json({
      success: true
    });
  } catch (error) {
    console.error("Contact form error.", {
      message: error.message
    });

    return Response.json(
      { error: "Message could not be sent. Please try again later." },
      { status: 500 }
    );
  }
}

function validateContactSubmission(body) {
  if (!body || typeof body !== "object") {
    return {
      isValid: false,
      message: "Invalid form submission."
    };
  }

  const name = cleanText(body.name, 60);
  const email = cleanText(body.email, 120);
  const phone = cleanText(body.phone, 18);
  const comment = cleanText(body.comment, 500);

  if (!name) {
    return {
      isValid: false,
      message: "Please enter your name."
    };
  }

  if (name.length < 2) {
    return {
      isValid: false,
      message: "Name must be at least 2 characters."
    };
  }

  const namePattern = /^[a-zA-Z\s.'-]+$/;

  if (!namePattern.test(name)) {
    return {
      isValid: false,
      message: "Name contains invalid characters."
    };
  }

  if (!email) {
    return {
      isValid: false,
      message: "Please enter your email address."
    };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (!emailPattern.test(email)) {
    return {
      isValid: false,
      message: "Enter a valid email address."
    };
  }

  if (!phone) {
    return {
      isValid: false,
      message: "Please enter your phone number."
    };
  }

  const digitsOnly = phone.replace(/\D/g, "");
  let normalizedDigits = digitsOnly;

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    normalizedDigits = digitsOnly.slice(1);
  }

  if (normalizedDigits.length !== 10) {
    return {
      isValid: false,
      message: "Enter a valid 10-digit phone number."
    };
  }

  const areaCode = normalizedDigits.slice(0, 3);
  const centralOffice = normalizedDigits.slice(3, 6);

  if (areaCode[0] === "0" || areaCode[0] === "1") {
    return {
      isValid: false,
      message: "Area code is not valid."
    };
  }

  if (centralOffice[0] === "0" || centralOffice[0] === "1") {
    return {
      isValid: false,
      message: "Phone number is not valid."
    };
  }

  if (/^(\d)\1+$/.test(normalizedDigits)) {
    return {
      isValid: false,
      message: "Phone number cannot be all the same digit."
    };
  }

  if (!comment) {
    return {
      isValid: false,
      message: "Please enter a comment."
    };
  }

  if (comment.length < 10) {
    return {
      isValid: false,
      message: "Comment is too short."
    };
  }

  if (comment.length > 500) {
    return {
      isValid: false,
      message: "Comment is too long."
    };
  }

  return {
    isValid: true,
    contact: {
      name,
      email,
      phone,
      comment
    }
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function handleCreateCheckout(request, env, ctx) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405 }
    );
  }

  try {
    const body = await request.json();

    const stickOWaxWhiteQty = getValidQuantity(body.stickOWaxWhiteQty);
    const stickOWaxBlackQty = getValidQuantity(body.stickOWaxBlackQty);

    const doublePackWhiteQty = getValidQuantity(body.doublePackWhiteQty);
    const doublePackBlueRedQty = getValidQuantity(body.doublePackBlueRedQty);
    const doublePackYellowQty = getValidQuantity(body.doublePackYellowQty);

    const quantities = [
      stickOWaxWhiteQty,
      stickOWaxBlackQty,
      doublePackWhiteQty,
      doublePackBlueRedQty,
      doublePackYellowQty
    ];

    if (quantities.some((quantity) => quantity === null)) {
      return Response.json(
        { error: "Please select a valid quantity." },
        { status: 400 }
      );
    }

    const stickOWaxTotal = stickOWaxWhiteQty + stickOWaxBlackQty;
    const doublePackTotal =
      doublePackWhiteQty +
      doublePackBlueRedQty +
      doublePackYellowQty;

    if (stickOWaxTotal === 0 && doublePackTotal === 0) {
      return Response.json(
        { error: "Your cart is empty." },
        { status: 400 }
      );
    }

    if (stickOWaxTotal > 5) {
      return Response.json(
        { error: "You can select up to 5 total Stick O Wax per order." },
        { status: 400 }
      );
    }

    if (doublePackTotal > 5) {
      return Response.json(
        { error: "You can select up to 5 total Two Packs per order." },
        { status: 400 }
      );
    }

    const lineItems = [];

    addLineItem(
      lineItems,
      STICK_O_WAX_WHITE_VARIATION_ID,
      stickOWaxWhiteQty
    );

    addLineItem(
      lineItems,
      STICK_O_WAX_BLACK_VARIATION_ID,
      stickOWaxBlackQty
    );

    addLineItem(
      lineItems,
      DOUBLE_PACK_WHITE_VARIATION_ID,
      doublePackWhiteQty
    );

    addLineItem(
      lineItems,
      DOUBLE_PACK_BLUE_RED_VARIATION_ID,
      doublePackBlueRedQty
    );

    addLineItem(
      lineItems,
      DOUBLE_PACK_YELLOW_VARIATION_ID,
      doublePackYellowQty
    );

    // Attribution: the ref code the buyer arrived with (cookie set by the
    // page handler, or sent explicitly by the store page). Square keeps it as
    // the order's reference_id, which the dashboard sync already captures.
    const ref =
      sanitizeRef(body.ref) || sanitizeRef(readCookie(request, REF_COOKIE));

    const order = {
      location_id: env.SQUARE_LOCATION_ID,
      line_items: lineItems,
      pricing_options: {
        auto_apply_taxes: true
      }
    };

    if (ref) {
      order.reference_id = ref;
    }

    const squareBaseUrl =
      env.SQUARE_ENVIRONMENT === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const checkoutOptions = {
      ask_for_shipping_address: true,
      redirect_url: "https://glitchwax.com/order-success.html"
    };

    // Flat shipping charged to the customer, in cents, from wrangler.jsonc
    // (SHIPPING_FEE_CENTS). Set explicitly here so the rate is decided in one
    // place and cannot drift below what carriers actually charge us.
    const shippingFeeCents = Number.parseInt(env.SHIPPING_FEE_CENTS || "0", 10);

    if (Number.isInteger(shippingFeeCents) && shippingFeeCents > 0) {
      checkoutOptions.shipping_fee = {
        name: "Shipping",
        charge: {
          amount: shippingFeeCents,
          currency: "USD"
        }
      };
    }

    const squareRequestBody = {
      idempotency_key: crypto.randomUUID(),
      order,
      checkout_options: checkoutOptions
    };

    const squareResponse = await fetch(
      `${squareBaseUrl}/v2/online-checkout/payment-links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "Square-Version": "2025-04-16"
        },
        body: JSON.stringify(squareRequestBody)
      }
    );

    const squareResponseText = await squareResponse.text();

    let squareData;

    try {
      squareData = JSON.parse(squareResponseText);
    } catch (parseError) {
      squareData = null;
    }

    if (!squareResponse.ok) {
      console.error("Square checkout creation failed.", {
        status: squareResponse.status,
        response: squareData || squareResponseText
      });

      return Response.json(
        { error: "Checkout could not be created. Please try again." },
        { status: 500 }
      );
    }

    if (
      !squareData ||
      !squareData.payment_link ||
      !squareData.payment_link.url
    ) {
      console.error("Square checkout response missing payment link.", {
        response: squareData || squareResponseText
      });

      return Response.json(
        { error: "Checkout could not be created. Please try again." },
        { status: 500 }
      );
    }

    const cartSummary = [
      [stickOWaxTotal, "Stick O Wax"],
      [doublePackTotal, "Two Pack"]
    ]
      .filter(([quantity]) => quantity > 0)
      .map(([quantity, name]) => `${quantity}x ${name}`)
      .join(" + ");

    ctx.waitUntil(
      (async () =>
        logVisit(env, {
          kind: "checkout_start",
          path: "/api/create-checkout",
          ref,
          country: clip(request.cf && request.cf.country, 2),
          device: classifyDevice(request.headers.get("User-Agent") || ""),
          is_bot: false,
          visitor_hash: await visitorHash(request, env),
          detail: {
            items: cartSummary,
            subtotal: stickOWaxTotal * 8.5 + doublePackTotal * 10
          }
        }))()
    );

    return Response.json({
      checkoutUrl: squareData.payment_link.url
    });
  } catch (error) {
    console.error("Checkout function error.", {
      message: error.message
    });

    return Response.json(
      { error: "Checkout could not be created. Please try again." },
      { status: 500 }
    );
  }
}

function getValidQuantity(value) {
  const quantity = Number(value || 0);

  if (!Number.isInteger(quantity)) {
    return null;
  }

  if (quantity < 0 || quantity > 5) {
    return null;
  }

  return quantity;
}

function addLineItem(lineItems, catalogObjectId, quantity) {
  if (quantity > 0) {
    lineItems.push({
      catalog_object_id: catalogObjectId,
      quantity: String(quantity)
    });
  }
}

// ---------------------------------------------------------------------------
// Email / SMS signup (biz-3). Inserts into Supabase `subscribers` with the
// publishable key under an insert-only policy (glitch-brain migration 041).
// Email is required, phone optional; the SMS box is real consent and is the
// only way sms_consent becomes true.
// ---------------------------------------------------------------------------
async function handleSubscribe(request, env) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return Response.json({ error: "Signup is not configured yet." }, { status: 500 });
  }

  let body;

  try {
    body = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid submission." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid submission." }, { status: 400 });
  }

  // Honeypot: real people never fill a field they cannot see.
  if (cleanText(body.website, 10)) {
    return Response.json({ success: true, message: "You're on the list." });
  }

  const email = cleanText(body.email, 254).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (!email || !emailPattern.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const rawPhone = cleanText(body.phone, 24);
  const phone = normalizeUsPhone(rawPhone);

  if (rawPhone && !phone) {
    return Response.json(
      { error: "Enter a valid 10-digit US phone number, or leave it blank." },
      { status: 400 }
    );
  }

  const smsConsent = body.smsConsent === true && Boolean(phone);
  const url = new URL(request.url);
  const referer = request.headers.get("Referer") || "";
  let sourcePath = null;
  let utmSource = null;
  let utmCampaign = null;

  try {
    const from = new URL(referer);
    sourcePath = clip(normalizePath(from.pathname), 200);
    utmSource = clip(from.searchParams.get("utm_source"), 100);
    utmCampaign = clip(from.searchParams.get("utm_campaign"), 100);
  } catch (error) {
    sourcePath = clip(normalizePath(url.pathname), 200);
  }

  const row = {
    email,
    phone,
    sms_consent: smsConsent,
    sms_consent_at: smsConsent ? new Date().toISOString() : null,
    source_path: sourcePath,
    ref: sanitizeRef(body.ref) || sanitizeRef(readCookie(request, REF_COOKIE)),
    utm_source: utmSource,
    utm_campaign: utmCampaign,
    country: clip(request.cf && request.cf.country, 2)
  };

  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/subscribers`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify(row)
    });

    // 409 = the unique index on email/phone: they are already on the list.
    if (response.status === 409) {
      return Response.json({ success: true, message: "You're already on the list." });
    }

    if (!response.ok) {
      console.error("subscribers insert failed.", {
        status: response.status,
        body: (await response.text()).slice(0, 300)
      });

      return Response.json({ error: "Signup didn't go through. Please try again." }, { status: 500 });
    }

    return Response.json({
      success: true,
      message: smsConsent ? "You're in. Watch your inbox and your texts." : "You're in. Watch your inbox."
    });
  } catch (error) {
    console.error("subscribers insert error.", { message: error.message });

    return Response.json({ error: "Signup didn't go through. Please try again." }, { status: 500 });
  }
}

/** "(612) 555-0134" / "612-555-0134" / "+1 612 555 0134" -> "+16125550134", else null. */
function normalizeUsPhone(value) {
  if (!value) {
    return null;
  }

  let digits = value.replace(/\D/g, "");

  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.slice(1);
  }

  if (
    digits.length !== 10 ||
    digits[0] === "0" ||
    digits[0] === "1" ||
    digits[3] === "0" ||
    digits[3] === "1"
  ) {
    return null;
  }

  if (/^(\d)\1+$/.test(digits)) {
    return null;
  }

  return `+1${digits}`;
}

// ---------------------------------------------------------------------------
// Square webhook -> instant order text. Square POSTs payment events here;
// we verify its HMAC signature, look the order up, and hand a one-line
// notification to the relay on the apply project, which inserts it into
// notification_events (glitch-brain migrations 037 + 042) and sends it. The
// nightly sync later sees the same order and skips it by dedupe_key.
//
// Secrets (set with `npx wrangler secret put ...` from Git Bash):
//   SQUARE_WEBHOOK_SIGNATURE_KEY - from the Square Developer Dashboard
//                                  webhook subscription for this URL
//   NOTIFY_RELAY_SECRET          - notification_settings.relay_secret,
//                                  shown on the dashboard's Notifications page
// ---------------------------------------------------------------------------
const NOTIFY_RELAY_URL = "https://glitchwax-apply.pages.dev/api/notify";

async function handleSquareWebhook(request, env, ctx) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    console.error("Square webhook received but SQUARE_WEBHOOK_SIGNATURE_KEY is not set.");
    return Response.json({ error: "Webhook not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const notificationUrl =
    env.SQUARE_WEBHOOK_URL || `https://glitchwax.com${new URL(request.url).pathname}`;
  const expected = await hmacSha256Base64(env.SQUARE_WEBHOOK_SIGNATURE_KEY, notificationUrl + rawBody);
  const given = request.headers.get("x-square-hmacsha256-signature") || "";

  if (!constantTimeEqual(expected, given)) {
    console.error("Square webhook signature mismatch.", { notificationUrl });
    return Response.json({ error: "Bad signature." }, { status: 401 });
  }

  let event;

  try {
    event = JSON.parse(rawBody);
  } catch (error) {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const payment = event && event.data && event.data.object && event.data.object.payment;
  const completed =
    event.type === "payment.completed" ||
    (event.type === "payment.updated" && payment && payment.status === "COMPLETED");

  if (!completed || !payment || !payment.order_id) {
    return Response.json({ ok: true, ignored: event.type });
  }

  // Acknowledge fast (Square retries anything slow or non-2xx); do the work after.
  ctx.waitUntil(announceOrder(env, payment.order_id, payment.id));

  return Response.json({ ok: true });
}

async function announceOrder(env, orderId, paymentId) {
  if (!env.NOTIFY_RELAY_SECRET) {
    console.error("Order webhook: NOTIFY_RELAY_SECRET is not set; nothing sent.", { orderId });
    return;
  }

  try {
    const squareBaseUrl =
      env.SQUARE_ENVIRONMENT === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const orderResponse = await fetch(`${squareBaseUrl}/v2/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
        "Square-Version": "2025-04-16"
      }
    });

    const orderData = await orderResponse.json();
    const order = (orderData && orderData.order) || {};
    const total = Number((order.total_money && order.total_money.amount) || 0) / 100;
    const items = (order.line_items || [])
      .map((line) => `${line.quantity}x ${line.name || "item"}`)
      .join(" + ");
    const fulfillment = (order.fulfillments || [])[0];
    const recipient =
      fulfillment && fulfillment.shipment_details && fulfillment.shipment_details.recipient;
    const shipping =
      (order.service_charges || [])
        .filter((charge) => /ship/i.test(charge.name || ""))
        .reduce((sum, charge) => sum + Number((charge.total_money && charge.total_money.amount) || 0), 0) /
      100;

    const bodyParts = [
      items,
      recipient && recipient.display_name,
      shipping > 0 ? `shipping $${shipping.toFixed(2)}` : null,
      order.reference_id ? `ref ${order.reference_id}` : null
    ].filter(Boolean);

    const relayResponse = await fetch(env.NOTIFY_RELAY_URL || NOTIFY_RELAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-notify-secret": env.NOTIFY_RELAY_SECRET
      },
      body: JSON.stringify({
        kind: "order",
        title: `New order $${total.toFixed(2)}`,
        body: bodyParts.join(" - "),
        dedupe_key: `order:${orderId}`,
        source_table: "square_webhook",
        source_id: paymentId || orderId
      })
    });

    if (!relayResponse.ok) {
      console.error("Order webhook: relay refused.", {
        status: relayResponse.status,
        body: (await relayResponse.text()).slice(0, 300)
      });
    }
  } catch (error) {
    console.error("Order webhook error.", { orderId, message: error.message });
  }
}

async function hmacSha256Base64(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
