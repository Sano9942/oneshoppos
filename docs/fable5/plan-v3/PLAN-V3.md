# Plan V3 — Public-Surface & v2-Deferral Remediation

> One plan covering **both** source lists: the config/security + product/correctness findings in
> `docs/fable5/public-surface-audit/REPORT.md` (as amended by its 2026-07-16 resolution banners),
> and the v2 items that were explicitly parked for v3 in
> `docs/fable5/business-modules/PLAN-V2.md` (Deferred-to-v3 table ~line 1323 + audit-disposition
> table ~line 1339). They overlap — E9 and E3 are public-surface items wearing v2 labels — which is
> exactly why this is one plan and not two.
>
> **Scope was owner-ruled 2026-07-16 and is closed.** This plan does not widen, narrow, or
> re-litigate it. Every item from both source docs lands in exactly one place — a step, an explicit
> OUT, or a Deferred-to-v4 row — and the final verify step (Step V) walks the completeness table and
> fails on anything unaccounted (the same completeness-contract pattern PLAN-V2 used).
>
> **Planning session: 2026-07-16. Migration head: v137.** Both source docs were written against
> working tree `8ea54848`; every file:line below was **re-grepped against current source on
> 2026-07-16** before being encoded into a step (§"Corrections to the source docs" lists what moved).
> **V3 ships ZERO migrations** — every change is code, config, docs, or ops. That is a deliberate
> property: each gate is a code-only deploy with no schema mutation to reason about. If any step
> finds it needs a migration, STOP and report — it means a step is mis-scoped.
>
> **Guiding rules (carried from v2):** branch + commit locally, never push/merge/PR without an
> owner-gated go; local Postgres (`backend/.env.test` / `sanopos_dev`) only for tests/migrations,
> NEVER prod; Supabase read-only for investigation; verify against code not docs; audit ALL call
> paths when touching a shared concern (tax/stock/auth/discount — "POS fixed, storefront broken"
> recurs); any new flag → `config/business-modules.js`, any new permission → `permissions-catalog.js`
> (CI enforces both); UI uses `ui/primitives` + `--ui-*` tokens, light-only, no dark mode; backend
> integration tests run from `backend/` cwd.
>
> **Release-splitting rule (the core structural discipline):** two changes that alter refusal
> behaviour on *authenticated* requests must not ship in one deploy — otherwise operations can't tell
> "which gate 403'd?" This is what earned D5 its own release in v2. **4.3 (manufacturer scope check,
> runs on every authenticated request via `loadTenantAndPerms`) and E9 (restaurant company gate) each
> get their own wave and their own deploy.**

---

## Progress tracker

| Step | Title | Wave | Pause? | Status |
|---|---|---|---|---|
| 0 | Reconcile tree + commit plan & amended source docs + capture exact test baseline (to main) | — | — | ✅ `42642323` (docs) + `ec3e6eaf` (baseline artifact + `check-baseline.js` gate) |
| W0a | 4.1 delete `ADMIN_ALLOWED_IPS` (commit 1) + 4.5 in-memory-state docs (commit 2) | 0 | **before** (security → main) | ☑ `b7de8255` + `6434a12a` |
| W0a2 | 4.2 webhook signature verification — provider-specific contracts (commit 3) | 0 | — | ☑ `a4a65655` — **Meta/WhatsApp only; Daraz split → V4-3** (owner-ruled 2026-07-16, see §W0a2 outcome) |
| W0b | Frontend correctness: POSContext session-expired flow + KDS chrome escape | 0 | — | ☑ `45cf66bb` — both park branches (`draft_orders` **and** `parked_sales`) browser-verified; see §W0b outcome |
| W0c | OG social-preview middleware (brand bucket only, deny-list-first) | 0 | — | ☑ `7309cf5f` — see §W0c outcome |
| W0d | The two invariant guard tests (base-perm reach + single `x-outlet-id` reader) | 0 | — | ☑ `8ee9ab1a` — see §W0d outcome |
| W0-ops | 4.4 R2 custom domain + `R2_PUBLIC_URL` (owner ops, no commit) | 0 | **owner-executed** | ☐ |
| — | **GATE 0 — merge Wave 0 to `main`** | 0 | **owner-gated** | ☑ DEPLOYED `57be9133` (2026-07-22) — see banner |
| 1 | 4.3 — `MANUFACTURER_PORTAL_JWT_SECRET` set + scope check in `loadTenantAndPerms` | A (own release) | **before** (every-request auth) | ☑ `65d4f9bc` |
| — | **GATE 1 — merge + deploy Release A** | A | **owner-gated** | ☑ DEPLOYED `09fa5e63` (2026-07-22) — see banner |
| 2 | E9 — AND company `restaurant` flag into `kioskOrderingOff` + stale-token test | B (own release) | **if surprised** | ☑ `cc6a2360` |
| — | **GATE 2 — merge + deploy Release B** | B | **owner-gated** | ☑ DEPLOYED `55e08170` (2026-07-22) — see banner |
| 3 | E5 — setup checklists for the 7 uncovered Bucket A cards | 3 | — | ☑ `846e3e42` |
| 4 | Dead portal `wallet` tab — WIRE-vs-RETIRE ruling | 3 | **mid-step** (owner rules) | ☑ RETIRE `15c65b5d` + `6c8164ad` |
| 5 | `approval_policies` copy-on-new-outlet — investigate → ruling | 3 | **mid-step** (owner rules) | ☑ COPY `86648120` |
| 6 | E6 — `modifier_groups` in the D8 copy allowlist — scope → ruling | 3 | **mid-step** (owner rules) | ☑ NEVER `7ba816c4` |
| — | **GATE 3 — merge + deploy Wave 3** | 3 | **owner-gated** | ☑ DEPLOYED `4226f1af` (2026-07-23) — see banner |
| V | End-to-end verification + completeness-ledger walk | — | **after** (owner reviews) | ☑ `VERIFICATION-V3.md` filed 2026-07-23 — GATE GREEN, VERDICT **SHIP**; **owner-reviewed + accepted 2026-07-25 → PLAN-V3 CLOSED** (only owner-ops W0-ops 4.4 stays open by design) |

Status: `☐ not started` / `◐ in progress` / `☑ done (verified)`. Update at the start and end of every session.

> **PLAN-V3 is CLOSED (2026-07-25).** Step V's verification was reviewed and accepted by the owner.
> Every code/config/docs step is verified done; the sole carried-forward item is the owner-ops
> **W0-ops (4.4, R2 custom domain)**, deliberately left `☐` — it is not env-only (setting
> `R2_PUBLIC_URL` un-mounts the `/r2` proxy and a public bucket domain would expose backups/PHI),
> so it must be re-scoped before execution. The Deferred-to-v4 list below (E1–E4, E7, E8, V4-1…V4-4)
> carries forward unchanged; **V4-3/V4-4 remain trigger-gated on the first tenant activating a
> channel integration**, not on a date.

**Commit policy:** approving this plan pre-authorises **local commits** to each wave's branch at the
end of each verified step. Pushes, merges, deploys, PRs stay owner-gated (the four Gates).

**Gate protocol** (every gate): (1) `/code-review` the slice diff — fix or justify; (2) run the
slice's named verification subset + full backend suite diffed against the **Step 0 baseline artifact**
(`baseline-tests.json`), failing on any new/changed test not on total count;
(3) update the affected CLAUDE.md for the slice; (4) STOP — owner gives explicit go; (5) merge to
main, watch Railway + Vercel, run the slice's post-deploy live check (read-only on real tenants);
(6) branch the next wave off the newly-merged main. **Every gate ends with a ledger walk** against
the completeness table below — an unaccounted item fails the gate.

**Branch-per-wave:** each wave branches off the current merged main and merges at its gate before the
next branches. This mirrors Wave 0's dodge-the-lost-fix pattern (memory
`feedback_consolidation_lost_fix` — it happened TWICE in v2, both recovered) and keeps each
own-release deploy isolated. Branch names: `fix/v3-wave0`, `fix/v3-manufacturer-scope`,
`fix/v3-restaurant-company-gate`, `feat/v3-remainder`.

**Model key:** `claude-fable-5` throughout. Effort calibrated by blast radius per step, not
uniformly — `sonnet`/low for docs and one-liners, `high`/`xhigh` for auth-surface and edge-runtime
work. If Fable capacity is unavailable and a step must run on Opus 4.8, raise the listed effort one
level (xhigh stays xhigh + a mandatory self-review of the diff before commit).

---

## Step 0 — Reconcile the tree, commit the plan + amended docs, capture the exact test baseline

The first wave needs a genuinely clean tree, and "commit only the plan" does not produce one — as of
2026-07-16 the working tree also carries **modified** `docs/fable5/public-surface-audit/REPORT.md`
and `docs/fable5/public-surface-audit/GLOBAL-READINESS.md` (the authoritative 2026-07-16 resolution
banners this plan depends on). Committing only `PLAN-V3.md` leaves those two staged-in-limbo and
drags them into every branch this plan creates.

Two actions, both to `main`, docs-only, no code:
1. **Reconcile + commit the docs.** Commit `PLAN-V3.md` **together with** the amended `REPORT.md`
   and `GLOBAL-READINESS.md` (they are part of the same public-surface-audit effort and their
   banners are load-bearing for this plan). Confirm `git status` is clean afterwards — no stray
   modified/untracked files — before Wave 0 branches.
2. **Capture an exact test-baseline artifact.** A "~57 failures" *count* is not a safe regression
   gate — one pre-existing failure can vanish while a new one appears and the total is unchanged.
   Run the full backend suite once (from `backend/` cwd) with a machine-readable reporter and save
   the result as `docs/fable5/plan-v3/baseline-tests.json` (test identity + failure signature per
   failing test). **Every gate diffs against this artifact by test id and fails on any NEW or
   CHANGED failure, not on a higher total.** Note the known-red set explicitly (pg-batch2/3/8 ~12
   sales-need-open-shift failures; `smoke-gate.test.js` — do not investigate). This artifact
   replaces the "~57 baseline" language everywhere below.

> **DONE 2026-07-16** — `42642323` (docs) + `ec3e6eaf` (baseline). Every "diff against
> baseline-tests.json" below is **executable**, not prose: from `backend/` cwd run the artifact's
> exact `run.command`, then `node ../docs/fable5/plan-v3/check-baseline.js <report.json>` (exit 0 =
> green, 1 = new/changed). **Reuse `run.command` verbatim** — `--no-file-parallelism` is load-bearing;
> concurrent vitest emits environmental hook-timeouts that poison the diff in both directions.
> Actual baseline @ `42642323`: **70 failing entries — 31 test-level + 39 file-level** (load/hook
> crashes report zero failing tests yet are still red). Two corrections to this plan's assumptions:
> (a) the known-red set is **larger and different** than "pg-batch2/3/8 + smoke-gate" — the biggest
> family is **37 legacy pre-Postgres suites** whose helpers (`createTestApp`, `master-db`,
> `schema-full`) are verified absent, so they cannot run and carry zero signal; (b) **17 entries match
> no documented family** and are flagged `other` for triage — several are explained by
> [[followup_main_integration_baseline]] (`503`-vs-`403` `requireFeature` drift, open-shift fixture
> cascades, env-sensitive `payment-gateway`/worker-status units), none by this plan. The gate was
> verified against injected NEW and CHANGED regressions that both sat at **70-vs-70 identical
> totals** — a count-based check would have passed both.

---

# WAVE 0 — Independent fixes into the V3 baseline (→ main, before any feature wave)

> Wave 0 exists for the same reason v2's did: these are independent of every feature item, several
> are live-or-latent security holes, and none should queue behind a later gate. They ship to `main`
> first so every subsequent wave branches off a baseline that already contains them — no merge
> headache, no lost-fix risk. **Per-item placement is justified in each step.** The two own-release
> items (4.3, E9) are deliberately NOT here — they change authenticated-request refusal behaviour and
> must deploy alone.

## Step W0a — 4.1 delete `ADMIN_ALLOWED_IPS` + 4.5 in-memory-state docs (two atomic commits)

> Webhook hardening (4.2) is **not** here — it moved to its own step W0a2 (its verification contract
> is provider-specific, not a shared concern with admin-allowlist removal, and separating them makes
> review and rollback safer). W0a is two atomic commits: (1) the allowlist removal, (2) the docs.

- **Goal:**
  1. **4.1 — DELETE `ADMIN_ALLOWED_IPS` entirely** (REPORT §4.1; ruling = ai-platform-strategy D3 +
     D4). It currently fails **open**: `backend/routes/admin/helpers.js:41-42` returns `next()` when
     the var is unset (it is unset on Railway), so the allowlist is inert in production while
     `backend/index.js:308` `console.error`s about it on every boot. The fix is **removal, not
     configuration** — do NOT set the var. Delete `parseAllowedIps` + `createRequireAllowedIp` from
     `helpers.js` (helpers.js:31, :40, and the `parseAllowedIps` export ~:113); delete the
     `requireAllowedIp` construction + deps-passing in `admin/index.js:41,48`; remove the
     `requireAllowedIp,` argument from the destructure **and** every route registration in all admin
     route files (`auth.js`, `billing.js`, `compliance.js`, `tenants.js`, `system.js`,
     `operations.js`, `monitoring.js`, `module-locks.js`, `messaging.js` — grep
     `requireAllowedIp` for the authoritative list, it is ~15 files); delete the `index.js:308` boot
     warning block. TOTP + `requireSuperAdmin` remain the `/admin` gate (D4: no SSO, revisit on first
     admin hire). A missed call site crashes boot immediately (`requireAllowedIp is not a function`),
     so the removal is self-checking — but sweep with grep, don't eyeball. **Commit 1.**
  2. **4.5 — In-memory process state: DOCUMENTATION ONLY, no code** (REPORT §4.5). Record the
     enumerated list as an explicit horizontal-scaling precondition in `backend/CLAUDE.md`: the
     `displayStore` cart Map (`routes/customer-display.js:13`), the alerting sliding windows +
     tenant Sets (`services/alerting.js:16`), the menu-schedule per-outlet cache
     (`services/menu-schedule-resolver.js:12`), **plus** the middleware flag/mode/company caches
     (`feature-flags.js` `_getBundle` 60s cache, `getModesMap` 60s cache; `tenant-auth.js`
     `COMPANY_CACHE_MS` + `CONTEXT_FLAG_CACHE_MS`; `outlet-context.js` `_outletCache`). All correct
     at one Railway instance; all fail **quietly** (wrong answers, no error) at two. State it as a
     precondition, not a bug. **Commit 2.**
- **Touches:** `backend/routes/admin/helpers.js`, `admin/index.js`, all ~15 admin route files,
  `backend/index.js`, `backend/routes/admin/CLAUDE.md` (4.1); `backend/CLAUDE.md` (4.5); tests may
  keep passthrough `requireAllowedIp` stubs.
- **Model/effort:** `claude-fable-5 / high` — a wide (~15-file) mechanical sweep across the admin
  auth surface where a miss crashes boot. Not xhigh because the removal is self-checking.
- **Pause:** **YES, before starting** — security change destined for `main`.
- **Verify:** grep `requireAllowedIp` / `ADMIN_ALLOWED_IPS` / `parseAllowedIps` returns zero
  production hits (note any test passthrough stubs left in place); `node backend/index.js` boots
  clean with no `[SECURITY]` allowlist line; an admin login still works end-to-end (TOTP path intact)
  on `sanopos_dev`; `backend/CLAUDE.md` carries the enumerated cache list under a named
  "horizontal-scaling preconditions" heading. Full backend suite diffed against the **exact baseline
  artifact** (Step 0) — fail on any new/changed test, not on total count.
- **Done when:** ☐ `ADMIN_ALLOWED_IPS` fully removed + boot clean (commit 1); ☐ in-memory list
  documented (commit 2); ☐ no new/changed test failures vs the baseline artifact.

