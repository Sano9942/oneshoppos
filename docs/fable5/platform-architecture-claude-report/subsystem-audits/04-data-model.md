# Subsystem Audit 04 — Data Model (`schema-pg.sql` + `migrate-pg.js`)

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**
>
> **Note:** §3's public-schema finding was subsequently **CONFIRMED against live production** — see [`../02-verification-log.md` §5](../02-verification-log.md).

---

## 0. Shape of the two files

| File | Lines | Bytes |
|---|---|---|
| `backend/schema-pg.sql` | 5,926 | 266,966 |
| `backend/migrate-pg.js` | 10,178 | 483,685 |

`schema-pg.sql` is a single flat, top-to-bottom, fully idempotent DDL script (`CREATE TABLE IF NOT EXISTS` throughout). It is **not** a generated dump — it carries hand-written comments referencing the migration that introduced each column (e.g. `:172` "F01 kit/BOM discriminator (migrate-pg v99)"). Migration v1 (`migrate-pg.js:31-37`) `fs.readFileSync`s and executes it.

---

## 1. Structural counts (verified)

| Metric | Count |
|---|---|
| `CREATE TABLE` statements | **327** |
| Unique table names | **326** — `return_reasons` declared at `:726` and again identically at `:2793` |
| `CREATE INDEX` | 287 |
| `CREATE UNIQUE INDEX` | 24 |
| Partial indexes | 67 non-unique + 17 unique |
| `REFERENCES` (FK clauses) | 651 |
| `ON DELETE CASCADE` / `SET NULL` / `RESTRICT` | 155 / 21 / 1 |
| `CHECK (` constraints | 171 |
| JSONB mentions | 68 |
| `ON CONFLICT` (seed upserts) | 22 |
| **Triggers / stored functions** | **0 / 0** |
| **Views** | **0** (the 4 `CREATE.*VIEW` hits are false positives) |
| Generated columns | 1 — `shift_denominations.subtotal GENERATED ALWAYS AS (denomination * count) STORED` (:623) |
| `EXCLUDE USING gist` | 1 — `excl_appointments_employee_overlap` (:3904-3906) |
| RLS declared in schema file | 1 — `public.platform_module_locks` (:5896) |

**Architectural note.** Zero triggers, zero stored procedures, zero views. All invariants are either declarative constraints or enforced in Node. That makes the application layer the sole guardian of every derived value (`sales.subtotal`, `customer_invoices.balance_due`, `products.stock`, `customers.total_spend`, …).

---

## 2. Functional domains (line = `CREATE TABLE` line)

**Core POS / sales (37)** — `sales`:628, `sale_items`:660, `sale_payments`:689, `sale_item_modifiers`:2737, `sale_item_adjustments`:3608, `sale_item_serials`:1137, `sale_promotion_applications`:954, `invoice_sequences`:697, `parked_sales`:996 + items:1006, `draft_orders`:2635 + items:2659 + modifiers:2727, `holds`:2382 + items:2404 + payments:2414, `returns`:736 + items:766, `return_reasons`:726/2793, `return_policies`:2780, `cash_shifts`:597, `shift_denominations`:617, `no_sale_reasons`:5735 + events:5749, `void_reason_codes`:3625, `override_reasons`:5637, `receipt_templates`:1069, `printer_config`:1877, `pos_layouts`:2967, `pos_device_registry`:2981, `promotions`:930, `gift_cards`:1148 + ranges:1166 + transactions:1179, `modifier_groups`:2679 + options:2709 + links:2720

**Products / inventory (44)** — `categories`:12, `taxes`:24, `brands`:40, `suppliers`:46, `products`:147, `product_variants`:240, `variant_option_values`:259, `product_media`:266, `attribute_sets`:127 + attributes:133 + options:139, `outlet_stock`:276, `variant_outlet_stock`:287, `stock_adjustments`:297, `inventory_transfers`:313, `price_lists`:334 + items:349 + assignments:2620, `product_bundles`:364, `stock_conversions`:382 + lines:396, `stock_batches`:837, `batch_movements`:863, `stock_counts`:2210 + items:2222, `cycle_count_schedules`:5690 + sessions:5702, `product_abc_class`:5663, `inventory_reconciliation`:1590, `inventory_reservations`:2358, `product_serial_numbers`:1108, `barcode_templates`:1041 + print_jobs:1056, `smart_collections`:2804 + rules:2815, `outlet_product_visibility`:2826, `scheduled_catalog_changes`:2861, `product_affinities`:2992, `product_reviews`:704, `backorders`:5813 + fulfillments:5839, `menu_schedules`:3647 + products:3659, `outlet_tax_profiles`:2839 + lines:2849

