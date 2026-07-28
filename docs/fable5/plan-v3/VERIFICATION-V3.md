# Plan V3 — End-to-End Verification (PLAN-V3 Step V)

> Fresh-context verification, 2026-07-23. The verifier did **not** build this wave; every claim below
> was re-derived from source on the merged tree, a fresh full-suite run this session, or read-only
> prod probes. As-built notes (the step OUTCOME banners, `DECISIONS-V3.md`, gate records) are cited
> only where re-execution was impossible or adds nothing, and are tagged `RECORD`.
>
> **Under test:** `main` @ `d41804b6` — docs-only atop `4226f1af` (GATE 3 merge), so the code surface
> equals what shipped. All four V3 waves merged + deployed: GATE 0 `57be9133`, GATE 1 `09fa5e63`,
> GATE 2 `55e08170`, GATE 3 `4226f1af`. **Migration head v137, ZERO migrations shipped in V3.** Tree
> clean; the only branch unmerged vs main is `fix/completion-04` (unrelated to V3).

## VERDICT: **SHIP** — Plan V3 complete

Zero blocking findings. The full backend suite diffs **GATE GREEN** against the Step 0 baseline
artifact (0 new / 0 changed by test id); the three W0d guard tests are green; every completeness-table
row lands; all three `DECISIONS-V3.md` rulings are recorded; prod read-only spot-checks are green.

**One item is open by design, not a failure:** **W0-ops (4.4, R2 custom domain)** — an owner-executed
ops action whose Done-when box the plan itself leaves `☐`. It is confirmed **not** executed on prod
(`R2_PUBLIC_URL` unset, `/r2` proxy still serving), which is the correct state: the plan's own
2026-07-22 verification note downgraded it from "env-only" to "has two code blockers, re-scope before
executing." It never gated any code wave and image serving is intact. It carries forward as an owner
action (see §5). Every code/config/docs step is verified done.

### Evidence-type key

| Tag | Meaning |
|---|---|
| SUITE | Fresh full backend suite (this session, the exact pinned baseline command) or a fresh frontend-unit run |
| SRC | Re-derived from source on the merged tree this session (grep/read), not from an as-built note |
| PROD-RO | Read-only prod probe this session — unauthenticated HTTP or Railway log read; no writes |
| RECORD | Prior gate/step as-built evidence, cited where re-execution adds nothing (justified inline) |

### Fresh test-run summary (this session)

| Run | Result |
|---|---|
| **Full backend suite** vs `baseline-tests.json` (`npx vitest run --reporter=json --no-file-parallelism --testTimeout=60000 --hookTimeout=120000`, `backend/` cwd, session TZ UTC, local PG `sanopos_test` @ v137) → `check-baseline.js` | **GATE GREEN — 0 new / 0 changed.** 2485 tests, **2411 passed**; failing set **33 test-level + 39 file-level = 72**, byte-identical count to the 72 known-red @ `3b45f25c`, and identical by test id (no NEW, no CHANGED, no NOW-PASSING). `check-baseline.js` exit 0. |
| W0d guard tests | `outlet-reach-invariant.test.js` **3/3** (1a file-allowlist + 1b behavioural base-vs-effective + control), `outlet-id-single-reader.test.js` **1/1** (test 2) — both green |
| E5 checklists | `pg-business-modules-checklist.test.js` **7/7**, `business-modules-checklist.test.js` (unit) **11/11** |
| Steps 5–6 copy rulings | `pg-step12-outlet-copy-settings.test.js` **19/19** (incl. the `approval_policies` COPY case + the `modifier_groups` NEVER case), `pg-step12-outlet-copy-drift.test.js` **3/3** (allowlist has `approval_policies`, not `modifier_groups`) |
| Step 1 / 4.3 | `tenant-auth-scope-gate.test.js` **6/6**, `manufacturer-auth-getsecret.test.js` **4/4**, `boot-assert-secrets.test.js` **12/12** |
| W0a2 / E9 | `meta-webhook.test.js` **18/18** (GET-bypass pin + hex HMAC), `pg-restaurant-kiosk.test.js` **13/13** |
| Frontend units (24 files) | **199/199** |

