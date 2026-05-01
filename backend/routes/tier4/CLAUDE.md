# Tier 4 Routes — Claude Guide

All routes are under `/api/*` and are mounted after tenant middleware (have `req.employee`, `req.company`, `deps.db`). All modules use the factory pattern: `module.exports = function(deps)`.

## index.js — Orchestrator

Composes 6 sub-routers into one Express router in this order: notifications → company-profile → accounting → hr → crm → approvals.

## notifications.js

Feature flag: `requireFeature("notifications")` on all routes. No `requirePerm` guard — any authenticated user can read/update their notifications.

- `GET /api/notifications` — list last 50, ordered by `created_at DESC`. Supports `?unread_only=1`. Uses `is_read = false` filter (column is `is_read`, NOT `read` — Postgres reserved word).
- `GET /api/notifications/count` — returns `{ unread: N }`, count of `is_read = false`.
- `PUT /api/notifications/:id/read` — sets `is_read = true` on one notification.
- `PUT /api/notifications/read-all` — sets `is_read = true` on all unread. **This path must be registered BEFORE `/:id/read` in Express or "read-all" would be treated as an ID — the factory function registers `read-all` first, so don't reorder.**

Tables: `notifications`.

## company-profile.js

Deps used: `db`, `requireFeature`, `requirePerm`, `COMPANY_UPLOADS_DIR`. Also imports from `config/industry-config`, `config/mode-registry`, `middleware/feature-flags`, `middleware/tenant-auth`.

- `GET /api/company-profile` — `requireFeature("multi_company")`. Returns `company_profile WHERE id = 1`.
- `GET /api/company-profile/currency` — **no auth, no feature flag** — public endpoint. Used by `CurrencyProvider` on mount. In MT mode, accepts `?tenant=<slug>` to resolve the correct schema by calling `masterDb.getTenantBySlug` + `tenantDbMgr.getDb`. Returns `{ symbol, code, denominations }`. `cash_denominations` column is JSON-parsed; falls back to `[100,50,20,10,5,1]` on parse error.
- `PUT /api/company-profile` — `requirePerm("all_access")` + `requireFeature("multi_company")`. COALESCE update for most fields. `trading_name`, `ntn`, `strn`, `phone`, `email`, `website` are NOT coalesced (can be set to null). Supports `tax_mode` (`none|inclusive|exclusive` — validated, ignored if invalid). If `industry_type` is provided and valid, triggers a full mode+flag re-seed: clears `tenant_modes`, seeds new ones from preset, resets all mode-flags OFF then ON for the preset (uses `getFeatureFlagsForModes(VALID_MODES)` to avoid hardcoded lists). After any PUT: calls `invalidateCompanyProfileCache(req.tenantId)` so tax_mode takes effect immediately without waiting for 5-min cache TTL.
- `PUT /api/company-profile/onboarding-dismiss` — `requirePerm("all_access")`, no feature flag. Sets `onboarding_dismissed = true`.
- `PUT /api/company-profile/fbr-banner-dismiss` — `requirePerm("all_access")`, no feature flag. Sets `fbr_banner_dismissed = true`.
- `POST /api/company-profile/logo` — `requirePerm("all_access")` + `requireFeature("multi_company")`. Multer in-memory, 5MB limit, `imageFileFilter`. Uploads to R2 at `company/company_logo_{timestamp}.{ext}`. Updates `logo_url` in `company_profile`.

Tables: `company_profile`, `tenant_modes`, `feature_flags`.

## accounting.js

Feature flag: `requireFeature("accounting_core")` on all routes. Permission split:
- Most routes: `requireAnyPerm(["view_reports", "manage_employees"])`
- Credit/debit notes, COA, journal entries, cheques: `requireAnyPerm(["manage_employees", "all_access"])` or `requireAnyPerm(["all_access"])`

Date params: financial routes use `from`/`to` (not `date_from`/`date_to`). UTC conversion via `toUtcStart`/`toUtcEnd` for sales/returns; expenses use raw `::date` cast since `expense_date` is stored as local date.

