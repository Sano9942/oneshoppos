# Subsystem Audit 07 — Testing, CI/CD, Developer Tooling

> **RAW EVIDENCE — read with care.**
> Produced by a read-only source-code audit on **2026-07-29** at commit **`3b84732d`**.
> Findings are graded **REPORTED** unless the [main report](../01-architecture-report.md) marks them CONFIRMED.
> Where this document and the main report disagree, **the main report wins**.
> Line numbers drift: **grep the named symbol, don't trust the number.**

---

## 1. Package manifests & tooling versions

**There is no root `package.json`.** The repo is two independent npm projects (`backend/`, `frontend/`) plus a root `node_modules/` and loose `tools/`, `scripts/`, `shared/` directories. No workspaces, no Turbo/Nx/Lerna.

### 1.1 `backend/package.json`

| Script | Command | Status |
|---|---|---|
| `start` / `dev` | `node index.js` | live |
| `dev:prod` | `node scripts/dev-prod.js` | live — requires `-- --yes-really` |
| `preflight` | `node preflight.js` | ⚠️ **DEAD — file does not exist** |
| `parity:audit` + 3 variants | `node ../tools/api-parity-audit.js …` | ⚠️ **DEAD ×4 — `tools/api-parity-audit.js` does not exist** |
| `test` | `vitest run` | live |
| `test:unit` / `test:integration` | `vitest run tests/{unit,integration}` | live |
| `test:smoke` | `vitest run tests/integration/smoke-gate.test.js` | ⚠️ **DEAD — target cannot load (§7.1)** |
| `test:coverage` | `vitest run tests/unit --coverage` | live |
| `typecheck` | `tsc --noEmit` | live |

Test deps (:56-62): `vitest ^4.0.18`, `@vitest/coverage-v8`, `supertest ^7.2.2`, `typescript ^6.0.2`, `pino-pretty`.
⚠️ **No `jest`, no `eslint`, no `prettier` anywhere in backend.**

### 1.2 `frontend/package.json`
Scripts (:6-26): `dev`, `build` (`vite build && node scripts/prerender-meta.mjs`), `lint`, `preview`, three **dead** `parity:*` (:11-13), `test`/`test:watch`/`test:unit`, six Playwright suites, `typecheck`, `lint:baseline` / `lint:baseline:update`.

Tooling (:43-63): `@playwright/test ^1.58.2`, `@axe-core/playwright ^4.11.3`, `vitest ^4.0.18`, `jsdom ^28.1.0`, `fake-indexeddb ^6.0.0`, Testing Library, `eslint ^9.39.1`, `eslint-plugin-react-hooks ^7.0.1`, `vite ^7.3.1`.
⚠️ `@axe-core/playwright` is installed but **zero specs import it** — accessibility testing is dependency-only.

---

## 2. Backend test suite

### 2.1 Counts

| Location | Count |
|---|---|
| `tests/integration/*.test.js` | **202** |
| `tests/unit/*.test.js` | **53** |
| `tests/helpers/*.js` | 5 |
| **Total** | **255** |

### 2.2 Integration naming waves
Files are named by *build campaign*, not domain — the project's archaeology is legible in the filenames:

| Prefix | Count | Meaning |
|---|---|---|
| `pg-batch<N>-*` | 16 | Numbered horizontal sweeps |
| `pg-batch-*` (named) | 13 | Cross-cutting slices |
| `pg-admin-*` | 15 | Super-admin route coverage |
| `pg-v0*` / `pg-v1*` | 17 | Vertical depth (grocery, van-pod, food, salon, clinical, gym, photography, rentals, lodging) |
| `phase2g-wave1/2/3-*` | 12 | Gift cards, loyalty, price books, serialized inventory |
| `pg-phase21a/b/c`, `pg-phase2g8-*` | 10 | Restaurant courses/modifiers/split/KDS/tips; inventory intelligence |
| `pg-f0*` | 8 | Foundational groups (kit/BOM, packages, dunning, notifications, scheduling, batch, forms) |
| `pg-step*` | 6 | PLAN-V2/V3 outlet-context steps |
| `pg-restaurant-*` | 6 | Restaurant verticals |
| `pg-ws1[a-d]` | 4 | Money/stock-writer hardening |
| `pg-business-modules-*` | 4 | Module toggle engine |
| `pg-p2*` / `pg-p3*` | 6 | Point-fix regressions for named production bugs |
| `pg-completion0*` | 2 | Completion-audit fixes |
| **Standalone (no prefix)** | **43** | The original SQLite-era suite |

