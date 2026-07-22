# PLAN-V3 — Decisions Log

Owner-ruled decisions for the "remainder" wave (`feat/v3-remainder`). One section per
gated ruling. Investigation is filed first; the owner ruling and the executed branch are
recorded underneath.

---

## Step 4 — Dead portal `wallet` tab: WIRE-vs-RETIRE

**Status:** ✅ RULED **RETIRE** + EXECUTED (2026-07-22, `feat/v3-remainder`, committed locally, not pushed)
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

**Deliberately left as-is (out of the wallet-*tab* scope), now a documented follow-up:**
The webhook wallet-crediting block (`backend/routes/webhooks.js:478-500`, "Context 5") and the admin
staff-side link `POST /api/customers/:id/wallet/topup-link` (`customers.js:843`) remain. Both are still
broken by **Bug A** (no persisted session row → `resolveTenantDbForGatewayRef` returns null → 404 before
Context 5 runs) — i.e. the admin online top-up link is dead too. The synchronous staff top-up
`POST /api/customers/:id/wallet/topup` and the POS Wallet tender are unaffected and remain fully
functional. **Follow-up:** either wire a persisted wallet-topup session (table + tenant-resolver entry +
regex/reference reconciliation) to make the admin online link work, or retire the admin link + Context 5
too. Tracked here; not part of Step 4.

**Verification:**
- `npx vitest run tests/unit/frontend-coverage-drift.test.js tests/unit/portal-presets.test.js tests/unit/industry-config.test.js` → **41 passed**. The drift guard's hard check (no NEW orphan beyond baseline) passes: the two portal endpoints were never in the baseline (PortalWallet.jsx was their caller), and deleting caller + endpoints together adds no orphan. The admin `topup-link` baseline entry is untouched and still matches a live route.
- `vite build` → **✓ built in ~31s**, no dead-import error, no `PortalWallet` chunk emitted.
- `node --check` on both edited backend files → clean.
- Grep sweep confirms no remaining `PortalWallet` / `me/wallet` / `top-up-intent` reference in live code (only the out-of-scope webhook/admin paths + planning docs remain).

Browser check intentionally skipped: RETIRE is a pure removal (the URL now falls through to the SPA
catch-all) with nothing new to render — the build + drift test + grep are the proof of a clean deletion.
