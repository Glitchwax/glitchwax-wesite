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

// The exact wording of the SMS box the visitor ticked, and the version stamp
// stored with every consent record (audit A-14). If the checkbox copy on the
// pages changes, bump the version so old and new consents stay tellable apart.
// Ticking this box is a request to be texted, NOT confirmed consent: nothing
// may be sent to a number until it has been confirmed by reply.
const SMS_CONSENT_TEXT =
  "Text me too. Msg & data rates may apply. Reply STOP to opt out.";
const SMS_CONSENT_TEXT_VERSION = "2026-09-13-v1";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // /review merged into /contact (2026-09-14). The packaging QR code prints
    // /review?src=qr and older links carry ?order=, so the query string rides
    // along and the form on /contact reads it exactly as before.
    if (url.pathname === "/review" || url.pathname === "/review.html") {
      return Response.redirect(`${url.origin}/contact${url.search}`, 301);
    }

    if (url.pathname === "/api/create-checkout") {
      const blocked = await guardApiPost(request, env, "checkout");

      return blocked || handleCreateCheckout(request, env, ctx);
    }

    if (url.pathname === "/api/contact") {
      const blocked = await guardApiPost(request, env, "contact");

      return blocked || handleContactForm(request, env, ctx);
    }

    if (url.pathname === "/api/feedback") {
      const blocked = await guardApiPost(request, env, "feedback");

      return blocked || handleFeedback(request, env);
    }

    if (url.pathname === "/api/subscribe") {
      const blocked = await guardApiPost(request, env, "subscribe");

      return blocked || handleSubscribe(request, env);
    }

    // Square signs its own POSTs and does not send application/json from a
    // browser, so the webhook is verified by HMAC instead of the guard above.
    if (url.pathname === "/api/square-webhook") {
      return handleSquareWebhook(request, env, ctx);
    }

    const asset = await env.ASSETS.fetch(request);

    if (!isHtmlResponse(request, asset)) {
      return asset;
    }

    // Turnstile widgets are injected here, so the pages themselves stay
    // exactly as they are when no site key is configured.
    const response = withTurnstileWidget(asset, env);

    const ref = sanitizeRef(url.searchParams.get("ref"));

    if (isDocumentNavigation(request)) {
      ctx.waitUntil(logPageView(request, env, url, ref));
    }

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

// ---------------------------------------------------------------------------
// Public POST guard (audit A-12): content type, origin, and a per-IP rate
// limit, applied to every public JSON endpoint before its handler runs.
// ---------------------------------------------------------------------------

/**
 * Returns a Response to send INSTEAD of running the handler, or null to carry
 * on. Non-POST requests fall through so each handler keeps answering 405.
 */
