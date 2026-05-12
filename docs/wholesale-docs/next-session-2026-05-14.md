# Handoff prompt — paste this into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale Tier 0 roadmap. Read the master reference end-to-end before doing anything:

`docs/wholesale-docs/sanopos-wholesale-master-reference.md`

The "What shipped today (2026-05-13)" section near the top will tell you exactly what's already in main and what's left. Companion file with the competitive reasoning behind the roadmap: `docs/wholesale-docs/research-competitive-landscape.md`.

## Critical: don't trust CLAUDE.md files

The CLAUDE.md files in this repo (project root, backend/, frontend/, subdirectories) are out of date and have been wrong about specifics multiple times in recent sessions. Use them only for orientation. Before you make any concrete claim about how the code works — schema column names, route signatures, middleware behavior, table presence — verify against the actual source file. Same rule for the master reference doc: cited paths were accurate when written but the code keeps moving.

Rule of thumb: grep first, read the actual file, then act.

## State entering this session

Tier 0.6 and 0.1 shipped on main yesterday. **Current migration version: 89.**

Live state on production wholesale test tenant (`wholesalewalktest1778451`), verified via Supabase MCP at end of last session:

- `schema_version = 89`
- `tenant_modes` has `wholesale = true`
- `feature_flags.wholesale_credit_controls = true`
- `company_profile.ar_aging_buckets = [30, 60, 90]`
- `customers` has `credit_limit`, `credit_block_mode`, `payment_terms_days`
- `sales.customer_invoice_id` FK exists
- `role_permissions`: Manager has `override_credit_limit`

What did NOT happen yesterday: end-to-end browser verification on the wholesale tenant. **That's the first task this session.**

## First task — verify the credit flow end-to-end on prod

Log in to the wholesale test tenant and walk the full credit-sale path. If anything fails, stop and diagnose before doing any further work.

- Login URL: https://sanopos.com/login
- Store Code: `wholesalewalktest1778451`
- Username: `Wholesale Test Owner`
- Password: `TestWholesale778!`
- Admin PIN: `4321`

Walkthrough:

1. Open the wholesale tenant, navigate to Customers.
2. Edit any existing customer (or create a new one). Confirm the new "Credit & Payment Terms" section is visible with Credit Limit / Block Mode / Payment Terms fields.
3. Set Credit Limit = 50000, Block Mode = "Hard — manager PIN required", Payment Terms = "Net 30". Save.
4. Open the customer's detail panel. Confirm the new "Credit & A/R" SectionCard renders showing outstanding 0 / limit 50000 with a green utilization bar.
5. Use stock adjustments to give the seeded "Bulk A" product non-zero stock (the wholesale tenant's seeded products are all stock=0 by default).
6. Open POS. Confirm the "On Account" tender button appears in the payment-method grid.
7. Select that customer at checkout. Add ~60000 worth of items to the cart. Click "On Account".
8. Expect: `POSCreditLimitModal` opens with breakdown (Outstanding 0 / This Sale 60000 / Credit Limit 50000 / Over By 10000). Enter Admin PIN `4321`. Sale should complete.
9. Verify the sale shows in Sales History, and a corresponding row appears in Customer Invoices with `balance_due = 60000`.
10. Try a refund/return on that sale with `refund_method = credit_reversal`. Confirm the customer invoice `balance_due` drops accordingly.

If any step fails, the request body in the failed response is the truth — paste it back and diagnose from there. Don't trust the UI flow alone.

## Then continue Tier 0 in this order

### 0.2 — finish line (small)

`payment_terms_days` column shipped in v88 and the customer form already writes it. **The only remaining piece** is that `POST /api/customer-invoices` should default `due_date = invoice_date + customer.payment_terms_days` when `due_date` is omitted from the request body. Check `backend/routes/customer-invoices.js` POST handler — it currently takes `due_date` from the body verbatim. Verify against the live source before editing.

### 0.3 — A/R aging report (2-3 days)

`company_profile.ar_aging_buckets` JSONB is already in place (default `[30, 60, 90]`). Build:

- `GET /api/reports/ar-aging?as_of=&outlet_id=` — returns `[{ customer_id, name, b0_30, b31_60, b61_90, b90_plus, total }]`. Use the tenant's `ar_aging_buckets` column to compute bucket boundaries dynamically.
- New "A/R Aging" tab in Reports — same shell pattern as other report tabs. CSV export via `downloadCsv` from `utils/csvExport.js`.

Before writing the endpoint, verify the actual customer-invoices schema (status values, what counts as "unpaid" — read `backend/routes/customer-invoices.js` and `backend/schema-pg.sql`).

### 0.4 — Customer statements (full bank-style)

The user explicitly chose full bank-style over minimal. **Audit the ledger sources before designing the endpoint:**

- `sales` (timestamp, total_amount, customer_id)
- `customer_invoices` (created_at, total_amount, balance_due, status)
- `customer_invoice_payments` (created_at, amount)
- `returns` (timestamp, total_refund, original_sale_id → customer_id)
- `customer_wallet_ledger` (type, amount — this is wallet/prepaid, separate from A/R; verify before mixing)

If any of these sources don't reconcile cleanly into an opening-balance → activity → closing-balance ledger, flag it to the user before building the email template.

Endpoint shape: `GET /api/customers/:id/statement?from=&to=` returns rendered HTML + structured JSON. `POST /api/customers/:id/send-statement` sends via Resend (existing `services/email.js` orchestrator).

### 0.5 — Wholesale dashboard cards (1-2 days)

Decision made: extra cards on existing `/dashboard`, gated by `industry_type='wholesale'` (or `requireMode='wholesale'`). Cards: Total Outstanding A/R, Overdue >30 days, Top 5 buyers by balance. Reuse the `SectionCard` primitive.

## Operational rules

- Commit each Tier 0 item separately. Push to main directly — no PRs unless the user explicitly asks.
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. After pushing, verify the migration ran (Supabase MCP: `SELECT MAX(version) FROM tenant_<slug>.schema_version`) before claiming the work is live.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas.
- The migrate-pg search_path leak was fixed yesterday (commit `5fcf6ca`). All migrations now use the `makeScopedDb()` helper. Don't reintroduce raw `SET search_path` followed by a separate query — Supavisor's transaction-mode pooling will silently split them across backends.
- If the user asks you to commit, follow the repo's existing message format (Co-Authored-By trailer included).
- Vitest is the test runner, not Jest. Run integration tests from `backend/` directory (not repo root) so `vitest.config.js` picks up `globals: true`.

## What to do first this session

1. Read the master reference end-to-end.
2. Read `docs/wholesale-docs/next-session-2026-05-14.md` (this file).
3. Run the end-to-end browser verification above. Don't move past it if anything fails.
4. Confirm with the user before starting 0.2.