The known-red 72 are the documented families (37 legacy pre-Postgres file-level crashes, pg-batch2/3/8
stale open-shift fixtures, 3 Jest-syntax files, `smoke-gate.js`, and the ~17 date/env-sensitive
"other" set). None was investigated, per the baseline contract. The gate's own value is that it
diffs **by id**: a real regression hiding behind an unchanged total would trip it, and it did not.

---

## 1) Per-step verification — every Done-when box re-derived

Each step's status column shows `☑` in the tracker; below, each acceptance criterion is
independently re-confirmed on the merged tree (SRC) plus the fresh suite (SUITE).

### WAVE 0 (→ baseline, GATE 0 `57be9133`)

| Step | Done-when | Result | Evidence |
|---|---|---|---|
| **W0a** 4.1 delete `ADMIN_ALLOWED_IPS` | Fully removed, boot clean | ✅ | SRC: grep `ADMIN_ALLOWED_IPS`/`requireAllowedIp`/`parseAllowedIps` = **zero `.js` prod hits** (only two CLAUDE.md docs describing the removal); test passthrough stubs in 5 test files only; no `[SECURITY]` line in `index.js`. PROD-RO: `GET /api/admin/tenants` no-token → **401** (token-gated, not IP-blocked) |
| **W0a** 4.5 in-memory state docs | Documented in `backend/CLAUDE.md` | ✅ | SRC: "Horizontal-scaling preconditions" table enumerates `displayStore`, alerting windows, menu-schedule cache, feature-flag/mode/`_companyCache`(`COMPANY_CACHE_MS`)/context-flag/`_outletCache` |
| **W0a2** 4.2 webhook sig | 3 fixes (2 providers) fail-closed with correct format; GET bypass closed; activation guard | ✅ | SRC: `services/meta-webhook.js` — `x-hub-signature-256`, hex `createHmac("sha256")` over raw body keyed on `META_APP_SECRET`, `timingSafeEqual`, `verifyHandshake` refuses an unset token; `credentials.js:32` `WEBHOOK_SECRET_NOT_CONFIGURED` activation guard; Daraz deliberately unverified → V4-3 (routes/CLAUDE.md table). SUITE: `meta-webhook` 18/18. PROD-RO (GATE 0 RECORD): GET no-token → 403, bad-sig POST → 401 |
| **W0b** POS session-expired + KDS chrome | `parkSale` returns success/failure + callers audited; modal stays on failure, logs out then `/login` on success; `navigate` exported; `/kds` escaped shell auth+perm both directions | ✅ | SRC: `POSContext.jsx:677` `parkSale` returns explicit bool (`return true` on empty; comment :670–676), `navigate` on the value object (:981) + WAVE-C comment updated (:29); `/kds` at `publicRoutes.jsx:179–193` on the escaped shell wrapped `RequireAuth→RequireContext→RequirePerm("manage_kds")` (not `AppLayoutRedesign`). SUITE: frontend units 199/199 |
| **W0c** OG middleware | Six brand routes branded; four no-preview generic; browsers bypass; recursion-guarded + fail-closed | ✅ | SRC: `frontend/middleware.js` exists (deny-list-first, documented in `frontend/CLAUDE.md`). PROD-RO: crawler-UA `/store/livetestauto` → `x-og-mw: brand`, `og:title="livetestauto"`, synthesized `og:description="Shop online at livetestauto."`, `og:image` = generic default fallback (no tenant logo); `/receipt/…` crawler → `x-og-mw: no-preview`; real-browser UA → `x-og-mw: bypass-ua` |
| **W0d** invariant guards | 1a+1b+2 green on main; each bites on its own injected violation | ✅ | SUITE: `outlet-reach-invariant` 3/3, `outlet-id-single-reader` 1/1; neither in the baseline red set, so green is meaningful. Injected-violation bite = RECORD (§W0d outcome, `8ee9ab1a`) |
| **W0-ops** 4.4 R2 domain | cdn bound; `R2_PUBLIC_URL` set; orange cloud not flipped | ⏸ **OPEN by design** | PROD-RO: `cdn.sanopos.com` → HTTP 000 (unbound); `api.sanopos.com/r2/<missing>` → 404 (proxy **still mounted** ⇒ `R2_PUBLIC_URL` unset). Owner-ops, box `☐`; deferred with documented code blockers. See §5 |