**P&L / Cashflow:**
- `GET /api/accounting/pnl` — gross sales, discounts, returns, COGS, expenses by category, net profit. Requires `from` and `to`. Supports `?outlet_id=`.
- `GET /api/accounting/cashflow` — inflows by payment method, expenses outflow, supplier payments outflow. Requires `from` and `to`.
- `GET /api/accounting/cashflow/daily` — day-by-day cash inflows (Cash payment method only) vs expense outflows. Params: `date_from`, `date_to`, `outlet_id`. Merges two separate queries by date key in JS.
- `GET /api/accounting/ap-ar` — summary totals: `total_ap` (outstanding supplier invoices), `total_ar` (customers with positive balance), `net_position`.
- `GET /api/accounting/ap` — detailed AP list (supplier invoices with outstanding balance) + customer AR list (customers with non-zero balance). Filterable by `?status=`.
- `GET /api/accounting/ap-aging` — AP buckets: current (not yet due), d30, d60, d90, over90. Computed from `EXTRACT(EPOCH FROM (NOW() - due_date)) / 86400.0`.
- `GET /api/accounting/tax-ledger` — tax collected by rate. Requires `from`/`to`. Joins `sale_items → sales → products → taxes`. Returns per-rate rows + `total_tax`.
- `GET /api/accounting/supplier-payments` — payment history from `supplier_payments`. Filterable by `from`/`to`.
- `GET /api/accounting/expenses` — expense ledger with category/outlet/employee joins. Filterable by `from`/`to`/`category_id`/`outlet_id`. Also returns all `expense_categories`.
- `GET /api/accounting/balance-sheet` — simplified: assets (inventory at cost + cash in open shifts), liabilities (supplier AP + customer credit balances), equity (assets - liabilities).

**Accounting periods:**
- `GET /api/accounting/periods`
- `POST /api/accounting/periods` — requires `period_name`, `start_date`, `end_date`. Inserts with `status='open'`.
- `PUT /api/accounting/periods/:id` — updates `status`, `notes`. When `status='closed'`, records `closed_by` (from `x-employee-id` header) and `closed_at=NOW()`.

**Credit/Debit Notes — `mountNoteRoutes(table, prefix)` factory:**

Shared factory mounts identical route sets for `credit_notes` (`/api/accounting/credit-notes`) and `debit_notes` (`/api/accounting/debit-notes`). Auth: `requireAnyPerm(["manage_employees","all_access"])` + `requireFeature("accounting_core")`.

- `GET /api/accounting/{credit-notes|debit-notes}` — filterable by `status`, `type`, `from`, `to`.
- `GET /api/accounting/{prefix}/:id`
- `POST /api/accounting/{prefix}` — auto-generates `note_number` (`CN-YYYYMMDD-NNN` or `DN-YYYYMMDD-NNN`). Validates: `type`, `amount`, `reason` required; `customer_id` required for sales type; `supplier_id` required for purchase type; amount must be positive.
- `PUT /api/accounting/{prefix}/:id` — draft only.
- `PUT /api/accounting/{prefix}/:id/approve` — transactional. Locks note with `FOR UPDATE`. Adjusts customer `balance` or supplier `running_balance` based on type and note direction. Credit note (sales): decreases customer balance (gives credit). Debit note (sales): increases customer balance (owes more). Reverse logic for purchase types.
- `PUT /api/accounting/{prefix}/:id/cancel` — transactional. If was `approved`, reverses the balance adjustment. Can cancel both draft and approved notes.

**Chart of Accounts (COA):**
Auth: `requireAnyPerm(["all_access"])` + `requireFeature("accounting_core")`.

- `GET /api/accounting/coa` — returns flat `accounts` array + nested `tree` (built by `buildCoaTree()`). Sorted by `code` at each level.
- `GET /api/accounting/coa/:id` — single account with computed balance from posted journal entry lines. `balance = (normal_balance==='debit') ? debits - credits : credits - debits`.
- `GET /api/accounting/coa/next-code/:type` — suggests next account code for a type. Uses `MAX(code)` matching `^{prefix}\d+$` regex, increments by 10.
- `POST /api/accounting/coa` — validates `code`, `name`, `type` (must be asset/liability/equity/revenue/expense). Checks code uniqueness. `normal_balance` auto-derived: asset/expense → debit, others → credit.
- `POST /api/accounting/coa/seed` — idempotent seed of 21 Pakistan-standard accounts. Skips if any accounts exist. Uses `ON CONFLICT (code) DO NOTHING`.
- `PUT /api/accounting/coa/:id` — system accounts (`is_system=true`) can only have `name` and `description` updated. User accounts: full update with code uniqueness check and parent cycle prevention.
- `DELETE /api/accounting/coa/:id` — soft-delete (sets `is_active=false`). Blocks if `is_system=true` or if account has any `journal_entry_lines`.

