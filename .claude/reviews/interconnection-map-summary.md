**Concise summary of top findings (under 400 words):**

The map reveals nine structural risk zones across the five-phase branch.

The most pervasive pattern is **schema-vs-query drift**: Range B fixes `c53c9bc`, `cc53036`, `3ec70b8`, and `41ba68c` collectively patched 20+ column mismatches. The root cause is query code written without verifying the actual DDL — especially on pre-existing tables like `products` (no `created_at`), `sales` (timestamp column is `timestamp` not `created_at`), and any table extended across multiple migrations.

The **Phase 2 feature flag gap** (v26 backfill) confirms that all 13 `phase2_*` flags were in JS defaults but never seeded to the DB across two migrations (v19, v20). Any tenant between these migrations and v26 had a window where admin flag toggling silently failed. The fix pattern works but the gap pattern may recur — reviewer should verify Phase 3/4/5 flags are correctly seeded in their respective migrations (Phase 3 v21, Phase 4 v22–24, Phase 5 v25 — all confirmed correct).

The **`draft_orders` cross-phase shape extension** (Phase 2 creates table, Phase 4 adds 7 columns) is the deepest architectural seam. Phase 2 code produces retail draft orders that rely on DB defaults for the new restaurant columns. Phase 4 code filters on `order_context != 'retail'`. If any migration path results in NULL instead of the default `'retail'`, retail orders appear in restaurant check lists.

**Appointment reminders are dead code**: `services/booking-reminders.js:processPendingReminders` is defined, implemented, and exported — but never called from any worker, scheduler, or boot sequence. The `appointment_reminders` table is populated on creation but reminders never fire. This is the most complete silent feature failure in the entire phase work.

**`payment_gateway.js`** is consumed by three phases (billing, storefront, customer invoices) with consistent interface agreement, but Phase 5's extension of `payment_intents` with a `provider` column is not populated by any of the three existing callers.

The **courier credentials gap** is a deployment risk: v25 adds `encrypted_config_json` to `courier_integrations` for Phase 5 booking, but existing courier rows (seeded in v5/v17) will have NULL here. Phase 5 booking routes will silently fail on all pre-existing couriers until credentials are re-entered.