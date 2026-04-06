# Wave 1, Round 1A — 3 Parallel Sessions

**Branch**: `competitive-waves` (all sessions work on this branch)
**Pre-requisite**: Phase 0 is complete (migration v16, schema, route skeletons all committed)
**Run these 3 prompts in 3 separate Claude Code tabs simultaneously.**

After all 3 are done, verify with `git log --oneline -5` that all commits landed.

---

## Session 1: Feature #1 — Customer Blacklisting

**Copy-paste this entire block into a new Claude Code tab:**

```
You are working on the `competitive-waves` branch of the SanoPOS project. Phase 0 has already been completed — migration v16 added `is_blacklisted`, `blacklist_reason`, `blacklisted_at` columns to the customers table, and updated schema-pg.sql.

DO NOT touch migrate-pg.js, schema-pg.sql, registerAllRoutes.js, or index.js. Those are done.

## Your task: Add customer blacklisting feature

### Backend (edit routes/customers.js)

Read routes/customers.js first to understand the existing pattern.

1. Add `PUT /api/customers/:id/blacklist` endpoint:
   - Body: `{ reason }` (required)
   - Sets `is_blacklisted = true`, `blacklist_reason = $reason`, `blacklisted_at = NOW()`
   - Requires `requireAnyPerm(["manage_customers", "all_access"])`
   - Return updated customer row

2. Add `PUT /api/customers/:id/unblacklist` endpoint:
   - Sets `is_blacklisted = false`, `blacklist_reason = NULL`, `blacklisted_at = NULL`
   - Same permission
   - Return updated customer row

3. Modify the existing GET /api/customers list query to include `is_blacklisted`, `blacklist_reason`, `blacklisted_at` in the SELECT columns

4. Add blacklist check to sales flow:
   - Read routes/sales.js and find where customer_id is used in POST /api/sales
   - If customer_id is provided and customer is blacklisted, return 400: `{ error: "Customer is blacklisted: <reason>" }`
   - Do this check BEFORE the main sale transaction, not inside it

### Frontend (edit CustomersRedesign.jsx)

Read frontend/src/pages/redesign/CustomersRedesign.jsx first.

1. In the customer list table, add a red "Blacklisted" badge next to blacklisted customer names
2. In the customer detail/edit area, add a "Blacklist" button (red) that opens a small modal asking for reason, then calls PUT /api/customers/:id/blacklist
3. For blacklisted customers, show "Unblacklist" button (green) instead
4. Show the blacklist reason in the detail view as a red warning text
5. Use Tailwind classes: `bg-red-100 text-red-700` for badges, `border-red-300` for warning areas

### Commit when done:
Message: `feat(wave1): add customer blacklisting — backend endpoints + POS checkout block + frontend UI`

Do NOT touch: migrate-pg.js, schema-pg.sql, registerAllRoutes.js, index.js, appRoutes.jsx
Do NOT add tests.
```

---

## Session 2: Feature #2 — Order Aging Summary

**Copy-paste this entire block into a new Claude Code tab:**

```
You are working on the `competitive-waves` branch of the SanoPOS project. Phase 0 has already been completed — all migration and schema work is done.

DO NOT touch migrate-pg.js, schema-pg.sql, registerAllRoutes.js, or index.js.

## Your task: Add order aging summary

### Backend (edit routes/orders.js)

Read routes/orders.js first to understand the existing pattern.

1. Add `GET /api/orders/aging-summary` endpoint:
   - Returns order counts grouped by age buckets:
     - 0-2 days = "fresh"
     - 3-5 days = "aging"
     - 6-10 days = "stale"
     - 10+ days = "critical"
   - Only count orders where `order_status NOT IN ('closed', 'cancelled')`
   - Use `EXTRACT(DAY FROM NOW() - ordered_at)::integer AS age_days`
   - Return: `{ buckets: { fresh: N, aging: N, stale: N, critical: N }, critical_orders: [...] }`
   - The critical_orders array includes: id, external_order_number, customer name (JOIN customers), ordered_at, age_days
   - Requires `requireAnyPerm(["manage_orders", "view_reports"])`

2. Modify the existing `GET /api/orders` query:
   - Add `EXTRACT(DAY FROM NOW() - wo.ordered_at)::integer AS aging_days` to the SELECT
   - Add optional query param `?aging=stale` → filter to orders older than 3 days
   - Add optional query param `?aging=critical` → filter to orders older than 10 days

### Frontend

Find the orders page: grep for "OrdersRedesign" in frontend/src/pages/redesign/. Read it first.

1. Add a summary bar at the top of the orders list showing 4 colored cards:
   - Fresh (green-500): count
   - Aging (yellow-500): count
   - Stale (orange-500): count
   - Critical (red-500): count
   - Fetch from GET /api/orders/aging-summary on page load

2. Make each card clickable — clicking sets a filter that shows only orders in that aging bucket

3. Add an aging badge next to each order row:
   - Green dot for <3 days
   - Yellow dot for 3-5 days
   - Orange dot for 6-10 days
   - Red dot + "X days" text for 10+ days

### Commit when done:
Message: `feat(wave1): add order aging summary — aging buckets, critical order alerts, frontend badges`

Do NOT touch: migrate-pg.js, schema-pg.sql, registerAllRoutes.js, index.js, appRoutes.jsx, customers.js
Do NOT add tests.
```

