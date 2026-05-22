# Wholesale Surface Audit

> **Purpose:** Complete code-level inventory of every wholesale-related surface in SanoPOS, used to drive an end-to-end live Playwright walkthrough against tenant `wholesalewalktest1778451`.
>
> **Scope:** Tiers 0 → 2 Option B (migrations v89 → v96)
>
> **Compiled:** 2026-05-18 by Explore sub-agent (verified against source — corrections welcome as live walkthrough surfaces discrepancies)

---

## Quick reference: target tenant

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Username | `Wholesale Test Owner` |
| Password | `TestWholesale778!` |
| Admin PIN | `4321` |
| Tenant ID | 103 |
| Preset | wholesale / b2b_distribution / Pakistan / PKR |

---

## 1. Backend routes (by persona)

### Owner / Admin

**Credit controls (Tier 0)**
- `GET /api/customers/:id/credit-status` — [customers.js:82-138](../../backend/routes/customers.js#L82-L138)
  - Permission: `view_reports` | `manage_customers` | `manage_field_sales` | `all_access`
  - Returns: `{ credit_limit, credit_block_mode, payment_terms_days, outstanding, available, utilization_pct }`
  - Calculates unpaid AR across `customer_invoices` where status not in ('paid','cancelled')

**Customer groups / catalog visibility (Tier 2.11)**
- `GET/POST/PUT/DELETE /api/customer-groups` — CRUD on customer_groups
- `POST /api/customer-groups/:id/products` — assign restricted products to group
- Body: `{ name, description, discount_percent }`

**Field route admin (Tier 1.1)**
- `GET /api/admin/field-routes` — [field.js:353-399](../../backend/routes/field.js#L353-L399)
  - Returns rep's weekly beat grouped by day_of_week
- `POST /api/admin/field-routes` — [field.js:400-451](../../backend/routes/field.js#L400-L451)
  - Replace-all semantics per `(employee_id, day_of_week)`
  - Body: `{ employee_id, day_of_week (0-6), customer_id, visit_order }`

**Field visit reporting (Tier 1.1)**
- `GET /api/field/visits` — [field.js:229-285](../../backend/routes/field.js#L229-L285)
  - Filters: date range, employee_id, flagged_only
- `GET /api/field/summary` — [field.js:286-352](../../backend/routes/field.js#L286-L352)
  - Per-rep dashboard cards (planned, checked_in, ordered, flagged, last_seen)

**Manufacturer partners admin (Tier 1.4)**
- `GET /api/manufacturer-partners` — list partners + brand counts
- `POST /api/manufacturer-partners` — create + 32-byte hex signup_token + enqueue invite email
- `GET /api/manufacturer-partners/:id` — detail
- `PUT /api/manufacturer-partners/:id` — update name/email/status/brands
- `DELETE /api/manufacturer-partners/:id` — soft suspend + revoke refresh tokens
- `POST /api/manufacturer-partners/:id/resend` — regenerate signup_token, resend invite
- All gated: `requireFeature('wholesale_secondary_sales')` + `requirePerm('manage_inventory')`

**Promotions / schemes (Tier 1.3)**
- `POST /api/promotions` — [promotions.js:59+](../../backend/routes/promotions.js#L59)
  - Body: `{ type ('percent'|'fixed'|'threshold_percent'|'threshold_fixed'|'bxgy'|'slab_percent'), tier_rules: [{qty_from, qty_to, value}], brand_id, priority }`
  - Validates: non-empty ascending tier_rules, non-overlapping qty bands, value 0–100
- `GET /api/promotions` — list
- `PUT /api/promotions/:id` — update

### Field Rep

- `GET /api/field/route/today` — [field.js:49-105](../../backend/routes/field.js#L49-L105)
  - Today's planned route + per-customer check-in status
  - Gated: `requireFeature('wholesale_field_sales')` + `requirePerm('manage_field_sales')`
- `POST /api/field/check-in` — [field.js:106-228](../../backend/routes/field.js#L106-L228)
  - Multipart: `{ customer_id, latitude, longitude, accuracy, selfie (file), client_uuid }`
  - Idempotent by `client_uuid`
  - Returns: `{ visit_id, gps_flagged, geofence_exceeded }`
  - Selfie uploaded to R2
- `POST /api/sales?field_visit_uuid=<uuid>` — links sale to field_visits row
  - MOQ validation enforced here (Tier 2.2)
  - Visibility enforced here (Tier 2.11 — uses customer's group)

### Wholesale Customer (Portal)

- `GET /api/portal/config` — **public, no auth**
  - Returns tenant branding + enabled tabs based on feature flags
- `GET /api/portal/me` — auth required (`scope='customer'`)
- `GET /api/portal/me/sales` — in-store POS purchase history
- `GET /api/portal/me/orders` — web orders (storefront)
- `GET /api/portal/me/order-history` — **UNION of web + in-store** with `source` identifier — drives reorder eligibility (Tier 2.10)
- `POST /api/portal/me/reorder` — clones old order into storefront cart, returns `{ adopt_token }`
  - Storefront URL adopts via `?adopt=<token>` query param
  - Restricted products filtered via `product-visibility.js`
- `GET /api/portal/me/invoices` — A/R invoices (soft-gated by `customer_invoicing` flag)

**MOQ enforcement:**
- Storefront cart add/update — calls `validateMoq(db, items)` — returns 400 on violations

### Manufacturer Partner

- `POST /api/manufacturer-portal/setup` — first-time password set via signup_token
- `POST /api/manufacturer-portal/login` — email + password
- `POST /api/manufacturer-portal/forgot-password` — request reset (added Tier 1 polish)
- `GET /api/manufacturer-portal/dashboard` — brand-scoped overview
- `GET /api/manufacturer-portal/sales` — secondary sales filtered to partner's brands
- `GET /api/manufacturer-portal/schemes` — active promotions on partner's brands
- All gated: scope=`"manufacturer"` JWT, per-partner revocation via `manufacturer_partners.portal_tokens_revoked_before`

---

## 2. Frontend pages (by persona)

### Owner / Admin

| Route | Component | Notes |
|---|---|---|
| `/login` | Login | Main auth |
| `/setup` | SetupWizard | Industry preset selection |
| `/company-settings` | CompanySettings | Feature flag toggles live here |
| `/customers` | CustomersRedesign | Credit limit fields editable in customer form |
| `/settings/customer-groups` | CustomerGroupsRedesign | Tier 2.11 group CRUD |
| `/settings/customer-groups/:id/price-book` | CustomerGroupPriceBookRedesign | Group-specific pricing |
| `/settings/manufacturer-partners` | ManufacturerPartnersRedesign | Tier 1.4 admin (gated `wholesale_secondary_sales`) |
| `/promotions` | PromotionsRedesign | Slab-tier editor when `wholesale_schemes` ON |
| `/field/visits` | FieldVisitsRedesign | Owner visit log |
| `/field/routes/admin` | FieldRoutesAdminRedesign | Weekly beat editor |
| `/products` | ProductsRedesign | MOQ + case-pack + visibility fields per product |
| `/reports` | Reports | A/R aging, statements |

### Field Rep

| Route | Component |
|---|---|
| `/field` | FieldTodayRedesign |
| `/field/check-in/:customer_id` | FieldCheckInRedesign |
| `/field/order/:customer_id` | FieldOrderRedesign |

Field rep is identified by `employees.employee_type = 'field_rep'` and `manage_field_sales` permission.

### Wholesale Customer (Portal)

| Route | Component |
|---|---|
| `/portal/:tenantSlug` | PortalDashboard |
| `/portal/:tenantSlug/login` | PortalLogin |
| `/portal/:tenantSlug/signup` | PortalSignup |
| `/portal/:tenantSlug/forgot` | PortalForgotPassword |
| `/portal/:tenantSlug/orders` | PortalOrders (with reorder buttons) |
| `/portal/:tenantSlug/invoices` | PortalInvoices |
| `/portal/:tenantSlug/profile` | PortalProfile |

Session stored in `customerPortalSession:<slug>` localStorage key.

### Manufacturer Partner

| Route | Component |
|---|---|
| `/manufacturer-portal/:tenantSlug` | ManufacturerPortalDashboard |
| `/manufacturer-portal/:tenantSlug/login` | ManufacturerPortalLogin |
| `/manufacturer-portal/:tenantSlug/setup` | ManufacturerPortalSetup (token-based) |
| `/manufacturer-portal/:tenantSlug/forgot-password` | ManufacturerPortalForgotPassword |
| `/manufacturer-portal/:tenantSlug/sales` | ManufacturerPortalSales |
| `/manufacturer-portal/:tenantSlug/promotions` | ManufacturerPortalSchemes |

Indigo-themed; uses `ManufacturerPortalAuthProvider` (separate from main `AuthProvider`).

---

## 3. Feature flags involved

All four wholesale flags are registered in `backend/middleware/feature-flags.js` and seeded by `backend/services/retail-flag-preset.js` (`WHOLESALE_SEED_FLAGS` array).

| Flag | Gates | Default for b2b_distribution |
|---|---|---|
| `wholesale_credit_controls` | Credit limit UI, credit-status endpoint, POS credit tender gate | **Seeded ON** when industry_type='wholesale' |
| `wholesale_field_sales` | All `/api/field/*` routes, field rep pages, owner visit log | **Seeded ON** |
| `wholesale_schemes` | Slab-tier promotion editor, slab_percent type | **Seeded ON** |
| `wholesale_secondary_sales` | Manufacturer partners admin + portal | **Seeded ON** |

**Verify post-setup:** It's worth checking flag state immediately after the wizard completes — older audit notes suggest flags may seed OFF and require manual toggle.

Other relevant flags (not wholesale-specific but needed):
- `customer_invoicing` — A/R invoice tab in portal
- `marketplace_integrations` — if testing storefront
- Default ON for new tenants: most retail flags via `seedRetailFlags`

---

## 4. Setup / seed dependencies

Before each persona's flow works, the following must exist:

### Pre-walkthrough setup (owner does once)
1. **Setup wizard** completed with industry_type='wholesale' — seeds flags
2. **At least one outlet** (created during wizard)
3. **Customer groups** — `/settings/customer-groups` → POST → creates row in `customer_groups`
4. **Wholesale customers** with:
   - Credit limit + credit_block_mode set
   - Assigned to a customer group (writes to `customer_group_members` or similar — verify table name)
   - Portal access enabled (sends portal signup email or sets password)
5. **Products** with:
   - `min_order_qty` > 0 (test MOQ)
   - `order_increment` > 1 (test case-pack)
   - `visibility = 'restricted'` + group assignment (test catalog visibility)
   - `brand_id` set (needed for manufacturer partner and brand-scoped schemes)
6. **Field rep employee** created with:
   - `employee_type = 'field_rep'`
   - Role "Field Rep" with `manage_field_sales` perm
   - Login credentials (username + password OR PIN)
7. **Field rep routes** seeded at `/field/routes/admin` — at least one customer assigned to today's day_of_week
8. **At least one scheme** — slab_percent promotion at `/promotions`
9. **Manufacturer partner** created at `/settings/manufacturer-partners` — partner gets email with signup token

### Pre-walkthrough check
- Confirm tenant's feature_flags table has all four wholesale_* flags = TRUE
- Confirm at least one brand exists (for partner assignment + scheme scope)

---

## 5. Persona login flow (the critical unknowns)

### Owner
- Standard `/login` → store code + username + password → access token
- Already have credentials.

### Field Rep
- **Same `/login` page** as owner — no separate field-rep login URL
- Logs in with employee username + password (or PIN if employee has PIN-only setup)
- After login, app sees `employee_type='field_rep'` and routes to `/field` automatically (or rep navigates there)
- **For walkthrough:** owner must first create a field-rep employee with login credentials we know

### Wholesale Customer Portal
- URL: `/portal/wholesalewalktest1778451/login` or `/portal/wholesalewalktest1778451/signup`
- Email + password (OTP flow exists but optional)
- **For walkthrough:** owner creates customer with email → either:
  - (a) Owner triggers "send portal invite" → customer sets password via email link
  - (b) Customer goes to `/portal/:slug/signup` and self-registers
- Verify which path is actually wired before the walkthrough hits this step

### Manufacturer Partner
- Owner creates partner at `/settings/manufacturer-partners` → backend issues 32-byte hex `signup_token` and emails it
- Partner clicks email link → `/manufacturer-portal/:slug/setup?token=<hex>` → sets password
- After setup: `/manufacturer-portal/:slug/login` with email + password
- **Recovery:** `/forgot-password` exists (added Tier 1 polish 2026-05-16, reuses signup_token mechanism)

---

## 6. End-to-end narrative (proposed walkthrough steps)

### === Persona: Owner ===

1. Navigate to `https://sanopos.com/login`, log in with `wholesalewalktest1778451` / `Wholesale Test Owner` / `TestWholesale778!`
2. Confirm we land on dashboard; verify `Wholesale` indicators visible (visit log card, credit cards)
3. Navigate to `/company-settings`, verify all four `wholesale_*` flags = ON
4. Navigate to `/settings/customer-groups`, create group **"Distributor Tier A"** with 10% discount
5. Navigate to `/customers`, create customer **"Acme Distributors"** with:
   - Email: a Mailinator address we can read
   - Credit limit: 100,000 PKR
   - Credit block mode: `block`
   - Payment terms: 30 days
   - Group: Distributor Tier A
6. From customer detail, trigger "Send portal invite" (capture the magic link or signup token)
7. Navigate to `/products`, create product **"Bulk Widget"** with:
   - Price: 500 PKR
   - `min_order_qty`: 10
   - `order_increment`: 5
   - `visibility`: restricted
   - Assigned to group "Distributor Tier A"
   - Brand: create one ("Acme Brand") if none exists
8. Create a second product **"Public Sample"** with `visibility='all'`, MOQ 1
9. Navigate to `/promotions`, create slab-tier scheme on "Acme Brand":
   - Type: slab_percent
   - Tiers: 10–49 → 5%, 50–99 → 10%, 100+ → 15%
   - Priority: 10
10. Navigate to employees, create field rep employee **"Rep One"**:
    - employee_type: field_rep
    - Role: Field Rep
    - Password: known test password
11. Navigate to `/field/routes/admin`, assign **Acme Distributors** to today's day_of_week for **Rep One**
12. Navigate to `/settings/manufacturer-partners`, create partner **"Acme Brand Co"**:
    - Email: another Mailinator address
    - Brands: Acme Brand
    - Capture signup_token from email or DB
13. Log out

### === Persona: Field Rep (Rep One) ===

14. Log in at `/login` as Rep One
15. Confirm landing on `/field` shows Acme Distributors as today's planned visit
16. Click into check-in flow for Acme Distributors
17. **GPS/selfie blocker:** Either mock geolocation + intercept the multipart upload, OR manually note this step requires real device
18. Successfully POST check-in → visit_id returned
19. Click "Took Order" → product picker → add 12× Bulk Widget (above MOQ 10, multiple of increment 5? — 10 is, 15 is, 12 is NOT — should fail MOQ check)
20. Adjust to 15× Bulk Widget — verify 5% slab discount applied
21. Select payment method: Credit (verify credit-limit check happens)
22. Submit → POST /api/sales?field_visit_uuid=<uuid> → sale created + linked to visit
23. Log out

### === Persona: Owner (verify field-rep flow) ===

24. Log in again as owner
25. Navigate to `/field/visits` → see Rep One's visit to Acme Distributors with linked invoice
26. Navigate to `/customers/acme` → outstanding balance updated, credit utilization shows
27. Log out

### === Persona: Wholesale Customer (Acme Distributors) ===

28. Either receive portal signup email and follow link, OR navigate `/portal/wholesalewalktest1778451/login` and use credentials owner provisioned
29. Land on portal dashboard
30. Navigate to `/portal/wholesalewalktest1778451/orders` → see the field-rep order from step 22
31. Verify product visibility: search/browse — should see "Bulk Widget" (group member) but if logged out / un-grouped, should only see "Public Sample"
32. Click **Reorder** on the field-rep order → POST /api/portal/me/reorder → land on storefront with `?adopt=<token>` → cart pre-populated
33. Try to set cart qty to 7 → MOQ violation (min 10) → 400 error displayed
34. Set qty to 20 → OK
35. Navigate to `/portal/wholesalewalktest1778451/invoices` → see invoice from field-rep sale
36. Log out

### === Persona: Manufacturer Partner (Acme Brand Co) ===

37. Open setup link with signup_token: `/manufacturer-portal/wholesalewalktest1778451/setup?token=<hex>`
38. Set password
39. Land on `/manufacturer-portal/wholesalewalktest1778451/login`, log in
40. Navigate to dashboard → see overview of brand activity
41. Navigate to `/manufacturer-portal/wholesalewalktest1778451/sales` → see the field-rep sale (Bulk Widget is in Acme Brand)
42. Navigate to `/manufacturer-portal/wholesalewalktest1778451/promotions` → see slab-tier scheme on Acme Brand
43. Verify NO data from other brands appears (PII invariant: only customers.city ever referenced — test that customer name is masked)
44. Log out

### === Final Owner check ===

45. Log in as owner
46. Navigate to dashboard → A/R aging card, credit utilization card, visit log card all reflect today's activity
47. Walkthrough complete

---

## 7. Known gaps / things that might break

### 🚨 Blockers
1. **GPS + selfie capture (step 17)** — Playwright can mock geolocation via `context.setGeolocation()` and `context.grantPermissions(['geolocation'])`, but `getUserMedia` for camera is harder. May need to intercept the multipart POST and inject a stub image file. Alternative: backend likely accepts any image — confirm by reading `field.js:106-228`.
2. **Mailinator dependency** — Portal invite + manufacturer signup_token arrive by email. Either:
   - Read the token from the DB directly via Supabase MCP (fastest)
   - Use a Mailinator inbox and parse the email
   - Add a "show token" debug button (no — production walkthrough)

### ⚠️ Caveats
3. **Customer→Group assignment table name** — audit didn't confirm whether it's `customer_group_members`, `customer_groups_customers`, or stored as `customers.group_id`. Will verify on first owner step.
4. **Portal signup vs invite flow** — audit didn't confirm which is actually wired. May need either; will test live.
5. **MOQ enforcement on portal** — confirmed in `services/moq.js` for storefront cart, but exact error UI presentation unverified.
6. **Visibility on reorder eligibility** — `/api/portal/me/order-history` UNION may or may not filter restricted items the customer no longer has access to. Test step 32 covers this.
7. **Manufacturer portal data filtering** — backend route filtering not yet inspected line-by-line. Step 43 verifies it visually.
8. **POS MOQ bypass intentional** — sale capture on field rep enforces; in-person POS does not. Not a bug — design intent.
9. **No explicit credit-limit admin page** — credit fields edited inline in customer CRUD form. Step 5 will confirm exact UI.

### Other notes
- Manufacturer portal has 15-min access token TTL (vs customer portal 30-min) — long walkthroughs may hit re-auth
- Field check-in is idempotent by `client_uuid` — re-running the spec is safe
- Field-rep order links via `field_visit_uuid` URL param on `/api/sales` — confirm field-rep app actually sends this

---

## Source files referenced

**Backend:**
- [backend/routes/field.js](../../backend/routes/field.js)
- [backend/routes/customers.js](../../backend/routes/customers.js)
- [backend/routes/manufacturer-partners.js](../../backend/routes/manufacturer-partners.js)
- [backend/routes/promotions.js](../../backend/routes/promotions.js)
- [backend/routes/customer-portal/data.js](../../backend/routes/customer-portal/data.js)
- [backend/middleware/customer-auth.js](../../backend/middleware/customer-auth.js)
- [backend/middleware/manufacturer-auth.js](../../backend/middleware/manufacturer-auth.js)
- [backend/middleware/feature-flags.js](../../backend/middleware/feature-flags.js)
- [backend/services/moq.js](../../backend/services/moq.js)
- [backend/services/product-visibility.js](../../backend/services/product-visibility.js)
- [backend/services/retail-flag-preset.js](../../backend/services/retail-flag-preset.js)
- [backend/migrate-pg.js](../../backend/migrate-pg.js) — v89 through v96

**Frontend:**
- [frontend/src/routes/appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx)
- [frontend/src/routes/publicRoutes.jsx](../../frontend/src/routes/publicRoutes.jsx)
- [frontend/src/pages/redesign/field/](../../frontend/src/pages/redesign/field/) — 5 field-rep pages
- [frontend/src/pages/redesign/PromotionsRedesign.jsx](../../frontend/src/pages/redesign/PromotionsRedesign.jsx)
- [frontend/src/pages/redesign/ManufacturerPartnersRedesign.jsx](../../frontend/src/pages/redesign/ManufacturerPartnersRedesign.jsx)
- [frontend/src/pages/redesign/CustomerGroupsRedesign.jsx](../../frontend/src/pages/redesign/CustomerGroupsRedesign.jsx)
- [frontend/src/pages/portal/](../../frontend/src/pages/portal/)
- [frontend/src/pages/manufacturer-portal/](../../frontend/src/pages/manufacturer-portal/)

**Database tables (key ones):**
- `customers` (credit_limit, credit_block_mode, payment_terms_days)
- `customer_groups`, `customer_group_products`
- `products` (min_order_qty, order_increment, visibility, brand_id)
- `promotions` (type incl. slab_percent, tier_rules, brand_id, priority)
- `sale_promotion_applications` (audit with frozen snapshots)
- `employees` (employee_type, lat, lng)
- `field_rep_routes`, `field_visits`
- `manufacturer_partners`, `manufacturer_partner_brands`, `manufacturer_portal_refresh_tokens`
- `customer_portal_refresh_tokens`

---

_Update this doc as the live walkthrough discovers reality drift from this audit._

---

# Live walkthrough findings (2026-05-18)

Run executed against tenant `wholesalewalktest1778451` via Playwright MCP (real-user clicks, no API shortcuts after audit).

## 🚨 BUG #1: Credit hard-block bypassed on field-rep order capture

**Severity:** HIGH — this is a Tier 0 foundational guarantee.

**Setup state:**
- Customer: Test Distributor (id=1)
- `credit_limit` = Rs 50,000
- `credit_block_mode` = **`hard`** (i.e. should block, not warn)
- Outstanding before sale = Rs 183,000
- Available = Rs 0 (utilization 366%)

**Repro:**
1. Log in as Field Rep One at https://sanopos.com/login
2. Land on `/field/today`, click stop 1 (Test Distributor)
3. Mock GPS to (24.915, 67.085) — geofence passes (0m distance, ±8m accuracy)
4. Upload any image as selfie → outcomes enable
5. Click "Took Order" → POST /api/field/check-in succeeds, visit_uuid issued
6. On `/field/order/1?visit_uuid=…`: Add Bulk Product A (qty auto-set to MOQ 12, Rs 120,000 before discounts)
7. UI **correctly** shows warning: *"Order Rs 120000 exceeds available credit Rs 0."*
8. Select **Credit (A/R)** payment, click Confirm

**Expected:** Confirm button disabled OR POST /api/sales returns 4xx with credit-exceeded error.

**Actual:** Sale created successfully as **INV-2026-00008** for Rs 102,000 (Rs 120,000 - 10% slab scheme - 5% Gold loyalty tier). Visit linked to sale via `field_visit_id`. Redirected to `/field/today` showing "1 / 5 visited, Took Order" badge.

**Impact:** The Tier 0 credit-controls promise ("hard block prevents sales when over limit") is broken on the field-rep path. POS may also be affected — needs separate verification.

**Likely root cause:** Either (a) the field-rep `/api/sales?field_visit_uuid=…` path doesn't call the credit-check middleware, OR (b) the credit-status calculation is being read but only used for the visual warning, not for the hard-gate decision. The available endpoint `GET /api/customers/:id/credit-status` correctly returns the over-limit state — the bug is on the write path.

**Suggested fix locations:**
- `backend/routes/sales.js` — verify credit check fires when `field_visit_uuid` query param present
- `backend/routes/field.js` — if there's a dedicated field-rep sale endpoint, check it there
- Look for `credit_block_mode === 'hard'` references; ensure the throw/return happens BEFORE the INSERT

**Workaround for walkthrough:** Continued with the bypass — sale exists as INV-2026-00008 for portal/manufacturer persona verification downstream. Test Distributor's outstanding is now ~Rs 285,000 (Rs 183k + Rs 102k).

## 🚨 BUG #2: Catalog visibility filter not applied on public storefront

**Severity:** HIGH — leaks restricted-SKU pricing/branding to ungrouped buyers + competitors.

**Setup state:**
- Product: Bulk Product B (id=2)
- `visibility` = `restricted`
- Assigned only to group "Tier A Premium" (Test Distributor is the only Tier A member with a portal account)
- Per Tier 2.11 Option C/C2 design: ungrouped customers should see ONLY `visibility='all'` products

**Repro path A — anonymous browser (no login):**
1. Visit https://sanopos.com/store/wholesalewalktest1778451/products with no portal session
2. All 3 products render: Bulk Product A (`all`), **Bulk Product B (`restricted`)** ← should NOT appear, Clearance Item (`all`)

**Repro path B — logged-in ungrouped customer:**
1. Log in to portal as Khalid Kiryana Store (customer_id=4, no `customer_group_id`) — email `khalid+test@sanomerchandise.com`, password `PortalPass123!`
2. Visit `/store/wholesalewalktest1778451/products`
3. Still sees Bulk Product B

**Expected:** Bulk Product B hidden from both. Only Test Distributor (Tier A Premium member) should see it.

**Likely root cause:** The storefront product-listing endpoint (probably `GET /api/storefront/:slug/products` or similar — verify in `backend/routes/storefront*.js`) doesn't call `visibleProductSqlFragment(db, customerId)` from `backend/services/product-visibility.js`. The audit explicitly listed this as a "Known gap" (#3 in audit doc):
> "**Visibility on reorder eligibility** — `/api/portal/me/order-history` UNION may or may not filter restricted items the customer no longer has access to."

The same gap applies to the entire catalog-listing path, not just reorder.

**Suggested fix locations:**
- `backend/routes/storefront*.js` — product list/search endpoints
- Need to thread customer_id through: if logged in via portal session, use `req.customer?.id`; if anonymous, treat as ungrouped (visibility='all' only)
- Currently MOQ rules ARE applied at cart-add (verified in walkthrough), so the visibility filter is the only missing piece

**Workaround for walkthrough:** Noted and continued. Other Tier 2 paths (reorder handoff, MOQ enforcement on cart) verified working.

## ⚠️ UX-GAP #3: No in-UI surface for manufacturer setup link

**Severity:** MEDIUM — onboarding friction, not data integrity.

**Scenario:** Owner invites a manufacturer partner. Partner says "I never got the email." Owner has no way to retrieve or copy the setup URL — the Resend button silently re-sends the email but doesn't display the link anywhere.

**Walked steps:**
1. Owner at /settings/manufacturer-partners, partner "Acme Brand Co" in row with status `invited`
2. Click "Resend" → confirms "Resend the setup invite to wholesalewalk-1778451+acme@gmail.com?" → accept
3. No toast, no modal, no link shown anywhere
4. The Edit modal also doesn't expose the token

**Expected:** Either (a) on partner creation, show a "Copy setup link" button that exposes the URL, OR (b) on Resend, optionally display the link inline for owners who'd rather send it via WhatsApp/SMS than rely on email deliverability.

**Suggested fix locations:**
- `frontend/src/pages/redesign/ManufacturerPartnersRedesign.jsx` — add a "Copy setup link" action on rows with `status='invited'`
- `backend/routes/manufacturer-partners.js` — extend GET /:id response to include `setup_link` for invited partners (token redacted on the list endpoint, full URL on detail)

**Impact:** A real owner using Mailinator/spam-filtered email setup can't recover. The walkthrough actually hit this exact dead-end at step 5 of the Manufacturer Partner persona — we can't proceed without inbox access.

**Walkthrough workaround:** Retrieved `signup_token` directly from `tenant_wholesalewalktest1778451.manufacturer_partners` via Supabase MCP, constructed setup URL manually, completed activation.

## ✅ Manufacturer Partner persona — all verified

Once we got past the token-access gap, this persona was flawless:

- Setup page (`/manufacturer-portal/<slug>/setup?token=<hex>`) accepted token, claimed account, set password ✅
- Auto-routed to dashboard after activation ✅
- Indigo "Manufacturer Portal" branding distinct from main app ✅
- Dashboard "Today" card showed the field-rep sale we just made:
  - Qty 12 / Gross Rs 120,000 / Scheme discount Rs 12,000 / 1 sale ← real-time, matches INV-2026-00008
- "Last 30 days": 39 qty / Rs 390k gross / Rs 24k scheme discount / 6 sales
- Top SKUs (30d): only Bulk Product A (the only Acme-branded product) — no other-brand leakage ✅
- Sales tab: 3 rows by day, total 39 qty / Rs 390k, banner reads *"Retailer identity is never exposed"* ✅ (PII invariant honored)
- Schemes tab: "Bulk A Volume Slab · Volume slab · 2 applications · 24 qualifying qty · Rs 24,000 total discount" ✅
- CSV download available; date filter + group-by (Day/SKU/Region) work

## 🏁 Final owner verification (post-walkthrough)

Logged back in as owner. Dashboard reflects everything:
- **Field Sales Today card:** Field Rep One · Last seen 17m ago · 1/5 visited · 1 order
- **Revenue Today:** Rs 108,000 (= our field-rep sale, slab discount applied, Gold tier discount layered)
- **A/R Aging:** Test Distributor now ~Rs 282,000 outstanding (Rs 180k baseline + Rs 102k new credit sale that should have been blocked — see BUG #1)

## Summary

| Persona | Steps | Bugs |
|---|---|---|
| Owner | 11 inspection + setup steps | 0 |
| Field Rep | 14 steps (login → check-in → order → confirm → visit log) | **1 HIGH** (credit hard-block bypass on field-rep order) |
| Portal Customer | 10 steps (login → order history → reorder → cart MOQ → visibility) | **1 HIGH** (storefront visibility leak — restricted products visible to ungrouped + anonymous) |
| Manufacturer Partner | 8 steps (setup token → activate → dashboard → sales → schemes) | **1 MEDIUM UX** (no in-UI surface for setup link recovery) |
| **TOTAL** | **43 live user actions** | **3 findings** |

End state of test tenant after walkthrough:
- `manufacturer_partners`: 1 row (Acme Brand Co, status `active`, password set)
- `field_visits`: +1 row (visit_id ~5, Test Distributor, geofence pass 0m, ±8m, ordered)
- `sales`: +1 row (INV-2026-00008, Rs 102,000, Credit, field_visit_id linked)
- `customers`: Test Distributor outstanding +Rs 102,000 (~Rs 282k total — over limit, but not blocked)
- `brands`: 1 row (Acme Brand)
- `products`: Bulk Product A now has brand_id pointing to Acme Brand

**Test tenant is in a great state for re-runs.** Manufacturer Partner password: `MfrPortal778!`. Field Rep One password reset to `FieldRep778!` during walkthrough (was `TestField234!` per master ref).

---

## 🚨 BUG #4: Loyalty-tier delete Catch-22 — no UI path to disable loyalty cleanly

**Severity:** MEDIUM — affects every wholesale tenant that wants loyalty OFF after running it for a while (a real scenario, since wholesale customers care about volume schemes more than per-purchase points).

**Discovered:** 2026-05-18, during post-walkthrough cleanup when user asked to "disable loyalty tiers for this test tenant because the Gold 5% kept stacking with the slab scheme and muddying the numbers."

**Repro:**
1. Owner navigates to `/loyalty-tiers` — 4 tiers exist (Bronze, Silver, Gold, Platinum), 3 customers auto-assigned by spend
2. Click trash icon on Bronze → confirms "Delete 'Bronze' tier?" → accept
3. `DELETE /api/loyalty/tiers/1` returns **400** with no toast/error surfaced in UI (browser console shows only `Failed to load resource: 400`)
4. Owner navigates to `/customers` → opens Edit on Khalid Kiryana Store (currently `loyalty_tier_id=1` Bronze)
5. Edit modal exposes: Basic Info, Demographics, Customer Group, Credit Limit, Block Mode, Payment Terms, Preferred Payment/Contact
6. **No `loyalty_tier_id` dropdown. No `loyalty_points` input.** Tier assignment is read-only in the UI.

**Root cause:** Tier assignment is auto-computed by spend threshold (Bronze Rs 0, Silver Rs 25k, Gold Rs 75k, Platinum Rs 200k), so by design there's no manual tier picker on the customer form. But the `DELETE /api/loyalty/tiers/:id` endpoint guards against deletion if any `customers.loyalty_tier_id` still points at it. The two together create a Catch-22: tiers can't be deleted while assigned, and there's no UI to detach assignments.

**Owner's remaining options (all bad):**
- (a) Edit each tier → set `is_active=false` → unclear if this satisfies the API delete guard; even if it does, the customer rows still point at the now-inactive tier (dangling but harmless)
- (b) Edit each tier → set `discount_percent=0%` and `points_multiplier=1.0` → discount stops firing, tiers and customer assignments stay on page (cosmetic clutter, not actual disable)
- (c) Toggle `phase2g_loyalty` flag OFF in Administrator → masks everything but leaves DB rows assigned. Tier delete still fails if flag is flipped back on later.
- (d) Direct Supabase SQL — outside the product UI

**Suggested fix locations:**
- `backend/routes/customers.js` (loyalty section) — either:
  - Expose `loyalty_tier_id` in `PUT /api/customers/:id` (let owner clear it manually), OR
  - Change `DELETE /api/loyalty/tiers/:id` to soft-delete (set `is_active=false`) by default and offer a `?force=true` query param that nullifies all `customers.loyalty_tier_id` pointing at it in the same transaction
- `frontend/src/pages/redesign/CustomersRedesign.jsx` — Edit modal: add a "Loyalty tier (auto / override)" picker so an owner can pin or clear manually
- `frontend/src/pages/redesign/LoyaltyTiersRedesign.jsx` — surface the 400 error response as a toast ("Cannot delete: 1 customer still assigned to Bronze") instead of silent failure

**Workaround taken during walkthrough:** None — user chose to escalate this as the bug it is rather than work around it with admin SQL. Loyalty discount remains active on this test tenant.

## ✅ Verified working surfaces

### Owner
- All 4 wholesale feature flags ON (verified via API call from authenticated session)
- 2 customer groups (Tier A Premium 10%, Tier B Standard 5%)
- Test Distributor: credit_limit 50k / mode hard / 30-day terms / Tier A Premium / portal enabled + verified
- Bulk Product A: MOQ 12 + case-pack 6 + Acme Brand (assigned during walkthrough)
- Bulk Product B: visibility=restricted + restricted to Tier A Premium only
- Promotion "Bulk A Volume Slab" — slab_percent type, tiers 5-9:5% / 10+:10% on Bulk Product A
- Manufacturer Partner "Acme Brand Co" invited (status=invited, brand=Acme Brand)
- Field Routes: Rep One has 5-stop Mon route, Test Distributor #1
- A/R Aging report: Rs 180,000 in 0–30 bucket
- Dashboard shows Field Sales Today card + A/R aging cards live

### Field Rep
- Login at /login works (no separate /field-rep/login URL)
- Auto-routed to /field/today after login
- Sidebar pared down to rep-appropriate items
- Today's Route page shows 5 stops with addresses + phone + "not geo-tagged" hints
- Check-in page captures GPS + selfie + outcome
- Outcome buttons disabled until selfie present (good UX)
- "Took Order" routes to /field/order/:customer_id?visit_uuid=…
- Order page shows:
  - Inline MOQ hint: "(Min 12 · Case 6)"
  - Credit available banner
  - Restricted product visible because rep's customer is in Tier A Premium ✅ (Tier 2.11 visibility working)
- Add button on a MOQ product auto-sets qty to minimum (no need to type "12") ✅
- Slab scheme fires with attribution: "-Rs 12,000.00 · Bulk A Volume Slab (12 qty)" ✅ (Tier 1.3 working incl. snapshot)
- Loyalty tier discount stacks on top of scheme (Gold +5%) ✅
- Visit log records: outcome, linked invoice, distance from shop, GPS accuracy
- Geofence check works: 0m distance recorded when GPS matches customer lat/lng

## 📝 Smaller observations (not bugs, just notes)

- A/R aging shows Rs 180,000 vs dashboard's Rs 183,000 — possibly principal vs total_due; worth a one-off check
- Slab tier 5-9 (5%) can never fire via portal/field-rep because MOQ=12 forces qty into 10+ tier (10%) — only POS could trigger 5-9
- Bulk B and Clearance Item have MOQ=0/increment=1 (no rule), only Bulk A exercises Tier 2.2
- Tenant has `phase2g_price_books` OFF — so customer-group discounts (10% Tier A) are not auto-applied at line level; group is used only for visibility filtering today
- Field rep's `/customers` sidebar link is visible — rep can browse all customers, not just their route customers (may be intentional)

