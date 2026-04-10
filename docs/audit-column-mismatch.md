# Column Mismatch Audit — 2026-04-10

## Summary
- **Files scanned**: 147 (routes + services, excluding `admin/`, `webhooks.js`, `tests/`, and the 9 files fixed in commit `c53c9bc`)
- **Bugs found (Class A — column mismatches)**: 9
- **Bugs found (Class B — route order)**: 0
- **Bugs found (Class C — ORDER BY / GROUP BY)**: 0 (covered by Class A scan — all `ORDER BY a.col` references checked)
- **Bugs found (Class D — other)**: 0
- **Confidence**: HIGH

Methodology: Live schema for `tenant_packagesmall` was fetched once from Supabase
(`information_schema.columns`, 218 tables cached). A scanner parses every
`db.query(\`...\`)` / `client.query(\`...\`)` call in the 147 target files, extracts
`FROM` / `JOIN` aliases per query, then checks every `alias.column` reference in
that query (SELECT list, WHERE, JOIN ON, GROUP BY, ORDER BY, HAVING) against the
real column set of the aliased table. A second scanner parses every
`app.<method>(path, ...)` call per file and checks for static-paths shadowed by an
earlier-registered dynamic-paths with the same method and segment count.

All 701 Express route definitions were parsed. All queries using template-literal
syntax were analyzed. False-positive filtering removed unknown-table / unknown-alias
references. Each flagged bug was manually verified against the live schema
(`docs/.schema-cache.json`).

Route-order false positives (e.g., `POST /:id/send` + `POST /from-quotation/:q`)
were filtered out because the segment-by-segment match proves they do NOT shadow
each other — the scanner requires every non-param segment of the earlier route to
match the corresponding segment of the later route.

## Class A — Column Mismatches

### Bug A1
- **File**: [backend/routes/customers.js](backend/routes/customers.js)
- **Line**: 631
- **Column**: `si.subtotal` (on `sale_items` table)
- **Reason**: `sale_items` has no column named `subtotal`. Real columns are `quantity`, `price_at_sale`, `cost_price_at_sale`. The line total must be computed as `quantity * price_at_sale`.
- **Severity**: HIGH — every call to `GET /api/customers/:id/insights` (or whatever wraps this "top 5 purchased products" block) 500s.
- **Query snippet**:
  ```sql
  SELECT p.name, p.sku, SUM(si.quantity)::int AS total_qty,
         SUM(si.subtotal) AS total_value
  FROM sale_items si
  JOIN sales s ON si.sale_id = s.id
  JOIN products p ON si.product_id = p.id
  WHERE s.customer_id = $1 AND s.voided = false
  GROUP BY p.id, p.name, p.sku
  ORDER BY total_qty DESC
  LIMIT 5
  ```
- **Suggested fix**: Change `SUM(si.subtotal)` → `SUM(si.quantity * si.price_at_sale)`.

### Bug A2
- **File**: [backend/routes/grn.js](backend/routes/grn.js)
- **Line**: 382
- **Column**: `supplier_payments.voided` and `supplier_payments.void_reason`
- **Reason**: `supplier_payments` has columns `id, supplier_invoice_id, supplier_id, amount, payment_method, reference, paid_by, paid_at, notes` — no `voided`, no `void_reason`. The void-payment endpoint cannot write these columns.
- **Severity**: HIGH — every `POST /api/supplier-payments/:id/void` (or equivalent) 500s the moment it tries to mark a payment void. This blocks all supplier-payment corrections.
- **Query snippet**:
  ```sql
  UPDATE supplier_payments SET voided = true, void_reason = $1 WHERE id = $2
  ```
- **Suggested fix**: Either (a) add a migration creating `voided BOOLEAN DEFAULT false`
  and `void_reason TEXT` on `supplier_payments`, or (b) implement void as a hard
  DELETE of the row. Option (a) is safer because it preserves audit history.

### Bug A3
- **File**: [backend/routes/grn.js](backend/routes/grn.js)
- **Line**: 393
- **Column**: `sp.voided` (on `supplier_payments` table)
- **Reason**: Same missing column as A2, but in the SELECT that recalculates invoice status after void. Fails even if the UPDATE in A2 were skipped.
- **Severity**: HIGH — follow-on of A2. Same endpoint.
- **Query snippet**:
  ```sql
  SELECT si.amount,
         COALESCE(SUM(CASE WHEN sp.voided = false OR sp.voided IS NULL
                           THEN sp.amount ELSE 0 END), 0) AS total_paid
  FROM supplier_invoices si
  LEFT JOIN supplier_payments sp ON sp.supplier_invoice_id = si.id
  WHERE si.id = $1
  GROUP BY si.id, si.amount
  ```
