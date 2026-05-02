# Retail Launch Build Plan

> **Created**: 2026-04-24
> **Scope**: Free-forever plan model + retail onboarding v1 (`general_retail` only at launch)
> **Total estimated effort**: ~4 engineering days across 9 code PRs + 1 infra PR (PR 0 — Railway env vars, ~15 min)

This document is the single source of truth for the retail launch work. Every decision below was locked through an interactive Q&A session on 2026-04-24. No open questions remain.

---

## Product Decisions (Locked)

### Plan model

- **Free is forever, capped.** No trial clock. `payment_status = 'active'` indefinitely.
- **Free caps**: 3 employees, 100 products, 1 outlet.
- **Pro pricing**: 8000 PKR/month or 80000 PKR/year **per outlet**.
- **Pro caps**: unlimited employees, unlimited products, 1 outlet default (additional outlets = pay-per-outlet).
- **Feature access is identical** for Free and Pro — plan only gates resource caps, not features.
- **Existing tenants** (`packagesmall`, `khantoys`) are test data; leave them as-is. No retroactive migration.

### Signup

- **Default to Free** for every new signup. Remove the plan selector from the signup form.
- **Only `general_retail` industry type** is clickable at launch. Keep all 22 tiles visible in the setup wizard; mark 21 as "Coming soon" and disabled.
- **No trial clock** set for Free tenants.

### Upgrade flow

- **Entry points**: cap-hit modal + permanent "Upgrade to Pro" button on `/billing`.
- **Cap UX**: soft warning banner at 80% usage, hard block at 100% with upgrade modal.
- **Checkout**: monthly vs. annual toggle. No outlet-count pre-commit at upgrade time.
- **Flow**: click Upgrade → pick cycle → xPay checkout for `price × current_outlet_count` → webhook flips `plan = 'pro'`, clears caps.

### Multi-outlet

- **Add-outlet flow**: pay-first. Click "Add Outlet" → xPay checkout → webhook bumps `max_outlets` → merchant creates the outlet.
- **Auto-enable on 2nd outlet**: `context_selection_required`, `context_header_enforced`, `phase2_outlet_pricing`, `phase2_outlet_visibility`, `phase2g_price_books` flip ON with a dismissable banner.
- **`kiosk_context_locked`** stays OFF (merchant opt-in, even after 2nd outlet).

### Retail flag seed (19 flags)

Seeded ON at setup wizard completion when `industry_type === 'general_retail'`. Written to the `feature_flags` table inside the existing atomic transaction in `routes/setup.js`.

**Core retail polish (8):**
1. `phase2g_omni_input`
2. `phase2g_variant_picker`
3. `phase2g_price_override`
4. `phase2g_receipt_barcode_lookup`
5. `phase2g_per_line_restock`
6. `phase2_pos_approvals`
7. `phase2g_risk_controls`
8. `retail_weekly_digest`

**Opt-in extras (7):**
9. `phase2g_gift_cards`
10. `phase2g_loyalty`
11. `phase2g_holds`
12. `phase2g_inventory_intelligence`
13. `phase2g_label_designer`
14. `phase2_draft_orders`
15. `phase2_item_suggestions`

**Integrations (4):**
16. `phase5_cod_reconciliation`
17. `phase5_shipping_automation`
18. `phase5_sms_providers`
19. `sms_campaigns`

### Flags that stay OFF (not seeded)

- `phase2g_serialized_inventory` — merchant opt-in only
- `phase2_commissions` — merchant opt-in only
- `phase5_payment_gateways` — until platform has live gateway
- `shift_auto_close` — until 4-week safety window observed
- `offline_returns` — until 4-week safety window observed
- `payment_links` — until platform has live gateway
- `fbr_integration` — enabled only when merchant completes FBR wizard (not at signup)

### FBR handling

- **No FBR checklist step.** FBR isn't universal — only required for businesses registered for sales tax (STRN).
- **FBR banner** shown on dashboard for PK tenants with two CTAs: "Set up FBR" and "Not required for my business". Dismissible, persisted to `company_profile.fbr_banner_dismissed`.
- When merchant completes FBR settings page with valid NTN + token + province, `fbr_integration` flag auto-enables.