### WAVE A — 4.3 (own release, GATE 1 `09fa5e63`)

| Step | Done-when | Result | Evidence |
|---|---|---|---|
| **Step 1** manufacturer scope + boot assertion | Scope check rejects non-employee scopes before tenant/employee context; employee + impersonation unaffected; prod boot asserts set/distinct/non-trivial secret (prod fallback removed); env var set | ✅ | SRC: `tenant-auth.js:110` → 401 `INVALID_TOKEN_SCOPE` (before `req.tenantId`/`req.employee`); `boot/assert-secrets.js` asserts `MANUFACTURER_PORTAL_JWT_SECRET` set/≠`JWT_SECRET`/entropy in prod; `manufacturer-auth.js:36` throws in prod, `:42` dev/test fallback retained. SUITE: `tenant-auth-scope-gate` 6/6, `manufacturer-auth-getsecret` 4/4, `boot-assert-secrets` 12/12. PROD-RO: manufacturer portal `/login` junk-creds → 401 (up on the rotated dedicated secret); Railway boot clean, **no** `[SECURITY]` fallback, no assertion abort ⇒ the assertion passed (secret set/distinct in prod). Positive employee/impersonation direction = RECORD (GATE 1 live: `full`-scope token → bootstrap 200) |

### WAVE B — E9 (own release, GATE 2 `55e08170`)

| Step | Done-when | Result | Evidence |
|---|---|---|---|
| **Step 2** kiosk company-gate | Company flag ANDed at all three call sites; stale-token test green; breakage fixtures-only | ✅ | SRC: `public-restaurant.js:28–31` `kioskOrderingOff` = `getFeatureFlagsMap` + `if(!flags.phase4_restaurant) return true`; call sites `:133/:204/:277`; lookup errors fail open. SUITE: `pg-restaurant-kiosk` 13/13 |

### WAVE 3 (GATE 3 `4226f1af`)

| Step | Done-when | Result | Evidence |
|---|---|---|---|
| **Step 3** E5 checklists | 7 arrays authored + schema-verified; transitions both directions; outlet-scoped items outlet-aware; query budget unchanged; membership hole closed | ✅ | SRC: `config/business-modules.js` — 11 `setup_checklist` arrays; card→checklist map confirms the 7 new cards (`subscriptions_memberships`, `clinical`, `service_tickets`, `projects_contracts`, `commissions`, `wholesale_credit`, `field_sales`) each carry one. SUITE: integration 7/7, unit 11/11 (incl. attention→clear both ways + outlet-scoped independence + query-count assertion) |
| **Step 4** wallet WIRE-vs-RETIRE | Investigation + ruling filed; branch executed + verified; portal CLAUDE.md updated | ✅ RETIRE | SRC: `PortalWallet.jsx` deleted (glob: absent); **zero** `me/wallet`/`top-up-intent`/`wallet_tab` hits in backend prod code. `DECISIONS-V3.md` §4 records RETIRE + owner-extended admin-path retire. Drift/build = RECORD (`15c65b5d`+`6c8164ad`) |
| **Step 5** `approval_policies` copy | Grain investigation + ruling; branch executed + verified | ✅ COPY | SRC: `outlet-copy.js:118` `table:"approval_policies"` in `COPY_SPECS`; `DECISIONS-V3.md` §5 records COPY (2026-07-23) with the post-D2 grain analysis (role_id tenant-global carries). SUITE: settings 19/19 (outlet-specific row copied with `outlet_id` rewritten + `role_id` intact; global row not duplicated), drift 3/3 |
| **Step 6** `modifier_groups` copy | Deep-copy scoping + ruling; branch executed + verified | ✅ NEVER | SRC: `outlet-copy.js:26` `modifier_groups` in the never-copy block; `DECISIONS-V3.md` §6 records NEVER (de-facto tenant-global — `getModifierTreeForProduct` outlet-blind). SUITE: settings 19/19 (regression case asserts zero modifier rows scoped to the new outlet), drift allowlist stays 7 tables |