**Post-Dated Cheques:**
Auth: `requireAnyPerm(["manage_employees","all_access"])` + `requireFeature("accounting_core")`.

- `GET /api/accounting/cheques` — filterable by `status`, `type`, `maturity_from`, `maturity_to`. Joins customer/supplier by `party_type`.
- `GET /api/accounting/cheques/upcoming` — pending cheques maturing within next 7 days.
- `GET /api/accounting/cheques/:id`
- `POST /api/accounting/cheques` — requires `cheque_number`, `type`, `party_type`, `party_id`, `amount`, `issue_date`, `maturity_date`.
- `PUT /api/accounting/cheques/:id` — pending cheques only.
- `DELETE /api/accounting/cheques/:id` — pending cheques only.
- `PUT /api/accounting/cheques/:id/deposit` — pending → deposited.
- `PUT /api/accounting/cheques/:id/clear` — transactional (FOR UPDATE). deposited → cleared. Side effects: receivable cheque decreases customer balance; payable cheque inserts a `supplier_payments` row (with `supplier_invoice_id = NULL`).
- `PUT /api/accounting/cheques/:id/bounce` — deposited → bounced.
- `PUT /api/accounting/cheques/:id/cancel` — pending → cancelled.

**Journal Entries:**
Auth: `requireAnyPerm(["all_access"])` + `requireFeature("accounting_core")`.

- `GET /api/accounting/journal-entries` — paginated (`page`, `per_page`). Filterable by `from`, `to`, `status`. Returns `total` count. Includes `total_debit`, `total_credit`, `line_count` from subquery.
- `GET /api/accounting/journal-entries/:id` — with full `lines` array joined to `chart_of_accounts`.
- `POST /api/accounting/journal-entries` — validates: `entry_date`+`description` required, ≥2 lines, debits must equal credits (within 0.005 tolerance), all `account_id`s must be active. Auto-generates `entry_number` (`JE-YYYYMMDD-NNN`). Creates in transaction (header + lines).
- `PUT /api/accounting/journal-entries/:id` — draft only. Replaces all lines (DELETE + re-insert in transaction). Same validation as POST.
- `PUT /api/accounting/journal-entries/:id/post` — draft → posted. Records `posted_by`, `posted_at`.
- `PUT /api/accounting/journal-entries/:id/void` — posted → voided. Cannot void draft (delete instead). Records `voided_by`, `voided_at`.
- `GET /api/accounting/trial-balance` — all active COA accounts with posted journal entry line totals. Optional `from`/`to` date filter. Only returns accounts with non-zero activity (`HAVING` clause). Returns per-account `balance` + `grand_total_debit`/`grand_total_credit`.