### 2.3 Helper: `tests/helpers/createTestApp-pg.js` (531 lines)
Schema isolation:
- `:391` — `const schemaName = "test_" + crypto.randomBytes(6).toString("hex")` — fresh random schema per call
- `:394-396` — checks out **one dedicated pool client**, `CREATE SCHEMA`, `SET search_path`. Isolation is per-client, not per-transaction
- `:399` — `seedSchema(client)` runs the *entire* `schema-pg.sql`
- `:402` — `createScopedDb(client)`; `db.getClient()` returns a client whose `release()` is a **no-op** (:137-140) so route code can't hand the schema-scoped client back to the pool
- `:414-418` — explicitly calls `invalidateModeCache()` + `invalidateFeatureFlagCache()` after seeding, because `requireMode` is fail-closed and a stale empty map leaking from a prior test file in the same fork would 403
- `:501-526` — `cleanup()` drops **tables in batches of 40** before `DROP SCHEMA … CASCADE`, with an in-code explanation (:504-507): ~244 tables each taking an `AccessExclusiveLock` exceeds `max_locks_per_transaction` (default 64)
- Seeded fixtures + `setval()` sequence resets (:381-387)
- ⚠️ `PERMISSION_RULES` is **duplicated verbatim** (:100-131) as a mirror of `middleware/permissions.js` — a hand-maintained copy with **no drift guard**
- Shopify stubbed (:21-43, 16 no-ops)

### 2.4 Helper: `tests/helpers/vitest-setup.js`
Env selection (:18-24): resolves `backend/.env.test` and `backend/.env`, loads `.env.test` **when present**, otherwise `.env` — which the file's own comment (:16-17) says "keeps pointing at production Supabase." Wired via `backend/vitest.config.js:11`.

### 2.5 `backend/vitest.config.js`
`environment: "node"`, `testTimeout: 15000`, `hookTimeout: 10000`, `pool: "forks"`, `isolate: true`, `globals: true` (:5-11).
⚠️ Coverage (:12-29) is include-listed to **`utils/**`, `services/**`, `middleware/**`, `category-tree.js` only** — `routes/**`, `workers/**`, `jobs/**` are **explicitly excluded**, so `test:coverage` says nothing about the ~1,344-endpoint surface.

### 2.6 Other helpers
- `tests/helpers/request.js` — supertest `Proxy` auto-attaching `x-employee-id`; exports `ADMIN_ID=1`, `MANAGER_ID=2`, `CASHIER_ID=3`
- ⚠️ `tests/helpers/globalTeardown.js` — drops orphaned `test_%` schemas. Its header says "Jest global teardown … Wired via jest.config.js" (:1-6). **Vitest never invokes it** (§7.2). The manual replacement is `backend/scripts/drop-test-schemas.js`

---

## 3. Frontend test suite

### 3.1 Counts

| Suite | Files | `test()` blocks |
|---|---|---|
| `tests/unit/*.test.js(x)` (Vitest) | **25** | — |
| `tests/*.spec.js` (Playwright) | **29** | **326** |
| `tests/smoke/*.smoke.spec.js` | **24** | **67** |
| `tests/sweep/functional-sweep.spec.js` | **1** (899 lines) | **50** |
| **Total** | **79** | **443** Playwright tests |

### 3.2 Unit tests
Configured *inside* `frontend/vite.config.js:35-39`: `jsdom`, `setupFiles: ['./tests/setup.js']`, `globals: true`. `tests/setup.js` is two lines — `@testing-library/jest-dom` + `fake-indexeddb/auto`.

Coverage areas: cart math (3 files), design-system primitives (3), offline queue (3), barcode/scale parsing (3), auth guards, contexts, chunk-reload recovery, dental chart, business-modules outlet helpers, outlet role overrides, POS open-check, restaurant cart grouping, price-book CSV parsing, loyalty wallet config, admin support screenshots, and **`design-token-drift.test.js`**.