---

## Session 3: Feature #4 — Quarterly/Yearly Billing Discounts

**Copy-paste this entire block into a new Claude Code tab:**

```
You are working on the `competitive-waves` branch of the SanoPOS project. Phase 0 has already been completed — migration v16 already inserted quarterly (PKR 21,600) and semi_annual (PKR 40,800) rows into the plan_pricing table in the public schema.

DO NOT touch migrate-pg.js, schema-pg.sql, registerAllRoutes.js, or index.js.

## Your task: Add billing cycle discounts (quarterly, semi-annual)

### Backend (edit routes/billing.js)

Read routes/billing.js first (~193 lines) to understand the existing pattern.

1. Modify `GET /api/billing/pricing` to include computed discount fields:
   - For each pricing row, calculate:
     - `months` = 1 for monthly, 3 for quarterly, 6 for semi_annual, 12 for annual
     - `monthly_equivalent` = price / months
     - Find the monthly price for the same plan: `monthly_price`
     - `discount_percent` = ROUND((1 - monthly_equivalent / monthly_price) * 100)
     - `savings` = (monthly_price * months) - price
   - Return these fields alongside the existing plan, cycle, price, currency_code

2. Modify `POST /api/billing/create-checkout` to accept "quarterly" and "semi_annual" as valid cycles:
   - Check the existing validation — it probably only allows "monthly" and "annual"
   - Add "quarterly" and "semi_annual" to the allowed cycles
   - The rest of the checkout flow should work as-is since it looks up pricing from plan_pricing

3. Modify `GET /api/billing/status` to include current cycle info and next renewal date if applicable

### Frontend

Find the billing/pricing page: grep for "BillingRedesign" or "billing" in frontend/src/pages/redesign/. Read it first.

1. Show billing cycle options as selectable cards or radio buttons:
   - Monthly (PKR 8,000/mo)
   - Quarterly (PKR 21,600 — save 10%)
   - Semi-Annual (PKR 40,800 — save 15%)
   - Annual (PKR 80,000 — save 17%)

2. For each option show:
   - Total price
   - Monthly equivalent
   - Savings amount: "Save PKR X,XXX"
   - Discount badge: "10% OFF", "15% OFF", etc.

3. Highlight the recommended option (quarterly or annual — your judgment)

4. When user selects a cycle and clicks "Subscribe" / "Upgrade", pass the cycle to POST /api/billing/create-checkout

### Commit when done:
Message: `feat(wave1): add quarterly/yearly billing discounts — cycle options, savings display, checkout support`

Do NOT touch: migrate-pg.js, schema-pg.sql, registerAllRoutes.js, index.js, appRoutes.jsx, customers.js, orders.js
Do NOT add tests.
```

---

## After All 3 Sessions Complete

Run this verification:

```bash
# Check all 3 commits landed
git log --oneline -5

# Check no migration/schema files were touched
git diff HEAD~3 -- backend/migrate-pg.js backend/schema-pg.sql
# Should show NO output (empty diff)

# Quick syntax check
node -e "require('./backend/routes/customers')" 2>&1 | head -5
node -e "require('./backend/routes/orders')" 2>&1 | head -5
node -e "require('./backend/routes/billing')" 2>&1 | head -5
```

Then come back here for **Wave 1 Round 1B** prompts (features #3, #5, #6).