Tables: `accounting_periods`, `credit_notes`, `debit_notes`, `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `postdated_cheques`, `supplier_invoices`, `supplier_payments`, `expenses`, `expense_categories`, `outlet_stock`, `cash_shifts`, `customers`, `suppliers`.

## hr.js

Feature flag: `requireFeature("advanced_hr")` + `requirePerm("all_access")` on all routes. Deps: `db`, `requireFeature`, `requirePerm`, `createNotification`.

**Leave management:**
- `GET /api/hr/leave` — all leave requests with employee + approver names.
- `POST /api/hr/leave` — requires `employee_id`, `start_date`, `end_date`. Type defaults to `annual`. Fires `createNotification` (fire-and-forget) on creation.
- `PUT /api/hr/leave/:id/status` — valid statuses: `approved`, `rejected`, `pending`. On `approved`: checks `scheduled_shifts` for conflicts (try/catch — table may not exist). Sets `schedule_impact_status` to `conflicts_found` or `no_conflicts`. `approved_by` taken from `x-employee-id` header.
- `GET /api/hr/leave/balance` — per-employee monthly leave balance. Accepts `?month=YYYY-MM` (defaults to current month). Queries `employees.monthly_leave_allowance` (default 2) vs approved leave days. Iterates employees in a loop (N+1 per employee — no batch query).
- `GET /api/hr/leave/schedule-conflicts` — requires `from` and `to`. Joins `leave_requests` with `scheduled_shifts` to find overlapping shifts. Filterable by `employee_id`.

**Payroll:**
- `GET /api/hr/payroll/periods` — all payroll periods.
- `POST /api/hr/payroll/periods` — requires `period_name`, `start_date`, `end_date`. Inserts with `status='draft'`. Records `created_by` from `x-employee-id`.
- `POST /api/hr/payroll/periods/:id/generate` — **heavy operation**: iterates all employees, computes attendance (from `employee_attendance`), leave days, overtime (regular hours capped at `work_hours_per_day`, overtime at 1.5x), and commissions (from `commission_earnings` — try/catch, table may not exist). Salary types: `hourly`, `daily`, `monthly`. Monthly salaries deduct for excess leave and absent days (vs 30-day month). Auto-approves pending commissions included in the payroll. Deletes existing `payroll_lines` before re-generating. Finalizes period to `status='finalized'` outside the transaction.
- `GET /api/hr/payroll/periods/:id/lines` — payroll lines with employee names.
- `POST /api/hr/payroll/periods/:id/lines` — manual override. Uses `ON CONFLICT(period_id, employee_id) DO UPDATE`. Inserts to `hr_payroll_lines` (separate from auto-generated `payroll_lines`).
- `GET /api/hr/payroll-export` — requires `?period_id=`. Returns period + rows with computed overtime hours. Intended for CSV export (returns JSON, frontend converts).
- `GET /api/hr/overtime-alerts` — employees approaching or exceeding 40h/week threshold. Alerts at 80% (32h+). Accepts `?week=YYYY-MM-DD` (Monday) and `?outlet_id=`. Uses `attendance_sessions` (not `employee_attendance`).

Tables: `leave_requests`, `employees`, `scheduled_shifts`, `payroll_periods`, `payroll_lines`, `hr_payroll_lines`, `employee_attendance`, `attendance_sessions`, `commission_earnings`.

## crm.js

Feature flag: `requireFeature("crm_quotations")` + `requirePerm("manage_orders")` on all routes. Deps: `db`, `requireFeature`, `requirePerm`, `createNotification`. Uses `nodemailer` directly (NOT `services/email.js`) for quotation sends.

**Leads (`/api/crm/leads`):**
- `GET /api/crm/leads` — with `assigned_to` name and `activity_count` subquery.
- `POST /api/crm/leads` — requires `name`. Defaults: `stage='new'`, `priority='medium'`, `expected_value=0`.
- `PUT /api/crm/leads/:id` — COALESCE update.
- `DELETE /api/crm/leads/:id`
- `POST /api/crm/leads/:id/activities` — requires `description`. Type defaults to `note`.
- `GET /api/crm/leads/:id/activities` — with employee name.
- `POST /api/crm/leads/:id/convert` — creates a customer from lead data (`phone → mobile`, `company → address`). Sets `stage='converted'`, `customer_id` on lead. Idempotent: returns existing `customer_id` if already converted.

**Quotations (`/api/quotations`):**
- `GET /api/quotations` — filterable by `status`, `customer_id`, `from`, `to`. Joins customers, leads, employees, outlets.
- `POST /api/quotations` — requires `outlet_id` and `items` array. Auto-generates `quote_number = Q-{Date.now()}`. Creates header + items in transaction. Computes `subtotal`, `tax_total`, `total_amount`. Supports `discount_type: 'percent' | 'fixed'`.
- `GET /api/quotations/:id` — with items joined to products.
- `PUT /api/quotations/:id` — draft or sent status only. Replaces items (DELETE + re-insert) in transaction.
- `PUT /api/quotations/:id/status` — valid statuses: `draft`, `sent`, `accepted`, `rejected`, `expired`, `converted`.
- `POST /api/quotations/:id/send` — reads `email_config` for SMTP credentials. Sends HTML email via nodemailer directly. Updates status to `sent`. Returns 400 if customer has no email or SMTP is not configured.
- `DELETE /api/quotations/:id` — draft only.
- `POST /api/quotations/:id/convert` — **only works if status is `accepted`** (must PUT status to `accepted` first). Creates a `sales` record + `sale_items` + `sale_payments` + decrements `outlet_stock` in a transaction. Sets `converted_sale_id`. Fires `createNotification`.

Tables: `crm_leads`, `crm_activities`, `quotations`, `quotation_items`, `customers`, `sales`, `sale_items`, `sale_payments`, `outlet_stock`, `email_config`.

## approvals.js

Feature flag: `requireFeature("approvals")` on all routes. No `requirePerm` except reconciliation route.

- `GET /api/approvals` — approval requests filterable by `?status=` (defaults to `pending_approval`). Reads from `approval_requests`.
- `POST /api/purchase-orders/:id/submit` — PO must be `status='Draft'` (capital D). Creates `approval_requests` row (`request_type='po_approval'`) and updates PO to `'pending_approval'` in transaction.
- `POST /api/purchase-orders/:id/approve` — PO must be `'pending_approval'`. Body: `{ action, action_by, reason }`. `action` must be `'approved'` or `'rejected'`. On approved: sets PO to `'Approved'` (capital A). On rejected: resets to `'Draft'`. Updates `approval_requests` + inserts `approval_actions` + inserts `action_history` in transaction.
- `POST /api/transfers/:id/submit` — transfer must be `status='draft'` (lowercase). Creates `approval_requests` (`request_type='str_approval'`).
- `POST /api/transfers/:id/approve` — transfer must be `'pending_approval'`. On approved: sets to `'approved'` (lowercase, unlike PO). On rejected: resets to `'draft'`.
- `POST /api/reconciliation/inventory/:id/approve-fix` — `requireFeature("approvals")` + `requireAnyPerm(["manage_inventory","all_access"])`. Body: `{ mode }`. Two modes: `push_to_shopify` (marks `resolution_status='resolved'`, Shopify sync handled separately) or `pull_from_shopify` (overwrites `outlet_stock.quantity` with `external_qty` from reconciliation row, then marks resolved). Transactional.

Tables: `approval_requests`, `approval_actions`, `purchase_orders`, `inventory_transfers`, `action_history`, `inventory_reconciliation`, `outlet_stock`.

## Permission Summary

| Module | Permission | Feature Flag |
|--------|-----------|--------------|
| notifications.js | none | `notifications` |
| company-profile.js GET/PUT | `all_access` (PUT) | `multi_company` |
| company-profile.js /currency | none (public) | none |
| company-profile.js /onboarding-dismiss, /fbr-banner-dismiss | `all_access` | none |
| accounting.js most routes | `view_reports` or `manage_employees` | `accounting_core` |
| accounting.js COA + journal entries | `all_access` | `accounting_core` |
| accounting.js credit/debit notes + cheques | `manage_employees` or `all_access` | `accounting_core` |
| hr.js all routes | `all_access` | `advanced_hr` |
| crm.js all routes | `manage_orders` | `crm_quotations` |
| approvals.js most routes | none | `approvals` |
| approvals.js reconciliation fix | `manage_inventory` or `all_access` | `approvals` |

## Key Gotchas

- **`/api/quotations/:id/convert`** requires status to be `accepted` — you must call `PUT /api/quotations/:id/status` with `{status:'accepted'}` before converting. Sending convert on a draft/sent quotation returns 400.
- **`/api/hr/payroll/periods/:id/generate`** is a heavy N+1 operation — iterates every employee and runs multiple queries per employee inside a transaction. Not suited for large employee counts without optimization.
- **Quotation email uses nodemailer directly** — reads `email_config` table from the tenant DB, not the Resend/system email service. Will fail with "Email not configured" if no SMTP config is set.
- **PO approval status casing**: `'Draft'` → `'pending_approval'` → `'Approved'` (capital D and A). Transfer approval uses all-lowercase: `'draft'` → `'pending_approval'` → `'approved'`. Do NOT mix cases when querying.
- **COA delete is soft** (sets `is_active=false`, does not DELETE the row). Can't delete system accounts or accounts with journal entries.
- **`company-profile.js` PUT with `industry_type`** resets ALL mode-related feature flags and re-seeds from the preset. This is intentional but means changing industry type overwrites any manual flag overrides.
