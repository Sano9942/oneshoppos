# PLAN-V3 — Decisions Log

Owner-ruled decisions for the "remainder" wave (`feat/v3-remainder`). One section per
gated ruling. Investigation is filed first; the owner ruling and the executed branch are
recorded underneath.

---

## Step 4 — Dead portal `wallet` tab: WIRE-vs-RETIRE

**Status:** ✅ RULED **RETIRE** + EXECUTED, incl. the follow-up broken admin online-top-up path (owner extended the ruling "delete it too"). 2026-07-22, `feat/v3-remainder`, two local commits, not pushed.
**Date filed:** 2026-07-22
**Scope:** exactly the customer-portal `wallet` tab. No other portal tabs.

### The premise (confirmed)

The portal `wallet` tab is fully built but unreachable in the nav for all 23 industries:

- Page: [PortalWallet.jsx](../../../frontend/src/pages/portal/PortalWallet.jsx) — balance card, inline top-up, ledger.
- Route: reachable by **direct URL only** — [publicRoutes.jsx:70](../../../frontend/src/routes/publicRoutes.jsx) (lazy import) + `:282` (`/portal/:slug/wallet`).
- Backend: `GET /me/wallet` ([data.js:623](../../../backend/routes/customer-portal/data.js)) + `POST /me/wallet/top-up-intent` (`:645`).
- Label: `wallet_tab: "Wallet"` ([industry-config.js:706](../../../backend/config/industry-config.js)).
- **`wallet` appears in NO preset's `PORTAL_ENABLED_TABS_BY_PRESET` array** (`industry-config.js:715-739`), and is **not even a key in `TAB_FEATURE_FLAGS`** (`data.js:30-42`). The `/config` endpoint builds `enabled_tabs` from `getPortalEnabledTabs(industry) ∩ flags`, so `wallet` can never enter the list → the nav link never renders for any tenant.

**Git history:** `-S 'wallet'` on `industry-config.js` returns only the M8 portal commit
(`cb411106`) — the label/route/page landed in M8, the top-up backend in Wave 3
(`ee55aa73`), but `wallet` was **never once** added to a preset tab list. It was parked
from inception, not surfaced-then-retired.

### The load-bearing finding: the online top-up path is broken end-to-end

The read path (`GET /me/wallet`) works. The **top-up (write/credit) path does not** — and it
is broken in **two independent ways**, so the tab is *worse than dead*: a customer who reaches
the URL and pays would be **charged by the gateway and never credited**.

**Bug A — the crediting webhook context is unreachable (fatal, affects every online top-up path).**
`POST /me/wallet/top-up-intent` calls `gateway.createCheckout(...)` and **persists no row
anywhere** (grep confirms no `wallet_topup_sessions`/`wallet_topup_link` table exists in
`schema-pg.sql`). When the `payment.completed` webhook fires, the dispatcher first calls
`resolveTenantDbForGatewayRef(ref)` ([webhooks.js:33-84](../../../backend/routes/webhooks.js)),
which resolves the tenant by scanning only **deposit / invoice-payment-link /
restaurant-pay-session / storefront-payment-session** tables. There is no wallet table in that
list and no wallet row was persisted, so it returns `null` → the handler **404s at
`webhooks.js:302`, before ever reaching "Context 5: Wallet top-up" at `webhooks.js:479`.**
That crediting block is dead code that never executes for any wallet reference.

