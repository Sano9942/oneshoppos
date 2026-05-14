# Tier 1.4 — Secondary Sales Tracking (manufacturer portal)

**Status:** Scoping complete 2026-05-16. Verified against live schema 2026-05-16. Day 1 in progress.
**Budget:** 1.5-2 weeks per master reference.
**Migration target:** v94.

## Verified facts (live tenant `wholesalewalktest1778451`, 2026-05-16)

- `schema_version = 93` ✓
- `promotions` has `tier_rules` (jsonb), `brand_id` (int), `priority` (int) ✓
- `sale_promotion_applications` columns: `id, sale_id, promotion_id, promotion_name_snapshot, promotion_type_snapshot, qty_qualifying, discount_value, tier_snapshot, created_at` — **NO `product_id` column.** Discount is sale-level only. **Fallback engaged: `/promotions` route surfaces scheme-level totals; `/sales` route omits the per-line `scheme_discount` column** (or shows it only at the sale-aggregate level, not per-product).
- `feature_flags` shape: `(key TEXT PK, enabled BOOLEAN, description TEXT, updated_by, updated_at)` — **NOT** `(key, value)` as the original draft stated. Insert syntax: `INSERT INTO feature_flags (key, enabled, description) VALUES (..., false, '...')`.
- `brands` table: `(id SERIAL PK, name UNIQUE, description)` ✓
- `customers.city` populated for 4/5 test customers ("Karachi"); Test Distributor is NULL → "Unspecified" bucket.
- **All 3 test products have `brand_id = NULL`** — walkthrough setup must create a brand "Bulk Brand Co" and assign Bulk A + Bulk B to it before manufacturer-partner reports will show data.
- `customer_portal_refresh_tokens` shape includes `last_used_at`, `user_agent`, `ip` — mirror these on `manufacturer_portal_refresh_tokens`.
- `customers` portal columns use prefix `portal_` (e.g. `portal_password_hash`, `portal_enabled_at`). Since manufacturer_partners is a new table, columns can be unprefixed.

---

## What we're building

