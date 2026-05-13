# Handoff prompt — paste this into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **Tier 0 is complete as of 2026-05-14.** Read the master reference end-to-end before doing anything:

`docs/wholesale-docs/sanopos-wholesale-master-reference.md`

The "What shipped (2026-05-13 + 2026-05-14)" section near the top has the full commit log and current state. Companion file with the competitive reasoning: `docs/wholesale-docs/research-competitive-landscape.md`.

## Critical: don't trust CLAUDE.md files

The CLAUDE.md files in this repo (project root, backend/, frontend/, subdirectories) are out of date and have been wrong about specifics multiple times in recent sessions. Use them only for orientation. Before you make any concrete claim about how the code works — schema column names, route signatures, middleware behavior, table presence — verify against the actual source file. Same rule for the master reference doc: cited paths were accurate when written but the code keeps moving.

Rule of thumb: grep first, read the actual file, then act.

## State entering this session

**Tier 0 complete.** Current migration version: **89** (no DDL changes from Tier 0.3/0.4/0.5).

Live state on production wholesale test tenant (`wholesalewalktest1778451`):

- `schema_version = 89`
- `tenant_modes.wholesale = true`
- `feature_flags.wholesale_credit_controls = true`
- `company_profile.ar_aging_buckets = [30, 60, 90]`
- `customers` has `credit_limit`, `credit_block_mode`, `payment_terms_days`
- `sales.customer_invoice_id` FK exists
- `role_permissions`: Manager has `override_credit_limit`
- Test Distributor outstanding: Rs 183,000 across 4 open invoices

Tier 0 endpoints live on `https://api.sanopos.com`:

- `GET /api/customers/:id/credit-status` — utilization + available
- `GET /api/customers/:id/statement?from=&to=` — bank-style ledger
- `POST /api/customers/:id/send-statement` — email via tenant-branded sender
- `GET /api/reports/ar-aging?as_of=&outlet_id=` — bucketed A/R
- `GET /api/reports/dashboard/wholesale?overdue_days=30` — home dashboard cards

## First task — browser walkthrough of 0.3 / 0.4 / 0.5 (deferred from today)

All three endpoints verified via authenticated curl + Supabase MCP, but no human walked the UI yet. Login as Admin and confirm:

- Login URL: https://sanopos.com/login
- Store Code: `wholesalewalktest1778451`
- Username: `Wholesale Test Owner`
- Password: `TestWholesale778!`

1. **A/R Aging tab**: Reports > Finance > A/R Aging. Confirm column headers render `0–30 / 31–60 / 61–90 / 90+`. Confirm Test Distributor row shows Rs 183,000 in the `0–30` bucket. CSV export works. Change the `as_of` date to a past date and confirm bucketing shifts.

2. **Customer Statement modal**: Customers > Test Distributor > Credit & A/R card > "Send Statement". Date pickers preloaded to 1st-of-month → today. Click Preview — confirm 6 ledger entries (5 invoices + 1 credit reversal) with running balance ending at Rs 183,000. Click Send by Email after putting a real address in the field (customer has no email on file — that's expected, the modal shows an amber hint).

3. **Wholesale dashboard cards**: home `/dashboard`. Confirm the two summary cards render right after KPI cards: Total Outstanding A/R (Rs 183,000, 4 open invoices) and Overdue >30 days (Rs 0 — all due dates are in the future). Top 5 Buyers table shows Test Distributor with 4 open / 0 overdue / Rs 183,000.

If any step fails, capture the failed request body and diagnose. Don't trust the UI alone.

## Then start Tier 1

The next tier is the **Pakistan wedge** — field rep app + schemes + secondary sales. This is multi-week. Read the Tier 1 section in the master reference before scoping.

**Recommended start: 1.1 — Field rep mobile app foundation (1 week)**

This is the smallest atomic step that unlocks everything else in Tier 1:

- Add `employees.employee_type TEXT DEFAULT 'in_store' CHECK (employee_type IN ('in_store','field_rep'))` (new migration v90)
- Add `field_rep_routes` table: `(id, employee_id, day_of_week, customer_id, visit_order)`. PK on `(employee_id, day_of_week, visit_order)`.
- Add `field_visits` table: `(id, employee_id, customer_id, planned_at, checked_in_at, gps_lat, gps_lng, selfie_url, status)`.
- New routes:
  - `GET /api/field/route/today` — returns today's planned customers for the current employee
  - `POST /api/field/check-in` — body `{ customer_id, lat, lng, selfie_base64 }`, uploads selfie to R2, inserts a `field_visits` row
  - `GET /api/field/visits?from=&to=&employee_id=` — visit history report
- New feature flag: `wholesale_field_sales` (default OFF, opt-in per tenant — see master ref for the Tier 1 mode flag bundle discussion).

**Decision before starting 1.1**: should the field rep work via the existing web app (responsive mobile layout, browser-based) or via a separate React Native app? The master reference says "Offline-first via IndexedDB, sync on reconnect" which the existing web stack can do (POS already has offline IndexedDB queue). **Recommendation: web-based first, native later.** A native app is months of work; a mobile-responsive route on the existing PWA can ship in a week and prove the model.

Confirm the start point with the user before writing code.

## Operational rules (carry forward)

- Commit each Tier item separately. Push to main directly — no PRs unless the user explicitly asks.
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. After pushing, verify Railway healthcheck succeeded before claiming the work is live.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas.
- migrate-pg.js uses `makeScopedDb()` now — don't reintroduce raw `SET search_path` followed by separate query under Supavisor pooling.
- Vitest is the test runner (not Jest). Run integration tests from `backend/` directory.
- The wholesale tenant has `phase2g_loyalty` enabled — loyalty tiers may auto-discount on Credit sales causing front/back total mismatch. For verification testing, RESET Test Distributor to Bronze + 0 points after each sale: `UPDATE customers SET loyalty_tier_id=1, loyalty_points=0 WHERE id=1`.

## Test tenant credentials

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Admin user | `Wholesale Test Owner` / `TestWholesale778!` / PIN `4321` |
| Cashier user | `Test Cashier` / `TestCashier1!` / PIN `1234` |
| Tenant ID | 103 |
| Test customer | id=1, name="Test Distributor", credit_limit=50000, block_mode=hard, payment_terms_days=30, outstanding Rs 183K across 4 open invoices |

## What to do first this session

1. Read the master reference end-to-end.
2. Read this file end-to-end.
3. Run the browser walkthrough above. Don't move past it if anything fails.
4. Confirm with the user before starting 1.1 (or whatever direction they pick).
