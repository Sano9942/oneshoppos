# Action Plan

**Working document.** Tick items as they land. Budgeted for ~10–20 hrs/week, part-time.
Decisions behind this plan: [`02-decisions-and-rationale.md`](02-decisions-and-rationale.md). Findings: [`01-assessment.md`](01-assessment.md).

**The shape:** two tracks running *in parallel*, not in sequence. If engineering is a phase and selling is the phase after it, selling never starts — that is the pattern that produced zero customers in a year.

---

## Phase 0 — Pre-pilot minimum safe set (~6 hours, one weekend)

Not "fix everything first." Just what's cheap and would embarrass you in front of a merchant.

### Code (~4 h) — ✅ **ALL DONE 2026-07-29**, commits `3ac04ca9`..`16ad381b`

- [x] ~~**Fix the `action_history` column shape**~~ — **DONE.** Scope was larger than recorded: **46 inserts across 21 files, not 42/19** (`employees.js`×3 and `POST /api/action-history/log` use a third shape adding `entity_type`/`entity_id`). Fixed by *adding* the columns (migration **v138**) rather than downgrading call sites to `user_name` — `employee_id` is a stable identity anchor for a theft trail where a renameable name string is not, and the 4 shape-C sites then work untouched. 42 shape-B sites normalised (identifier-only change; params were already positionally correct). Added `tests/unit/action-history-column-drift.test.js`, proven to fail on reintroduction. *(P0-3a)*
- [x] ~~**Guard `POST /api/action-history`**~~ — **DONE, but not with a permission.** A `requirePerm` here would have broken POS error logging: `utils/errorLog.js` posts to this route from **19 cashier-reachable recovery paths**. The vulnerability was never the missing permission — it was trusting `req.body.user_name`. Identity is now session-derived. Same fix applied to `/log`, which v138 brings to life for the first time. *(P0-3b)*
- [x] ~~**Default `backup_restore` to `false`**~~ — **DONE, but via a split.** `backup_restore` is a **bundle flag on the Operations card**, so flipping it would leave that card mixed-state, would disable data *export* (a portability guarantee, not a risk), and would be self-defeating — re-enabling the card for exports re-arms destructive restore. Instead: new `tenant_data_restore` flag, default false, in `UNMANAGED_FLAGS` (same posture as `offline_returns`), gating `POST /api/backup/restore` alone. *(P0-3c)*
- [x] ~~**Delete the `sqlite3` dependency**~~ — **DONE.** Blocked by one live consumer, `tests/integration/saas-phase1.test.js`, which was itself already dead (requires the deleted `master-db.js`); deleted it. **Critical advisories 1 → 0.** Note: removing `python3 make g++` has *no* security value — the builder stage never ships — so it is a build-time cleanup only; revert instructions are inline in the Dockerfile since Docker was unavailable to prove the build. *(P0-4)*
- [x] ~~**Upgrade the 7 fixable deps**~~ — **DONE for 5 of 7; total advisories 33 → 4, critical 0.** `multer`, `path-to-regexp`, `minimatch`, `brace-expansion`, `js-yaml` all resolved inside existing semver ranges (lockfile only, no API surface change). `swagger-jsdoc` 6.2.8→6.3.0 was the hidden blocker pinning three of them. **Still open, each needing a major:** `nodemailer` 8→9, `sharp` 0.34→0.35, `@anthropic-ai/sdk`. These touch the email and image paths and deserve deliberate upgrades, not a sweep. `xlsx` has no fix at any version. *(P0-4)*
- [x] ~~**Delete the `manualChunks` block**~~ — **DONE and now verified against the deployed artifact.** `index.html` had been modulepreloading recharts *and* reports on the POS, which uses neither; it now preloads the entry and the stylesheet only. **Corrected numbers 2026-07-29:** the figures in commit `16ad381b` (1,197 → 406 kB raw, 310 → 122 kB gzip, −61%) were measured from a local build with **`VITE_SENTRY_DSN` unset**, which tree-shakes `@sentry/react` out of the bundle entirely — Vercel sets that variable, so no build matching those numbers has ever been served. Re-measured with the variable set, and confirmed byte-for-byte against what `sanopos.com` actually serves (866,227 B, gzip 275,872 B): **1,676 kB → 866 kB raw, 460 kB → 275 kB gzip (−40%)**. The win is real and the direction was right; the magnitude was overstated and the floor was understated by more than 2×. **Follow-on finding: Sentry is now the single largest thing in the eager payload — 450 kB raw / 150 kB gzip, more than the entire rest of the entry chunk.** Worth a look at lazy-initialising it, and worth noting that *any* local frontend size measurement taken without the production env vars is measuring a build that does not exist. *(P1 #9)*

> **Found while doing the above — `GET /api/admin/tenant-activity` has never returned a row.** It selected `action`/`details`/`performed_by`/`created_at`, none of which exist, and threw once per tenant into `catch (_) {}`. Fixed by aliasing to the real columns. This is *why* the missing audit rows went unnoticed for a year: **the write path and the admin read path were independently broken, so neither produced a contradiction.** Two silent failures masking each other is the pattern worth remembering here — the tenant-side page had the same defect in milder form, rendering every row as "System" performing "—".

### Dashboards, no code (~1 h)

- [x] ~~Check `R2_PUBLIC_URL`~~ — **DONE: it is UNSET.** Good news on privacy (nothing sensitive is public). But this confirms a live functional defect: **field-rep selfies and clinical attachments 404 in the owner UI** because those prefixes sit outside the proxy allowlist while their URLs are written to the DB and rendered directly. → new task below *(§3B.1)*
- [x] ~~**Fix the broken R2 media paths**~~ — **DONE 2026-07-29 (`7f9a65c3`), by signing rather than by allowlisting.** Media URLs are stamped with an expiry and an HMAC on the way out of any permission-gated endpoint (`middleware/sign-media-urls.js`), and the proxy verifies the signature instead of consulting a prefix list. Authorisation is the gate the row already passed; `<img src>` needs no change, and routes added later are covered without opting in. `backups/` is refused by signer and verifier independently. **Verified against the running server and real objects in the production bucket** — public prefix unsigned 200, sensitive prefix unsigned 404, same key signed 200, tampered 404, expired-with-genuine-MAC 404, signature replayed on a sibling file 404, `backups/` with a forged-but-valid MAC 404 (7/7), plus 16 unit tests including a mount-order guard proven to fail when violated. **Scope was 11 prefixes, not 4, and the ~1 h estimate was wrong** — Enumerating every `uploadToR2` call site (16 live sites) gives **14 distinct key prefixes written** against **3 served** by `PUBLIC_R2_PREFIXES`. Broken in the UI today: `field-selfies/`, `clinical/`, `consents/`, `booking-guests/`, `service-records/`, `tickets/`, `handouts/`, `projects/`, `receipt-logos/`, `invoices/`, `pod/`, `forms/`, `reports/` — every feature that uploads a file except products, company logo and support screenshots. (`backups/` is excluded deliberately and must stay so.) **Two findings change the design.** First, four of those prefixes key on a bare row id — `clinical/<planId>/`, `consents/<planId>/`, `service-records/<recordId>/`, `tickets/<ticketId>/` — with **no tenant segment**, so plan 42 in one tenant and plan 42 in another share a directory. Filenames carry 64+ bits of entropy so nothing overwrites, but it means **prefix-based authorization is impossible**: ownership has to be resolved by looking the URL up in the requesting tenant's schema. Second, `<img src>` cannot carry the Bearer token — `AuthProvider` patches `window.fetch`, not image loading — so an authenticated route would need every render site to fetch-to-blob (the same trap as the Import page's `<a href>` 401). Signing on the way out sidesteps both. **Still true and still important: do not set `R2_PUBLIC_URL`.** It un-mounts the proxy entirely, which discards the signature check along with it and exposes every key including `backups/full-backup-*.dump`.
- [x] ~~**Rotate the production credentials** in `frontend/tests/helpers/auth.js`~~ — **CODE HALF DONE, ROTATION STILL OPEN.** Literals removed from three places, not one: `helpers/auth.js`, `sweep/functional-sweep.spec.js` (its own copy of the same password plus the owner PIN) and `sweep/SWEEP_RESUME.md` (both, inline, in a checked-in runbook with a paste-ready re-login snippet). Secrets now read `E2E_PASSWORD`/`E2E_PIN` with no fallback and **throw at import** when absent, so a missing value can't masquerade as a broken locator. Non-secret defaults kept deliberately — a tenant slug and a display name are identifiers. **The password is still valid in production**: removing it from the repo stops future clones, and does nothing about every copy that already exists. Rotating it on `livetestauto` is an owner action.
- [x] ~~**Enable Dependabot alerts, Dependabot security updates, secret scanning, push protection**~~ — **2 of 4 DONE; the other 2 are not free on a private repo.** Dependabot alerts and automated security updates are now **on** (verified: `vulnerability-alerts` 204, `automated-security-fixes` `enabled: true, paused: false`). Secret scanning and push protection return **422 "Secret scanning is not available for this repository"** — on a private repo they require GitHub's paid Secret Protection / Advanced Security. A billing decision, not a toggle. **Dependabot immediately surfaced something the assessment missed: 55 open alerts, of which 49 are `frontend/package-lock.json`.** Phase 0's dependency work was **backend-only** — the "33 → 4 advisories" figure never covered the frontend, which was never audited at all. Worst of it is runtime, not tooling: **`react-router` carries 12 alerts (6 high)** in the shipped app, plus `vite` 5 and `postcss` 3. Backend's remaining 6 line up exactly with the three deferred majors and `xlsx`, so nothing there contradicts the earlier number.
- [ ] **Repoint UptimeRobot** at `https://api.sanopos.com/api/health?deep=true` and add a monitor on `sanopos.com` — **BLOCKED on a credential, not on a decision.** The key in `.claude/settings.local.json` is monitor-scoped (`m802713180-…`), so `getMonitors` works but `editMonitor` and `newMonitor` both return `not_authorized`. Needs the account's main API key or two minutes in the dashboard. Confirmed while checking: exactly one monitor exists, pointed at `https://oneshoppos-production.up.railway.app/api/health` (the Railway fallback host, shallow mode) on a 300 s interval. Also confirmed that the repoint is exactly right rather than merely deeper — `registerAllRoutes.js:142` returns **503 only when the database check fails** and 200 `"degraded"` when an optional dependency like Resend is down, so `?deep=true` alerts on a real outage without paging for a Resend hiccup. *(§3B.8)*

