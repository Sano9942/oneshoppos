# Wave 2-G.8 — Inventory Intelligence Hub: Design

**Date:** 2026-04-21
**Wave:** 2-G.8
**Estimate:** 12-16 days
**Feature flag:** `phase2g_inventory_intelligence` (OFF by default; packagesmall ON at ship)
**Migration:** v70 (single atomic migration)
**Prerequisite mini-wave (not blocking):** per-variant GRN/PO receive (adds `grn_items.variant_id`, `purchase_order_items.variant_id`). Separate 3-4d wave. Hub ships product-level on day one with variant-ready schema.

---

## 1. Architecture overview

Hub lives at `/retail/inventory-intelligence` with 4 tabs:

- **ABC Analysis** — per-product A/B/C rank, revenue contribution %, GMROI, sell-through rate
- **Reorder Suggestions** — products below `velocity × (lead_time + safety)` threshold, click-to-create PO
- **Cycle Counts** — scheduled counts, active sessions, shrinkage variance rollup
- **Aging** — extended `stock_aging` report with cost-value columns

Top-of-hub dashboard cards (4): reorder count / next cycle count / dead-stock count / stock value at risk.

Behind the hub:

- **Nightly pg-boss worker** at 02:00 UTC (07:00 Karachi) walks every product per tenant, computes ABC rank + daily velocity + sell-through + GMROI + dead-stock flag, writes to `product_abc_class` (one row per product; `variant_id` nullable, always NULL today).
- **Reorder tab query is realtime** — joins `product_abc_class.daily_velocity` (stable, nightly) against `outlet_stock.quantity` (realtime) and resolves lead_time via product → supplier → tenant-default fallback.
- **Cycle counts reuse the existing `stock_counts` primitive** — `cycle_count_sessions` is a thin wrapper that links a schedule to a stock_count and captures rollup variance.
- **Feature-flagged** — `phase2g_inventory_intelligence` defaults OFF; packagesmall flipped ON at ship.

---

## 2. Schema (migration v70)

Single atomic migration. All DDL + feature flag seed in one shot.

### New table — per-product nightly rollup

```sql
CREATE TABLE IF NOT EXISTS product_abc_class (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,  -- NULL today
  rank CHAR(1) CHECK (rank IN ('A','B','C')),
  revenue_contribution_pct NUMERIC(6,4),
  units_sold NUMERIC(12,3) DEFAULT 0,
  units_received NUMERIC(12,3) DEFAULT 0,
  sell_through_rate NUMERIC(6,4),
  gross_margin NUMERIC(12,2) DEFAULT 0,
  avg_inventory_value NUMERIC(12,2) DEFAULT 0,
  gmroi NUMERIC(8,4),
  daily_velocity NUMERIC(10,4) DEFAULT 0,    -- trailing 30d units sold ÷ 30
  days_since_last_sale INTEGER,
  window_days INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_abc_class_unique
  ON product_abc_class(product_id, COALESCE(variant_id, 0));
CREATE INDEX IF NOT EXISTS idx_product_abc_class_rank ON product_abc_class(rank);
CREATE INDEX IF NOT EXISTS idx_product_abc_class_dead
  ON product_abc_class(days_since_last_sale) WHERE days_since_last_sale >= 90;
```

### New tables — cycle count scheduling

```sql
CREATE TABLE IF NOT EXISTS cycle_count_schedules (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  filter_criteria JSONB NOT NULL DEFAULT '{}',  -- {outlet_id, category_id, brand_id, supplier_id, abc_rank}
  recurrence TEXT NOT NULL CHECK (recurrence IN ('weekly','monthly','quarterly')),
  next_due_date DATE NOT NULL,
  last_run_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cycle_count_sessions (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER REFERENCES cycle_count_schedules(id) ON DELETE SET NULL,
  stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  variance_units INTEGER DEFAULT 0,
  variance_value NUMERIC(12,2) DEFAULT 0,     -- sum(|counted - system| × cost_price)
  assigned_to INTEGER REFERENCES employees(id)
);
CREATE INDEX IF NOT EXISTS idx_cycle_count_sessions_schedule
  ON cycle_count_sessions(schedule_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_count_sessions_one_open
  ON cycle_count_sessions(schedule_id) WHERE completed_at IS NULL;
```

### Column adds — lead-time resolution