**Prompt:**
```
Effort: high. Model: claude-fable-5.

Why: the /admin IP allowlist fails OPEN in prod (env var unset → every request waved through) while
shouting a [SECURITY] warning every boot — owner ruled DELETE it, not configure it (TOTP is the
layer, D3/D4). Plus a docs-only note: several correct single-instance caches fail silently at 2+
instances.

Task: Branch fix/v3-wave0 off main. Per docs/fable5/plan-v3/PLAN-V3.md Step W0a. TWO ATOMIC COMMITS:
Commit 1 (4.1): DELETE ADMIN_ALLOWED_IPS entirely. Grep
requireAllowedIp/parseAllowedIps/ADMIN_ALLOWED_IPS for every site. Remove parseAllowedIps +
createRequireAllowedIp from routes/admin/helpers.js and its export; remove the requireAllowedIp
construction + deps in admin/index.js; remove the requireAllowedIp arg from the destructure AND every
route registration in every admin route file; delete the index.js:308 boot-warning block; update
routes/admin/CLAUDE.md. Keep requireSuperAdmin + TOTP untouched. Do NOT set the env var. Boot clean.
Commit 2 (4.5, DOCS ONLY): add a "horizontal-scaling preconditions" section to backend/CLAUDE.md
listing customer-display.js:13 displayStore, alerting.js:16 windows/tenant-Sets,
menu-schedule-resolver.js:12 cache, plus the middleware flag/mode/company caches (feature-flags.js
_getBundle + getModesMap, tenant-auth.js company + context-flag caches, outlet-context.js
_outletCache). Each correct at one instance, wrong (silently) at two.

Scope: exactly these two. Webhooks are W0a2, not here. No other REPORT items.
Autonomy: run fully; local PG tests from backend/ cwd; diff against docs/fable5/plan-v3/baseline-tests.json
(fail on new/changed tests, not total); boot the server locally to confirm no [SECURITY] line and
admin login works. Commit locally (two commits) when green. Do not push.
Report: outcome first — the requireAllowedIp removal file list, then the docs addition.
```

---

## Step W0a2 — 4.2 webhook signature verification (provider-specific contracts)

> Split from W0a on second-eye review: the aggregator verifier is **not** a verbatim drop-in for
> Meta/WhatsApp/Daraz. `services/aggregator-orders.js:106` computes a **base64** HMAC-SHA256 over the
> raw body, keyed on aggregator-specific signature headers + an optional platform timestamp. Meta and
> WhatsApp use their **own** contract (`x-hub-signature-256`, a **hex** `sha256=<digest>` over the raw
> body, keyed on the **app secret**); Daraz uses its own push contract (its ordinary API signing is
> parameter-based, which already proves one generic raw-body verifier is unsafe to assume). Reuse the
> aggregator's *shape* — verify-before-process, constant-time compare, fail-closed 401 + alert — not
> its exact algorithm.

