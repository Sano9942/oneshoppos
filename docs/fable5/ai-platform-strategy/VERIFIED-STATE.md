# Verified State — AI & Platform — 2026-07-15

Read this file first. It exists because **two external reviews proposed roadmaps for software that
already ships**, and one of them called Business Modules v2 "a good foundation" for a feature that
went live on 2026-07-15 at v137.

**Method:** every ✅ and ❌ below was grepped in source during the session that produced this folder.
Docs were not trusted as evidence. Where source and `CLAUDE.md` disagree, source wins and the
disagreement is recorded in §5.

Companion files: [`PLAN.md`](PLAN.md) (what to build), [`AI-GATEWAY.md`](AI-GATEWAY.md) (how).

---

## 1. Already shipped — do NOT rebuild

Both reviews proposed these as new work. They exist.

| Proposed as new | Reality | Evidence |
|---|---|---|
| "App Marketplace: Restaurant Pack, Wholesale Pack, Clinic Pack…" | **Business Modules v2**, live since 2026-07-15 (v137). 19 module keys, buckets A/B/C, per-outlet activation. | `backend/config/business-modules.js`; `/settings/business-modules` |
| Rentals: availability calendar, deposits, damage, check-in/out, utilization | V09 done | `routes/rentals.js`, `services/rental-service.js`, `services/deposit-engine.js` |
| Hotels: booking, folio, housekeeping, occupancy, night audit | V10 done | `routes/rooms.js`, `services/room-service.js`, `services/room-night-audit.js` |
| Restaurant: recipe costing, menu engineering, KDS analytics | V03 done | `routes/reports/recipe-costing.js`, `menu-engineering.js`, `kds-analytics.js` |
| Wholesale: B2B price lists, credit limits, van sales, loadsheets, COD reconciliation | Tiers 0–2 + V02 done | `routes/price-books.js`, `services/credit.js`, `routes/van.js`, `routes/fulfillment.js` |
| Clinic: treatment-plan templates, packages, deposits | V05 done | `routes/treatment-plan-templates.js`, `routes/packages.js` |
| Country configuration | **Already global-aware** — 8 countries pre-seeded | `backend/config/country-packs.js` — PK, US, GB, CA, AU, IN, AE, SA |
| Per-outlet timezone | Column exists as a seam (falls back to `company_profile.timezone`) | `schema-pg.sql:86-87` — migration 2-R.6 |

**Rule for future sessions:** before writing a roadmap item, grep for it. The reviews that produced
this folder did not.

---

## 2. Exists but shallow — real headroom

| Thing | What's actually there | Headroom |
|---|---|---|
| **AI service** | 176 lines, **two functions**: `generateProductContent`, `extractInvoiceLineItems` | `backend/services/ai.js`. Single platform `ANTHROPIC_API_KEY`, no per-tenant key, no provider abstraction. |
| **Insight cards** | **Descriptive, not prescriptive**: "Revenue This Week", "Top Products This Week", "Low Stock Alerts", "Busiest Hour", "Avg Transaction" | `routes/insights.js`. Decision Center (PLAN §4.2) is a genuine upgrade, not a duplicate. |
| **Credit** | One function, `assertCreditWithinLimit` — a hard gate | `services/credit.js`. No risk scoring, no payment-behaviour model. |
| **Technician assignment** | `assigned_to` employee field only | `routes/service-tickets.js:98`, `services/service-tickets.js:43-73`. No scheduling, no dispatch, no capacity. **Genuine gap** — the one real find in review 2. |
| **Anomaly detection** | z-score worker | `workers/anomaly-worker-boss.js` |
| **Forecasting** | moving average | `routes/inventory-intelligence.js` |

---

## 3. Does NOT exist ❌

| Thing | Consequence |
|---|---|
| **Any route optimization** | Both reviews and the NVIDIA doc discuss cuOpt at length. There is nothing to accelerate. OR-Tools would be the first implementation, not a replacement. Blocks technician dispatch too. |
| **Any i18n layer** | No `react-i18next` / `lingui` / `formatjs` in `frontend/package.json`. Only **2 files** use `Intl.NumberFormat`/`Intl.DateTimeFormat` (`PricingPage.jsx`, `SetupWizard.jsx`). The only `dir="rtl"` in the entire frontend is **one input box** for an Urdu tax description (`pages/admin/AdminTaxRates.jsx:136`). **Every user-facing string is hardcoded English.** |
| **OAuth authorization server** | You are an OAuth *client* only (`routes/integrations/daraz.js`, `facebook.js`, `google-merchant.js`). Claude and ChatGPT connectors require you to *be* an authorization server: authorization code + PKCE + dynamic client registration + discovery. This is the bulk of the MCP work. |
| **Provider abstraction for models** | `services/ai.js` constructs `new Anthropic(...)` directly. No gateway, no adapter, no per-tenant key, no region routing. |
| **Cross-tenant benchmark data** | 29 production tenants, **23 of them are `golv_<industry>` demo tenants you seeded**. Real tenant count ≈ 6. Benchmarks need ~20 tenants per (country × vertical × size band). Not near-term. |

---

## 4. Precedents to copy (not invent)

The codebase already solves most of what the new work needs.

| Need | Existing pattern |
|---|---|
| A third parallel auth scope for MCP | `middleware/customer-auth.js` (153 lines) + `middleware/manufacturer-auth.js` (165 lines). Both mount **before** tenant middleware and resolve tenant via `services/public-tenant-context.js:resolvePublicTenantDb()`. |
| Provider adapters | 13 courier adapters (`services/couriers/`), 4 marketplace clients (`services/marketplace/`), 1 payment gateway (`services/payment-gateway.js`). The pattern is proven three times over. |
| Encrypting tenant-supplied keys (BYOK) | `services/crypto.js` — AES-256-GCM, format `enc:v1:{iv}:{tag}:{ciphertext}`. Already used for Shopify tokens, Daraz/Facebook/WooCommerce keys, courier API keys. |
| Deterministic money/stock writes the model must never bypass | `services/stock-ledger.js` (the ONE on-hand writer), `services/tax-snapshot.js` (the ONE per-line tax cascade) |
| Tax-authority integration to generalize | `services/fbr.js` + `workers/fbr-worker-boss.js` — queue, exponential backoff, IRN + QR, dashboard. Structurally close to India GST. |

---

## 5. Unverified — do NOT quote

- **`routes/ai.js` endpoints.** `CLAUDE.md` says `/api/ai (content/invoice generation)`. A grep for
  `router.(get|post|put)` in that file returned **nothing**. Either a different registration pattern
  or the doc is stale. Resolve before building on it.
- **`recipe-costing`, `menu-engineering`, `kds-analytics`** confirmed by filename in
  `routes/reports/`; contents not read.
- Chart of accounts seeding "21 Pakistan-standard accounts" — doc-sourced
  (`routes/tier4/CLAUDE.md:68`), not source-verified. Carried from
  [`../public-surface-audit/GLOBAL-READINESS.md`](../public-surface-audit/GLOBAL-READINESS.md).

---

## 6. The meta-finding

**The test corpus cannot see any of the global coupling.** Every test tenant is `Asia/Karachi` +
PKR — all 23 `golv_<industry>` tenants plus the four named ones. Nothing ever exercises a non-PK
path, which is structurally why the i18n gap, the night-audit cron, and the currency fallbacks were
invisible until someone grepped for them.

This is why [`PLAN.md`](PLAN.md) §6 makes **one non-PK test tenant** the canary, not the last step.