```sql
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_lead_time_days INTEGER DEFAULT 7;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS lead_time_days_override INTEGER,
  ADD COLUMN IF NOT EXISTS safety_stock_days INTEGER DEFAULT 3;
```

### Tenant-wide config

Keys stored in existing `company_settings` JSONB (verified during migration authoring; fallback to narrow ALTER if column shape differs):

- `abc_window_days` (default 90)
- `tenant_default_lead_time_days` (default 7)
- `tenant_default_safety_stock_days` (default 3)

### Feature flag

```sql
INSERT INTO feature_flags (key, label, description, default_enabled)
VALUES ('phase2g_inventory_intelligence', 'Inventory Intelligence Hub',
        'Enables /retail/inventory-intelligence with ABC / Reorder / Cycle Counts / Aging', FALSE)
ON CONFLICT (key) DO NOTHING;
```

---

## 3. Backend — worker + routes

### Worker: `backend/workers/abc-worker-boss.js`

Pg-boss, daily 02:00 UTC. Per tenant:

1. Read `abc_window_days` from tenant settings (default 90).
2. Aggregate `sales + sale_items` over window:
   ```
   SELECT product_id, variant_id,
          SUM(quantity × price_at_sale) AS revenue,
          SUM(quantity × (price_at_sale - cost_price_at_sale)) AS margin,
          SUM(quantity) AS units_sold,
          MAX(s.timestamp) AS last_sale_at
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE s.timestamp >= NOW() - $window * INTERVAL '1 day'
    GROUP BY product_id, variant_id
   ```
3. Aggregate `grn_items` over window for `units_received`.
4. Aggregate `outlet_stock` → `avg_inventory_value = SUM(qty × cost_price)` per product.
5. **Pure functions** (in `services/inventory-intelligence.js`):
   - `assignAbcRanks(rows)` — sort desc by revenue, cumulative contribution → A (top 80%), B (next 15%), C (last 5%).
   - `daily_velocity = units_sold_last_30d / 30` (always 30d — reorder formula stays calibrated even when tenant uses non-30d ABC window).
   - `sell_through_rate = units_sold / NULLIF(units_received, 0)`.
   - `gmroi = (gross_margin × sell_through_rate) / NULLIF(avg_inventory_value, 0)`.
   - `days_since_last_sale = today - last_sale_at` (NULL → sentinel high value).
6. `INSERT ... ON CONFLICT (product_id, COALESCE(variant_id, 0)) DO UPDATE SET ...` the whole row.
7. Heartbeat: `global.__abcWorkerStatus = { lastRun, processedToday, queueDepth }` for `/api/admin/worker-status`.

### Route: `backend/routes/inventory-intelligence.js`

All endpoints behind `requireFeature('phase2g_inventory_intelligence')` + `requirePerm('manage_inventory')`.

- `GET /dashboard-cards` — 4 card payloads.
- `GET /abc` — list from `product_abc_class`, pagination + rank filter + search + dead-stock-only toggle.
- `GET /reorder` — realtime join of `daily_velocity` × `outlet_stock` × resolved lead_time. Returns current stock, threshold, suggested qty, suggested supplier.
- `POST /reorder/create-po` — takes `[{product_id, qty, supplier_id, outlet_id}...]`, calls existing `purchase_orders` create flow (pre-fill only; no new PO logic).
- `GET /cycle-schedules` + `POST` + `PUT` + `DELETE`.
- `POST /cycle-schedules/:id/start-session` — seeds a `stock_counts` row from `filter_criteria`, creates `cycle_count_sessions` row, returns `stock_count_id`.
- `POST /cycle-sessions/:id/complete` — closes session, sums `|counted - system| × cost_price` into `variance_value`, advances schedule `next_due_date`.
- `GET /cycle-sessions` — recent sessions + variance rollup.

### Modified: `backend/routes/reports/stock-aging.js`

Add columns: `total_cost_value`, `avg_cost_per_unit`, `value_at_risk`.

### Lead-time resolution helper

```
resolveLeadTime(product) =
  product.lead_time_days_override
  ?? supplier.default_lead_time_days
  ?? tenant.tenant_default_lead_time_days
  ?? 7
```

---

## 4. Frontend

### Page: `frontend/src/pages/redesign/InventoryIntelligenceRedesign.jsx`

Route registered in `frontend/src/routes/appRoutes.jsx` behind `requirePerm('manage_inventory')` + `requireFeature('phase2g_inventory_intelligence')`. Sidebar nav entry in `ui/nav-config.js` under Inventory group: "Intelligence".