- **Goal:** Signature-verify the three channel webhooks and close the `undefined === undefined`
  verify-token bypass, **with a provider-specific verification contract per channel**.
  - **The bypass** (REPORT §4.2, confirmed): `webhooks.js:598` (`token === process.env.META_WEBHOOK_VERIFY_TOKEN`)
    and its WhatsApp twin at `:666` — both env vars unset → right side `undefined`; omit
    `hub.verify_token` → left side `undefined` → the GET handshake returns 200 to anyone. Fix: the
    GET handshake must require a **set** verify token that actually matches — never compare `undefined`
    to `undefined`.
  - **POST verification, per provider** (POST handlers: `meta` :606, `whatsapp` :674, `daraz` :739,
    all currently `webhookLimiter`-only). For each, before processing:
    1. **Meta + WhatsApp** — verify `x-hub-signature-256`: `sha256=` + **hex** HMAC-SHA256 of the raw
       body keyed on the **Meta App Secret** (an app-level env secret, NOT per-tenant — so
       verification can run *before* tenant resolution). Constant-time compare, fail-closed 401.
    2. **Daraz** — implement against its **actual** push-notification signing contract (do NOT assume
       it matches Meta or the aggregator; read Daraz's push docs). Its secret is per-tenant
       (`integration_settings.webhook_secret`/`api_secret`, encrypted), so verification must resolve
       the tenant from the payload **first** (the aggregator's `resolveTenantForStore` pattern),
       decrypt the secret, then verify — preserving tenant resolution where the secret is
       tenant-specific.
    3. **Explicit secret-source table** per provider (env app-secret vs encrypted tenant secret) in
       the step's report.
    4. **Replay window only where a signed timestamp is actually sent** (Meta/WhatsApp/Daraz do not
       all send one — the aggregator's replay guard is conditional for exactly this reason). Where
       there's no signed timestamp, rely on signature verification + the existing event/order
       idempotency (Meta already does `ON CONFLICT` on `web_orders` + `facebook_order_map`).
    5. **Onboarding must collect + validate the secret before marking a connection active** — a
       channel `integration_settings` row saved without a verifiable secret must not be `is_active`
       (otherwise verification can't succeed when the webhook arrives). Add this guard to the
       credential-save path (`routes/integrations/credentials.js`).
  - **Exploitability (verified 2026-07-16 via Supabase, re-verify):** ZERO tenants have an *active*
    channel `integration_settings` row (only `tenant_livetest1` has one, `is_active=false`). So this
    is **hardening-before-anyone-connects**, not a live-fire fix — which is exactly why getting the
    per-provider contract *right* matters: a wrong signature format silently rejects the first real
    webhook a tenant ever sends. Ties to [[v03_food_service_open_gates]].
- **Touches:** `backend/routes/webhooks.js`, the alert helper the aggregator path already uses,
  `routes/integrations/credentials.js` (activation guard), `backend/routes/CLAUDE.md` (webhook
  verification split); tests.
- **Model/effort:** `claude-fable-5 / high` — external-facing crypto with three distinct contracts
  and a tenant-resolution-before-verify wrinkle for Daraz; a wrong format is a latent footgun.
- **Pause:** no (same wave, after W0a). **Commit 3 of Wave 0.**
- **Verify:** per provider — a correctly-signed POST (Meta/WhatsApp hex `x-hub-signature-256`; Daraz
  per its contract) → handled; an unsigned or wrong-signature POST → 401 + alert; the GET handshake
  with **no** `hub.verify_token` → NOT 200 (bypass closed), with a set+matching token → 200 echoes
  challenge; a channel row saved without a valid secret cannot be activated. Full suite vs the
  baseline artifact.
- **Done when:** ☐ three POST endpoints fail-closed on bad signature with the **correct per-provider
  format**; ☐ GET bypass closed; ☐ secret-source documented per provider; ☐ replay window applied
  only where a signed timestamp exists; ☐ activation blocked without a verifiable secret.

> **OUTCOME 2026-07-16 — `a4a65655`. Rescoped mid-step by owner ruling: 2 of 3 providers, not 3.**
> The step's STOP condition fired exactly as written ("if Daraz's push contract can't be pinned from
> docs, STOP and report rather than guessing a format") — it could not be pinned, so Daraz split to
> **V4-3** and the other three goals shipped. Done-when as delivered: ☑ **two** POST endpoints
> (meta/whatsapp) fail-closed with Meta's real format (`sha256=` + **hex** over the raw body — NOT the
> aggregator's base64, confirming the step's own warning was justified); ☑ GET bypass closed
> (live-verified 403 + `no_verify_token_configured`, with the old expression demonstrated returning
> `true`); ☑ secret source documented per provider (`routes/CLAUDE.md` table); ☑ **no** replay window —
> correct, not skipped: Meta sends no signed timestamp, which is precisely the conditional the step
> specified; ☑ activation guard (409 `WEBHOOK_SECRET_NOT_CONFIGURED`, before the insert).
>
> Three things a later reader needs:
> (a) **Two new deploy-critical env vars**: `META_APP_SECRET` (+ optional `WHATSAPP_APP_SECRET`).
> Unset → the activation guard refuses Meta channels. That is the intended safe failure, but it is
> also the exact [[feedback_worker_env_var_drift]] shape (code ships, var forgotten, feature silently
> never works) — set them at Gate 0.
> (b) **Verification ran before tenant resolution**, which is only sound because Meta signs with OUR
> app secret. The aggregator's inverse (per-tenant secret → route first) is not a stylistic
> difference; swapping the two orders breaks either key lookup or fail-closure.
> (c) **One existing test changed**: `pg-step2`'s "Administrator unaffected" used `whatsapp` as an
> incidental vehicle for a *permissions* assertion and began 409-ing on the new guard. Switched to
> `daraz` (as its whole block uses) to keep the permission concern isolated — the 409 was correct, the
> vehicle was not. The whatsapp path is covered both directions by
> `tests/unit/integrations-activation-guard.test.js`.
>
> Verification trap hit and worth remembering: the first "bypass closed" proof was a **false
> positive** — a stale `node index.js` still owned port 5000 and served the curls with the token
> **set**, so the 403 meant nothing. `pkill -f "node index.js"` did not kill it. The honest test
> requires asserting the port is **dead** (`curl` → `000`) *before* booting, and matching the pino pid
> in the log against the port owner. Same family as [[feedback_verifier_env_traps]].

**Prompt:**
```
Effort: high. Model: claude-fable-5.

Why: the meta/whatsapp/daraz webhooks have no signature check, and their GET verify handshake returns
200 to anyone (undefined === undefined bypass). Latent today (0 active channel configs, verified
2026-07-16) but a live hole the moment a tenant connects a channel — and getting the signature format
WRONG would silently reject that tenant's first real webhook. The aggregator verifier
(aggregator-orders.js:106) is base64 HMAC with aggregator headers — it is NOT a verbatim drop-in.

Task: On fix/v3-wave0 (after W0a), per docs/fable5/plan-v3/PLAN-V3.md Step W0a2 (commit 3 of Wave 0):
1. Fix the GET verify bypass at webhooks.js:598 and its WhatsApp twin :666 — require the verify token
   to be SET and to actually match; never compare undefined to undefined.
2. POST verification, per provider (reuse the aggregator's SHAPE — verify-before-process,
   constant-time compare, fail-closed 401 + alert — NOT its algorithm):
   - Meta + WhatsApp: x-hub-signature-256 = "sha256=" + HEX HMAC-SHA256 of the raw body keyed on the
     Meta App Secret (app-level env secret, so verify BEFORE tenant resolution).
   - Daraz: read Daraz's actual push-notification signing contract and implement it (do NOT assume
     Meta/aggregator format). Its secret is per-tenant (integration_settings, encrypted) — resolve
     the tenant from the payload first (aggregator's resolveTenantForStore pattern), decrypt, verify.
   - Apply a replay window ONLY where the provider sends a signed timestamp; otherwise rely on
     signature + existing idempotency (Meta's ON CONFLICT).
3. Onboarding guard: in routes/integrations/credentials.js, a channel row cannot be marked is_active
   without a collected + validated webhook secret.
4. Document the per-provider verification split + secret source (env app-secret vs encrypted tenant
   secret) in backend/routes/CLAUDE.md.

Scope: exactly the three webhook endpoints + the activation guard. No new channels.
Autonomy: run fully; local PG tests from backend/ cwd; test each provider's correct + wrong signature
and the GET bypass closed. Diff against baseline-tests.json. Commit locally (commit 3) when green.
Do not push. If Daraz's push contract can't be pinned from docs, STOP and report rather than guessing
a format.
Report: outcome first — a per-provider table (signature header, digest encoding, secret source,
replay-window y/n), then the before/after per route.
```

---

## Step W0b — Frontend correctness: POSContext session-expired flow + KDS chrome

> **Corrected on second-eye review.** The naive fix (just export `navigate`) does NOT work: the
> cashier is still authenticated (the modal never logs out), and `LoginPage.jsx:238` redirects
> authenticated users straight to `/context-select` — so they never land on `/login`, they land on
> `/context-select` with a dead token. And `parkSale()` (`POSContext.jsx:703-705`) **catches and
> suppresses** its own failure, so the modal can claim "Park sale & go to login," fail to park
> because the token expired, and navigate away anyway — losing the sale silently. The real fix is a
> proper sign-out flow, not a one-line export.

- **Goal:**
  1. **POSContext session-expired Cancel flow** (REPORT Part 5, corrected). The exported `value`
     object (`POSContext.jsx:963`) has no `navigate` key; `POSSessionExpiredModal.jsx:12` destructures
     it and `handleCancel` (:46-50) does `setSessionExpired(false)` → `await parkSale()` → `navigate()`.
     Three defects compound: `navigate` is `undefined` (throws); no `logout()`, so `isAuthenticated`
     stays true and `LoginPage`/`RequireAuth` bounce any nav to `/context-select`, not `/login`; and
     `parkSale()` swallows failure so a park that failed on the expired token still navigates away and
     drops the cart. **Fix, all in one edit:**
     - Make `parkSale()` (`POSContext.jsx:670`) return an explicit success/failure signal (e.g.
       `true`/`false` or throw) instead of swallowing into `setError`. **Audit its other callers**
       (F3 park, checkout park, wherever `parkSale` is invoked) — they currently ignore the return,
       so adding one is backward-safe, but confirm none relies on the always-resolves-void behaviour.
     - Export `navigate` on the `value` object and update the "WAVE-C SNAPSHOT" key-list comment
       (`POSContext.jsx:26-27`) in the same edit.
     - Rewrite `POSSessionExpiredModal.handleCancel`: `await parkSale()`; if it **failed**, stay in
       the modal and show the error (do NOT navigate — the sale isn't safe yet); if it **succeeded**,
       call `logout()` (clears `isAuthenticated` via `setSession(null)`, `AuthProvider.jsx:179`) and
       **then** `navigate("/login", { replace: true })` — now that the session is cleared, `LoginPage`
       renders login instead of redirecting to `/context-select`.
     - (`POSLockScreen.jsx:13` also reads `navigate`; its "Sign out completely" button already awaits
       `logout()` first, so exporting `navigate` fixes it too — verify it still works.)
  2. **KDS renders full merchant chrome** (REPORT Part 2). `/kds` is the ONLY device screen mounted
     in `appRoutes.jsx:284` (`<Route path="/kds" element={perm("manage_kds", wrap(KDSRoute))} />`)
     under the `RequireAuth > RequireContext > AppLayoutRedesign` parent, so a wall-mounted kitchen
     screen shows the nav sidebar, top bar, breadcrumbs, `SupportWidget`, and banners. Every other
     device screen escapes `AppLayoutRedesign` (they live in `publicRoutes.jsx`). And `/kds` is absent
     from the Breadcrumbs skip list (`ui/Breadcrumbs.jsx:103`). Move `/kds` to the escaped-shell
     pattern the other device screens use — **preserving its auth + `manage_kds` perm gate + outlet
     context** (a KDS station still needs a real session and an outlet; it is not public like
     `/customer-display`). Add `/kds` to the Breadcrumbs `SKIP` array as belt-and-suspenders.
- **Touches:** `frontend/src/pages/redesign/pos/POSContext.jsx`, `frontend/src/routes/appRoutes.jsx`
  (+ `publicRoutes.jsx` if KDS moves there), `frontend/src/ui/Breadcrumbs.jsx`, and the KDS route
  wrapper / a small shell-escape wrapper; `frontend/src/pages/redesign/pos/CLAUDE.md` (the `navigate`
  gotcha is documented there — flip it to "fixed"), `frontend/src/routes/CLAUDE.md` (KDS mount).
- **Model/effort:** `claude-fable-5 / high` (raised from medium on review) — the session-expired
  flow is a real correctness fix touching `parkSale`'s contract (audit its callers) plus a sign-out
  sequence, not a one-liner; the KDS move has real judgment (escape the layout while keeping
  `manage_kds` + `RequireContext`), and getting the guard wrong either exposes KDS unauthenticated or
  keeps the chrome.
- **Pause:** no (same branch, after W0a2).
- **Verify:** browser (local dev server): (a) trigger a mid-checkout session expiry, hit "Park sale
  & go to login" — on a **successful** park, the cart is actually persisted (confirm the parked-sale
  row exists), the local session is cleared (`isAuthenticated` false), and `/login` **stays visible**
  (does NOT bounce to `/context-select`); (b) simulate a **failed** park (e.g. force the park request
  to 401) — the modal **stays open** and shows the error, and no navigation happens, no cart loss;
  (c) `/kds` renders as a bare ticket grid with **no** sidebar / top bar / breadcrumbs / SupportWidget
  / banners, while an unauthenticated hit on `/kds` still redirects to login and a role lacking
  `manage_kds` still 403s/redirects. Frontend unit tests green.
- **Done when:** ☐ `parkSale` returns success/failure + callers audited; ☐ Cancel stays in modal on
  park failure, and on success logs out then reaches `/login` (verified persisted-cart + cleared-session
  + login-visible); ☐ `navigate` exported + comment updated; ☐ `/kds` on the escaped shell with
  auth+perm intact both directions; ☐ pos/CLAUDE.md + routes/CLAUDE.md updated.

**Prompt:**
```
Effort: high. Model: claude-fable-5.

Why: two frontend defects from the public-surface audit. (1) The POS session-expired modal's Cancel
button is broken three ways: navigate() is undefined (throws); it never logs out, so the cashier
stays authenticated and LoginPage.jsx:238 bounces any nav to /context-select instead of /login; and
parkSale() (POSContext.jsx:703-705) swallows its own failure, so the modal can fail to park on the
expired token and navigate away anyway, losing the sale. (2) KDS is the only device screen rendering
the full merchant chrome; a wall-mounted kitchen screen should be a bare ticket grid.

Task: On fix/v3-wave0 (after W0a2), per docs/fable5/plan-v3/PLAN-V3.md Step W0b:
1. POSContext.jsx — make parkSale() (:670) return an explicit success/failure signal instead of
   swallowing into setError. Audit every parkSale caller (F3 park, checkout park, etc.) — they ignore
   the return today so adding one is backward-safe, but confirm. Add `navigate` to the exported value
   object (:963) and update the WAVE-C SNAPSHOT key-list comment (:26-27), same edit.
2. POSSessionExpiredModal.handleCancel — await parkSale(); on FAILURE, stay in the modal and show the
   error (do NOT navigate — the sale isn't safe); on SUCCESS, call logout() (clears isAuthenticated,
   AuthProvider.jsx:179) THEN navigate("/login", { replace: true }) — now login renders instead of
   redirecting to /context-select. Flip the "navigate gotcha" note in pos/CLAUDE.md to fixed. Verify
   POSLockScreen's "Sign out completely" still works (it already logs out first).
3. Move /kds (appRoutes.jsx:284) off AppLayoutRedesign onto the escaped-shell pattern the other
   device screens use (see publicRoutes.jsx for customer-display/kiosk), KEEPING auth + the
   manage_kds perm gate + outlet context — KDS is not public. Add "/kds" to the Breadcrumbs SKIP
   array (ui/Breadcrumbs.jsx:103). Update routes/CLAUDE.md.

Scope: exactly these two. No backend changes. No other device screens touched.
Autonomy: run the dev server via the preview tools; verify BOTH park-success (cart persisted, session
cleared, /login stays visible) and park-failure (modal stays, no nav, no cart loss) paths, plus /kds
bare chrome + auth/perm both directions; screenshots. Frontend unit tests. Commit locally when
verified. Do not push.
Report: outcome first — the session-expired both-paths evidence + a KDS before/after screenshot, then
the parkSale caller audit.
```

### §W0b outcome (done `45cf66bb`, 2026-07-16)

No owner ruling arose. Recording only what the commit and the code docs don't already carry:

- **"Verify the parked-sale row exists" is ambiguous — park has TWO destinations.** `parkSale`
  branches on `posFlags.phase2_draft_orders`: on → `draft_orders`, off → `parked_sales`. The verify
  step named only the latter, and the first check ran against an *empty* `parked_sales` — which is
  indistinguishable from "the fix reports success but persists nothing," i.e. exactly the bug under
  repair. Check the flag before trusting the table. **Both branches are now verified** (draft_orders
  first, then `parked_sales` after toggling the module off), so `parkSale`'s new boolean contract
  rests on evidence for both paths, not a structural argument for the second.
- **The flag was flipped through `/settings/business-modules`, not SQL** — `phase2_draft_orders` is
  the primary flag of the catalog-managed **Draft Orders** card, so `PUT /api/feature-flags/:key`
  409s it and a hand-written `UPDATE` would desync `tenant_business_modules` + skip the `saved_flags`
  snapshot. Toggling via the UI produced the correct engine state (row created `enabled=false`,
  `saved_flags={phase2_draft_orders:true}`, `updated_by=Owner`; restored + snapshot cleared to `null`
  on re-enable). **For any future step that needs a module flag flipped, use the product surface.**
- **The step's Breadcrumbs SKIP entry is inert, deliberately kept.** Once `/kds` leaves
  `AppLayoutRedesign`, `Breadcrumbs` never mounts there at all — the SKIP entry does no work today.
  Kept as a guard if the route is ever moved back under the shell; noted in `ui/CLAUDE.md` so it
  isn't later mistaken for the mechanism doing the work.
- **Verification-tooling note (not a plan issue):** the in-app browser's `screenshot` action times
  out environment-wide — reproduced on a static `/login` with no polling, while clicks and
  `read_page` worked on the same tab. The Playwright MCP screenshots fine and produced the
  before/after. Reach for Playwright for any future step whose verify list names a screenshot.

---

## Step W0c — OG social-preview middleware (brand bucket only)

- **Goal:** Every shareable tenant link currently serves the static `index.html` and previews as a
  SanoPOS ad (`Seo.jsx` sets tags client-side; social crawlers don't run JS; `prerender-meta.mjs:24`
  only covers the 13 marketing routes). Add a **Vercel Edge Middleware** (`frontend/middleware.js` —
  no `middleware.js` exists today, and `frontend/` is the Vercel root, so that's where it goes) that,
  **for crawler User-Agents only**, resolves the tenant slug from the path/query, fetches branding
  from the existing no-auth `GET /api/storefront/config` (or `/api/portal/config`), and stamps
  `og:title`/`og:description`/`og:image` into the served shell — reusing `prerender-meta.mjs`'s
  `rewrite()` string-replace verbatim. UA-gate it so a real browser never triggers an API round-trip
  (real browsers get `Seo.jsx`'s client behaviour; the crawler is the only consumer of static OG tags).
  - **Owner-ruled route split (privacy-first — broadcast links vs one-to-one links):**
    - **BRAND a preview:** `/store`, `/book`, `/book-room`, `/reserve`, `/menu`, `/inquire`.
    - **GENERIC OR NO PREVIEW:** `/receipt`, `/portal`, `/gift-card`, `/pay`. Rationale to preserve
      in the code comment: `/receipt` is forwarded on WhatsApp today (the POS receipt modal ships a
      `wa.me` share link) and WhatsApp caches previews server-side, so a receipt preview must never
      carry items/totals; `/gift-card/:code` is a bearer secret — a preview would leak the balance
      and make crawlers hit the balance endpoint.
  - **MANDATORY implementation rule: deny-list first, allow-list second.** Never a loose `/portal/*`
    prefix match — a deep link like `/portal/:slug/invoices/:id` must not inherit a preview. Match the
    no-preview set first and bail; then match the exact brand set.
  - **v1 image:** use `logo_url` with an `og-default.png` fallback (Facebook drops images under
    200×200, so a square logo may preview poorly — acceptable for v1; a correct title+description
    alone fixes most of the embarrassment). The generated 1200×630 card (Vercel OG / satori) is
    **explicitly OUT** — Deferred to v4.
  - **Slug availability (verified 2026-07-16, was REPORT-unverified):** ALL six brand routes carry
    the slug with **no DB lookup needed** — `/store`, `/book`, `/book-room`, `/reserve`, `/inquire`
    as path params; `/menu/:token` carries `?tenant=<slug>` (built by `OrderKiosksRedesign.jsx:36`).
    So the whole brand bucket is cheap. (For completeness: `/gift-card` carries `?tenant=`
    (`GiftCardBalancePage.jsx:17`) and `/pay`'s QR does **not** (`pay-at-table.js:130` omits it) — but
    both are no-preview, so it doesn't affect this step.)
  - **Implementation spec (added on second-eye review — do not skip any):**
    - **Matcher / recursion guard.** Configure the middleware `matcher` (or an early-return) to
      **exclude** static assets, `/index.html`, `/api/*`, and the middleware's **own** internal fetch
      to the branding endpoint — an unguarded fetch back through the middleware recurses. Only the six
      brand paths for a crawler UA ever do real work.
    - **Passthrough mechanism.** This is Vercel **Routing Middleware** at `frontend/middleware.js`
      (`frontend/` is the Vercel root; it supports any framework incl. Vite). Normal requests continue
      via the framework's passthrough (`next()` from `@vercel/functions` — **not currently a frontend
      dependency, add it**, or use the documented Response-passthrough form). Crawler requests fetch
      the **static shell** (`/index.html`) and rewrite its HTML via `prerender-meta.mjs`'s `rewrite()`.
    - **Backend base + fail-closed.** The middleware calls the branding endpoint at an explicit
      backend base (`APP_PUBLIC_BASE_URL` / the API origin — read it from an edge-visible env). On a
      branding-lookup **timeout or non-200, fail safe**: serve the untouched shell (generic SanoPOS
      metadata), never a broken/partial tag set. A cold-Railway timeout must not block the page.
    - **Descriptions are synthesized, not fetched.** `GET /api/storefront/config`
      (`routes/storefront.js:33`) returns `company_name` + `logo_url` — **no description field and no
      cache headers**. So `og:description` is a **generic per-route template** filled with the name
      (e.g. `/book` → "Book an appointment with {name}", `/store` → "Shop online at {name}",
      `/reserve` → "Reserve a table at {name}"). Define one template per brand route.
    - **Cache is best-effort per-isolate.** A module-level `Map` only caches within one edge isolate
      (Vercel spins many) — state that explicitly. Give it a **TTL** (e.g. 5–10 min), a **max size**
      (bounded, evict oldest), serve **stale on lookup failure**, and accept there is **no
      cross-isolate invalidation** (branding changes propagate within the TTL). This is fine because
      the crawler is the only consumer and freshness within minutes is ample.
    - **"No preview" = the generic SanoPOS shell.** Returning the untouched `index.html` for the
      deny-list routes means those links preview as the **generic SanoPOS card** (the default
      `og-default.png` + tagline), which **leaks nothing tenant-specific** — that is the "generic"
      half of the owner's "generic OR no preview" ruling and is the accepted outcome. State this in
      the code comment so a future reader doesn't mistake it for a bug.
- **Touches:** `frontend/middleware.js` (new), `frontend/package.json` (add `@vercel/functions` if the
  passthrough needs it), `frontend/vercel.json` (only if edge config needs it), a small shared helper
  mirroring `prerender-meta.mjs`'s `rewrite()`; `frontend/CLAUDE.md` or `frontend/src/pages/CLAUDE.md`
  (document the new middleware + the deny-list-first rule + the best-effort cache caveat).
- **Model/effort:** `claude-fable-5 / high` — new edge-runtime surface that runs on every request
  (matcher-scoped, but a bug touches page loads), the privacy-critical deny-list ordering, and the
  recursion/fail-closed subtleties.
- **Pause:** no (privacy split is pre-ruled; no owner decision remains).
- **Verify:** **test via `vercel dev` or a preview deployment — `vite preview` / a local build does
  NOT execute Vercel Routing Middleware.** Then: hit a brand route with a crawler UA
  (`curl -A "facebookexternalhit/1.1"` / `Twitterbot` / `WhatsApp`) → response HTML carries the
  tenant's name + branded `og:*` tags, not the SanoPOS default; same route with a real-browser UA →
  unchanged static shell (no API call — the middleware short-circuits); `/receipt/:x`, `/portal/:slug`,
  `/portal/:slug/invoices/:id`, `/gift-card/:code`, `/pay/:token` with a crawler UA → **generic**
  SanoPOS shell, **no tenant-specific leak** (deny-list wins, deep path included); a forced
  branding-endpoint timeout → the brand route falls back to the untouched shell (fail-closed), not a
  broken page; confirm the middleware never fetches itself (no recursion in the logs).
- **Done when:** ☐ six brand routes preview branded for crawlers with synthesized descriptions;
  ☐ four no-preview routes serve the generic shell (deep-link included), leaking nothing; ☐ real
  browsers bypass entirely; ☐ recursion guarded + fail-closed on lookup timeout; ☐ verified via
  `vercel dev`/preview (not `vite preview`); ☐ docs updated incl. the best-effort-cache caveat.

**Prompt:**
```
Effort: high. Model: claude-fable-5.

Why: every shareable tenant link (storefront, booking page, QR menu, etc.) previews as a SanoPOS ad
on WhatsApp/Facebook because social crawlers don't run the client-side Seo.jsx, and the prerender
step only covers marketing routes. A shop sharing its own storefront markets us, not itself. Fix is
a UA-gated Vercel edge middleware that stamps the tenant's real name/logo into OG tags for crawlers —
but ONLY for broadcast links, never one-to-one links that would leak private data.

Task: On fix/v3-wave0 (after W0b), per docs/fable5/plan-v3/PLAN-V3.md Step W0c (read the full
implementation spec there — do not skip a bullet):
1. Create frontend/middleware.js (Vercel Routing Middleware; frontend/ is the Vercel root — no
   middleware.js exists yet). Configure the matcher/early-return to EXCLUDE static assets,
   /index.html, /api/*, and the middleware's own branding fetch (recursion guard). Gate real work on
   a crawler User-Agent (facebookexternalhit, Twitterbot, WhatsApp, Slackbot, LinkedInBot,
   Discordbot). Normal requests pass through via next() from @vercel/functions (add it to
   package.json if needed) or the documented passthrough.
2. DENY-LIST FIRST, ALLOW-LIST SECOND. Match /receipt, /portal, /gift-card, /pay first and return the
   UNTOUCHED shell (= generic SanoPOS metadata, leaks nothing) — never a loose /portal/* (a
   /portal/:slug/invoices/:id must inherit nothing). THEN match exactly /store, /book, /book-room,
   /reserve, /menu, /inquire.
3. For a matched brand route: resolve the slug (path param for all but /menu, which carries
   ?tenant=), fetch branding from GET /api/storefront/config at an explicit backend base
   (APP_PUBLIC_BASE_URL from an edge-visible env), fail-closed to the untouched shell on
   timeout/non-200. That endpoint returns company_name + logo_url only and NO description — so
   synthesize og:description from a generic per-route template + the name (define one template per
   brand route). Stamp og:title/og:description/og:image reusing prerender-meta.mjs's rewrite(). Use
   logo_url with an og-default.png fallback.
4. Cache the branding fetch in a module-level Map with a TTL (5-10 min), a bounded max size (evict
   oldest), serve-stale-on-failure — and DOCUMENT that it's best-effort per-isolate with no
   cross-isolate invalidation (fine: crawler-only consumer). Add a code comment explaining the
   privacy split (/receipt is wa.me-forwarded + WhatsApp caches previews; /gift-card is a bearer
   secret) AND that the deny-list "no preview" = the generic SanoPOS shell.
5. Document the middleware + deny-list-first rule + best-effort-cache caveat in the frontend CLAUDE.md.

Scope: brand bucket only. The generated 1200x630 OG card is OUT (v4). Do not touch Seo.jsx's client
behaviour or the marketing prerender.
Autonomy: test via `vercel dev` or a preview deploy (NOT `vite preview` / a plain local build — those
do not run Routing Middleware). Verify: branded output + synthesized description on all six brand
routes; generic-shell/no-leak on all four no-preview routes incl. a deep /portal path; real-browser
bypass; fail-closed on a forced branding timeout; no self-fetch recursion. Commit locally when
verified. Do not push.
Report: outcome first — a crawler-UA response snippet for one brand + one no-preview route, the
per-route description templates, then the cache design + its stated best-effort limits.
```

### §W0c outcome (done `7309cf5f`, verified at Gate 0)

No separate outcome was recorded when the commit landed; this closes that gap at the gate.

- **Static + code review confirmed the load-bearing behaviours:** deny-list-first with a path-boundary
  check (a deep link like `/portal/:slug/invoices/:id` cannot inherit a brand preview), the crawler-UA
  gate short-circuits real browsers before any network round-trip, recursion is guarded (the branding
  fetch is cross-origin and the shell fetch hits `/index.html`, which is outside the matcher), and it
  fails **closed** to the untouched generic shell on any branding miss/timeout, with HTML-escaped output.
- **The `${SITE}/og/default.png` fallback exists and matches the shipped `index.html`'s own `og:image`**
  — no 404 fallback. `@vercel/functions@^3.7.5` is declared; `stripImageDims` correctly drops the shell's
  hard-coded 1200×630 hints when a tenant logo of unknown size is used.
- **One cosmetic nit deliberately left for a follow-up (NOT fixed here, to keep the slice exactly as
  reviewed):** the fail-**closed** responses at `middleware.js:259,262` are labelled `x-og-mw:"fail-open"`
  / `"fail-open-shell"` — the names read backwards and `fail-open-shell` isn't in `frontend/CLAUDE.md`'s
  documented header set. Debug header only, zero functional impact.
- **Live `vercel dev`/preview crawler test was NOT run pre-merge** (impractical in the gate environment);
  its authoritative runtime check is Gate 0 post-deploy verification (d) — curl a brand route + a
  no-preview route with a crawler UA on production.

---

## Step W0d — The two invariant guard tests

- **Goal:** Two security boundaries whose correctness currently rests on a future session reading the
  right CLAUDE.md. Docs decay; tests don't. Add grep-based drift-guard unit tests, modelled on the
  existing `business-modules-catalog.test.js` / `permissions-catalog.test.js` /
  `frontend-coverage-drift.test.js` (all confirmed present in `backend/tests/unit/`). **Test-only,
  zero runtime change** — placed in Wave 0 baseline specifically so they guard every later wave that
  touches guards or outlets (E5, the copy rulings).
  1. **Invariant (1): outlet REACH keys on `req.baseEmployeePerms`; CAPABILITY keys on
     `req.employeePerms`.** A new outlet-scoping check that reaches for the familiar `req.employeePerms`
     would silently let a per-outlet role override widen outlet reach. **Two complementary tests
     (added on second-eye review — a file allowlist alone does NOT enforce the semantics: a wrong
     `employeePerms` check added *inside* an already-allowed file would pass it):**
     - **(1a) File-allowlist drift guard.** Only ~3 production files touch `baseEmployeePerms`
       (verified 2026-07-16: `middleware/tenant-auth.js`, `middleware/outlet-context.js`,
       `routes/registerAllRoutes.js`; the rest are tests + CLAUDE.md). Assert the set of production
       files performing an outlet-**reach**/assignment check is exactly that allowlist; fail if a new
       file joins. This catches the "4th file" case only.
     - **(1b) Behavioural test of the reach function.** Directly exercise the reach path
       (`outlet-context.js`'s `resolveRequestedOutlet` / `enforceOutletAssignment` — whichever owns
       the `skipAssignment` computation): construct a principal whose **base** perms lack `all_access`
       but whose **effective** (per-outlet override) perms carry it, and assert outlet **reach is
       still denied** (the override grants capability, never widens reach). This is what catches a
       wrong `employeePerms` read *inside* an allowed file — the behaviour changes even when the file
       set doesn't. Check whether `tenant-auth-effective-role.test.js` / `pg-step13-outlet-roles.test.js`
       already cover the reverse-override direction; add only the missing case.
  2. **Invariant (2): ONE reader of `x-outlet-id`.** `middleware/outlet-context.js:171` is the
     resolver; `middleware/tenant-auth.js:417` is the documented fallback for when the resolver isn't
     mounted (standalone/unit-test). Verified 2026-07-16: those are the only two production readers
     (all other `x-outlet-id` hits are tests). The test asserts the production reader set is exactly
     those two files and fails on a fourth. **The grep must be robust:** match bracket access
     (`req.headers["x-outlet-id"]`), dot access, `.get("x-outlet-id")`, and header-name aliases
     (case-insensitive), while **excluding comments and `tests/`** — an over-narrow grep gives false
     confidence, an over-broad one false-fails.
- **Touches:** new files under `backend/tests/unit/` (`outlet-reach-invariant.test.js` covering 1a+1b,
  `outlet-id-single-reader.test.js`); a one-line pointer in `backend/tests/CLAUDE.md`. **Each
  allowlist is an explicit named constant with a comment pointing at `backend/middleware/CLAUDE.md`**
  so the "why" is one hop away when the test fails.
- **Model/effort:** `claude-fable-5 / medium` — the risk is a drift guard too loose (misses a real
  violation) or too tight (false-fails on a benign match), plus the behavioural test must construct a
  real base-vs-effective divergence; the greps must be anchored on the actual read idiom, robust to
  bracket/dot/`.get()`/alias/comments, not the bare string.
- **Pause:** no.
- **Verify:** all three tests (1a, 1b, 2) pass on current `main`; then (a) inject a throwaway 4th
  `x-outlet-id` read in a scratch file → test 2 fails; (b) inject a throwaway outlet-reach check in a
  new file → test 1a fails; (c) inside an *already-allowed* file, temporarily swap a base-perm reach
  read to `employeePerms` → **test 1b fails** (proving the semantic guard, not just the file guard) →
  revert all. Confirm no false-fail on existing test files (scan production source only).
- **Done when:** ☐ 1a + 1b + 2 green on main; ☐ each proven to fail on its own injected violation
  (incl. the inside-an-allowed-file swap for 1b); ☐ greps robust to bracket/dot/`.get()`/alias/comment;
  ☐ tests/CLAUDE.md pointer added.

**Prompt:**
```
Effort: medium. Model: claude-fable-5.

Why: two security invariants are documented in middleware/CLAUDE.md but nothing enforces them. (1)
Outlet REACH must key on req.baseEmployeePerms, capability on req.employeePerms — a new check using
the familiar req.employeePerms would let a per-outlet role override silently widen outlet reach. (2)
Exactly two production files may read x-outlet-id (the resolver + a documented fallback) — a third
interpretation is how three existed before v2 Step 9. Docs decay; tests don't.

Task: On fix/v3-wave0 (after W0c), per docs/fable5/plan-v3/PLAN-V3.md Step W0d. Model on
business-modules-catalog.test.js / permissions-catalog.test.js (read one for house style):
1. outlet-reach-invariant.test.js — TWO parts, because a file allowlist alone doesn't enforce the
   semantics:
   (1a) File-allowlist drift guard: assert the set of production files performing an outlet
   reach/assignment check is exactly { middleware/tenant-auth.js, middleware/outlet-context.js,
   routes/registerAllRoutes.js }. Anchor on the assignment-enforcement idiom (baseEmployeePerms /
   enforceOutletAssignment / _isAssigned), not a bare string. Exclude tests/.
   (1b) Behavioural test: exercise the reach path (outlet-context.js resolveRequestedOutlet /
   enforceOutletAssignment — the skipAssignment computation). Construct a principal whose BASE perms
   lack all_access but whose EFFECTIVE (override) perms carry it, and assert outlet reach is STILL
   denied. First check whether tenant-auth-effective-role.test.js / pg-step13-outlet-roles.test.js
   already cover this reverse-override direction; add only the missing case.
2. outlet-id-single-reader.test.js — assert the production readers of x-outlet-id are exactly
   { middleware/outlet-context.js, middleware/tenant-auth.js }. Robust grep: match req.headers[...],
   dot access, .get("x-outlet-id"), case-insensitive aliases; EXCLUDE comments and tests/.
Encode each allowlist as a named constant with a comment pointing to backend/middleware/CLAUDE.md.
Add a one-line pointer in backend/tests/CLAUDE.md.

Scope: test files + one doc pointer. No production code changes.
Autonomy: run from backend/ cwd; prove each guard FAILS on its own injected violation — a 4th
x-outlet-id reader (test 2), a new reach-check file (1a), AND a base→employeePerms swap INSIDE an
already-allowed file (1b, the semantic case) — then revert. Commit locally when all green + proven.
Do not push.
Report: outcome first — 1a/1b/2 green, plus the injected-violation failure message for each incl. the
inside-an-allowed-file swap.
```

### §W0d outcome (done `8ee9ab1a`, verified at Gate 0)

No separate outcome was recorded when the commit landed; this closes that gap at the gate.

- **All three guards green on the branch, and each proven to bite.** 1a (reach-idiom file allowlist),
  1b (behavioural `enforceOutletAssignment` base-vs-effective pin with a passing control case), and
  test-2 (single `x-outlet-id` reader) all pass. A throwaway probe carrying both a foreign
  `x-outlet-id` read and a `baseEmployeePerms` reach idiom turned 1a + test-2 RED; deleting it returned
  all four to green — the injected-violation half of the verify list, satisfied at the gate.
- **1b's semantic bite is self-evident from its own control**, so no production-file swap was needed:
  the test denies reach for a principal whose BASE perms lack `all_access` but whose effective override
  perms carry it, and a sibling control case shows that flipping only the BASE perms to `all_access`
  switches deny→skip — proving the base-vs-effective read is the sole discriminator.

---

## Step W0-ops — 4.4: R2 custom domain + `R2_PUBLIC_URL` (owner ops, no commit)

> ⚠️ **Verification note (2026-07-22) — do NOT execute as an env-only change; two blockers found in code.** The "nothing to build / no backfill" framing below is wrong:
> 1. **Legacy image URLs will 404.** The `/r2/*key` proxy is mounted only `if (!process.env.R2_PUBLIC_URL)` (`index.js:154`), so setting the var *un-mounts* it on restart. `image_url` is a **stored** column written at upload time — old rows (`https://api.sanopos.com/r2/<key>`) do NOT recompute. Fix: either make the proxy mount unconditional (delete the guard at `index.js:154` — a small commit, so this step isn't truly "no code") **or** backfill `products.image_url` / company logos / `support_tickets.screenshots` across all tenant schemas.
> 2. **A public R2 custom domain exposes the WHOLE bucket** (`sanopos-uploads`), bypassing the backend's `PUBLIC_R2_PREFIXES` allowlist — publicly serving `backups/` (full pg_dumps of every tenant), `treatment-plans/` (clinical PHI), `reports/governance` exports, `field/` selfies, etc. Fix: a Cloudflare WAF **default-deny allowlist** on `cdn.sanopos.com` (block any path not under `/products/`, `/company/`, `/support/`) — write it as an allowlist so future private prefixes aren't silently exposed — **or** split public assets into a dedicated public bucket (code). Minimum-viable ops path = keep-proxy-mounted **+** WAF allowlist.
> Not gated by Gate 0 (see gate note) — safe to defer; re-scope before executing.

- **Goal:** `api.sanopos.com` is grey-cloud (verified `CNAME proxied=False`, REPORT §4.4) and
  `R2_PUBLIC_URL` is unset, so `backend/utils/r2.js:71` routes every product image / logo / support
  screenshot through the single Railway Node process via `/r2/<key>` (unthrottled — the proxy mounts
  before `globalLimiter`). **`r2.js:68` already prefers `R2_PUBLIC_URL`** — there is **nothing to
  build**. The fix is ops: point an R2 custom domain (e.g. `cdn.sanopos.com`) at the bucket and set
  `R2_PUBLIC_URL` on Railway. **Do NOT flip the Cloudflare orange cloud on `api.sanopos.com`** —
  `index.js:95` sets `trust proxy = 2` tuned for Railway's hop count, and an extra Cloudflare hop
  would silently break client-IP detection and therefore IP-based rate limiting.
- **Touches:** no code — Cloudflare R2 (custom domain binding), Railway env (`R2_PUBLIC_URL`).
  Orthogonal to the Wave 0 branch (no commit); can be applied before or after the Gate 0 merge.
- **Model/effort:** `claude-fable-5 / low` — no code; the plan documents the exact ops steps and the
  owner executes them (adding a DNS record / R2 binding + a prod env var are owner actions).
- **Pause:** **YES — owner-executed.** This is entering a production URL prefix that rewrites every
  asset URL; the owner does the DNS + env change.
- **Verify:** after the var is set and a backend restart, a freshly-uploaded product image returns an
  `image_url` under `https://cdn.sanopos.com/...` (not `api.sanopos.com/r2/...`); the image loads
  cross-origin; existing `/r2/*` URLs still resolve (backfill of old rows is not required — new URLs
  are computed at read/upload time by `r2.js`). Confirm `api.sanopos.com` stays grey-cloud (client-IP
  rate limiting intact).
- **Done when:** ☐ `cdn.sanopos.com` (or chosen host) bound to the bucket; ☐ `R2_PUBLIC_URL` set;
  ☐ new asset URLs bypass the backend; ☐ orange cloud NOT flipped on the API.

> No prompt — this is an owner ops action. The plan's role is to record the exact steps and the
> "do not flip the orange cloud" constraint so it isn't done wrong later.

---

## GATE 0 — Merge Wave 0 to `main`

> **✅ GATE 0 DEPLOYED 2026-07-22 — merged `57be9133`, prod green.** Owner gave the go; merged
> `fix/v3-wave0` (12 commits) into main via `--no-ff` and pushed (`741012ae..57be9133`, 16 commits incl.
> the 3 Step-0 docs foundation). **NO migrations.** Deploys: Vercel production READY on `57be9133`
> (`dpl_CAokpjjE…`); Railway backend healthy (deep health ok — db 59ms, resend 389ms), confirmed on the
> new code by the webhook behaviour below.
> **Pre-merge gate:** `/code-review` PASS (one cosmetic `x-og-mw` label nit deferred, §W0c); W0a–W0d
> verify subsets green; baseline diff GREEN after a proven-benign refresh (`3832365c` — the 3 flagged
> failures reproduce identically on pre-Wave-0 main, i.e. date drift, not a regression); frontend units
> 199/199; completeness ledger fully accounted, zero unaccounted.
> **Post-deploy live checks — all green:** (a) boot clean, no `[SECURITY]` line (removed by construction,
> healthy boot); (b) Meta + WhatsApp webhook GET handshakes now **403** without a set verify token (was
> 200 + challenge echo) and a bad-signature POST **401**s — fail-closed; (c) unauthenticated `/kds`
> redirects to login (auth enforced on the escaped shell, no merchant chrome leaked); (d) `/store/<slug>`
> crawler-UA → `x-og-mw: brand` stamping the tenant's real name, `/receipt` crawler-UA → `x-og-mw:
> no-preview` generic (no tenant leak), real-browser UA → `x-og-mw: bypass-ua`.
> **Owner follow-up (safe, deferred):** set `META_APP_SECRET` on Railway before connecting any Meta
> channel — still unset; 0 active channel configs, so nil impact today. **Release A may now branch off
> this merged main.**

Follow the Gate protocol. Slice verification subset: W0a + W0a2 + W0b + W0c + W0d verify lists +
baseline-artifact diff. **Deploy-day notes: NO migrations.** Behavioural changes at deploy: (a) `/admin` loses
the (already-inert) IP allowlist — zero functional change in prod since it was failing open, but the
boot warning disappears; (b) **two** webhook endpoints (meta + whatsapp — **not** daraz, split to V4-3)
now fail-closed on bad signatures, and their GET handshakes stop echoing the challenge to
unauthenticated callers — before deploy, note that 0 tenants have active channel configs (verified
2026-07-16), so blast radius is nil. **(b2) SET `META_APP_SECRET` ON RAILWAY AT THIS GATE** (plus
`WHATSAPP_APP_SECRET` if WhatsApp Business is a separate Meta app; it falls back to `META_APP_SECRET`
otherwise). Without it the W0a2 activation guard 409s any attempt to connect a Meta channel — the
intended safe failure, but it is silent until someone tries, which is the
[[feedback_worker_env_var_drift]] pattern; diff `railway variables` against the two names as part of
this gate rather than discovering it from a support ticket. Setting them changes no behaviour for the
0 existing configs. (c) `/kds` re-mounts on the escaped shell — post-deploy, load `/kds` on a restaurant `golv_*`
tenant and confirm bare chrome + auth still enforced; (d) the OG middleware goes live on Vercel —
post-deploy, curl a brand route and a no-preview route with a crawler UA on production. 4.4 (R2) is
an independent ops action, not gated by this merge. Owner go → merge `fix/v3-wave0`, watch Railway +
Vercel, run the live spot-checks, **walk the completeness ledger.** Release A branches only after
this gate.

---

# WAVE A (own release) — 4.3 Manufacturer portal scope hardening

## Step 1 — Set `MANUFACTURER_PORTAL_JWT_SECRET` + scope check in `loadTenantAndPerms`

- **Goal:** Two-part fix (REPORT §4.3), **its own release** because part (2) runs on **every
  authenticated request**. Today `MANUFACTURER_PORTAL_JWT_SECRET` is unset →
  `middleware/manufacturer-auth.js:26-33` falls back to `JWT_SECRET` (the same secret signing
  employee tokens) with a boot warning; and `middleware/tenant-auth.js:92` verifies with `JWT_SECRET`
  and **never checks `decoded.scope`** (`:95` sets `req.employee = { id: decoded.eid, role_id: decoded.rid }`
  straight away). It holds today only by accident — a manufacturer payload is `{ mid, tid, tslug,
  scope, jti }` with no `eid`, so `req.employee.id` = `undefined`, perms load empty, guarded routes
  403. **Residual:** `req.tenantId = decoded.tid` **does** get set from a manufacturer token, so
  tenant DB context attaches before anything notices — any route without a permission guard is
  reachable with a manufacturer token. **Three fixes:** (1) set the env var (ops — owner); (2) add a
  `scope` check to `loadTenantAndPerms` — reject any token whose `scope` is not the employee scope
  (`"full"`; `jwt-auth.js:23` signs employee access tokens with `scope: payload.scope || "full"`)
  **before** `req.tenantId`/`req.employee` are set; (3) **close the recurrence** (added on second-eye
  review) — setting the env var fixes today, but `manufacturer-auth.js:26-33` will still silently fall
  back to `JWT_SECRET` → `dev-insecure-secret` in any future environment that forgets it, so the same
  config error recurs.
  - **PERMISSION_RULES audit (mandatory — it's live blanket middleware):** the scope rejection lands
    in `loadTenantAndPerms`, which runs before `PERMISSION_RULES`. Confirm the rejection returns a
    clean 401 for a wrong-scope token and does NOT change behaviour for a normal employee token
    (scope `"full"`) or an impersonation token (verify its scope value — read `jwt-auth.js` and the
    impersonation mint path before assuming; if impersonation tokens carry a different scope, the
    check must allowlist it, not break impersonation).
  - **Durable recurrence guard (relaxes the "no portal-auth changes" fence for exactly this):** add a
    **production boot assertion** — in production, `MANUFACTURER_PORTAL_JWT_SECRET` must be **set**,
    must **differ from `JWT_SECRET`**, and meet a minimum length/entropy bar; else **throw and kill
    boot** (the `ensureCriticalRoutesRegistered` posture, NOT the `console.error`-and-continue posture
    we delete in 4.1 — this is the inverse of that flaw). **Remove the production fallback** in
    `manufacturer-auth.js:getSecret()`, keeping a clearly-labelled dev/test fallback gated on
    non-production only. Note that rotating this secret invalidates existing manufacturer sessions
    (acceptable — the portal has a refresh/re-login path).
- **Touches:** `backend/middleware/tenant-auth.js` (scope check); `backend/middleware/manufacturer-auth.js`
  (remove the prod fallback in `getSecret`); `backend/index.js` or `boot/` (production boot assertion);
  `backend/CLAUDE.md` + `backend/middleware/CLAUDE.md` (scope-gate + the boot requirement); Railway env
  (`MANUFACTURER_PORTAL_JWT_SECRET` — owner sets it **before** this deploys, or boot fails by design);
  tests.
- **Model/effort:** `claude-fable-5 / high` — the scope check runs on every authenticated request (a
  too-broad check 401s every legitimate employee/impersonation token, a too-narrow one leaves the
  hole), plus a boot assertion that will intentionally refuse to start without the secret. Well-bounded
  but blast-radius-sensitive.
- **Pause:** **YES, before starting** — an auth check on the universal request path AND a boot
  assertion that can block startup; owner approves the design and commits to setting the env var as
  part of this deploy (the boot assertion means the deploy fails if it isn't set). If the
  impersonation token's scope differs from `"full"` in a way that complicates the allowlist, stop and
  report.
- **Verify:** integration — a normal employee token (scope `"full"`) → unchanged (all existing
  employee tests green); an impersonation token → still works (impersonation suite green); a
  hand-crafted token with `scope: "manufacturer"` (or `"customer"`) signed with the employee secret →
  401 at `loadTenantAndPerms`, and crucially `req.tenantId` is **never set** (no tenant DB context
  attaches — assert an unguarded tenant route is now unreachable with it, where before it was
  reachable); the manufacturer portal's own auth path (`loadManufacturerAuth`) still works end-to-end.
  **Boot assertion:** in a simulated production env with `MANUFACTURER_PORTAL_JWT_SECRET` unset (or
  `=== JWT_SECRET`, or too short) → boot **throws** and the process exits; with a proper distinct
  secret → boots clean; the dev/test fallback still works under `NODE_ENV !== production`. Full backend
  suite vs the baseline artifact. **Both directions** at the gate.
- **Done when:** ☐ scope check rejects non-employee scopes before tenant/employee context attaches;
  ☐ employee + impersonation tokens unaffected; ☐ prod boot asserts a set, distinct, non-trivial
  secret (fallback removed in prod); ☐ env var set (owner) as part of this deploy; ☐ no new/changed
  test failures vs the baseline artifact.

**Prompt:**
```
Effort: high. Model: claude-fable-5.

Why: loadTenantAndPerms (runs on EVERY authenticated request) verifies tokens with JWT_SECRET and
never checks decoded.scope. A manufacturer-portal token (which shares JWT_SECRET because
MANUFACTURER_PORTAL_JWT_SECRET is unset) has no eid, so guarded routes 403 — but req.tenantId IS set
from its tid, so tenant DB context attaches and any UNGUARDED tenant route is reachable with a
manufacturer token. This is its OWN release: bundling an every-request auth change with other
refusal-behaviour changes recreates the "which gate 403'd?" ambiguity.

Task: Branch fix/v3-manufacturer-scope off (post-Gate-0) main. Per docs/fable5/plan-v3/PLAN-V3.md
Step 1:
1. Read jwt-auth.js (employee access tokens are signed with scope: payload.scope || "full") and the
   impersonation mint path — confirm what scope impersonation tokens carry BEFORE writing the check.
2. In middleware/tenant-auth.js loadTenantAndPerms, after verifyAccessToken and BEFORE setting
   req.tenantId/req.employee, reject any token whose scope is not the employee scope ("full", plus
   whatever impersonation legitimately uses) with a clean 401 { code: "INVALID_TOKEN_SCOPE" }. Do
   NOT attach tenant context for a rejected token. Mirror the explicit scope rejection the portal
   auth modules already do.
3. Audit: this lands before PERMISSION_RULES (live blanket middleware). Confirm no behaviour change
   for normal employee tokens or impersonation tokens.
4. Close the recurrence: add a PRODUCTION boot assertion (index.js or boot/) that throws and kills
   boot if MANUFACTURER_PORTAL_JWT_SECRET is unset, equals JWT_SECRET, or is too short/low-entropy —
   the ensureCriticalRoutesRegistered posture, not console.error-and-continue. Remove the PRODUCTION
   fallback in manufacturer-auth.js getSecret() (keep a clearly-labelled dev/test fallback gated on
   NODE_ENV !== production). This relaxes the "no portal-auth changes" fence for exactly this file.
   Note that rotating the secret invalidates existing manufacturer sessions.
5. Update backend/CLAUDE.md + backend/middleware/CLAUDE.md (scope-gate + the new boot requirement).
(The env var MANUFACTURER_PORTAL_JWT_SECRET is set by the owner AS PART OF this deploy — the boot
assertion means the deploy fails if it isn't. Note it, don't attempt it.)

Scope: the scope check + the boot assertion + the manufacturer-auth getSecret prod-fallback removal
+ docs. No other REPORT items. No other changes to the portal auth modules.
Autonomy: run fully; local PG tests from backend/ cwd; craft a scope:"manufacturer" token signed
with the employee secret and assert it 401s AND leaves req.tenantId unset (an unguarded tenant route
unreachable); prove employee + impersonation tokens unaffected; simulate a production env to prove
boot throws without a proper secret and boots with one, and that the dev/test fallback still works.
Diff against docs/fable5/plan-v3/baseline-tests.json (new/changed tests, not total). Commit locally
when green. Do not push. If impersonation scope complicates the allowlist, STOP and report.
Report: outcome first — the scope-reject behaviour both directions, the boot-assertion evidence, then
the impersonation finding.
```

## GATE 1 — Merge + deploy Release A

Gate protocol. Slice subset: Step 1 verify list (both directions) + full-suite baseline diff. Owner
sets `MANUFACTURER_PORTAL_JWT_SECRET` on Railway **as part of this deploy** (so the shared-secret
fallback stops the same day the scope check lands). NO migrations. Post-deploy live check (read-only):
a normal tenant login still works on a `golv_*` tenant; the manufacturer portal login still works on
`tenant_wholesalewalktest1778451` (the one tenant with a manufacturer partner, verified 2026-07-16).
Owner go → merge, watch deploys, live check, **walk the ledger.** Release B branches after.

> **OUTCOME 2026-07-22 — DEPLOYED.** Merge `09fa5e63` (`--no-ff`) → main; Railway `8e44f2e6` SUCCESS
> (old `cd75204e` removed — clean cutover); Vercel frontend 200. Owner set
> `MANUFACTURER_PORTAL_JWT_SECRET` on Railway prod pre-merge (`--skip-deploys`, activated on this
> deploy) — the real boot-assertion predicate was run against live prod env before merge (`problems: []`,
> `NODE_ENV=production`) and boot logs post-deploy are clean (no assertion abort, **no** `[SECURITY]`
> fallback warning → the secret is dedicated now).
>
> **Live check — both directions, all green:** deep health ok (DB 22ms); `mt-login` (livetestauto,
> normal tenant) → 200 and the resulting **`"full"`-scope token replayed through `/api/context/bootstrap`
> → 200 with no `INVALID_TOKEN_SCOPE`** (the every-request scope gate passes legitimate employee tokens);
> bad-cred `mt-login` → 401; manufacturer-portal `/login` on `wholesalewalktest1778451` → **200, token
> issued on the rotated dedicated secret** (bad-cred → 401). (golv_* not used — no creds; livetestauto
> proves the identical normal-auth path.)
>
> **Baseline diff:** `check-baseline.js` exited RED on ONE test (`pg-batch14-bookings` "blocked time does
> not appear in available slots") — **proven NOT a Release-A regression**: it fails identically on `main`
> (date-relative test, `new Date()`-derived "next Monday"; baseline captured 2026-07-16, ran 2026-07-22);
> 3 sibling booking/tax tests flipped green for the same calendar reason. Slice's own 3 unit files 22/22.
> The [[followup_main_integration_baseline]] "check main-vs-branch before calling a RED a regression" trap.
>
> **Ledger walk:** item **4.3** LANDED (dedicated secret + scope-gate + prod boot assertion). Release A was
> deliberately only 4.3 (own release). Accounted follow-up (not a gap): `CUSTOMER_PORTAL_JWT_SECRET` has the
> identical latent fallback — explicitly out of 4.3 scope, documented in `middleware/CLAUDE.md`. Zero
> unaccounted. **Release B (`fix/v3-restaurant-company-gate`) branches off this merged main next.**

---

# WAVE B (own release) — E9 Restaurant company-level kiosk gating

## Step 2 — AND the company `restaurant` flag into `kioskOrderingOff` + stale-token test

- **Goal:** Disabling the Restaurant module company-wide does NOT stop an already-issued kiosk token
  from ordering. `routes/public-restaurant.js:19-25` `kioskOrderingOff()` calls only
  `isModuleOffAtOutlet(tenant.id, "restaurant", ctx.outletId)` — the OUTLET half (which by contract
  resolves `override ?? default ?? TRUE` and leaves company state "checked separately by the caller",
  `feature-flags.js:196-197`) — and the caller never checks company state. **Fix: AND the
  company-level `restaurant` flag into `kioskOrderingOff`** (compose `getFeatureFlagsMap` — already
  imported at `public-restaurant.js:7` — with the existing `isModuleOffAtOutlet`), applied at all
  three call sites (`:122`, `:193`, `:266`). Add a stale-token test: mint a kiosk token, disable
  Restaurant company-wide, assert the QR order endpoints 404 ("Ordering is not available at this
  location").
  - **This is its own release** (owner ruling 2026-07-16) — do NOT bundle with 4.3 or any other
    gate-refusal change. It changes refusal behaviour on a public surface.
  - **Not urgent, in scope anyway.** Live evidence (verified 2026-07-16 via Supabase, re-verify):
    `restaurant_kiosk_slots` is **0 on all 29 real tenants**; only `tenant_sanoposlivetest1778021564659`
    has rows (7), and it is a test tenant. So zero real customers hold a kiosk token today — the gap
    is unreachable in production. It's in scope because Step 9's deferral reason ("would break
    tenants/tests that never touch per-outlet state") was scoped to a v2 step gate that no longer
    exists; a tenant with Restaurant OFF getting a 404 on its QR menu is the **correct** outcome.
  - **Expectation to verify (and a stop condition):** the breakage from composing the company flag
    should be **test fixtures that mint kiosk tokens without enabling the `restaurant` flag**, not a
    real product constraint. Verify that. **If it turns out to be a genuine product constraint
    (some legitimate flow needs kiosk ordering with the company flag off), STOP and report** instead
    of forcing the change.
- **Touches:** `backend/routes/public-restaurant.js`; the restaurant public/kiosk integration test
  (grep for the existing kiosk-ordering test); `backend/routes/CLAUDE.md` or the restaurant routes
  sub-guide (document the company+outlet composition). PLAN-V2's E9 row references
  `feature-flags.js:306-315` for the "checked separately" contract — the current line is `:196-197`
  (`isModuleOffAtOutlet`); re-confirm and cite the live line.
- **Model/effort:** `claude-fable-5 / medium` — small, single-file behaviour change, but it's a
  public-surface refusal change with a shared-concern (module gating) discipline: apply it at all
  three call sites, not one.
- **Pause:** **only if surprised** — no pause-before (the ruling is made), but pause-and-report if the
  breakage turns out to be a real product constraint rather than test fixtures.
- **Verify:** integration — with Restaurant company-ON, a valid kiosk token orders normally (200);
  with Restaurant company-OFF (company flag false), the same token's view/add/submit endpoints all
  404; the outlet-level gate still works independently (company-on + outlet-off → 404). Confirm the
  fail-open-on-lookup-error behaviour is preserved (an availability glitch must not kill live service).
  Full suite vs baseline; note any test fixtures that needed the `restaurant` flag added and confirm
  that's the only breakage class.
- **Done when:** ☐ company flag ANDed into `kioskOrderingOff` at all three call sites; ☐ stale-token
  test added + green; ☐ breakage confined to fixtures (or STOP-and-report fired); ☐ zero unexplained
  new failures.

**Prompt:**
```
Effort: medium. Model: claude-fable-5.

Why: turning off the Restaurant module company-wide does NOT stop an already-issued QR-kiosk token
from ordering — kioskOrderingOff() checks only the per-OUTLET module state, and the company-level
state is (per the isModuleOffAtOutlet contract) "checked separately by the caller", but the caller
never checks it. Unreachable in prod today (only a test tenant has kiosk slots), but a tenant with
Restaurant OFF getting a 404 on its QR menu is the correct outcome. Its OWN release — do not bundle.

Task: Branch fix/v3-restaurant-company-gate off (post-Gate-1) main. Per
docs/fable5/plan-v3/PLAN-V3.md Step 2:
1. Re-grep public-restaurant.js: kioskOrderingOff (:19), its three call sites (:122, :193, :266),
   and getFeatureFlagsMap (already imported :7). Re-confirm the isModuleOffAtOutlet "checked
   separately" contract line in feature-flags.js (PLAN-V2 cited :306-315; current is ~:196-197).
2. AND the company-level `restaurant` flag into kioskOrderingOff (company-off OR outlet-off ⇒ off),
   preserving the fail-open-on-lookup-error behaviour. Apply via kioskOrderingOff so all three call
   sites inherit it.
3. Add a stale-token integration test: mint a kiosk token, disable Restaurant company-wide, assert
   the view/add/submit QR endpoints 404.
4. Update the restaurant routes CLAUDE.md to state the surface now composes company + outlet.

Scope: exactly this. No other public-surface items. Do not touch the outlet-level resolution.
Autonomy: run fully; local PG tests from backend/ cwd. If the suite breaks anywhere OTHER than
fixtures that mint kiosk tokens without enabling the restaurant flag (i.e. a real flow legitimately
needs company-off kiosk ordering), STOP and report — do not force it. Otherwise fix those fixtures
to enable the flag. Diff against baseline-tests.json (new/changed tests, not total). Commit locally when green. Do not push.
Report: outcome first — company-off ⇒ 404 both directions, then the exact breakage list and that it
is fixtures only.
```

## GATE 2 — Merge + deploy Release B

Gate protocol. Slice subset: Step 2 verify list + full-suite baseline diff. NO migrations.
Pre-deploy: re-run `SELECT COUNT(*) FROM <tenant>.restaurant_kiosk_slots` across prod (expected: 0
on all real tenants) so the blast radius is confirmed nil at deploy time. Post-deploy: no live kiosk
token exists on a real tenant to spot-check, so the deploy is safe by construction; confirm
`/api/health` deep ok and Sentry clean. Owner go → merge, watch deploys, **walk the ledger.** Wave 3
branches after.

> **OUTCOME 2026-07-22 — DEPLOYED.** Merge `55e08170` (`--no-ff`) → main; Railway deploy `6121445b`
> SUCCESS on `55e08170` (healthcheck-gated cutover). NO migrations — boot log shows `[migrate-pg]
> Schema is up to date (version 137)` per tenant, all ~30 pg-boss workers registered, **no boot-assertion
> abort, no `[SECURITY]` fallback warning, zero `[ERROR]`**, adoption snapshot `tenant_count=29`. Deep
> health 200 (DB 26ms, Resend 381ms). Release B was **backend-only** (6 files, all `backend/`), so the
> Vercel frontend bundle is byte-identical to GATE 1's READY deploy; `sanopos.com` serves 200 (the Vercel
> deployment record wasn't pulled — MCP rate-limited — but with an empty frontend diff it's immaterial).
>
> **Pre-deploy blast-radius (re-verified live at deploy time via Supabase):** `restaurant_kiosk_slots`
> = **0 on all 29 real tenants**; only the test tenant `sanoposlivetest1778021564659` has rows (7). The
> E9 refusal change is unreachable in prod — safe by construction, matching PLAN-V2's Gate-2 measurement.
>
> **Step 2 verify list — 24/24 (3 touched files):** with Restaurant company-ON a valid kiosk token
> orders (200); company-OFF ⇒ the same token's view/add/submit all 404 ("not available at this
> location"); the outlet gate stays independent (company-ON + outlet-OFF → 404); fail-open-on-lookup-error
> preserved. The only breakage class was the 3 fixtures that minted kiosk tokens without seeding
> `phase4_restaurant` — now seeded, exactly as predicted.
>
> **Baseline diff:** `check-baseline.js` flagged 1 NEW (`pg-batch14-bookings` "blocked time does not
> appear in available slots") + 3 NOW-PASSING (2 tax-snapshot, 1 bookings "valid slots") — **all four
> reproduced identically on the clean base `99b7e4bb` at today's date** (ran the two files on base and
> branch side by side): day-of-week-relative availability + env-sensitive tax tests, zero shared path with
> restaurant. **Zero new/changed failures attributable to E9.** The [[followup_main_integration_baseline]]
> "check main-vs-branch before calling a RED a regression" trap — same one GATE 1 hit.
>
> **Sentry clean:** `node-express` (backend, the only project E9 touches) — no unresolved issues;
> `sanopos-frontend`'s single unresolved issue last-seen `2026-07-11` (11 days stale, unrelated to a
> backend-only change).
>
> **Ledger walk:** item **E9** LANDED (company `phase4_restaurant` ANDed into `kioskOrderingOff` at all
> three call sites; company-off OR outlet-off ⇒ 404). Release B was deliberately only E9 (own release).
> Completeness table: every row accounted — Wave 0 DEPLOYED (GATE 0), 4.3 (GATE 1), E9 (this gate),
> Steps 3–6 → Wave 3 (open), OUT/Deferred-v4 rows unchanged. **Zero unaccounted.** Wave 3
> (`feat/v3-remainder`) branches off this merged main next.

---

# WAVE 3 — The remainder (E5 + three rulings)

> The grab-bag: one build-only feature (E5) and three items that follow the investigate → present
> options → owner-rules-at-a-gate shape (wallet, `approval_policies`, `modifier_groups`). One branch,
> one gate.
>
> **Named ruling destination (added on second-eye review):** Steps 4, 5, and 6 each write their
> investigation + the owner's ruling to a single **`docs/fable5/plan-v3/DECISIONS-V3.md`** (create it
> in Step 4, append in Steps 5–6) — one section per decision with the finding, the options, the
> ruling, and the executed branch. "Investigation filed" has a real home; the ledger and Step V read
> it.

## Step 3 — E5: setup checklists for the 7 uncovered Bucket A cards

- **Goal:** Author `setup_checklist` arrays in `config/business-modules.js` for the seven Bucket A
  cards that Step 11 left uncovered: `subscriptions_memberships`, `clinical`, `service_tickets`,
  `projects_contracts`, `commissions`, `wholesale_credit`, `field_sales`. **This is NOT an epic** —
  `services/business-modules.js:452` `computeChecklists` is already generic: it reads
  `card.setup_checklist` off the catalog, builds ONE batched EXISTS query regardless of outlet count,
  handles `scope:"outlet"` vs `scope:"tenant"`, applies the `attention_required` state rule (any
  required item un-done → the card reads attention), and falls back per-item when a table is missing.
  E5 = authoring the arrays against shipped machinery + verification. The four covered cards
  (`restaurant`, `appointments`, `rentals`, `rooms_lodging` — confirmed at `config/business-modules.js:126,186,249,286`)
  are the template for shape: each item is `{ id, label, required, scope, done_query: { sql, outlet_column? }, route }`.
  - **Priority note (a hole that is open right now):** Step 11 **deleted** the dashboard `membership`
    onboarding step (`DashboardOnboarding.jsx:120` — a permanent `done:false` proxy) and parked its
    replacement here. So memberships have neither an onboarding step nor a checklist today —
    `subscriptions_memberships` is the one that closes a live gap, not just adds polish.
  - **Author the exact 7-card matrix as a spec FIRST, then ratify, then implement** (added on
    second-eye review — "pick items a real operator needs" is too much product judgment to leave
    implicit across 7 cards). The proposed matrix below is the starting point (`scope` and the key
    table are drawn from each card's `impact_queries` + a schema grep; **required-vs-optional is the
    judgment the owner ratifies**). Verify every table/column against schema before encoding — grep,
    don't trust this table:

    | Card | scope | Proposed required item(s) → table | Proposed optional | route |
    |---|---|---|---|---|
    | `subscriptions_memberships` | tenant | a subscription/membership **plan** defined → plan table (grep: `subscription_plans`? `customer_subscriptions` is the *instance* table) | — | `/subscriptions` |
    | `clinical` | outlet | a **treatment-plan template** exists → `treatment_plan_templates` | first plan created | `/treatment-plans` |
    | `service_tickets` | outlet | a **ticket type / workflow** configured (grep the config table) | — | `/service-tickets` |
    | `projects_contracts` | outlet | a **project** or a **contract template** → `service_projects` / contract-template table | the other of the two | `/projects`, `/contracts` |
    | `commissions` | tenant | a **commission plan** defined → commission-plan table (card has empty `impact_queries`, flag-only) | — | `/commissions` |
    | `wholesale_credit` | tenant | a **customer with a credit limit** → `customers.credit_limit > 0` (the `customers_with_credit` impact query is the ready model) | payment terms set | credit/customers surface |
    | `field_sales` | tenant | a **field-rep employee** → `employees.employee_type='field_rep'` (the `field_reps` impact query is the model) | a route defined → `field_rep_routes` | `/field/...` |

    Mirror the discipline of the four shipped cards: required items are **true prerequisites** (the
    module is unusable without them); optional items are nice-to-haves that never hold the
    `attention_required` state.
  - **HONOUR THE QUERY BUDGET:** `computeChecklists` builds one batched SELECT (one EXISTS column per
    item) for all enabled covered cards — do not add a per-card or per-item query. If an item can't be
    expressed as a single EXISTS against one table, either simplify it or leave it out; do not regress
    the budget.
- **Touches:** `backend/config/business-modules.js` (the 7 arrays); `frontend/src/pages/dashboard/DashboardOnboarding.jsx`
  only if a stale reference to the removed `membership` step remains; the checklist integration test
  (extend the direct-`computeChecklists` coverage to the 7 new cards); `backend/config/CLAUDE.md` /
  the business-modules catalog CLAUDE if it enumerates covered cards. No frontend page changes —
  `BusinessModulesRedesign` already renders whatever checklists the payload carries.
- **Model/effort:** `claude-fable-5 / medium` — low runtime risk (config against shipped machinery),
  but each item needs a correct table/column/scope and the query budget must not regress; a wrong
  `done_query` silently shows a card as attention-required forever or done forever.
- **Pause:** **YES, mid-step** — after schema-verifying the matrix and before implementing, the owner
  ratifies the finalized 7-card matrix (specifically the required-vs-optional calls), the same
  spec-then-ratify discipline v2 Step 3 used for the report-perms taxonomy. Then encode + verify.
- **Verify:** for each of the 7 cards, on a `sanopos_dev` tenant with the module enabled: with the
  prerequisite absent → the card reads `attention_required` and the required item shows `done:false`;
  after creating the prerequisite row → the required item flips `done:true` and the card clears; a
  `scope:"outlet"` item at outlet A does not complete outlet B's item (direct `computeChecklists`
  call with `outletId`). Assert the batched-query count is unchanged (the existing query-count
  assertion on the payload must still hold with 11 covered cards instead of 4). Full suite vs baseline.
- **Done when:** ☐ 7 `setup_checklist` arrays authored + schema-verified; ☐ each card's
  attention→clear transition proven both directions; ☐ outlet-scoped items proven outlet-aware;
  ☐ query budget unchanged; ☐ the `subscriptions_memberships` onboarding hole is closed.

**Prompt:**
```
Effort: medium. Model: claude-fable-5.

Why: v2 Step 11 shipped guided setup checklists but covered only 4 Bucket A cards
(restaurant/appointments/rentals/rooms). Seven more have none: subscriptions_memberships, clinical,
service_tickets, projects_contracts, commissions, wholesale_credit, field_sales. Worse,
subscriptions_memberships is a LIVE hole — Step 11 deleted the dashboard `membership` onboarding
step (a permanent done:false proxy) and parked its replacement here, so memberships currently have
neither. The machinery is done — computeChecklists (services/business-modules.js:452) is generic and
batches one query regardless of outlet count. This is authoring config, not building an engine.

Task: On branch feat/v3-remainder off (post-Gate-2) main, per docs/fable5/plan-v3/PLAN-V3.md Step 3:
1. Read the 4 shipped setup_checklist arrays (config/business-modules.js :126,186,249,286) for the
   exact item shape.
2. SPEC FIRST: take the proposed 7-card matrix in the plan, grep the schema to confirm every table +
   column + scope, and produce the FINALIZED matrix (id, label, required/optional, scope, done_query
   table, route). Honour the query budget: one EXISTS per item against ONE table — no joins, no
   per-card queries. subscriptions_memberships is the priority (closes the deleted-onboarding hole).
3. STOP and present the finalized matrix — the owner ratifies it (especially required-vs-optional).
4. After ratification, encode the 7 setup_checklist arrays. Confirm no stale reference to the removed
   dashboard `membership` step remains in DashboardOnboarding.jsx.
5. Extend the checklist integration test to cover the 7 new cards (attention→clear both directions;
   outlet-scoped items outlet-aware via a direct computeChecklists(outletId) call). Keep the existing
   payload query-count assertion green.

Scope: config + tests + doc. No frontend page changes (BusinessModulesRedesign renders the payload
already). No new engine code.
Autonomy: spec + schema-verify fully, then PAUSE for ratification. After the ruling, encode + prove
each card's transition on sanopos_dev. Diff against baseline-tests.json. Commit locally when green.
Do not push.
Report: outcome first — the finalized matrix (before the pause); after ratification, the transition
evidence and the unchanged query count.
```

## Step 4 — Dead portal `wallet` tab: WIRE-vs-RETIRE ruling

- **Goal:** The portal `wallet` tab is fully built but unreachable. `PortalWallet.jsx`, the
  `/portal/:slug/wallet` route, `GET /me/wallet` + `POST /me/wallet/top-up-intent`
  (`routes/customer-portal/data.js:622,623,641,645`), and the `wallet_tab: "Wallet"` label
  (`industry-config.js:706`) all exist — but `wallet` appears in **no** preset's tab list in
  `PORTAL_ENABLED_TABS_BY_PRESET`, so `enabled_tabs` never contains it and the nav link never renders
  for any of the 23 industries (verified 2026-07-16: `wallet` appears in industry-config.js only as
  the label key at `:706` and a comment at `:691`, never in a tab array). **Plan it as a WIRE-vs-RETIRE
  ruling** — the exact shape v2 Step 6b used for the truthless flags: investigate, recommend, owner
  rules at the gate, then execute the chosen branch in the same step.
  - **Investigate:** does `wallet` top-up actually function end-to-end (does `top-up-intent` reach a
    live payment path, or is it a stub)? Is customer wallet balance surfaced anywhere else (POS
    wallet tender exists — `useLoyaltyWallet` / the Wallet tender in `POSCheckoutModal`), so is the
    portal tab redundant or the only self-service top-up? Which presets would logically want it
    (retail-loyalty? gym?) if wired? Git-history the tab to see if it was deliberately parked.
  - **Recommend** WIRE (add `wallet` to the relevant preset tab lists + confirm the top-up path is
    real) **or** RETIRE (remove `PortalWallet.jsx`, the route, the two endpoints, the label, the
    `TAB_LABEL_KEYS`/`TAB_PATHS` entries — a clean deletion, not a half-dead surface). Owner rules at
    the gate; then execute the chosen branch.
- **Touches:** investigation is read-only. Execution touches either `industry-config.js`
  (+ `customer-portal/data.js` `TAB_FEATURE_FLAGS` if gated) for WIRE, or the full deletion set for
  RETIRE; `frontend/src/pages/portal/CLAUDE.md` either way.
- **Model/effort:** `claude-fable-5 / medium` — the investigation (is the top-up path real?) is the
  hard part; both execution branches are mechanical.
- **Pause:** **YES, mid-step** — owner rules WIRE vs RETIRE after seeing the investigation. Do not
  pre-decide.
- **Verify:** WIRE — the tab renders + top-up completes end-to-end on a preset that got it (browser,
  a portal test session). RETIRE — the route/page/endpoints/label are gone, no dead import, the
  frontend-coverage-drift test doesn't newly fail (the two endpoints are currently orphaned; deleting
  them shrinks the orphan set, which is fine — confirm the drift baseline tolerates removal).
- **Done when:** ☐ investigation + recommendation filed in `DECISIONS-V3.md` (create the file here);
  ☐ owner ruling recorded there; ☐ chosen
  branch executed + verified; ☐ portal CLAUDE.md updated.

**Prompt:**
```
Effort: medium. Model: claude-fable-5.

Why: the customer-portal `wallet` tab is fully built (PortalWallet.jsx, /portal/:slug/wallet, GET
/me/wallet, POST /me/wallet/top-up-intent, the "Wallet" label) but appears in NO preset's tab list,
so it never renders for any of the 23 industries — URL-only dead surface. Decide: wire it or retire
it. Don't leave a half-dead feature.

Task: On feat/v3-remainder, per docs/fable5/plan-v3/PLAN-V3.md Step 4:
1. INVESTIGATE (read-only): does POST /me/wallet/top-up-intent reach a real payment path or is it a
   stub? Is customer wallet balance already usable elsewhere (POS Wallet tender exists)? Which presets
   would want it if wired (retail-loyalty, gym)? Git-history the tab. File the findings + a WIRE-vs-
   RETIRE recommendation.
2. STOP and present the recommendation. The owner rules.
3. Execute the ruling: WIRE = add `wallet` to the chosen presets in
   industry-config.js PORTAL_ENABLED_TABS_BY_PRESET (+ TAB_FEATURE_FLAGS if gated) and confirm the
   top-up path works end-to-end. RETIRE = delete PortalWallet.jsx, the route, GET /me/wallet, POST
   /me/wallet/top-up-intent, the wallet_tab label, and the TAB_LABEL_KEYS/TAB_PATHS entries — clean.
   Update frontend/src/pages/portal/CLAUDE.md either way.

Scope: exactly the wallet tab. No other portal tabs.
Autonomy: investigate fully, then PAUSE for the ruling. After the ruling, execute + verify (browser
for WIRE; grep-clean + drift-test for RETIRE). Commit locally when done. Do not push.
Report: outcome first — the investigation + recommendation (before the pause); after the ruling, the
executed branch + evidence.
```

## Step 5 — `approval_policies` copy-on-new-outlet: investigate → ruling

- **Goal:** `approval_policies` was **explicitly parked in v2 for re-decision AFTER D2 landed** — not
  an E6 item (`outlet-copy.js:26-27` states it verbatim: "parked until after D2 (Steps 13-14 rewire
  the (outlet, role) grain it keys on)"). D2 has landed (v137, Steps 13-14 shipped per-outlet roles).
  So the postponed question is now answerable: **should a newly-created outlet inherit the source
  outlet's `approval_policies`, and if so, how does the copy handle the (outlet, role) grain now that
  per-outlet roles exist?** Investigate → present options → owner rules at the gate.
  - **Investigate:** the current `approval_policies` schema and its key columns (grep the table +
    `services/approval-policy.js`); whether policies key on outlet, role, or both; how a copy would
    behave now that `employee_outlets.role_id` overrides exist — a policy copied to a new outlet
    referencing a role is fine (roles are tenant-global), but confirm there's no per-employee or
    per-outlet-specific reference that would copy wrongly. Compare against why the 7 NEVER-copy tables
    are never-copy (`outlet-copy.js:9-28`) and whether `approval_policies` is more like the COPY set
    (config that a new location wants a sane default of) or the NEVER set (per-outlet divergence /
    physical reality / a required-checklist item a copy would falsely satisfy).
  - **Recommend** COPY (add to `COPY_SPECS` with the correct scope/copy/stamp/skip classification for
    every column — the drift contract at `outlet-copy.js:30-35` requires every column classified) or
    NEVER (add it to the documented never-copy list with the reason). Owner rules; then execute.
- **Touches:** investigation read-only. Execution: `backend/services/outlet-copy.js` (+ its drift
  test `tests/unit/outlet-copy-drift.test.js` and the integration column check) for COPY, or just the
  never-copy comment block for NEVER; `services/CLAUDE.md` (the outlet-copy summary lists copyable
  tables).
- **Model/effort:** `claude-fable-5 / medium` — the ruling turns on the (outlet, role) grain; if
  COPY, the column classification must be exhaustive (the drift test fails otherwise), but it's one
  table.
- **Pause:** **YES, mid-step** — owner rules COPY vs NEVER after the grain investigation. Do not
  pre-decide.
- **Verify:** COPY — creating a new outlet with `copy_from_outlet_id` clones the source's policies
  inside the creation transaction; the drift test passes (every column classified); a policy
  referencing a role resolves correctly at the new outlet. NEVER — the never-copy list documents it +
  the reason; new-outlet creation does not touch `approval_policies`. Full suite vs baseline.
- **Done when:** ☐ grain investigation + recommendation appended to `DECISIONS-V3.md`; ☐ owner ruling
  recorded there; ☐
  chosen branch executed (COPY with full column classification, or NEVER with reason) + verified.

**Prompt:**
```
Effort: medium. Model: claude-fable-5.

Why: approval_policies was parked in v2's D8 copy work "until after D2 lands" because Steps 13-14
rewired the (outlet, role) grain it keys on. D2 landed (v137). The question is now answerable: should
a new outlet inherit the source outlet's approval_policies, and how does the copy handle the grain
now that per-outlet roles exist? This is NOT an E6 item — it was always postponed for exactly this
moment.

Task: On feat/v3-remainder, per docs/fable5/plan-v3/PLAN-V3.md Step 5:
1. INVESTIGATE (read-only): grep the approval_policies schema + services/approval-policy.js. Does it
   key on outlet, role, or both? Would a copy to a new outlet mis-reference anything now that
   employee_outlets.role_id overrides exist (roles are tenant-global, so a role reference copies
   fine — confirm there's no per-employee/per-outlet-specific reference). Weigh it against the COPY
   set vs the 7 NEVER-copy tables (outlet-copy.js:9-28): config a new location wants a default of, or
   per-outlet divergence a copy would corrupt / a required-checklist item a copy would falsely
   satisfy? File findings + a COPY-vs-NEVER recommendation.
2. STOP and present. The owner rules.
3. Execute: COPY = add to COPY_SPECS classifying EVERY column as scope/copy/stamp/skip (the drift
   contract requires it) + make the drift test green. NEVER = add it to the documented never-copy
   list with the reason. Update services/CLAUDE.md's outlet-copy summary.

Scope: exactly approval_policies. Do not touch the other copy candidates (modifier_groups is Step 6).
Autonomy: investigate fully, then PAUSE for the ruling. After the ruling, execute + verify (new-outlet
copy transaction for COPY; drift test + full suite either way). Commit locally when done. Do not push.
Report: outcome first — the grain investigation + recommendation (before pause); after the ruling,
the executed branch + drift-test evidence.
```

## Step 6 — E6: `modifier_groups` in the D8 copy allowlist: scope → ruling

- **Goal:** `modifier_groups` is the last unruled of the 13 D8 copy candidates (5 COPY shipped, 7
  NEVER at the Step 12 pause; `outlet-copy.js:28` defers it: "needs a groups→options→links deep
  copy"). Scope the deep copy, present it, owner rules COPY vs NEVER.
  - **Scope the deep copy:** `modifier_groups` is not a flat table — a copy must clone
    `modifier_groups` → `modifier_options` → `product_modifier_group_links` (confirmed at
    `schema-pg.sql:2679,2709,2720`), remapping the new group ids through options and product links,
    **with no unique constraint guarding against duplicates** (so re-running or copying into an outlet
    that already has groups would double them). Note whether `modifier_groups` is even outlet-scoped
    or tenant-global (grep the table — if tenant-global, "copy per outlet" may be a category error
    and the answer is NEVER by construction). Assess the duplicate risk and how a copy would guard it
    (skip if the target already has groups? key on name?).
  - **Recommend** COPY (with the deep-copy + dedup design spelled out; it would extend `outlet-copy.js`
    beyond the single-table `COPY_SPECS` shape, since a groups→options→links remap isn't a flat
    column classification — flag that this is a structural extension, not another `COPY_SPECS` row)
    **or** NEVER (with the reason — e.g. tenant-global so not per-outlet, or the dedup risk isn't
    worth it). Owner rules; then execute.
- **Touches:** investigation read-only. Execution: `backend/services/outlet-copy.js` (a deep-copy
  path distinct from the flat `COPY_SPECS` loop) + its drift test, for COPY; or the never-copy comment
  for NEVER; `services/CLAUDE.md`.
- **Model/effort:** `claude-fable-5 / high` (if COPY) — a multi-table remap inside the outlet-creation
  transaction with a real duplicate hazard and no DB-level guard; the copy correctness is the whole
  risk. If the ruling is NEVER, effort collapses to low (a comment) — but scope for the high case.
- **Pause:** **YES, mid-step** — owner rules COPY vs NEVER after the deep-copy scoping. Do not
  pre-decide.
- **Verify:** COPY — creating a new outlet with `copy_from_outlet_id` clones groups + options +
  product links with correct id remapping and no duplication (including the re-run / already-populated
  case); the drift test passes. NEVER — documented with reason; new-outlet creation doesn't touch
  modifier tables. Full suite vs baseline.
- **Done when:** ☐ deep-copy scoping appended to `DECISIONS-V3.md` (incl. outlet-scoped-vs-global finding + dedup design);
  ☐ owner ruling recorded; ☐ chosen branch executed + verified.

**Prompt:**
```
Effort: high. Model: claude-fable-5.

Why: modifier_groups is the last unruled of 13 D8 copy candidates. It was deferred because copying
it isn't a flat table copy — it needs a groups→options→product-links deep copy, and there's no
unique constraint guarding against duplicates. Scope it, then the owner rules copy-vs-never.

Task: On feat/v3-remainder, per docs/fable5/plan-v3/PLAN-V3.md Step 6:
1. SCOPE (read-only): grep modifier_groups / modifier_options / product_modifier_group_links
   (schema-pg.sql:2679,2709,2720). Is modifier_groups outlet-scoped or tenant-global? (If
   tenant-global, "copy per outlet" is a category error → NEVER by construction — say so.) If
   outlet-scoped: design the deep copy — clone groups → options → product links, remapping new group
   ids through options and links, and guard duplicates (no DB constraint exists — skip if the target
   already has groups? key on name?). Note that this extends outlet-copy.js beyond the flat COPY_SPECS
   shape. File the design + a COPY-vs-NEVER recommendation.
2. STOP and present. The owner rules.
3. Execute: COPY = implement the deep-copy path (distinct from the flat COPY_SPECS loop) inside the
   outlet-creation transaction, with the dedup guard, + drift test. NEVER = document it in the
   never-copy list with the reason. Update services/CLAUDE.md.

Scope: exactly modifier_groups. approval_policies is Step 5.
Autonomy: scope fully, then PAUSE for the ruling. After the ruling, execute + verify (deep-copy
correctness incl. the already-populated re-run case for COPY; full suite either way). Commit locally
when done. Do not push.
Report: outcome first — the outlet-scoped-vs-global finding + deep-copy design + recommendation
(before pause); after the ruling, the executed branch + copy-correctness evidence.
```

## GATE 3 — Merge + deploy Wave 3

> **✅ GATE 3 DEPLOYED 2026-07-23 — merged `4226f1af`, prod green.** Owner gave the go; merged
> `feat/v3-remainder` (5 commits) into main via `--no-ff` and pushed (`9e0e788c..4226f1af`). **NO
> migrations** (head stays v137). Deploys: Railway `24e60cc2` SUCCESS on `4226f1af` (boot clean —
> pg-boss + ~26 workers registered, adoption snapshot `tenant_count=29`, **0 [ERROR]**, no
> boot-assertion abort, no `[SECURITY]` fallback, `Schema is up to date (version 137)` per tenant);
> Vercel `dpl_Cy1iwmgF…` READY on `4226f1af`. Deep health 200 (DB 37ms, Resend 350ms).
>
> **Three owner rulings recorded** in `DECISIONS-V3.md` before merge: wallet **RETIRE** (+ admin
> top-up follow-up), `approval_policies` **COPY**, `modifier_groups` **NEVER**.
>
> **Pre-merge gate:** `/code-review` PASS (no blocking findings — all 7 E5 `done_query` tables+columns
> verified in schema so a wrong column can't 500 the page; `approval_policies` COPY spec exhaustively
> classifies all 10 columns; wallet removal leaves zero dangling refs, surviving synchronous top-up +
> POS tender intact); slice verify subset 40/40 (checklist unit 11/11 + integration 7/7, outlet-copy
> drift 3/3 + settings 19/19); full-suite baseline diff **GATE GREEN** (72 known-red @ `3b45f25c`,
> 72 fresh-red, **0 new / 0 changed**; 2485 tests, 2411 passed); affected CLAUDE.md updated.
>
> **Post-deploy live checks — both green:** (1) `GET /api/business-modules` on
> `tenant_wholesalewalktest1778451` (has two NEW covered cards enabled — `wholesale_credit` +
> `field_sales`; used in place of a `golv_*` tenant, for which no login creds are recorded) returns the
> new E5 checklists nested per-module with correct `done` states, and correctly **omits** the checklist
> on the disabled `subscriptions_memberships` card (checklists attach to ENABLED covered cards only).
> (2) The `copy_from_outlet_id` path (`POST /api/outlets`) re-run on local Postgres (NOT prod) —
> `pg-step12-outlet-copy-settings` 19/19, incl. "copies an outlet-specific approval policy (role_id
> intact) but NOT a global one" (the COPY ruling) and "never copies modifier groups, options or product
> links" (the NEVER ruling), plus atomicity (induced mid-clone failure → no orphan outlet).
>
> **Ledger walk:** all four Wave 3 rows LANDED — E5 checklists (Step 3), wallet RETIRE (Step 4),
> `approval_policies` COPY (Step 5), `modifier_groups` NEVER (Step 6). D8 copy ledger CLOSED: **6 COPY
> / 7 NEVER**, no candidate unruled. Completeness table: Wave 0 (GATE 0), 4.3 (GATE 1), E9 (GATE 2),
> Steps 3–6 (this gate) all deployed; OUT/Deferred-v4 rows unchanged. **Zero unaccounted.** Only Step V
> (end-to-end verification + final ledger walk) remains open.

Gate protocol. Slice subset: Steps 3–6 verify lists + full-suite baseline diff. NO migrations. This
gate carries three owner rulings (wallet, `approval_policies`, `modifier_groups`) resolved at their
mid-step pauses — confirm each ruling is recorded before merge. Post-deploy live check (read-only):
on a `golv_*` tenant with a covered module enabled, `GET /api/business-modules` returns the new
checklists correctly; if any COPY ruling shipped, creating a throwaway outlet with `copy_from_outlet_id`
on a scratch/dev tenant behaves (do this on `sanopos_dev`, not prod). Owner go → merge, watch deploys,
live check, **walk the ledger.**

---

## Step V — End-to-end verification + completeness-ledger walk

- **Goal:** Fresh-context verification of the whole V3 surface + a walk of the completeness table
  below. Model on PLAN-V2 Step 15.
- **Touches:** a `VERIFICATION-V3.md` in this folder; no code.
- **Model/effort:** `claude-fable-5 / high` — a fresh-context verifier that re-derives, doesn't trust
  this plan's as-built notes.
- **Pause:** **YES, after** — owner reviews `VERIFICATION-V3.md` before the plan is closed.
- **Verify:** every Done-when box across every step is checked; the full backend suite is diffed
  against the **Step 0 baseline artifact** (`baseline-tests.json`) by test id — fail on any new/changed
  failure, not on total (pg-batch2/3/8 ~12 known failures, `smoke-gate.test.js` known-red — do not
  investigate); the three W0d guard tests (1a/1b/2) are green on the final merged main; the
  completeness table below is walked and every row lands (a step, an explicit OUT, or a
  Deferred-to-v4 row) — an unaccounted item fails verification; the three `DECISIONS-V3.md` rulings
  are recorded; prod read-only spot-checks (admin login sans allowlist, manufacturer scope reject +
  boot-assertion note, a brand-route crawler preview, a `golv_*` checklist payload) are green.
- **Done when:** ☐ every step verified; ☐ ledger walked, zero unaccounted; ☐ `VERIFICATION-V3.md`
  filed; ☐ memory + the affected CLAUDE.md files swept.

---

## Completeness-contract table — every item from both source docs

Step V walks this. An unaccounted item fails verification. **Bold** = Wave 0 (into baseline before
any feature wave). Source key: `R§n` = REPORT.md section; `PV2` = PLAN-V2 deferral.

| Item | Source | Disposition |
|---|---|---|
| 4.1 `ADMIN_ALLOWED_IPS` fails open | R§4.1 | **Step W0a — DELETE the allowlist, helper, boot warning (D3/D4); do NOT set the var** |
| 4.2a `undefined===undefined` GET verify-token bypass | R§4.2 | **Step W0a2 — DONE `a4a65655`.** Handshake refuses when the expected token is unset; constant-time compare. Live-verified 403 (was 200 + challenge to anyone). |
| 4.2b unsigned meta/whatsapp webhooks | R§4.2 | **Step W0a2 — DONE `a4a65655`.** `x-hub-signature-256` hex HMAC over raw body, app-level secret, fail-closed 401 + alert, verified before tenant resolution. Activation guard blocks connecting a Meta channel with no app secret. |
| 4.2c unsigned **daraz** webhook | R§4.2 | **Deferred → V4-3 (owner-ruled 2026-07-16).** BLOCKED: the inbound push contract is unpublished (Lazada's documented `_sign` is parameter-based and outbound-only; the Open Platform push docs serve no fetchable content). Cannot distinguish "signed scheme X" from "unsigned"; a wrong guess fail-closes a tenant's first real webhook. Left at pre-existing trust-the-payload. **Latent** (0 active configs) — see the shared TRIGGER below. |
| 4.3 manufacturer JWT shares secret + no scope check | R§4.3 | Step 1 / **Release A (own)** — set the secret + scope-gate `loadTenantAndPerms` + prod boot assertion (close the recurrence) |
| 4.4 grey-cloud R2 proxy on origin | R§4.4 | **Step W0-ops — R2 custom domain + `R2_PUBLIC_URL`; do NOT flip orange cloud (owner ops)** |
| 4.5 in-memory process state | R§4.5 | **Step W0a — DOCS ONLY in backend/CLAUDE.md** |
| KDS renders full merchant chrome | R§Part 2 | **Step W0b — escaped shell + Breadcrumbs skip, auth+perm preserved** |
| POSContext `navigate` bug (session-expired modal) | R§Part 5 | **Step W0b — export `navigate` + update the key-list comment** |
| OG/social-preview gap (brand routes) | R§Part 3 | **Step W0c — edge middleware, brand bucket, deny-list-first** |
| Dead portal `wallet` tab | R§Part 1 | Step 4 — WIRE-vs-RETIRE ruling |
| E5 setup checklists (7 uncovered Bucket A cards) | PV2 E5 | Step 3 — author arrays against shipped `computeChecklists` |
| E9 restaurant company-level kiosk gate | PV2 E9 | Step 2 / **Release B (own)** |
| E6 `modifier_groups` copy | PV2 E6 | Step 6 — scope → ruling (COPY vs NEVER) |
| `approval_policies` copy (parked post-D2) | PV2 (Step 12) | Step 5 — investigate → ruling (COPY vs NEVER) |
| Invariant (1): outlet reach on base perms | PV2 (open invariant) | **Step W0d — grep guard test** |
| Invariant (2): single `x-outlet-id` reader | PV2 (open invariant) | **Step W0d — grep guard test** |
| Customer-display GET no-auth | R§Part 2 | **OUT** — deliberate design ("NO auth — public-facing screen"); modest blast radius (cart line items only, no PII); not in owner-ruled scope. Its in-memory `displayStore` IS covered (4.5 docs). |
| Env-var URL 5-fallback / `localhost` risk | R§Part 3 | **OUT → Deferred v4** — latent; only bites a new environment (staging/second region) that forgets the var. `r2.js:74`'s throw-on-misconfig is the model if picked up. |
| Generated 1200×630 OG card (Vercel OG / satori) | R§Part 3 | **OUT → Deferred v4** — explicitly out; W0c ships `logo_url`+fallback. |
| `public-rentals.js` backend-only orphan | R§Part 1 | **OUT → E7** (frozen by `frontend-coverage-drift.test.js`) |
| recipe-costing report has no tab | R§Part 3 | **OUT → E7** |
| SEO/PWA (sitemap/robots/manifest) | R§Part 3 | **OUT** — verified clean, no action |
| GLOBAL-READINESS.md in full (night-audit cron, Google/Meta hardcodes, `\|\| "PKR"`, `TZ=Asia/Karachi`, FBR-as-special-case, the non-PK test tenant) | GLOBAL-READINESS | **OUT** — one blocking epic behind one trigger (first non-PK tenant); correct behaviour for a PK-only product (ai-platform D1). Not scattered fixes. |
| SCREEN-GAPS.md in full (14 screenless presets, KDS/customer-display archetype reuse, field-PWA portability) | SCREEN-GAPS | **OUT** — the KDS *chrome* fix (R§Part 2) IS in scope (W0b); the screen *gaps* are not. |
| E1 location-aware `depends_on` | PV2 E1 | **OUT → Deferred v4** |
| E2 device-scope per-outlet activation | PV2 E2 | **OUT → Deferred v4** |
| E3 kiosk/portal scope awareness of per-outlet roles | PV2 E3 | **OUT → Deferred v4** |
| E4 hybrid-card contract | PV2 E4 | **OUT → Deferred v4** |
| E7 78 orphaned endpoints | PV2 E7 | **OUT** — own plan; twice-ruled out of v2 |
| E8 preset operator roles | PV2 E8 | **OUT → Deferred v4** |
| AI platform strategy folder | ai-platform-strategy | **OUT** — separate future effort |

---

## Deferred to v4 (running list — add here during execution, never silently drop)

Carrying forward every still-open v2 deferral so the chain is unbroken, plus the v3 spin-offs
(V4-1/V4-2 planned at authoring; V4-3/V4-4 added during execution — V4-3 is a scope split ruled
mid-step, V4-4 a new finding, and both are recorded here rather than in a chip or a memory note so
Step V's ledger walk can actually see them).

| # | Item | Source |
|---|---|---|
| E1 | Location-aware `depends_on` (outlet-level prerequisite cascades) | PLAN-V2 E1 |
| E2 | Per-outlet activation for device-scoped cards | PLAN-V2 E2 |
| E3 | Kiosk/portal-scope awareness of per-outlet roles | PLAN-V2 E3 |
| E4 | Hybrid-card contract (tenant-wide credentials + per-outlet operational enablement) | PLAN-V2 E4 |
| E7 | Frontend coverage clusters (78 orphaned endpoints) — own plan, frozen as the drift-test baseline | PLAN-V2 E7 |
| E8 | Preset-specific operator roles | PLAN-V2 E8 |
| V4-1 | Generated 1200×630 OG card (Vercel OG / satori) composing logo + shop name | REPORT §Part 3 (W0c defers) |
| V4-2 | Env-var URL fallback hardening — throw-on-misconfig for the 37 link-building sites (model: `r2.js:74`) | REPORT §Part 3 |
| V4-3 | **Daraz inbound push signature verification** — blocked on the contract | REPORT §4.2 (W0a2 splits) |
| V4-4 | **WhatsApp inbound `external_id` idempotency** — needs a migration, so structurally impossible in v3 | Found during W0a2 |

### ⚠️ SHARED TRIGGER for V4-3 + V4-4 — before any tenant activates a channel integration

Both are latent for exactly one reason: **zero tenants have an active channel `integration_settings` row** (verified 2026-07-16 via Supabase; only `tenant_livetest1` has one, `is_active=false`). That is the same latency that made W0a2 hardening-before-anyone-connects rather than a live-fire fix. Both become real the moment a tenant connects. Re-verify the zero-active-config claim before relying on it — this is the tripwire, not a schedule.

Deliberately **documentation-only, not a code gate**: blocking Daraz activation was considered and owner-ruled against on 2026-07-16 (the ruling was "split and defer", explicitly not "fail-closed Daraz"). Do not add that gate without a fresh ruling. Pattern mirrors the E9 kiosk-slots trigger in `business_modules_v2_open_decisions`.

- **V4-3 (Daraz)** — unblock is an **owner action**, not a code task: obtain the push-notification signing contract from the Daraz seller/partner portal, **or** capture one live push and read its headers. Until then any implementation is a guess. The full research trail (what was checked and why it dead-ends) is in the comment above the handler in `routes/webhooks.js` and the table in `routes/CLAUDE.md` — read those before re-litigating; the docs route has already been exhausted. Risk while deferred: a forged status push could upsert `web_orders`/`daraz_order_map` for a known order id (status corruption, not money movement).
- **V4-4 (WhatsApp)** — `services/messaging.js:addMessage` plain-INSERTs `external_id`; `message_entries` has **no** unique constraint on it (only `idx_message_entries_thread`), so `ON CONFLICT` needs a migration → v3 ships zero migrations by design. Fix: partial unique index on `external_id WHERE direction='inbound' AND external_id IS NOT NULL` (**partial** — outbound sends legitimately carry a null `external_id`, so a naive unique index breaks them) + `ON CONFLICT DO NOTHING`. **Do NOT substitute a code-only guarded insert** (`INSERT … SELECT WHERE NOT EXISTS`): it is racy without the index and would provide the feeling of idempotency while still duplicating under the exact concurrent-redelivery case it is meant to stop. Note Meta retries on non-2xx, so duplicates do not require an attacker — and W0a2 adds no replay window (Meta sends no signed timestamp), so signature verification narrows this but cannot close it.

**Note on E5/E6/E9/`approval_policies`:** all four are RESOLVED in V3 (E5 built in Step 3; E9 shipped
as Release B; E6 and `approval_policies` ruled at Steps 6/5) — they leave the deferred chain rather
than carrying forward. If a ruling comes back NEVER, that is a resolution, not a deferral.

---

## Corrections to the source docs (re-grepped 2026-07-16 — both docs are days old)

1. **REPORT §Part 3 "Unverified: whether `/pay/:token` and `/gift-card/:code` carry `?tenant=`" — NOW
   VERIFIED, and it splits.** `/gift-card` **does** carry it (`GiftCardBalancePage.jsx:17,27`);
   `/pay`'s generated QR URL **does not** (`pay-at-table.js:130` builds `${frontendBase}/pay/${token}`
   with no `?tenant=`, though `RestaurantPayPage.jsx:24` reads one if present). **This does not affect
   the OG step** — both are in the no-preview bucket. It resolves the user's flagged concern the good
   way: **all six BRAND-bucket routes carry the slug with no DB lookup** (`/store`, `/book`,
   `/book-room`, `/reserve`, `/inquire` as path params; `/menu/:token` carries `?tenant=` via
   `OrderKiosksRedesign.jsx:36`). The OG middleware is cheap for the entire brand bucket. *(Side note,
   not V3 scope: `/pay`'s missing `?tenant=` on the generated QR is worth a glance someday — in MT
   mode `resolvePublicTenantDb` needs the slug — but pay-at-table works today via the token/sandbox
   flow, so it's a latent question, not a V3 item.)*
2. **PLAN-V2 E9 cites `feature-flags.js:306-315`** for the "checked separately by the caller"
   contract. The current line is **`:196-197`** (`isModuleOffAtOutlet`, "deliberately not composed
   with company-level state"). The behaviour is unchanged; the line moved. Step 2's prompt re-greps.
3. **REPORT §4.5 lists three in-memory caches; there are more.** The middleware flag/mode/company
   caches (`feature-flags.js` `_getBundle` + `getModesMap`; `tenant-auth.js` company + context-flag;
   `outlet-context.js` `_outletCache`) are the same shape and equally fail-at-2-instances. REPORT
   gestures at this ("Plus the feature-flag, mode, and company-profile caches"); Step W0a documents
   the full enumerated set.
4. **REPORT §4.2 exploitability confirmed LATENT (not live).** 0 tenants have an *active*
   meta/whatsapp/daraz `integration_settings` row (only `tenant_livetest1` has one, `is_active=false`).
   The GET verify bypass returns 200 regardless; the POST injection path no-ops today. Fix framed as
   hardening-before-connect.
5. **E9 unreachability re-confirmed.** `restaurant_kiosk_slots` = 0 on all 29 real tenants; 7 only on
   `tenant_sanoposlivetest1778021564659` (a test tenant). Matches PLAN-V2's Gate-2 measurement.

---

## Objections / mis-scope flags (raise now — this plan gets executed)

None of the scoped items is mis-scoped; the owner ruling is coherent and the source docs hold up
against current source. Two things worth stating plainly for the executor:

- **4.1's removal is wider than a one-liner.** "Delete `ADMIN_ALLOWED_IPS`" touches ~15 admin route
  files (every one destructures and passes `requireAllowedIp`). It's mechanical and self-checking
  (boot throws on a miss), but it is not a small diff — W0a is rated `high` for this reason, not
  because the logic is hard.
- **Steps 5 and 6 (the two copy rulings) may both come back NEVER**, in which case Wave 3 ships almost
  no copy code — that's a fine outcome, not a gap. The value is the *ruling being made and recorded*
  against the now-landed D2 grain, closing two items that have sat open since Step 12. Scope Step 6
  for the `high` (COPY deep-copy) case so the executor isn't caught flat if the owner rules COPY, but
  expect the effort to collapse if it's NEVER.

---

## Second-eye review incorporated (2026-07-16)

A second-eye pass found real defects in the first draft; all were verified against source and
accepted. Summary of what changed (nothing was rejected):

1. **W0b POS fix rewritten (was a genuine correctness bug in the plan).** The naive "just export
   `navigate`" fix lands the cashier on `/context-select` (authenticated → `LoginPage.jsx:238`
   redirect), not `/login`, and `parkSale()` swallows failures (`POSContext.jsx:703-705`) so a failed
   park still navigates away and loses the sale. Now: `parkSale` returns success/failure → stay in
   modal on failure → `logout()` then navigate on success. Effort raised medium → high.
2. **W0a2 split out + webhook spec corrected.** The aggregator verifier (`aggregator-orders.js:106`,
   **base64** HMAC, aggregator headers) is **not** a verbatim drop-in for Meta/WhatsApp
   (`x-hub-signature-256`, hex, app secret) or Daraz (own contract). Webhook hardening is now its own
   step with provider-specific contracts, explicit secret sources, replay-window-only-where-signed,
   and an activation guard. Split from the `ADMIN_ALLOWED_IPS` removal for review/rollback safety.
3. **Step 0 now reconciles the tree** (commits the amended `REPORT.md`/`GLOBAL-READINESS.md` with the
   plan — `git status` confirmed both modified) **and captures an exact `baseline-tests.json`
   artifact**; every gate now diffs by test id, not "~57" count.
4. **Step 1 closes the manufacturer-secret recurrence** — a production boot assertion (throw if unset
   / `=== JWT_SECRET` / low-entropy) + removal of the prod fallback in `manufacturer-auth.js`; the
   inverse of the warn-don't-throw flaw we delete in 4.1. Relaxes the "no portal-auth changes" fence
   for that one file.
5. **W0c OG spec enriched** — matcher/recursion guard, `@vercel/functions` passthrough, backend base
   + fail-closed on timeout, synthesized per-route descriptions (the endpoint has none),
   best-effort-per-isolate cache with TTL/max-size/stale, test via `vercel dev` (not `vite preview`),
   and an explicit "no-preview = generic SanoPOS shell, leaks nothing" note.
6. **W0d strengthened** — the file-allowlist reach guard is joined by a **behavioural** test (base
   perms without `all_access`, effective override with it → reach still denied) that catches a wrong
   `employeePerms` read *inside* an allowed file; the `x-outlet-id` grep made robust to
   bracket/dot/`.get()`/alias/comments.
7. **Step 3 gained a spec-then-ratify checkpoint** — the exact 7-card matrix is proposed here and
   owner-ratified (required-vs-optional) before encoding, not left to executor judgment.
8. **`DECISIONS-V3.md`** is the named destination for the three Wave-3 rulings.
