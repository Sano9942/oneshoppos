# Backend exhaustive wave shard: reports, restaurant, tier4

Status: in progress checkpoint. Read-only audit; no application/config/git/shared-ledger changes.

## Full-file receipts completed

- `backend/routes/reports/index.js` (52 lines): registration only; all report modules enumerated; no direct handler or sink.
- `backend/routes/reports/helpers.js` (194 lines): reviewed placeholder numbering, category/outlet filters, paging, JSON parsing, scheduling time helper, and CSV serialization. SQL identifiers are caller constants and values use placeholders. CSV cells quote double quotes but do not neutralize spreadsheet formula prefixes (candidate below).
- `backend/routes/reports/fbr-export.js` (51 lines): `GET /api/reports/fbr-export` has `requirePerm("all_access")`; date values are parameterized; response is JSON and does not expose `fbr_api_token`.
- `backend/routes/restaurant/availability.js` (122 lines): every route uses restaurant mode, feature, and `manage_restaurant`; write body is Zod validated; SQL parameterized. Best-effort audit writes can fail without rolling back the state change, but this is explicitly non-authoritative telemetry.
- `backend/routes/restaurant/menu-schedules.js` (151 lines): all routes use mode/feature/permission gate; create/update bodies validated; product mapping updates are transactional; dynamic update columns come from a fixed allowlist.
- `backend/routes/restaurant/pay-at-table.js` (508 lines): staff routes use mode/feature/`manage_restaurant`; public bill/confirm routes use tenant resolver plus limiter and opaque UUID token. Payment completion transaction is not idempotent under concurrency (candidate below).
- `backend/routes/restaurant/reservations.js` (297 lines): all routes share mode/feature/`manage_restaurant`; create/update/seat/SMS bodies are validated. Dynamic reservation update keys originate from the Zod-stripped update object. Seating is transactional and delegates table availability enforcement to `restaurant-floor`.
- `backend/routes/restaurant/void-comp.js` (215 lines): routes use mode/feature/`manage_restaurant` (reason editing further requires `all_access`); request bodies validated; manager PIN verified. Adjustment amount is not bounded against the line or prior adjustments (candidate below).
- `backend/routes/restaurant/waitlist.js` (209 lines): all routes use mode/feature/`manage_restaurant`; create/seat bodies validated; state transitions use conditional updates and seat/remove compaction is transactional. Position assignment itself is `MAX()+1` outside a transaction, allowing duplicate display positions but no authorization/financial impact.
- `backend/routes/tier4/index.js` (21 lines): router composition only.
- `backend/routes/tier4/notifications.js` (77 lines): tenant-scoped notifications are intentionally tenant-wide in schema (no recipient column); all routes feature gated; values parameterized.
- `backend/routes/tier4/company-profile.js` (273 lines): writes require `all_access`; logo upload checks MIME, extension, size, and magic bytes. Profile GET selects every column without a permission gate and therefore returns secrets (candidate below).
- `backend/routes/tier4/crm.js` (704 lines): every CRM/quotation route requires `manage_orders` and feature gate; SQL values parameterized. Quotation conversion is not concurrency-idempotent (candidate below).
- `backend/routes/tier4/hr.js` (562 lines): all routes require `all_access` and `advanced_hr`; query values parameterized and payroll generation uses a transaction for replace/recompute. Manual numeric inputs are not finite-number validated, but the same general numeric-integrity defect is documented more concretely at the accounting cheque sink below.
- `backend/routes/tier4/approvals.js` (268 lines): global `PERMISSION_RULES` supplies `manage_orders` on PO/transfer submit/approve and the reconciliation route has an explicit inventory gate. Mutations are parameterized and multi-write operations transactional. Caller-provided audit display names (`requested_by`, `action_by`) are not identity evidence, but authorization still derives from middleware.
- `backend/routes/tier4/accounting.js` (1,806 lines): reviewed all routes and helpers. Read routes use `view_reports`/manager permissions; note/cheque/COA/journal writes are feature and elevated-permission gated. Dynamic table names are closed-over constants from two fixed factory calls; query values are parameterized. Confirmed finite-number validation, actor attribution, and draft-state race defects; the strongest numeric corruption path is promoted below.
- `backend/routes/reports/clinical.js` (143 lines): all five routes explicitly require treatment-plan feature plus `view_reports`; static aggregate SQL only.
- `backend/routes/reports/kds-analytics.js` (111 lines): mode, feature, and `view_reports` gates; dates/IDs parameterized; snapshots capped at 500.
- `backend/routes/reports/menu-engineering.js` (179 lines): mode, feature, and `view_reports` gates; query Zod-validated; dynamic WHERE is assembled only from constant fragments with parameters.
- `backend/routes/reports/multichannel.js` (266 lines): global report permission applies; filters parameterized and product result capped. Daily report directly interpolates the stored tenant timezone without validation (candidate below).
- `backend/routes/reports/shifts.js` (224 lines): global report permission applies; identifiers parameterized. Shift-ID routes can select any tenant shift and the broad cash-flow/denominations routes can omit outlet filters, participating in the outlet-scope bypass candidate below.
- `backend/routes/reports/stock-aging.js` (152 lines): explicit report/inventory permission; SQL parameterized; comma-separated outlet support participates in the global outlet-scope bypass.
- `backend/routes/reports/analytics.js` (915 lines): reviewed all route/filter/query construction. Global GET report permission applies; interpolated timezone at retention is guarded by `isValidTz`; limits are parameterized/capped where accepted. Multiple routes accept comma-separated outlets or no outlet constraint, participating in RRT-07.
- `backend/routes/reports/dashboard.js` (736 lines): global report permission; tenant timezone is checked with `isValidTz`; outlet placeholder builder receives numeric parsed IDs. No writes. Omitted/multi-outlet filters participate in RRT-07.
- `backend/routes/reports/finance.js` (1,251 lines): global report permission; filter column identifiers are internal constants, values parameterized; inline timezone is validated. No writes. Broad or comma-separated outlet selection participates in RRT-07.
- `backend/routes/reports/governance.js` (796 lines): schedule/definition writes have elevated permissions and feature gates; dynamic report keys are mapped to internal query definitions or the allowlisted report builder. Schedule runs persist status/logs around R2/email delivery. CSV generation participates in RRT-05.
- `backend/routes/reports/inventory.js` (1,526 lines): global report permission; product/outlet filters are numeric/parameterized, feature-specific routes gated, and no writes occur. Omitted/multi-outlet filters participate in RRT-07.
- `backend/routes/reports/purchasing.js` (575 lines): global report permission; supplier/date/outlet filters are parameterized, category expansion returns tenant IDs, and routes are read-only. Broad outlet queries participate in RRT-07 where outlet filtering is absent/omitted.
- `backend/routes/reports/sales.js` (1,554 lines): global report permission; inline timezone guarded with `isValidTz`; the sole interpolated sort key uses a fixed allowlist and direction is reduced to `ASC`/`DESC`; values parameterized. Omitted/multi-outlet filters participate in RRT-07.
- `backend/routes/reports/staff.js` (369 lines): global report permission; date/outlet filters converted to parameters; read-only staff, discount, and attendance aggregates. Broad outlet scope participates in RRT-07.

