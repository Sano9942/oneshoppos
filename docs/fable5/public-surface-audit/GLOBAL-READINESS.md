# Global Readiness — PK Coupling Inventory — 2026-07-15

Companion to `REPORT.md`. Triggered by the owner stating the aim is now **global software, usable
anywhere**, not Pakistan-only, and asking (a) whether that changes the audit findings and (b)
whether the Pakistan framing in CLAUDE.md / memory should be changed.

**Status of the pivot itself: direction stated 2026-07-15. Not dated, not formally decided.** I
asked whether it's decided-and-dated or direction-of-travel and did not get an answer before this
was written — so nothing here asserts a commitment. Treat as "direction stated, PK-first today."

Same method/caveats as `REPORT.md`. Everything below marked ✅ was verified in source; the docs
were NOT trusted as evidence.

---

## 1. What the global framing does NOT change

Geography-independent — the `REPORT.md` findings stand exactly as written:

- Unsigned meta/whatsapp/daraz webhooks + the `undefined === undefined` bypass
- `MANUFACTURER_PORTAL_JWT_SECRET` unset → shares `JWT_SECRET`; no scope check in
  `loadTenantAndPerms`
- The OG/social-preview gap (arguably *more* important globally — more sharing platforms)
- `POSContext` `navigate`, KDS chrome, `public-rentals` orphan, dead portal `wallet` tab

## 2. What gets stronger

- **R2 / grey cloud moves UP the list.** `REPORT.md` ranks it 5th as "performance, not security."
  Global changes that: one Railway instance in one region, no CDN, every image streamed from
  origin — a customer in Brazil or Nigeria waits on a cross-continent round trip. Cloudflare R2
  with a custom domain is globally distributed by default. The `R2_PUBLIC_URL` fix is no longer a
  nice-to-have.
- **In-memory state moves up.** "Only matters the day you scale horizontally" was fair for one
  country. Global → multi-region → multi-instance, sooner.

## 3. What FLIPS

**`ADMIN_ALLOWED_IPS` — the recommended fix changes.** `REPORT.md` says "fix = one env var." That
assumed a fixed office IP. An IP allowlist for admins who travel, or a distributed team, is
operationally painful and its failure mode is locking yourself out.

The finding stands (it fails open, silently, and `index.js:308` says so every boot). The fix is now
a genuine decision, not a default:
- keep the allowlist and accept the ops burden, **or**
- lean on TOTP + something like SSO and stop pretending the allowlist is the layer.

**Owner input needed.** Do not just set the var without deciding this.

---

## 4. What global ADDS — verified PK coupling

### 4.1 — Night audit: one global cron tuned to one country ✅ (sharpest)

`backend/workers/night-audit-worker-boss.js:50`:

```js
await boss.schedule("night-audit-run", "0 22 * * *", null, { singletonKey: "night-audit-run" });
```

The file comment states it outright (`:10`): `Cron 0 22 * * * UTC = 3 AM PKT — after the front desk
day closes.`

It is **one cron for all tenants** (note `singletonKey`), tuned to one country's business hours. A
hotel in Mexico City gets its night audit at 4 PM — mid-afternoon, mid-service. **This is a
correctness bug for global lodging**, and the singleton structure means per-timezone scheduling is
a restructure, not a config change.

### 4.2 — Two integrations publish wrong data ✅

- `backend/services/marketplace/google-merchant.js:53-60,102-103` — hardcodes
  `contentLanguage: "en"`, `targetCountry: "PK"`, `currency: "PKR"`.
- `backend/services/marketplace/meta-commerce.js:50-51` — hardcodes
  `price: \`${Math.round(price*100)} PKR\``, `currency: "PKR"`.

A US merchant syncing their catalog would **publish into the Pakistani market**. Not cosmetic —
wrong data sent to Google and Meta.

### 4.3 — Twelve hardcoded currency fallbacks ✅

`|| "PKR"` / `|| "Rs"` fire whenever `company_profile.currency_symbol/currency_code` is null:

`routes/storefront.js:48`, `routes/public-bookings.js:37`, `routes/public-rentals.js:49`,
`routes/public-restaurant.js:161`, `routes/public-rooms.js:50`,
`routes/restaurant/pay-at-table.js:261`, `routes/customer-portal/data.js:109`,
`routes/reports/dashboard.js:619`, `routes/sales.js:2562`, `routes/barcode-expenses.js:702,788`,
`services/aggregator-orders.js:251`.

A fresh non-PK tenant shows "Rs" until someone sets the symbol. Note these are concentrated in the
**public/no-auth routes** — i.e. exactly the customer-facing surfaces this audit is about.

### 4.4 — Structural (not bugs, but global-blocking)

