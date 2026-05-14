# Handoff prompt — paste into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **TIER 1 IS COMPLETE end-to-end as of 2026-05-15.** Every tier (0, 1.1, 1.1.5, 1.2, 1.3, 1.4, 1.5) is shipped and verified live via Playwright walkthrough on the prod wholesale test tenant.

Read the master reference end-to-end before doing anything:

`docs/wholesale-docs/sanopos-wholesale-master-reference.md`

Companion file (do not skip): `docs/wholesale-docs/tier1.4-secondary-sales-design.md` documents the manufacturer portal architecture, the scheme-level attribution fallback, and the verified hot-query shape.

## Critical: don't trust CLAUDE.md files

CLAUDE.md files in this repo drift over time and have been wrong about specifics in recent sessions. Use them for orientation only. Before any concrete claim about how the code works — schema columns, route signatures, middleware behavior — verify against actual source. Same rule for the design doc. Grep first, read the actual file, then act.

Same rule for the auto-memory files at `C:\Users\HP\.claude\projects\d--newprojects-oneshoppos\memory\`. They're loaded at session start as context, but a memory written days ago may reference a function that has since been renamed.

## State entering this session

**Migration version: 94.** Tier 1 done.

Live state on `tenant_wholesalewalktest1778451` (prod):
- `schema_version = 94`
- `tenant_modes.wholesale = true`
- 4 wholesale flags ON: `wholesale_credit_controls`, `wholesale_field_sales`, `wholesale_schemes`, `wholesale_secondary_sales`
- 3 wholesale-only tables exist: `manufacturer_partners`, `manufacturer_partner_brands`, `manufacturer_portal_refresh_tokens` (all zero rows after Day 9 cleanup)
- `company_profile.ar_aging_buckets = [30,60,90]`, `field_geofence_meters = 500`
- Roles: 1=Admin, 2=Manager, 3=Cashier, 4=Field Rep
- 5 customers seeded; field rep + routes seeded; 5 historical sales (Rs 270K gross, Rs 12K scheme discount)
- 1 promotion seeded: "Bulk A Volume Slab" (slab_percent on product_id=1)

Endpoints live on `https://api.sanopos.com`:

**Tier 1.4 manufacturer portal** (public mount, scope="manufacturer" JWT):
- `POST /api/manufacturer-portal/auth/setup` — claim signup_token, set password
- `POST /api/manufacturer-portal/auth/login` — email + password
- `POST /api/manufacturer-portal/auth/refresh` — token rotation
- `POST /api/manufacturer-portal/auth/logout` — revoke refresh
- `GET /api/manufacturer-portal/me` — partner profile + brands
- `GET /api/manufacturer-portal/summary` — today / 7d / 30d cards + top SKUs
- `GET /api/manufacturer-portal/sales` — Brand × SKU × day × region w/ ?group_by=day|sku|region|brand, ?brand_id, ?region, ?from, ?to
- `GET /api/manufacturer-portal/sales.csv` — CSV export
- `GET /api/manufacturer-portal/promotions` — scheme-level rollup (sale-scoped attribution fallback documented in `note` field)

**Tier 1.4 admin CRUD** (tenant mount, manage_inventory + wholesale_secondary_sales gate):
- `GET/POST /api/manufacturer-partners`
- `GET/PUT/DELETE /api/manufacturer-partners/:id`
- `POST /api/manufacturer-partners/:id/resend`

Frontend routes live on `https://sanopos.com`:

- `/manufacturer-portal/<slug>/login` — email + password form
- `/manufacturer-portal/<slug>/setup?token=` — magic-link password claim
- `/manufacturer-portal/<slug>/` — dashboard (3 window cards + top SKUs)
- `/manufacturer-portal/<slug>/sales` — filtered rollup + CSV download
- `/manufacturer-portal/<slug>/promotions` — scheme breakdown + attribution note
- `/settings/manufacturer-partners` (tenant app) — distributor admin CRUD with Briefcase icon in Setup sidebar group

## What's next