**Bug B — the reference/regex mismatch (portal path only).**
Even hypothetically past Bug A, Context 5 extracts the customer id with
`/wallet-topup-(\d+)-/` (`webhooks.js:482`), which assumes the format
`wallet-topup-{customerId}-{ts}`. The **portal** generates
`wallet-topup-{tenantSlug}-{customerId}-{ts}` (`data.js:652`); a slug contains letters, so the
regex never matches. (The **admin** link path `customers.js:862` uses the id-first
`wallet-topup-{id}-{ts}` format that *would* match — evidence the webhook was written for the
admin path and the portal path drifted. The admin path is still killed by Bug A, but that path
is out of this step's scope.)

**Net:** making the portal tab *real* is not "add `wallet` to a preset list." It requires
building the **missing settlement half** of an online-payment feature — persist a top-up session
row (new table + migration) *or* teach `resolveTenantDbForGatewayRef` to parse the slug out of
the reference; reconcile the reference/regex; and have a live/sandbox gateway plus an E2E test.
That is a feature-build, well outside "exactly the wallet tab."

### Is wallet redundant, or the only self-service top-up?

**Wallet-as-a-concept is live and fully served in-store** — the portal tab is *not* the only
way to use or load a wallet:

- **Spend:** `customers.balance` is a real POS tender. `useLoyaltyWallet`
  ([useLoyaltyWallet.js:36](../../../frontend/src/pages/redesign/pos/hooks/useLoyaltyWallet.js))
  reads `GET /api/customers/:id/wallet`; `POSCheckoutModal` has a working **Wallet** tender.
- **Load (works today, no gateway):** `POST /api/customers/:id/wallet/topup`
  ([customers.js:811](../../../backend/routes/customers.js)) — synchronous staff-side direct
  credit + ledger write. This is the functional top-up path.
- **Load (broken):** `POST /api/customers/:id/wallet/topup-link` (`customers.js:843`, admin) and
  the portal `top-up-intent` — both depend on the broken webhook (Bug A).

So the portal tab is a **redundant self-service top-up** whose only differentiator (customer
self-serve online top-up) is exactly the part that doesn't work.

### Which presets would want it, if it were wired?

Stored-value/wallet is loyalty-adjacent retail. The natural fits are the presets that already
carry `loyalty` (`general_retail`, `restaurant`, `cafe`, `salon`, `clinic`, `grocery`,
`sweet_shop`, `dental_clinic`) plus `gym` (prepaid). But none should get it until the
settlement pipeline is real.

### Recommendation: **RETIRE**

Reasons:
1. **Step 4's mandate is "don't leave a half-dead feature."** This isn't a one-line wiring gap —
   the top-up path is broken two ways, and fixing it is a migration + webhook change + gateway +
   E2E test, i.e. a feature-build outside this step's scope.
2. **It is currently a latent money-loss / support-liability surface**: the URL is live, and a
   real payment against it charges the customer without crediting the wallet.
3. **Wallet is already fully usable in-store** (POS tender + synchronous staff top-up), so
   retiring the tab removes redundancy, not capability.
4. The clean deletion is mechanical and low-risk; if self-service online top-up is wanted later,
   it should return as a properly scoped feature with the settlement half built and tested.

**Deletion set (RETIRE branch):**
- `frontend/src/pages/portal/PortalWallet.jsx` (delete)
- `frontend/src/routes/publicRoutes.jsx` — lazy import (`:70`) + route (`:282`)
- `backend/routes/customer-portal/data.js` — `GET /me/wallet` (`:622-639`) + `POST /me/wallet/top-up-intent` (`:641-666`)
- `backend/config/industry-config.js` — `wallet_tab` label (`:706`) + drop `wallet` from the valid-tab-keys comment (`:691`)
- Any `wallet` mention in the frontend recognized-tab-key lists (`PortalLayout.jsx`, `routes/CLAUDE.md:26`, `portal/CLAUDE.md`)
- **Out of scope, left as-is (documented follow-up):** the admin `customers.js` top-up-link (`:843`) and the webhook Context 5 (`webhooks.js:478-500`) — both still broken by Bug A, but the admin path is not part of the wallet-*tab* ruling. Flag as a separate follow-up.
- Drift note: deleting the two orphaned portal endpoints *shrinks* the frontend-coverage orphan set — the drift test only fails on NEW orphans, so removal is safe.

**Alternative (WIRE branch), for completeness:** add `wallet` to the loyalty-carrying presets +
`TAB_FEATURE_FLAGS`, **and** build the settlement pipeline (persist session row / slug-parse in
the tenant resolver + fix the regex), **and** verify a top-up completes end-to-end against the
sandbox gateway. Larger, drags in a migration + payment-webhook changes.

### Owner ruling

**RETIRE** (2026-07-22). The owner accepted the recommendation: this is a broken, redundant,
latent-money-loss surface, not a one-line wiring gap. Clean deletion.

### Execution record

Executed on `feat/v3-remainder`. Deletion set applied:

- **Deleted** `frontend/src/pages/portal/PortalWallet.jsx`.
- **`frontend/src/routes/publicRoutes.jsx`** — removed the `PortalWallet` lazy import + the
  `<Route path="wallet" …>` line.
- **`frontend/src/pages/portal/PortalLayout.jsx`** — removed `wallet` from `TAB_LABEL_KEYS` and
  `TAB_PATHS` (these are the real "TAB_LABEL_KEYS/TAB_PATHS entries" the plan named).
- **`frontend/src/pages/portal/PortalLogin.jsx`** — removed `wallet` from the login-subtitle `TAB_LABELS`.
- **`backend/routes/customer-portal/data.js`** — removed `GET /me/wallet` + `POST /me/wallet/top-up-intent`.
- **`backend/config/industry-config.js`** — removed the `wallet_tab: "Wallet"` label + dropped `wallet`
  from the valid-tab-keys comment. (`wallet` was already absent from every `PORTAL_ENABLED_TABS_BY_PRESET`
  entry, so no preset array changed.)
- **Docs** — updated `frontend/src/pages/portal/CLAUDE.md` (removed the `PortalWallet.jsx` section, the
  `wallet` recognized-tab key, and the wallet-specific gotchas), `frontend/src/pages/CLAUDE.md`,
  `frontend/src/routes/CLAUDE.md`.

**Follow-up — ALSO RETIRED (owner extended the ruling, same session, second commit).**
The originally-out-of-scope broken admin path was deleted too, on the owner's instruction ("delete it
too"). Removed: the admin staff-side link `POST /api/customers/:id/wallet/topup-link` (`customers.js`),
the now-dead webhook wallet-crediting block (`webhooks.js` "Context 5"), the integration test that
exercised the link (`pg-sandbox-payment.test.js` "Wallet top-up link" describe block, 3 tests), and the
`POST /api/customers/:id/wallet/topup-link` entry in `frontend-coverage-baseline.json` (it was an
orphan — the frontend never called it). No frontend change needed: `CustomersRedesign.jsx` only ever
called the synchronous `POST /api/customers/:id/wallet/topup`, which **remains** — that instant staff
top-up and the POS Wallet tender are the surviving, fully-functional wallet surfaces. The only thing
removed across both commits is the two **online-payment** top-up paths (portal self-service + admin
link), both of which were broken by Bug A and would have charged without crediting.
Verified: `pg-sandbox-payment.test.js` 7 passed (was 10), `frontend-coverage-drift` 3 passed with the
trimmed baseline, `node --check` clean on both edited route files, baseline JSON valid.

**Verification:**
- `npx vitest run tests/unit/frontend-coverage-drift.test.js tests/unit/portal-presets.test.js tests/unit/industry-config.test.js` → **41 passed**. The drift guard's hard check (no NEW orphan beyond baseline) passes: the two portal endpoints were never in the baseline (PortalWallet.jsx was their caller), and deleting caller + endpoints together adds no orphan. The admin `topup-link` baseline entry is untouched and still matches a live route.
- `vite build` → **✓ built in ~31s**, no dead-import error, no `PortalWallet` chunk emitted.
- `node --check` on both edited backend files → clean.
- Grep sweep confirms no remaining `PortalWallet` / `me/wallet` / `top-up-intent` reference in live code (only the out-of-scope webhook/admin paths + planning docs remain).

Browser check intentionally skipped: RETIRE is a pure removal (the URL now falls through to the SPA
catch-all) with nothing new to render — the build + drift test + grep are the proof of a clean deletion.

---

## Step 5 — `approval_policies` copy-on-new-outlet: COPY vs NEVER

**Status:** ⏸ INVESTIGATION FILED — awaiting owner ruling. Recommendation: **COPY**.
**Date filed:** 2026-07-22
**Scope:** exactly `approval_policies`. Not `modifier_groups` (Step 6), not any other copy candidate.

### Why this is answerable now (the parking is discharged)

`outlet-copy.js:26-27` parked this verbatim: *"approval_policies — parked until after D2 (Steps
13-14 rewire the (outlet, role) grain it keys on)."* D2 landed at **v137** (Steps 13-14 shipped
per-outlet roles: `employee_outlets.role_id`, NULL = inherit). The postponed question is now on the
table: **should a new outlet inherit the source outlet's `approval_policies`, and does the copy
handle the (outlet, role) grain safely now that per-outlet roles exist?**

