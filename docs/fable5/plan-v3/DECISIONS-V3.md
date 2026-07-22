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

---

## Step 6 — E6: `modifier_groups` copy-on-new-outlet: COPY vs NEVER

**Status:** ✅ RULED **NEVER** + EXECUTED. 2026-07-23, `feat/v3-remainder`, local commit, not pushed.
**Date filed:** 2026-07-23
**Scope:** exactly `modifier_groups` (+ its `modifier_options` / `product_modifier_group_links` children). The last unruled of the 13 D8 copy candidates. Not `approval_policies` (Step 5, already ruled COPY).

### Why this was parked, and why it's answerable now

`outlet-copy.js:26` parked it verbatim: *"modifier_groups — needs a groups→options→links deep copy (E6)."* Unlike every shipped `COPY_SPECS` entry (a flat single-table `INSERT … SELECT`), a modifier copy would have to clone a **three-table tree** and remap serial ids — it never fit the flat spec shape, so it was deferred rather than ruled. This step scopes that deep copy and rules on it.

### The schema — a three-table tree, no natural key

| Table | Key columns | Notes |
|---|---|---|
| `modifier_groups` ([schema-pg.sql:2679](../../../backend/schema-pg.sql)) | `id SERIAL PK`, `outlet_id INTEGER → outlets(id)` **nullable**, `name` (NOT unique), `selection_type`, `min_select`, `max_select`, `is_required`, `display_order`, `is_active` | **No UNIQUE constraint anywhere** — confirmed by a full scan of `schema-pg.sql` (nothing references `modifier_groups`). `name` is plain TEXT. |
| `modifier_options` ([:2709](../../../backend/schema-pg.sql)) | `id SERIAL PK`, `group_id → modifier_groups(id) ON DELETE CASCADE`, `name`, `price_delta`, `is_default`, … | Child of a group. |
| `product_modifier_group_links` ([:2720](../../../backend/schema-pg.sql)) | `PRIMARY KEY (product_id, group_id)`, `product_id → products(id)`, `group_id → modifier_groups(id)`, `display_order` | Join table. `product_id` is **tenant-global** (products aren't outlet-scoped). |

### Outlet-scoped or tenant-global? **Schema says outlet-scoped; the running code says tenant-global.**

The DDL gives `modifier_groups` an `outlet_id` column, and `outlet_id IS NULL` is documented as "tenant-wide, visible to all outlets" ([modifiers.js:13-19](../../../backend/services/modifiers.js)) — the same nullable-wildcard shape as `approval_policies`. On that basis alone, "copy per outlet" would *look* legitimate (copy `outlet_id = source` rows, leave NULLs).

But `outlet_id` on this table is **vestigial** — no live surface writes it, and no consumption path scopes by it:

1. **The POS product→modifier consumption path is outlet-blind.** `getModifierTreeForProduct` ([modifiers.js:137-158](../../../backend/services/modifiers.js)) is the query the POS uses to fetch a product's modifiers — `FROM product_modifier_group_links pmgl JOIN modifier_groups mg … WHERE pmgl.product_id = $1 AND mg.is_active = true`. **There is no `outlet_id` predicate.** The POS calls it with the product id alone ([POSContext.jsx:471](../../../frontend/src/pages/redesign/pos/POSContext.jsx), `GET /api/products/:id/modifier-tree`). So a product's modifier set is identical at every outlet.
2. **The back-office group list is called without an outlet.** `listGroups(db, outletId)` is the *only* reader that honours `outlet_id` (`WHERE outlet_id IS NULL OR outlet_id = $1`) — but it only applies the filter `if (outletId)`, and the sole caller, `ModifierGroupsRedesign` ([:26](../../../frontend/src/pages/redesign/ModifierGroupsRedesign.jsx)), fetches `/api/modifiers/groups` with **no `outlet_id` query param** → `listGroups(db, null)` → the filter branch is skipped → every group is listed tenant-wide.
3. **The create form never sets `outlet_id`.** `saveGroup` ([:38](../../../frontend/src/pages/redesign/ModifierGroupsRedesign.jsx)) builds `{ name, selection_type, min_select, max_select, is_required, display_order }` — **no `outlet_id`** — so `createGroup`'s `data.outlet_id || null` always stores `NULL`. Every group created through the UI is tenant-wide.

**Net:** on any real tenant, *every* `modifier_groups` row has `outlet_id IS NULL`, and even a hand-inserted outlet-specific row would be ignored by both the POS tree query and the (param-less) back-office list. Modifier groups are **de-facto tenant-global**. The plan's own "if tenant-global, copy-per-outlet is a category error → NEVER by construction" test is met — not by the DDL, but by every live read and write path.

### What a COPY would actually do — harm or dead rows, never benefit

A copy's WHERE would be `outlet_id = source` (mirroring `approval_policies`, which is the only correct filter — NULL/tenant-wide rows already apply everywhere and must not be duplicated). Trace it through:

- **On a real tenant it matches zero rows** (every group is `outlet_id IS NULL`). The deep copy would be dead code — a three-table remap that never fires. Shipping it means writing, drift-testing, and maintaining a structural extension to `outlet-copy.js` that copies nothing on any tenant that exists.
- **If an outlet-specific group `G` (outlet_id = source) somehow existed and we copied it** to `G'` (outlet_id = target) with its option `O'` and its product link `(P, G')`: product `P` would now carry **both** `(P, G)` and `(P, G')`. Because `getModifierTreeForProduct` is outlet-blind, the POS would show that modifier group **twice for product P at every outlet — including the source outlet**. The copy corrupts the source, not just the target.
- **If we copied groups + options but *not* the links** to dodge the double-display: `G'` would be an unreferenced group — invisible at the POS (nothing links to it), clutter in the back-office list. Dead rows.
- **If we copied nothing (NEVER):** the new outlet, via the outlet-blind tree query, already sees exactly the same per-product modifier set as every other outlet. **A new outlet already inherits the full effective modifier behaviour with zero copy.**

There is no copy variant that adds correct value: links → duplicate-display everywhere; no links → dead rows; nothing → already correct.

### The deep-copy design (scoped for completeness, as the plan requires even for a NEVER ruling)

Had the model been genuinely outlet-scoped, a correct COPY would have been a **structural extension of `outlet-copy.js`, not another `COPY_SPECS` row** — a groups→options→links id-remap can't be expressed as a flat column classification. The shape:

```
for each source group where outlet_id = sourceOutletId:      -- tenant-wide (NULL) rows skipped: already apply
  INSERT modifier_groups (outlet_id=target, name, selection_type, …) RETURNING id  → newGroupId
  INSERT modifier_options (group_id=newGroupId, …) SELECT … FROM modifier_options WHERE group_id = oldGroupId
  INSERT product_modifier_group_links (product_id, group_id=newGroupId, display_order)
         SELECT product_id, newGroupId, display_order FROM product_modifier_group_links WHERE group_id = oldGroupId
```

Row-by-row in JS (groups per outlet are few) to capture each old→new id — `INSERT … RETURNING id` can't correlate a set-based remap because the table has no column to carry the source id. `product_id` carries verbatim (tenant-global). All inside the caller's outlet-creation transaction.

**Dedup guard (there is no DB constraint to lean on — `modifier_groups` has no UNIQUE key):** the target outlet is brand-new during creation so it starts empty, but to make the path idempotent/safe the guard would be *skip the whole copy if the target already has any `modifier_groups` row* (keyed on `outlet_id = target`, not on `name` — name isn't unique and re-keying on it would wrongly merge distinct same-named groups). This is exactly the hazard the plan flagged: without such a guard, a re-run or a copy into an already-populated outlet would silently double every group.

This design is recorded to show the COPY branch was fully scoped — but it is moot given the tenant-global finding above.

### Recommendation: **NEVER**

Add `modifier_groups` to the deliberately-absent (never-copy) comment block in `outlet-copy.js` with the reason. Rationale, strongest-first:

1. **Modifier groups are de-facto tenant-global.** Both the POS consumption path (`getModifierTreeForProduct`, outlet-blind) and the back-office list (called without `outlet_id`) ignore the `outlet_id` column, and the create form never sets it. A new outlet already sees every product's full modifier tree with zero copy — copying per outlet is a category error.
2. **Every copy variant is harmful or useless** — copying links double-displays modifiers at *every* outlet (source included, because the tree query is outlet-blind); copying without links leaves dead unreferenced rows; the WHERE `outlet_id = source` matches zero rows on any real tenant regardless.
3. **The dedup hazard is real and unguarded** (no UNIQUE on `modifier_groups`), and it would have to be hand-built into a bespoke deep-copy path — cost with no upside given (1) and (2).
4. **NEVER keeps `outlet-copy.js` a single flat `COPY_SPECS` contract.** COPY would bolt a three-table id-remapping deep-copy path beside the flat loop and need its own drift coverage (the `COPY_SPECS` column-classification drift test can't see a hand-rolled remap) — real structural and maintenance cost to copy nothing.

This closes the 13-candidate D8 ledger: **6 COPY** (the 5 shipped at Step 12 + `approval_policies` at Step 5) / **7 NEVER** (the 6 ruled at Step 12 + `modifier_groups` here).

### Execution surface

**If NEVER is ruled (recommended):**
1. **`backend/services/outlet-copy.js`** — change the `modifier_groups` line in the deliberately-absent block from *"needs a groups→options→links deep copy (E6)"* to a real NEVER reason: modifier groups are de-facto tenant-global (both the outlet-blind `getModifierTreeForProduct` POS path and the param-less back-office list ignore `outlet_id`, which the UI never sets), so a new outlet already inherits every product's modifier tree; a per-outlet copy would double-display modifiers at every outlet (links) or create dead rows (no links).
2. **`backend/services/CLAUDE.md`** — add `modifier_groups` to the `outlet-copy.js` never-copy list (alongside tax profiles, floor plans, devices, kiosk tokens, staff schedules).
3. **No `COPY_SPECS` change, no new drift-test allowlist entry, no new-outlet-creation change** — the drift test's copyable-table allowlist stays at the 7 Step-5 tables. Optionally add a small regression assertion to `pg-step12-outlet-copy-settings.test.js`: seed a source-outlet modifier group + option + product link, create a copied outlet, assert **zero** `modifier_groups`/`modifier_options`/`product_modifier_group_links` rows reference the new outlet (mirrors the existing NEVER-copy block for tax profiles/floor plans/kiosk tokens).

**If COPY is ruled instead:** implement the deep-copy path above (distinct function beside the `COPY_SPECS` loop, invoked in the same transaction, with the target-already-populated skip guard), add the three modifier tables to the drift test's column-classification coverage (they can't ride the flat `COPY_SPECS` allowlist — the remap needs its own guard), add a copy-behaviour case to `pg-step12-outlet-copy-settings.test.js` proving group/option/link id-remap + the re-run/already-populated skip, and update `services/CLAUDE.md`. **Note the caveat:** this ships a bespoke deep-copy that, on the current outlet-blind consumption model, would double-display modifiers — COPY should not be ruled without also making `getModifierTreeForProduct` outlet-aware, which is well outside this step.

### Owner ruling — **NEVER** (2026-07-23)

Owner accepted the recommendation at the gate after a plain-language walkthrough of *why* it's not a real
choice: modifier groups already behave tenant-wide (every outlet sees every product's modifiers), so a
per-outlet copy can only duplicate a shared list or create dead rows. "Let's go with your recommendation."
The owner also confirmed no current need for genuinely per-outlet modifier menus; if that need ever
arises it is a separate feature (make `getModifierTreeForProduct` outlet-aware first), not a copy step.

### Execution record

Executed on `feat/v3-remainder`. NEVER branch — no `COPY_SPECS` change, no deep-copy path, no
new-outlet-creation change:

- **`backend/services/outlet-copy.js`** — rewrote the `modifier_groups` line in the deliberately-absent
  (never-copy) comment block: from *"needs a groups→options→links deep copy (E6)"* to the real NEVER
  reason (de-facto tenant-global; `outlet_id` vestigial — the outlet-blind `getModifierTreeForProduct`
  POS path and the param-less back-office list both ignore it and the create form never sets it; a copy
  would double-display at every outlet or leave dead rows; no UNIQUE key → silent doubling on re-run).
- **`backend/services/CLAUDE.md`** — added `modifier_groups` to the `outlet-copy.js` never-copy list with
  the one-line reason.
- **`backend/tests/integration/pg-step12-outlet-copy-settings.test.js`** — added a regression case to the
  "NEVER-copy ruling holds" block: seeds outlet 1 with a full modifier tree (an outlet-specific group +
  option + product link) plus a tenant-wide group, creates a copied outlet, and asserts (a) **zero**
  `modifier_groups` scoped to the new outlet and (b) the copy created **zero** new rows across all three
  modifier tables (before/after totals identical).
- **No drift-test change.** The `pg-step12-outlet-copy-drift.test.js` copyable-table allowlist stays at
  the 7 Step-5 tables — `modifier_groups` is deliberately absent, exactly as intended.

**Verification (2026-07-23, local Postgres, migration head v137):**
- Targeted, serial (`--no-file-parallelism`): `pg-step12-outlet-copy-drift.test.js` +
  `pg-step12-outlet-copy-settings.test.js` → **22 passed** (was 21 — the +1 is the new
  "never copies modifier groups, options or product links" case). The drift guard's copyable-table
  allowlist is **unchanged** (7 tables, `modifier_groups` correctly absent) and still passes.
- The new NEVER case drives the real end-to-end path: it seeds outlet 1 with an outlet-specific
  modifier group + option + product link (plus a tenant-wide group), creates an outlet via
  `POST /api/outlets` with `copy_from_outlet_id`, and asserts **zero** modifier groups scoped to the
  new outlet and **zero** new rows across all three modifier tables (before/after totals identical) —
  proving new-outlet creation never touches the modifier tables.
- Full suite vs baseline: pinned command (`npx vitest run --reporter=json --no-file-parallelism
  --testTimeout=60000 --hookTimeout=120000`, `backend/` cwd; 2485 tests, 2411 passed) →
  `check-baseline.js` reports **GATE GREEN** (72 known-red @ `3b45f25c`, 72 fresh-red,
  **0 new / 0 changed**). In that full run the step12 settings file passed, including the new case.
  No regression.
- `node --check` clean on `outlet-copy.js` and the edited test file.

**D8 ledger closed:** **6 COPY** (5 shipped at Step 12 + `approval_policies` at Step 5) / **7 NEVER**
(6 ruled at Step 12 + `modifier_groups` here). No candidate remains unruled.