### 3.3 Playwright config
- `testDir: "./tests"`, `testMatch: "*.spec.js"`
- ⚠️ **`baseURL: "https://sanopos.com"` (:17)** — there is no local/staging target. Every E2E and smoke spec mutates **live production**. `helpers/auth.js:25` sets `BACKEND = "https://api.sanopos.com"`
- `fullyParallel: false`, `workers: 1`, `retries: 0` (:6-9) — deliberate, because specs share production state
- `storageState: "./tests/auth.json"`; both `auth.json` and `token.json` are gitignored
- Two projects: `chromium` (ignores `sweep/`), and `sweep` (**4-hour per-spec timeout**, `headless: false`, `slowMo: 200`, `trace: "on"`)

### 3.4 `global-setup.js` — **hard-fails on login failure** ✅
- `:12-23` — `onlySweepProject()` returns early if only `--project=sweep` is requested, so a dead shared tenant cannot block the sweep
- `:30-46` — `loginMT(page)`; writes `auth.json`; extracts `authSession.token` and **throws if the token is absent even though `/dashboard` was reached** (:41-45), because `helpers/api.js` would otherwise send `Bearer null` on every call
- `:47-65` — `catch` **rethrows**. The comment is explicit: *"HARD FAIL — do not warn-and-continue… This used to warn and return, so a dead shared tenant produced a run that looked green"*. The message names the tenant, employee, cause, and env-var override

### 3.5 Helpers
- ⚠️ `tests/helpers/auth.js` — **single source of truth** for the tenant, but with **live production credentials committed in plaintext** (:20-25): `E2E_TENANT || "livetestauto"`, `"Sweep Operator"`, `"SweepRun123!"`, PIN `"1234"`, `BACKEND || "https://api.sanopos.com"`. `loginMT` uses `.or()` + `.first()`; the username matcher is `/employee (username|name)/i` (:47) — deliberately widened after a Square-reskin rename silently broke 45 call sites
- `tests/helpers/api.js` — REST helper reading the Bearer token from `tests/token.json`; `ensurePOSReady()` opens a shift + PIN-checks-in
- `tests/helpers/nav.js` — `navigateTo`, `waitForPageShell`, `clickSidebarLink`

### 3.6 Smoke suite — 24 specs, 67 tests
- **Restaurant cluster (10 specs, 27 tests)**: shell (5), restaurant (3), void-comp (3), reservations (3), kds-analytics (3), 86 (2), pay-at-table (2), menu-schedules (2), printer-routing (2), menu-engineering (2)
- **Commerce/back-office**: catalog-advanced (5), omnichannel-admin (5), m2-tickets-subscriptions (6), phase5-pakistan (4), pricing-promotions (2), draft-orders-returns (2), invoicing-subscriptions (2), commissions-reports (2), insights-dashboard (2), marketing-messaging (2), bookings (2), service-workspace (2), storefront-public (2), workforce (2)

Smoke helpers (307 lines total): `smokeRunId.js` (8), `featureFlags.js` (59 — `isFlagEnabled`, `skipIfFlagOff`, `softSkip`), `cleanup.js` (102 — LIFO, best-effort, 404 = success), `mockPaymentGateway.js` (138 — `page.route()` stubs for xPay/JazzCash/Easypaisa/courier/SMS).

**21 of 24 smoke specs** call `skipIfFlagOff`/`softSkip`. The 3 that don't: `insights-dashboard`, `omnichannel-admin`, `storefront-public`.

---

## 4. CI — `.github/workflows/`

**Only two workflow files exist.** No test job, no build job, no deploy job, no `npm audit`, no dependency bot, and no git hooks.

### 4.1 `lint-guard.yml` — job `lint-baseline-guard`
- Triggers: `push` to `main` + all `pull_request` (:17-20)
- Node 22, `npm ci`, `working-directory: frontend`
- Step 1 (:36-37): `npm run lint:baseline` — the ESLint ratchet
- Step 2 (:38-39): `npx vitest run tests/unit/design-token-drift.test.js eslint-rules` — token-drift guard **plus** the two ESLint RuleTester suites

