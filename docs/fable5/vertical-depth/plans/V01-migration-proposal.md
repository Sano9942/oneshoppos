# V01 Retail Depth — Migration + Seeder Proposal (v114–v116 + signup-path seeder)

> Pause-list stop per completion-spec §5 (migrations + signup path). Approve before any
> migration/seeder code is written. Branch: `feat/v01-retail-depth` off `main` (head v113).
> All migrations tenant-schema-scoped, idempotent (`ADD COLUMN IF NOT EXISTS`), mirrored into
> `schema-pg.sql` — same shape as v100–v113.

## Context (already built on this branch, NO schema)

Ungated foundation is done + unit-tested (35 tests green) and does not need approval:
- **Pure embedded-barcode decoder** — `backend/services/embedded-barcode.js` (authoritative) +
  `frontend/src/utils/embeddedBarcode.js` (instant-feedback mirror). Config-agnostic: takes a
  scheme object, returns `{ok, embed, itemCode, price|weight}` or a typed fall-through reason.
- **Lane-scale adapter** — `frontend/src/utils/scale.js` (Web Serial, generic continuous-mode
  9600-8N1, feature-detected + manual fallback) + a "Weigh" button wired into POSCartTable.
- **Promo harden** — `services/promo-engine.js` now excludes `price_locked` lines from every
  promotion (the single shared choke point for POS-quote/storefront/portal/field-rep).
- **Tare lock** on decoded lines + 4-decimal cartMath tests + offline-snapshot test.

The three items below need columns to *wire* those into the live scan path, PLU, and age-gate.
The seeder item lights up the sub-type presets. **Everything below is what this doc asks you to
approve.**

---

## v114 — barcode-embedded scheme config  ← DECISION on location

```sql
ALTER TABLE company_profile
  ADD COLUMN IF NOT EXISTS barcode_scheme JSONB;   -- NULL = feature off
```

Shape stored (validated by `normalizeScheme`, never trusted raw):
```json
{ "enabled": true, "prefixes": [20,21,22,23,24,25,26,27,28,29],
  "embed": "price", "item_code_length": 5, "value_length": 5,
  "value_decimals": 2, "item_code_field": "sku", "verify_check_digit": true }
```

**Location decision — RECOMMEND `company_profile.barcode_scheme` (one scheme per tenant).**
- `loadCompanyProfile` already caches the whole row into `req.company` (5-min TTL) and ships it to
  the frontend via `useAuth().company` — so both the authoritative scan-route decode and the POS
  instant parse get the scheme with **zero extra queries**.
- A grocery chain prints scale labels from one back-office scheme; per-lane divergence is rare.
- Alternative (`pos_devices.barcode_scheme` per device) rejected as over-engineered for v1 — no
  evidence lanes differ, and it would add a device→scheme fetch on the POS hot path. If a tenant
  ever needs per-lane schemes, a device-level override column can layer on later without moving
  this one.

Wiring after approval (code-only): scan route `/api/products/scan/:barcode` runs
`decodeEmbeddedBarcode(code, req.company.barcode_scheme)` **before** the SKU/barcode lookup;
`price` embed → resolve product by `item_code_field`, return line `{price: decoded, price_locked,
tare_locked, quantity: 1}`; `weight` embed → resolve product, return `{quantity: decoded weight,
tare_locked}` at the shelf unit-price. Unresolved item code → `404 {code: "unmapped_scale_item"}`
(the plan's "unmapped scale item" error, never a silent zero-price line).

---

## v115 — PLU rapid entry

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS plu_code VARCHAR(8);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_plu_code
  ON products (plu_code) WHERE plu_code IS NOT NULL AND deleted_at IS NULL;
```

- `omniInputRouter.js` **already** classifies a 4–5 digit numeric as `kind:"plu"` and routes it to
  `/api/products/scan/:code`. Today that endpoint only matches `barcode`/`sku`, so PLU silently
  404s. Fix (code-only, after approval): extend the scan `WHERE` to
  `(barcode = $1 OR sku = $2 OR plu_code = $3)`.
- Frontend PLU quick-pad panel (grocery/butcher/sweet presets) is ungated UI once the column
  exists; gated on `pos_search_config.show_plu` (config-only, added to industry-config for those
  presets — not a migration).
- Partial unique index = a PLU is unique among live products but frees on soft-delete, mirroring
  the existing `products.sku` partial-unique index (v82).

---

## v116 — age-restricted flag (P2, "if cheap")

```sql
ALTER TABLE products ADD COLUMN IF NOT EXISTS age_restricted BOOLEAN NOT NULL DEFAULT false;
```

One column + one POS confirm modal (cashier attests) on add-to-cart. Include or drop per your call
— it is the cheapest P2 and self-contained. No behavioral change for any existing product
(`DEFAULT false`).

---

## Seeder change (signup path — the P0 flag-seeding decision)

**Verified against code (findings doc was stale):** `routes/setup.js:276` already seeds
`seedRetailFlags` for `general_retail`, **grocery**, and `wholesale`. Only **butcher / sweet_shop /
textile** skip it today. And the `DEFAULT_FEATURE_FLAGS` comments already state the intent:
`batch_expiry_tracking` is *"seeded ON by the retail sub-type presets (grocery/butcher/sweet_shop/
textile)"* and `kit_bom_engine` *"by presets that consume it"* — the seeder was simply never wired
to do it. This proposal wires exactly that.

**Proposed (code-only in `services/retail-flag-preset.js` + `routes/setup.js`, no DDL):**

1. Extend the retail-flag branch to the three missing sub-types:
   ```js
   if (["general_retail","grocery","wholesale","butcher","sweet_shop","textile"].includes(industry_type))
     await seedRetailFlags(client);
   ```
2. New per-preset vertical-engine bundle:
   ```js
   const RETAIL_SUBTYPE_FLAGS = {
     grocery:    ["batch_expiry_tracking"],                    // perishables
     butcher:    ["batch_expiry_tracking", "kit_bom_engine"],  // + carcass disassembly
     sweet_shop: ["batch_expiry_tracking", "kit_bom_engine"],  // + assorted box
     textile:    ["batch_expiry_tracking"],                    // roll/lot (thaan) tracking
   };
   // setup.js: after seedRetailFlags, seedRetailSubtypeFlags(client, industry_type)
   ```

**Why safe to ship ON at signup (same latency argument as the wholesale flags):**
- `batch_expiry_tracking` only *surfaces* batch UI; the real functional gate is per-product
  `products.track_batches` (default false), so no SKU is FEFO-tracked until the owner opts one in.
- `kit_bom_engine` only surfaces the Production/recipe tab; latent until a product is made a kit.
- Neither touches the checkout path for an out-of-the-box tenant.

**Not seeded:** `general_retail` stays as-is (unchanged scope); grocery does **not** get
`kit_bom_engine` (a supermarket doesn't disassemble); textile does **not** get `kit_bom_engine`.

Unit test: extend `backend/tests/unit/retail-flag-preset.test.js` to assert the exact per-preset
sets (guards against drift, same as the existing RETAIL/MULTI_OUTLET assertions).

---

## What is NOT in this proposal (stays on pause / out of scope)

- No FBR/tax change (scale lines carry the product's tax snapshot unchanged).
- No new stock path (F01/F07 own all decrement; V01 only activates them per preset).
- No auth change.
- Exchange-flow depth (P2) — will confirm live first; likely collapses to polish, no schema.