### Pilot scoping decisions (no time cost, just discipline)

- [ ] Storefront **disabled** for the pilot tenant *(keeps P0-1 out of reach)*
- [ ] Invoice the pilot **manually** *(keeps P0-2 out of reach)*
- [ ] **CSV import only**, never XLSX *(keeps P0-4's exposure path out of reach)*

---

## Track B — Distribution. Starts the same weekend, runs forever.

- [ ] **Name one merchant you could call this week.** Someone who already knows and trusts you. Retail or a small café (see D3).
- [ ] Write down, before you call: **what specifically are you afraid they'll say?** That answer is usually the real backlog and is almost never the same as the audit's.
- [ ] Agree the terms: free, design partner, **dual-run for two weeks** (they keep paper/existing system alongside — see D4).
- [ ] Prepare onboarding: outlet, employees, tax config, products via CSV. Time-box it; if onboarding takes more than 2 hours that is itself the most important finding of the pilot.
- [ ] **Be physically present for the first 2–3 days.** Not for support — for observation. What they struggle with in the first hour is worth more than this entire document.
- [ ] **Reconcile daily**: their book total vs the `sales` table. Every evening, for two weeks. Log every discrepancy — each one is a money-path bug the test suite never caught.

---

## Phase 1 — Close the verification loop (weeks 3–10, ~10 hrs/wk)

The goal is not "more tests." It is *one working feedback loop*, so the next P0 cannot hide.

> ### Suite actually run, 2026-07-29 — the premise was wrong
>
> The suite was executed for the first time (safely — `.env.test` → localhost, verified). It is **not** "outdated and wrong."
>
> | | Result |
> |---|---|
> | **Unit** | **51 of 53 files pass · 701 of 704 tests** |
> | **Integration, loadable files** | **147 of 165 pass (89%)** |
> | **Genuinely failing tests** | **26**, across 14 files |
> | Files that cannot load | **37** (not 36 — five distinct deleted modules) |
> | Total passing assertions | **~2,400** |
>
> **The single highest-leverage finding: `vitest.config.js` sets `hookTimeout: 10000`, but every integration file's `beforeAll` executes all 5,926 lines of `schema-pg.sql` to build 327 tables — then 202 of those run in parallel forks against one Postgres.** That configuration cannot succeed on this workload.
>
> Re-running the failures serially with `--no-file-parallelism --hookTimeout=120000` moved **52 files from fail to pass with zero code changes.** The first run reported 106 failed files; only 17 are real. **~49% of the apparent failure was a config mistake, not broken tests.**
>
> This trap is recorded twice in project memory (`feedback_verifier_env_traps`, `admin_test_provisioning_gotcha`) and never reached the config file.
>
> **Fix the config first — it is a one-line change that makes the suite honest, and it must land before any test triage.**

- [ ] **Fix `vitest.config.js` first** — raise `hookTimeout` to ≥120000 (or set `fileParallelism: false`). Verified: this alone converts 52 failing files to passing. Everything below is unreadable until this lands.
- [ ] **Triage the 37 unloadable integration test files.** Five deleted modules, not one: `helpers/createTestApp` (36 files), plus `tenant-provisioner`, `tenant-db-manager`, `schema-full`, `master-db`. Port the ones covering **sales, returns, shifts, RBAC, security** to `createTestApp-pg`; explicitly quarantine or delete the rest with a note. Leaving them in-tree makes the suite look healthier than it is.
- [ ] **Fix the 26 genuinely failing tests.** Triaged 2026-07-29; all inspected signatures are stale fixtures tracking deliberate behaviour changes, not defects — but each needs confirming before closing:
  - `pg-batch2/3/8` sales+gift-card cluster — the sale path gained an **open-shift requirement** the fixtures never satisfy (already recorded in memory as `stale_pg_batch_fixtures`)
  - 3 × feature-flag gating expecting 503 — `requireMode` enforcement changed when `tenant_modes` was materialised in v135
  - `pg-batch15-couriers` — `duplicate key on courier_integrations_adapter_key_key`; the 13 pre-seeded couriers now collide with the fixture's own inserts
  - Remainder: refund-idempotency (2), risk-controls threshold (1), import preview, admin infra, COD settlements, bookings availability/reschedule
  - **`sales-decimal-quantity` (3 failures) deserves a real look** — it covers weighted-goods rounding on stock deduction, which touches the stock-writer problem
- [ ] **Fix the 4 files using `jest.*` globals** under Vitest (`pg-batch-phase3c-atomicity`, `pg-batch12-billing`, `pg-batch13-catalog-scheduler`, `public-bookings`) — they `ReferenceError` at collection.
- [ ] **Put the integration suite in CI**, nightly against a throwaway Postgres, using the existing baseline-diff pattern (fail on new/changed, never on totals) so it can go green immediately.
- [ ] **Add `tsc --noEmit` and `vite build` to the PR gate.** Both are free and currently ungated.
- [ ] **Write the test that would have caught P0-1** — a storefront payment-failure test asserting stock is returned. This matters more than the fix itself.
- [ ] **Un-skip the wholesale credit-limit tests** — 9 `it.skip` covering the most financially sensitive untested logic in the product.
- [ ] Add a drift guard for the `PERMISSION_RULES` copy duplicated verbatim in `tests/helpers/createTestApp-pg.js:100-131` — today the security tests validate a mirror, not the real rules.

---

## Phase 2 — The remaining P0/P1s (weeks 4–16, interleaved)

- [ ] **P0-1** — point the storefront release query at `inventory_reservations`, add the missing `r.web_order_id = $1` correlation predicate, stop swallowing the error into `ok:true`. Then reconcile: every `web_orders` row with `payment_status IN ('failed','cancelled')` has stock never returned.
- [ ] **P0-2** — add `transaction` to `master-db-pg.js` (it has none), then wrap the billing webhook and reorder it to activate the tenant *before* marking the intent complete. Same for the invoice-payment-link path.
- [ ] **Decide on `xlsx`** — no upstream fix exists. Options: sandbox the parse, replace the library, or restrict upload to CSV permanently.
- [ ] **Graceful shutdown** — capture the server handle, trap SIGTERM/SIGINT, call `server.close()` and the already-written `shutdownBoss()`.
- [ ] **Pin `{ algorithms: ['HS256'] }`** at all six `jwt.verify` sites.
- [ ] **Add a boot assertion for `INTEGRATION_SECRET_KEY`** and make `encryptSecret` throw rather than silently store plaintext. Then audit `integration_settings` for unprefixed rows. **Scope reduced 2026-07-29** — the key IS set in production (64 chars, verified live; open question A2 closed), so this is hardening against future environments where it is absent, not remediation of live plaintext. Any unprefixed rows found would predate the key being set. Keep the fix: a credential-encryption function that silently no-ops is the wrong default whatever today's env says.
- [ ] **Encrypt `fbr_api_token`** (`routes/fbr.js:48-50` writes it raw — a live national-tax-authority credential in plaintext).
- [ ] **Add Pino `redact`** to `services/logger.js` and stop logging payment tokens at `payment-gateway.js:245/:256`.
- [ ] **Decide `POST /api/sales` explicitly** — add `requirePerm`, or a comment recording that open access is intentional. Then decide the same about its rate-limit exemption.
- [ ] **Fix the refund double-payment paths** — `returns.js:788` commission reversal not awaited (refund + commission both paid); `returns.js:729-737` gateway refund with unwrapped local write (retry refunds twice).
- [ ] **`grn.js:462`** — `res.json()` executes inside an open transaction; and the route has no permission guard at all.
- [ ] **Offline queue recovery** — expose failed rows to non-admins, make "Sync now" retry `failed`, wire the unused `WARN_THRESHOLD`, call `navigator.storage.persist()`, and **send `queued_at`** so offline sales book to the correct day and shift.

---

## Phase 3 — Structural, before growth (months 3–9)

- [ ] **Collapse the stock writers.** At least 8 independent sale-side implementations. Migrate `routes/sales.js` first, then `kit-engine`, `storefront`, `orders`, `aggregator-orders`, `reservation`, `shopify/order-service`. Add a runtime assertion that the ledger runs inside a transaction. **Do this only after Phase 1 — you need the test net first.**
- [ ] Move the gateway capture outside the sale transaction (authorise before, capture after commit, reconcile the gap).
- [ ] Add the schema-vs-migrations drift test — provision from `schema-pg.sql`, provision by replaying migrations, diff `information_schema`.
- [ ] Move migrations out of the boot path; rehearse the rollback once.
- [ ] Add a linter to the backend (currently zero static analysis on the larger, more security-sensitive half).
- [ ] Externalise cache invalidation and rate-limit state to Redis. **Treat "add a second instance" as blocked until this lands.**
- [ ] Restore-test a backup. Never done. An untested backup is a hypothesis.
- [ ] **Write the infra-access and credential-recovery document.** One hour, exists nowhere, and it is the only mitigation for bus-factor-1.
- [ ] Stand up a staging Railway environment so `git push origin main` is not the only path to production.

---

## Phase 4 — Compliance, accessibility, international (months 6–18)

Gated on D7. Do not sell into the UK or EU before the first item.

- [ ] **Rebuild field-rep capture** — consent screen, retention limit, rep self-access, deletion path. Currently mandatory GPS + facial imagery with none of those.
- [ ] Implement data erasure and DSAR export (both are already *promised* in the published Privacy Policy and neither exists).
- [ ] Wire `deleteFromR2` into tenant teardown — it is called from exactly one route and no deletion path.
- [ ] Fill in the legal templates (`[Legal Entity Name]`, `[Effective Date]` are live placeholders behind a binding consent checkbox); disclose GPS/selfie/CNIC/health; publish the DPA that `Terms.jsx:90` promises.
- [ ] FBR reconciliation query (`LEFT JOIN sales … WHERE fi.id IS NULL`), alert on `abandoned_no_creds`, audit the kill switch.
- [ ] Accessibility to WCAG 2.2 AA — real focus trap + `inert` in `Modal`/`Drawer`, make the POS use the primitives, convert `POSSearchArea.jsx:107/129` to `<button>`, `aria-live` on the toast container, raise `--ui-border` to ≥3:1. Then actually import the `@axe-core/playwright` already in `package.json`.
- [ ] i18n + RTL (~4,960 extraction sites; 6–10 weeks) — **before UAE**, and it grows with every page added.

---

## Honest arithmetic

Phases 2–4 in full, across all ten verticals, is roughly **1,000–1,600 hours ≈ 16–25 months** at 15 hrs/week — assuming no regressions and no new findings, while this audit only sampled. That is the accepted cost of D2 (keep everything) and it is fine **because D1 means revenue does not wait for it.**

If the timeline ever becomes the problem, the lever is D2, not D1. Re-read `02-decisions-and-rationale.md` before pulling it.