### The schema and its grain

`approval_policies` ([schema-pg.sql:2748-2760](../../../backend/schema-pg.sql)):

| Column | Type | Classification intent |
|---|---|---|
| `id` | SERIAL PK | identity → **skip** |
| `action_type` | TEXT NOT NULL | config → copy |
| `outlet_id` | INTEGER → outlets(id), **NULL = all outlets** | **scope** (rewritten source→target) |
| `role_id` | INTEGER → roles(id), **NULL = all roles** | config → copy (**tenant-global** ref) |
| `policy` | TEXT (`allowed`/`denied`/`approval_required`) | config → copy |
| `threshold_value` | NUMERIC(12,2) | config → copy |
| `threshold_type` | TEXT (`amount`/`percent`) | config → copy |
| `is_active` | BOOLEAN | config → copy (soft-delete flag) |
| `created_at` / `updated_at` | TIMESTAMPTZ | **stamp** (NOW()) |

**Grain = `(action_type, outlet_id, role_id)`** (the UNIQUE constraint). Both `outlet_id` and
`role_id` are optional wildcards. `evaluatePolicy` ([approval-policy.js:9-38](../../../backend/services/approval-policy.js))
resolves **most-specific-first**: `outlet+role > outlet > role > global`, matching
`(outlet_id = $outlet OR outlet_id IS NULL) AND (role_id = $role OR role_id IS NULL)`.

