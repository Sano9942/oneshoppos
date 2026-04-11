# Cross-Phase Synthesis — Phases 1–5 Review (Step 4)

## 1. Cross-phase patterns

### Pattern A — Background workers bypass multi-tenant DB routing
- **Occurrences:** Phase 3 C1 (subscription-renewal / campaign-scheduled-send / invoice-reminder), Phase 4 C1 (appointment reminders — dead code that would exhibit the same bug), Phase 1 H2 (reservation worker monitoring gap — same architectural family)
- **Root cause:** New pg-boss handlers build a bare `{ query: pool.query }` shim instead of using the `forEachActiveTenant` pattern (used by `billing-lifecycle-check`) or the AsyncLocalStorage-aware `deps.db` proxy. All queries land on `public` schema, but Phase 3/4 tables live in `tenant_<slug>` schemas.
- **Fix direction:** Single helper `withTenantContext(slug, fn)` that sets `search_path` from job payload. Require all new queue handlers to include `tenant_slug` in the job payload. Register every worker in `GET /api/admin/worker-status`.
- **Severity:** Critical

### Pattern B — Feature flags seeded but never consumed (dead gating)
- **Occurrences:** Phase 3 M3 (`subscription_autocharge`), Phase 4 H1 (`phase4_appointments_waitlists`, `phase4_appointments_classes`, `phase4_google_calendar_sync`, `phase4_contract_ai` + `phase4_restaurant_preauth` from map §3), Phase 5 M1 (`phase5_payment_gateways`)
- **Root cause:** Flag registered in DEFAULT_FEATURE_FLAGS and seeded in migration, but grep finds zero `requireFeature(...)` calls. Ships as a billing lever with no enforcement.
- **Fix direction:** Audit script at build time that cross-references `DEFAULT_FEATURE_FLAGS` keys against `requireFeature` call sites and fails CI on orphans. Add the missing gates to the relevant routes, or remove the flag.
- **Severity:** High

### Pattern C — Dynamic SQL column interpolation from user-controllable sources
- **Occurrences:** Phase 2 C3 (`scheduled_catalog_changes.field_name` → `UPDATE products SET ${field_name}`), Phase 4 P2 (`PUT /api/restaurant/tables/:id` iterates `Object.entries(req.body)` with no allowlist)
- **Root cause:** Update handlers interpolate column names directly into SQL without a server-side allowlist. Current Zod schemas may narrow the input in one case but not the other, and the pattern is identical.
- **Fix direction:** Single `safeColumnList(entity)` allowlist helper. Any route that accepts a field name from the client must validate against it server-side before string interpolation, regardless of client-side Zod.
- **Severity:** Critical (C3 is exploitable by any `all_access` user for mass product mutation; P2 is a latent injection risk)

### Pattern D — Phase 5 columns referenced from earlier-phase code without schema guard
- **Occurrences:** Phase 1 C3 (`services/quote.js` reads `courier_integrations.flat_shipping_rate` — v25 column — from Phase 1 code), Phase 1 cross-phase note (`storefront_payment_sessions` used by Phase 1 `/pay` — v25 table), Phase 5 H2 (`web_order_transactions` new columns not populated on non-webhook inserts), Phase 5 C2 (`web_orders.active_shipment_id` referenced but never backfilled / written by Phase 1 path)
- **Root cause:** Phase 1 code was written assuming Phase 5 schema; Phase 5 added columns to pre-existing tables without updating all existing INSERT/SELECT call sites. Fresh installs at schema v18–v24 break Phase 1 entirely.
- **Fix direction:** Either (a) fold the dependent Phase 1 code into v25's migration block so it's only reachable post-v25, or (b) add `ADD COLUMN IF NOT EXISTS` guards to v18 so Phase 1 is self-contained. Then sweep every INSERT into extended pre-existing tables (`web_orders`, `web_order_transactions`, `courier_integrations`, `payment_intents`) and add the new columns.
- **Severity:** Critical

