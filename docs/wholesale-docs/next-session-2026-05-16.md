# Handoff prompt — paste into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **Tier 0, Tier 1.1, Tier 1.1.5, Tier 1.2, AND Tier 1.3 are all complete and verified live on production as of 2026-05-15.**

Read the master reference end-to-end before doing anything:

`docs/wholesale-docs/sanopos-wholesale-master-reference.md`

The headline + the Tier 1 progress table have the full state. Companion competitive research: `docs/wholesale-docs/research-competitive-landscape.md`.

## Critical: don't trust CLAUDE.md files

The CLAUDE.md files in this repo (project root, backend/, frontend/, subdirectories) drift over time and have been wrong about specifics in recent sessions. Use them only for orientation. Before you make any concrete claim about how the code works — schema column names, route signatures, middleware behavior, table presence — verify against the actual source file. Same rule for the master reference doc: cited paths were accurate when written but the code keeps moving.

Rule of thumb: grep first, read the actual file, then act.

Same rule for the auto-memory files at `C:\Users\HP\.claude\projects\d--newprojects-oneshoppos\memory\`. They are read at session start as context, but a memory written days ago may reference a function that has since been renamed. Verify before recommending.

## State entering this session

**Tier 0, 1.1, 1.1.5, 1.2, 1.3 all complete and verified live.** Current migration version: **93**.

Live state on production wholesale test tenant (`wholesalewalktest1778451`):

- `schema_version = 93`
- `tenant_modes.wholesale = true`
- Feature flags ON: `wholesale_credit_controls`, `wholesale_field_sales`, `wholesale_schemes`
- `company_profile.ar_aging_buckets = [30, 60, 90]`, `field_geofence_meters = 500`
- `customers` has credit columns (`credit_limit`, `credit_block_mode`, `payment_terms_days`) + `lat`/`lng`
- `sales.customer_invoice_id` FK (v88), `sales.field_visit_id` FK (v92)
- `promotions.tier_rules` JSONB + `brand_id` FK + `priority` INT (v93)
- `sale_promotion_applications` audit table (v93)
- Roles: 1=Administrator, 2=Manager, 3=Cashier, **4=Field Rep**
- `role_permissions`: Manager has `override_credit_limit` + `manage_field_sales`; Field Rep has `manage_field_sales`
- Test Distributor outstanding: Rs 183,000 across 4 open invoices
- Field Rep One (id=3, `employee_type='field_rep'`, password `TestField234!`, PIN `7777`)
- 5 customers seeded, all 7 days of field-rep routes seeded, 4 live `field_visits` rows
- 5 sales total (3 historical Tier 0 + 1 Tier 1.2 walkthrough + 1 Tier 1.3 walkthrough at Rs 108K with Rs 12K scheme discount)
- 1 promotion seeded: id=1 "Bulk A Volume Slab" (product-scoped slab_percent on Bulk Product A, 5-9qty/5%, 10+qty/10%)
- 1 sale_promotion_applications row from the Tier 1.3 walkthrough

Endpoints live on `https://api.sanopos.com`:

**Tier 0:**
- `GET /api/customers/:id/credit-status`
- `GET /api/customers/:id/statement?from=&to=`
- `POST /api/customers/:id/send-statement`
- `GET /api/reports/ar-aging?as_of=&outlet_id=`
- `GET /api/reports/dashboard/wholesale?overdue_days=30`

**Tier 1.1:**
- `GET /api/field/route/today`
- `POST /api/field/check-in` — idempotent on `client_uuid`
- `GET /api/field/visits` — joins linked sales (1.2)
- `GET /api/field/summary`

**Tier 1.1.5:**
- `GET /api/admin/field-routes?employee_id=N`
- `POST /api/admin/field-routes` — replace-all per (rep, day-of-week)

**Tier 1.2 (in POST /api/sales):**
- Accepts `field_visit_id` or `field_visit_uuid` (resolves uuid → id via `field_visits.client_uuid`)
- Skips kiosk clock-in check when `field_visit_*` present
- Field reps bypass outlet-assignment enforcement + see all outlets

**Tier 1.3:**
- `GET /api/promotions` — list (any auth)
- `POST/PUT/DELETE /api/promotions` — CRUD (manage_inventory)
- `POST /api/promotions/quote` — evaluator. Handles all 6 types including `slab_percent`. Hydrates `brand_id` from products when needed. Sorted by `priority DESC`.
- `POST /api/sales` accepts `applied_promotions[]` → writes one `sale_promotion_applications` row per entry (audit, frozen snapshot of name/type/qty/discount/tier).

Frontend routes live on `https://sanopos.com`:

- `/field/today` — rep daily route
- `/field/check-in/:customer_id` — GPS + selfie + outcome
- `/field/order/:customer_id?visit_uuid=` — order capture
- `/field/visits` — owner-facing visit log with linked invoice column
- `/field/routes` — owner-facing route assignment UI
- `/promotions` — admin promotions/schemes page (slab editor + brand picker + priority field appear when `wholesale_schemes` flag is on)
- Dashboard has `FieldSummaryCards` widget when `wholesale_field_sales` flag on AND tenant has field-rep employees
- Dashboard has `DashboardWholesale` widget when `wholesale` mode is set

## What's next

**Recommended start: Tier 1.4 — Secondary sales tracking (1.5-2 weeks)**

This is the **last big piece of the Pakistan wedge** before Tier 1 is fully done. Read the Tier 1 row 1.4 in the master reference + the "Secondary Sales Reports" section in `research-competitive-landscape.md` for context.