**Purchasing / supplier (10)** — `purchase_orders`:779 + items:788, `po_templates`:796 + items:804, `goods_received_notes`:812 + items:822, `supplier_invoices`:877, `supplier_payments`:890, `supplier_returns`:906 + items:918

**Customers / CRM / loyalty / marketing (30)** — `customers`:465, `customer_groups`:412, `customer_group_products`:425, `customer_addresses`:2427, `customer_wallet_ledger`:526, `loyalty_tiers`:450, `loyalty_transactions`:582, `crm_leads`:1332, `crm_activities`:1349, `quotations`:1358 + items:1379, `marketing_templates`:3006, `marketing_campaigns`:3018 + audiences:3033 + deliveries:3040, `message_threads`:3058 + entries:3072, `customer_portal_otps`:4800, `customer_portal_reset_tokens`:4814, `customer_portal_refresh_tokens`:4823, `customer_notifications`:4564, `notification_rules`:4552, `notifications`:1096, `subscription_plans`:3184, `customer_subscriptions`:3198, `subscription_runs`:3214, `package_templates`:4009 + services:4024, `customer_packages`:4030, `package_redemptions`:4043

**HR / org (20)** — `roles`:58, `role_permissions`:65, `employees`:97, `outlets`:72, `employee_outlets`:1317, `companies`:1307, `employee_attendance`:970, `attendance_sessions`:981, `scheduled_shifts`:2600, `leave_requests`:1392, `payroll_periods`:1411, `payroll_lines`:1422, `hr_payroll_lines`:1438, `commission_plans`:2879 + rules:2891 + earnings:2904, `tip_captures`:3333, `tip_pool_distribution_rules`:3351, `tip_pools`:3366, `tip_pool_payouts`:3388

**Finance / accounting / AR / compliance (23)** — `chart_of_accounts`:1524, `journal_entries`:1540 + lines:1556, `accounting_periods`:1452, `credit_notes`:1465, `debit_notes`:1483, `postdated_cheques`:1503, `expense_categories`:1019, `expenses`:1026, `customer_invoices`:3091 + items:3112 + payments:3124 + payment_links:3136 + reminders:3166, `approval_requests`:1568 + actions:1579, `approval_policies`:2748, `approval_events`:2763, `fbr_invoices`:2079, `tax_rate_suggestions`:2100, `tax_rate_reference`:2115, `risk_controls_config`:5783, `retail_anomaly_flags`:5761

**Restaurant (19)** — floor plans:3244, sections:3254, tables:3262, table_sessions:3277, check_seats:3296, check_adjustments:3306, course_fires:3403, tabs:3419, preauth_holds:3432, kiosk_slots:3566, payment_sessions:3682, `kds_stations`:3443, station_routes:3463, tickets:3495, ticket_events:3524, ticket_items:3538, load_snapshots:3668, `reservations`:3707, `waitlist_entries`:3734

**Wholesale / field sales (11)** — `field_rep_routes`:540, `field_visits`:557, `van_reconciliations`:5852, `manufacturer_partners`:4842 + brands:4863 + refresh_tokens:4874, `picklists`:2255 + items:2268, `loadsheets`:2283 + orders:2298, `web_order_allocations`:2238

**Verticals (56)** — booking/salon/gym 16 (`booking_services`:3771 … `client_service_records`:4090); service/projects/repair 14 (`service_projects`:4128 … `ticket_devices`:4505); rentals 8 (`rental_items`:4611 … `asset_maintenance_log`:4775); lodging 12 (`room_types`:4892 … `night_audit_snapshots`:5121); clinical 20 (`patient_subjects`:5148 … `handout_assignments`:5603)