## New source-backed candidates (pending final reconciliation)

### RRT-01 — Concurrent pay-at-table completion creates duplicate paid sales

- Severity: High
- CWE: CWE-362 (Concurrent Execution using Shared Resource with Improper Synchronization)
- Evidence: `backend/routes/restaurant/pay-at-table.js:359-370` reads session/status before the transaction; `:377-425` enters a transaction and inserts a sale without locking or conditionally claiming the payment session; `:478-484` only marks the session paid after all sale/item writes.
- Entry/control/sink: payment webhook event with a matching `gateway_ref` -> pre-transaction `status === "paid"` check -> unconditional `INSERT INTO sales`.
- Impact: two concurrent valid/replayed completion events can both observe `processing`, create distinct sales and sale items, and decrement/account twice while the session records only the last sale ID.
- Remediation: inside one transaction, `SELECT ... FOR UPDATE` the payment session (or atomically update `processing -> completing` with `RETURNING`), return idempotently unless the expected state was claimed, then create the sale; add a unique durable session-to-sale key.
- Counterevidence: all downstream writes are in a transaction, so a single handler failure rolls back; this does not serialize two independent transactions because neither locks/claims the session row.

### RRT-02 — Company profile read exposes FBR and setup secrets to ordinary tenant users

- Severity: High
- CWE: CWE-200 (Exposure of Sensitive Information to an Unauthorized Actor)
- Evidence: `backend/routes/tier4/company-profile.js:16-22` gates only on `multi_company` and executes `SELECT *`; `backend/schema-pg.sql:1117-1119` places `setup_token` and expiry on this row; `backend/schema-pg.sql:1131` places `fbr_api_token` on it. The global permission rules have no GET company-profile rule (`backend/middleware/permissions.js:97-103` begins with reports), while the route's own PUT at `company-profile.js:58-61` demonstrates the intended privileged `all_access` boundary for profile administration.
- Entry/control/sink: authenticated tenant request `GET /api/company-profile` -> feature flag only -> JSON serialization of all columns.
- Impact: any tenant account that can reach the feature can retrieve the tenant's FBR credential and active setup token, enabling external API misuse and possible setup-flow abuse.
- Remediation: select an explicit public-safe column allowlist; expose secrets only via separate `all_access` endpoints and return masked/presence booleans. Never return setup tokens after issuance.
- Counterevidence: tenant middleware prevents cross-tenant reads; the defect is vertical privilege/secret exposure within the tenant.

