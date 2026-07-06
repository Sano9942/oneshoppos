# F04 — Consumer + hardening migration: proposal

**Status: AWAITING APPROVAL (pause-list: migration application).** Nothing added to `migrate-pg.js` or applied to any DB yet. This one migration unblocks all three new consumers + the orphaned-hold hardening.

## Decisions you need to make

1. **Approve the DDL below** (idempotent, `IF NOT EXISTS` throughout).
2. **Version number.** My branch is off `main` (head **v98**), so the natural next version is **v99**. But the local DB / sibling feature branches are already at **v101** (F05=v99, F06=v100, F02=v101 — none merged to main yet). Two choices:
   - **(a) Number it v99** on this branch (correct relative to `main`); the merge-sequencing step renumbers if F05/F06/F02 land first. Clean history per-branch, collision resolved at integration. **Recommended** — matches how the parallel plans were designed to merge.
   - **(b) Number it v102** to sit above the current local max, avoiding any local-apply skip. Wrong relative to `main` (leaves a v99–v101 gap on this branch) and bakes in an assumption about merge order.
3. **schema-pg.sql drift.** `appointments` + `booking_services` deposit columns live in `migrate-pg.js` (an old migration) but were never backfilled into `schema-pg.sql`, so fresh tenants (e.g. local `squaretest`) don't have them. I propose to **also add the F04 columns to `schema-pg.sql`** so fresh tenants get them — and, while there, add the pre-existing appointment deposit columns that drifted. Approve including the schema-pg.sql edit?

## Migration DDL (proposed)

```sql
-- ── Rentals: gateway pre-auth with partial capture (damage < hold) ──
ALTER TABLE rental_contracts
  ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'none'
    CHECK (deposit_status IN ('none','pending','authorized','captured','partially_captured','released','failed')),
  ADD COLUMN IF NOT EXISTS deposit_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_authorized_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS deposit_captured_amount   NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS deposit_authorized_at     TIMESTAMPTZ;   -- hold-age (orphan sweep)
CREATE INDEX IF NOT EXISTS idx_rental_contracts_deposit_intent
  ON rental_contracts(deposit_payment_intent_id) WHERE deposit_payment_intent_id IS NOT NULL;

-- ── Appointments: no-show protection (card on file) + deposit-intent (drift-fill) ──
ALTER TABLE booking_services
  ADD COLUMN IF NOT EXISTS no_show_fee NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS require_card_on_file BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS card_token TEXT,               -- gateway token, never read back out
  ADD COLUMN IF NOT EXISTS no_show_fee_charged NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS no_show_charge_ref TEXT,
  -- drift-fill: prepaid deposit-intent flow columns (present via migrate-pg.js on
  -- migrated tenants, missing on fresh ones — add defensively so the appointment
  -- adapter has a consistent shape everywhere)
  ADD COLUMN IF NOT EXISTS deposit_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_status TEXT
    CHECK (deposit_status IS NULL OR deposit_status IN ('pending','authorized','captured','released','failed')),
  ADD COLUMN IF NOT EXISTS deposit_authorized_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_appointments_deposit_intent
  ON appointments(deposit_payment_intent_id) WHERE deposit_payment_intent_id IS NOT NULL;

-- ── Service tickets: gateway deposit (charge, not hold) on the existing deposit_* cols ──
ALTER TABLE service_tickets
  ADD COLUMN IF NOT EXISTS deposit_status TEXT NOT NULL DEFAULT 'none'
    CHECK (deposit_status IN ('none','pending','authorized','captured','released','failed')),
  ADD COLUMN IF NOT EXISTS deposit_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_authorized_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_service_tickets_deposit_intent
  ON service_tickets(deposit_payment_intent_id) WHERE deposit_payment_intent_id IS NOT NULL;

-- ── Hardening: hold-age tracking on the two EXISTING deposit entities too ──
-- (orphaned-hold sweep needs to know when each hold was authorized)
ALTER TABLE room_bookings   ADD COLUMN IF NOT EXISTS deposit_authorized_at TIMESTAMPTZ;
ALTER TABLE treatment_plans ADD COLUMN IF NOT EXISTS deposit_authorized_at TIMESTAMPTZ;
```

Column-name note: I use `deposit_payment_intent_id` for the gateway ref on **every** entity (not the plan's `deposit_intent_ref`) so the engine's `refColumn` is uniform with rooms/treatments — one less thing to remember. The engine abstracts the name anyway, but uniform is safer.

## Engine change this unlocks (consumer phase, after migration)

- Rentals need **partial capture** (`deposit_status='partially_captured'`, `deposit_captured_amount < deposit_authorized_amount`). The engine gains a `capture(db, { entityType, entityId, amount })` that records the captured amount and picks `captured` vs `partially_captured`; `settle`/`release` stay for the room/treatment (full or nothing) case. Rooms/treatments behavior unchanged.
- `deposit_authorized_at` is stamped when the webhook transitions a hold to `authorized` (engine `handleWebhook`), feeding the orphan sweep.

## What ships after approval (consumer + hardening phase)

3 consumers: rental pre-auth route + `RentalsRedesign` panel; appointment no-show (tokenize on public booking, charge on `no_show`); service-ticket gateway deposit checkout. Register `rental_contract`, `appointment`, `service_ticket` adapters in `ENTITY_ADAPTERS`. Hardening: orphaned-hold sweep worker, cancel-releases-hold on every terminal status, double-capture idempotency (`FOR UPDATE` gate), `isEnabled()`/`payment_enabled` gating on every new button. All verified on fresh `car_rental` + fresh `salon`, sandbox gateway, incl. webhook replay + gateway-off tenant.

## Decision needed
- Approve DDL? · Version **v99 (a, recommended)** or **v102 (b)**? · Include the `schema-pg.sql` backfill?
