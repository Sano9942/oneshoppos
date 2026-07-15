# Tier 4 Routes — Claude Guide

Routes under `/api/*` (mixed prefixes, not `/api/tier4/*`). Mounted after tenant middleware — every handler has `req.employee`, `req.company`, `deps.db` (tenant DB proxy). Every sub-module is a factory: `module.exports = function(deps) { ... return router; }`.

## index.js

Composes 6 sub-routers in this order: notifications → company-profile → accounting → hr → crm → approvals. Order matters only in that `company-profile.js`'s `/api/company-profile/currency` route has no auth — it must not be shadowed by anything requiring auth on the same path (it isn't).

## notifications.js

Deps: `db`, `requireFeature`. Flag: `notifications` on every route. No `requirePerm` — any authenticated user manages their own notifications.

- `GET /api/notifications` — last 50, `ORDER BY created_at DESC`. `?unread_only=1` filters `is_read = false` (column is `is_read`, not `read` — Postgres reserved word).
- `GET /api/notifications/count` — `{ unread: N }`.
- `PUT /api/notifications/:id/read` — one row.
- `PUT /api/notifications/read-all` — all unread rows. Registered after `/:id/read` in the file; Express still resolves `/read-all` as a literal segment correctly since it's a distinct static path, not a shadowing conflict — but don't add other single-segment dynamic routes here without checking order.

Table: `notifications`.

## company-profile.js

Deps: `db`, `requireFeature`, `requirePerm`, `COMPANY_UPLOADS_DIR` (destructured but unused — logo upload goes through R2, not this dir). Also imports `config/industry-config` (`VALID_INDUSTRY_TYPES`), `middleware/feature-flags` (`invalidateModeCache`, `invalidateFeatureFlagCache`), `middleware/tenant-auth` (`invalidateCompanyProfileCache`), `services/embedded-barcode` (`normalizeScheme`).

- `GET /api/company-profile` — flag `multi_company`. Returns `company_profile WHERE id = 1`.
- `GET /api/company-profile/currency` — **no auth, no flag, public**. Used by frontend `CurrencyProvider` on mount. In MT mode, resolves via `?tenant=<slug>` → `masterDb.getTenantBySlug` → `tenantDbManager.getDb`. Returns `{ symbol, code, denominations }`; `cash_denominations` JSON-parsed, falls back to `[100,50,20,10,5,1]`.
- `PUT /api/company-profile` — `requirePerm("all_access")` + flag `multi_company`. Most fields COALESCE-updated; `trading_name`, `ntn`, `strn`, `phone`, `email`, `website` are NOT coalesced (passing null clears them). `tax_mode` accepts `none|inclusive|exclusive`, silently ignored if invalid. If `industry_type` is a valid preset, delegates the full re-seed to `services/preset-apply.js:applyPreset(db, industry_type)` — clears `tenant_modes`, re-derives flags for the new preset, and is the **shared code path with the super-admin "reapply preset" action** (fix mode-seeding bugs there, not inline here). Bundles are deliberately NOT re-run on a tenant-side preset switch. Calls `invalidateModeCache()` + `invalidateFeatureFlagCache()` after a preset change, and always calls `invalidateCompanyProfileCache(req.tenantId)` at the end so a `tax_mode` change is visible immediately instead of waiting on the 5-minute company-profile cache.
- `PUT /api/company-profile/onboarding-dismiss`, `PUT /api/company-profile/fbr-banner-dismiss` — `requirePerm("all_access")`, no flag. Set a single boolean column.
- `GET`/`PUT /api/company-profile/barcode-scheme` — `requirePerm("all_access")`, no flag (self-contained, not gated by `multi_company`). V01 grocery/deli feature: stores a price/weight-embedded-barcode decode scheme (`company_profile.barcode_scheme`, JSON) used by the POS scan route to interpret embedded-price barcodes. PUT normalizes via `normalizeScheme()`, stores `null` to fully disable, and busts the company-profile cache so the scan route sees the change immediately.
- `POST /api/company-profile/logo` — `requirePerm("all_access")` + flag `multi_company`. Multer memory storage, 5MB cap, `rasterImageFileFilter` (SVG excluded — served same-origin, XSS risk), then `verifyImageMagicBytes` to catch a mismatched declared MIME. Uploads to R2 at `company/company_logo_{timestamp}.{ext}`, writes `logo_url`.