**Every step's Done-when criteria are satisfied on the merged tree, with the single by-design exception of W0-ops (4.4).**

---

## 2) Completeness-contract ledger walk — every row lands

Walking the table at `PLAN-V3.md` (§"Completeness-contract table"). Disposition column is the plan's;
the outcome column is this verification.

| Item | Disposition | Lands as | Outcome |
|---|---|---|---|
| 4.1 `ADMIN_ALLOWED_IPS` fails open | W0a DELETE | Step | ✅ removed (SRC) |
| 4.2a `undefined===undefined` GET bypass | W0a2 | Step | ✅ closed (SRC + SUITE meta-webhook) |
| 4.2b unsigned meta/whatsapp | W0a2 | Step | ✅ hex HMAC + activation guard (SRC + SUITE) |
| 4.2c unsigned **daraz** | Deferred → V4-3 | Deferred-v4 | ✅ in V4 list; deliberately unverified (contract unpublished) |
| 4.3 manufacturer JWT + scope | Step 1 / Release A | Step | ✅ scope gate + boot assertion (SRC + SUITE + PROD-RO) |
| 4.4 grey-cloud R2 | W0-ops (owner) | Step (owner-ops) | ⏸ **open by design** — not executed, correctly deferred (§5) |
| 4.5 in-memory state | W0a docs | Step | ✅ documented (SRC) |
| KDS full chrome | W0b | Step | ✅ escaped shell (SRC) |
| POSContext `navigate` bug | W0b | Step | ✅ exported + `parkSale` bool (SRC) |
| OG/social preview | W0c | Step | ✅ middleware live (PROD-RO) |
| Dead portal `wallet` tab | Step 4 | Step | ✅ RETIRE (SRC + DECISIONS §4) |
| E5 setup checklists | Step 3 | Step | ✅ 7 arrays (SRC + SUITE) |
| E9 restaurant company gate | Step 2 / Release B | Step | ✅ (SRC + SUITE) |
| E6 `modifier_groups` copy | Step 6 | Step | ✅ NEVER (SRC + SUITE + DECISIONS §6) |
| `approval_policies` copy | Step 5 | Step | ✅ COPY (SRC + SUITE + DECISIONS §5) |
| Invariant (1) outlet reach on base perms | W0d | Step | ✅ guard green (SUITE) |
| Invariant (2) single `x-outlet-id` reader | W0d | Step | ✅ guard green (SUITE) |
| Customer-display GET no-auth | OUT (deliberate design) | OUT | ✅ accounted; its `displayStore` covered by 4.5 |
| Env-var URL 5-fallback | OUT → Deferred v4 (V4-2) | Deferred-v4 | ✅ in V4 list |
| Generated 1200×630 OG card | OUT → Deferred v4 (V4-1) | Deferred-v4 | ✅ in V4 list |
| `public-rentals.js` orphan | OUT → E7 | OUT | ✅ frozen by drift test |
| recipe-costing no tab | OUT → E7 | OUT | ✅ accounted |
| SEO/PWA | OUT (verified clean) | OUT | ✅ accounted |
| GLOBAL-READINESS.md in full | OUT (one epic behind one trigger) | OUT | ✅ accounted |
| SCREEN-GAPS.md in full | OUT (chrome fix is W0b; screen gaps not) | OUT | ✅ accounted |
| E1 / E2 / E3 / E4 | OUT → Deferred v4 | Deferred-v4 | ✅ in V4 list |
| E7 78 orphaned endpoints | OUT (own plan, twice-ruled) | OUT | ✅ accounted |
| E8 preset operator roles | OUT → Deferred v4 | Deferred-v4 | ✅ in V4 list |
| AI platform strategy folder | OUT (separate effort) | OUT | ✅ accounted |