Layout: 4 dashboard cards row on top (each clickable → filters destination tab), 4-tab bar below.

### 4 sub-components in `frontend/src/pages/redesign/inventory-intelligence/`:

1. **`ABCTab.jsx`** — table (Product, Rank chip, Revenue %, Units sold, Sell-through, GMROI, Days since last sale), filters (rank, search, dead-stock only), CSV export via shared `downloadCsv`.
2. **`ReorderTab.jsx`** — table with current stock + lead-time source tag + suggested qty + supplier + checkbox. Bulk "Create POs from selected" groups by supplier → calls create-po endpoint per supplier → redirects to first PO edit UI with toast.
3. **`CycleCountsTab.jsx`** — upcoming schedules + recent sessions with variance rollup (shrinkage summary inline). "New schedule" modal with `FilterCriteriaBuilder`. "Start count now" → redirects to existing stock-count UI.
4. **`AgingTab.jsx`** — embeds extended `stock-aging` report in the tab.

### Shared helpers:

- `RankChip.jsx` — A=green / B=amber / C=red pill.
- `LeadTimeTag.jsx` — "override" / "supplier" / "tenant" source tag.
- `FilterCriteriaBuilder.jsx` — JSONB filter builder for schedule modal.

API access via centralized `api.get/post/put/del` from `frontend/src/api.js`. Error/loading states reuse `ui/primitives.jsx`. Empty-state helper: "No data yet — worker runs nightly at 2 AM UTC".

---

## 5. Data flow

### Nightly (02:00 UTC)

```
pg-boss fires abc-daily job per active tenant (phase2g flag ON)
  → abc-worker-boss sets tenant search_path
  → reads abc_window_days setting
  → runs 3 aggregation queries (sales, grn_items, outlet_stock)
  → in-memory assignAbcRanks / computeGmroi / computeVelocity
  → single ON CONFLICT UPSERT into product_abc_class
  → updates global.__abcWorkerStatus
```

### Hub page load

```
user hits /retail/inventory-intelligence
  → requireFeature + requirePerm gates pass
  → GET /dashboard-cards (4 fast indexed queries)
  → tab clicks trigger per-tab GETs
    - ABC tab reads product_abc_class (stale ≤24h, acceptable)
    - Reorder tab joins product_abc_class.daily_velocity × outlet_stock.quantity (realtime)
    - Cycle Counts tab reads schedules + sessions
    - Aging tab embeds extended stock-aging report
```

### Reorder → PO creation

```
user selects N rows → "Create POs" → frontend groups by supplier
  → POST /reorder/create-po × k (one per supplier)
  → backend delegates to existing purchase_orders create flow
  → redirects to first PO edit UI with toast
```

### Cycle count session

```
user clicks "Start count" on schedule
  → POST /cycle-schedules/:id/start-session
    → reads filter_criteria → resolves matching products
    → creates stock_counts + stock_count_items seed rows
    → creates cycle_count_sessions row
    → advances schedule.next_due_date
    → returns { stock_count_id }
  → redirects to existing /stock-counts/:id UI
  → user completes count in existing UI → variance logged on session
```

### Config changes

- `products.lead_time_days_override` edit → takes effect next Reorder tab load (realtime).
- `tenant.abc_window_days` edit → takes effect next nightly worker run.

---

## 6. Error handling & edge cases

### Worker

- Tenant job fails → pg-boss exponential backoff, max 5 attempts, dead-letter. Sentry with `tenant` tag. Other tenants unaffected.
- Tenant schema missing expected tables (mid-provisioning) → skip with warning, no error.
- Worker crashes mid-batch → pg-boss re-locks after 15min, retries. No partial writes (per-tenant single transaction).
- Tenant with zero sales → no ranks assigned (NULL); UI shows "No sales data in window" helper.
- Worker skips tenants with flag OFF — keeps DB clean, saves compute.

### Lead-time resolution

- Product has no `default_supplier_id` → supplier fallback skipped.
- Supplier `default_lead_time_days = NULL` → falls through.
- Tenant setting absent → hardcoded 7d fallback, logged once/tenant/run.
- Safety stock is never inherited from supplier — per-product or tenant default only.

### Reorder

- Zero-velocity product → excluded regardless of stock.
- No cost_price → GMROI NULL in ABC tab.
- Per-outlet by default; "all outlets" sums per product.
- `is_active = FALSE` products → excluded from suggestions AND ABC.