**Integrations / omnichannel / shipping (33)** — `courier_integrations`:1609, `web_orders`:1640 + items/transactions/fulfillments, `shopify_connections`:1711 + 5 map tables, `external_sync_events`:1764, daraz/facebook/whatsapp/google maps, `integration_settings`:1906, `email_config`:1894, `sms_provider_messages`:4424, `payment_webhook_events`:4384, `storefront_payment_sessions`:4397, `storefront_carts`:2447 + items:2466, `sales_channels`:2319, `channel_publications`:2342, `order_shipments`:4282 + tracking:4303, `cod_settlement_batches`:4334 + lines:4353

**Platform / admin / reporting / flags (26)** — `report_schedules`:1810 + runs/delivery_log/saved_views/definition_versions, `custom_report_definitions`:2939 + widgets:2955, `feature_flags`:1194, `tenant_modes`:1299, `company_profile`:1228, `tenant_business_modules`:5902, `outlet_business_modules`:5919, `public.platform_module_locks`:5884, `public.infra_cache`:3760, `schema_version`:5870, `action_history`:1086, `backup_log`:1210, `revoked_tokens`:2002, `password_reset_tokens`:2052, `support_tickets`:2061, `email_queue`:2130, `admin_activity_log`:2150, `admin_security_log`:2163, `tenant_notes`:2174, `announcements`:2183, `broadcast_log`:2198

**Queues.** There is **no queue table** other than the legacy `email_queue`:2130. The live queue is **pg-boss**, owning its own `pgboss.*` schema created by the library at `boss.start()` (`services/boss.js:22-33`). `routes/admin/messaging.js:51-55` states `public.email_queue` "is no longer written to by `enqueueEmail()`" and the admin view now reads `pgboss.job WHERE name = 'email'`. **`email_queue` is dead-but-still-created schema.** The only DB link to pg-boss is `fbr_invoices.pgboss_job_id UUID` (v15).

---

## 3. Public schema vs per-tenant schemas

### Tenancy
`tenant_<slug>` (`tenant-provisioner-pg.js:57`, `migrate-pg.js:10148`); hyphens stripped (:56). Search-path set with `SET LOCAL` inside explicit `BEGIN/COMMIT` everywhere, deliberately, because Supavisor/PgBouncer transaction pooling would otherwise split the `SET` and the query across backends (`master-db-pg.js:216-238`, `migrate-pg.js:10063-10105`, `tenant-provisioner-pg.js:72-84`).

### Tenant registry (public), `master-db-pg.js:5-142`
Created idempotently by `init(db)` (:150-164), invoked from `index.js:76-77` **only when `MULTI_TENANT === "1"`**.

| Table | Line | Notes |
|---|---|---|
| `tenants` | :6-34 | slug UNIQUE, status, plan, quotas, Stripe ids, trial/grace/expiry, consent + `consent_ip` |
| `super_admins` | :36-42 | + v125 `totp_secret` (base32 **plaintext**), `totp_enabled_at`, `recovery_codes JSONB` |
| `tenant_audit_log` | :44-51 | |
| `schema_migrations` | :53-56 | ⚠️ **declared but never read or written** — the runner uses `schema_version` |
| `tenant_refresh_tokens` | :58-66 | `token_hash UNIQUE` |
| `plan_pricing` | :68-76 | seeded `('pro','monthly',8000)`, `('pro','annual',80000)` |
| `payment_records` | :83-96 | |
| `upgrade_requests` | :98-108 | |
| `payment_intents` | :110-127 | `gateway_data JSONB`; partial index on `gateway_ref` |
| `impersonation_sessions` | :129-141 | `pages_visited JSONB`, partial index on `token_jti` |

