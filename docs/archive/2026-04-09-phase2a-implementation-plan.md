# Phase 2A Operational Depth — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Phase 2A operational depth features (scheduling, outlet pricing, draft orders, approval policies, return policies, labor analytics) on the `omnichannel-phase1` branch with one commit per workstream.

**Architecture:** Foundation-first approach. A shared foundation (migration v19, feature flags, approval policy engine, price list CRUD) ships first, then 5 workstreams build on it independently. Each workstream = schema + backend routes + frontend UI, committed as one unit.

**Tech Stack:** Node.js/Express v5 backend, PostgreSQL (via `pg` pool), React 19 + Vite 7 + Tailwind CSS v4 frontend. Zod validation. Feature-flagged rollout.

**Branch:** `omnichannel-phase1` (continuing existing work)

---

## Workstream Overview

| # | Workstream | Commit | Dependencies |
|---|-----------|--------|-------------|
| 0 | Shared foundations | `feat(phase2): add shared foundations — migration v19, feature flags, approval policy engine, price list CRUD` | None |
| 1 | Workforce scheduling | `feat(phase2): add workforce scheduling, time-off, geofence, overtime alerts` | Foundation |
| 2 | Outlet-aware pricing | `feat(phase2): add outlet-aware pricing with price list assignments` | Foundation |
| 3 | Synced draft orders | `feat(phase2): add synced draft orders with claim/complete and POS approval UI` | Foundation (approval engine) |
| 4 | Returns policy | `feat(phase2): add return policies, structured reasons, and staff attribution` | Foundation (approval engine) |
| 5 | Labor analytics | `feat(phase2): add labor-vs-sales dashboard and staff attribution reporting` | Foundation + WS1 (scheduling data) |

---

## Task 0: Shared Foundations

### Task 0.1: Migration v19 — All Phase 2A Tables and Extensions

**Files:**
- Modify: `backend/migrate-pg.js` (add after line ~1090, following v18 pattern)
- Modify: `backend/schema-pg.sql` (add after line ~1960, before schema_version)

**Step 1: Add migration v19 to migrate-pg.js**

Add this migration object to the `MIGRATIONS` array, after the v18 entry:

```javascript
{
  version: 19,
  description: "Phase 2A — scheduling, pricing assignments, draft orders, approval policies, return policies, labor analytics",
  up: async (client) => {
    // -- Workforce scheduling --
    await client.query(`
      CREATE TABLE IF NOT EXISTS scheduled_shifts (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        outlet_id INTEGER NOT NULL REFERENCES outlets(id),
        shift_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        break_minutes INTEGER DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
        notes TEXT,
        created_by INTEGER REFERENCES employees(id),
        published_at TIMESTAMPTZ,
        publish_notification TEXT DEFAULT 'affected' CHECK (publish_notification IN ('affected','all','none')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -- Outlet geofence fields --
    await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)`);
    await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)`);
    await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER`);

    // -- Leave request scheduling extensions --
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS partial_day BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time TIME`);
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time TIME`);
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS schedule_impact_status TEXT`);

    // -- Price list assignments --
    await client.query(`
      CREATE TABLE IF NOT EXISTS price_list_assignments (
        id SERIAL PRIMARY KEY,
        price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL CHECK (scope_type IN ('outlet','channel','customer','customer_group')),
        scope_id INTEGER NOT NULL,
        priority INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        starts_at TIMESTAMPTZ,
        ends_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(price_list_id, scope_type, scope_id)
      )
    `);

    // -- Draft orders --
    await client.query(`
      CREATE TABLE IF NOT EXISTS draft_orders (
        id SERIAL PRIMARY KEY,
        outlet_id INTEGER NOT NULL REFERENCES outlets(id),
        customer_id INTEGER REFERENCES customers(id),
        created_by INTEGER NOT NULL REFERENCES employees(id),
        claimed_by INTEGER REFERENCES employees(id),
        claimed_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','completed','cancelled')),
        notes TEXT,
        subtotal NUMERIC(12,2) DEFAULT 0,
        tax_total NUMERIC(12,2) DEFAULT 0,
        discount_total NUMERIC(12,2) DEFAULT 0,
        total NUMERIC(12,2) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS draft_order_items (
        id SERIAL PRIMARY KEY,
        draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        variant_id INTEGER,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        price NUMERIC(12,2) NOT NULL,
        discount NUMERIC(12,2) DEFAULT 0,
        effective_tax_rate NUMERIC(6,4) DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -- Approval policies (generic, reusable) --
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_policies (
        id SERIAL PRIMARY KEY,
        action_type TEXT NOT NULL,
        outlet_id INTEGER REFERENCES outlets(id),
        role_id INTEGER REFERENCES roles(id),
        policy TEXT NOT NULL DEFAULT 'allowed' CHECK (policy IN ('allowed','denied','approval_required')),
        threshold_value NUMERIC(12,2),
        threshold_type TEXT CHECK (threshold_type IN ('amount','percent')),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(action_type, outlet_id, role_id)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_events (
        id SERIAL PRIMARY KEY,
        policy_id INTEGER REFERENCES approval_policies(id),
        action_type TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id INTEGER,
        requested_by INTEGER NOT NULL REFERENCES employees(id),
        approved_by INTEGER REFERENCES employees(id),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
        reason TEXT,
        metadata JSONB,
        outlet_id INTEGER REFERENCES outlets(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -- Return policies and reasons --
    await client.query(`
      CREATE TABLE IF NOT EXISTS return_policies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        return_window_days INTEGER,
        receipt_required BOOLEAN DEFAULT TRUE,
        restocking_fee_percent NUMERIC(5,2) DEFAULT 0,
        allowed_refund_methods TEXT[] DEFAULT '{cash,card,store_credit}',
        is_default BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS return_reasons (
        id SERIAL PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        requires_note BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // -- Return table extensions --
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS policy_id INTEGER REFERENCES return_policies(id)`);
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS policy_result TEXT`);
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS approval_event_id INTEGER REFERENCES approval_events(id)`);
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS processed_by_employee_id INTEGER REFERENCES employees(id)`);
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS approved_by_employee_id INTEGER REFERENCES employees(id)`);
    await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_reason_id INTEGER REFERENCES return_reasons(id)`);

    // -- Indexes --
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_outlet_date ON scheduled_shifts(outlet_id, shift_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_employee ON scheduled_shifts(employee_id, shift_date)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_draft_orders_outlet_status ON draft_orders(outlet_id, status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_draft_orders_claimed ON draft_orders(claimed_by) WHERE status = 'claimed'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_price_list_assignments_scope ON price_list_assignments(scope_type, scope_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_events_ref ON approval_events(reference_type, reference_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_policies_action ON approval_policies(action_type, outlet_id)`);
  },
},
```

**Step 2: Add the same tables to schema-pg.sql**

Append the same table definitions (as plain DDL, no `IF NOT EXISTS` needed in the canonical schema) after the existing tables but before the `schema_version` table at line ~1962.

**Step 3: Run migration locally**

```bash
cd backend && node migrate-pg.js
```

Expected: `Migration v19 applied successfully`

### Task 0.2: Feature Flags

**Files:**
- Modify: `backend/middleware/feature-flags.js` (add to `DEFAULT_FEATURE_FLAGS` object around line 9-50)

**Step 1: Add Phase 2 feature flags**

Add these entries to the `DEFAULT_FEATURE_FLAGS` object:

```javascript
phase2_scheduling: false,
phase2_outlet_pricing: false,
phase2_draft_orders: false,
phase2_pos_approvals: false,
phase2_returns_policy: false,
```

### Task 0.3: Approval Policy Engine (Shared Service)

**Files:**
- Create: `backend/services/approval-policy.js`

**Step 1: Create the shared approval policy service**

This service is used by draft orders (WS3), returns (WS4), and POS actions. It evaluates whether an action is allowed, denied, or requires approval based on configured policies.

```javascript
/**
 * Shared approval policy engine.
 *
 * Supported action_types:
 *   manual_discount, discount_code, return, unverified_return,
 *   void, tax_edit, order_cancel, custom_sale
 */

async function evaluatePolicy(db, { actionType, outletId, roleId, value }) {
  // Find matching policy: most specific first (outlet+role > outlet > role > global)
  const { rows } = await db.query(
    `SELECT * FROM approval_policies
     WHERE action_type = $1 AND is_active = TRUE
       AND (outlet_id = $2 OR outlet_id IS NULL)
       AND (role_id = $3 OR role_id IS NULL)
     ORDER BY
       outlet_id IS NULL ASC,
       role_id IS NULL ASC
     LIMIT 1`,
    [actionType, outletId, roleId]
  );

  if (rows.length === 0) return { policy: "allowed", policyId: null };

  const pol = rows[0];

  // Threshold check: if value is below threshold, allow regardless
  if (pol.threshold_value != null && value != null) {
    if (pol.threshold_type === "amount" && Number(value) < Number(pol.threshold_value)) {
      return { policy: "allowed", policyId: pol.id };
    }
    if (pol.threshold_type === "percent" && Number(value) < Number(pol.threshold_value)) {
      return { policy: "allowed", policyId: pol.id };
    }
  }

  return { policy: pol.policy, policyId: pol.id };
}

async function recordApprovalEvent(db, {
  policyId, actionType, referenceType, referenceId,
  requestedBy, approvedBy, status, reason, metadata, outletId,
}) {
  const { rows } = await db.query(
    `INSERT INTO approval_events
       (policy_id, action_type, reference_type, reference_id,
        requested_by, approved_by, status, reason, metadata, outlet_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [policyId, actionType, referenceType, referenceId,
     requestedBy, approvedBy, status, reason,
     metadata ? JSON.stringify(metadata) : null, outletId]
  );
  return rows[0];
}

module.exports = { evaluatePolicy, recordApprovalEvent };
```

### Task 0.4: Approval Policy CRUD Routes

**Files:**
- Create: `backend/routes/approval-policies.js`
- Modify: `backend/routes/registerAllRoutes.js` (add route mount)

**Step 1: Create the approval policy route file**

Follow the existing pattern from `parked-sales.js` — export a function that takes `(app, deps)`.

Endpoints:
- `GET /api/approval-policies` — list policies (with optional `?action_type=` filter)
- `POST /api/approval-policies` — create policy (requires `all_access` perm)
- `PUT /api/approval-policies/:id` — update policy
- `DELETE /api/approval-policies/:id` — soft-delete (set `is_active = false`)
- `POST /api/approvals/pos-authorize` — authorize a POS action (validates manager PIN, records approval event)

The `pos-authorize` endpoint body:
```json
{
  "action_type": "manual_discount",
  "reference_type": "sale",
  "reference_id": 123,
  "manager_pin": "1234",
  "outlet_id": 1,
  "metadata": { "discount_percent": 25 }
}
```

It validates the manager's PIN, checks the manager has `all_access` or `manage_pos` permission, then records an approval event.

**Step 2: Register the route**

Add to `registerAllRoutes.js` after the existing approvals require:
```javascript
require("./approval-policies")(app, deps);
```

### Task 0.5: Price List Admin CRUD Routes

**Files:**
- Create: `backend/routes/price-lists.js`
- Modify: `backend/routes/registerAllRoutes.js` (add route mount)

**Step 1: Create the price list route file**

Endpoints:
- `GET /api/price-lists` — list all price lists with item counts
- `GET /api/price-lists/:id` — single price list with items
- `POST /api/price-lists` — create price list (requires `manage_products` perm)
- `PUT /api/price-lists/:id` — update price list
- `DELETE /api/price-lists/:id` — delete price list
- `GET /api/price-lists/:id/items` — list items (already consumed by POSContext)
- `POST /api/price-lists/:id/items` — add/upsert items
- `DELETE /api/price-lists/:id/items/:itemId` — remove item

Note: The `products.js` route already has some price list logic at lines 1155-1338. The new route file should handle standalone CRUD; the product-embedded price list management in products.js stays as-is for backward compatibility.

**Step 2: Register the route**

Add to `registerAllRoutes.js`:
```javascript
require("./price-lists")(app, deps);
```

### Task 0.6: Commit Foundations

```bash
git add backend/migrate-pg.js backend/schema-pg.sql backend/middleware/feature-flags.js \
  backend/services/approval-policy.js backend/routes/approval-policies.js \
  backend/routes/price-lists.js backend/routes/registerAllRoutes.js
git commit -m "feat(phase2): add shared foundations — migration v19, feature flags, approval policy engine, price list CRUD"
```

---

## Task 1: Workstream 1 — Workforce Scheduling and Time Control

### Task 1.1: Backend — Schedule Routes

**Files:**
- Create: `backend/routes/schedules.js`
- Modify: `backend/routes/registerAllRoutes.js`

**Endpoints:**
- `GET /api/schedules` — list shifts (filters: `outlet_id`, `employee_id`, `from`, `to`, `status`)
- `POST /api/schedules` — create draft shift
- `PUT /api/schedules/:id` — update draft shift (only if status = 'draft')
- `DELETE /api/schedules/:id` — cancel shift
- `POST /api/schedules/publish` — bulk publish draft shifts (body: `{ shift_ids: [], notify: 'affected'|'all'|'none' }`)
- `GET /api/schedules/open-shifts` — list published shifts with no employee assigned

**Permissions:** `requireFeature("phase2_scheduling")`, `requirePerm("all_access")` for create/update/publish, read for all authenticated.

**Key logic:**
- Publish sets `status = 'published'` and `published_at = NOW()`
- Validate no overlapping shifts for same employee on same date before insert/update
- Check approved leave_requests for conflicts on publish (warn, don't block)

### Task 1.2: Backend — Leave Request Extensions

**Files:**
- Modify: `backend/routes/tier4/hr.js`

**Changes:**
- Extend existing `POST /api/hr/leave` to accept `partial_day`, `start_time`, `end_time` fields
- Extend existing `PUT /api/hr/leave/:id/status` to set `schedule_impact_status` when a leave overlaps published shifts
- Add `GET /api/hr/leave/schedule-conflicts?employee_id=&from=&to=` endpoint

### Task 1.3: Backend — Geofence Validation

**Files:**
- Modify: `backend/routes/attendance.js` (around the `pin-checkin` endpoint, line ~263)

**Changes:**
- Add optional `latitude` and `longitude` to pin-checkin request body
- If outlet has geofence configured (latitude + longitude + geofence_radius_meters all non-null), validate distance using Haversine formula
- If outside geofence, return `{ allowed: false, geofence_error: true, distance_meters: N }`
- Helper function `haversineDistance(lat1, lon1, lat2, lon2)` — pure math, no library needed

### Task 1.4: Backend — Overtime Alerts

**Files:**
- Modify: `backend/routes/attendance.js` or `backend/routes/tier4/hr.js`

**Changes:**
- Add `GET /api/hr/overtime-alerts?outlet_id=&week=` endpoint
- Query attendance_sessions for the week, sum hours per employee
- Compare against configurable threshold (default 40h/week, stored in company_profile or a simple constant initially)
- Return employees approaching or exceeding threshold

### Task 1.5: Frontend — Schedule Calendar View

**Files:**
- Create: `frontend/src/pages/redesign/SchedulingRedesign.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx` (add route)
- Modify: `frontend/src/ui/nav-config.js` (add nav entry under HR section)

**Component structure:**
- Feature flag guard (`phase2_scheduling`)
- Weekly calendar grid (Mon-Sun columns, employee rows)
- Draft vs published visual distinction (opacity/color)
- Shift create/edit modal
- Publish button with notification audience selector
- Overtime warning badges per employee
- Leave request conflict indicators

### Task 1.6: Commit Scheduling

```bash
git add backend/routes/schedules.js backend/routes/attendance.js backend/routes/tier4/hr.js \
  backend/routes/registerAllRoutes.js \
  frontend/src/pages/redesign/SchedulingRedesign.jsx \
  frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js
git commit -m "feat(phase2): add workforce scheduling, time-off, geofence, overtime alerts"
```

---

## Task 2: Workstream 2 — Outlet-Aware Pricing

### Task 2.1: Backend — Price List Assignment Routes

**Files:**
- Create: `backend/routes/price-list-assignments.js`
- Modify: `backend/routes/registerAllRoutes.js`

**Endpoints:**
- `GET /api/price-list-assignments` — list assignments (filter by `price_list_id`, `scope_type`, `scope_id`)
- `POST /api/price-list-assignments` — create assignment
- `PUT /api/price-list-assignments/:id` — update assignment
- `DELETE /api/price-list-assignments/:id` — remove assignment

### Task 2.2: Backend — Price Resolution Upgrade

**Files:**
- Modify: `backend/services/quote.js` (around line 147-150, current price lookup)

**Changes:**
Update price resolution to follow precedence:
1. Active scheduled override (Phase 2B — skip for now, leave hook)
2. Outlet + channel assignment → `price_list_assignments WHERE scope_type='outlet' AND scope_id=$outletId`
3. Customer or customer-group assignment → existing `customers.price_list_id` + new group assignments
4. Product or variant base price (current behavior)

Add a `resolvePriceForContext(db, { productId, variantId, outletId, channelId, customerId })` function to `quote.js` that implements this cascade.

### Task 2.3: Frontend — Price List Assignment UI

**Files:**
- Modify: `frontend/src/pages/redesign/PriceListsRedesign.jsx`

**Changes:**
- Add "Assignments" tab to price list detail view
- Show scope type selector (outlet, channel, customer, customer group)
- Show scope entity picker
- Add/remove assignments
- Feature flag guard: `phase2_outlet_pricing`

### Task 2.4: Frontend — POS Price Resolution Update

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Changes:**
- Update price resolution to call the new backend resolver when outlet pricing is enabled
- Fall back to current `resolvePriceListPrice()` for backward compatibility

### Task 2.5: Commit Pricing

```bash
git add backend/routes/price-list-assignments.js backend/services/quote.js \
  backend/routes/registerAllRoutes.js \
  frontend/src/pages/redesign/PriceListsRedesign.jsx \
  frontend/src/pages/redesign/pos/POSContext.jsx
git commit -m "feat(phase2): add outlet-aware pricing with price list assignments"
```

---

## Task 3: Workstream 3 — Synced Draft Orders and POS Approval UI

### Task 3.1: Backend — Draft Order Routes

**Files:**
- Create: `backend/routes/draft-orders.js`
- Modify: `backend/routes/registerAllRoutes.js`

**Endpoints:**
- `GET /api/draft-orders` — list (filter: `outlet_id`, `status`, `created_by`)
- `GET /api/draft-orders/:id` — detail with items
- `POST /api/draft-orders` — create (body mirrors parked-sales POST but adds draft_order semantics)
- `PUT /api/draft-orders/:id` — update items/customer/notes (only if open or claimed by same user)
- `POST /api/draft-orders/:id/claim` — set `claimed_by`, `claimed_at`, status = 'claimed' (fails if already claimed by someone else)
- `POST /api/draft-orders/:id/complete` — convert to sale (only if claimed by current user)
- `DELETE /api/draft-orders/:id` — cancel (set status = 'cancelled')

**Key logic:**
- Claim uses `UPDATE ... WHERE id = $1 AND (status = 'open' OR (status = 'claimed' AND claimed_by = $2))` for concurrency safety
- Complete should reuse existing sale creation logic from `sales.js`
- Auto-apply promotions via `quote.js` promotion evaluation on create/update

### Task 3.2: Frontend — POS Draft Order Integration

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`
- Modify: `frontend/src/pages/redesign/ParkedSalesRedesign.jsx`

**Changes:**
- When `phase2_draft_orders` flag is enabled, "Park Sale" saves to `/api/draft-orders` instead of `/api/parked-sales`
- "Parked Sales" list fetches from `/api/draft-orders?outlet_id=X&status=open,claimed`
- Add "Claim" action when resuming another user's draft
- Show claimed-by indicator on drafts
- Keep `/api/parked-sales` fallback when flag is disabled

### Task 3.3: Frontend — POS Approval Modal

**Files:**
- Create: `frontend/src/pages/redesign/pos/POSApprovalModal.jsx`
- Modify: `frontend/src/pages/redesign/pos/POSContext.jsx`

**Component:**
- Modal triggered when approval policy returns `approval_required`
- Manager enters PIN
- Calls `POST /api/approvals/pos-authorize`
- On success, proceeds with the action
- On failure, shows denial reason
- Used for: manual discounts, returns, voids, tax edits

### Task 3.4: Commit Draft Orders

```bash
git add backend/routes/draft-orders.js backend/routes/registerAllRoutes.js \
  frontend/src/pages/redesign/pos/POSContext.jsx \
  frontend/src/pages/redesign/pos/POSApprovalModal.jsx \
  frontend/src/pages/redesign/ParkedSalesRedesign.jsx
git commit -m "feat(phase2): add synced draft orders with claim/complete and POS approval UI"
```

---

## Task 4: Workstream 4 — Returns Policy and Structured Attribution

### Task 4.1: Backend — Return Policy and Reason CRUD

**Files:**
- Create: `backend/routes/return-policies.js`
- Modify: `backend/routes/registerAllRoutes.js`

**Endpoints:**
- `GET /api/return-policies` — list policies
- `POST /api/return-policies` — create policy
- `PUT /api/return-policies/:id` — update policy
- `GET /api/return-reasons` — list reasons
- `POST /api/return-reasons` — create reason
- `PUT /api/return-reasons/:id` — update reason

### Task 4.2: Backend — Return Quote (Preflight) Endpoint

**Files:**
- Modify: `backend/routes/returns.js`

**Add endpoint:** `POST /api/returns/quote`

**Logic (modeled after Shopify's suggestedFinancialOutcome):**
- Takes `{ original_sale_id, items: [{ product_id, variant_id, quantity }] }`
- Looks up original sale and checks:
  - Is there an active return policy?
  - Is the return within the time window?
  - Is a receipt provided (original_sale_id present)?
  - Which refund methods are allowed?
  - What restocking fee applies?
- Returns: `{ eligible: true/false, policy_result: 'allowed'|'approval_required'|'denied', reason, suggested_refund: N, restocking_fee: N, allowed_refund_methods: [] }`

### Task 4.3: Backend — Extend Returns Creation

**Files:**
- Modify: `backend/routes/returns.js`

**Changes to existing `POST /api/returns`:**
- Accept optional `policy_id`, `return_reason_id`, `processed_by_employee_id`, `approved_by_employee_id`, `approval_event_id`
- If `phase2_returns_policy` flag is on and a default policy exists, evaluate policy before allowing return
- If policy says `approval_required`, require a valid `approval_event_id`
- Log attribution (who processed, who approved) into the extended return columns

### Task 4.4: Frontend — Return Policy Management

**Files:**
- Create: `frontend/src/pages/redesign/ReturnPoliciesRedesign.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx`
- Modify: `frontend/src/ui/nav-config.js`

**Component:** Admin UI for managing return policies and return reasons. Feature flag guard: `phase2_returns_policy`.

### Task 4.5: Frontend — POS Return Flow with Policy

**Files:**
- Modify: `frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx`

**Changes:**
- Before submitting return, call `POST /api/returns/quote` for preflight
- If `approval_required`, trigger the POSApprovalModal (from WS3)
- Show structured reason selector dropdown
- Show policy result and suggested refund amount
- Show attributed processor/approver in return detail views

### Task 4.6: Commit Returns Policy

```bash
git add backend/routes/return-policies.js backend/routes/returns.js \
  backend/routes/registerAllRoutes.js \
  frontend/src/pages/redesign/ReturnPoliciesRedesign.jsx \
  frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx \
  frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js
git commit -m "feat(phase2): add return policies, structured reasons, and staff attribution"
```

---

## Task 5: Workstream 5 — Labor Analytics and Staff Attribution

### Task 5.1: Backend — Labor vs Sales Report

**Files:**
- Modify: `backend/routes/reports/staff.js`

**Add endpoint:** `GET /api/reports/labor-vs-sales`

**Logic:**
- Join `attendance_sessions` (hours worked) with `sales` + `sale_items` (revenue) by employee and date range
- Calculate: hours_worked, revenue_generated, revenue_per_hour, labor_cost (from payroll rate if available)
- Filter by outlet_id, date range
- Group by employee, with totals

### Task 5.2: Backend — Staff Attribution Report

**Files:**
- Modify: `backend/routes/reports/staff.js`

**Add endpoint:** `GET /api/reports/staff-attribution`

**Logic:**
- Aggregate per employee: sales count, revenue, discount count, discount total, return count, return total, void count, approval events count
- Sources: `sales`, `returns`, `approval_events`, `action_history`
- Filter by outlet_id, date range

### Task 5.3: Frontend — Labor Analytics Dashboard

**Files:**
- Modify: `frontend/src/pages/reports/ReportsStaff.jsx`

**Changes:**
- Add "Labor vs Sales" tab with side-by-side table/chart
- Add "Staff Attribution" tab with per-employee breakdown
- Feature flag guard: checks `phase2_scheduling` for labor-vs-sales (needs attendance data)
- Both tabs use date range and outlet filters

### Task 5.4: Commit Labor Analytics

```bash
git add backend/routes/reports/staff.js \
  frontend/src/pages/reports/ReportsStaff.jsx
git commit -m "feat(phase2): add labor-vs-sales dashboard and staff attribution reporting"
```

---

## Testing Strategy

Each workstream should include tests. The repo pattern is Jest integration tests in `backend/tests/integration/`. Key tests per workstream:

| Workstream | Key Tests |
|-----------|----------|
| Foundations | approval policy evaluate (allowed/denied/approval_required), threshold logic, price list CRUD |
| Scheduling | create draft, publish, overlap rejection, leave conflict detection, geofence distance calc |
| Pricing | assignment CRUD, price precedence resolution (outlet > customer > base) |
| Draft Orders | create, claim concurrency (two claims same draft), complete, auto-apply promos |
| Returns Policy | quote preflight (in-window, out-of-window, no-receipt), policy enforcement on create |
| Labor | labor-vs-sales aggregation accuracy, attribution counts |

---

## Compatibility Notes

- `parked_sales` endpoints remain active — draft orders are additive, controlled by feature flag
- `customers.price_list_id` continues working — price resolution checks it as part of the cascade
- Current `leave_requests` API unchanged — new fields are optional extensions
- Current reports tabs unchanged — new tabs are additions
- Current approval_requests table (PO/transfer approvals) unchanged — new approval_policies/events are a separate system

---

## Done Criteria (Phase 2A)

- [ ] All 6 feature flags created and default to `false`
- [ ] Migration v19 applies cleanly on fresh and existing tenants
- [ ] Schedules can be drafted, published, and viewed in calendar UI
- [ ] Leave requests show schedule conflicts
- [ ] Geofenced clock-in validates distance when configured
- [ ] Overtime alerts surface for employees approaching threshold
- [ ] Price lists can be assigned to outlets and channels
- [ ] POS resolves price by outlet assignment when available
- [ ] Draft orders can be saved, claimed, and completed across terminals
- [ ] POS approval modal blocks unauthorized discounts/returns/voids
- [ ] Return policies enforce time windows and receipt requirements
- [ ] Return reasons are standardized and selectable
- [ ] Labor-vs-sales report shows revenue per labor hour
- [ ] Staff attribution report shows discounts, returns, voids per employee