The 14-line header (:1-14) states the rationale verbatim: lint reports ~1000 problems, 664 of them one in-flight migration; gating on clean lint would block every deploy; leaving lint advisory is "how 13 files quietly ended up on the retired colour palette."

### 4.2 `tz-guard.yml` — job `tz-date-boundary-guard`
- Same triggers; `working-directory: backend`; Node 22
- Single step (:32-33): `npx vitest run tests/unit/tz-date-boundary-guard.test.js tests/unit/tz.test.js`
- Header (:1-10) documents three banned patterns: `new Date().toISOString().slice(0,10)` as "today", SQL `CURRENT_DATE`/`now()::date`, and bare `::date`/`date(col)` on TIMESTAMPTZ. Explicitly "No database needed."

### 4.3 What actually gates a merge
**Four things, all fast and DB-free:**
1. ESLint baseline non-regression (frontend)
2. Design-token drift (frontend, 1 file)
3. ESLint custom-rule unit tests (frontend, 2 files)
4. tz-boundary source scan + `tz.js` unit tests (backend, 2 files)

⚠️ **Not gated:** all 202 backend integration tests, all 53 backend unit tests (except the 2 tz ones), all 25 frontend unit tests (except 1), all 443 Playwright tests, `tsc --noEmit` on either project, and `vite build`.

### 4.4 The lint-baseline mechanism
`frontend/scripts/lint-baseline.mjs` (108 lines):
- `collect()` (:38-50) runs ESLint over `.` and builds a `{"path::rule-id": count}` map, normalizing to forward slashes "so Windows and CI agree" (:37)
- `--update` writes the sorted map to `frontend/lint-baseline.json`
- Check mode (:76-102): fails **only on per-`(file, rule)` increases**, keyed on the pair — because "fixed one in A, added one in B" must still fail and "a global count would be trivially gameable" (:16-17)
- Reductions are informational only — fixing things can never fail the gate
- Header (:12-14) cites sibling precedent: `check-baseline.js` and `frontend-coverage-drift` — "NEW/CHANGED id, never totals"

Current baseline: **353 `(file, rule)` pairs / 1,007 problems**:

| Rule | Count |
|---|---|
| `sano/no-raw-interactive` | 664 |
| `no-unused-vars` | 116 |
| `react-hooks/exhaustive-deps` | 88 |
| `react-hooks/set-state-in-effect` | 42 |
| `(no-rule)` | 38 |
| `react-refresh/only-export-components` | 26 |
| `no-empty` | 19 |
| `react-hooks/*` (5 more rules) | 13 |
| **`sano/no-raw-palette-color`** | **0 → de facto hard gate** |

---

## 5. Linting, custom rules, drift guards

### 5.1 ESLint config — frontend only
`frontend/eslint.config.js` (97 lines, flat config). ⚠️ **There is no backend ESLint config and no `eslint` dependency in `backend/package.json` — backend JavaScript is entirely unlinted.** No Prettier config, no `.editorconfig`, anywhere in the repo.

Blocks: `globalIgnores`; base (`js.recommended` + `reactHooks.flat.recommended` + `reactRefresh.vite`); a Node-context override for scripts/tests; `sano/no-raw-interactive: "error"` scoped to `src/pages/redesign/**`; `sano/no-raw-palette-color: "error"` scoped to **all of `src/**`** with 8 file-level `ignores` (each with an inline justification) and `allow: ["text-yellow-400","fill-yellow-400"]` for star gold.

### 5.2 Custom ESLint plugin — `frontend/eslint-rules/`
Local flat-config plugin, registered by direct import. Two rules, each with a colocated RuleTester suite:

**`no-raw-palette-color.js`** (143 lines):
- `PALETTE` (:27-32) 23 Tailwind palette names; `PREFIX` (:34-38) 16 utility prefixes
- `COLOR_CLASS` regex (:41-44) matches `(?:[a-z-]+:)*(PREFIX)-(PALETTE)-\d{2,3}(/\d{1,3})?`
- **Only fires on `JSXAttribute` where `name === "className"`** (:114-115). `collectStrings()` (:47-78) walks Literal, TemplateLiteral, Conditional, Logical/Binary, Array, and CallExpression (so `clsx`/`cn`/`classNames` args are covered)
- **The central design decision** (header :6-19): inline className literals are *chrome*; colours indirected through a lookup map (`STATUS_COLORS`, `EMPLOYEE_COLORS`, Recharts series, dental-chart condition codes, SetupWizard's 23 industry tiles) encode *data* and are structurally invisible to the rule. **This is why the rule can sit at zero.**
- 16 RuleTester cases

**`no-raw-interactive.js`** — bans raw `<button>`/`<input>` in favour of `ui/primitives`; excludes input types with no primitive equivalent (`file`, `checkbox`, `radio`, `hidden`, `range`, `color`); allows icon-only buttons carrying `aria-label`. 22 RuleTester cases.

### 5.3 Drift-guard tests
Grepping `drift` across test files returns 20 hits. The load-bearing ones:

| Guard | File | Mechanism |
|---|---|---|
| **Design-token drift** | `frontend/tests/unit/design-token-drift.test.js` | Collects `--token:` definitions from every `.css`, then regexes every `(--x)`/`var(--x)` reference and asserts each is defined. Header explains the silent failure: Tailwind v4's `bg-(--x)` compiles regardless of whether `--x` exists — 9 undefined tokens across 24 sites had accumulated. **In CI** |
| **Frontend-coverage drift** | `backend/tests/unit/frontend-coverage-drift.test.js` | Imports `runScan` from `docs/fable5/frontend-coverage-audit/scan.cjs` and diffs against a baseline JSON. Fails only when a **new** orphan endpoint appears — the class can shrink but never silently regrow. Sanity check asserts `backendRoutes > 500` |
| **Permissions-catalog drift** | `backend/tests/unit/permissions-catalog.test.js` | Scans route guards vs `config/permissions-catalog.js` |
| **Business-modules catalog drift** | `business-modules-catalog.test.js` + `business-modules-checklist.test.js` | Every `DEFAULT_FEATURE_FLAGS` key must be classified exactly once |
| **Feature-flag consumer drift** | `feature-flag-consumer-drift.test.js` | Classified ≠ consumed; requires a runtime reader or an exemption with a >15-char reason |
| **Outlet-header single reader / reach invariant** | `outlet-id-single-reader.test.js`, `outlet-reach-invariant.test.js` | File allowlists + a behavioural pin |
| **Dockerfile pg_dump** | `dockerfile-pg-dump.test.js` | Asserts `postgresql*-client` is installed **after the last `FROM`** |
| **tz-date-boundary** | `tz-date-boundary-guard.test.js` | Repo-wide regex ban with per-line allowlist. **In CI** |

⚠️ `check-baseline.js` lives at `docs/fable5/plan-v3/check-baseline.js` — referenced as prior art by both CI headers, but **not wired into any npm script or workflow**.

---

## 6. Other tooling

- **`backend/swagger.js`** (104 lines) — `swagger-jsdoc` OpenAPI 3.0.0. Hand-written component schemas for only **5 entities** (Product, Sale, Customer, Order, Error) and 8 tags. Mounted at `/api-docs` behind a shared-secret gate: **404 if `API_DOCS_KEY` unset, 401 unless `?key=` matches**
- **`backend/scripts/`** (24 files) — ⚠️ 16 are `__phase4_*`/`__phase5_*` one-off production probes left in-tree. Real tooling: `dev-prod.js`, `drop-test-schemas.js`, `backup-all-tenants.js`, `reconcile-mode-flags.js`, `seed-tax-rates.js`, `sqlite-to-pg.js`, `verify-schema-apply.js`
- **`frontend/scripts/`** — `lint-baseline.mjs` and `prerender-meta.mjs` (post-build static-shell prerender for 13 marketing routes; header warns `ROUTES` must stay in sync with `industries.js` **by hand**)
- **`scripts/build-sweep-findings.mjs`** (root) — reads sweep results and emits a severity-graded triage markdown
- **`tools/`** — `inspect-slow-queries.js`, `marketing-seed/seed.mjs`. (`api-parity-audit.js`, referenced by 7 npm scripts, is **absent**)
- **`docker-compose.yml`** (root, 13 lines) — a single `postgres:15-alpine` service. Dev-database only; no app service
- **`backend/Dockerfile`** — 2-stage Alpine. Stage 1 installs `python3 make g++` for the `sqlite3` native compile; stage 2 installs `sqlite tzdata postgresql17-client`
- **`backend/start.sh`** — sets `TZ`, then branches: Postgres mode runs migrations then execs the server; ⚠️ the `else` branch is a **dead SQLite path**

---

## 7. Notable risks & oddities

### 7.1 🔴 36 of 202 backend integration files cannot load at all
`grep -rl 'helpers/createTestApp"' backend/tests/integration | wc -l` → **36**. Each does e.g. `require("../helpers/createTestApp")` — **a file that does not exist**. The directory contains only `createTestApp-pg.js`, which exports `{createTestApp, DEFAULT_FEATURE_FLAGS, PERMISSION_RULES}` and no `closeDb`/`dbGet`/`dbAll`/`dbRun`.

`git log --diff-filter=D` identifies the cause: commit **`32276003` "chore: Phase 5 cleanup — delete 88 SQLite/legacy files"**. The affected files are essentially the *entire original standalone suite*: `sales`, `returns`, `returns-exchange`, `rbac`, `security`, `shifts`, `shift-linkage`, `shift-report-attribution`, `attendance`, `auth`, `auth-jwt`, `auditability`, `compliance`, `concurrency`, `context-enforcement`, `crud_employees`, `crud_inventory`, `crud_operations`, `crud_settings`, `customers`, `data-integrity`, `email`, `failure-handling`, `feature-flags`, `health`, `hr_approvals`, `inventory`, `negative-cases`, `po-credit-limit`, `printer`, `promotions`, `purchase-orders`, `reports_accuracy`, `reports_governance`, `smoke-gate`, `supplier-payables`.

That is **18% of the integration suite, covering the highest-value paths in the product**. `npm run test:smoke` targets `smoke-gate.test.js`, one of the 36 — so its documented "pre-existing failures" are a `MODULE_NOT_FOUND` at collection time, not flaky assertions. Only **138** integration files use the live helper; 28 more set up schemas by hand.

### 7.2 🔴 Jest is configured but not installed — two files use Jest globals under Vitest
`backend/jest.config.js` exists (4 lines, sets `globalTeardown`) but **`jest` is not a dependency** and no script invokes it. `globalTeardown.js` still self-describes as Jest teardown — meaning the automatic orphan-`test_%`-schema cleanup **never runs**, which is why `drop-test-schemas.js` had to be written.

Worse: **`pg-batch12-billing.test.js` and `pg-batch13-catalog-scheduler.test.js` call `jest.requireActual()` and `jest.mock()` at module top level**. Vitest with `globals: true` exposes `vi`, not `jest` — these will `ReferenceError` at collection. Two other files carry comments recording that a *previous* stray `jest.setTimeout` "made the whole suite fail collection", so this failure mode is known and has recurred.

### 7.3 🔴 Playwright specs will be swept up by `npm test` in the frontend
`frontend/vite.config.js:35-39` defines the Vitest `test` block with **no `include` and no `exclude`**. Vitest's default include matches all **54** Playwright files. `npm test` → `vitest run` will attempt to load Playwright specs in jsdom. Only `npm run test:unit` is safe. There is no `frontend/vitest.config.js` to scope this.

### 7.4 🟠 CI gates almost nothing
Two workflows totalling 5 executed test files. A PR that breaks every integration test and fails typecheck merges green as long as ESLint counts don't rise and no banned tz pattern appears. This is a deliberate, documented trade (integration tests need a live DB) — but the consequence is that §7.1 and §7.2 could sit broken indefinitely with **no CI signal**.

### 7.5 🟠 Live production credentials committed in plaintext
`frontend/tests/helpers/auth.js:20-25` hardcodes tenant `livetestauto`, username `Sweep Operator`, password `SweepRun123!`, PIN `1234`, against `https://api.sanopos.com`. Env-overridable, but the defaults are real and functional. Every Playwright run creates, mutates, and deletes **production data**. The `onboard-*` specs (6 files, 56 tests) each provision a real production tenant with no automated cleanup.

### 7.6 🟠 Known-skipped tests
- ⚠️ **`pg-wholesale-credit-limit.test.js` — 9 of 9 tests are `it.skip`.** The header states all are skipped "while the test-fixture clock-in path is …". The entire wholesale credit-limit feature — hard/warn block modes, manager-PIN override, `CREDIT_REQUIRES_CUSTOMER`, credit reversal on refund — has **zero live coverage**
- `pg-rental-deposit-sandbox.test.js` — 2 `it.skip`
- `admin-panel.spec.js:48` — `test.skip(true, "Admin credentials not configured")`: the admin panel E2E block is unconditionally skipped
- The `onboard-*` specs use ~40 conditional `test.skip(!storeCode, …)` — if signup fails, the walkthrough silently reports as skipped rather than failed. **Same class of "green means nothing" failure that `global-setup.js` was hardened against**, just relocated into the specs

### 7.7 🟡 Seven dead npm scripts
`backend: preflight, parity:audit, parity:check:frontend-only, parity:check:unclassified, parity:sync-registry`; `frontend: parity:audit, parity:check:frontend-only, parity:check:unclassified`. All point at `backend/preflight.js` or `tools/api-parity-audit.js`, neither of which exists. Notably, the API-parity audit was tooling for exactly the backend↔frontend coverage question that `frontend-coverage-drift.test.js` now answers via a different engine — **two generations of the same guard coexist, one broken**.

### 7.8 🟡 A unit test depends on `docs/`
`backend/tests/unit/frontend-coverage-drift.test.js:25` does `require("../../../docs/fable5/frontend-coverage-audit/scan.cjs")`. A production drift guard's execution engine lives in the documentation tree — any `docs/` reorganisation or exclusion from a deploy artifact silently breaks the guard.

### 7.9 🟡 Duplicated, undrifted permission table
`PERMISSION_RULES` is copy-pasted into `createTestApp-pg.js:100-131` as a mirror of `middleware/permissions.js`, with a comment saying so. Unlike the permissions *catalog*, this copy has **no drift guard** — a rule added to production middleware will not appear in tests, and every integration test will keep passing against the stale mirror.

### 7.10 🟡 Backend has no linter at all
No ESLint config, no dependency. The lint ratchet, `sano/*` rules, and the CI lint gate cover **only `frontend/src`**. `backend/` — the larger and more security-sensitive half — has zero static analysis beyond `tsc --noEmit` (not in CI) and the hand-rolled regex source-scan guards.

### 7.11 🟡 Coverage instrumentation excludes the route layer
`backend/vitest.config.js:14-28` include-lists only `utils/`, `services/`, `middleware/`, `category-tree.js` and explicitly excludes `routes/**`/`workers/**`. `test:coverage` additionally runs `tests/unit` only. **Reported coverage is structurally incapable of describing the API surface.**

### 7.12 🟡 Dead SQLite branch in the production entrypoint
`backend/start.sh:17-24` still contains an `else` branch symlinking `/data/sanopos.db` and running `run_migrations.js`. `backend/Dockerfile:3` still installs `python3 make g++` to compile the `sqlite3` native module, and `:12` still installs the `sqlite` binary — carried in the production image for a code path deleted in the Phase 5 cleanup.

---

## 8. Summary table

| Metric | Value |
|---|---|
| Total test files | **334** (255 backend, 79 frontend) |
| Backend integration | 202 (**36 broken**, 2 more with Jest-global errors → ~164 loadable) |
| Backend unit | 53 |
| Frontend unit | 25 |
| Playwright specs / tests | 54 / **443** |
| Runners | Vitest 4 (both projects) + Playwright 1.58; **Jest configured but not installed** |
| CI workflows | **2** |
| **Test files executed by CI** | **5** |
| Merge gates | ESLint ratchet, design-token drift, 2 ESLint rule suites, tz guard |
| ESLint baseline | 353 `(file,rule)` pairs / 1,007 problems; `sano/no-raw-palette-color` at 0 |
| Custom ESLint rules | 2 |
| Drift guards | 8 distinct (7 backend, 1 frontend); 2 in CI |
| Dead npm scripts | 7 |
| E2E target | **production** (`sanopos.com` / `api.sanopos.com`) |