Tables: `company_profile`, `tenant_modes`, `feature_flags`.

## accounting.js

Deps: `db`, `requireFeature`, `requireAnyPerm`. Flag `accounting_core` everywhere. Imports `utils/tz` (`toUtcStart`, `toUtcEnd`, `tenantToday`, `pgDateToStr`). Local helper `findClosedPeriodFor(entryDate)` — checks `accounting_periods` for a closed period containing the date; used to block journal-entry writes into closed periods.

Perm tiers (post-D4 split, PLAN-V2 Step 4 — `view_reports` and `manage_employees` are both gone from this directory): `accounting.js` reporting routes use `requireAnyPerm(["view_financial_reports"])`; its period writes, credit/debit notes and cheques use `requireAnyPerm(["manage_finance","all_access"])`; COA and journal entries use `requireAnyPerm(["all_access"])` only. Elsewhere: `approvals.js` → `requireAnyPerm(["manage_inventory","all_access"])`; `crm.js` → `requirePerm("manage_orders")`; `hr.js` and `company-profile.js` → `requirePerm("all_access")`.

Date param convention: `from`/`to` (not `date_from`/`date_to`) except `cashflow/daily` which uses `date_from`/`date_to`. Sales/returns date filters go through `toUtcStart`/`toUtcEnd` with `req.company.timezone`; `expenses.expense_date` is a local date column, filtered with raw `::date` cast, no UTC conversion. `supplier_payments.paid_at` and `credit_notes`/`debit_notes` `created_at` filters are TIMESTAMPTZ and correctly go through `toUtcStart`/`toUtcEnd` too — don't "fix" them to a bare `::date` cast.

**P&L / cashflow / balance sheet:**
- `GET /api/accounting/pnl` — gross sales, discounts, returns, COGS (from `sale_items.cost_price_at_sale`), expense breakdown by category, net profit + margin %. Requires `from`/`to`, optional `outlet_id`.
- `GET /api/accounting/cashflow` — inflows by `sale_payments.payment_method`, outflows = expenses + supplier payments. `supplier_payments` has no `outlet_id` column — never filtered per-outlet even when `outlet_id` is passed.
- `GET /api/accounting/cashflow/daily` — day-by-day inflow (all payment methods via `sale_payments`) vs expense outflow, merged in JS by date key. Uses `pgDateToStr` (not `toISOString()`) to round-trip plain `DATE` columns back to strings — avoids the local-midnight-Date-shifts-a-day-east-of-UTC trap.
- `GET /api/accounting/ap-ar` — `{ total_ap, total_ar, net_position }` summary.
- `GET /api/accounting/ap` — detailed supplier invoice AP list + customer AR list (customers with non-zero `balance`).
- `GET /api/accounting/ap-aging` — buckets `current/d30/d60/d90/over90` from `EXTRACT(EPOCH FROM (NOW() - due_date))/86400.0`.
- `GET /api/accounting/tax-ledger` — tax collected grouped by `sale_items.tax_rate_at_sale`. Requires `from`/`to`.
- `GET /api/accounting/supplier-payments` — payment history, filterable `from`/`to`.
- `GET /api/accounting/expenses` — ledger with category/outlet/employee joins + full `expense_categories` list. Filterable `from`/`to`/`category_id`/`outlet_id`.
- `GET /api/accounting/balance-sheet` — assets = inventory-at-cost + cash in open shifts (`cash_shifts.opening_float`); liabilities = supplier AP + customer credit balances (negative `customers.balance`); equity = assets − liabilities. This is a simplified snapshot, not a real double-entry balance sheet.

**Accounting periods** (`accounting_periods`): `GET`/`POST /api/accounting/periods`, `PUT /api/accounting/periods/:id` (status/notes; closing records `closed_by` from `x-employee-id` header + `closed_at`).

