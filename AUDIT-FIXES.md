# Storefront audit fixes (branch `audit-fixes`)

Worker + pages fixes for the 2026-09-13 architecture audit
(`glitch-brain/docs/AUDIT.md`). Nothing here was committed, pushed or
deployed — everything below is on disk in this clone, branched from
`origin/main` (`ec76495`).

This file is NOT published: the deploy uploads only `public/`, and
`public/.assetsignore` excludes `*.md` on top of that (A-39, and the CI job
below fails if anything like this ends up inside `public/`).

---

## A-12 — rate limits, content-type, Turnstile, and no customer text in SMS

**Status: done.**

There was no KV binding in `wrangler.jsonc` and none was added. The limits use
Cloudflare's **Rate Limiting binding**, which needs nothing created in the
dashboard first (the `namespace_id` is just a number this Worker picks), so
there is no placeholder id that could fail a deploy.

- `wrangler.jsonc` — new `ratelimits` block: `RL_FORMS` (4 requests / 60 s)
  and `RL_CHECKOUT` (15 / 60 s). Checkout is deliberately generous: phone
  carriers and school wifi put many real skaters behind one IP.
- `src/worker.js` — `guardApiPost()` runs before `/api/create-checkout`,
  `/api/contact`, `/api/feedback` and `/api/subscribe`:
  1. **Content type must be `application/json`** (415 otherwise). All four
     pages already send exactly that — verified in `public/script.js`
     (contact, signup, review) and the inline checkout script in
     `public/store.html`. This is what blocks the `text/plain` cross-site POST,
     the one form post a browser sends with no preflight.
  2. **Origin**, when present, must be this host (403 otherwise). A missing
     Origin still passes — the rate limit covers scripted callers.
  3. **Per-IP, per-route rate limit** (429 + `Retry-After: 60`).
  Non-POST requests fall through untouched, so each handler still answers 405.
- **The limiter is optional by design**: if `RL_FORMS` / `RL_CHECKOUT` are not
  bound (older deploy, or the block deleted), `isRateLimited()` returns false
  and nothing is limited. A limiter that throws is also treated as "allow" and
  logged. A deploy can never take checkout down over rate limiting.
- **Turnstile (optional)**: enforced only when **both** `TURNSTILE_SITE_KEY`
  (var) and `TURNSTILE_SECRET_KEY` (secret) are set — requiring both means
  setting only one can never lock the forms out (the half-configured case logs
  and stays off). When on, the Worker injects the widget into
  `#signupForm` / `#reviewForm` / `#contactForm` and the Turnstile script into
  `<head>` with HTMLRewriter on the way out, so **the HTML pages are unchanged
  and render exactly as before when no site key is set**. The widget uses
  `data-appearance="interaction-only"`, so real visitors see nothing. Tokens
  are verified against Cloudflare's siteverify; if siteverify itself is
  unreachable the submission is allowed (an outage must not eat a customer's
  complaint).
- `public/script.js` — sends `turnstileToken` when a widget is on the page
  (JSON.stringify drops it when undefined, so the request body is byte-for-byte
  what it was before) and resets the widget after each submit, since tokens are
  single-use.
- **Customer-written text out of notifications**: the Worker's only outbound
  notification is the Square-webhook order text. It used to include the
  buyer's `recipient.display_name`. Now the body is catalog item names (capped
  at 160 chars), the shipping charge, and the sanitized `ref` code only — the
  buyer's name and address stay on the dashboard's Shipments page, behind
  login.

**Still open, and NOT the Worker's to fix** (flagged for the glitch-brain/DB
agent):

- The **feedback → text** body is built by the database trigger
  `notify_on_new_feedback()` (`migrations/047_feedback.sql`), which puts a
  140-character excerpt of the customer's message **and** their name into the
  SMS body. The Worker cannot change that. It should become title-only
  ("New 2★ review: Stick O Wax"), with the text read in the dashboard.
- The **shared hourly text cap** (`migration 037`) still lets form texts starve
  `order` / `sync` texts. A separate cap per kind is a DB change.
- 4/minute per IP is a spam brake, not a wall: a single IP can still post ~240
  submissions an hour. The durable answer is the rate limit inside the
  `sf_feedback` RPC (migration 057 — the Worker now sends `ip_hash` for exactly
  this) plus turning Turnstile on.

---

## A-13 — storefront writes move to the RPCs (per the DB-agent contract)

**Status: done, dormant until the secret is set.**

`src/worker.js` now routes every storefront write through `storefrontWrite()`:

| Table | RPC |
|---|---|
| `site_visits` | `sf_log_visit` |
| `subscribers` | `sf_subscribe` |
| `feedback` | `sf_feedback` |