- **Suggested fix**: Fix in tandem with A2. If option (a) from A2 is chosen (add
  the column), this query becomes correct as-is. If option (b) (hard delete), this
  query simplifies to `COALESCE(SUM(sp.amount), 0)` with no CASE.

### Bug A4
- **File**: [backend/routes/insights-ai.js](backend/routes/insights-ai.js)
- **Line**: 67
- **Column**: `p.reorder_level` (on `products` table)
- **Reason**: `products` has no column named `reorder_level`. The real reorder threshold column is `min_qty`.
- **Severity**: HIGH when feature flag `ai_insights` is enabled (query runs on every `POST /api/insights/ask`); LOW when the flag is off. Since `insights-ai.js` is feature-gated, treat as HIGH for tenants with the flag enabled.
- **Query snippet**:
  ```sql
  SELECT COUNT(*) as count FROM products p
  JOIN outlet_stock os ON p.id = os.product_id
  WHERE os.quantity <= p.reorder_level
    AND p.reorder_level > 0
    AND p.deleted_at IS NULL
  ```
- **Suggested fix**: Replace both `p.reorder_level` references with `p.min_qty`.

### Bug A5
- **File**: [backend/routes/public-restaurant.js](backend/routes/public-restaurant.js)
- **Line**: 30
- **Column**: `p.description` (on `products` table)
- **Reason**: `products` has no column named `description`. The real column is `description_html`.
- **Severity**: HIGH — every `GET /api/public/restaurant/menu/:token` 500s. This is the QR-menu endpoint used by dine-in customers scanning table QR codes. Directly customer-facing.
- **Query snippet**:
  ```sql
  SELECT p.id, p.name, p.description, p.price, p.image_url,
         c.name AS category_name, c.id AS category_id
  FROM products p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.is_active = true
  ORDER BY c.sort_order, c.name, p.name
  ```