async function guardApiPost(request, env, route) {
  if (request.method !== "POST") {
    return null;
  }

  // Every one of these routes is called by the site's own fetch() with
  // Content-Type: application/json. Requiring it blocks the text/plain POST
  // that is the one cross-site form post a browser will send without a
  // preflight — the pages are unaffected.
  const contentType = (request.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return Response.json(
      { error: "Send this as application/json." },
      { status: 415 }
    );
  }

  // A same-origin fetch always sends its own origin; anything else is not our
  // page. Requests with no Origin header at all (curl, server-side) still get
  // through — the rate limit covers those.
  const origin = request.headers.get("Origin");

  if (origin && !isSameHost(origin, request.url)) {
    return Response.json({ error: "Not allowed from there." }, { status: 403 });
  }

  if (await isRateLimited(request, env, route)) {
    return Response.json(
      { error: "Too many tries. Give it a minute and send it again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  return null;
}

function isSameHost(origin, requestUrl) {
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch (error) {
    return false;
  }
}

/**
 * Per-IP, per-route rate limit using Cloudflare's Rate Limiting binding
 * (declared in wrangler.jsonc). If the binding is missing — an older deploy,
 * or the block removed — this returns false and nothing is limited, so a
 * deploy can never take checkout down over rate limiting.
 */
async function isRateLimited(request, env, route) {
  const limiter = route === "checkout" ? env.RL_CHECKOUT : env.RL_FORMS;

  if (!limiter || typeof limiter.limit !== "function") {
    return false;
  }

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  try {
    const { success } = await limiter.limit({ key: `${route}:${ip}` });

    if (!success) {
      console.warn("Rate limited.", { route });
    }

    return !success;
  } catch (error) {
    console.error("Rate limit check failed; allowing the request.", {
      route,
      message: error.message
    });

    return false;
  }
}

// ---------------------------------------------------------------------------
// Optional Cloudflare Turnstile on the three public forms (audit A-12).
// Nothing changes unless BOTH TURNSTILE_SITE_KEY (var) and
// TURNSTILE_SECRET_KEY (secret) are set: the widget is injected into the
// pages' forms on the way out, and the token is verified on the way in.
// Requiring both means setting only one can never lock the forms.
// ---------------------------------------------------------------------------
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js";

function turnstileConfigured(env) {
  if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) {
    return true;
  }

  if (env.TURNSTILE_SITE_KEY || env.TURNSTILE_SECRET_KEY) {
    console.error(
      "Turnstile is half-configured (need TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY); staying off."
    );
  }

  return false;
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function withTurnstileWidget(response, env) {
  if (!turnstileConfigured(env)) {
    return response;
  }

  const siteKey = escapeAttribute(env.TURNSTILE_SITE_KEY);

  const widget = {
    element(element) {
      // interaction-only: invisible unless Cloudflare actually wants a
      // challenge, so the page design is untouched for real visitors.
      element.append(
        `<div class="cf-turnstile" data-sitekey="${siteKey}" data-appearance="interaction-only"></div>`,
        { html: true }
      );
    }
  };

  // One selector per .on() — HTMLRewriter does not take selector lists.
  return new HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(
          `<script src="${TURNSTILE_SCRIPT_URL}" async defer></script>`,
          { html: true }
        );
      }
    })
    .on("form#signupForm", widget)
    .on("form#reviewForm", widget)
    .transform(response);
}

/**
 * Verifies a form's Turnstile token. Returns a Response to send instead of
 * accepting the submission, or null to carry on. Fails OPEN if Cloudflare's
 * verify endpoint itself is unreachable — a Turnstile outage must not eat a
 * customer's complaint.
 */
async function turnstileRejection(request, env, token) {
  if (!turnstileConfigured(env)) {
    return null;
  }

  if (typeof token !== "string" || !token) {
    return Response.json(
      { error: "Finish the human check and send it again." },
      { status: 400 }
    );
  }

  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token.slice(0, 2048),
        remoteip: request.headers.get("CF-Connecting-IP") || undefined
      })
    });

    const data = await response.json();

    if (data && data.success) {
      return null;
    }

    console.warn("Turnstile rejected a submission.", {
      codes: data && data["error-codes"]
    });

    return Response.json(
      { error: "That human check didn't pass. Reload the page and try again." },
      { status: 403 }
    );
  } catch (error) {
    console.error("Turnstile verification unreachable; allowing.", {
      message: error.message
    });

    return null;
  }
}

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

// An HTML page response (any GET of a page — this is what may be rewritten).
function isHtmlResponse(request, response) {
  if (request.method !== "GET" || !response.ok) {
    return false;
  }

  return (response.headers.get("Content-Type") || "").includes("text/html");
}

// Only top-level navigations count as a visit — not asset fetches, not
// prefetches, not API calls.
function isDocumentNavigation(request) {
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

/**
 * The salt every visitor/IP hash is built from (audit A-71).
 *
 * VISITOR_HASH_SALT is the dedicated secret and the one to use. Until it is
 * set, the old derivation stands (VISITOR_SALT, then the Square token, then a
 * constant) so existing hashes keep matching. Setting VISITOR_HASH_SALT
 * changes every hash from that moment: unique-visitor counts for that one day
 * are split, nothing before or after is affected. Rotating the Square token
 * has exactly the same effect today, which is the reason for the dedicated
 * secret.
 */
function hashSalt(env) {
  return (
    env.VISITOR_HASH_SALT ||
    env.VISITOR_SALT ||
    env.SQUARE_ACCESS_TOKEN ||
    "glitchwax"
  );
}

async function sha256Hex(value, length) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

// Salted daily hash of IP + user agent: lets the dashboard count unique
// visitors per day without storing either value, and cannot be reversed.
async function visitorHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const userAgent = request.headers.get("User-Agent") || "";
  const day = new Date().toISOString().slice(0, 10);

  return sha256Hex(`${hashSalt(env)}|${day}|${ip}|${userAgent}`, 32);
}