- **`TZ=Asia/Karachi` on Railway** — the *process* timezone is set to a business timezone.
  `utils/pgDateToStr()` exists specifically because of it (`backend/utils/CLAUDE.md:19`: "whenever
  the process TZ is east of UTC (Railway runs `TZ=Asia/Karachi`)"). Global wants `TZ=UTC` with
  per-tenant timezone. **Load-bearing** — the tz-guard suite pins current behavior, so this is a
  careful change, not a flip. See [[report_date_boundary_tz_bug]].
- **FBR is a first-class concept, not an adapter** — the big architectural one. E-invoicing
  mandates are spreading globally (India GST, Brazil NF-e, Italy SDI, Saudi ZATCA, Mexico CFDI,
  Poland KSeF, Turkey). The codebase **already runs the adapter pattern twice** — 13 courier
  adapters, 4 marketplace clients. FBR wants to become the *first tax-authority adapter*, not stay
  a special case.
- **11 of 13 couriers are Pakistani** (leopards, tcs, blueex, trax, callcourier, mnp, postex,
  rider, swyft, bykea, pakpost); only DHL/FedEx are global. Pattern's right, roster's regional.
- **Only xPay is implemented** for payments (Pakistani). Stripe is table stakes globally; the
  adapter seam already exists.
- **Chart of accounts seeds 21 Pakistan-standard accounts** (`routes/tier4/CLAUDE.md:68` —
  doc-sourced, not source-verified).
- **`tax_rate_reference` seeded with Urdu-described HS codes** (`backend/scripts/seed-tax-rates.js`).
- **`normalizePhone` E.164 handles Pakistani local formats** (`services/customer-notify.js`).

### 4.5 — One good sign

**`backend/config/country-packs.js` is ALREADY global-aware** — pre-seeded tax rates per country,
`GET /api/country-packs/:country`, no auth, mounted pre-tenant. The seam exists.

### 4.6 — The meta-finding: the test corpus is PK-blind

Every test tenant is Asia/Karachi + PKR — all 23 `golv_<industry>` tenants plus the four named ones
([[production_state]], [[livetestauto_credentials]], [[restaurant_test_tenant]],
[[cafe_test_tenant]], [[wholesale_test_tenant]]).

**Nothing in the test corpus ever exercises a non-PK path.** That is structurally why all of the
above is invisible.

> **Highest-leverage single move:** one test tenant in a **negative-UTC-offset** timezone on USD
> (e.g. America/Los_Angeles). It would surface the night audit, the TZ coupling, and the currency
> fallbacks on its own — converting an invisible class into visible failures. The negative offset
> matters: that's where the date-boundary bugs invert.

### Not checked

- i18n / translation layer — never looked. Everything observed is English-only.
- `PlanLimitModalInterceptor.jsx` hardcoding "8000 PKR/month per outlet" —
  `frontend/src/components/CLAUDE.md:113` claims it; a grep for `8000 PKR` in source found
  **nothing**. Either the doc is stale or it's formatted differently. **Unverified — do not quote.**
- Date/number formats, address formats, RTL.

---

## 5. The docs question — do NOT find-replace "Pakistan"

**The trap:** the docs are not wrong. `google-merchant.js` really does hardcode
`targetCountry: "PK"`. The COA really does seed Pakistani accounts. `TZ` really is `Asia/Karachi`.

Stripping "Pakistan" out of CLAUDE.md would make the docs **lie** about a codebase that is still,
factually, PK-coupled — and the next session would read them, believe it's global, and ship a US
tenant into Google Merchant PK. **That is worse than leaving it.**

Three different things are tangled together:

| Category | Action | Examples |
|---|---|---|
| **Strategy / aspiration** | **Change** — intent has moved | root `CLAUDE.md:334` "Pakistan-market wedge"; memory `tier0_wholesale_complete` "next work item is Tier 1 — Pakistan wedge"; `tier11_wholesale_field_sales_complete` "first piece of Pakistan wedge live"; `tax_architecture` "Pakistani POS tax model" |
| **Descriptive fact** | **Keep, but reframe** from "what we are" → "what we must unwind" | "11 of 13 couriers are Pakistani"; `TZ=Asia/Karachi`; Urdu HS codes; `targetCountry: "PK"`; "21 Pakistan-standard accounts"; `phase5-pakistan` smoke spec |
| **Code** | **The actual work** — no doc edit touches it | §4 above |

**Recommended approach** (not yet executed): keep every descriptive reference, change only the
handful of genuine strategy lines in row 1, and let this file serve as the gap list that reframes
the rest. Same facts, new frame — the Pakistan references become a worklist rather than an
identity.

---

## 6. Suggested order (global lens)

This **supersedes** `REPORT.md`'s ordering if the global pivot is confirmed:

1. **A non-PK test tenant** (negative UTC offset, USD) — makes the rest visible instead of theoretical.
2. **Night audit cron** — an actual correctness bug for any non-PK lodging tenant.
3. **Google Merchant + Meta hardcodes** — wrong data leaving the system to third parties.
4. **`ADMIN_ALLOWED_IPS`** — but decide allowlist-vs-SSO first (§3).
5. `MANUFACTURER_PORTAL_JWT_SECRET` + scope check — unchanged from `REPORT.md`.
6. Webhook signatures — unchanged.
7. **`R2_PUBLIC_URL` + R2 custom domain** — promoted; latency is a global product problem.
8. Currency fallbacks — cosmetic but concentrated on customer-facing surfaces.
9. **`TZ=Asia/Karachi` → UTC** — careful, load-bearing, needs the tz-guard suite green.
10. **FBR → tax-authority adapter** — the strategic one; not urgent, but it shapes every later
    compliance integration.