### The (outlet, role) grain question — does D2 break the copy? **No.**

Per-outlet role overrides live entirely in `employee_outlets.role_id`. `approval_policies.role_id`
is still a plain **tenant-global** `roles(id)` FK — roles are not outlet-scoped. D2 changed only
*which* `role_id` is resolved for an employee at a given outlet at **evaluation** time
(`resolveEffectiveRole` → passed into `evaluatePolicy`); it did **not** change the storage grain of
`approval_policies`. So a policy row is still "*(at outlet X, for effective-role Y, action Z) →
decision*", and copying it to a new outlet Z' merely rewrites `outlet_id` X→Z'; `role_id`
(tenant-global) resolves identically at the new outlet.

- **No per-employee reference** in the table. **No per-outlet-physical reference** other than
  `outlet_id` itself — which is the scope column that gets rewritten, exactly like every other
  `COPY_SPECS` entry.
- The copy WHERE is `outlet_id = source`, so it copies only **outlet-specific** rows. **Global rows
  (`outlet_id IS NULL`) already apply to the new outlet** and are correctly left untouched. The copy
  therefore means precisely: *give the new location the same outlet-specific approval overrides its
  sibling has.*
- **UNIQUE collision risk: none.** The target outlet is brand-new/empty, and rewriting
  `outlet_id`→target preserves each `(action_type, role_id)`'s uniqueness.

### COPY vs NEVER — applying the ruling's real three-part test