### RRT-03 — Quotation conversion is replayable under concurrency

- Severity: High
- CWE: CWE-362
- Evidence: `backend/routes/tier4/crm.js:633-640` reads and checks `accepted` outside the transaction; `:648-680` unconditionally creates a sale, sale items, stock decrements, and payment; `:682-685` marks converted only afterward, without a status predicate.
- Entry/control/sink: two concurrent `POST /api/quotations/:id/convert` requests by a `manage_orders` principal -> shared stale accepted status -> duplicate `sales` inserts and stock decrements.
- Impact: duplicated revenue/payment records and inventory depletion for one quotation.
- Remediation: lock the quotation row `FOR UPDATE` within the transaction or atomically claim `accepted -> converting` with `UPDATE ... WHERE status='accepted' RETURNING`; add a unique `sales.quotation_id`/conversion record and return the existing sale id on replay.
- Counterevidence: each individual conversion uses a transaction, which prevents partial conversion but does not serialize competing conversions.

### RRT-04 — Void/comp amounts can exceed the sold line and can be repeated without a cap

- Severity: Medium
- CWE: CWE-20 (Improper Input Validation)
- Evidence: `backend/routes/restaurant/void-comp.js:101-123` validates reason and manager PIN, then loads line price/quantity; `:124-148` inserts caller-supplied `amount` without comparing it to `price_at_sale * quantity` or aggregate prior adjustments. `backend/schemas/restaurant-void-comp.js:5-10` requires only a positive number; `backend/schema-pg.sql:3401-3412` has no upper-bound or uniqueness constraint.
- Entry/control/sink: manager-gated adjustment request -> positive-number validation -> additive adjustment ledger insert.
- Impact: repeated or oversized comps/voids can make report/accounting adjustment totals exceed the original sale, corrupting financial analytics and audit evidence.
- Remediation: lock the sale item, sum existing effective adjustments, enforce cumulative amount <= immutable line total, define mutually exclusive void/comp state, and add database constraints/idempotency keys where feasible.
- Counterevidence: requires both `manage_restaurant` and a valid manager PIN, limiting exploitability to an insider/compromised manager credential; those controls do not enforce amount integrity.

### RRT-05 — Scheduled CSV exports preserve spreadsheet formula payloads

- Severity: Medium
- CWE: CWE-1236 (Improper Neutralization of Formula Elements in a CSV File)
- Evidence: `backend/routes/reports/helpers.js:149-164` wraps values in quotes and doubles quote characters but leaves leading `=`, `+`, `-`, `@`, tab, and CR intact; `backend/routes/reports/governance.js:328-345` turns this into `text/csv` and uploads it for scheduled delivery. Report rows include user-controlled names such as product/outlet/employee fields (`governance.js:253-275`).
- Entry/control/sink: attacker-controlled tenant record name -> scheduled report row -> CSV cell -> manager opens in spreadsheet software.
- Impact: formula execution in the recipient's spreadsheet context can perform deceptive calculations and, depending on client policy, external-data exfiltration or command-like actions.
- Remediation: prefix dangerous leading characters with an apostrophe (after leading whitespace normalization), or use a proven CSV exporter with formula escaping; document that exports are untrusted data.
- Counterevidence: RFC-style quoting prevents CSV delimiter breakout but spreadsheet applications still interpret quoted cells beginning with formula markers.

### RRT-06 — Stored tenant timezone reaches multichannel SQL as executable syntax

- Severity: High
- CWE: CWE-89 (Improper Neutralization of Special Elements used in an SQL Command)
- Evidence: `backend/routes/tier4/company-profile.js:58-61,64-91,97-148` lets an `all_access` user persist arbitrary `timezone` text without `isValidTz`; `backend/routes/reports/multichannel.js:98-112` reads that value and embeds it inside a SQL string literal, and `:128-137` repeats the sink for web orders. Unlike `analytics.js:461-467`, `finance.js:828-834`, and `sales.js:161-171`, this module has no `isValidTz` guard.
- Entry/control/sink: privileged profile update with crafted timezone -> company-profile cache/request context -> any permitted `GET /api/reports/multichannel-daily` with no date filter -> raw `AT TIME ZONE '${tz}'` query text.
- Impact: a tenant admin (or compromised admin session) obtains SQL syntax control when the report runs, allowing manipulation/disclosure within that tenant schema and potentially destructive statements depending on PostgreSQL protocol/query shape.
- Remediation: validate timezone on write with `isValidTz`, revalidate on read, and pass it as a query parameter (`AT TIME ZONE $n`) as accounting daily cashflow already does. Migrate/quarantine invalid stored values.
- Counterevidence: setting the payload requires `all_access`, and tenant DB routing limits the normal search path; neither condition makes raw SQL syntax control safe. Supplying date filters may make `toUtcStart/toUtcEnd` reject an invalid timezone before the sink, but the route permits omitting them.