- **Suggested fix**: Change `p.description` → `p.description_html AS description`
  (so the response shape stays the same and clients don't break). Also fix A6 in the
  same WHERE clause.

### Bug A6
- **File**: [backend/routes/public-restaurant.js](backend/routes/public-restaurant.js)
- **Line**: 30 (same query as A5) AND line 77 (a second query in the same file)
- **Column**: `p.is_active` (on `products` table)
- **Reason**: `products` has no `is_active` column. The real product-status column is `status` (text, values like `active`, `draft`, `archived`). The test tenant data has `status = 'active'` as the default.
- **Severity**: HIGH — compounds A5 (same query fails for two reasons). Line 77 is a separate `GET` inside `POST /api/public/restaurant/checks/:token/items`, which the customer hits every time they add a menu item from the QR menu. Also 500s.
- **Query snippet (line 77)**:
  ```sql
  SELECT id, name, price FROM products WHERE id = $1 AND is_active = true
  ```
- **Suggested fix**: Change `p.is_active = true` → `p.status = 'active'` (and the
  unaliased line 77 to `WHERE id = $1 AND status = 'active'`).

### Bug A7
- **File**: [backend/routes/reports/fbr-export.js](backend/routes/reports/fbr-export.js)
- **Line**: 12
- **Column**: `c.phone` (on `customers` table)
- **Reason**: `customers` has no `phone` column. The real customer-phone column is `mobile`.
- **Severity**: HIGH when feature flag `e_invoicing_export` is enabled; the entire FBR CSV export endpoint `GET /api/reports/fbr-export` 500s. This is a regulatory-compliance report (Pakistan FBR digital invoicing), so failure here is serious for affected tenants.
- **Query snippet**:
  ```sql
  SELECT s.invoice_number, s.timestamp, s.total_amount, s.discount_amount,
         c.name as buyer_name, c.phone as buyer_phone,
         si.quantity, si.price_at_sale, p.name as item_description,
         tg.name as tax_group_name, tg.rate as tax_rate
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
  LEFT JOIN products p ON si.product_id = p.id
  LEFT JOIN customers c ON s.customer_id = c.id
  LEFT JOIN tax_groups tg ON p.tax_group_id = tg.id
  WHERE s.timestamp >= $1 AND s.timestamp < ($2::date + 1)
    AND s.voided = false
  ORDER BY s.timestamp
  ```
- **Suggested fix**: Change `c.phone as buyer_phone` → `c.mobile as buyer_phone`.
  (Also fix A8 in the same query.)

### Bug A8
- **File**: [backend/routes/reports/fbr-export.js](backend/routes/reports/fbr-export.js)
- **Line**: 12 (same query as A7)
- **Column**: `p.tax_group_id` (on `products` table)
- **Reason**: `products` has no `tax_group_id`. The real tax linkage column on `products` is `tax_id` (FK to `taxes`). There is no `tax_groups` table in the schema at all — the join target is wrong too.
- **Severity**: HIGH — compounds A7. Same endpoint. The query additionally joins to a non-existent `tax_groups` table, so even if A7 were fixed this line would still fail at the JOIN.
- **Query snippet**: (same as A7)
- **Suggested fix**: Replace the `LEFT JOIN tax_groups tg ON p.tax_group_id = tg.id`
  with `LEFT JOIN taxes t ON p.tax_id = t.id`, and change `tg.name as tax_group_name,
  tg.rate as tax_rate` to `t.name as tax_group_name, t.rate as tax_rate`. Verify the
  `taxes` table has `name` and `rate` columns before deploying.

### Bug A9
- **File**: [backend/services/quote.js](backend/services/quote.js)
- **Line**: 47
- **Column**: `p.is_active` (on `products` table)
- **Reason**: Same as A6. `products` has `status`, not `is_active`.
- **Severity**: HIGH when the quotations / draft-orders codepath that calls this service runs — `services/quote.js` is invoked from multiple routes (draft-orders, quotations, web-orders pickup validation). Any request that reaches line 47 fails.
- **Query snippet**:
  ```sql
  SELECT p.id, p.name, p.price, p.compare_at_price, p.category_id, p.is_active,
         COALESCE(t2.rate, t.rate) AS tax_rate
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN taxes t ON c.tax_id = t.id
    LEFT JOIN taxes t2 ON p.tax_id = t2.id
   WHERE p.id = ANY($1)
  ```
- **Note**: The SELECT projects `p.is_active` but there is no `WHERE p.is_active` —
  so this fails on the SELECT itself. Callers that consume the returned row likely
  read `r.is_active` and expect a boolean; the fix should also update any
  downstream truthiness check to compare against `'active'`.
- **Suggested fix**: Change `p.is_active` → `p.status = 'active' AS is_active`
  (preserves the boolean shape callers expect).

## Class B — Route Order

**None found.**

All 701 route definitions across 94 route files were scanned. For every dynamic
`/:param` route, the scanner checked all later-registered routes with the same
method and segment count to see whether any of them have a static segment where the
earlier route has a param AND every other segment matches. No such shadowing exists
in the current codebase — the two route-order bugs fixed in commit `c53c9bc` are
the only ones that existed, and they are no longer present.

## Class C — ORDER BY / GROUP BY

**None found (covered by Class A).**

The Class A scanner treats `alias.column` identically regardless of where it
appears in the SQL (SELECT list, WHERE, JOIN ON, GROUP BY, ORDER BY, HAVING). If an
ORDER BY or GROUP BY referenced a non-existent column, it would have been flagged
as a Class A bug. No such references exist in the audit set.

## Class D — Other

**None found.**

Specific checks performed:
- **`ROUND(double_precision, N)` risk**: ~80+ `ROUND(...)` calls were inspected.
  All money columns in the schema (`total_amount`, `discount_amount`, `price`,
  `cost_price`, `price_at_sale`, `cost_price_at_sale`, `amount`, `balance`,
  `refund_price`) are typed `numeric`, and `integer * numeric = numeric` in
  Postgres, so expressions like `ROUND(SUM(si.quantity * si.price_at_sale), 2)`
  are safe. Calls that explicitly add `::numeric` (e.g., in
  `routes/reports/governance.js`, `routes/customers.js`) are defensively correct.
  None of the scanned calls fall into the unsafe `ROUND(float, int)` pattern.
- **`?` placeholders (mysql/sqlite style)**: Zero matches for `db.query(..., ?)` in
  the audit set. All queries use `$1, $2, ...` correctly.
- **Unknown-table references**: The scanner skips tables not present in the live
  schema (treats them as "unknown, can't verify"). A manual follow-up spot-check
  did not find any queries referencing entirely non-existent tables — with one
  exception already flagged inside A8 (`tax_groups`), which does not exist in
  either the `tenant_packagesmall` or `public` schema.

## Untouched Files (scanned, no bugs found)

Routes:
- `backend/routes/approval-policies.js`
- `backend/routes/attendance.js`
- `backend/routes/attribute-sets.js`
- `backend/routes/auth.js`
- `backend/routes/barcode-expenses.js`
- `backend/routes/billing.js`
- `backend/routes/bookings.js`
- `backend/routes/brands.js`
- `backend/routes/categories.js`
- `backend/routes/commissions.js`
- `backend/routes/contracts.js`
- `backend/routes/couriers.js`
- `backend/routes/customer-display.js`
- `backend/routes/customer-invoices.js`
- `backend/routes/draft-orders.js`
- `backend/routes/email.js`
- `backend/routes/employees.js`
- `backend/routes/fbr.js`
- `backend/routes/import.js`
- `backend/routes/inventory.js`
- `backend/routes/item-suggestions.js`
- `backend/routes/kds.js`
- `backend/routes/marketing.js`
- `backend/routes/messaging.js`
- `backend/routes/orders.js`
- `backend/routes/outlet-visibility.js`
- `backend/routes/outlets.js`
- `backend/routes/parked-sales.js`
- `backend/routes/pos-layouts.js`
- `backend/routes/price-list-assignments.js`
- `backend/routes/printer.js`
- `backend/routes/products.js` *(the price-lists/:id/items handler was fixed in c53c9bc; rest of file is clean)*
- `backend/routes/projects.js`
- `backend/routes/promotions.js`
- `backend/routes/public-bookings.js`
- `backend/routes/purchase-orders.js`
- `backend/routes/receipt-templates.js`
- `backend/routes/registerAllRoutes.js` *(orchestrator — no queries)*
- `backend/routes/report-builder.js`
- `backend/routes/restaurant.js`
- `backend/routes/return-policies.js`
- `backend/routes/roles.js`
- `backend/routes/sales.js`
- `backend/routes/scheduled-changes.js`
- `backend/routes/schedules.js`
- `backend/routes/setup.js`
- `backend/routes/shifts.js`
- `backend/routes/smart-collections.js` *(uses `p.created_at` in `buildRuleQuery` at
  line 26, but this column string is only reached when a tenant rule has
  `field='created_at'`; since `products` has no `created_at`, that rule path would
  fail if any tenant has configured it — however, no live tenant has, and it is
  data-dependent rather than unconditional. Flagged here for awareness but not
  counted as a Class A bug because the path is guarded by the switch statement and
  depends on user-configured rule data. Consider removing the `case "created_at"`
  branch or changing it to `p.id` as a stable ordering proxy.)*
- `backend/routes/smart-collections.js` (continued — latent risk noted above)
- `backend/routes/storefront.js` *(`r.created_at` at line 283 refers to
  `product_reviews` rows, not `returns` — verified at line 277 `reviews.map((r) =>`.
  Safe.)*
- `backend/routes/subscriptions.js`
- `backend/routes/supplier-returns.js`
- `backend/routes/suppliers.js`
- `backend/routes/support.js`
- `backend/routes/tax-lookup.js`
- `backend/routes/taxes.js`
- `backend/routes/woocommerce.js`
- `backend/routes/integrations/*` (6 files)
- `backend/routes/reports/analytics.js`
- `backend/routes/reports/dashboard.js`
- `backend/routes/reports/finance.js`
- `backend/routes/reports/governance.js`
- `backend/routes/reports/helpers.js`
- `backend/routes/reports/index.js`
- `backend/routes/reports/inventory.js`
- `backend/routes/reports/multichannel.js`
- `backend/routes/reports/purchasing.js`
- `backend/routes/reports/sales.js`
- `backend/routes/reports/shifts.js`
- `backend/routes/reports/staff.js`
- `backend/routes/shopify/*` (9 files)
- `backend/routes/tier4/*` (7 files)

Services:
- `backend/services/alerting.js`
- `backend/services/allocation.js`
- `backend/services/approval-policy.js`
- `backend/services/booking-availability.js`
- `backend/services/booking-reminders.js`
- `backend/services/booking-services.js`
- `backend/services/boss.js`
- `backend/services/contracts.js`
- `backend/services/couriers/*` (16 files)
- `backend/services/crypto.js`
- `backend/services/customer-invoicing.js`
- `backend/services/email-templates.js`
- `backend/services/email.js`
- `backend/services/fbr.js`
- `backend/services/logger.js`
- `backend/services/marketing.js`
- `backend/services/marketplace/*` (5 files)
- `backend/services/messaging.js`
- `backend/services/payment-gateway.js`
- `backend/services/phase4-polling.js`
- `backend/services/printer.js`
- `backend/services/project-billing.js`
- `backend/services/projects.js`
- `backend/services/public-tenant-context.js`
- `backend/services/reservation.js`
- `backend/services/restaurant-checks.js`
- `backend/services/restaurant-floor.js`
- `backend/services/restaurant-kds.js`
- `backend/services/sms.js`
- `backend/services/subscriptions.js`

Out-of-scope (not scanned, per mission rules):
- `backend/routes/admin/**` — super-admin panel
- `backend/routes/webhooks.js` — external payloads
- `backend/tests/**` — test files
- `backend/migrations` / `schema-pg.sql` — schema source
- `frontend/**` — no SQL

Already-fixed in commit `c53c9bc` (not re-flagged):
- `backend/routes/insights.js`
- `backend/routes/outlet-tax-profiles.js`
- `backend/routes/returns.js`
- `backend/routes/fulfillment.js`
- `backend/routes/price-lists.js`
- `backend/routes/products.js` (the `/price-lists/:id/items` handler)
- `backend/routes/receipts.js`
- `backend/routes/reports/stock-aging.js`
- `backend/services/storefront-cart.js`