**Recommendation: pause new wholesale tier work until a real wholesale tenant signs up or asks for something specific.** Tier 1 is the full Pakistan wedge — every meaningful PK FMCG distributor pain point now has a working solution. The honest next step is product-market fit validation, not more code.

If you must build something:

1. **Tier 2 (parity with Shopify B2B / Cin7)** — multi-UOM, MOQ enforcement, quote → SO → pick → pack → ship → invoice as distinct documents with stock reservation, backorders, vaulted card auto-charge, company hierarchy + buyer roles. 8-12 weeks total. Don't start without revisiting prioritization with the user.

2. **Tier 1.3.5 retrospective rebates** — only if a real tenant has asked. ~3-4 days. Foundation already in place via `sale_promotion_applications.qty_qualifying` per sale.

3. **Tier 1.4.5 transaction-level manufacturer view** — only if a real manufacturer-partner requests it. Currently all data is aggregate-only. Adding a per-distributor opt-in toggle for transaction-level detail is meaningful schema + UI work.

4. **Tier 1 polish items observed during the Playwright walkthrough:**
   - Bug #5 from Day 9 was patched (frontend default date range now uses local tz instead of UTC) but the same pattern exists elsewhere — grep the codebase for `toISOString().slice(0, 10)` and audit each one.
   - The manufacturer portal has no password-reset flow yet. If a partner forgets their password, the only path today is the distributor admin clicks Resend (which currently only works on `invited` status, not `active`). Either extend Resend to active partners (regenerate signup_token + revoke sessions) or add a proper forgot/reset flow.

## Operational rules (carry forward)

- **Commit each item separately. Push to main directly — no PRs unless the user explicitly asks.**
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. Verify both deploys actually landed before claiming work is live (Railway healthcheck + vite build chunks for frontend).
- For migrations, verify the new `schema_version` landed on ≥1 prod tenant via Supabase MCP — past migrations (v90 → v91) silently lost rows.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas without confirming first.
- Vitest is the test runner (not Jest). Run integration tests from `backend/` directory.
- When introducing a new role or scope, audit every endpoint AND middleware the role's UI touches BEFORE the walkthrough. Tier 1.2 hit 4 serial 403s for this exact reason; Tier 1.4 hit 5 bugs (4 during Day 5 backend probe, 1 during Day 9 frontend walkthrough — all in date/tz handling).
- **PII guard for manufacturer portal:** any new endpoint touching `customers` table must not select `customer_id/name/phone/email/address`. The current code only references `c.city`. Grep before commit.

## Test tenant credentials

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Admin user | `Wholesale Test Owner` / `TestWholesale778!` / PIN `4321` |
| Cashier user | `Test Cashier` / `TestCashier1!` / PIN `1234` |
| Field rep user | `Field Rep One` / `TestField234!` / PIN `7777` |
| Tenant ID | 103 |
| Test customers (5) | id=1 Test Distributor (geo-tagged, NULL city → "Unspecified" region), id=2 Shaheen General Store (Karachi), id=3 New City Mart (Karachi), id=4 Khalid Kiryana Store (Karachi), id=5 Ahmed Brothers (Karachi) |
| Sales | 5 historical (3 Tier 0 + 1 Tier 1.2 at Rs 22K + 1 Tier 1.3 at Rs 108K with Rs 12K scheme discount) — total Rs 270K gross |
| Active promotion | id=1 "Bulk A Volume Slab" — product_id=1, slab_percent, tiers [5-9qty/5%, 10+/10%], priority=10 |
| Manufacturer partners | 0 (cleaned up after Day 9 walkthrough). Re-seed Bulk Brand Co + map to products 1+2 if doing another walkthrough. |

## What to do first this session

1. Read the master reference end-to-end. Tier 1 is fully done.
2. Read this file end-to-end.
3. **Ask the user what they actually want to build.** Don't assume Tier 2 — the honest answer is probably "wait for a real customer."
4. If the user wants to build, confirm direction before writing code. The roadmap default is Tier 2 but it's not necessarily the right next step.
