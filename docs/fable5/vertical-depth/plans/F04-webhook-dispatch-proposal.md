# F04 — Webhook dispatch change: proposal + intent-registry design

**Status: AWAITING APPROVAL (HARD GATE #2).** Security-adjacent — `routes/webhooks.js` is the shared, before-tenant-middleware entry for xPay/sandbox. No code below is wired yet.

## What exists today

`processWebhookEvent()` (routes/webhooks.js) dispatches a verified gateway event through a fixed if-else cascade of **contexts**, in order:

1. **Platform billing** — `payment_intents` (public schema) keyed by `gateway_ref`. This is the SaaS subscription path (tenant activation, plan limits). **Untouched by F04.**
2. **Room deposit** — `room_bookings.deposit_payment_intent_id` (tenant schema).
3. **Treatment deposit** — `treatment_plans.deposit_payment_intent_id` (tenant schema).
4. Invoice payment links · 5. Restaurant pay-at-table · 6. Storefront sessions · 7. Wallet top-up.

Because a gateway_ref carries no tenant, tenant resolution first runs `resolveTenantDbForGatewayRef()`, which **scans every active tenant × a hardcoded 5-table `lookups` array** and returns the first tenant whose schema has a matching row.

F04 adds three more deposit entities (rental_contracts, appointments, service_tickets). Under the current shape that means **two edits per entity**: a new row in the `lookups` array *and* a new near-identical context block — exactly the copy-paste that produced the room/treatment twins in the first place.

## The change (what needs approval)

Replace the hardcoded deposit entries — in **both** `resolveTenantDbForGatewayRef` and `processWebhookEvent` — with a single loop driven by `deposit-engine.ENTITY_ADAPTERS` (the registry already shipped in the extraction commit). Adding a deposit entity then means **registering one adapter**, with zero webhook edits.

Two design options for *how* tenant resolution works. They differ only in scalability; both keep the billing path (Context 1) untouched and both keep every existing non-deposit context exactly as-is.

---

### Option A — registry-driven dispatch, **no schema change** (recommended)

Deposits stay tenant-scoped on their own tables (no data migration, matches the extraction's "engine writes through the adapter" contract). The webhook just iterates the registry instead of hardcoding rooms + treatments.

**Diff 1 — `resolveTenantDbForGatewayRef` lookups become registry-derived:**

```js
const depositEngine = require("../services/deposit-engine");

// Deposit tables come from the engine registry; the three non-deposit
// payment-session tables stay explicit.
const lookups = [
  ...Object.values(depositEngine.ENTITY_ADAPTERS).map((cfg) => ({
    table: cfg.table, ref: cfg.refColumn,
  })),
  { table: "customer_invoice_payment_links", ref: "gateway_ref" },
  { table: "restaurant_payment_sessions",    ref: "gateway_ref" },
  { table: "storefront_payment_sessions",    ref: "provider_ref" },
];
```

**Diff 2 — Contexts 2 + 2b collapse into one registry loop in `processWebhookEvent`:**

```js
// ── Context 2: deposit pre-auth (all registered entities) ──
for (const entityType of Object.keys(depositEngine.ENTITY_ADAPTERS)) {
  const cfg = depositEngine.ENTITY_ADAPTERS[entityType];
  try {
    const { rows: [hit] } = await db.query(
      `SELECT id FROM ${cfg.table} WHERE ${cfg.refColumn} = $1`, [transaction_id]
    );
    if (hit) {
      await depositEngine.handleWebhook(db, {
        entityType, gatewayRef: transaction_id, eventType: event_type, status,
      });
      return { ok: true };
    }
  } catch (depositErr) {
    if (!String(depositErr.message || "").includes("does not exist")) {
      _logger.error({ err: depositErr, transaction_id, entityType }, "Deposit webhook lookup failed");
    }
  }
}
```

The `${cfg.table}`/`${cfg.refColumn}` interpolation is **not** user input — values come only from the in-code `ENTITY_ADAPTERS` registry (same trust model as today's hardcoded table names). No new columns reach SQL.

- **Pros:** no migration; no new write path at pre-auth time; smallest blast radius; billing path literally unchanged; new entities are free.
- **Cons:** keeps the existing O(active tenants × tables) scan. This is unchanged from today and acceptable at current scale (soft-launch, small tenant count — same assumption the W32 comment already banks on).

---

### Option B — public `deposit_intents` registry table (scales, needs a migration → pause-list)

Add a public-schema registry so the webhook resolves tenant **and** entity in one indexed lookup, eliminating the cross-tenant scan.

```sql
CREATE TABLE IF NOT EXISTS deposit_intents (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
  gateway_ref  TEXT NOT NULL UNIQUE,
  entity_type  TEXT NOT NULL,   -- room_booking | treatment_plan | rental_contract | appointment | service_ticket
  entity_id    INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deposit_intents_ref ON deposit_intents(gateway_ref);
```

`deposit-engine.create()` would INSERT here (public schema) alongside the tenant-row update; the webhook does one `SELECT tenant_id, entity_type, entity_id FROM deposit_intents WHERE gateway_ref = $1`, then scopes to that tenant and calls `handleWebhook`.

- **Pros:** O(1) tenant+entity resolution; a real intent ledger for auditing/orphan-sweep; the plan's literal "intent-registry lookup."
- **Cons:** new migration (**pause-list**); a second write on the pre-auth path that must stay consistent with the tenant row; the extraction's "no data migration" guarantee now needs a backfill for in-flight deposits, or a dual-read fallback during rollout.

> **Note (not a blocker):** `payment_intents` (the existing public table) is billing-specific — `tenant_id`, `plan`, `cycle`, `outlet_count`, no `entity_type`/`entity_id`. Overloading it for deposits would entangle the deposit path with the tenant-activation path (the one thing this whole change is designed to keep clear of). A separate `deposit_intents` table is the clean form of Option B.

---

## Recommendation

**Option A.** It satisfies the plan's intent ("one registry lookup" — the registry being `ENTITY_ADAPTERS`), needs no migration, and keeps the security-sensitive billing context untouched. The O(N) scan is a pre-existing property, not introduced here, and current scale doesn't warrant the extra write path + migration + backfill that Option B carries. If/when tenant count grows, Option B is a clean follow-up (the engine already centralizes the create path where the INSERT would go).

## Regression guardrail (either option)

Before merging the webhook change, re-run the tenant-activation path: a `payment_intents` billing webhook must still flip the tenant to `active` (Context 1 must be reached first and unchanged). Covered by `pg-batch12-billing` + `pg-sandbox-payment`; the verifier also replays a billing webhook explicitly.

## Decision needed

1. **Option A or Option B?** (A recommended.)
2. If B: approve the `deposit_intents` migration (pause-list) and the backfill/dual-read strategy for in-flight deposits.

On approval I wire the chosen dispatch, then proceed to the three new consumers (rental pre-auth, appointment no-show, ticket gateway deposit) + the hardening items.
