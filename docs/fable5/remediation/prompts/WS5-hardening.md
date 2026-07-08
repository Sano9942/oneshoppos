# WS5 — Low-priority hardening cleanup

**Model:** Sonnet. **Branch:** `fix/ws5-hardening` off `main`. Batch anytime; low urgency.

## Context
LOW/hardening items from `01-CORE-SPINE.md` + `03-VERTICAL-CONNECTIVITY.md` + `claim-audit`. None are
launch blockers; several are latent correctness traps worth closing before scale.

## Verify first
Confirm each on `main @ v126`. TZ items: the report date-boundary bug is confirmed **local-dev only,
NOT prod** (Supabase session TZ = UTC) — see `report_date_boundary_tz_bug` memory + `VERIFICATION.md`.
It's a hardening fix (explicit UTC cast), not a live incident.

## Task (independent — cherry-pick)
- **L1** attendance TZ — `attendance.js:390-391` UTC "today" vs local `session_start::date` opens
  duplicate check-ins near midnight for off-server-TZ tenants. (Also tracked as F06 clock-in trap.)
- **Report date-boundary** — `utils/tz.js` `toUtcStart/toUtcEnd` emit naive `"YYYY-MM-DD HH:MM:SS"`
  cast against `timestamptz` using session TimeZone. Emit ISO with `Z` (or `::timestamptz 'UTC'`).
- **Reservations availability TZ** — see `followup_reservations_availability_tz` memory (double-book
  risk).
- **L2** insights perm guard — `insights.js:5` (`/auto`) + `insights-ai.js:19` (`/ask`) have no
  `requirePerm`; any employee reads 30-day revenue. Add `requirePerm("view_reports")`. Note the AI cap
  is an in-memory Map that resets on redeploy.
- **L9** impersonation revoke — `admin/operations.js:~226-237` warns on failed `revoked_tokens` insert;
  `loadTenantAndPerms` doesn't check `impersonation_sessions.revoked_at`. Close the gap.
- **L10** ABC worker env — verify `ABC_WORKER_ENABLED=1` on Railway (default "0"); if unset, `abc_rank`
  never refreshes. (Cross-check with `feedback_worker_env_var_drift` memory method.)
- **L11** dead migration — remove the `ALTER TABLE … ADD COLUMN` IIFE at `inventory.js:10-19` (runs
  against the proxy with no ALS context, caught/discarded; real column is in `schema-pg.sql`).
- **L6-L8** batch ledger — service-ticket part consumption (`service-tickets.js:485`), supplier returns,
  stock conversions (`stock-conversions.js:145`) move `outlet_stock` without `stock_batches`. (Fold
  into WS1a's helper if that lands first.)
- **L3** sale idempotency — `sales.js:1403-1413` check-then-insert raises a raw 500 on racing dup;
  return the friendly 409 like `returns.js:736-762`.
- **V4** rental deposit math — `rental-service.js:~710`: `balance_due` netted by deposit but
  `amount_paid` stays 0, no payment row → `amount_paid + balance_due ≠ total`. Post the deposit as a
  payment.
- **V5** overdue rental availability — `rental-service.js:502` checkout does no availability re-check →
  overdue unit re-lettable. Add the re-check.
- **V6** booking-service product-type — a booking service linked to a default-type product 400s at POS
  until `product_type='service'`; warn at booking-service creation.
- **V7** folio buckets — manual folio charges land only in `grand_total`, not
  `room_charge_total`/`pos_charge_total`; `tax_inclusive_at_charge` snapshots true on tax-exclusive
  rooms.

## Commit & push (REQUIRED)
Commit per item (or per small batch), push `fix/ws5-hardening`. No PR. Co-Authored-By trailer.