- **`STOREFRONT_WRITE_SECRET` unset** → the direct table inserts exactly as
  before, with exactly the same column object. **Deploying this Worker before
  migration 057 changes nothing.**
- **Set** → `POST ${SUPABASE_URL}/rest/v1/rpc/<name>` with
  `{ p_secret, p_row }`, where `p_row` is today's column object **plus**
  `ip_hash` (and, for subscribe, the three consent-evidence columns).
- **404 from an RPC** (function missing, `PGRST202`) → logs and falls back to
  the direct insert, **without** the extra columns, since they do not exist
  until 057 is applied.
- Any other non-2xx from an RPC (e.g. a rejected secret) does **not** fall
  back: it logs and the caller reports failure, so a bad secret is loud rather
  than silently reverting to anon inserts.
- Interpretation of RPC answers, so the DB side knows what the Worker reads:
  **HTTP 409 or a JSON body `{duplicate:true}` / `{status:"duplicate"}`** =
  already on the list (subscribe answers "You're already on the list");
  **HTTP 429 or `{rate_limited:true}` / `{status:"rate_limited"}`** = the
  visitor is told to wait a minute. Anything else 2xx = success.

Note for the DB agent: the `feedback` row still contains `public_ok`
straight from the form, so the `public_ok = false` constraint on the anon
policy (and the RPC's own handling of it) is still worth having.

---

## A-14 — SMS consent evidence, and no claim of confirmed consent

**Status: done (Worker side).**

- `src/worker.js` sends, with every `sf_subscribe` call:
  `consent_ip_hash` (salted SHA-256 of the IP, never the IP),
  `consent_user_agent` (300 chars), `consent_text_version`
  (`2026-09-13-v1`). All three are `null` when the box was not ticked. The
  exact checkbox wording is kept beside the version in the constant
  `SMS_CONSENT_TEXT` — bump the version if the pages' copy changes.
- In direct-insert mode the evidence columns do not exist yet, so the Worker
  logs `SMS consent recorded WITHOUT evidence columns` rather than losing it
  quietly.
- The success message no longer says "Watch your inbox **and your texts**". It
  now reads: *"You're in. Watch your inbox. We'll text you once to confirm your
  number before anything else."* `sms_consent = true` means **a box was
  ticked**, not a confirmed number.
- **This is a commitment, not a fix**: whichever tool is picked for sending
  (Klaviyo / Twilio / …) must do the confirm-reply step before any marketing
  text goes out, and must honour STOP. Double opt-in itself is not built —
  nothing sends SMS yet.

---

## A-49 — a failed order lookup must not announce anything

**Status: done.**

`announceOrder()` in `src/worker.js` now returns early (logging `orderId` and
the status) when the Square order lookup is not OK, or when the response
carries no `order`. Nothing is enqueued, so the `order:<id>` dedupe key stays
free and the nightly sync announces the order normally. The webhook itself
already answered `200` before the lookup (the work runs in `ctx.waitUntil`), so
Square never retries either way. `"New order $0.00"` can no longer happen.

---

## A-71 — dedicated visitor-hash salt

**Status: done.**

`hashSalt(env)` = `VISITOR_HASH_SALT` → `VISITOR_SALT` → `SQUARE_ACCESS_TOKEN`
→ `"glitchwax"`. Until the owner sets `VISITOR_HASH_SALT`, hashes are byte-for-
byte what they are today. The same salt (with a different label) produces the
new `ip_hash`.

**Setting `VISITOR_HASH_SALT` splits unique-visitor counts for that one day**
(the same person hashes differently before and after); days before and after
are unaffected. Rotating the Square token has exactly the same effect today,
which is the reason for a dedicated secret. Set it on a quiet evening.

---

## A-39 — only `public/` is uploaded

**Status: done — the move was clean, so it was made.**

- All static files moved with `git mv` into `public/`: the 9 HTML pages,
  `script.js`, `styles.css`, `images/`. `wrangler.jsonc` now has
  `"directory": "./public"`.
- Nothing in the Worker depends on the location: routing is on
  `url.pathname`, assets are served through `env.ASSETS.fetch(request)`, and
  `.html` stripping is Cloudflare's own asset handling — none of it sees the
  local folder name. Every page reference is relative
  (`styles.css`, `images/…`, `script.js`) and all of them move together, so
  `/`, `/store`, `/review`, `/product-single`, `/product-double`, `/contact`,
  `/order-success`, `/privacy-policy` resolve exactly as before. Verified by
  `wrangler deploy --dry-run`: 43 files read from `public/` (was 99 entries
  from the repo root).
- `src/`, `wrangler.jsonc`, `.dev.vars*`, `.env*`, `.git`, `.github/`,
  `tests/`, `node_modules/` and this report are now **outside** the assets
  directory entirely — they cannot be published even if an ignore rule is
  missed.
- `public/.assetsignore` is the file wrangler actually reads now (it lives in
  the assets directory) and still lists `.dev.vars*`, `.env*`, `src/`,
  `wrangler.*`, `*.md`, `node_modules`, `.git`, `.github/`, `functions/` as a
  second line of defence. The root `.assetsignore` is kept (unused by
  wrangler) with a header explaining why, in case the directory is ever
  pointed back at the repo root.
- CI (below) fails if a `.env*`, `.dev.vars*`, `*.md`, `wrangler.*`,
  `_worker.js`, `src/`, `.git` or `node_modules` ever appears inside `public/`.

---

## A-74 — storefront CI

**Status: done.**

`.github/workflows/check.yml`, on push to any branch, on PRs, and manually:

1. `node --check src/worker.js` and `node --check public/script.js`
2. `node tests/worker.test.mjs` — 23 offline behaviour checks (new file)
3. the `public/` leak check described above
4. `npx --yes wrangler@4.131.1 deploy --dry-run --outdir "$RUNNER_TEMP/dry"`
   — compiles the Worker and validates `wrangler.jsonc` including the new
   bindings. Pinned version. **No deploy, no secrets, no Cloudflare
   credentials** (verified locally with an empty `WRANGLER_HOME`: the dry run
   needs no login).

---

## Verification performed (offline only)

| Check | Result |
|---|---|
| `node --check src/worker.js` | pass |
| `node --check public/script.js` | pass |
| `node tests/worker.test.mjs` | **23 passed, 0 failed** |
| `wrangler 4.131.1 deploy --dry-run --outdir <tmp>` (no credentials) | compiles; bindings listed incl. `RL_FORMS (4 requests/60s)`, `RL_CHECKOUT (15 requests/60s)`; reads 43 files from `public/` |
| `find public -type f \( -name '.env*' -o … \)` | empty |

What the tests cover: 415 on `text/plain`; 403 on a foreign Origin; 200 on the
site's own Origin; 429 (+`Retry-After`) when a limiter says no, keyed
`route:ip`; checkout unaffected when no limiter is bound; 405 still answered
for GET; Turnstile missing-token refused / half-configured ignored / verified
token accepted; RPC used when the secret is set, with `ip_hash` and consent
evidence in `p_row`; RPC 404 → direct insert **without** the new columns; no
secret → direct insert only; a non-404 RPC error does not fall back; duplicate
handling; `sf_log_visit` on page views; `VISITOR_HASH_SALT` changes the hash
and the legacy derivation is stable without it; webhook: failed lookup and
empty order announce nothing, a good order announces with **no buyer name or
address** in the text, bad signature rejected before any lookup.

**Not verified (impossible offline):** the HTMLRewriter Turnstile injection
(needs a real Worker runtime), the live behaviour of the Rate Limiting binding,
and the RPC contract itself (migration 057 is not written yet).

---

## Owner steps, in this exact order

Nothing below is required to keep the site running as it is today — steps 1-3
are the deploy, 4-6 are opt-in hardening. Run them from Git Bash in the
storefront clone (never PowerShell for secrets — it prepends a BOM).

1. **Review and commit this branch** (`audit-fixes`), then merge to `main`.
   Watch the `check` workflow go green on the push.
2. **Deploy the Worker**: `npx wrangler deploy` from the repo root.
   Behaviour after this deploy, with no secrets added: rate limits on, the
   content-type/Origin guard on, no Turnstile, storefront writes still direct
   inserts, hashes unchanged, no `$0.00` order texts.
3. **Check the storefront still sells** (30 seconds, no browser):
   `curl -s -X POST https://glitchwax.com/api/create-checkout -H "Content-Type: application/json" -d '{"stickOWaxWhiteQty":1}'`
   → a `checkoutUrl` means healthy. Then `curl -s -o /dev/null -w "%{http_code}" https://glitchwax.com/store`
   → `200`, and load `/review` once in a browser to see the page renders.
   If the deploy ever fails complaining about `ratelimits`, delete that block
   from `wrangler.jsonc` and redeploy — the code treats a missing limiter as
   "no limit".
4. **After the DB agent's migration 057 is applied**, set the shared secret
   (same value on both sides — ask the DB agent to hand it over the way the
   relay secret is handed over, via a workflow artifact, not by copy/paste):
   `npx wrangler secret put STOREFRONT_WRITE_SECRET`, then `npx wrangler deploy`.
   Verify: submit a test review at `https://glitchwax.com/review` and confirm
   it lands in the dashboard's Support & Reviews. `npx wrangler tail
   glitchwax-website` shows `sf_feedback is missing (404)` if 057 is not
   actually applied.
5. **Optional — dedicated hash salt.** Generate a value and set it:
   `openssl rand -hex 32 | tr -d '\r\n' | npx wrangler secret put VISITOR_HASH_SALT`,
   then `npx wrangler deploy`. Do it on a quiet evening: unique-visitor counts
   for that one day are split.
6. **Optional — Turnstile.** Cloudflare dashboard → Turnstile → add a widget
   for `glitchwax.com` (Managed). Then: add
   `"TURNSTILE_SITE_KEY": "<site key>"` to `vars` in `wrangler.jsonc`, run
   `npx wrangler secret put TURNSTILE_SECRET_KEY` (paste the secret key), and
   `npx wrangler deploy`. Both must be in place — with only one, Turnstile
   stays off by design. Verify by submitting the signup form once; then watch
   `npx wrangler tail glitchwax-website` for `Turnstile rejected a submission`
   entries during a spam wave.

---

## Every Worker secret and var this Worker reads

Secrets are set with `npx wrangler secret put NAME` (Git Bash); vars live in
`wrangler.jsonc`; bindings are declared in `wrangler.jsonc`. **New in this
branch** is marked.

| Name | Kind | Required? | If unset |
|---|---|---|---|
| `ASSETS` | binding (`assets`) | Yes | No page would serve at all |
| `SQUARE_ACCESS_TOKEN` | secret | Yes (checkout) | Checkout returns "Checkout could not be created"; the webhook's order lookup fails and now announces nothing (A-49). Also the legacy hash salt until `VISITOR_HASH_SALT` is set |
| `SQUARE_LOCATION_ID` | var | Yes (checkout) | Square rejects the payment link |
| `SQUARE_ENVIRONMENT` | var | Effectively yes | Anything other than `production` points at Square's sandbox |
| `SHIPPING_FEE_CENTS` | var | No | No shipping fee is added to the checkout — the customer is charged $0 shipping |
| `CONTACT_EMAIL` | binding (`send_email`) | Yes (contact form) | `/api/contact` answers 500 "not configured yet" |
| `CONTACT_FROM_EMAIL` | var | Yes (contact form) | Same |
| `CONTACT_TO_EMAIL` | var | Yes (contact form) | Same |
| `SUPABASE_URL` | var | Yes | No analytics, and `/api/subscribe` + `/api/feedback` answer 500 |
| `SUPABASE_ANON_KEY` | var (publishable key) | Yes | Same |
| `STOREFRONT_WRITE_SECRET` | secret | No — **new** | Storefront writes stay direct table inserts, exactly as today (A-13) |
| `VISITOR_HASH_SALT` | secret | No — **new** | Hashes keep using the old derivation (`VISITOR_SALT`, else the Square token, else a constant) (A-71) |
| `VISITOR_SALT` | secret | No (legacy) | Falls through to the Square token |
| `RL_FORMS` | binding (`ratelimits`) | No — **new** | Form routes are not rate limited (A-12) |
| `RL_CHECKOUT` | binding (`ratelimits`) | No — **new** | Checkout is not rate limited |
| `TURNSTILE_SITE_KEY` | var | No — **new** | No widget is injected; Turnstile stays off (and is forced off even if the secret key is set) |
| `TURNSTILE_SECRET_KEY` | secret | No — **new** | Tokens are not verified; Turnstile stays off (and no widget is injected) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | secret | No | `/api/square-webhook` answers 503 and logs; instant order texts stop, the nightly sync still announces orders |
| `SQUARE_WEBHOOK_URL` | var | No | Defaults to `https://glitchwax.com/api/square-webhook` for signature verification |
| `NOTIFY_RELAY_SECRET` | secret | No | The webhook verifies but announces nothing; the nightly sync covers it |
| `NOTIFY_RELAY_URL` | var | No | Defaults to `https://glitchwax-apply.pages.dev/api/notify` |

---

## Files changed

- `src/worker.js` — guard, rate limits, Turnstile, RPC write layer, consent
  evidence, hash salt, webhook lookup check, SMS body.
- `public/script.js` — Turnstile token + reset on the three forms (no-ops
  without a widget).
- `wrangler.jsonc` — `assets.directory` → `./public`, `ratelimits` block.
- `public/.assetsignore` (new, the one wrangler reads), `.assetsignore`
  (kept, annotated).
- `tests/worker.test.mjs` (new), `.github/workflows/check.yml` (new).
- `public/` — the 9 HTML pages, `script.js`, `styles.css` and `images/` moved
  there with `git mv` (rename-detected, no content change beyond the
  `script.js` edits above).