### Pattern E — Multi-step business flows lack transaction wrapping
- **Occurrences:** Phase 1 M2 (`convertReservations` no tx/FOR UPDATE), Phase 2 M1 (`approval_events` recorded before sale commits), Phase 3 H1 (`processRenewal` — 5 sequential writes with no tx → double billing), Phase 4 H2 (`sendToKitchen` — per-item inserts + status flip outside tx), Phase 4 H3 (`splitCheckBySeat` reads outside tx, delegates to a different tx)
- **Root cause:** Authors wrote multi-statement mutations with implicit atomicity assumptions. Crash/concurrency windows produce duplicate billing, orphan audit rows, inconsistent KDS state, and stale-read splits.
- **Fix direction:** Wrap every multi-write service function in `db.transaction()`. For cross-service compositions (approval + sale), use advisory locks or pass a shared client through.
- **Severity:** High

### Pattern F — Direct `fetch()` or direct `require("middleware/...")` bypasses shared infrastructure
- **Occurrences:** Phase 1 P1 (storefront frontend uses raw `fetch()` not `api.js`), Phase 2 cross-phase note (`contracts.js` + `bookings.js` use `require("../middleware/feature-flags")` instead of `deps.requireFeature`), Phase 4 P1 (`boss.send("email")` directly, bypassing `email_queue` audit)
- **Root cause:** Inconsistent import style across phases — Phase 2 uses `deps`, Phase 3/4 require middleware directly. Same family on the frontend: storefront bypasses `api.js`. The commit `1490a9a` (fulfillment.js missing destructure) is evidence this has already bitten once.
- **Fix direction:** Pick one style (deps destructure) and lint-enforce. Route the storefront through `api.js` with an anonymous mode flag.
- **Severity:** Medium

### Pattern G — Audit/action history is fire-and-forget, outside tx
- **Occurrences:** Phase 3 P1 (marketing/invoices/subscriptions/messaging all wrap `action_history` insert in try/catch outside mutation tx)
- Single-phase — noted here as the worst instance of Pattern E; fix alongside Pattern E.

---

## 2. Missed seams (map §9 coverage)

| # | Blind spot | Covered by |
|---|---|---|
| 1 | draft_orders shape split | Phase 2 C1, Phase 4 C2 |
| 2 | Phase 2 flag DB-seed gap | Phase 2 P2 (confirmed fixed in v26) |
| 3 | web_orders triple extension | Phase 5 C2, Phase 5 H2 |
| 4 | payment_gateway 3-phase divergence | Phase 5 H2 (partial — `billing.js` confirmed clean; `orders.js:576` flagged) |
| 5 | booking-reminders dead code | Phase 4 C1 |
| 6 | quotations multi-phase extension | **PARTIALLY MISSED** — Phase 4 M1 covers the invoice side only; nobody verified `routes/tier4/crm.js` quotation SELECTs return v21/v24 columns |
| 7 | courier_integrations triple extension | Phase 5 C1 |
| 8 | email-worker piggyback | Phase 3 M1, Phase 4 cross-phase note |
| 9 | customer_invoices/_subscriptions Phase 4 extension | Phase 4 M1 |
| 10 | Public routes bypass auth | Phase 1 V4 (clean), Phase 4 seams verified clean |

**Genuine misses:**
- **#6 quotations tier4** — Nobody verified `routes/tier4/crm.js` quotation responses include `converted_invoice_id`, `project_id`, `estimate_status`, `approved_at`, `approved_by`. Reason missed: `tier4/` was pre-existing, outside every phase reviewer's scope boundary, but two phases (3 and 4) extended the table.
- **#10 partial** — Phase 4 review confirmed public route helpers are used correctly, but did NOT check token entropy for `source_token_id`. Moot today (Phase 4 C2 shows the column is never populated), but becomes live once C2 is fixed.

---

## 3. Seam contradictions

**Contradiction 1 — `web_orders.active_shipment_id`**
- Phase 5 C2 confirms the map's hypothesis (pre-v25 legacy orders stay NULL; auto-match fails).
- Phase 1 V1 claims the seam is "clean — not written by Phase 1: confirmed, expected."
- **Resolution:** Phase 1 is wrong in spirit. It's technically correct that Phase 1 does not write the column, but calling it "expected" is wrong — it's the root cause of Phase 5 C2. Shared-responsibility bug: Phase 1 storefront checkout should write `active_shipment_id` when it writes `tracking_number`, AND Phase 5 auto-match should fall back to `tracking_number` join.