### Additional public tables created by migrations
| Table | Where | Purpose |
|---|---|---|
| `public.infra_cache` | v50 | worker snapshot cache (`feature_adoption`, `orphaned_schemas`) |
| `public.tenant_lifecycle_events` | v124 (:9504-9520) | append-only funnel; partial unique makes one-time milestones idempotent |
| `public.admin_sessions` | v126 (:9543-9555) | hashed admin refresh tokens + jti |
| `public.platform_module_locks` | v131 (:9641-9662) | super-admin module lock; two partial uniques; RLS enabled explicitly |
| `pgboss.*` | library at runtime | **not in any repo DDL** |
| `public.tax_rate_reference` | declared unqualified :2115 | but read/written `public.`-qualified by routes; `:2113-2114` notes "No FK constraint because cross-schema FKs break tenant isolation" |

### ⚠️ The important structural fact
`migrateAllTenants()` runs `await migrate(publicDb)` **first** (`:10119`) against the identical `MIGRATIONS` array — including v1, which executes all of `schema-pg.sql`. **On a fresh database the public schema receives all 326 tenant tables.**

Not speculation: v131's comment (`:9668-9673`) says a guard on `company_profile` was rejected "because legacy/dev databases can carry a stray `public.company_profile` (observed on local `sanopos_dev`), which would leak this table into public"; v136 (:9923) repeats the rationale. Hence **74 `information_schema` guards and 77 `current_schema()` references** across the migration file.

`email_queue`, `fbr_invoices`, `admin_activity_log`, `admin_security_log`, `tenant_notes`, `announcements`, `broadcast_log`, `support_tickets` are declared **unqualified**, so they exist in every tenant schema *and* public. `routes/admin/helpers.js:45` writes `admin_activity_log` unqualified, relying on the admin router's search_path.

→ **CONFIRMED live:** `public.sales`, `public.customers`, `public.products`, `public.company_profile` all exist, all 0 rows, public stamped v137.

---

## 4. `migrate-pg.js` — versioning and execution

### Version table
`schema_version` (**not** `schema_migrations`), bootstrapped at `:10021-10026` and also declared at `schema-pg.sql:5870-5873`:
```sql
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())
```
Current version = `SELECT version FROM schema_version ORDER BY version DESC LIMIT 1` (:10028-10032) — **MAX, not a set-difference**. Pending = `MIGRATIONS.filter(m => m.version > currentVersion)` (:10034).

### Per-migration application
```js
await db.transaction(async (client) => {
  await m.up(client);
  await client.query("INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING", [m.version]);
});   // :10045-10054
```

### Per-tenant fan-out (`:10110-10161`)
1. `makeScopedDb(db, "public")` → `migrate(publicDb)` (:10119)
2. Unconditional idempotent RLS sweep (:10128), try/catch logs only
3. `SELECT id, slug FROM tenants WHERE status = 'active'` (:10138-10140)
4. Per tenant → `migrate(scopedDb)` inside a try/catch that logs `tenant X FAILED` and **continues** (:10149-10156)
5. Missing `tenants` table ⇒ "single-tenant mode", return

Invoked in production by `start.sh:12`. **No** npm script, GitHub Action, or Railway config runs it — only the Docker `CMD`.

### Counts
- **133 migration entries** (`grep -cP "^\s+version:\s*[0-9]+,"`)
- **Head = 137** (:9973)
- ⚠️ **Gap: versions 40, 41, 42, 43 do not exist.** The array jumps 39 (:3310) → 44 (:3789) with no comment
- No duplicate version numbers

### Head migration
**v137** (:9973-9994) — "D2a per-outlet roles: `employee_outlets.role_id INTEGER NULL REFERENCES roles(id) ON DELETE SET NULL`". Guarded on `information_schema.tables` (:9980-9989) so the public pass is a no-op; idempotent. Explicitly "Inert until a `PUT /api/employees/:id/outlets` writes an outlet_roles entry."

### Era timeline (sampled)