A **manufacturer portal** — a parallel auth scope to the existing customer portal — where distributors invite their manufacturer-partners (Tapal, Coca-Cola, Unilever, etc.) to see real-time, **aggregate** secondary sales of **their brand SKUs** through this distributor, sliced by day / SKU / region, with **promotion breakdown** showing how schemes drove (or didn't drive) volume on their brand. Retailer identities are never exposed. Free upsell to the distributor, gated by `wholesale_secondary_sales` flag.

This is the killer FMCG-side feature that no global player has and Pakistan incumbents (SAMS, SalesFlo) already bundle. Combined with our existing FBR queue + the field-rep app shipped in Tier 1.1, it widens the Pakistan wedge into a position where no other vendor matches the full stack.

---

## Scoping decisions (locked 2026-05-16)

| # | Decision | Choice |
|---|---|---|
| 1 | Access model | Dedicated portal w/ login — parallel to customer portal |
| 2 | Data exposure | Aggregates only, retailer identity never exposed |
| 3 | Sales scope | Only sales of that brand's SKUs (mapped via `products.brand_id`) |
| 4 | Pricing | Free upsell, gated by `wholesale_secondary_sales` flag |
| 5 | Granularity | Brand × SKU × day × region (`customers.city`) |
| 6 | Onboarding | New `manufacturer_partners` table, admin invites by email |
| 7 | Freshness | Real-time queries against `sales` + `sale_items`, no rollup table |
| 8 | Promo breakdown | Yes — gross / scheme discount / net via `sale_promotion_applications` |

---

## Architecture

### Auth — parallel to customer portal

The customer portal at [backend/middleware/customer-auth.js](../../backend/middleware/customer-auth.js) is the reference architecture. Manufacturer portal mirrors it precisely:

- **JWT scope:** `"manufacturer"` (rejected by staff middleware, customer middleware, and vice versa)
- **JWT secret:** new env var `MANUFACTURER_PORTAL_JWT_SECRET` (falls back to `JWT_SECRET` with one-time warning, same pattern as customer)
- **TTLs:** access `15m` (shorter than customer because aggregated brand sales is more sensitive), refresh `30d`
- **Token payload:** `{ mid, tid, tslug, scope: "manufacturer", jti }` — `mid` = manufacturer_partner id
- **Middleware:** new `backend/middleware/manufacturer-auth.js` exporting `loadManufacturerAuth(deps)`, `signManufacturerTokens()`, `verifyManufacturerToken()`, `hashRefreshToken()`. Sets `req.manufacturerId`, `req.tenantId`, `req.tenant`, `req.db`. Never sets `req.employee`.
- **Rate limiter:** new `manufacturerPortalAuthLimiter`, `manufacturerPortalOtpLimiter`, `manufacturerPortalDataLimiter` in `middleware/rate-limit.js` keyed on `?tenant=` / `x-tenant-slug` header (same pattern as customer)
- **Revocation cursor:** `manufacturer_partners.portal_tokens_revoked_before` column (same shape as `customers.portal_tokens_revoked_before`)
- **Mount point:** before `loadTenantAndPerms`, after `webhooks`. Tenant DB routing via `resolvePublicTenantDb()` from `services/public-tenant-context`

### Schema (migration v94)

```sql
-- New table: manufacturer-partner directory per tenant
CREATE TABLE IF NOT EXISTS manufacturer_partners (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT NOT NULL,
  password_hash TEXT,                      -- NULL until first signup
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended')),
  signup_token TEXT,                       -- one-time invite token, NULL after first use
  signup_token_expires_at TIMESTAMPTZ,
  portal_tokens_revoked_before TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(email)
);

-- Join table: which brands does each partner monitor?
CREATE TABLE IF NOT EXISTS manufacturer_partner_brands (
  manufacturer_partner_id INTEGER NOT NULL REFERENCES manufacturer_partners(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (manufacturer_partner_id, brand_id)
);

-- Refresh tokens (mirrors customer_portal_refresh_tokens exactly)
CREATE TABLE IF NOT EXISTS manufacturer_portal_refresh_tokens (
  id SERIAL PRIMARY KEY,
  manufacturer_partner_id INTEGER NOT NULL REFERENCES manufacturer_partners(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_mfg_portal_refresh_partner
  ON manufacturer_portal_refresh_tokens (manufacturer_partner_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_manufacturer_partners_email ON manufacturer_partners(email);
CREATE INDEX IF NOT EXISTS idx_manufacturer_partner_brands_brand ON manufacturer_partner_brands(brand_id);

-- Performance: index for the hot path (brand-filtered sale_items joined to sales)
CREATE INDEX IF NOT EXISTS idx_sale_items_product_sale ON sale_items(product_id, sale_id);
-- (sales already has timestamp index; sale_items.product_id likely indexed — verify before shipping)

-- Feature flag seed (note: column is `enabled`, not `value`)
INSERT INTO feature_flags (key, enabled, description) VALUES
  ('wholesale_secondary_sales', false,
   'Tier 1.4 wholesale — manufacturer-partner portal for secondary sales visibility')
ON CONFLICT (key) DO NOTHING;
```

Also added to `DEFAULT_FEATURE_FLAGS` in `middleware/feature-flags.js` (default OFF — opt-in per tenant, same as `wholesale_field_sales`, `wholesale_schemes`).

### Backend routes

**Manufacturer-facing (public mount, manufacturer JWT auth):**

```
POST   /api/manufacturer-portal/auth/setup        — claim invite token, set password
POST   /api/manufacturer-portal/auth/login        — email + password → tokens
POST   /api/manufacturer-portal/auth/refresh      — refresh access token
POST   /api/manufacturer-portal/auth/logout       — revoke refresh token
GET    /api/manufacturer-portal/me                — own profile + assigned brands
GET    /api/manufacturer-portal/summary           — dashboard cards (today / 7d / 30d totals, top SKU)
GET    /api/manufacturer-portal/sales             — Brand×SKU×day×region rollup with filters
                                                    ?from=&to=&brand_id=&region=&group_by=day|sku|region
GET    /api/manufacturer-portal/promotions        — scheme impact: gross vs discount vs net per scheme
GET    /api/manufacturer-portal/sales.csv         — CSV export of /sales response
```

All `/sales` and `/promotions` queries enforce: `WHERE products.brand_id IN (SELECT brand_id FROM manufacturer_partner_brands WHERE manufacturer_partner_id = $1)`. Retailer-identifying columns (`customer_id`, `customer_name`, `customer_phone`) are never selected. Region is `customers.city` (already populated in onboarding flow; NULL → "Unspecified" bucket).

**Admin-facing (tenant employee auth, `manage_inventory` perm + `wholesale_secondary_sales` flag):**

```
GET    /api/admin/manufacturer-partners              — list partners + brand counts
POST   /api/admin/manufacturer-partners              — create partner + send invite email
GET    /api/admin/manufacturer-partners/:id          — detail + brand list
PUT    /api/admin/manufacturer-partners/:id          — update name/email/status/brands
DELETE /api/admin/manufacturer-partners/:id          — soft-delete (status='suspended', cascades to refresh tokens)
POST   /api/admin/manufacturer-partners/:id/resend   — regenerate signup_token and resend email
```

### Email templates

One new template added to `services/email-templates.js`:

- `manufacturer_partner_invite` — sent when admin creates a partner. Subject: "[Distributor Name] has invited you to view sales of your brand". Body has a magic link `https://sanopos.com/manufacturer-portal/setup?token=...&tenant=slug`. Token expires in 7 days.

Sender: tenant-scoped `slug@sanopos.com` (added to `TENANT_TYPES` in `services/email.js`).

### Frontend

New route tree under `/manufacturer-portal/*` (separate from `/portal/*` customer portal):

```
/manufacturer-portal/login                    — email + password
/manufacturer-portal/setup?token=             — first-time password setup
/manufacturer-portal/                         — dashboard (summary cards: today, last 7d, last 30d, top SKU)
/manufacturer-portal/sales                    — Brand×SKU×day×region table with filters, CSV export
/manufacturer-portal/promotions               — scheme-impact breakdown
```

Provider: new `ManufacturerPortalAuthProvider` mirroring `PortalAuthProvider`. Session in `localStorage` keyed `sanopos_mfg_portal_<slug>`.

Admin-side: new page under `/settings/manufacturer-partners` in the existing tenant admin UI. Reuses the SectionCard + Button pattern from `BillingRedesign.jsx` and `IntegrationsHubRedesign.jsx`. Gated by `useFeatureFlags().flags.wholesale_secondary_sales`.

---

## Hot query shape

The core query for `/sales?group_by=day&from=2026-04-01&to=2026-04-30` — **gross only, no scheme discount per-line** (decision below):

```sql
SELECT
  DATE(s.timestamp AT TIME ZONE $1) AS day,
  COALESCE(c.city, 'Unspecified') AS region,
  p.brand_id,
  p.id AS product_id,
  p.name AS product_name,
  SUM(si.quantity) AS qty,
  SUM(si.price * si.quantity) AS gross_revenue
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN products p ON p.id = si.product_id
LEFT JOIN customers c ON c.id = s.customer_id
WHERE p.brand_id = ANY($2)
  AND s.timestamp >= $3 AND s.timestamp < $4
  AND s.status NOT IN ('voided','cancelled')
GROUP BY day, region, p.brand_id, p.id, p.name
ORDER BY day DESC, region, p.name
```

(`$1` = tenant timezone, `$2` = array of brand_ids, `$3/$4` = UTC bounds via `toUtcStart/toUtcEnd`. Verify `sale_items` actual column for line revenue — likely `price` × `quantity` or a precomputed `subtotal` column. Day-1 task before writing the route.)

**Index coverage to verify before shipping:** `sale_items(product_id, sale_id)`, `sales(timestamp)`, `products(brand_id)`. The first one is the new index in the migration; latter two should exist. EXPLAIN ANALYZE on the test tenant before claiming the work is live.

**Promotion attribution — fallback engaged (verified 2026-05-16):**

`sale_promotion_applications` is sale-level only (no `product_id`). This means we **cannot** blend per-line scheme discount into the `/sales` response. The design adapts as follows:

- `/sales` returns gross revenue + qty per (brand × SKU × day × region). No `scheme_discount` or `net_revenue` columns at the line level.
- `/promotions` returns **scheme-level totals** scoped to schemes that touched the manufacturer's brands: `SELECT spa.promotion_name_snapshot, spa.promotion_type_snapshot, SUM(spa.discount_value) AS total_discount, COUNT(*) AS sales_count FROM sale_promotion_applications spa JOIN sales s ON s.id = spa.sale_id JOIN sale_items si ON si.sale_id = s.id JOIN products p ON p.id = si.product_id WHERE p.brand_id = ANY($brand_ids) AND s.timestamp BETWEEN $from AND $to GROUP BY spa.promotion_name_snapshot, spa.promotion_type_snapshot`. This still answers "what schemes drove discount on my brand and how much" — just at the scheme level, not the per-SKU level.
- `/summary` dashboard cards: total qty, total gross revenue, total scheme discount on brand (via the same join), top 5 SKUs.

Net effect: manufacturer still sees scheme impact, but as "Scheme X earned retailers Rs 47K in discounts on sales that included your brand" rather than "Scheme X cut Rs 12K off your SKU specifically." Acceptable for v1. Document in user-facing copy.

---

## Build order (within the 1.5-2 week budget)

| Day | Work |
|---|---|
| 1 | **Schema verified (2026-05-16):** spa is sale-level only (fallback engaged), feature_flags is `(key, enabled, description)`, test tenant products have brand_id=NULL (walkthrough setup step). Now: write migration v94 (DDL + flag seed + index). Apply to test tenant via Supabase MCP. Verify `wholesale_secondary_sales` is OFF on prod, ON on test tenant after migration runs. Verify `sale_items` line-revenue column name (`price` × `quantity` vs `subtotal`). |
| 2 | `manufacturer-auth.js` middleware + rate limiters + Zod schemas. Unit test the middleware. |
| 3 | Auth routes (`setup`, `login`, `refresh`, `logout`). Email template + send. |
| 4-5 | Data routes (`me`, `summary`, `sales`, `promotions`, `sales.csv`). EXPLAIN ANALYZE the hot query on test tenant data. |
| 6 | Admin routes (CRUD + invite resend). Audit perms (this is a new portal scope — apply the "audit new role" rule from memory). |
| 7-8 | Frontend portal pages (login + setup + dashboard + sales + promotions). |
| 9 | Admin UI page under `/settings/manufacturer-partners`. |
| 10 | E2E walkthrough: invite a manufacturer-partner, set password, log in, verify reports against direct SQL on `sales` + `sale_items`. Capture any 401/403/perm gaps. |
| Buffer | Hotfixes from the walkthrough (Tier 1.2 ate 4 hotfixes, Tier 1.3 ate 1 — budget for 2-3 here). |

---

## Done-when criteria

1. Migration v94 lands on prod, all active tenants on v94, `wholesale_secondary_sales` flag exists everywhere.
2. Test tenant `wholesalewalktest1778451` has one manufacturer-partner ("Bulk Brand Co" mapped to brand_id of Bulk A/B) with portal access. Login works, dashboard shows the 5 existing sales bucketed by day/region.
3. Distributor admin can invite + edit + suspend manufacturer-partners from `/settings/manufacturer-partners`.
4. Promotion breakdown surfaces Tier 1.3's Rs 12K scheme discount on the Bulk A sale.
5. No retailer identity (customer_id, customer_name, customer_phone, address) appears in any portal API response. Grep-verified.
6. CSV export works and reuses `downloadCsv`.
7. Cross-tenant replay rejected (manufacturer JWT from tenant A → 401 on tenant B).
8. Master reference + handoff doc updated to mark Tier 1.4 SHIPPED.

---

## Out of scope (deferrable to Tier 1.4.5 or later)

- **Transaction-level visibility** for premium manufacturer relationships (decided against for v1; revisit when a real distributor asks for it as a per-partner toggle).
- **Primary purchase reconciliation** — linking `suppliers` ↔ `manufacturer_partners` so the partner sees "you bought X from us, sold Y, gap Z." Requires new schema and is a meaningful feature on its own.
- **Manufacturer-side billing** (paid seat per partner). Deferred until 3+ manufacturers have asked.
- **Nightly rollup table** for performance. Add only when EXPLAIN ANALYZE shows the live query > 500ms on real data.
- **Rep-level rollups** (which field rep moved which brand). Possible follow-up once enough field-visits accumulate.
- **Region by GPS** rather than `customers.city`. Defer until a customer asks for tighter geography.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Distributor accidentally exposes retailer identities | Every portal SELECT goes through a shared `getAggregatedSales()` helper that explicitly omits PII columns. Grep test in CI: any `manufacturer-portal/*` route file selecting `customer_id`/`customer_name`/`customer_phone` fails the lint. |
| Cross-tenant token replay | Manufacturer JWT carries `tid` claim, middleware enforces match against resolved tenant. Mirrors the customer portal's existing protection. |
| Performance on tenants with 100K+ `sale_items` | The hot-path index (`sale_items(product_id, sale_id)`) lands in v94. EXPLAIN ANALYZE on test tenant + spot-check on the largest active tenant before claiming live. Fall back to nightly rollup only if needed. |
| `sale_promotion_applications` doesn't have `product_id` | Day 1 verification step. If true, `/promotions` is scheme-level only and `/sales` drops the discount column. Update design doc + ship. |
| Manufacturer logs in, sees zero data, churns | First-load empty state explains: "No sales recorded for your brands in this period. Sales of Bulk A / Bulk B will appear here as the distributor records them." Plus an "Invite distributor to start logging" CTA that pings tenant admin. |
| Distributor disables the flag mid-relationship | Manufacturer portal returns 403 on every data route; login page shows "This portal has been disabled by the distributor." No hard delete of `manufacturer_partners` rows — re-enabling restores access. |

---

## Decision log entry (for memory after ship)

After ship, add a memory:
- `tier14_secondary_sales_complete.md` — what shipped, migration version, key endpoints, test partner credentials, scoping decisions retained verbatim.
- Update `MEMORY.md` index.
- Update `sanopos-wholesale-master-reference.md` Tier 1.4 row to ✅ SHIPPED.
- Update `retail_surface_anchors.md` migration count + table count.