---

## Build Order (10 PRs — PR 0 prereq + 9 code PRs)

### PR 0 — Railway env var alignment (~15 minutes, NO CODE CHANGES)

This is a production infrastructure PR — no git commits. It fixes **6 silently-broken retail features** and unblocks everything downstream. Must run **before** PR 1 because every subsequent PR assumes these env vars are set.

**Why this is PR 0, not deferred**: without these workers enabled, seeding retail flags in PR 2 is theater — the UI turns features on, but the background processes (weekly digest emails, anomaly detection, hold expiry, inventory reservation expiry, marketplace sync, scheduled catalog changes) never run. Merchants see features that silently don't work.

#### Step 1 — Generate encryption keys locally

Run these two commands on your machine and **save the output to your password manager (1Password / Bitwarden / etc.) before doing anything else**:

```bash
openssl rand -hex 32   # → this becomes INTEGRATION_SECRET_KEY
openssl rand -hex 32   # → this becomes SHOPIFY_SECRET_KEY (placeholder)
```

**Critical operational rules**:
- **Save both values in your password manager immediately**. If Railway's env vars ever get wiped again (as happened before with the previous `SHOPIFY_SECRET_KEY`), losing these keys means every encrypted integration credential across every tenant becomes permanently unreadable.
- **Never rotate these keys casually**. Rotating `INTEGRATION_SECRET_KEY` orphans all stored marketplace credentials (Daraz tokens, courier API keys, WooCommerce secrets, Shopify tokens). A rotation would require a migration that decrypts with the old key and re-encrypts with the new one — not a quick operation.
- **Never commit these values to git, .env files, or chat logs.** They are pure secrets.

#### Step 2 — Enable missing retail-critical workers

```bash
railway variables --set RETAIL_DIGEST_WORKER_ENABLED=1 --service oneshoppos
railway variables --set ANOMALY_WORKER_ENABLED=1 --service oneshoppos
railway variables --set HOLD_EXPIRY_WORKER_ENABLED=1 --service oneshoppos
railway variables --set RESERVATION_WORKER_ENABLED=1 --service oneshoppos
railway variables --set MARKETPLACE_SYNC_WORKER_ENABLED=1 --service oneshoppos
railway variables --set SCHEDULED_CATALOG_WORKER_ENABLED=1 --service oneshoppos
```

| Env var | Retail flag / feature it powers |
|---|---|
| `RETAIL_DIGEST_WORKER_ENABLED` | `retail_weekly_digest` — Monday 08:00 local digest email to owner |
| `ANOMALY_WORKER_ENABLED` | `phase2g_risk_controls` — anti-theft anomaly detection, shift variance |
| `HOLD_EXPIRY_WORKER_ENABLED` | `phase2g_holds` — auto-release expired layaway/holds back to inventory |
| `RESERVATION_WORKER_ENABLED` | Core POS inventory reservations (5-min TTL during checkout) |
| `MARKETPLACE_SYNC_WORKER_ENABLED` | `marketplace_integrations` (default-ON) — Shopify / Daraz / FB / WA / Google poll + sync |
| `SCHEDULED_CATALOG_WORKER_ENABLED` | `phase2_scheduled_changes` (default-ON) — fires scheduled price/availability changes at trigger time |

#### Step 3 — Set integration encryption keys

Using the hex values from Step 1:

```bash
railway variables --set INTEGRATION_SECRET_KEY=<first-hex-from-step-1> --service oneshoppos
railway variables --set SHOPIFY_SECRET_KEY=<second-hex-from-step-1> --service oneshoppos
```

**Why `SHOPIFY_SECRET_KEY` is a placeholder**: production currently has zero Shopify env vars. The old encrypted `packagesmall` Shopify token (entered ~1 month ago) is unrecoverable without the original key that was set at that time. The new placeholder exists only to stop the `services/crypto.js` fallback cascade from hitting `null` and storing new secrets as plaintext. When a real Shopify integration is needed, either:
- Replace with the actual Shopify Custom App secret for that integration, or
- Stay on Architecture A (per-tenant Custom Apps, each tenant brings their own secret stored encrypted in DB via `INTEGRATION_SECRET_KEY`)