**Deferred-to-v4 running list** (`PLAN-V3.md`): E1, E2, E3, E4, E7, E8, V4-1 (OG card), V4-2 (env-URL
hardening), **V4-3 (Daraz push sig)**, **V4-4 (WhatsApp `external_id` idempotency — needs a migration)**.
V4-3/V4-4 share the trigger "before any tenant activates a channel integration" (still 0 active channel
configs — re-verify before relying; not re-checked live this session as it needs a DB query, RECORD
2026-07-16 + GATE records).

**Unaccounted items: none.** Every row is a step (verified), an explicit OUT, or a Deferred-v4 row.

---

## 3) The three `DECISIONS-V3.md` rulings — all recorded

| Step | Ruling | Recorded | Executed |
|---|---|---|---|
| 4 — portal `wallet` tab | **RETIRE** (+ owner-extended: the broken admin online-top-up link + dead webhook credit) | ✅ `DECISIONS-V3.md` §4, owner ruling 2026-07-22 | `15c65b5d` + `6c8164ad` |
| 5 — `approval_policies` | **COPY** | ✅ §5, owner ruling 2026-07-23 | `86648120` |
| 6 — `modifier_groups` | **NEVER** | ✅ §6, owner ruling 2026-07-23 | `7ba816c4` |

The rulings include their investigations, options, and execution records. **D8 copy ledger closed:
6 COPY / 7 NEVER**, no candidate unruled.

---

## 4) Prod read-only spot-checks — the four named checks

| Check | Result | Evidence |
|---|---|---|
| Admin login sans allowlist | ✅ | PROD-RO: `GET /api/admin/tenants` no-token → **401** (reachable + token-gated from an arbitrary IP; the IP allowlist is gone). Boot: no `[SECURITY]` line |
| Manufacturer scope reject + boot-assertion note | ✅ | Scope reject: SRC `tenant-auth.js:110` + SUITE `tenant-auth-scope-gate` 6/6 (negative direction — a prod-signed forged token is neither craftable nor appropriate to mint). Boot assertion: PROD-RO Railway boot clean at v137, no `[SECURITY]` fallback + no assertion abort ⇒ the dedicated secret is set/distinct; manufacturer portal `/login` up (401 on junk). Positive direction = RECORD GATE 1 |
| Brand-route crawler preview | ✅ | PROD-RO: crawler-UA `/store/livetestauto` → `x-og-mw: brand` with tenant name stamped into `og:title`/`og:description`; `/receipt` crawler → `x-og-mw: no-preview`; browser UA → `x-og-mw: bypass-ua` |
| `golv_*` checklist payload | ✅ (via deployed config + tests + RECORD) | The 11 `setup_checklist` arrays are source-verified in the **deployed** config; the machinery + attention→clear transitions + outlet-awareness + query budget are proven by SUITE (integration 7/7, unit 11/11). A fresh **authenticated** prod pull was **not** run by this verifier (it requires dashboard password auth, which I do not perform; `golv_*` tenants have only Owner/PIN, no recorded dashboard password — the same gap GATE 3 hit, which used `tenant_wholesalewalktest1778451`). Owner-runnable re-pull: `mt-login` on any tenant with a covered card enabled, then `GET /api/business-modules` and confirm the nested per-module checklists. Live authenticated pull = RECORD GATE 3 |

Additional prod-RO: deep health **200** (DB ~35 ms, Resend ~345 ms); Sentry `node-express` **no
unresolved issues**; Railway per-tenant `Schema is up to date (version 137)` (no migrations); pg-boss +
workers registered, adoption `tenant_count=29`.