### Cycle counts

- Zero-product filter → UI refuses start-session with toast; `next_due_date` unchanged.
- Stale open session (>7d since started) → admin sees stale indicator; manual "abandon" sets variance=0, closes.
- Concurrent start-session on same schedule → second errors via unique partial index `idx_cycle_count_sessions_one_open`.
- Schedule deleted mid-session → session survives (`schedule_id` goes NULL via `ON DELETE SET NULL`), variance still recorded.

### Feature flag OFF

- Routes return 404 (not 403) — off-tenants can't discover feature.
- Frontend hides sidebar entry; route redirect to dashboard with toast.
- Worker no-ops per tenant when flag is OFF.

### Migration rollback

- v70 is additive only (no DROP, no column type changes on existing tables). Rollback drops the new tables/columns/flag via standard `migrate-pg.js` down path.

### Performance ceilings

- 100K products × 90d sales per tenant: ~3-5s worker time on Supabase Free pooled connection. 20 tenants × 5s = 100s nightly.
- Hub dashboard load target: <500ms. All 4 cards hit indexed queries.
- Realtime reorder query: ~50-200ms on 10K products.

---

## 7. Testing plan

### Unit tests — `backend/tests/unit/inventory-intelligence.test.js`

Pure functions, no DB. Inject fake deps (no `vi.mock`).

- `assignAbcRanks`: empty, single, Pareto distribution, tie-breaking stable sort.
- `computeVelocity`: zero, integer, fractional (decimal quantities from v45).
- `computeGmroi`: avg_inventory_value=0 → NULL, margin=0 → 0, normal.
- `resolveLeadTime`: override / supplier / tenant / hardcoded fallback chain.
- `suggestReorderQty`: above threshold → 0; below → `velocity × (lead + safety) - current`, rounded up.

### Integration tests — 4 files

1. **`pg-phase2g8-abc.test.js`** — seed 10 products with varied sales, run worker, assert ranks. Dead-stock detection. Zero-sales tenant clean run. Re-run ON CONFLICT idempotency.
2. **`pg-phase2g8-reorder.test.js`** — GET /reorder states. Lead-time source resolution (override/supplier/tenant). POST /reorder/create-po across multiple suppliers.
3. **`pg-phase2g8-cycle-counts.test.js`** — schedule CRUD. Start session with `{outlet_id, abc_rank}` filter resolves correct products. Concurrent start → one errors. Complete → variance matches formula. Schedule delete mid-session. Zero-product filter blocks start.
4. **`pg-phase2g8-hub.test.js`** — dashboard-cards shape. Feature flag OFF → 404. Permission missing → 403. Extended stock-aging report has new columns.

### Out of scope for automated testing

- No Playwright E2E — existing suite targets production `sanopos.com`; seeding test-tenant data with varied ABC signals is disproportionate for this wave.
- No visual regression.

### Manual QA before merge

Documented in execution plan, not automated:

- Enable flag on packagesmall → run worker manually → all 4 tabs render with real data.
- Start a cycle count, barcode-scan 5 items, complete → variance card updates.
- Create PO from reorder suggestions → items pre-filled correctly.

---

## Out of scope (locked)

- No ML / seasonal forecasting (velocity-based only).
- No automatic PO generation (click-to-create pre-fills existing flow).
- No multi-supplier PO split logic in reorder→PO flow.
- No multi-outlet transfer suggestions (cross-outlet balancing).
- No vendor scorecards.
- No per-variant metrics day one (schema variant-ready; worker writes product-level rows; per-variant switch is a follow-up wave after per-variant GRN/PO receive lands).
- No new cycle-count UI (reuses existing `stock_counts` primitive).
- No separate "Shrinkage" tab — variance rollup lives inside Cycle Counts tab.

## Dependencies

- **Prerequisite mini-wave (not blocking 2-G.8 ship):** per-variant GRN/PO receive (3-4d). Adds `grn_items.variant_id`, `purchase_order_items.variant_id`. After it lands, `product_abc_class.variant_id` flips from always-NULL to per-variant rows via a small worker update.
- Existing: `pg-boss` job queue, `feature_flags` table, `requirePerm`/`requireFeature` middleware, `stock_counts`/`stock_count_items` primitive, `purchase_orders` create flow, `downloadCsv` utility, `api.js` centralized fetcher, `ui/primitives.jsx`.