| v | Line | Description (abridged) |
|---|---|---|
| 1 | 31 | Initial schema from `schema-pg.sql` |
| 5 | 91 | courier_integrations + web_orders shipping cols |
| 10 | 365 | Email queue for deferred/scheduled emails |
| 16 | 521 | "Competitive features" — 13 new tables + seed data |
| 20 | 1368 | Phase 2B — smart collections, outlet visibility/tax, commissions, report builder, POS layouts |
| 22 | 1854 | Phase 4A — **restaurant mode** |
| 23 | 2066 | Phase 4B — **appointment booking** |
| 25 | 2465 | Phase 5 — shipping automation, COD, SMS |
| 31 | 2777 | Tenant preset engine + `tenant_modes` |
| 36 | 2911 | M7 — **rentals** |
| 38 | 3141 | M9 — **room management** |
| 39 | 3310 | M10 — **treatment plans** |
| *40–43* | — | **absent** |
| 44 | 3789 | Mode-gate backfill |
| 50 | 3954 | `public.infra_cache` |
| 51 | 3972 | First-class modifiers |
| 57 | 4219 | 86'd items, seat_number, drive-thru |
| 62 | 4725 | Gift card + loyalty ledgers |
| 70 | 5204 | Inventory Intelligence — ABC, cycle counts, safety stock |
| 74 | 5528 | Refund idempotency — partial unique on `returns` |
| 80 | 5731 | Chart of accounts dedupe + `UNIQUE(code)` ("same ON CONFLICT no-op bug class as v79") |
| 82 | 5917 | `products.sku` partial UNIQUE |
| 87 | 6300 | **Tier 0 wholesale** + `ar_aging_buckets` |
| 90 | 6460 | Wholesale field sales — `employee_type`, lat/lng, visits, Field Rep role |
| 91 | 6657 | Hotfix — re-run v90 step 6 after a `roles_id` sequence collision |
| 98 | 7126 | **Security: enable RLS on all public tables** |
| 99 | 7143 | F01 Kit/BOM engine |
| 101 | 7386 | F06 scheduling — appointment↔sale link, GiST overlap exclusion |
| 105 | 7931 | F07 Batch/expiry/lot (FEFO) |
| 110 | 8290 | V02 wholesale — van sales |
| 117 | 8591 | V07 gym — member check-in |
| 119 | 8860 | V10 lodging — folio tax, hostel beds, iCal, night audit |
| 120 | 9105 | V05 clinical — recalls, vaccinations, handouts |
| 124–126 | 9499–9560 | Lifecycle events, admin TOTP, admin session hardening |
| 131 | 9635 | Business Modules — `platform_module_locks` + `tenant_business_modules` |
| 132 | 9688 | **Repair serial sequences left behind MAX(id)** by wizard explicit-id seeding |
| 133 | 9720 | Field Rep permission split |
| 135 | 9876 | D5 full mode normalization |
| 136 | 9921 | Business Modules v2 — per-outlet activation |
| **137** | **9973** | **Per-outlet roles** |

The arc: v1–15 core POS hardening → v16–25 breadth → v22–39 vertical mode explosion → v44–86 depth passes → v87–96 wholesale tier → **v98 security inflection** → v99–121 F/V depth series → v124–137 platform governance.

### Idempotent every-deploy sweeps
Exactly one — **`enableRlsOnPublicTables()`** (:10004-10018):
```sql
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false
  LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename); END LOOP;
END $$;
```
Shared by v98 (:7139) and the unconditional boot sweep (:10128). Rationale (:10121-10126): a one-shot migration can't cover future tables, and PostgREST would otherwise expose them to `anon`. The backend connects as `postgres` (`rolbypassrls`), so RLS-with-no-policy is transparent to the app. Failure is caught and logged (:10129-10131).

### New-tenant provisioning
1. `CREATE SCHEMA IF NOT EXISTS` **outside** any transaction, deliberately (:62-67) — orphans surfaced by `GET /api/admin/orphaned-schemas`
2. One `BEGIN` → `SET LOCAL search_path` → whole `SCHEMA_SQL` blob → seed → `COMMIT` (:85-87). Single-transaction design is a documented fix for partial seeds colliding on `roles_name_key`/`taxes_name_key` on retry (:79-84)
3. **Backfills `schema_version` with every migration version at once** (:95-101). Rationale (:89-94): `schema-pg.sql` is kept in sync with all migrations, so replaying v1..vN would be slow, brittle, and fatal for any non-idempotent migration

⚠️ So the schema file and the migration list are **two independently-maintained representations of the same truth**, and provisioning asserts they agree.