The NEVER list ([outlet-copy.js:9-28](../../../backend/services/outlet-copy.js)) is **not** "any
table with an outlet_id column" — every COPY table (outlet_business_modules, pos_layouts,
outlet_product_visibility, price_list_assignments, tip_pool_distribution_rules, kds_stations) is
outlet-scoped too. The real discriminators for NEVER are:

1. **Physical/personal reality** — floor plan (`layout_json` = a physical room), device
   (`device_uuid`), kiosk (`slot_token` = live capability token), availability rules (`employee_id`
   = staff), shopify map (physical Shopify location).
2. **Silent harm on wrong inheritance** — tax profiles (silently mischarge, FBR exposure; absent =
   safe cascade fallback), menu schedules (restrictions that silently *hide* sellable items; absent
   = always available).
3. **A required D6 setup-checklist item a copy would falsely satisfy** — booking services/resources,
   room types, rental items.

`approval_policies` is **none of the three**:

1. **Not physical/personal** — no device/token/layout/employee reference. `role_id` is
   tenant-global; `outlet_id` is the rewritten scope column.
2. **Not silent-harm — and the harm direction is inverted.** A wrongly-inherited approval policy
   surfaces **immediately** as a manager-PIN / approval prompt (visible, and correctable in the
   `/api/approval-policies` UI), and it errs in the **conservative** direction: it makes the new
   outlet *more* controlled, never less. This is the opposite of the two silent-harm cases — tax
   over-inheritance silently mischarges, menu-schedule over-inheritance silently hides revenue. A
   merchant who set "void > 1000 needs manager approval" at outlet A almost certainly wants it at
   outlet B.
3. **Not a required checklist item** — no setup checklist references `approval_policies`; with zero
   rows, `evaluatePolicy` returns `allowed` for everything (a valid permissive default). A copy
   cannot falsely satisfy a checklist that does not exist.

Positively, it sits squarely in the **COPY** set: per-outlet **governance/config** a sibling
location reasonably starts from — directly analogous to `outlet_business_modules` (which modules are
on) and `tip_pool_distribution_rules` (payout config).

### Recommendation: **COPY**

Add to `COPY_SPECS` with this exhaustive classification (the drift contract requires every column in
exactly one bucket):

```js
{
  table: "approval_policies",
  scope: "outlet_id",
  copy: ["action_type", "role_id", "policy", "threshold_value", "threshold_type", "is_active"],
  stamp: { created_at: "now", updated_at: "now" },
  skip: { id: "serial" },
},
```

Notes on two judgment calls inside the classification:
- **`role_id` → copy** (not skip): it's a tenant-global role reference, carries as-is, resolves at
  the new outlet. This is the whole reason the parking could be discharged post-D2.
- **`is_active` → copy**: matches the existing convention — `pos_layouts`,
  `tip_pool_distribution_rules`, and `price_list_assignments` all copy `is_active` as-is.
  `buildCopySql`'s WHERE has no `is_active` filter, so soft-deleted (`is_active = FALSE`) source rows
  would copy too, but they are harmless: `evaluatePolicy` filters `is_active = TRUE`, and the empty
  target outlet cannot collide on the UNIQUE key. Not worth extending the generic builder with a
  per-spec predicate.

### Execution surface (if COPY is ruled)

1. **`backend/services/outlet-copy.js`** — add the spec above to `COPY_SPECS`; remove the
   "approval_policies — parked until after D2" line from the deliberately-absent comment block (it is
   now a copied table, no longer parked).
2. **`backend/tests/integration/pg-step12-outlet-copy-drift.test.js`** — the `"only lists tables the
   owner ruled copyable"` test (lines 92-99) has a **hardcoded sorted allowlist** that must gain
   `"approval_policies"`. *(NB: PLAN-V3 Step 5's "touches" names `tests/unit/outlet-copy-drift.test.js`
   — that path does not exist; the real drift guard is this integration file, and its companion
   behaviour test is `pg-step12-outlet-copy-settings.test.js`.)*