---

## 5) The one open item — W0-ops (4.4), owner action, carried forward

Not a gap in V3's shippable scope; it is the single owner-ops step the plan intentionally left `☐`.

- **State on prod (PROD-RO):** `cdn.sanopos.com` unbound (HTTP 000); `api.sanopos.com/r2/<missing>` →
  404, i.e. the `/r2` proxy is **still mounted**, which means `R2_PUBLIC_URL` is unset. So 4.4 is
  **not executed** — and that is the safe state.
- **Why deferred (correct):** the plan's 2026-07-22 verification note found the "nothing to build /
  env-only" framing wrong — setting `R2_PUBLIC_URL` un-mounts the proxy (legacy stored `image_url`
  rows 404) **and** a public R2 domain would expose the whole `sanopos-uploads` bucket (backups, PHI).
  Minimum-viable path is keep-proxy-mounted + a Cloudflare WAF default-deny allowlist, or a code
  change — not a blind env flip. Tracked in memory `r2_cdn_migration_blockers`.
- **Impact today:** none. Asset serving works via the `/r2` proxy; the only cost is that images route
  through the single Railway process rather than a CDN.
- **Action:** remains an owner task, to be re-scoped before executing. It does not block declaring the
  V3 code/config/docs waves complete.

---

## 6) Findings

All non-blocking.

- **F-1 (open by design, not a defect):** W0-ops (4.4) unchecked — §5. Owner action, carried forward.
- **F-2 (verifier scope, documented):** the `golv_*` checklist payload was verified via deployed
  config + passing E5 tests + the GATE 3 live record, not a fresh authenticated prod pull, because
  this verifier does not perform password authentication and `golv_*` tenants carry no dashboard
  password. §4 gives the owner-runnable command. No product concern — the code path is deployed and
  test-proven.
- **F-3 (latent, tripwire not schedule):** V4-3 (Daraz) and V4-4 (WhatsApp idempotency) stay latent
  only while **0 tenants have an active channel `integration_settings` row**. This was NOT re-queried
  live this session (needs a Supabase read; last confirmed 2026-07-16 + GATE records). Re-verify the
  zero-active-config claim before anyone connects a channel; V4-4 needs a migration so it is
  structurally a v4 item.
- **F-4 (verification environment):** the local `sanopos_test` DB carries prior-run residue (7 leftover
  tenant schemas, a fully-populated `public` schema); the suite seeds isolated schemas per test, so
  this is inert — but a verifier expecting a pristine DB will be surprised. `--no-file-parallelism` is
  load-bearing (concurrent vitest emits environmental hook-timeouts that poison the diff); the full
  run was single-process, and the frontend units ran only after the backend suite finished for the
  same reason.

---

## 7) Method notes

- **No prod writes of any kind.** Prod evidence is unauthenticated HTTP probes (health, admin 401,
  OG headers, manufacturer-portal 401 on deliberately-wrong creds, R2 proxy 404) + a Railway log read
  + a Sentry issue list. No token was minted, no password was entered, no tenant data was mutated.
- **The baseline diff is by test id, not count** (`check-baseline.js`), run with the exact pinned
  command; a regression hiding behind an unchanged total would trip it. Result: 72 fresh red = 72
  baseline red, identical ids, 0 new / 0 changed / 0 now-passing.
- **Re-derivation over trust:** every step's landing was confirmed against merged source (grep/read),
  not read off the OUTCOME banners. Where a live prod negative-direction test was impossible without
  minting a prod-signed token (the manufacturer scope reject) it is carried by the unit suite + code,
  with the positive direction from the GATE 1 record — explicitly tagged, not silently assumed.
- **Model note:** requested model for this step was `claude-fable-5 / high`; run on `claude-opus-4-8`
  (per the plan's fallback clause, effort held at high with a self-review of the evidence before
  filing).