The killer feature for FMCG: wholesale tenants can mark certain customers as "manufacturer-partners" (Coca-Cola, Unilever, etc.). The manufacturer's portal shows real-time onward sales of their brand SKUs through this distributor — daily/weekly/monthly volumes by retailer, by region, by rep. This is what gets you onto manufacturer-side procurement decks.

**Scoping required before any code** — the master ref explicitly says "complex — may need its own scoping." Key questions:
1. **Access model.** Does the manufacturer-partner log in to a separate portal (new auth scope, like the existing customer portal)? Or do they get a magic-link to a read-only report URL with no portal at all?
2. **Data shape.** Aggregate-only (daily totals per brand per region), or transaction-level (which retailer bought what, when)? Privacy matters here — distributors may not want to expose retailer identities.
3. **What "secondary sales" means in practice.** Just sales of that brand's SKUs (filter on `products.brand_id`)? Or do we need to track manufacturer-distributor primary purchases separately and surface the gap?
4. **Multiple manufacturers per distributor.** A distributor of 5 brands → 5 separate manufacturer-partner accounts, each scoped to their brand only. How is the brand→partner mapping stored?
5. **Pricing.** Is this a free upsell or a paid add-on? Tier 1.5 (the flag bundle) will need a `wholesale_secondary_sales` flag regardless.

**Recommended workflow:** Do the scoping interview with the user FIRST (15-20 min of structured questions), write a 1-page design doc as a new file under `docs/wholesale-docs/`, get user sign-off, THEN start building. Skipping the scoping on a feature this strategic will cost more than the time saved.

**Alternative starts:**

- **Tier 1.5 cleanup** (~0.5 day): Add `wholesale_secondary_sales` to `DEFAULT_FEATURE_FLAGS` + seed in migration v94. Cheap, but no user-visible value until 1.4 ships.
- **Tier 1.3.5 retrospective rebates** (~3-4 days): Only if a real tenant has asked. Foundation already in place — `sale_promotion_applications` rows have `qty_qualifying` per sale, so the rebate computation is "sum qualifying qty over scheme period, recompute tier-by-customer, generate credit note." Owner approval workflow + credit-note generation are the meaty bits.
- **Tier 1.3 polish** (~1-2 days): No-stacking enforcement, server-side recompute of `applied_promotions` inside POST /api/sales (currently trusts client). Defensive — wait for a real tenant to get burned first.

Confirm direction with the user before starting any of the above. If unsure → ask the scoping questions for Tier 1.4 first.

## Operational rules (carry forward — these have been reinforced by the last several sessions)

- **Commit each item separately. Push to main directly — no PRs unless the user explicitly asks.**
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. After pushing, verify Railway healthcheck succeeded before claiming the work is live. For migrations, verify the new `schema_version` landed on at least one prod tenant via Supabase MCP — v90 silently lost rows on the first deploy (savepoint collision on a sequence). The fix is to keep all conflict-prone INSERT blocks in their own savepoint and reset sequences before INSERT if `ON CONFLICT (name)` is in play.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas without confirming first.
- `migrate-pg.js` uses `makeScopedDb()` now — don't reintroduce raw `SET search_path` followed by a separate query under Supavisor pooling.
- Vitest is the test runner (not Jest). Run integration tests from `backend/` directory.
- The wholesale tenant has `phase2g_loyalty` enabled — loyalty tiers may auto-discount on Credit sales causing front/back total mismatch. For verification testing, RESET Test Distributor to Bronze + 0 points after each sale: `UPDATE customers SET loyalty_tier_id=1, loyalty_points=0 WHERE id=1`.
- **When introducing a new role with a narrow perm set, audit every endpoint AND middleware the role's UI touches BEFORE the walkthrough.** Tier 1.2 hit 4 serial 403/400s for this exact reason; Tier 1.3 hit one (the clock-in check). Use `grep -r "requireAnyPerm\|requirePerm\|employee_outlets\|clocked_in" backend/` as a pre-flight checklist for new roles.

## Test tenant credentials

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Admin user | `Wholesale Test Owner` / `TestWholesale778!` / PIN `4321` |
| Cashier user | `Test Cashier` / `TestCashier1!` / PIN `1234` |
| **Field rep user** | `Field Rep One` / `TestField234!` / PIN `7777` (id=3, role_id=4, employee_type='field_rep') |
| Tenant ID | 103 |
| Test customers (5) | id=1 Test Distributor (geo-tagged, credit_limit=50000), id=2 Shaheen General Store (geo-tagged), id=3 New City Mart, id=4 Khalid Kiryana Store, id=5 Ahmed Brothers |
| Routes seeded | All 7 days of week, 5 customers each (Sun-Sat) for Field Rep One |
| Field visits | 4 rows (3 from previous walkthroughs + 1 from the Tier 1.3 walkthrough) |
| Sales | 5 rows (3 historical + 1 Tier 1.2 at Rs 22K + 1 Tier 1.3 at Rs 108K with Rs 12K scheme discount) |
| Active promotion | id=1 "Bulk A Volume Slab" — product_id=1, slab_percent, tiers [5-9qty/5%, 10+/10%], priority=10 |

## What to do first this session

1. Read the master reference end-to-end. Focus on the "What shipped" sections (Tier 0, 1.1, 1.1.5, 1.2, 1.3) and the Tier 1 roadmap table.
2. Read this file end-to-end.
3. Confirm with the user which direction to take (Tier 1.4 scoping vs 1.3.5 retrospective rebates vs 1.5 flag cleanup vs 1.3 polish).
4. For Tier 1.4 specifically: do the scoping interview FIRST. Don't write any code until the user has answered the 5 questions above and signed off on a 1-page design.