**Credit/Debit notes — shared factory `mountNoteRoutes(table, prefix)`:**
Mounts identical routes twice: `credit_notes`/`credit-notes` and `debit_notes`/`debit-notes`.
- `GET /api/accounting/{prefix}` (filters: status, type, from, to — TZ-aware via `toUtcStart`/`toUtcEnd`), `GET /:id`.
- `POST` — auto `note_number` = `CN-YYYYMMDD-NNN` / `DN-YYYYMMDD-NNN`. Requires `type`, `amount` (>0), `reason`; `customer_id` required if `type='sales'`, `supplier_id` if `type='purchase'`.
- `PUT /:id` — draft only.
- `PUT /:id/approve` — transactional, row locked `FOR UPDATE`. Adjusts `customers.balance` or `suppliers.running_balance`: sales credit note decreases customer balance, sales debit note increases it (reverse for purchase type). Best-effort journal entry posting if COA codes `1100/2000/4000/5000` exist (won't fail the approve if COA isn't seeded). `entry_date` uses `tenantToday(req.company?.timezone)`, not `CURRENT_DATE`.
- `PUT /:id/cancel` — transactional; if the note was approved, reverses the balance adjustment.

**Chart of Accounts** (`chart_of_accounts`), perm `requireAnyPerm(["all_access"])`:
- `GET /api/accounting/coa` — flat list + nested `tree` via `buildCoaTree()`, sorted by `code`.
- `GET /api/accounting/coa/:id` — includes computed `balance` from posted `journal_entry_lines` (`normal_balance==='debit' ? debit-credit : credit-debit`).
- `GET /api/accounting/coa/next-code/:type` — registered AFTER `/:id` in the file. Safe today only because `/next-code/asset` has 3 path segments vs `/:id`'s 2 — no shadowing currently. **Any new two-segment `/api/accounting/coa/*` route added after `/:id` will be shadowed by it; register it before `/:id` or give it 3+ segments.**
- `POST /api/accounting/coa` — validates type ∈ asset/liability/equity/revenue/expense, code uniqueness, parent existence. `normal_balance` auto-derived (asset/expense→debit, else credit).
- `POST /api/accounting/coa/seed` — idempotent, skips entirely if any account row exists; seeds 21 Pakistan-standard accounts with `ON CONFLICT (code) DO NOTHING`.
- `PUT /api/accounting/coa/:id` — system accounts (`is_system=true`) can only update `name`/`description`; user accounts get full update with code-uniqueness + self-parent-cycle checks.
- `DELETE /api/accounting/coa/:id` — soft delete (`is_active=false`). Blocked if `is_system` or if any `journal_entry_lines` reference the account.

**Post-dated cheques** (`postdated_cheques`), perm `requireAnyPerm(["manage_employees","all_access"])`:
- `GET` (list, filterable), `GET /upcoming` (pending, maturing within 7 days — window anchored to `tenantToday(req.company?.timezone)`, not `CURRENT_DATE`), `GET /:id`, `POST`, `PUT /:id` (pending only), `DELETE /:id` (pending only).
- `PUT /:id/deposit` — pending→deposited.
- `PUT /:id/clear` — transactional, `FOR UPDATE`. deposited→cleared. Receivable+customer: decreases `customers.balance`. Payable+supplier: inserts a `supplier_payments` row with `supplier_invoice_id = NULL`. Best-effort journal entry if COA codes `1000/1100`(receivable) or `2000/1000`(payable) exist.
- `PUT /:id/bounce` — deposited→bounced. `PUT /:id/cancel` — pending→cancelled.

**Journal entries** (`journal_entries`, `journal_entry_lines`), perm `requireAnyPerm(["all_access"])`:
- `GET` — paginated (`page`/`per_page`), filterable `from`/`to`/`status`, returns `total` + per-entry `total_debit`/`total_credit`/`line_count` from a subquery.
- `GET /:id` — with `lines` joined to `chart_of_accounts`.
- `POST` — requires `entry_date`, `description`, ≥2 `lines`. Debits must equal credits within 0.005 tolerance. All `account_id`s must exist and be `is_active`. Blocked via `findClosedPeriodFor(entry_date)` if the date falls in a closed accounting period. Auto entry_number `JE-YYYYMMDD-NNN`. Created in transaction (header + lines).
- `PUT /:id` — draft only. Same validation as POST, including the closed-period check on the (possibly changed) `entry_date`. Replaces lines via DELETE + re-insert.
- `PUT /:id/post` — draft→posted. Reads back `entry_date` via `pgDateToStr` (not `toISOString()`) before re-checking `findClosedPeriodFor` — a draft created before a period closed can't be posted into it later.
- `PUT /:id/void` — posted→voided only (draft entries must be deleted, not voided — though no DELETE route exists in this file for journal entries).
- `GET /api/accounting/trial-balance` — all active COA accounts with posted-only debit/credit sums, optional `from`/`to`, `HAVING` filters out zero-activity accounts.

