# Action Plan

**Working document.** Tick items as they land. Budgeted for ~10–20 hrs/week, part-time.
Decisions behind this plan: [`02-decisions-and-rationale.md`](02-decisions-and-rationale.md). Findings: [`01-assessment.md`](01-assessment.md).

**The shape:** two tracks running *in parallel*, not in sequence. If engineering is a phase and selling is the phase after it, selling never starts — that is the pattern that produced zero customers in a year.

---

## Phase 0 — Pre-pilot minimum safe set (~6 hours, one weekend)

Not "fix everything first." Just what's cheap and would embarrass you in front of a merchant.

### Code (~4 h)

- [ ] **Fix the `action_history` column shape** (~2 h) — 42 inserts across 19 files write `(employee_id, action, details)`; the table has `(user_name, action_type, description)`. Either add the columns in a migration or correct the call sites. **Start with `routes/restaurant/void-comp.js`** — void/comp is the classic café theft vector and has never been logged once. *(P0-3a)*
- [ ] **Guard `POST /api/action-history`** (~10 min) — `routes/receipt-templates.js:179` has no permission check; any cashier can forge audit rows attributing actions to anyone. *(P0-3b)*
- [ ] **Default `backup_restore` to `false`** (~10 min) — `middleware/feature-flags.js:25`. Currently on for every tenant; it is a one-request evidence-destruction primitive with no provenance check and zero test coverage. *(P0-3c)*
- [ ] **Delete the `sqlite3` dependency** (~15 min) — dead code (Postgres-only since the archive), sole source of the CRITICAL CVE, also removes `python3 make g++` from the Docker build. *(P0-4)*
- [ ] **Upgrade the 7 fixable deps** (~1 h) — `nodemailer`, `multer`, `sharp`, `path-to-regexp`, `minimatch`, `brace-expansion`, `js-yaml`. All have fixes. *(P0-4)*
- [ ] **Delete the `manualChunks` block** in `vite.config.js:19-31` (~30 min) — it backfired and forces `reports` + `recharts` onto the critical path of every route. Removes ~910 KB raw / ~217 KB gzip from every page load. **This is what makes the demo feel fast on the merchant's tablet.** *(P1 #9)*

### Dashboards, no code (~1 h)

- [ ] **Check `R2_PUBLIC_URL` on Railway** (5 min) — **do this first.** If set, patient attachments, CNIC/passport photos and full database dumps are world-readable. If unset, field selfies and clinical attachments are silently 404-ing in the owner UI. Either way you need to know. *(§3B.1)*
- [ ] **Rotate the production credentials** in `frontend/tests/helpers/auth.js` and drop the literal fallbacks to `undefined` (~30 min) — a clone of this repo currently yields a working login to live production.
- [ ] **Enable Dependabot alerts, Dependabot security updates, secret scanning, push protection** (5 min) — four free toggles, all currently off.
- [ ] **Repoint UptimeRobot** at `https://api.sanopos.com/api/health?deep=true` and add a monitor on `sanopos.com` (10 min) — the current monitor watches the Railway fallback hostname via an endpoint that returns 200 during a total database outage. *(§3B.8)*

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

- [ ] **Triage the 36 unloadable integration test files.** They `require("../helpers/createTestApp")`, deleted in the Phase 5 SQLite cleanup. Port the ones covering **sales, returns, shifts, RBAC, security** to `createTestApp-pg`; explicitly quarantine or delete the rest with a note. Leaving them in-tree makes the suite look four times healthier than it is.
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
- [ ] **Add a boot assertion for `INTEGRATION_SECRET_KEY`** and make `encryptSecret` throw rather than silently store plaintext. Then audit `integration_settings` for unprefixed rows.
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
