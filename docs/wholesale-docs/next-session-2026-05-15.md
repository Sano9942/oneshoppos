# Handoff prompt — paste this into a fresh Claude session

Copy everything below the line into the very first message of the new tab.

---

We're continuing the SanoPOS wholesale roadmap. **Tier 0 (wholesale operations) AND Tier 1.1 (field rep app foundation) are both complete as of 2026-05-14 evening.** Read the master reference end-to-end before doing anything:

`docs/wholesale-docs/sanopos-wholesale-master-reference.md`

The headline + the "What shipped" sections have the full commit log and current production state. Companion file with the competitive reasoning: `docs/wholesale-docs/research-competitive-landscape.md`.

## Critical: don't trust CLAUDE.md files

The CLAUDE.md files in this repo (project root, backend/, frontend/, subdirectories) drift over time and have been wrong about specifics multiple times in recent sessions. Use them only for orientation. Before you make any concrete claim about how the code works — schema column names, route signatures, middleware behavior, table presence — verify against the actual source file. Same rule for the master reference doc: cited paths were accurate when written but the code keeps moving.

Rule of thumb: grep first, read the actual file, then act.

## State entering this session

**Tier 0 + Tier 1.1 complete.** Current migration version: **91**.

Live state on production wholesale test tenant (`wholesalewalktest1778451`):

- `schema_version = 91`
- `tenant_modes.wholesale = true`
- `feature_flags.wholesale_credit_controls = true`, `feature_flags.wholesale_field_sales = true`
- `company_profile.ar_aging_buckets = [30, 60, 90]`, `company_profile.field_geofence_meters = 500`
- `customers` has `credit_limit`, `credit_block_mode`, `payment_terms_days`, `lat`, `lng`
- `sales.customer_invoice_id` FK exists
- Tables added in 1.1: `field_rep_routes`, `field_visits`
- Roles: 1=Administrator, 2=Manager, 3=Cashier, 4=Field Rep
- `role_permissions`: Manager has `override_credit_limit` + `manage_field_sales`; Field Rep has `manage_field_sales`
- Test Distributor outstanding: Rs 183,000 across 4 open invoices
- Field rep test data: Field Rep One (id=3, employee_type='field_rep'), 5 customers seeded, all 7 days of route seeded, 2 live visits in `field_visits` from the 1.1 walkthrough

Endpoints live on `https://api.sanopos.com`:

**Tier 0:**
- `GET /api/customers/:id/credit-status` — utilization + available
- `GET /api/customers/:id/statement?from=&to=` — bank-style ledger
- `POST /api/customers/:id/send-statement` — email via tenant-branded sender
- `GET /api/reports/ar-aging?as_of=&outlet_id=` — bucketed A/R
- `GET /api/reports/dashboard/wholesale?overdue_days=30` — home dashboard cards

**Tier 1.1 (new):**
- `GET /api/field/route/today` — rep view of today's planned customers
- `POST /api/field/check-in` — body `{ customer_id, outcome, lat, lng, gps_accuracy_m, selfie_base64, client_uuid, tag_shop_location? }` — idempotent on client_uuid
- `GET /api/field/visits?from=&to=&employee_id=&flagged_only=` — owner-facing visit history
- `GET /api/field/summary` — per-rep dashboard cards data
- `POST /api/admin/field-routes` — body `{ employee_id, day_of_week, customer_ids[] }` — replace-all semantics per (rep, day)

Frontend routes live on `https://sanopos.com`:

- `/field/today` — rep daily route (mobile-first)
- `/field/check-in/:customer_id` — GPS + selfie + outcome flow
- `/field/visits` — owner-facing visit log + filters + CSV export
- Dashboard now shows `FieldSummaryCards` widget when `wholesale_field_sales` flag on AND tenant has field-rep employees

## What's next

The next tier is **finishing the Pakistan wedge**. Tier 1.1 (proof-of-visit) is the foundation; Tier 1.2 (order capture from field) and 1.3 (schemes engine) layer on top. Read the Tier 1 table in the master reference for the full sequencing.

**Recommended start: 1.2 — Order capture from the field rep app (1.5 weeks)**

This makes the rep app actually drive sales, not just record visits. Scope:

- New screens on the rep app: product picker (mobile-friendly, scan or search), cart, "Apply scheme" preview (no-op until 1.3 ships — show "0 schemes apply" placeholder for now), credit-limit check (call existing `/api/customers/:id/credit-status` before order), "Confirm order".
- Reuse the existing IndexedDB offline queue (`utils/offlineQueue.js`) — extend it with `type='field_order'` the same way 1.1 added `type='check_in'`. Order payloads are larger but the pattern is identical: enqueue → optimistic UI → drain on reconnect.
- Backend: orders from the field POST to `/api/sales` (Credit tender by default if customer has terms; Cash if not) OR a new wrapper `/api/field/orders` that pre-fills sensible defaults and routes through `/api/sales`. **Open question** — discuss with user before coding.
- Outcome flow: at check-in time, if the rep picks "Took Order", the page should auto-advance to the order screen instead of going back to `/field/today`. Need a small state-machine change in `FieldCheckInRedesign.jsx`.

**Decision before starting 1.2 (the open question):** new wrapper endpoint `/api/field/orders` vs direct POST to `/api/sales`? The wrapper approach is cleaner (field-specific validation, deferred shipping) but adds a route. Direct POST is simpler (already handles Credit tender + offline idempotency) but couples rep ergonomics to the in-store sales contract. **Recommendation: direct POST to `/api/sales` for v1**, with a `source='field'` tag on the sale so we can split reporting later. Confirm with the user before writing code.

**Alternative start: 1.1.5 — owner-facing route assignment UI (2-3 days)**

If real wholesale tenants start signing up, the route-seeding-via-SQL workflow won't scale. The `/admin/field-routes` page lets the owner drag-drop customers into a rep's weekly beat without admin help. Backend endpoint `POST /api/admin/field-routes` already exists. This is mechanical UI work — no architecture decisions.

**Other Tier 1.1 follow-ups to consider (lower priority):**
- Integration tests for `routes/field.js` — currently no automated coverage. Use the same isolated-schema pattern as `pg-wholesale-credit-limit.test.js` once that one is unskipped.
- Field rep `employee_outlets` assignment — currently field reps have no outlet row, so `/api/context/bootstrap` returns empty outlets/companies. Harmless today; matters if a future field-sales flow needs outlet scoping.

Confirm with the user before starting any of the above.

## Operational rules (carry forward)

- Commit each Tier item separately. Push to main directly — no PRs unless the user explicitly asks.
- Backend changes auto-deploy via Railway. Frontend auto-deploys via Vercel. After pushing, verify Railway healthcheck succeeded before claiming the work is live. For migrations, also verify the new schema_version landed on at least one prod tenant via Supabase MCP — v90 silently lost rows on the first deploy (savepoint collision on a sequence). The fix is to keep all conflict-prone INSERT blocks in their own savepoint and reset sequences before INSERT if `ON CONFLICT (name)` is in play.
- Use Supabase MCP for read-only prod queries. Don't run destructive SQL on prod schemas without confirming first.
- migrate-pg.js uses `makeScopedDb()` now — don't reintroduce raw `SET search_path` followed by separate query under Supavisor pooling.
- Vitest is the test runner (not Jest). Run integration tests from `backend/` directory.
- The wholesale tenant has `phase2g_loyalty` enabled — loyalty tiers may auto-discount on Credit sales causing front/back total mismatch. For verification testing, RESET Test Distributor to Bronze + 0 points after each sale: `UPDATE customers SET loyalty_tier_id=1, loyalty_points=0 WHERE id=1`.

## Test tenant credentials

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Admin user | `Wholesale Test Owner` / `TestWholesale778!` / PIN `4321` |
| Cashier user | `Test Cashier` / `TestCashier1!` / PIN `1234` |
| **Field rep user** | `Field Rep One` / `TestField234!` / PIN `7777` (id=3, role_id=4, employee_type='field_rep') |
| Tenant ID | 103 |
| Test customers (5) | id=1 Test Distributor (now geo-tagged at 24.915, 67.085, credit_limit=50000), id=2 Shaheen General Store, id=3 New City Mart, id=4 Khalid Kiryana Store, id=5 Ahmed Brothers |
| Routes seeded | All 7 days of week, 5 customers each (Sun-Sat) for Field Rep One |
| Visits already in `field_visits` | 2 (Shaheen + Test Distributor, both `ordered`) |

## What to do first this session

1. Read the master reference end-to-end. Focus on the "What shipped" sections — both Tier 0 and Tier 1.1.
2. Read this file end-to-end.
3. Confirm with the user which direction to take (1.2 order capture vs 1.1.5 admin UI vs something else).
4. For 1.2 specifically: get a decision on direct-POST-to-/api/sales vs wrapper-endpoint before writing code.