Tables touched overall: `accounting_periods`, `credit_notes`, `debit_notes`, `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `postdated_cheques`, `supplier_invoices`, `supplier_payments`, `expenses`, `expense_categories`, `outlet_stock`, `cash_shifts`, `customers`, `suppliers`.

## hr.js

Deps: `db`, `requireFeature`, `requirePerm`, `createNotification`. Every route: `requirePerm("all_access")` + flag `advanced_hr`.

**Leave** (`leave_requests`):
- `GET /api/hr/leave` — all requests + employee/approver names.
- `POST /api/hr/leave` — requires `employee_id`, `start_date`, `end_date`; supports `partial_day`/`start_time`/`end_time`. Fires `createNotification` (fire-and-forget).
- `PUT /api/hr/leave/:id/status` — status ∈ approved/rejected/pending. On approve, checks `scheduled_shifts` for date overlap (wrapped in try/catch — table may not exist on older tenants) and stores `schedule_impact_status` (`conflicts_found`/`no_conflicts`). `approved_by` comes from `x-employee-id` header, not `req.employee`.
- `GET /api/hr/leave/balance` — per-employee monthly balance vs `employees.monthly_leave_allowance` (default 2). `?month=YYYY-MM`. Loops employees one-by-one, one query each — N+1, fine at small headcount only.
- `GET /api/hr/leave/schedule-conflicts` — requires `from`/`to`, optional `employee_id`. Joins `leave_requests` to `scheduled_shifts` on date overlap.

**Payroll** (`payroll_periods`, `payroll_lines`, `hr_payroll_lines`):
- `GET`/`POST /api/hr/payroll/periods` — create with `status='draft'`.
- `POST /api/hr/payroll/periods/:id/generate` — heavy N+1: for every employee, pulls attendance hours from `employee_attendance`, leave days from `leave_requests`, and commissions from `commission_earnings` (try/catch — table may be absent). Attendance day-buckets `check_in` via `(check_in AT TIME ZONE tz)::date` using `req.company.timezone` (validated with `isValidTz`, falls back to UTC) — NOT a bare `::date` cast, which would evaluate in the DB session timezone and mis-bucket overnight shifts. Regular hours capped at `work_hours_per_day`, overtime at 1.5×. Salary types `hourly`/`daily`/`monthly` compute pay differently; monthly type deducts for excess leave (over allowance) and absent days against a 30-day month. Auto-approves any `pending` commissions swept into the period. Deletes existing `payroll_lines` for the period before regenerating; finalizes the period (`status='finalized'`) with a separate query *outside* the transaction.
- `GET /api/hr/payroll/periods/:id/lines` — auto-generated lines with employee names.
- `POST /api/hr/payroll/periods/:id/lines` — manual override row, `ON CONFLICT (period_id, employee_id) DO UPDATE`, writes to the *separate* `hr_payroll_lines` table (not `payroll_lines`).
- `GET /api/hr/payroll-export` — requires `?period_id=`. Returns period + rows shaped for CSV (frontend does the CSV conversion; this returns JSON).
- `GET /api/hr/overtime-alerts` — flags employees at ≥80% (32h) of a 40h/week threshold. Reads `attendance_sessions` (not `employee_attendance` — different table from the payroll generator above), bucketed via `(session_start AT TIME ZONE tz)` with `tenantToday(tz)` as the default week-start — same TZ-safety pattern as payroll generation. `?week=YYYY-MM-DD` (Monday), `?outlet_id=`.

Tables: `leave_requests`, `employees`, `scheduled_shifts`, `payroll_periods`, `payroll_lines`, `hr_payroll_lines`, `employee_attendance`, `attendance_sessions`, `commission_earnings`.

## crm.js

Deps: `db`, `requireFeature`, `requirePerm`, `createNotification`. Every route: `requirePerm("manage_orders")` + flag `crm_quotations`. Also imports `services/kit-engine` (`getBomType`) and `services/stock-ledger` (`decrementStock`) for the quotation-convert path. Uses `nodemailer` directly for sending quotations — reads the tenant `email_config` table, does NOT go through `services/email.js`/Resend. File header has a dead FBR e-invoicing placeholder comment (not implemented, ignore).

**Leads** (`crm_leads`, `crm_activities`):
- `GET/POST/PUT/DELETE /api/crm/leads[/:id]` — standard CRUD, COALESCE update on PUT.
- `DELETE /api/crm/leads/spam` — bulk-deletes all leads with `stage='spam'`. **Registered before `/:id`** so the literal segment `spam` isn't captured as an `:id` param — keep any future static sibling routes above `/:id` too. Pairs with staff manually setting `stage='spam'` via PUT (e.g. dismissing junk public-inquiry leads from V08 photography-style inquiry forms).
- `POST /api/crm/leads/:id/activities`, `GET /api/crm/leads/:id/activities` — activity log per lead.
- `POST /api/crm/leads/:id/convert` — creates a `customers` row (`phone→mobile`, `company→address`), sets lead `stage='converted'` + `customer_id`. Idempotent — returns the existing `customer_id` if already converted instead of erroring.

**Quotations** (`quotations`, `quotation_items`):
- `GET /api/quotations` — filters `status`, `customer_id`, `from`, `to`. `created_at` is TIMESTAMPTZ — `from`/`to` go through `toUtcStart`/`toUtcEnd` with `req.company.timezone`, not a bare `::date` cast.
- `POST /api/quotations` — requires `outlet_id` + non-empty `items[]`. Auto `quote_number = Q-{Date.now()}` (not sequential/zero-padded like the accounting note numbers). Computes subtotal/tax/discount/total; supports `discount_type: 'percent'|'fixed'`. Header + items written in one transaction.
- `GET/PUT /api/quotations/:id` — PUT only allowed when status is `draft` or `sent`; replaces items via DELETE + re-insert.
- `PUT /api/quotations/:id/status` — status ∈ draft/sent/accepted/rejected/expired/converted.
- `POST /api/quotations/:id/send` — 400 if customer has no email or SMTP (`email_config.smtp_host`) isn't set. Builds an HTML table email inline and sends via nodemailer; sets status to `sent`. Quote date shown to the customer uses `tenantToday(tz, new Date(quote.created_at))`, not a raw UTC slice, so it reads correctly in the tenant's local day.
- `DELETE /api/quotations/:id` — draft only.
- `POST /api/quotations/:id/convert` — **requires status `accepted`** (PUT status first — sending straight to convert on draft/sent returns 400). For each item, first checks `kitEngine.getBomType(client, product_id)`: a `kit` product is hard-rejected (400, `code: "kit_not_supported"`) because kits hold no stock of their own and quotation-convert can't safely explode a BOM — direct staff to convert at POS instead. Creates `sales` + `sale_items` (carrying the quotation's snapshotted `tax_rate_at_sale`/`tax_amount_at_sale` per the v83 tax-snapshot convention — NOT re-resolved live rates) + `sale_payments`, all in one transaction. **Stock decrement goes through `stockLedger.decrementStock()`** (FOR UPDATE + availability gate + variant-aware + FEFO batch consumption across all outlet-stock tables) — not a raw `outlet_stock` UPDATE. Sets `quotations.converted_sale_id`; fires `createNotification`. Errors from the kit guard (and any other `statusCode`-tagged throw) are surfaced with their real status/code instead of being flattened to 500.

Tables: `crm_leads`, `crm_activities`, `quotations`, `quotation_items`, `customers`, `sales`, `sale_items`, `sale_payments`, `outlet_stock`, `email_config`.

## approvals.js

Deps: `db`, `requireFeature`, `requirePerm`, `requireAnyPerm`. Flag `approvals` on every route; most routes have no `requirePerm` guard (any authenticated user can submit/approve) except the reconciliation route.

- `GET /api/approvals` — list from `approval_requests`, filter `?status=` (default `pending_approval`).
- `POST /api/purchase-orders/:id/submit` — PO must be `status='Draft'` (capital D). Transitions to `pending_approval`, inserts `approval_requests` (`request_type='po_approval'`).
- `POST /api/purchase-orders/:id/approve` — PO must be `pending_approval`. Body `{action: 'approved'|'rejected', action_by, reason}`. Approved → `'Approved'` (capital A); rejected → back to `'Draft'`. Updates `approval_requests`, inserts `approval_actions` + `action_history`, all in one transaction.
- `POST /api/transfers/:id/submit` — transfer must be `status='draft'` (all-lowercase, unlike PO). Same `approval_requests` pattern with `request_type='str_approval'`.
- `POST /api/transfers/:id/approve` — transfer must be `pending_approval`. Approved → `'approved'` (lowercase); rejected → `'draft'`. **Do not mix PO's capitalized statuses with transfer's lowercase ones — they are different state machines despite the parallel shape.**
- `POST /api/reconciliation/inventory/:id/approve-fix` — `requireAnyPerm(["manage_inventory","all_access"])` + flag. Body `{mode: 'push_to_shopify'|'pull_from_shopify'}`. `push_to_shopify` just marks the reconciliation row resolved (actual Shopify sync happens elsewhere). `pull_from_shopify` overwrites `outlet_stock.quantity` with the row's `external_qty`, then marks resolved. Transactional.

Tables: `approval_requests`, `approval_actions`, `purchase_orders`, `inventory_transfers`, `action_history`, `inventory_reconciliation`, `outlet_stock`.

## Cross-cutting gotchas

- **Status casing is inconsistent across modules and even within accounting.js.** PO: `Draft`/`pending_approval`/`Approved`. Transfers: `draft`/`pending_approval`/`approved`. Cheques/notes/journal entries: all-lowercase. Always check the specific table's convention before writing a status filter.
- **`x-employee-id` header, not `req.employee.id`**, is the source for `approved_by`/`created_by`/`closed_by`/`posted_by`/`voided_by` across accounting.js and hr.js. This is a legacy pattern in this directory — don't assume `req.employee` is used for attribution here even though it's available. (`approvals.js`'s reconciliation route is the exception — it reads `req.employee?.id` directly.)
- **Multiple journal-entry-posting code paths exist as inline best-effort logic** — credit/debit note approval, cheque clearing — each independently checks for specific COA account codes (`1000`, `1100`, `2000`, `4000`, `5000`) and silently skips posting if those codes aren't seeded. Approving/clearing never fails due to missing COA; it just doesn't produce a journal entry. If you add a new money-moving action that should hit the ledger, follow this same defensive pattern rather than assuming COA is always seeded.
- **`/api/accounting/coa/next-code/:type` is registered after `/api/accounting/coa/:id`** — only safe due to segment-count difference; watch this if adding new COA sub-routes. Same pattern in `crm.js`: `DELETE /api/crm/leads/spam` must stay registered before `DELETE /api/crm/leads/:id`.
- **Quotation email bypasses the shared email service** (`services/email.js`/Resend) entirely and uses raw `nodemailer` against tenant `email_config`. If you're auditing "where do tenant-configured SMTP settings get used," this is one of the only call sites.
- **`hr.js` payroll generation is O(employees) sequential queries inside one transaction** — no batching. Large tenants will be slow; don't assume it scales without profiling first.
- **Two separate leave/attendance tables feed different HR features**: `employee_attendance` feeds payroll generation; `attendance_sessions` feeds overtime alerts. They are not interchangeable.
- **Timezone discipline is enforced throughout this directory** — every date-range filter on a TIMESTAMPTZ column goes through `toUtcStart`/`toUtcEnd`, every "what day is it" check uses `tenantToday(req.company?.timezone)` (never `CURRENT_DATE` or a raw `toISOString().slice(0,10)`), and reading a plain `DATE` column back to a string uses `pgDateToStr`. This applies across accounting.js (periods, cheques, journal entries), hr.js (attendance bucketing), and crm.js (quotation dates). If you add a new date-touching route in this directory, follow the existing pattern in the same file rather than inventing a new one.
- **Quotation-to-sale conversion is not a raw stock decrement** — it goes through `services/stock-ledger.js:decrementStock()` for correctness (FOR UPDATE locking, variant awareness, FEFO batch consumption) and through `services/kit-engine.js:getBomType()` to hard-reject kit/bundle products it can't safely explode. Any other route in this directory that ever needs to move stock should follow the same pattern rather than writing directly to `outlet_stock`.