**Contradiction 2 — `draft_orders` INSERT omitting `order_context`**
- Phase 2 C1 self-corrects: "v22 defaults are correct; the structural concern is benign" and pivots to a different bug (stale `draft` returned from `/complete`).
- Phase 4 confirms defaults exist.
- **Resolution:** No substantive contradiction. v22 defaults make the structural concern benign. Phase 2 C1 is the real critical (stale draft state in complete response).

**Contradiction 3 — `payment_intents.provider`**
- Map §9 suggested `billing.js` does not populate `provider`.
- Phase 5 H2 verifies: `billing.js` WAS correctly updated.
- **Resolution:** Map is outdated. Phase 5 H2 is correct. The remaining gap is narrower than the map suggested (`web_order_transactions` only, not `payment_intents`).

---

## 4. Fix ordering graph

```
Pattern A (workers bypass tenant routing)
   ├── blocks Phase 3 C1 fixes (renewal/campaign/reminder)
   ├── blocks Phase 4 C1 fix (booking reminders)
   │      └── blocks Phase 4 P1 (email_queue audit trail)
   └── blocks Phase 1 H2 (reservation worker monitoring registry)

Pattern D (v25 columns referenced from earlier phases)
   ├── blocks Phase 1 C3 (quote service flat_shipping_rate)
   ├── blocks Phase 1 /pay endpoint (storefront_payment_sessions)
   ├── blocks Phase 5 C2 (web_orders.active_shipment_id backfill)
   │      └── blocks Phase 5 COD auto-match reliability
   └── blocks Phase 5 H2 (web_order_transactions new columns)

Phase 1 M1 (schema-pg.sql static snapshot FK ordering)
   └── blocks every fresh install test → must fix before any other
       Phase 1/5 DDL verification

Phase 2 C3 (SQL injection via field_name)
   └── Independent, fix immediately — no dependencies

Phase 4 C3 (KDS ticket/item JOIN)
   └── blocks Phase 4 H2 (sendToKitchen atomicity — fix JOIN model first,
       then wrap the correct insertion unit in a tx)

Phase 3 H1 (processRenewal no tx)
   └── blocks Phase 3 C2 (cancel doesn't cancel pg-boss job)

Phase 4 C2 (source_token_id never set)
   └── blocks any meaningful review of public-restaurant token entropy
       (blind spot #10 partial miss)

Phase 5 C1 (encrypted_config_json never read)
   └── blocks Phase 5 P1 (plaintext credential paths — same fix unblocks
       all 3 locations) and Pattern F's import-style audit in couriers.js

Phase 1 H1 (createReservation dead code)
   └── blocks Phase 1 M2 (TOCTOU in convertReservations) — both must be
       fixed together because wiring H1 without M2 creates a new race.
```

**Critical sequencing rule:** Fix Pattern D before Pattern A. If workers start running against tenant schemas that still have the v25 column gaps, they'll hit "column does not exist" instead of "table does not exist" — a different, harder-to-diagnose failure mode.

---

## 5. Summary counts

After deduplication across the 5 phase reviews:

- **Critical unique:** 11
- **High unique:** 11
- **Medium unique:** 9
- **Cross-phase patterns:** 7 (A through G)
- **Map blind spots covered:** 9 / 10 (plus 1 partial on #10)
- **Map blind spots missed:** 1 full (#6 quotations tier4), 1 partial (#10 token entropy)

---

## Two highest-leverage fixes

1. **Pattern A** — one worker helper resolves 3 critical + 1 high across Phases 1/3/4. Single most impactful change in the entire review set.
2. **Pattern D** — sweeping INSERT/query updates for v25 column gaps on `web_orders`, `web_order_transactions`, `courier_integrations`, plus guarding Phase 1 code against pre-v25 schemas. Without this, Phase 1 is broken on any schema older than v25 and Phase 5 COD auto-match is broken for all pre-v25 orders.

Everything else is domain-local and can be fixed in parallel by separate workstreams once these two patterns are resolved.