3. **`backend/tests/integration/pg-step12-outlet-copy-settings.test.js`** — add a copy-behaviour
   case: seed an outlet-1 `approval_policies` row (a role-scoped one, to prove `role_id` carries and
   resolves), assert the copied outlet gets it with `outlet_id` rewritten and `role_id` intact, and
   that a global (`outlet_id IS NULL`) row is *not* duplicated onto the new outlet.
4. **`backend/services/CLAUDE.md`** — add `approval_policies` to the `outlet-copy.js` copyable-tables
   list.

### If NEVER is ruled instead

Add `approval_policies` to the documented never-copy comment block in `outlet-copy.js` with the
reason (e.g. "approval thresholds are a per-outlet loss-prevention decision an operator should set
deliberately, not inherit silently"), update `services/CLAUDE.md`'s never-copy list, and leave
`COPY_SPECS` / new-outlet creation untouched.

### ✅ Owner ruling — **COPY** (2026-07-23)

Owner ruled **COPY** at the gate. `approval_policies` is added to `COPY_SPECS` with the exhaustive
classification above; a new outlet created with `copy_from_outlet_id` inherits the source's
outlet-specific approval rules. See the Execution record below.

### Execution record

Executed on `feat/v3-remainder`.

- **`backend/services/outlet-copy.js`** — added the `approval_policies` spec to `COPY_SPECS`
  (`scope: outlet_id`; `copy: action_type, role_id, policy, threshold_value, threshold_type,
  is_active`; `stamp: created_at/updated_at = NOW()`; `skip: id`). Removed the "parked until after
  D2" line from the deliberately-absent comment block and added a one-line note recording the
  post-D2 COPY ruling.
- **`backend/tests/integration/pg-step12-outlet-copy-drift.test.js`** — added `"approval_policies"`
  to the hardcoded copyable-table allowlist (kept sorted).
- **`backend/tests/integration/pg-step12-outlet-copy-settings.test.js`** — seeded outlet 1 with two
  `approval_policies` rows (one role-scoped outlet-specific, one **global** `outlet_id IS NULL`) and
  added a case asserting the copy carries the outlet-specific row with `outlet_id` rewritten +
  `role_id` intact, and does **not** duplicate the global row onto the new outlet.
- **`backend/services/CLAUDE.md`** — added `approval_policies` to the `outlet-copy.js`
  copyable-tables list.

**Verification (2026-07-23, local Postgres `sanopos_test`, migration head v137):**
- Targeted, serial (`--no-file-parallelism`): `pg-step12-outlet-copy-drift.test.js` +
  `pg-step12-outlet-copy-settings.test.js` → **21 passed** (drift 3/3 incl. the updated table
  allowlist + full column classification; settings 18/18 incl. the new "copies an outlet-specific
  approval policy (role_id intact) but NOT a global one" case). The end-to-end path is real: the
  settings test drives `POST /api/outlets` with `copy_from_outlet_id`, and the new outlet gets the
  source's outlet-specific `void` policy with `outlet_id` rewritten + `role_id` (Manager, tenant-
  global) intact, while the global `manual_discount` policy is not duplicated — proving the copy runs
  inside the creation transaction and the (outlet, role) grain survives post-D2.
- Full suite vs baseline: ran the pinned baseline command (`npx vitest run --reporter=json
  --no-file-parallelism --testTimeout=60000 --hookTimeout=120000`, `backend/` cwd) → `check-baseline.js`
  reports **GATE GREEN** (72 known-red @ `3b45f25c`, 72 fresh-red, **0 new / 0 changed**). In that
  full run both step12 files passed (drift 3/3, settings 18/18, new test green). No regression.
- `node --check` clean on `outlet-copy.js` and both edited test files.

Note: the first targeted run (with default file parallelism) hit a Postgres `deadlock detected` inside
`seedSchema` during two schemas' concurrent DDL — an environmental concurrency artifact, not a code
failure; it cleared on the serial re-run, which is exactly why the baseline command mandates
`--no-file-parallelism`.
