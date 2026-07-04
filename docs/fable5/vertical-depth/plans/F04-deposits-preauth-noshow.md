# F04 — Unified Deposit / Pre-Auth Engine + No-Show Protection

**Covers:** cross-cutting observation #5 in [../README.md](../README.md) — gateway deposit pre-auth exists twice (rooms, treatment plans), is missing twice (rentals, appointments/no-show). Extract one shared engine, wire the two missing consumers, add card-on-file no-show fees.
**Modes/flags:** rides existing mode flags per consumer (`phase4_rentals`, `phase4_appointments`, `phase4_workflow_tickets`); no new flag. All gateway UI stays behind `paymentGateway.isEnabled()`.
**Surfaces:** admin (booking/contract/ticket screens) · public booking (deposit at book) · webhooks (`routes/webhooks.js`) · portal (deposit status display)
**Closes findings rows:**
- [10-rentals](../findings/10-rentals.md) → "Gateway deposit pre-auth (hold, not charge)" (P1, all four presets)
- [05-salon](../findings/05-salon.md) → "No-show fee auto-charge (card on file)" (P1)
- [07-repair-shop](../findings/07-repair-shop.md) → upgrades the manual `deposit_*` columns to gateway deposits (supporting row under "Ticket lifecycle … deposits" partial)
- [04-food-service](../findings/04-food-service.md) → "Card-preauth bar tabs" (P2 — consumed later by V03)
**Depends on:** nothing hard. F05 for customer notifications of holds/captures (soft).
**Consumed by:** V03 (bar tabs), V04 (no-show), V06 (ticket deposits), V09 (rental deposits).
**Branch:** off `main` (backend + webhook routing; thin UI touches per consumer screen ride their vertical plans).
**Model:** **Fable, effort high.** Payment-gateway + webhook-routing + refactor of two live money paths — auth/payments are pause-list-adjacent (completion-spec §5) and mistakes are customer-money mistakes.

---

## Design

`services/room-deposits.js` and `services/treatment-plan-deposits.js` are structural twins (createDepositPreAuth / handleDepositWebhook / capture* / find*ByIntent — room-deposits.js:29-159). Extract `services/deposit-engine.js` with an entity-adapter registry:

```
depositEngine.create(db, { entityType, entityId, amount, returnUrl, cancelUrl })
depositEngine.handleWebhook(db, { gatewayRef, eventType, status })   // dispatched from webhooks.js by intent lookup
depositEngine.capture(db, { entityType, entityId, amount })          // partial capture allowed (rental damage < hold)
depositEngine.release(db, { entityType, entityId })                  // clean return / completed plan
ENTITY_ADAPTERS = { room_booking, treatment_plan, rental_contract, appointment, service_ticket }
```

Each adapter maps status columns on its own table (rooms/treatments keep their existing columns — the engine writes through the adapter so **no data migration** of existing deposits).

### Schema (pause-list at execution)

```sql
-- rentals (currently manual deposit_collected/deposit_method only — schema-pg.sql:4127-4156)
ALTER TABLE rental_contracts ADD COLUMN deposit_status TEXT DEFAULT 'none'
  CHECK (deposit_status IN ('none','pending','authorized','captured','partially_captured','released','failed')),
  ADD COLUMN deposit_intent_ref TEXT, ADD COLUMN deposit_authorized_amount NUMERIC(12,2),
  ADD COLUMN deposit_captured_amount NUMERIC(12,2);

-- appointments no-show protection
ALTER TABLE booking_services ADD COLUMN no_show_fee NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN require_card_on_file BOOLEAN DEFAULT FALSE;
ALTER TABLE appointments ADD COLUMN card_token TEXT, ADD COLUMN no_show_fee_charged NUMERIC(12,2),
  ADD COLUMN no_show_charge_ref TEXT;

-- service tickets: reuse existing deposit_* columns, add gateway refs
ALTER TABLE service_tickets ADD COLUMN deposit_status TEXT DEFAULT 'none', ADD COLUMN deposit_intent_ref TEXT;
```

Mirror `room_bookings.deposit_status` state machine (schema-pg.sql:4369) — do not invent a new one.

## Tasks

### P0 — extraction without behavior change
1. Extract `services/deposit-engine.js`; re-implement `room-deposits.js` + `treatment-plan-deposits.js` as adapters over it. **Zero behavior change** — the existing integration tests + a live sandbox walkthrough on rooms and treatments are the gate. Capture-on-checkout (rooms) vs capture-on-settle (treatments) stays adapter-specific.
2. Webhook dispatch: `routes/webhooks.js` xpay handler currently routes deposit intents per-entity (`findBookingByIntent` / `findPlanByIntent`); replace with one intent-registry lookup (`payment_intents` table already exists — verify its shape covers entity_type/entity_id; extend if not). PAUSE: webhook code change needs explicit approval (security-adjacent).

