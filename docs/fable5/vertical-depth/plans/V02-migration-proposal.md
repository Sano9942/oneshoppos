# V02 Wholesale Depth — Migration Proposal (v110–v113)

> ✅ **APPROVED AND SHIPPED.** Migrations **v110, v111, v112 and v113 all exist in
> `backend/migrate-pg.js`** (verified 2026-08-17), and V02 is marked done in
> [`../ROADMAP.md`](../ROADMAP.md). This file is now a design record, not a pending gate.
> *(Header corrected 2026-08-17 — it still read as an open pause-list stop.)*
>
> Original header: Pause-list stop per completion-spec §5. Approve before any migration code is written.
> Branch: `feat/v02-wholesale-depth` off `main` (head v109). All migrations tenant-schema-scoped,
> SAVEPOINT-guarded on public, idempotent — same shape as v100–v109.

## Pre-work findings (ledger audit + code sweep, done before this design)

1. **Completion-04 P0 fix never reached main.** `d6f6bc5` ("void of on-account sale reverses
   linked A/R invoice") lives only on `fix/completion-04` — the consolidation took F02–F07+V06
   but not this branch. Prod main today: voiding a Credit-tender sale leaves the invoice `sent`
   with full `balance_due`, and the exposure query counts it. **Will be re-ported onto this
   branch** (code-only, no migration).
2. **Prod ledger audit (tenant_wholesalewalktest1778451, read-only):** 9 invoices, Σ327,000.
   Invoices #8/#9 are `status='void'` with balance_due retained (130,000) — they inflate the
   credit-exposure check (`NOT IN ('paid','cancelled')`) while statements exclude `'void'`.
   Confirms #1 live. Everything else reconciles (the single `credit_reversal` payment row nets
   invoice #3 to 0 correctly).
3. Backorder AR rule is safe by construction: backorders create **no AR row** until converted,
   so "credit limit counts fulfilled amount only" falls out automatically — will be stated in
   code at both the exposure query and the backorder service.

## v110 — P0 backorders

```sql
CREATE TABLE IF NOT EXISTS backorders (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('sale','web_order','field_order')),
  source_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL REFERENCES products(id),
  variant_id INTEGER REFERENCES product_variants(id),
  outlet_id INTEGER REFERENCES outlets(id),
  qty_ordered NUMERIC(12,4) NOT NULL,
  qty_fulfilled NUMERIC(12,4) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL,          -- ORDER-time price snapshot, honored at fulfillment
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','fulfilled','cancelled')),
  expected_at DATE,
  notes TEXT,
  created_by INTEGER REFERENCES employees(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backorders_status   ON backorders(status);
CREATE INDEX IF NOT EXISTS idx_backorders_customer ON backorders(customer_id);
CREATE INDEX IF NOT EXISTS idx_backorders_product  ON backorders(product_id, status);

-- audit of (possibly partial) fulfillments; conversion sale goes through POST /api/sales
CREATE TABLE IF NOT EXISTS backorder_fulfillments (
  id SERIAL PRIMARY KEY,
  backorder_id INTEGER NOT NULL REFERENCES backorders(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  sale_item_id INTEGER REFERENCES sale_items(id),
  qty NUMERIC(12,4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_backorder_fulfillments_bo ON backorder_fulfillments(backorder_id);
```

Plus (same migration): seed `feature_flags('wholesale_backorders', false)`; backfill to `true`
where the tenant has wholesale mode enabled (`tenant_modes` guard, like v89's pattern).
Code side (no DDL): `DEFAULT_FEATURE_FLAGS.wholesale_backorders=false`, append to
`WHOLESALE_SEED_FLAGS`, mirror DDL into `schema-pg.sql`.

## v111 — P1 van sales

```sql
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS outlet_type TEXT NOT NULL DEFAULT 'store';
-- CHECK (outlet_type IN ('store','van')) added via idempotent DO block
ALTER TABLE outlets ADD COLUMN IF NOT EXISTS van_rep_employee_id INTEGER REFERENCES employees(id);

CREATE TABLE IF NOT EXISTS van_reconciliations (
  id SERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),      -- the van
  reconcile_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  lines JSONB NOT NULL DEFAULT '[]',   -- [{product_id, variant_id, expected, counted, variance}]
  cash_expected NUMERIC(12,2) DEFAULT 0,
  cash_counted NUMERIC(12,2),
  variance_reason TEXT,
  adjustment_id INTEGER,               -- stock_adjustments row written at confirm
  created_by INTEGER REFERENCES employees(id),
  confirmed_by INTEGER REFERENCES employees(id),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(outlet_id, reconcile_date)
);
```

Flag `wholesale_van_sales` seeded false + wholesale-mode backfill, same as v110.
All stock machinery (outlet_stock, transfers, FOR UPDATE decrements, reports) reused unmodified —
a van IS an outlet. Load-out auto-opens a cash shift on the van outlet for the rep (sales.js
requires an open shift); day-end confirm closes it.

## v112 — P1 proof-of-delivery (loadsheet stops)

```sql
ALTER TABLE loadsheet_orders
  ADD COLUMN IF NOT EXISTS pod_status TEXT,            -- NULL | 'delivered' | 'failed'
  ADD COLUMN IF NOT EXISTS pod_receiver_name TEXT,
  ADD COLUMN IF NOT EXISTS pod_signature_url TEXT,     -- R2, field.js selfie pipeline reused
  ADD COLUMN IF NOT EXISTS pod_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS pod_failed_reason TEXT,
  ADD COLUMN IF NOT EXISTS pod_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_by INTEGER REFERENCES employees(id);
```

## v113 — F05 notification rule seeds

```sql
INSERT INTO notification_rules (event, channel, template_key, enabled) VALUES
  ('backorder.created',   'sms',   'backorder_created',   true),
  ('backorder.created',   'email', 'backorder_created',   true),
  ('backorder.fulfilled', 'sms',   'backorder_fulfilled', true),
  ('backorder.fulfilled', 'email', 'backorder_fulfilled', true),
  ('order.delivered',     'sms',   'order_delivered',     true)
ON CONFLICT (event, channel) DO NOTHING;  -- guarded like v109
```

Templates added in code (`email-templates.js` + `sms-templates.js`). Inert until the tenant's
`customer_notifications` flag is on (F05 central gate).

## DECISION NEEDED — plan-limit exemption for vans

`requirePlanLimit("outlets")` counts all outlets; Free/Pro cap outlets at 1. A van would eat the
plan cap and block creating the first van entirely on a 1-outlet plan.

**Recommendation: exempt vans** — count only `outlet_type='store'` rows in the plan-limit query.
Rationale: vans are rep stock buckets gated behind `wholesale_van_sales` (wholesale tenants
only), not sellable "locations"; a distributor on Pro (1 outlet) must be able to run vans or the
feature is dead on arrival. Alternative (count vans against the cap) rejected for that reason.

## Not migrations (same branch, code-only)

- Credit-limit race: authoritative `SELECT … FOR UPDATE` on the customer row + exposure re-check
  **inside** the sale transaction; shared helper also applied to quotation-convert and batch
  invoicing (the other on-account writers found by grep).
- Port of the lost completion-04 void→AR-reversal fix + its regression test; manual
  `PUT /api/customer-invoices/:id/void` also zeroes `balance_due`; exposure queries add `'void'`
  to the excluded statuses.
- Backorder offer decision implemented once in `services/backorder.js`, consumed by both order
  entry points (`POST /api/sales` for POS+field; storefront checkout for storefront+portal) so
  all four surfaces share one decision point.