/**
 * Salted hash of the IP alone, stable across days. Sent with every storefront
 * write so the database side can rate-limit and so SMS consent has evidence
 * attached (audit A-12/A-14) — the raw IP is never stored.
 */
async function ipHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";

  return sha256Hex(`${hashSalt(env)}|ip|${ip}`, 32);
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

  return logVisit(
    env,
    {
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
    },
    { ip_hash: await ipHash(request, env) }
  );
}

async function logVisit(env, row, extra) {
  const result = await storefrontWrite(env, "site_visits", row, extra);

  if (!result.ok && result.status !== 0) {
    console.error("site_visits write failed.", { status: result.status });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Storefront writes (audit A-13).
//
// Today these are direct table inserts with the publishable key, which means
// anyone holding that key can write the same rows without passing any of the
// checks above. glitch-brain migration 057 replaces them with SECURITY
// DEFINER RPCs that take a shared secret, so the tables can stop accepting
// anonymous inserts entirely.
//
// The switch is the STOREFRONT_WRITE_SECRET Worker secret:
//   unset  -> direct table inserts, exactly as before (so this Worker can be
//             deployed before migration 057 lands and nothing changes),
//   set    -> sf_log_visit / sf_subscribe / sf_feedback, with the extra
//             columns (ip_hash, SMS consent evidence) the RPCs accept.
// A 404 from an RPC means migration 057 is not applied yet; that one case
// falls back to the direct insert (without the extra columns, which do not
// exist yet) and logs, so a half-finished rollout still captures the data.
// ---------------------------------------------------------------------------
const STOREFRONT_RPCS = {
  site_visits: "sf_log_visit",
  subscribers: "sf_subscribe",
  feedback: "sf_feedback"
};

/** POST JSON to Supabase with the publishable key. Never throws. */
async function supabasePost(env, path, payload, extraHeaders) {
  try {
    const response = await fetch(`${env.SUPABASE_URL}${path}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        ...(extraHeaders || {})
      },
      body: JSON.stringify(payload)
    });

    return {
      ok: response.ok,
      status: response.status,
      text: (await response.text()).slice(0, 500)
    };
  } catch (error) {
    console.error("Supabase request error.", { path, message: error.message });

    return { ok: false, status: 0, text: "" };
  }
}

/** Reads the flags the RPCs may answer with, without depending on them. */
function readWriteResult(result) {
  let data = null;

  if (result.text) {
    try {
      data = JSON.parse(result.text);
    } catch (error) {
      data = null;
    }
  }

  const flag = (name) =>
    Boolean(data && typeof data === "object" && data[name] === true) ||
    Boolean(
      data &&
        typeof data === "object" &&
        typeof data.status === "string" &&
        data.status === name
    );

  return {
    ok: result.ok,
    status: result.status,
    // 23505 (unique violation) surfaces as 409 through PostgREST.
    duplicate: result.status === 409 || flag("duplicate"),
    rateLimited: result.status === 429 || flag("rate_limited")
  };
}

async function storefrontWrite(env, table, row, extra) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 0, duplicate: false, rateLimited: false };
  }

  const rpc = STOREFRONT_RPCS[table];

  if (env.STOREFRONT_WRITE_SECRET && rpc) {
    const result = await supabasePost(env, `/rest/v1/rpc/${rpc}`, {
      p_secret: env.STOREFRONT_WRITE_SECRET,
      p_row: { ...row, ...(extra || {}) }
    });

    if (result.status !== 404) {
      if (!result.ok) {
        console.error(`${rpc} write failed.`, {
          status: result.status,
          body: result.text
        });
      }

      return readWriteResult(result);
    }

    console.error(`${rpc} is missing (404); falling back to a direct insert.`, {
      table
    });
  }

  const result = await supabasePost(env, `/rest/v1/${table}`, row, {
    Prefer: "return=minimal"
  });

  if (!result.ok && result.status !== 409) {
    console.error(`${table} insert failed.`, {
      status: result.status,
      body: result.text
    });
  }

  return readWriteResult(result);
}

async function handleContactForm(request, env, ctx) {
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

    const rejection = await turnstileRejection(request, env, body.turnstileToken);

    if (rejection) {
      return rejection;
    }

    const emailSubject = "New Glitch Wax contact form message";

    const emailBody =
`New message from the Glitch Wax website contact form.

Name:
${contact.name}

Email:
${contact.email}

Phone:
${contact.phone || "(not given)"}

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

    // Keep a copy in the dashboard's Support & Reviews inbox (feedback table,
    // glitch-brain migration 047). Runs after the email and in the
    // background: if Supabase is down, the owner still got the message and
    // the visitor still sees success.
    ctx.waitUntil(
      (async () =>
        insertFeedback(
          env,
          {
            kind: "contact",
            message: contact.comment,
            name: clip(contact.name, 80),
            email: contact.email.toLowerCase(),
            source: "contact_form",
            ref: sanitizeRef(readCookie(request, REF_COOKIE))
          },
          { ip_hash: await ipHash(request, env) }
        ))()
    );

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

  // Letters, spaces, and what an Instagram handle can carry: the form asks
  // for "Name or IG handle" since /review merged into /contact.
  const namePattern = /^[a-zA-Z0-9\s.'@_-]+$/;

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

  // Phone is optional since the contact/review merge (2026-09-14): a question
  // only needs an email to answer. When one is given it still has to be real.
  if (!phone) {
    return {
      isValid: true,
      contact: { name, email, phone: "", comment }
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
        logVisit(
          env,
          {
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
          },
          { ip_hash: await ipHash(request, env) }
        ))()
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

  const rejection = await turnstileRejection(request, env, body.turnstileToken);

  if (rejection) {
    return rejection;
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
    // sms_consent means "ticked the box on the site", NOT a confirmed number.
    // Nothing may be texted to this number until a confirmation reply comes
    // back (audit A-14) — the evidence below is what makes that provable.
    sms_consent: smsConsent,
    sms_consent_at: smsConsent ? new Date().toISOString() : null,
    source_path: sourcePath,
    ref: sanitizeRef(body.ref) || sanitizeRef(readCookie(request, REF_COOKIE)),
    utm_source: utmSource,
    utm_campaign: utmCampaign,
    country: clip(request.cf && request.cf.country, 2)
  };

  const extra = {
    ip_hash: await ipHash(request, env),
    consent_ip_hash: smsConsent ? await ipHash(request, env) : null,
    consent_user_agent: smsConsent
      ? clip(request.headers.get("User-Agent") || "", 300)
      : null,
    consent_text_version: smsConsent ? SMS_CONSENT_TEXT_VERSION : null
  };

  if (smsConsent && !env.STOREFRONT_WRITE_SECRET) {
    // Direct-insert mode has nowhere to put the evidence columns (they arrive
    // with glitch-brain migration 057). Say so rather than losing it quietly.
    console.warn("SMS consent recorded WITHOUT evidence columns.", {
      consent_text_version: SMS_CONSENT_TEXT_VERSION
    });
  }

  const result = await storefrontWrite(env, "subscribers", row, extra);

  // The unique index on email/phone: they are already on the list.
  if (result.duplicate) {
    return Response.json({ success: true, message: "You're already on the list." });
  }

  if (result.rateLimited) {
    return Response.json(
      { error: "Too many tries. Give it a minute and send it again." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  if (!result.ok) {
    return Response.json({ error: "Signup didn't go through. Please try again." }, { status: 500 });
  }

  return Response.json({
    success: true,
    // Never promise texts on the strength of a ticked box alone.
    message: smsConsent
      ? "You're in. Watch your inbox. We'll text you once to confirm your number before anything else."
      : "You're in. Watch your inbox."
  });
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
// Reviews + support capture (/review page). Inserts into Supabase `feedback`
// with the publishable key under an insert-only policy (glitch-brain
// migration 047); the dashboard's Support & Reviews page reads it and a
// database trigger texts the owner. The contact form also writes here, via
// insertFeedback, after its email goes out.
// ---------------------------------------------------------------------------
const FEEDBACK_KINDS = ["review", "complaint", "question"];
const FEEDBACK_PRODUCTS = ["Stick O Wax", "Two Pack", "Other"];
const FEEDBACK_SOURCES = ["site_review", "order_success", "qr"];

async function handleFeedback(request, env) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return Response.json({ error: "Reviews are not configured yet." }, { status: 500 });
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
    return Response.json({ success: true, message: "Thanks. We got it." });
  }

  const validation = validateFeedbackSubmission(body);

  if (!validation.isValid) {
    return Response.json({ error: validation.message }, { status: 400 });
  }

  const rejection = await turnstileRejection(request, env, body.turnstileToken);

  if (rejection) {
    return rejection;
  }

  const row = validation.feedback;
  row.ref = sanitizeRef(body.ref) || sanitizeRef(readCookie(request, REF_COOKIE));

  const inserted = await insertFeedback(env, row, {
    ip_hash: await ipHash(request, env)
  });

  if (!inserted) {
    return Response.json(
      { error: "That didn't go through. Please try again." },
      { status: 500 }
    );
  }

  const messages = {
    review: "Thanks for the review. The whole team reads every one.",
    complaint: "Sorry about that. We'll look into it and get back to you.",
    question: "Got it. We'll get back to you soon."
  };

  return Response.json({ success: true, message: messages[row.kind] });
}

function validateFeedbackSubmission(body) {
  const kind = FEEDBACK_KINDS.includes(body.kind) ? body.kind : "review";

  const rating = body.rating === null || body.rating === undefined || body.rating === ""
    ? null
    : Number(body.rating);

  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return { isValid: false, message: "Pick a rating from 1 to 5 stars." };
  }

  if (kind === "review" && rating === null) {
    return { isValid: false, message: "Tap a star rating first." };
  }

  // Keep line breaks in the message (reviews read better with them), strip
  // other control characters.
  const message = typeof body.message === "string"
    ? body.message
        .replace(/\r\n?/g, "\n")
        .replace(/[ -	-]/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "";

  if (message.length > 2000) {
    return { isValid: false, message: "Message is too long (2000 characters max)." };
  }

  if (kind !== "review" && message.length < 10) {
    return { isValid: false, message: "Tell us a little more (at least 10 characters)." };
  }

  const name = cleanText(body.name, 80);

  if (!name) {
    return { isValid: false, message: "Please enter your name." };
  }

  const email = cleanText(body.email, 254).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (email && !emailPattern.test(email)) {
    return { isValid: false, message: "Enter a valid email address, or leave it blank." };
  }

  if (kind !== "review" && !email) {
    return { isValid: false, message: "Add your email so we can get back to you." };
  }

  const product = FEEDBACK_PRODUCTS.includes(body.product) ? body.product : null;
  const orderRef = cleanText(body.order, 64).replace(/^#/, "");
  const source = FEEDBACK_SOURCES.includes(body.source) ? body.source : "site_review";

  return {
    isValid: true,
    feedback: {
      kind,
      rating,
      message: message || null,
      name,
      email: email || null,
      order_ref: orderRef || null,
      product,
      source,
      // Consent to be quoted only means something on a review.
      public_ok: kind === "review" && body.publicOk === true
    }
  };
}

/** Write one feedback row; resolves true/false, never throws. */
async function insertFeedback(env, row, extra) {
  const result = await storefrontWrite(env, "feedback", row, extra);

  return result.ok;
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

    // A failed lookup used to fall through as "New order $0.00", and the
    // dedupe key then silenced the correct text from the nightly sync (audit
    // A-49). Now: say nothing, log it, and let the sync announce the order.
    // The webhook already answered 200, so Square does not retry either way.
    if (!orderResponse.ok) {
      console.error("Order webhook: Square order lookup failed; not announcing.", {
        orderId,
        status: orderResponse.status
      });

      return;
    }

    const orderData = await orderResponse.json().catch(() => null);
    const order = orderData && orderData.order;

    if (!order) {
      console.error("Order webhook: Square returned no order; not announcing.", {
        orderId
      });

      return;
    }

    const total = Number((order.total_money && order.total_money.amount) || 0) / 100;
    const items = (order.line_items || [])
      .map((line) => `${line.quantity}x ${line.name || "item"}`)
      .join(" + ")
      .slice(0, 160);
    const shipping =
      (order.service_charges || [])
        .filter((charge) => /ship/i.test(charge.name || ""))
        .reduce((sum, charge) => sum + Number((charge.total_money && charge.total_money.amount) || 0), 0) /
      100;

    // Nothing a customer typed goes into a text (audit A-12): catalog item
    // names, the shipping charge and the sanitized ref code only. The buyer's
    // name and address are on the dashboard's Shipments page, behind login.
    const bodyParts = [
      items,
      shipping > 0 ? `shipping $${shipping.toFixed(2)}` : null,
      order.reference_id ? `ref ${clip(String(order.reference_id), 40)}` : null
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