### RRT-07 — Report permission bypasses assigned-outlet data boundaries

- Severity: High
- CWE: CWE-639 (Authorization Bypass Through User-Controlled Key)
- Evidence: cashiers receive `view_reports` by default (`backend/middleware/permissions.js:72`), and GET report routes are globally allowed for that permission (`:97-103`). Outlet authorization converts the whole `outlet_id` query to one number and skips enforcement if absent or non-scalar (`backend/routes/registerAllRoutes.js:254-261`). Report endpoints allow no filter (all outlets) and many deliberately parse comma-separated IDs; examples: `backend/routes/reports/dashboard.js:35-62`, `analytics.js:24-40`, `finance.js:29-35,71-75`, `inventory.js:8-18`, and `stock-aging.js:17-33`.
- Entry/control/sink: employee assigned to outlet A with `view_reports` -> omit `outlet_id` or submit `outlet_id=A,B` (`Number('A,B')` becomes `NaN`) -> report SQL reads outlet B/all tenant outlets.
- Impact: outlet-scoped cashiers can read sales, margin, customer, inventory, cash-shift, supplier, and staff analytics belonging to unassigned outlets, defeating the live outlet-assignment boundary.
- Remediation: derive an allowed-outlet set from `employee_outlets` server-side and intersect every report filter with it; reject any requested ID outside the set and default omitted filters to assigned outlets. Parse multi-value IDs before authorization rather than calling `Number` on the whole string.
- Counterevidence: tenant schema routing prevents cross-tenant access and `all_access` users intentionally bypass outlet checks; this finding concerns non-`all_access` employees inside a multi-outlet tenant.

### RRT-08 — PostgreSQL `NaN` passes cheque amount validation and poisons account balances

- Severity: High
- CWE: CWE-20 (Improper Input Validation)
- Evidence: `backend/routes/tier4/accounting.js:1242-1256` accepts an untyped `amount`; `Number('NaN') <= 0` is false, after which the original string is inserted into a PostgreSQL `NUMERIC(12,2)` column. PostgreSQL numeric supports the special `NaN` value and the table has no finite/positive constraint (`backend/schema-pg.sql:1361-1377`). On clear, `accounting.js:1330-1356` converts the stored value to JS `NaN` and applies it to `customers.balance`, permanently turning the financial balance into `NaN` (the supplier branch likewise records the special value at `:1357-1363`).
- Entry/control/sink: manager with cheque permission -> create receivable cheque with JSON `amount: "NaN"` -> deposit -> clear -> arithmetic update of customer balance.
- Impact: a malformed request corrupts customer/supplier financial state and downstream accounting totals; recovery requires identifying and repairing poisoned numeric rows.
- Remediation: require Zod finite decimal numbers/strings with a strict decimal regex, convert once, enforce `Number.isFinite(amount) && amount > 0`, and add database checks rejecting non-finite/non-positive numeric values. Apply the same validation to journal, payroll, quotation, and note monetary inputs.
- Counterevidence: routes require `manage_employees` or `all_access` plus `accounting_core`, limiting the actor population; these are precisely the users trusted to preserve ledger integrity, and the current checks do not reject the special value.

### RRT-09 — A posted journal can be rewritten through a draft-check race

- Severity: Medium
- CWE: CWE-367 (Time-of-check Time-of-use Race Condition)
- Evidence: `backend/routes/tier4/accounting.js:1613-1622` reads `status` outside the later transaction and permits only the observed `draft`; `:1662-1675` then updates the journal and deletes/reinserts all lines without locking the journal or adding `WHERE status='draft'`. Concurrent posting at `:1684-1710` also reads then updates without a lock.
- Entry/control/sink: two concurrent all-access requests, edit and post -> edit observes draft, post marks posted, edit transaction subsequently replaces the now-posted entry's lines.
- Impact: immutable posted ledger history can be altered after posting, invalidating audit/accounting evidence without a corresponding reversal entry.
- Remediation: lock the journal row `FOR UPDATE` inside each mutation transaction and make every state transition conditional on its expected prior state; update the header and lines in the same transaction, and reject zero affected rows. Prefer append-only reversing entries for posted data.
- Counterevidence: only `all_access` users can invoke journal routes and line replacement is transactional; transaction atomicity does not prevent the stale status check because the row is never locked/rechecked.