### P1 — the two missing consumers
3. **Rental deposits** — `POST /api/rental-contracts/:id/deposit/preauth` mirroring `routes/rooms.js:263`; authorize at confirm/checkout; on `returnContract` → `release` (clean) or `capture(amount)` (damage/late fee, amount from the return screen); on `cancelContract` → release. UI: deposit panel on the contract screen (`RentalsRedesign.jsx`), states per the room pattern.
4. **Appointment no-show protection** — service opt-in (`require_card_on_file`): public booking flow tokenizes via `paymentGateway.tokenize` (payment-gateway.js:86,322 — exists, unused for appointments per findings [05-salon] "No-show fee" row) and stores `card_token`; marking `no_show` (existing status) offers "charge no-show fee" → `chargeSavedInstrument`; record ref + amount. Prepaid deposit-intent flow (`public-bookings.js:128`) remains the default; card-on-file is additive.
5. **Service-ticket gateway deposits** — `POST /api/service-tickets/:id/deposit/checkout` using `createInvoiceCheckout` style (charge, not hold — repair deposits are payments); keeps working with manual `deposit_*` recording when gateway disabled.

### P2
6. Bar-tab pre-auth adapter (`restaurant-checks.js:openTab`) — wire only when V03 asks; adapter slot reserved.
7. Deposit-status timeline entries in each entity's activity log (rentals + tickets already have activity tables).

## Reuse map (grep-confirmed)

| Need | Reuse | Evidence |
|---|---|---|
| Pre-auth lifecycle | `services/room-deposits.js` (4 fns) | :29-159 |
| Capture-on-settle variant | `services/treatment-plan-deposits.js` | services/CLAUDE.md |
| Tokenize + charge saved card | `services/payment-gateway.js` | :86 `tokenize`, :96/:327 `chargeSavedInstrument`; sandbox adapter :241-253 |
| Webhook verification | `paymentGateway.verifyWebhook` in webhooks.js | backend/CLAUDE.md (xpay is the only verified hook) |
| Intent storage | `payment_intents` (public schema) | CLAUDE.md storage map |
| Deposit UI states | rooms deposit panel | `RoomManagementRedesign.jsx` |

## Harden what's built

- **P0 — orphaned holds.** `room-deposits.js` has no expiry sweep: a pre-auth authorized for a booking that is then cancelled *before* webhook confirmation, or a gateway hold that lapses (~7 days at most acquirers), leaves `deposit_status='authorized'` forever; checkout then "captures" a dead hold and fails at the gateway. Evidence: no worker references deposits (grep `deposit` in `workers/` → only room-overdue email worker's unrelated columns; verify at execution). Failure: guest books Monday, hotel captures the following month at checkout → gateway declines → front desk stuck. Fix in the shared engine: hold-age tracking + re-auth-or-notify sweep in a worker.
- **P0 — cancel-with-authorized-hold paths.** `cancelBooking` (rooms) and plan-discontinue (treatments): confirm they release the hold — grep shows capture is wired to checkout/settle only; cancellation release is not visible in `room-deposits.js` exports. Failure: cancelled booking keeps a customer's money frozen for a week. Verify then fix in the engine's `release` wiring for every terminal status.
- **P1 — double-capture idempotency.** `captureDepositOnCheckout` — verify a retried checkout (double-click, network retry) can't capture twice; the engine must gate on `deposit_status='authorized'` FOR UPDATE. (Same class as `createBatchInvoices`' 24h idempotency guard — customer-invoicing.js.)
- **P1 — `isEnabled()` gating on every new UI.** `payment-gateway.js` gotcha (services/CLAUDE.md): `isEnabled()` checks `XPAY_API_KEY`, not `PAYMENT_GATEWAY`. Failure: rental deposit button rendered on a gateway-less tenant throws on click. Every consumer screen gates on the billing-status `payment_enabled` field like `BillingRedesign.jsx` does.

## Cross-surface lens
- **Webhooks:** deposit webhooks share `/api/webhooks/xpay` with SaaS billing + rooms + treatments — the intent-registry dispatch must not break billing checkout confirmation (regression-test the tenant-activation path).
- **Auth:** public booking tokenization happens on unauthenticated flows — token must never be readable back out via any public GET (return only boolean `card_on_file`).
- **Notifications:** authorize/capture/release events notify the customer via F05 (receipt-of-hold emails); until then, silent + visible in entity activity log.
- **Receipts/invoices:** captured deposit must land on the entity's invoice/folio as a payment line, not vanish — rooms already do this via folio settle; rentals capture must flow into `POST /api/rental-contracts/:id/invoice` math.

## Verification bar
- Test tenants: fresh `car_rental` + fresh `salon`, sandbox gateway ([[sanopay_sandbox]]).
- Walkthrough: rooms + treatments regression first (unchanged behavior end-to-end); rental: authorize at checkout → clean return releases → second contract: capture partial for damage → captured amount on invoice; salon: book card-on-file service → mark no-show → charge fee → ref recorded → customer can rebook; cancel-with-hold on each entity releases; ticket gateway deposit paid → reflected in ticket totals.
- Idempotency: replay the capture webhook + double-submit capture — single capture recorded.
- Gateway-off tenant: every new button hidden; manual deposit paths still work.