---

## 5. Data-integrity patterns

### `SELECT … FOR UPDATE`
- **Stock TOCTOU guard**, `routes/sales.js:1698` ("FOR UPDATE prevents TOCTOU race"): variant-outlet (:1764-1770), fallback to `product_variants.stock` (:1786-1789), simple products (:1810-1813)
- **Loyalty double-redemption**, `sales.js:2284-2292` — `FOR UPDATE OF c` on a `customers LEFT JOIN loyalty_tiers` (the `OF c` is required so the nullable join side isn't locked)
- **Wallet debit**, `sales.js:2500`
- **Gift-card redemption**, `routes/gift-cards.js:241, :353`
- **`FOR UPDATE OF wo`** on a LEFT JOIN in `routes/couriers.js:259-270`, with an inline comment that unqualified `FOR UPDATE` raises "cannot be applied to the nullable side of an outer join"
- Also `routes/fulfillment.js` (picklists ×5, loadsheets ×2, COD), `routes/holds.js`, `routes/batches.js:186`

### Advisory locks
Transaction-scoped, namespaced by schema:
- `services/booking-services.js:17` — `pg_advisory_xact_lock(hashtext(current_schema() || ':appt-emp-' || $1::text))`; `:42` for resources
- `services/room-service.js:617` — `':room_type:'`, race documented at `:604`

DB backstop: `excl_appointments_employee_overlap EXCLUDE USING gist (employee_id WITH =, tstzrange(start_at,end_at) WITH &&) WHERE (employee_id IS NOT NULL AND status NOT IN ('cancelled','no_show'))` (`schema-pg.sql:3904-3906`).
⚠️ Both `CREATE EXTENSION btree_gist` and the `ADD CONSTRAINT` are wrapped in `DO $$ … EXCEPTION WHEN OTHERS THEN RAISE NOTICE` (:3898-3911) — the comment concedes the constraint is "a hardening layer, not load-bearing", i.e. **it may silently not exist**.

### `ON CONFLICT`
22 in the schema file, 91 in migrations (11 `DO UPDATE`). Seed idempotency: `feature_flags … ON CONFLICT (key) DO NOTHING` (:2513, 2521, 2527, 2563), `company_profile (id)` (:2509), `courier_integrations (adapter_key)` (:1636), `notification_rules (event, channel)` (×5), `risk_controls_config (id)` (:5790). ⚠️ **Migrations v79 and v80 exist specifically to fix an "`ON CONFLICT` no-op bug class"** — `ON CONFLICT (code) DO NOTHING` was silently a no-op because no unique constraint on `code` existed (:5732).

### `CHECK` constraints — 171
Almost all string enums: `products.bom_type` (:175), `employees.employee_type` (:121-122), `customers.credit_block_mode` (:517-518), `company_profile.tax_mode` (:1274-1275), `promotions.type` (:933), `field_visits.status` (:569-570), `field_rep_routes.day_of_week BETWEEN 0 AND 6` (:543), `outlets.outlet_type IN ('store','van')` (:94). Non-enum: `products_min_order_qty_nonneg`, `products_order_increment_positive` (:194-200), both added via `DO $$ … EXCEPTION WHEN duplicate_object` blocks.

### Partial unique indexes
- `employees_email_unique … WHERE email IS NOT NULL` (:125)
- `idx_sales_idempotency_key … WHERE idempotency_key IS NOT NULL` (:2018)
- `idx_products_plu_code … WHERE plu_code IS NOT NULL AND deleted_at IS NULL` (:218-219) — soft-delete-aware, "mirroring the v82 `products.sku` pattern"
- `uq_customers_member_code` (:3988), `uq_waitlist_claim_token` (:4081), `uq_calendar_feed_token` (:4122)
- `platform_module_locks_global_uniq … WHERE tenant_id IS NULL` + `…_tenant_uniq … WHERE tenant_id IS NOT NULL` (:5892-5895) — the classic "one global row OR one per-tenant row" pattern
- Migration-only: `idx_returns_sale_idempotency` (v74), `idx_cycle_count_sessions_one_open`, `uq_patient_recalls_open`, `uq_class_booking_active`, `uq_tenant_lifecycle_events_onetime`, `idx_payment_webhook_events_unique`

---

## 6. Load-bearing table shapes (abridged; see source for full DDL)

- **`sales`** (:628-655) — `total_amount NUMERIC(12,2) NOT NULL`, `timestamp TIMESTAMPTZ`, `voided`, `discount_amount`, `points_earned/redeemed`, `invoice_number`, `shift_id`, `idempotency_key`, `fbr_status/irn/qr_code`, `subtotal`, `tax_total`, `tax_inclusive`. Out-of-band `ALTER`s add `customer_invoice_id` (v88), `field_visit_id` (v92), `appointment_id`, `folio_id`. ⚠️ **No `NOT NULL` on `outlet_id`**; no `CHECK (total_amount >= 0)`; `discount_type` is free-text
- **`sale_items`** (:660-685) — `quantity NUMERIC(10,3)`, `price_at_sale`, `cost_price_at_sale`, `staff_id`, `seat_number`, plus the v83 frozen tax snapshot `tax_rate_at_sale NUMERIC(8,4)`, `tax_amount_at_sale`, `hs_code_at_sale`, `was_backfilled`
- **`sale_payments`** (:689-695) — only 5 columns. ⚠️ **No `created_at`, no cascade, no CHECK on amount, no enum on `payment_method`.** The thinnest table in the sales path
- **`products`** (:147-238) — `stock INTEGER` (cross-outlet rollup) alongside `outlet_stock.quantity NUMERIC(10,3)` — **different types for the same nominal quantity**. Bolted-on columns via `ADD COLUMN IF NOT EXISTS`: MOQ (v95), batch tracking (v100), `visibility` (v96), `plu_code` (v115), `age_restricted` (v116)
- **`product_variants`** (:240-257) — `sku TEXT UNIQUE NOT NULL` is a **hard global UNIQUE**, while `products.sku` is only partially unique
- **`outlet_stock`** (:276-282) — `UNIQUE(product_id, outlet_id)`. ⚠️ **No `CHECK (quantity >= 0)`** — negative stock is representable
- **`customers`** (:465-524) — the most overloaded table: retail loyalty, wholesale credit (`credit_limit`, `credit_block_mode`, `payment_terms_days`), clinical PHI (`blood_group`, `allergies`, `medical_notes`), gym membership, field-sales geo (`lat`/`lng`). ⚠️ `balance NUMERIC(12,2)` carries a DDL warning (:475-480): it is *wallet credit*, **not** AR exposure — "stays 0 even for a customer at 160% credit utilisation"
- **`employees`** (:97-124) — ⚠️ both `role TEXT NOT NULL DEFAULT 'Cashier'` (legacy) **and** `role_id` coexist. `joining_date TEXT` (text, not date). `pin_code` nullable since v14
- **`role_permissions`** (:65-70) — no `ON DELETE CASCADE` on `role_id`, so deleting a role is blocked by its permissions
- **`employee_outlets`** (:1317-1330) — + `role_id INTEGER NULL REFERENCES roles(id) ON DELETE SET NULL` (v137)
- **`company_profile`** (:1228-1297) — singleton `id=1`, ~50 columns. ⚠️ `cash_denominations` is a JSON array stored as **`TEXT`** (:1253) while `ar_aging_buckets` and `barcode_scheme` are proper `JSONB`
- **`feature_flags`** (:1194-1200) — `key TEXT PRIMARY KEY, enabled BOOLEAN`. Seeded with 31 keys (:2511-2570) plus 43 further `INSERT` sites across migrations
- **`tenant_modes`** (:1299-1303) — three columns. v135 materialises a row per registry mode per tenant precisely because an empty map used to mean "don't enforce"
- **`tenant_business_modules`** (:5902-5911) — `saved_flags JSONB` snapshots at disable; legally **sparse** (no row = `default_outlet_enabled = TRUE`)
- **`outlet_business_modules`** (:5919-5926) — PK `(outlet_id, module_key)`; resolution rule frozen in the comment (:5913-5918)
- **`promotions`** (:930-950) — `type` CHECK includes `slab_percent`; `tier_rules JSONB`; ⚠️ **`starts_at TEXT`, `ends_at TEXT`** — promotion windows compared as strings
- **`customer_invoices`** (:3091-3110) — ⚠️ `status TEXT NOT NULL DEFAULT 'draft'` with **no CHECK enum**; `balance_due` is a stored denormalisation with no CHECK relating it to `total_amount - amount_paid` and no trigger maintaining it
- **`field_visits`** (:557-573) — `gps_*` columns, `status` CHECK, **`client_uuid TEXT UNIQUE`** (offline-queue idempotency — reconnect retries dedupe on the constraint, :551-555)

---

## 7. Notable risks / oddities

1. **`MAX(version)` versioning is not gap-safe forward.** A migration merged with a version *below* the current head would be **silently skipped forever** on already-migrated tenants — no error, no warning. A `NOT IN (SELECT version FROM schema_version)` set-difference would be strictly safer; the table is already keyed on `version`.
2. **Versions 40–43 missing with no explanation** (:3310 → :3789). Nothing prevents someone reusing those numbers.
3. **Two divergent DDL sources of truth.** `schema-pg.sql` and `MIGRATIONS` must stay hand-synchronised; provisioning bakes that in by stamping all 133 versions on a fresh tenant. **Any column a migration adds but the schema file omits produces a tenant that believes it is at v137 while missing that column — and nothing will ever re-apply it.** No automated drift check found.
4. **The public schema receives the entire 326-table tenant schema** (:10119). Forces 74 `information_schema` guards + 77 `current_schema()` checks; v131 documents a real stray-`public.company_profile` incident. Also puts `sales`/`customers`/`products` in public and therefore in scope for the PostgREST exposure v98 exists to close.
5. **`schema_migrations` is dead schema** — declared in `master-db-pg.js:53-56`, never referenced. Two similarly-named tables, one a decoy.
6. **`email_queue` is dead schema still being created** in every tenant schema and public, while the real queue's `pgboss.*` schema exists in **no repo DDL at all**.
7. **No triggers, functions, views, or `DEFERRABLE` constraints.** Every derived value is application-maintained: `products.stock` vs `outlet_stock.quantity` vs `variant_outlet_stock.quantity` (`int` vs `numeric(10,3)`), `customers.total_spend`, `customers.loyalty_points` vs the ledger, `customer_invoices.balance_due`, `products.is_bundle` mirroring `bom_type='kit'`. Any write path that bypasses the blessed route drifts these silently.
8. **`customers.balance` is a documented footgun** — a DDL comment is the only enforcement.
9. **Text where types exist** — `promotions.starts_at`/`ends_at`, `employees.joining_date`, `company_profile.cash_denominations`.
10. **`sale_payments` has no `created_at` and no cascade** — limits forensic reconstruction of split tenders; orphan rows possible on hard delete.
11. **`customer_invoices.status` has no CHECK enum**, unlike nearly every comparable status column. Same for `sales.discount_type`.
12. **Duplicate `return_reasons` DDL** at :726 and :2793 — byte-identical, so the second is a no-op, but a future edit to one won't reach the other.
13. **Three places a role can be asserted** — `employees.role`, `employees.role_id`, `employee_outlets.role_id`. Resolution order lives only in application code.
14. **Per-tenant migration failures are swallowed** (:10153-10155) — a partial-migration fleet is a normal steady state whose only signal is a log line. *(Verified clean on 2026-07-29: all 29 at v137.)*
15. **Admin TOTP secrets stored plaintext by design** (v125) — standard TOTP trade-off; recovery codes *are* bcrypt-hashed.
16. **The appointment overlap `EXCLUDE` constraint can silently not exist** (:3898-3911) — on any Postgres where `btree_gist` isn't installable, double-booking protection reduces to the advisory lock alone.
17. **v91 and v132 are both sequence-repair migrations** for the same bug class: explicit-id seeding never advances `nextval()`, so the first natural insert collides. v132 notes this was misreported to users as "Role name already exists."