**Timing rule**: Step 3 must complete before any real retail tenant enters marketplace or courier credentials. After this point, new secrets are properly encrypted. Secrets entered *before* this step are stored as plaintext (no encryption key was available) — check if any tenant has done this; their credentials are already compromised at rest.

#### Step 4 — Admin hardening (optional but recommended)

```bash
railway variables --set ADMIN_ALLOWED_IPS=<your-office-or-home-ip> --service oneshoppos
```

Currently unset — triggers `[SECURITY]` warning at boot and leaves `/api/admin/*` open to any IP. Setting this restricts super-admin panel to trusted IPs only.

**Skip this if you're on a dynamic residential IP** — you'll lock yourself out when your IP changes. Better to leave it open than lock yourself out of production.

Get your current IP: `curl ifconfig.me` (run from the machine you admin from).

#### Step 5 — Clean up `packagesmall`'s dead Shopify row (optional)

The `shopify_connections` row for `packagesmall` contains credentials encrypted with a key that no longer exists on Railway. It's effectively garbage data. Two options:

**Option A — leave it** (harmless unless a Shopify webhook arrives for `packagesmall`'s test store, in which case that webhook 500s). If no Shopify webhooks are configured against that store, no functional impact.

**Option B — delete it** via Supabase SQL:
```sql
DELETE FROM tenant_packagesmall.shopify_connections;
```

Then if you ever want to re-test Shopify with `packagesmall`, paste the Shopify Custom App credentials into the UI again — they'll be freshly encrypted with the new `INTEGRATION_SECRET_KEY`.

**Recommendation**: B. Cleaner. `packagesmall` is test data anyway.

#### Step 6 — Verify the changes took effect

After Railway finishes redeploying (~2–3 minutes after the last `railway variables --set`):

1. Check the deploy completed: `railway logs --service oneshoppos | head -50` — look for `[BookingReminders] Worker enabled` and similar `Worker enabled` lines for the 6 new workers.
2. Hit the admin worker-status endpoint (as super-admin):
   ```
   GET https://api.sanopos.com/api/admin/worker-status
   ```
   Confirm the 6 previously-missing workers now show `running: true`.
3. Check `/api/health?deep=true` returns 200 — confirms DB + Resend still healthy after redeploy.
4. Sanity-test: connect a fake courier in the IntegrationsHub UI for `packagesmall` or a new test tenant. Run `SELECT config_json FROM integration_settings WHERE category = 'courier' LIMIT 1;` via Supabase. The value should start with `enc:v1:...` — confirms encryption is working.

#### Deferred env vars (do NOT set in PR 0)

| Env var | When to set |
|---|---|
| `TURNSTILE_SECRET_KEY` | In PR 9 (pre-public launch) — from Cloudflare Turnstile dashboard |
| `PAYMENT_GATEWAY=xpay` | When xPay merchant contract signed and you're ready for real payments. Currently `sandbox` — fine for testing but real money won't flow. |
| `XPAY_API_KEY`, `XPAY_WEBHOOK_SECRET` | Paired with the above — from xPay integration package |
| `META_WEBHOOK_VERIFY_TOKEN` | When integrating Facebook/Meta Commerce |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | When integrating WhatsApp Business API |
| `ANTHROPIC_API_KEY` | Only if AI insights should work (not needed for retail launch) |
| `SHIFT_AUTO_CLOSE_WORKER_ENABLED` | When `shift_auto_close` exits its 4-week safety window and ships broadly |
| `BOOKING_REMINDER_WORKER_ENABLED` | Non-retail — leave off |
| `COURSE_RELEASE_WORKER_ENABLED` | Non-retail — leave off |
| `KDS_SNAPSHOT_WORKER_ENABLED` | Non-retail (restaurant) — leave off |
| `RESERVATION_REMINDER_WORKER_ENABLED` | Non-retail — leave off |
| `FRONTEND_URL` | Optional hygiene — currently unset, some email link builders fall back to hardcoded `sanopos.com`. Can set to `https://sanopos.com` for correctness. Not urgent. |

#### Current `PAYMENT_GATEWAY` state (informational)

`PAYMENT_GATEWAY=sandbox` is currently set. This means PR 4 (upgrade flow) and PR 5 (add-outlet flow) will route to the sandbox payment adapter, not real xPay. Fine for integration testing. **Before any real merchant pays real money, this must be switched to `xpay` with `XPAY_API_KEY` and `XPAY_WEBHOOK_SECRET` also set.**

---

### PR 1 — Free-forever lifecycle (~3 hours)

**Backend**:
- `routes/auth.js` (signup): always set `plan = 'free'`, `payment_status = 'active'`, `trial_ends_at = null`. Remove the "if pro, set 45-day trial" branch.
- `middleware/plan-limits.js` → `requireActiveSubscription`: add early return `if (tenant.plan === 'free') return next()` so Free tenants are never expired.
- `workers/subscription-grace-worker-boss.js`: skip `plan = 'free'` tenants.
- Email lifecycle worker: skip `plan = 'free'` tenants from `trial_warning` / `trial_ended` / `account_locked` emails.
- `services/email-templates.js`: grep for "trial" / "expires" / "days left" language in `drip_getting_started` and `drip_features` templates. Make copy plan-conditional.
- `master-db-pg.js:16`: change `max_products INTEGER DEFAULT 500` → `DEFAULT 100`.

**Frontend**:
- `pages/SignupPage.jsx`: remove the plan selector (lines 6-9 `PLANS` constant + the radio button block at lines 159-189). Drop the `plan` field from the submit payload.
- `ui/SubscriptionBanner.jsx`: return `null` when `tenant.plan === 'free'`.

**Verification**: new signup → tenant row has `plan = 'free'`, `payment_status = 'active'`, `trial_ends_at = null`. Dashboard loads without subscription banner. POST routes work indefinitely.

---

### PR 2 — Retail seed function + wizard narrowing (~3 hours)

**Backend**:
- Create `backend/services/retail-flag-preset.js`:
  - Export the 19-flag list as a constant `RETAIL_SEED_FLAGS`.
  - Export `seedRetailFlags(client)` — runs `INSERT INTO feature_flags (key, enabled) VALUES ($1, true) ON CONFLICT (key) DO UPDATE SET enabled = true` for each flag. Client is passed in so it joins the caller's transaction.
- `routes/setup.js` inside the transaction at around line 184: after the mode-based flag seeder, call `await seedRetailFlags(client)` when `industry_type === 'general_retail'`.
- `routes/fbr.js`: verify the settings-save endpoint flips `fbr_integration` to true when valid NTN + token + province are saved. If it doesn't, add the flag write.

**Frontend**:
- `pages/SetupWizard.jsx` step 1: modify `BUSINESS_TYPE_CATEGORIES` rendering. Add a `comingSoon` flag to each non-retail type (21 of 22). For coming-soon tiles:
  - Grayscale icon colors
  - "Coming soon" badge in top-right
  - `cursor-not-allowed`, disabled click handler
  - Add `disabled` to the button element
- Only `general_retail` tile remains clickable and selectable.

**Verification**: complete setup wizard as a retail tenant → query `SELECT key FROM feature_flags WHERE enabled = true` for that tenant → see all 19 new flags plus existing default-ON ones.

---

### PR 3 — Cap-hit UX (~4 hours)

**Backend**:
- New endpoint `GET /api/billing/usage` in `routes/billing.js`. Returns:
  ```json
  {
    "employees": { "used": 2, "limit": 3 },
    "products": { "used": 87, "limit": 100 },
    "outlets": { "used": 1, "limit": 1 }
  }
  ```
  Mirrors the query pattern in `routes/admin/monitoring.js` lines 50-78. Returns `limit: null` when cap is 0 (unlimited).

**Frontend**:
- `api.js` or a new `components/PlanLimitModalInterceptor.jsx`: globally intercept 403 responses with body `{ code: "PLAN_LIMIT_REACHED" }`. On detect, open an upgrade modal showing: the specific dimension (employees/products/outlets), the limit, and a "Upgrade to Pro — 8000 PKR/month" CTA linking to `/billing`.
- New dashboard component `pages/dashboard/PlanUsageBanner.jsx`: polls `/api/billing/usage` on mount + every 60s. Shows a soft amber banner when any dimension is ≥80% of limit. Dismissible per-session via `sessionStorage`.

**Verification**: as a Free tenant with 2 employees, create a 3rd → success. Try to create a 4th → 403 with upgrade modal. At 80/100 products, dashboard shows "Close to plan limit" banner.

---

### PR 4 — Upgrade flow polish (~3 hours)

**Frontend**:
- `pages/redesign/BillingRedesign.jsx`: add a prominent "Upgrade to Pro" card at the top when `tenant.plan === 'free'`. Card has:
  - Monthly (8000 PKR) vs Annual (80000 PKR, 17% savings) toggle
  - "Upgrade Now" button → POSTs to `/api/billing/create-checkout` with `{ cycle }` → redirects to the returned `checkout_url`
- The existing `POST /api/billing/create-checkout` endpoint already works per `routes/billing.js:197-263`. No backend changes needed.

**Verification**: Free tenant visits `/billing` → sees upgrade card → picks monthly → redirects to xPay checkout URL. Complete payment → webhook updates `plan = 'pro'`, banner disappears, caps lifted.

---

### PR 5 — Add-outlet flow + multi-outlet auto-enable (~4 hours)

**Backend**:
- New endpoint `POST /api/billing/add-outlet` in `routes/billing.js`:
  - Guards: Pro plan only (Free can't add outlets — they'd upgrade first)
  - Creates a payment intent with `outlet_count = tenant.max_outlets + 1`, `amount = plan_pricing.pro.monthly.price * 1` (cost of one new outlet)
  - Returns xPay checkout URL
- Webhook handler in `routes/webhooks.js`: when a payment intent for an outlet-add succeeds, increment `tenants.max_outlets` by 1.
- `routes/outlets.js` POST handler: on successful creation of an outlet, if the resulting outlet count becomes > 1 AND this is the first time it crosses that threshold, seed the 5 multi-outlet flags in the tenant's `feature_flags` table. Use a company_profile field like `multi_outlet_flags_seeded BOOLEAN` (migration) to avoid re-seeding on subsequent outlet deletes/re-adds.

**Frontend**:
- `pages/redesign/OutletsRedesign.jsx`: add "Add Outlet" button. On Free tenants or Pro at cap, clicking it opens the upgrade/purchase modal. On Pro tenants below a future cap (currently N/A), it POSTs to `/api/billing/add-outlet` and redirects to xPay.
- New component `ui/MultiOutletEnabledBanner.jsx`: shown on dashboard after a 2nd outlet is created. Text: "We enabled outlet-selection and multi-outlet pricing. Adjust in Settings → Security if not needed." Dismissible.

**Verification**: Pro tenant clicks "Add Outlet" → pays 8000 PKR via xPay → webhook bumps `max_outlets` to 2 → creates 2nd outlet → 5 multi-outlet flags flip ON → banner appears on dashboard.

---

### PR 6 — Auto-login after setup wizard (~1 hour)

**Backend**:
- `routes/setup.js` `POST /api/setup/complete`: at the end of the transaction, issue a short-lived JWT for the newly-created admin employee. Use existing `signAccessToken` from `jwt-auth.js`. Return the token + employee info in the response.

**Frontend**:
- `pages/SetupWizard.jsx` `submit()` function: on success response containing a token, write it to `authStore` via the existing helpers and navigate to `/dashboard` instead of `/login`.

**Verification**: complete the 5-step wizard → lands directly on `/dashboard` as the authenticated admin. No re-login prompt.

---

### PR 7 — Onboarding checklist enhancement + FBR banner for PK (~3 hours)

**Part A — Enhance existing inline checklist**:

- `backend/config/industry-config.js` line 25: update `general_retail.onboarding_steps` from `["store", "product", "employees", "shift", "sale"]` to `["store", "product", "customer", "employees", "shift", "sale", "receipt"]` (7 steps).
- `frontend/src/pages/dashboard/DashboardOnboarding.jsx` `ALL_STEPS` map (lines 15-131): add 2 new entries:
  - `customer` — label "Add your first customer" — done when `data.customerCount > 0` — navigate `/customers/new`
  - `receipt` — label "Print a test receipt" — done when `data.testReceiptPrinted === true` — navigate `/settings/receipt-templates`
- Dashboard data source: ensure `customerCount` and `testReceiptPrinted` are returned in the dashboard payload. Check `routes/insights.js` or wherever `/api/dashboard` is served. Add if missing.
- Backend: migration adds `test_receipt_printed_at TIMESTAMPTZ` to `company_profile`. Printer test endpoint (likely in `routes/printer.js` under `/api/print/test`) sets this column on first successful test print.

**Part B — FBR banner for PK tenants**:

- Backend migration: add `fbr_banner_dismissed BOOLEAN DEFAULT false` to `company_profile`.
- New endpoint `PUT /api/company-profile/fbr-banner-dismiss` in the company profile route. Mirrors the pattern in the existing `PUT /api/company-profile/onboarding-dismiss`.
- New component `frontend/src/ui/FBRPromptBanner.jsx`:
  - Visibility conditions: `country_code === 'PK'` AND `fbr_banner_dismissed !== true` AND `flags.fbr_integration !== true`
  - Message: "Pakistan tenants: FBR Digital Invoicing is required for businesses registered for sales tax (STRN). [Set up FBR] [Not required for my business]"
  - "Set up FBR" → `navigate('/settings/fbr')`
  - "Not required for my business" → `PUT /api/company-profile/fbr-banner-dismiss` → dismisses permanently
- Mount the banner inside `pages/redesign/DashboardRedesign.jsx` alongside existing banners.
- `pages/redesign/FBRSettingsRedesign.jsx`: add a helper line near empty credential fields: "Don't have an API token yet? Apply through the FBR IRIS portal."

**Verification**: fresh PK retail tenant sees FBR banner. Click "Not required" → banner disappears forever. Fresh non-PK tenant never sees the banner. Print test receipt → "Print a test receipt" step ticks off.

---

### PR 8 — Email verification before account activation (~1 day)

**Backend**:
- Migration: add `email_verified_at TIMESTAMPTZ` and `email_verification_token TEXT` to tenants table (or to admin `employees` row — decide based on ownership model).
- `routes/auth.js` signup: after creating tenant, generate verification token (random UUID), store it, send verification email via Resend. Do NOT return the setup token yet.
- New endpoint `POST /api/auth/verify-email` takes `{ token }`, marks `email_verified_at = NOW()`, returns the setup token + tenant slug.
- Block setup completion if `email_verified_at IS NULL`.

**Frontend**:
- `pages/SignupPage.jsx`: on submit success, show "Check your email to continue" screen instead of redirecting to setup.
- New page `pages/VerifyEmail.jsx` at `/verify-email?token=X`: POSTs the token, on success redirects to `/setup?token=...&tenant=...`, on failure shows a friendly error with resend CTA.
- Add `pages/VerifyEmailRoute.jsx` thin wrapper and register in `routes/publicRoutes.jsx`.

**Verification**: new signup → receives email → clicks link → lands on setup wizard. Tampering with the link → friendly error.

---

### PR 9 — Pre-public-launch hygiene (~4 hours)

**TOS + Privacy**:
- Create `frontend/src/pages/public/Terms.jsx` and `frontend/src/pages/public/Privacy.jsx` with generic placeholder content (note in doc comments: "replace with lawyer-reviewed copy before public launch").
- Register in `routes/publicRoutes.jsx`.
- `pages/SignupPage.jsx`: add checkbox "I agree to the [Terms of Service] and [Privacy Policy]" — both links open in new tab. Disable the submit button until checked.

**CAPTCHA**:
- Add Cloudflare Turnstile site key to `frontend/.env` and reference as `VITE_TURNSTILE_SITE_KEY`.
- Install `@marsidev/react-turnstile` or use the raw Turnstile JS snippet.
- Add Turnstile widget to `pages/SignupPage.jsx` above the submit button.
- Backend: in `routes/auth.js` signup, verify the Turnstile token by POSTing to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with the server secret. Reject signup on verification failure.
- Environment variables: `TURNSTILE_SECRET_KEY` added to Railway.

**Setup token resend**:
- New endpoint `POST /api/auth/resend-setup-link` takes `{ email }`, finds tenant by owner email, regenerates `setup_token` on the tenant's `company_profile`, extends `setup_token_expires_at` to 48h from now, sends the welcome email again.
- Rate-limited: 1 resend per email per hour (reuse the signup rate-limit map pattern).
- Frontend: on the setup wizard's "token expired" error screen ([SetupWizard.jsx:284-286](frontend/src/pages/SetupWizard.jsx#L284-L286)), add a "Resend setup link" button that collects the email and calls the endpoint. Show confirmation: "Check your email for a new setup link."

**Verification**: signup without TOS checked → submit disabled. Signup with TOS + CAPTCHA → proceeds. Expired setup token + click Resend → new email received, new link works.

---

## Deferred (Not in This Launch)

These were discussed but intentionally not shipping now:

- **Bucket B flag retirement** — 7 default-ON Phase 2 flags + 4 default-ON reports flags recommended for deletion in the flag audit. Deferred to a future cleanup PR. No behavior change if deleted; pure codebase hygiene.
- **FBR setup card on dashboard** for PK tenants — beyond the banner in PR 7. A richer persistent card with credential status, FBR submission stats, etc. is a v2 polish item.
- **Wizard save-progress / resume** — if merchant closes tab mid-wizard, progress is lost. Nice-to-have, not a blocker.
- **Sample-data seeding error surfacing** — currently non-fatal with silent log. Edge case, not urgent.
- **Cap usage query performance optimization** — the 3 COUNT(*) queries in `/api/billing/usage` are fine at current scale. Revisit when tenants have 100k+ products.
- **Full welcome modal** — we chose the inline-card enhancement (Option A in the Q&A) over a full-screen modal. Reconsider only if onboarding completion rates disappoint.

---

## Implementation Notes

### Minor judgment calls I'll make unless you say otherwise

- **Welcome checklist task labels**: using the 7 steps above with plain labels. No custom copy needed.
- **Legal page content**: generic placeholder — you replace with lawyer copy before broad public launch.
- **Email verification template**: standard polite wording — "Click to verify your SanoPOS account."
- **CAPTCHA provider**: Cloudflare Turnstile (you already use Cloudflare for DNS).
- **FBR banner copy**: wording is in the PR 7 spec above — plain English, two-option binary dismiss.

### Testing approach per PR

Each PR should be verified by:
1. A clean new-tenant signup flow end-to-end (create tenant → complete setup → verify state)
2. Targeted SQL queries against `public.tenants` and `tenant_<slug>.feature_flags`
3. Manual click-through of the modified UI
4. Existing Playwright onboarding specs should still pass (may need updates for removed plan selector)

### Existing tenants

`packagesmall` and `khantoys` are test data — no migration needed. If later tenants exist at launch time, decide on retroactive seeding then.

---

## Ready to Start

All 19 product decisions are locked. 9 code PRs + 1 infra PR (PR 0) specified with concrete files, endpoints, and verification steps. Estimated ~4 engineering days total + 15 minutes for PR 0.

**Start with PR 0** (Railway env var alignment) — it's 15 minutes and it fixes 6 silently-broken retail features that would otherwise make PR 2's retail seed half-fake (flags turn features ON in the UI but the workers that power them aren't running).

**Then PR 1** (Free-forever lifecycle) — every subsequent code PR depends on the Free-plan reality being coded correctly.
