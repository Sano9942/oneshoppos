# Phase 4 review — Verticals (Restaurant + Booking + Service Workspace)

## Summary
- Files reviewed: 31 (of 51 in scope — focused on cross-seam exposure)
- Critical findings: 3
- High findings: 3
- Medium findings: 2
- Low/pattern findings: 2

---

## Critical findings

### C1 — Appointment reminders are completely dead code
**File**: `backend/services/booking-reminders.js:5` / `backend/boot/workers.js`
**Seam**: cross-phase with pre-existing email infrastructure
**Finding**: `processPendingReminders(db, boss)` is fully implemented (polls `appointment_reminders`, sends via `boss.send("email", ...)`, marks sent/failed) and exported at line 41. **Zero callers anywhere in the codebase.** `boot/workers.js` has no reference to `booking-reminders`. No `boss.work` or `boss.schedule` for this feature. Meanwhile `services/booking-services.js:40` actively inserts rows into `appointment_reminders` on every appointment creation. Write path is live, dispatch path is dead. Every appointment reminder ever scheduled sits forever in `status='pending'`.
**Reproduction**: Create any appointment with `customer_email` set. Reminder row is inserted. No email is ever sent — no error, no log.
**Fix direction**: Add `boss.schedule("appointment-reminder-poll", "*/5 * * * *")` and `boss.work("appointment-reminder-poll", ...)` in `email-worker-boss.js` calling `processPendingReminders(pool, boss)`. Note: the `db` argument expects a direct pool — in multi-tenant mode this needs a `forEachActiveTenant` wrapper (same pattern as Phase 3's C1).

---

### C2 — QR ordering public endpoint permanently broken: `source_token_id` never populated
**File**: `backend/routes/public-restaurant.js:17` and `backend/services/restaurant-floor.js:88`
**Seam**: in-phase (4A), cross-seam with draft_orders (v22 column `source_token_id`)
**Finding**: The public QR menu endpoint queries `WHERE d.source_token_id = $1`, but `source_token_id` is never set by any code. `openTableSession` has no token. `createRestaurantCheck` has no token. The column has no DEFAULT in the v22 migration — all rows are NULL. **Every QR menu request returns 404 "No active session found."**
**Reproduction**: Enable `phase4_restaurant` + `phase4_restaurant_qr`. Open a table session, create a check. GET `/api/public/restaurant/menu/<any-token>` — always 404.
**Fix direction**: Generate `crypto.randomUUID()` in `createRestaurantCheck` for `order_context IN ('dine_in','bar')`, store in `source_token_id`, return to frontend for QR.

---

### C3 — KDS ticket-to-item JOIN is wrong: multiple tickets for same course share all items
**File**: `backend/services/restaurant-kds.js:128-134`
**Seam**: in-phase (4A)
**Finding**: `sendToKitchen` creates one `kds_ticket` row per item. `getTickets` joins items by `di.draft_order_id = kt.draft_order_id AND di.course_name = kt.course_name`. Because multiple tickets exist for the same draft_order + course (one per item), every ticket's items aggregation includes ALL items in that course. Table with 3 "main" items → 3 tickets, each showing all 3 items. Kitchen sees every item 3× on every ticket.
**Reproduction**: Add 3 products of the same category to a check. `send-to-kitchen`. Each of 3 tickets shows all 3 items.
**Fix direction**: Either create one ticket per draft_order+station+course (not per item), or add a `kds_ticket_items` junction table linking ticket→draft_order_item.

---

## High findings

### H1 — 4 feature flags seeded but never consumed: waitlists, classes, calendar sync, contract AI are gating leaks and dead schema
**File**: `backend/routes/bookings.js` and `backend/routes/contracts.js`
**Seam**: in-phase (4B/4C)
**Finding**: Flags `phase4_appointments_waitlists`, `phase4_appointments_classes`, `phase4_google_calendar_sync`, `phase4_contract_ai` are seeded in v23/v24 and registered in `DEFAULT_FEATURE_FLAGS`. Grep of entire `backend/routes/` and `backend/services/`: **zero `requireFeature` calls for any of these four flags**. Tables `appointment_waitlist_entries`, `class_sessions`, `class_session_bookings`, `calendar_sync_accounts` are never queried from any route or service — confirmed dead schema.

---

### H2 — `sendToKitchen` is not atomic: partial failures cause inconsistent KDS state
**File**: `backend/services/restaurant-kds.js:43`
**Seam**: in-phase (4A)
**Finding**: Loop of INSERT statements (one per item) + final UPDATE setting `kitchen_status='sent'`, all outside a transaction. If the loop fails on item 2 of 5, item 1 has a ticket, items 2-5 stay `pending` and get re-sent on next call. Idempotency guard based on `kitchen_status='pending'` means item 1 doesn't re-ticket but the inconsistency is visible on the KDS screen during the failure window.

---

### H3 — `splitCheckBySeat` reads items outside a transaction, delegates to separate transaction — stale read race
**File**: `backend/services/restaurant-checks.js:105-134`
**Seam**: in-phase (4A)
**Finding**: Reads `draft_order_items` at line 108 outside any transaction, then calls `splitCheckByItem` which opens its own transaction. Concurrent `POST /restaurant/checks/:id/items` between the read and the transaction start causes the split to operate on a stale item set.

---

## Medium findings

### M1 — Phase 3 customer_invoices UI won't label Phase 4 project invoices
**File**: Phase 3's `CustomerInvoicesRoute.jsx` + v24 migration
**Seam**: cross-phase with Phase 3
**Finding**: v24 adds `invoice_kind`, `project_id`, `milestone_id` to `customer_invoices`. Phase 3's invoicing UI was built before these columns and displays no project/milestone label. Project milestone invoices appear in the list with no indicator they're project-linked.

### M2 — `signature_data TEXT` has no size limit — base64 canvas images can inflate rows
**File**: `backend/schema-pg.sql:2923` / `backend/services/contracts.js:67`
**Seam**: in-phase (4C)
**Finding**: Unbounded TEXT column, no server-side size validation in `signContract`. A malicious or poorly-implemented client can submit multi-MB strings, slowing DB writes and bloating rows.

---

## Low / design drift patterns

### P1 — Phase 4 booking reminders use `boss.send("email")` directly, bypassing `email_queue` audit trail
**Affected files**: `backend/services/booking-reminders.js:20`
**Description**: Phase 3 uses `enqueueEmail()` which writes to `email_queue` before dispatching. Phase 4 bypasses the table entirely. Admin email queue inspector cannot see Phase 4 reminder traffic. (Relevant only if C1 is fixed.)

### P2 — `restaurant_tables` UPDATE uses unvalidated dynamic field-name interpolation
**Affected files**: `backend/routes/restaurant.js:93-100`
**Description**: The `PUT /api/restaurant/tables/:id` handler iterates `Object.entries(req.body)` and constructs `${key} = $${idx}` directly with no allowlist. Zod schema narrows input currently, but the pattern diverges from every other Phase 4 update handler (explicit field checks) and becomes injection risk if Zod is ever relaxed.

---

## Cross-phase observations
- `email-worker-boss.js` (Phase 3): Phase 4's `boss.send("email")` depends on Phase 3's email queue registration. If `EMAIL_WORKER_ENABLED=0`, reminders queue silently with no dispatch.
- `reservation-worker-boss.js` (Phase 1) uses `boss.schedule + boss.work` correctly — the pattern Phase 4 booking reminders should have followed.
- Phase 3 `customer_invoices.js` INSERT does NOT list `project_id`, `milestone_id`, `invoice_kind` — safe because all three have defaults in v24.

---

## Seams verified clean
- v22 draft_orders extension defaults: all 7 new columns have sensible defaults. Phase 2's INSERT path unaffected.
- v22 FK ordering: `draft_orders.table_id → restaurant_tables.id` added after `restaurant_tables` is created.
- v24 nullable columns: `quotations.project_id`, `customer_invoices.project_id/milestone_id`, `customer_subscriptions.project_id` all nullable; `invoice_kind DEFAULT 'standard'`.
- Permissions Phase 4 additions: 5 new perms correctly assigned to Manager only, Administrator via `all_access`, Cashier excluded.
- Public route auth bypass: both `public-restaurant.js` and `public-bookings.js` use `resolvePublicTenantDb`.
- `splitCheckByItem` transaction correctness: all operations inside single `db.transaction()` block.
- v24 contracts FKs: `customer_invoices.project_id → service_projects.id` safe.
