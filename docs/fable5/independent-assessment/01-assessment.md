# SanoPOS — Independent Assessment

**Prepared as:** an outside engineering agency engaged to give a second opinion, not to validate the first one.
**Subject:** the SanoPOS platform, using `docs/fable5/platform-architecture-claude-report/` as the incoming brief.
**Date:** 2026-07-29 · **Repo state:** branch `docs/platform-architecture-claude-report`, HEAD `d505b718`.
**Posture:** blunt. The client asked for what is wrong, not for what is reassuring.

---

## 0. Coverage boundary — read this first

An assessment that hides its own gaps is worthless. This one has gaps.

**Independently verified for this document:**
- The full architecture report and subsystem audits 06 (security), 07 (testing/CI), 08 (business domains), read end to end.
- Ten load-bearing claims re-derived from source by a dedicated verification pass (results below — one of them **falsifies** the report).
- Direct source reads: the H1 price-authority gate, `middleware/plan-limits.js`, `backend/railway.toml`, `backend/start.sh`, `frontend/src/ui/primitives.jsx`, `backend/routes/insights-ai.js`.
- Repo-wide measurement: documentation volume, audit-log mutation surface, i18n presence.

**Second pass (completed).** Five workstreams initially terminated by an API session limit were re-run to completion: backend performance/N+1 and dependency audit · live commercial-usage query against production · frontend accessibility and bundle assessment · privacy/DR/compliance · engineering process and bus factor. Their findings are integrated below and materially changed this document — two **P0** defects the incoming report never found, and a commercial picture harder than the one it painted.

A subsequent pass also recovered the one command that had failed for environmental reasons — the live uptime query (§3B.8), which turned out to matter.

Where a claim originated in a sub-investigation and carried decision weight, it was re-derived at source before being stated here. Anything still unverified is marked ⚠️ and is an open question, not a finding. **One earlier claim in this document was wrong and has been corrected in place** (§4.2 — a deploy runbook does exist); the correction is logged in the appendix rather than quietly edited out.

**Still open, and deliberately not guessed at:** the production value of `R2_PUBLIC_URL` (§3B.1 — one lookup, decides a confidentiality question), whether `INTEGRATION_SECRET_KEY` is set in production, Cloudflare R2 bucket public-access and lifecycle settings, and whether Supabase's automated backups cover `tenant_*` schemas identically to `public`.

---

## 1. Verdict

**The engineering is better than the product decisions. The product decisions are the problem.**

On craft, this is not a weak codebase. The tenant-isolation mechanism is genuinely correct and non-obvious. The drift-guard test culture — permissions catalog, module catalog, outlet-header single-reader, design-token drift — is a technique most 20-person teams never reach. The fail-closed defaults in permission loading and mode enforcement reflect someone who has thought about failure, not just about features. Credit where due: an agency does not usually find `SET LOCAL search_path` used correctly under a transaction pooler, and does not usually find an ESLint ratchet keyed on `(file, rule)` pairs because a global count would be gameable.

And none of that is the issue.

The issue is what the live production data says, and it is harder than the incoming report's framing. The report says "59 sales across 29 active tenants, 5 with any sale." The database says:

- **Zero revenue. Ever.** All 6 `payment_records` and all 7 `payment_intents` are `gateway='sandbox'`. `upgrade_requests` is empty — not one person has used the manual path to *ask* to pay. The nominal PKR 421,600 "collected" includes the same PKR 80,000 annual plan purchased four times in 47 minutes: gateway smoke-testing. The three tenants sitting on `plan='pro'` with entitlements running to 2027 are the owner's own test accounts, activated by a sandbox webhook.
- **Zero external merchants, currently and cumulatively.** 33 of 36 tenants are owner-created fixtures — 23 `golv_*` provisioned in a single scripted 67-second batch. The only two plausibly third-party merchants in the platform's history both signed up and were deleted within weeks, months ago. "29 active tenants" is 23 scripted fixtures plus 6 test harnesses.
- **8 of the 10 marketed verticals have literally zero rows in production, anywhere, ever** — appointments/salon, gym/classes, rentals, lodging, clinical/treatment plans, repair/service tickets, photography, packages. Shipped schema, routes, workers, UI, tests and documentation. No data.
- **The trend is down.** Sales by month: Apr 11 → May 36 → Jun 10 → **Jul 2**. One tenant has transacted in the last 30 days and it is the wholesale test tenant. Every "recent activity" signal traces to the owner's own scripts — two `golv_` tenants stamped one second apart is not a merchant.

So: **~300,000 lines of code, 1,344 endpoints, 327 tables, 10 verticals and 137 migrations, plus 151,194 lines of documentation across 397 markdown files, serving zero customers and zero revenue.**

That is not a scaling problem and it is barely a technical problem. It is a **validation** problem, and every technical risk in this report is downstream of it. The codebase has been optimised for breadth of capability against a market that has never been asked. Meanwhile the mechanisms that would tell you whether it *works* — a running test suite, CI gates, a second pair of eyes, a paying user — are the weakest parts of the operation.

**One consequence deserves stating plainly, because it cuts in your favour:** with no live merchants, the correctness defects below have zero current blast radius. That makes them *pre-launch cleanup*, not firefighting. You have the rarest thing in software — the chance to fix a system's foundations while nobody is standing on it. That window closes permanently the day a real merchant signs up.

**Our first recommendation is therefore not a code change.** It is: stop building verticals. Take one, get twenty paying merchants using it daily, and let their behaviour decide which of the 1,344 endpoints deserve to exist. Everything below is prioritised on the assumption you will keep building anyway.

**Grade by dimension:**

| Dimension | Grade | One-line |
|---|---|---|
| Architecture & isolation | **B+** | Genuinely well-reasoned multi-tenancy; single-instance ceiling is self-imposed |
| Security design | **C** | Strong perimeter and tenant isolation — undermined by silent-degrade controls, no log redaction, and an audit trail that is absent and forgeable |
| Privacy & regulatory | **D−** | Nothing sensitive encrypted above the DB; no erasure or export despite promising both; unfilled legal templates; employee GPS+selfie with no consent |
| Accessibility | **F** | Fails WCAG 2.2 AA on six criteria; a keyboard user cannot ring up an item |
| Critical write-path correctness | **D−** | 8 competing stock writers, 2 gift-card debit paths, and two money paths that have provably never worked |
| Dependency & supply chain | **D** | 30 production vulnerabilities, no automation, one permanently unfixable on an upload path |
| Testing & CI | **F** | 334 test files; CI runs 5. 36 cannot load. Not a safety net — a prop, and P0-1 is what it cost |
| Operability / DR | **D** | Single instance, no graceful shutdown, migrations in the boot path, no metrics, untested restore |
| Engineering process | **D** | Zero human reviews ever, 96.8% of commits bypassed PR, main unprotectable, all security automation off — against genuinely strong commit and test-growth discipline |
| Product focus | **F** | Zero revenue, zero merchants, 8 of 10 verticals with no data ever |
| Documentation | **C** | Excellent craft, catastrophic volume, demonstrably self-contradicting — and it specified a table nobody built |

---

## 2. On the report itself

You commissioned an audit. As your outside reviewer, we assess the audit too — you will make decisions from it.

**It is a good document.** Better than most paid deliverables we see: every claim graded by evidence strength, live reproduction commands included, documentation explicitly excluded as evidence, limitations stated without flinching, and — rare — it corrects three of your own project docs rather than deferring to them. The "framing fact" discipline (59 sales) is exactly right and most auditors would have buried it.

**Where it is wrong or too generous:**

### 2.1 It understates its own #1 finding by a factor of nearly three

The report says there are **three** stock-movement implementations. A dedicated re-verification against source found **at least eight** independent sale-side writers of `outlet_stock` / `variant_outlet_stock`:

`services/stock-ledger.js:113` · `routes/sales.js:2061` · `shopify/order-service.js:179` · `services/aggregator-orders.js:436` · `services/kit-engine.js:207` · `routes/storefront.js:895` · `routes/orders.js:1298` · `services/reservation.js:27/82/127`

— plus further non-sale writers in `inventory.js`, `returns.js`, `holds.js`, `batches.js`, `fulfillment.js`, `van.js`, `webhooks.js:442`, `shopify/reconciliation.js:322`, `tier4/approvals.js:244`, `shopify/import.js`, `products.js`, `import.js`.

`kit-engine.js` is a **fourth full triple-table implementation** the report never mentions. `storefront.js` correctly takes `FOR UPDATE` and gates availability — and still doesn't call the shared ledger. The report's conclusion ("the shared writer was never adopted") is right; its magnitude is wrong, and magnitude is what determines whether you treat this as a cleanup task or a stop-the-line task. **It is a stop-the-line task.**

### 2.2 It presents the price-authority gate as a strength without its caveats

The report lists "Server price authority (H1) — re-resolves every line server-side" among the write path's well-designed defences. Read the code (`backend/routes/sales.js:1250-1298`) and it **fails open in three separate ways**:

1. **Per line:** if `resolvePriceForContext` throws, the handler `continue`s — that line is excluded from *both* sides of the comparison. A line whose price resolution errors is simply never checked.
2. **Globally:** the entire gate sits in a `try/catch` whose comment reads *"A bug in the gate must never silently drop a sale; log and proceed."*
3. **By tolerance:** it compares **aggregate subtotals**, not lines, with a tolerance of `max(1, 1% of subtotal)`. On a PKR 100,000 cart that is PKR 1,000 of undercharge per sale, absorbed silently — and per-line overcharges net against undercharges inside the same cart.

It also skips bundles, price-book lines and overridden lines entirely. This is a *rounding-noise filter with an undercharge alarm*, not price authority. It is a reasonable control; it is not the control the report describes, and the subsystem audit (08 §10.5) flagged the fail-open behaviour that the headline report dropped.

### 2.3 It omits that revenue enforcement fails open

Not mentioned anywhere in the main report. `backend/middleware/plan-limits.js`:

- `requirePlanLimit` — `catch (err) { console.error(...); next(); }`. A DB hiccup during the cap check means the cap does not apply.
- `requireActiveSubscription` — `.catch(() => next())`. A DB hiccup means an **expired tenant writes freely**.

Both are annotated "Best-effort — don't block on lookup failure." That is a defensible availability trade for a POS, but it is a *commercial* control failing open, it is undocumented in the audit, and combined with `requirePlanLimit` existing at only **3 call sites across 1,344 endpoints**, plan enforcement is closer to decorative than real.

### 2.4 It splits a compounding finding across two sections and never joins it

The report notes separately that (a) `POST /api/sales` has no permission guard, and (b) the global rate limiter deliberately skips POS burst paths including `/api/sales`. Put together: **the single highest-value write in the system is neither authorised nor throttled.** Any authenticated employee of any role can create unlimited sales at unlimited rate. Each finding alone is a shrug; together they are the shape of an insider-abuse or runaway-client incident.

### 2.5 Its "REPORTED" grade is doing too much work

Eleven of the twenty entries in the consolidated risk register — including #2 (gateway in transaction), #5 (CI gating), #9 (credential plaintext), #11 (DDL drift), #16 (skipped credit tests) — are graded REPORTED, i.e. found by a sweep and not re-verified. Our verification pass confirmed every one it tested, which is a good hit rate. But a register where half the entries are unverified is a research note, not a decision instrument. **Verify before you spend money against it.** (Where we checked, the report was right; where it was wrong — §2.1 — it was wrong in the *safe* direction, understating.)

### 2.6 What it never looked at — and what was in the gap

The report assessed no: accessibility · internationalisation · dependency/supply-chain risk · query performance · bundle size and device cost · data-subject rights and retention · disaster recovery and restore testing · bus factor · release/rollback procedure · API consumability. All are covered below.

**The two P0 defects were sitting in that gap.** Both are in `routes/webhooks.js` — a file the report discusses at length for its HMAC verification posture, while never checking whether the handlers *below* the verification actually work. This is the structural limit of a read-only architecture audit: it evaluates the shape of the code, not whether the code runs. A single executed integration test against the storefront failure path would have caught P0-1 immediately. There is no such test, and if there were, CI would not run it.

That is the through-line of this whole engagement. The incoming report is a good document that could not have found these. Only running the system finds these.

---

## 3. Findings

Severity is *business* severity, not CVSS. **P1** = we would not ship without a fix or an explicit written risk acceptance. **P2** = fix this quarter. **P3** = backlog with a date.

### P0 — Live defects the incoming audit did not find

Two of these are **already broken in production code today**, not latent design risks. Both were re-verified at source for this document. Neither appears anywhere in the incoming report — they are the strongest evidence that a source-reading audit without an executing test suite has a ceiling.

**P0-1 — Failed storefront payments permanently leak stock. The release query targets a table that does not exist.**

`backend/routes/webhooks.js:433-439` releases inventory on storefront payment failure by querying **`storefront_cart_reservations`**. Verified repo-wide: that table is created **nowhere** — not in `schema-pg.sql`, not in any of the 137 migrations. It appears in exactly two places in the entire codebase, both inside this one file, plus a 2026 planning document (`docs/plans/sanopay-sandbox-implementation-plan.md:313`) that specified a table name nobody ever built. The real table is `inventory_reservations` (`schema-pg.sql:2358`), which is what `routes/storefront.js:915` actually writes to — complete with the `web_order_id` column this query needs.

The failure chain:
1. Storefront checkout decrements `outlet_stock` **immediately** and writes `inventory_reservations` rows as `'converted'` (`storefront.js:835-920`).
2. Gateway reports failure. The two status updates at `:425-431` succeed — order correctly marked `failed`.
3. The release query at `:433` throws `relation "storefront_cart_reservations" does not exist`.
4. The `catch` at `:456` swallows it as a log line.
5. `return { ok: true }` at `:475` tells the gateway not to retry.

**Every failed or abandoned storefront payment permanently strands its stock as sold.** Silent, cumulative, invisible to every report, and unrecoverable without manual reconciliation. This block has never once executed successfully in production.

There is a second defect in the same query, which would activate the moment the table were created: `JOIN web_orders wo ON wo.id = $1` carries **no correlation predicate to `r`**, and the `WHERE` clause scopes nothing to the order. It is a cross join filtered to one row — it would restock *every* converted reservation in the tenant.

**P0-2 — The billing webhook marks payment complete before activating the tenant, and cannot be wrapped in a transaction.**

`backend/routes/webhooks.js:208 / :213 / :222` — three sequential money writes across `payment_intents`, `tenants`, `payment_records`. The intent is flipped to `completed` **first**, and `:195` uses exactly that flag as its idempotency guard. A failure between `:211` and `:220` leaves: card charged at the gateway, intent marked done, tenant still `free`/`expired`, and every gateway retry short-circuiting on `ok:true`. Unrecoverable without direct DB surgery.

It cannot be fixed by wrapping, because **`backend/master-db-pg.js:245` exports `{ init, createTenant, getTenantBySlug, getTenantById, query }` — there is no `transaction` on the master DB at all.** Verified. Fixing this correctly requires adding transaction support to the master DB layer first.

The same shape recurs at `webhooks.js:352-368` (invoice payment link): update link → insert `customer_invoice_payments` → `recomputeBalance`, unwrapped, error swallowed, still returns `ok:true`. A B2B customer pays, `balance_due` never moves, AR aging keeps them delinquent and the credit gate keeps blocking their next order — while the money sits in the merchant's account.

**P0-3 — The audit trail does not exist for most event types, and any cashier can forge entries in it.**

Three defects that compound into one conclusion: **`action_history` cannot be relied on for a forensic reconstruction of anything.**

*(a) 42 audit writes across 19 route files insert into columns that have never existed.* Verified — `action_history` is five columns (`schema-pg.sql:1086-1092`): `id, user_name, action_type, description, timestamp`. There is no `employee_id`, no `action`, no `details`. `grep action_history backend/migrate-pg.js` returns **zero** — no migration ever adds them. Yet 42 call sites across `backorders, bookings, classes, contracts, customer-invoices, customers, kds, marketing, messaging, projects, rentals, restaurant/*, restaurant-inbox, rooms, service-tickets, subscriptions` write `INSERT INTO action_history (employee_id, action, details)`. Every one is wrapped in `try { … } catch {}` and therefore **fails silently on every execution, and always has**.

The most damaging instance is `routes/restaurant/void-comp.js:166-175`, commented "Best-effort audit hook." **Restaurant void/comp — the single classic POS theft vector — has never been logged, not once.** Same for customer-statement sends, appointment cancellations, and rental/room/ticket lifecycle events.

*(b) `POST /api/action-history` has no guard at all.* Verified — `routes/receipt-templates.js:179` takes `{user_name, action_type, description}` from the body with **no `requirePerm`, no `requireAnyPerm`, and no `PERMISSION_RULES` entry** (grep: zero hits). The two neighbouring routes are guarded (`:195` `all_access`, `:213` `view_hr_reports`). So any authenticated employee — a Cashier, a Field Rep — can **insert unlimited audit rows attributing arbitrary actions to arbitrary `user_name` values, including the owner's.** Write-anything, read-privileged: the worst possible asymmetry for an audit log.

*(c) A tenant admin can replace the entire audit table in one request.* `POST /api/backup/restore` (`routes/barcode-expenses.js:464-548`) is gated on `all_access` + `requireFeature("backup_restore")` — and **`backup_restore` defaults to `true`** (`middleware/feature-flags.js:25`). It runs `pg_restore --clean --if-exists`, dropping and recreating every table in the tenant schema — `action_history`, `sales`, `fbr_invoices` — with whatever the uploaded file contains. Validation is TOC schema-name and 50 MB size only: **no signature, no checksum, no provenance check**, so a hand-edited dump can *fabricate* history, not merely erase it. It is also **untested** — `grep restoreSchema backend/tests/` returns zero.

**Hostile-insider verdict:** a tenant admin covering a theft succeeds. Take a dump, commit the theft, restore — sales, stock and audit roll back together. The one thing they cannot hide is a row in `public.backup_log`, which sits outside the tenant schema. Nothing alerts on it.

Note the interaction with the earlier finding: "audit logs are never `UPDATE`d or `DELETE`d in production code" is true, and now largely irrelevant. There is nothing to delete because most of it was never written.

**P0-4 — 30 known vulnerabilities in production dependencies, one with no fix available on an attacker-controlled input path.**

`npm audit --omit=dev` in `backend/`: **1 critical, 14 high, 12 moderate, 3 low** across 445 production dependencies. No Dependabot, no Renovate, no `npm audit` in CI — both workflows explicitly pass `--no-audit`. No `engines` field in either `package.json` and no `.nvmrc`; Node 22 is pinned only inside the Dockerfile, so local, CI and production can silently drift.

| Package | Severity | Note |
|---|---|---|
| **`xlsx@0.18.5`** | **HIGH, `fixAvailable: false`** | Prototype pollution + ReDoS. SheetJS left npm; this is the last published version and is **permanently vulnerable**. It is fed **user-uploaded files** at `routes/import.js:41` (`XLSX.read(buffer)`) and is also a frontend dependency. Attacker-controlled input, no upstream fix — the single most exposed dependency in the stack |
| **`sqlite3@5.1.7`** | **CRITICAL** (via `tar`) | Drags `tar`/`node-gyp`/`cacache` and the entire critical chain. SQLite is archived — all active code is Postgres-only. This is **dead code whose only remaining function is importing a critical CVE** and forcing `python3 make g++` into the Docker build. Deleting it clears ~6 findings outright and is the cheapest high-value win available |
| `nodemailer` | HIGH | SMTP command injection via CRLF; used for tenant receipt/CRM mail. Fix available |
| `multer` | HIGH | 5 DoS vectors on the upload path. Fix available |
| `sharp <0.35.0` | HIGH | Inherited libvips CVEs; processes user-uploaded product images |
| `path-to-regexp`, `minimatch`, `brace-expansion`, `js-yaml` | HIGH | ReDoS/DoS. All fixable |

Everything except `xlsx` has a fix available today.

### P1 — Would not sign off

| # | Finding | Evidence | Why it is P1 |
|---|---|---|---|
| **1** | **At least 8 independent stock-movement implementations** on sale-side paths, only one of which is the shared ledger extracted for the purpose | §2.1, file list above | Stock is the product. Eight hand-synchronised copies of one invariant guarantees divergence; the only question is which merchant discovers it. Today's 59 sales are the only reason this is invisible |
| **2** | **The test suite is a prop.** 334 test files; CI executes **5**. 36 integration files cannot load (`require("../helpers/createTestApp")` — deleted). 4 more use `jest.*` globals under Vitest | Verified: exactly 36 files, exactly 202 integration files, 2 workflows | The 36 are the *original* suite: sales, returns, RBAC, security, shifts, auth, concurrency, data-integrity. The highest-value paths in a money-handling system have had **no executing tests** for an unknown period, and no signal exists that would tell you |
| **3** | **CI gates nothing that matters.** A PR breaking every integration test and failing typecheck merges green | `.github/workflows/{lint-guard,tz-guard}.yml` | Two lint/token guards and a tz scan. `tsc --noEmit` and `vite build` are not run. A broken build can reach production |
| **4** | **External payment capture executes inside the sale DB transaction**, with row locks held; gateway failure throws 402 and rolls the transaction back | `routes/sales.js:2113` inside `db.transaction` opened at `:1697` | A card can be charged with no local sale record, and no compensation logic at the call site. Zero exposure today because volume is zero. This is the finding that turns into a chargeback dispute you cannot win |
| **5** | **`POST /api/sales` — no permission guard, no `PERMISSION_RULES` entry, and explicitly exempt from rate limiting** | Verified: `sales.js:595` (only `validate`); no matching rule in `permissions.js:126-364` | §2.4. Note the same file's GET routes *are* guarded — this reads as omission, not design |
| **6** | **Playwright — the only substantial test suite — runs against live production with credentials committed in plaintext**, provisioning real tenants with no automated cleanup | `playwright.config.js:17` (`baseURL: https://sanopos.com`), `tests/helpers/auth.js:20-25` | Your regression net mutates the system it is meant to protect. There is no staging environment to move it to |
| **7** | **No graceful shutdown anywhere.** Zero `process.on(...)` handlers in backend source; `shutdownBoss()` defined, never called | Verified repo-wide | Every deploy hard-kills in-flight requests and mid-execution jobs. For a POS, "deploy" means "some cashier's sale disappeared." Combined with #8 this is your most likely *first real* incident |
| **8** | **A failed migration is a self-inflicted total outage with no rollback path.** `start.sh` runs all-tenant migrations before the server binds; `railway.toml` sets `restartPolicyMaxRetries = 3`; single instance | `backend/start.sh`, `backend/railway.toml` | Three failures and the service stays down. Migration time is linear in tenant count inside a 120 s healthcheck. A rollback procedure **does** exist (`docs/fable5/go-live/DEPLOY-RUNBOOK.md` §6) but its fast path is a **force-push to main**, and `start.sh` re-runs migrations at every boot — so rolling back code still boots against the newer schema. That is safe only by the additive-migration convention, which nothing enforces |
| **9** | **Every route — including the till and the marketing homepage — downloads the entire Reports application and a charting library before it renders.** `manualChunks` backfired: the entry chunk **statically imports** `reports` and `recharts`, and `index.html` modulepreloads both | Verified: `vite.config.js:19-31`; entry contains `from"./reports-*.js"` and `from"./recharts-*.js"`; `dist/index.html` preloads both | 1.23 MB raw / 310 KB gzip on the critical path of every page, ~74% avoidable. POS first load is **1.49 MB raw / ~410 KB over the wire** — a realistic **8–15 s cold-start-to-first-sale** on the target cheap Android tablet. Deleting that block is the single highest-ROI change in the codebase |
| **10** | **A keyboard-only cashier cannot ring up an item.** The primary add-to-cart control is a bare `<div onClick>` with no `role`, `tabIndex` or key handler | `POSSearchArea.jsx:107-109, :129-131`; app-wide 57 non-semantic click targets, **0** with `onKeyDown` | WCAG 2.1.1 failure on the product's core interaction |
| **11** | **Offline sales are booked to the wrong business day and the wrong shift.** The queued payload carries no client timestamp and no `shift_id`; `queued_at` **is** stored in IndexedDB and simply never sent | `offlineQueue.js:92`; `backend/routes/sales.js:1833` | A sale rung Tuesday 20:00 and synced Wednesday 09:00 books to Wednesday. Tuesday's Z-report is short, Wednesday's is over. This corrupts the one number a merchant reconciles daily |
| **12** | **Failed offline sales are never retried, and the only recovery UI is admin-gated.** `syncQueue` selects `"pending"` only, so `markFailed` rows are terminal — while the banner reads *"will sync automatically"* and "Sync now" is a no-op for them | `useOfflineQueue.js:78, :90-108`; `POSHeader.jsx:37,130` gates `POSStuckQueueModal` behind `all_access` | A cashier watches revenue sit stuck with no button that fixes it, and is told it is syncing |

### P2 — Fix this quarter

| # | Finding | Evidence |
|---|---|---|
| 9 | **Commercial controls fail open** — plan caps and expired-subscription blocking both `catch → next()`; `requirePlanLimit` exists at only 3 of 1,344 endpoints | §2.3, `middleware/plan-limits.js` |
| 10 | **H1 price authority fails open three ways** and compares aggregates with a 1% tolerance | §2.2, `routes/sales.js:1250-1298` |
| 11 | **`GET /api/feature-flags` is unauthenticated** — checks header *presence*, not value; unknown tenant returns 500, giving an existence oracle | CONFIRMED live in the report; re-confirm before/after fixing |
| 12 | **Shopify order webhook is unreachable** — mounts behind the tenant wall, returns `AUTH_REQUIRED`; its HMAC verification never executes | CONFIRMED live. Zero blast radius (0 connections); breaks the first merchant who connects |
| 13 | **Credential encryption degrades to plaintext silently — and asymmetrically.** `encryptSecret` returns the value unchanged with no key; `decryptSecret` **throws** for the same missing key | `services/crypto.js:26` vs `:39` |
| 14 | **The security test harness validates a mirror, not the real rules.** `tests/helpers/createTestApp-pg.js:100-131` duplicates `PERMISSION_RULES` verbatim, hand-maintained, **with no drift guard** | Subsystem audit 07 §2.3 |
| 15 | **`jwt.verify` never pins `algorithms`** at any of 6 call sites; zero occurrences of `algorithms` in the backend | Verified |
| 16 | **Wholesale credit-limit tests are entirely `it.skip`** — hard/warn block modes, manager-PIN override, refund reversal have zero coverage | Report §11.2; the most financially sensitive untested logic in the product |
| 17 | **Backend has no linter at all.** No ESLint config, no dependency. The larger, security-sensitive half has no static analysis | Verified |
| 18 | **Two DDL sources of truth** (`schema-pg.sql` + `MIGRATIONS`) with no drift check, while provisioning stamps all 133 versions as applied. A column a migration adds but the schema file omits produces a tenant permanently missing it, silently | Report §5.6 |
| 19 | **Migration versioning is not gap-safe.** `current = MAX(version)`, `pending = version > current` — a migration merged below the head is skipped forever, with no error | Verified `migrate-pg.js:10030-10034` |
| 20 | **Single-instance-only by construction.** 8+ process-local caches with in-process-only invalidation, plus in-memory rate limiters. `LISTEN/NOTIFY` is unavailable on the transaction pooler | Report §13.1 |
| 21 | **A refund can pay commission on the refunded sale.** `routes/returns.js:788-792` — commission reversal is **not awaited**, runs outside the transaction, errors go to `console.error`. `tier4/hr.js:339` then auto-approves pending commissions into payroll. Customer refunded, commission paid, no trace | Money leaves twice |
| 22 | **A refund can leave the account with no local record — and a retry issues a second one.** `returns.js:729-737`: gateway refund executes, then `UPDATE returns SET gateway_refund_ref` runs unwrapped | |
| 23 | **`res.json()` executes inside an open transaction.** `routes/grn.js:462` returns "Payment recorded" 200 **before COMMIT**; the catch at `:467` then fires a 500 on an already-sent response. The same route's over-payment guard reads `SUM(amount)` outside the transaction with no `FOR UPDATE` — two concurrent payments both pass. It also has **no permission guard at all** (only `requireFeature`), while its sibling void route requires `manage_finance` | `grn.js:404-466, :505` |
| 24 | **Lost update on goods receipt.** `grn.js:202` reads `qty_received` outside the transaction and `:243` writes it as an **absolute** value rather than `qty_received + $1`. Two concurrent receipts of one line both read 5, both write 6 — a unit vanishes | |
| 25 | **The xpay webhook dedupes by nothing.** `webhooks.js:177-182` inserts to `payment_webhook_events` with `ON CONFLICT DO NOTHING` — **the result is never consulted**; execution falls straight through. The key is synthetic (`transaction_id + event_type`), not the gateway's event id, so a genuine retry and a duplicate delivery are indistinguishable. Only Context 1 (platform billing) has a downstream status check; deposits, invoice links, pay-at-table and storefront have none | This is the mechanism behind P0-1 and P0-2 |
| 26 | **Gift-card redemption is replay-unsafe, and has two independent implementations.** `routes/gift-cards.js:349-391` is concurrency-safe (`FOR UPDATE`) but has no idempotency key — a POS retry after a network timeout debits twice. `sales.js:2128-2178` is a **second, independent gift-card debit path** with its own lock and its own ledger insert — the same duplication class as the stock writers, a different instance | |
| 27 | **No log redaction anywhere.** `services/logger.js` is 10 lines and configures no Pino `redact`. Payment **tokens** are already logged at `info` (`payment-gateway.js:245, :256`; `sandbox.js:256`). Any handler logging `req.body` leaks immediately with nothing to catch it | |
| 28 | **No metrics, no slow-query logging.** No `/metrics`, no `prom-client`, no timing wrapper in `db-pg.js`. Request duration exists only as prose inside a log string. Given the N+1s below, there is no way to attribute a slow request to a query | |
| 29 | **952 handlers return `res.status(500).json({ error: err.message })`** — raw Postgres text (constraint, column and relation names) shipped to any authenticated client | |
| 30 | **Query landmines that will bite on the first real catalogue.** `sales.customer_id` is **unindexed** (`schema-pg.sql:2032-2043`) while six customer-detail queries filter on it; `GET /api/products` has **no pagination parameter at all** plus three unconditional full-table aggregate subqueries; `applySaleTimeFilters` (`reports/sales.js:30-39`) has **no `else` branch**, so ~17 report endpoints run all-time when dates are omitted — worst is `/api/reports/item-wise`, a 6-way join over every `sale_items` row ever written with no LIMIT; `action_history` and `notifications` have **zero indexes** and are both written/polled on hot paths; the dashboard does `1 + 3N` sequential round-trips under a comment claiming a single query | |
| 31 | **Two `setInterval` pollers run on the web process event loop**, competing with live POS traffic for the same 20-connection pool — Shopify sync every 30 s per tenant with **no feature-flag gate** (`boot/workers.js:194-215, :225-245, :279-296`). Separately `course-release-worker` checks its flag *after* the per-tenant DB checkout — ~42k wasted queries/day today, 300/min at the documented 300-tenant target | |
| 32 | **Zero API versioning across 1,344 endpoints**, consumed by four independent clients including an installable PWA that can run arbitrarily stale code against a changed contract. **OpenAPI documents ~1%** — 15 `@swagger` blocks in 9 files, 5 schemas, not one vertical entity. Only **16** error responses carry a machine-readable `code`; clients must string-match English prose for every business error | |

### P3 — Backlog, but put dates on them

| # | Finding | Note |
|---|---|---|
| 21 | **No internationalisation and no RTL support.** No i18n framework anywhere in `frontend/src`; strings are hardcoded English | A Pakistan-first product with Urdu-language tax data in the DB and stated global ambition. Retrofitting i18n across ~500 components later costs 5–10× doing it now |
| 22 | **Accessibility is untested.** `@axe-core/playwright` is installed and imported by **zero** specs. `Modal`/`Drawer` carry `role="dialog"` + `aria-modal` but focus-trap behaviour is unconfirmed | Staff use this 8 hours a day. ⚠️ Full a11y assessment incomplete (§0) |
| 23 | **The API is undocumented for anyone but its own SPA.** OpenAPI covers **5 entities** of 327 tables, behind a shared-secret gate (404 without `API_DOCS_KEY`) | No versioning (`/v1/`) on 1,344 endpoints. Any future partner, mobile app or integration starts from zero |
| 24 | **`sale_payments` has no `created_at`**, no cascade, no amount-sign CHECK, no payment-method enum | Split-tender forensics in a POS without a per-tender timestamp |
| 25 | **Clinical allergy checks are advisory warnings only** | Subsystem audit 08 §7. A clinic module that warns rather than blocks on allergy conflict is a patient-safety and liability question, not a UX one |
| 26 | **Billing state transitions live inside the email worker** — disabling `EMAIL_WORKER_ENABLED` silently stops trial→grace→expired | Report §7.2 |
| 27 | **`processedToday` never resets**; **marketplace sync worker schedules nothing** (honest stub) | The admin dashboard reports numbers that do not mean what they say |
| 28 | **Public schema carries the entire 326-table tenant DDL** as empty shadow tables, forcing ~74 defensive migration guards | No data exposed (RLS clean); permanent confusion tax |

### Credit where due — verified positives

Not everything degrades. These were checked, not assumed:

- **Audit logs are append-only in application code.** Repo-wide, the only `UPDATE`/`DELETE` against `action_history`, `admin_activity_log`, `admin_security_log` are in test fixtures. Production code only inserts. (Caveat: the app connects as `postgres`, so this is a code convention, not a DB-enforced guarantee.)
- **The AI insights path sends aggregates, not PII.** `routes/insights-ai.js` composes store name, sales summary and top-product names — no customer names, phones, emails or addresses. (⚠️ The vision/invoice-photo path in `services/ai.js` was not assessed.)
- **Tenant isolation is correct.** `SET LOCAL search_path` inside an explicit transaction, with a proxy that *throws* rather than defaulting. This is the right answer to a subtle problem and it is implemented properly.
- **Migration fleet is clean.** All 29 tenants at v137, matching code head — despite a runner that tolerates per-tenant failure. That is a real operational signal.
- **The drift-guard culture is genuinely good engineering.** Eight guards, several keyed on "fail on new, never on totals." The instinct is right; it has simply never been pointed at the test suite's own health.

---

## 3A. The frontend — measured, not inferred

The incoming report assessed the frontend's *architecture*. Nobody had measured its *behaviour*. A build was run and the numbers taken.

### 3A.1 Accessibility: this would fail an audit at the first screen

**The POS does not use the design system at all.** Verified: of 40 files in `pages/redesign/pos/`, **zero** import `ui/primitives`, **zero** contain `role="dialog"`, **zero** contain `aria-modal`. All 39 POS modals are hand-rolled `fixed inset-0` divs. The checkout modal — the most-used screen in the product — is an unlabelled `<div>`. Only 3 of 39 handle Escape.

**The documented focus trap does not exist.** `ui/CLAUDE.md` and `frontend/CLAUDE.md` both assert "focus trap on open." `primitives.jsx:282-306` handles Escape, initial focus and focus restore — but there is **no Tab containment, no `inert`, no background `aria-hidden`, no scroll lock** (0 hits for `inert` across `src/`). Tab from an open modal walks into the page behind it. `primitives-modal.test.jsx` has 10 cases and **zero** touching focus, so the gap is invisible to the suite. *This is a documentation claim that is simply false* — add it to the audit's list of doc contradictions.

**Labels are not associated with inputs.** 2 `htmlFor` against 757 `<label>` and 997 inputs. A screen reader announces roughly 995 unlabelled fields. `aria-live`: 0. `role="status"`: 0. `role="alert"`: 1. The toast container (`ToastContext.jsx:39`) has no live region — all 307 toast/error strings are silent to assistive tech and gone in 4 s.

**Contrast fails at the token level, which means it fails everywhere at once:**

| Pair | Ratio | Required |
|---|---|---|
| `--ui-border` `#f0f0f0` | **1.14:1** | 3:1 |
| `--ui-border-strong` `#e3e3e3` (inputs, toggle-off) | **1.28:1** | 3:1 |
| `--ui-muted-surface` `#f5f5f5` (default Button fill) | **1.09:1** | 3:1 |
| `--ui-text-muted` on muted surface (Badge, 12px) | 4.43:1 | 4.5:1 |
| disabled Button (`opacity-50`) | 3.54:1 | 4.5:1 |

The hairline border *is* the Square look, and at 1.14:1 every card edge, table divider, input boundary and toggle in the application is below the 3:1 floor. Under bright counter lighting on a cheap tablet this degrades usability for sighted staff too — it is not an audit checkbox.

`@axe-core/playwright` is installed and imported by **zero** specs.

**Verdict:** fails WCAG 2.2 AA on 1.3.1, 2.1.1, 2.4.3, 4.1.2, 4.1.3 and 1.4.11. For a product sold to clinics — and in some markets to public-sector buyers — this is a procurement blocker, not polish.

### 3A.2 The bundle: 74% of every first load is avoidable

Build succeeds in 50.8 s: 215 chunks, 4.30 MB raw, 1.04 MB gzipped. The `manualChunks` block at `vite.config.js:19-31` forced Rollup to place the shared vendor graph *inside* the `reports` and `recharts` chunks, which promoted both to hard dependencies of the entry — react-dom ended up in the recharts chunk, react-router in the reports chunk. The comment on `:29` says "Let Vite auto-split app code via lazy()"; the configuration above it does the opposite.

Critical path on **every** route: `index` 316 KB + `reports` 487 KB + `recharts` 423 KB = **1.23 MB raw / 310 KB gzip** before any route chunk loads. POS adds `POSRoute` 94 KB and a **static** `EndlessAisleModal` 153 KB (an out-of-stock modal most tenants never open) → **1.49 MB raw**, ~410 KB over the wire with CSS.

Correctly lazy, and worth preserving: `xlsx`, `jsbarcode`, `qrcode`. The problem is confined to the manual chunks.

**No size budget, no Lighthouse, no `vite build` in CI.** Nothing caught this regression and nothing will catch the next one.

### 3A.3 Offline: five concrete revenue-loss modes

Beyond P1 #11 and #12 above:

- **Row 51 hard-blocks checkout with no warning.** `offlineQueue.js:70` throws at the 50-row cap; the cart is not cleared and no sale is recorded. `WARN_THRESHOLD = 40` is exported at `:9` and **consumed by nothing**. No UI string anywhere mentions the cap. The cashier goes from "fine" to "checkout refuses" with zero runway.
- **The queue is invisible to the next cashier.** Reads go through `getQueue(employee.id)`. Cashier A queues four sales and goes home; cashier B sees zero on the same terminal.
- **The browser may delete the queue.** `navigator.storage.persist()` is never called (0 hits). IndexedDB is best-effort; under storage pressure Chrome can evict the origin and destroy unsynced sales. One unwritten line.
- **Sync only fires on the `online` event** — no sync-on-mount, so a reload with pending rows does nothing until manual intervention.
- The idempotency key is a per-checkout UUID, so cross-device collision is a non-issue. The real duplicate risk is the inverse: ringing the same cart twice yields two different keys and two real sales. Idempotency protects replay, not double-ring.

### 3A.4 Data freshness: no cache, no cancellation

No react-query, no SWR — zero hits. **589 `api.get` call sites, 522 `useEffect` across 271 files, and 0 `AbortController` in the entire frontend.** Consequences: last-response-wins races on every filter change (systemic, not hypothetical); no cross-component dedupe (POS mount alone fires ~25 requests, refetched cold on every navigation); and permanent staleness between terminals — terminal A adjusts stock, terminal B keeps the old number indefinitely with no cache to invalidate.

**32 `setInterval` pollers, 4 visibility guards.** The customer display polls every **2 s** — ~43,000 requests per terminal per day, continuing in a backgrounded tab. On the target hardware that is a battery and mobile-data cost, on a single backend instance it is load with no user.

### 3A.5 Error handling: a dead backend looks like an empty catalogue

Across 198 files in `pages/redesign`: **728 catch blocks, of which 130 (17.9%) produce no user-facing signal at all** — 79 completely empty, 14 console-only, 37 that just reset the list to `[]`. Zero retry affordances anywhere. Two files use `Skeleton`.

The dominant shape is `{!loading && rows.length === 0 ? <EmptyState/> : null}` with `rows` still `[]` after a failed fetch. `InventoryRedesign.jsx:219` logs a failed product fetch to console, then `:891` renders *"No products found — Try changing filters, or import products from Shopify."* **A merchant whose API is down is told their catalogue is empty and nudged toward a re-import.** `BillingRedesign.jsx` swallows all three loads and renders trial/plan state against `{}`.

Root cause is structural: 728 independent catch blocks each re-deciding what failure means, because no shared fetch hook decides it once.

### 3A.6 Two defects that will read as "this software is bad"

- **The POS context value is not memoized.** `POSContext.jsx:972` builds a plain ~200-key object literal passed to the Provider at `:1271`, and `useCart` holds the search fields as state *inside* that provider. Every character typed — or every barcode-scanner keystroke — creates a new context object and re-renders every consumer: the cart table (which has **0** `useMemo`/`memo`), the sidebar, the header and all 39 unconditionally-mounted modals. This is the direct cause of "the POS feels laggy when I type," and it degrades linearly with cart length.
- **109 native `window.confirm`/`alert`/`prompt` calls**, including the age-restriction gate (`POSOmniInput.jsx:15`, `POSPluPad.jsx:49`). Chrome's "prevent this page from creating additional dialogs" permanently disables them for the session — after which **the age gate returns `false` and silently refuses every restricted item.** A compliance control defeated by a checkbox the cashier clicks once.

Also: 82 uses of `h-screen`/`100vh` and **0** of `dvh`/`svh`, so on Android-in-a-browser-tab the URL bar clips the Pay button inside an `overflow-hidden` container that cannot scroll to it. 56 `console.*` calls ship in the production bundle.

### 3A.7 Frontend test reality

25 unit files / 202 cases against 500 source files. Coverage is the **pure-function perimeter only** — `cartMath` (well covered), barcode, scale, offline queue. **There is no rendered-component or hook test for POS checkout anywhere.** The ~9,441-line POS module (`POSCheckoutModal` 1,020 lines, `useCheckout` 640, `POSContext` 1,272, `POSReturnExchangeModal` 927) — multi-tender split, 401 recovery, `insufficient_stock`, credit-limit manager-PIN retry, offline fallback, exchange ordering — is verified **only** by Playwright specs against production. CI runs **one** of the 25 unit files.

### 3A.8 The i18n retrofit, quantified

~3,170 JSX text nodes + 1,467 literal attribute strings + 307 toast strings + 20 confirm strings ≈ **4,960 extraction sites** across 461 files, none behind a key. 150 hardcoded `toLocale*` calls with explicit `en-US`/`en-GB`. For RTL: ~845 physical margin/padding utilities, ~1,158 `text-left`/`text-right`, 124 `left-`/`right-` — against exactly **one** logical utility in the entire codebase. `index.html:2` hardcodes `lang="en"`.

Realistically **6–10 weeks before the first translated string ships**, and RTL is the larger half. For an Urdu/Arabic-market POS this is a strategic constraint, not a backlog item — and it gets worse with every page added.

---

## 3B. Privacy, compliance and continuity

This is the domain the incoming report explicitly excluded, and it holds the findings with the longest tail — regulatory exposure does not go away when you fix the code.

### 3B.1 The R2 finding — and a conclusion neither audit reached alone

`index.js:159-183` mounts the `/r2/*key` proxy **above the entire tenant middleware chain**, with no `loadTenantAndPerms`, no `requirePerm`, no tenant check. Its only control is a three-prefix allowlist (`products/`, `company/`, `support/`). There are no signed URLs anywhere (`grep getSignedUrl|presign` → zero).

Which failure mode you are in is decided by one environment variable:

- **`R2_PUBLIC_URL` set** → the proxy **does not mount at all** (`index.js:160`), the allowlist evaporates, and every key becomes a public URL: field-rep selfies, clinical attachments, signed consent forms, CNIC and passport photos, scheduled report CSVs with fully predictable names — **and `backups/full-backup-*.dump`, a complete pg_dump of `public` plus every tenant schema.**
- **`R2_PUBLIC_URL` unset** → the proxy mounts, and everything outside the three prefixes 404s.

**The incoming report's own verification log (§11) records `R2_PUBLIC_URL` as unset in production.** Combining that with this finding produces a conclusion neither audit drew:

> **You are fail-closed on confidentiality and fail-broken on functionality.** `uploadToR2` writes `{APP_PUBLIC_BASE_URL}/r2/<key>` into the database and the owner UI renders it directly — `field/FieldVisitsRedesign.jsx:194-197` puts `selfie_url` into an `<img src>`. Under the current configuration that resolves to **404**. The same holds for clinical attachments, consent-form signatures, guest CNIC/passport photos, handouts and PoD images.

So either those features are silently broken in production today, or the env var has changed since that check and you are in the exposed mode. **Verify `R2_PUBLIC_URL` on Railway before anything else in this document** — it is a one-lookup question that decides whether patient attachments and full database dumps are world-readable. Two schema comments (`schema-pg.sql:4743, :5048`) explicitly rely on "non-guessable R2 prefix" as the control for CNIC/passport photos, which is security by obscurity as documented intent.

Separately: **`deleteFromR2` is wired into no deletion path at all.** It is called only from `routes/orders.js`. Selfies, clinical documents, ID photos, support screenshots and backup archives for *deleted tenants* persist in the bucket indefinitely — and the helper takes a single key, so there is not even a prefix-delete primitive to build teardown on.

### 3B.2 Nothing sensitive is encrypted above the database

`grep pgcrypto|pgp_sym|crypt(` across the schema and migrations → **zero hits**. AES-256-GCM is applied only to integration credentials. **No health record, biometric image, CNIC, GPS coordinate or payment identifier is encrypted at rest above the Postgres layer** — including `customers.blood_group/allergies/medical_notes`, `diagnosis_history`, `field_visits.selfie_url/gps_*`, `rental_contract_drivers.cnic`, `booking_guests.cnic_passport`.

One credential deserves its own line: **the FBR API token is stored unencrypted** (`routes/fbr.js:48-50` writes `company_profile.fbr_api_token` raw, merely masking it on read). That is a live credential to a national tax authority sitting in plaintext.

### 3B.3 Data-subject rights are promised and cannot be delivered

- **No erasure exists anywhere.** Customer delete is `UPDATE customers SET deleted_at = NOW()` (`customers.js:1109-1123`); employee delete likewise. No hard-delete path, no scrubbing, no anonymisation. The row keeps `cnic`, `date_of_birth`, `blood_group`, `allergies`, `medical_notes`, `insurance_id` **forever**. A GDPR Art. 17 or Pakistan PDPB erasure request **cannot be honoured by any endpoint that exists.**
- **No data-subject export.** The portal offers piecemeal `GET /me/*` reads; a tenant-wide `pg_dump` is not a DSAR response.
- **Employee GPS and selfies survive termination** intact — no cascade, no `deleted_at` on `field_visits`, and **no DELETE route touches that table at all**.
- **Retention is "forever"** for `field_visits`, attendance, customers, clinical tables, consent forms and audit history. Only pg-boss jobs expire.

Meanwhile `Privacy.jsx:115` discloses a granular retention schedule and `:122-134` asserts data-subject rights. **Both are contradicted by the code.** That gap — promising rights you have not built — is the specific thing regulators penalise.

### 3B.4 The legal documents are unfilled templates

`Privacy.jsx:14,19,40` and `Terms.jsx:14,20,22` contain literal `[Legal Entity Name]`, `[Registered Address]`, `[Effective Date]`, `[Last Updated Date]` placeholders — on live, publicly linked routes that a binding signup consent checkbox points at. The consent version recorded at signup is a **hardcoded `"1.0"`** in `SignupPage.jsx:90`, disconnected from the `TERMS_VERSION`/`PRIVACY_VERSION` constants the documents themselves export, so revising a document would silently mis-record every subsequent consent.

Credit where due: the sub-processor disclosure (`Privacy.jsx:87-100`) is unusually thorough and **does** name Anthropic. But it has **zero mentions of GPS, geofencing, selfies, biometrics, CNIC, or health data** — all four actively collected — and omits Daraz, Meta, WhatsApp, Shopify, WooCommerce and Google Merchant despite exchanging customer data with them. `Terms.jsx:90` promises a DPA "available on request"; **no DPA exists in the repo.**

### 3B.5 Field-rep monitoring: do not sell this into the EU or UK

Every check-in captures raw-precision GPS, accuracy, distance-from-shop, an out-of-fence flag, **and a selfie**. The UI makes both mandatory (`FieldCheckInRedesign.jsx:306` disables submission without them) even though the backend is lenient. Grep of the field pages for consent or notice text returns **no matches** — GPS fires silently on mount and the only "notice" is the browser permission prompt.

The access model is asymmetric against the worker: `manage_field_sales` grants managers the all-reps log including selfies, GPS and customer contact details, while **a rep cannot view their own history**. No deletion route exists for either party. Retention is unbounded.

Continuous location tracking plus facial imagery of employees, mandatory, with no notice, no DPIA artefact, no retention limit, no subject access and no deletion, engages GDPR Art. 5(1)(c) and (e), 13, 15, 17 and 35 simultaneously. Pakistan's PDPB covers the CNIC/health/biometric categories once in force. **This feature needs rebuilding before any EU/UK sale**, and it is worth noting the product contains two independent geofence systems with opposite semantics — attendance *blocks* out-of-fence, field sales only *flags*.

### 3B.6 FBR: a sale can be completed and never reported, invisibly

Posting is async and non-blocking by design (`sales.js:2591-2620`), which is correct. What is missing is the other half: **no reconciliation exists anywhere.** Every FBR query selects from `fbr_invoices`; none does `LEFT JOIN sales … WHERE fi.id IS NULL`. A sale that never got a queue row is **structurally invisible to every surface in the product**, and three separate paths produce exactly that silently — the internal credential gate, the flag-off short-circuit, and any swallowed enqueue error.

Compounding: `abandoned_no_creds` is a terminal state with no alert, no dead-letter row, and it is **not in the dashboard's status map** — those invoices vanish. Voiding a still-`pending` sale leaves FBR with a live invoice and no debit note. Returns don't gate on FBR status at all and can emit a credit note for an invoice FBR never received. And `PUT /api/fbr/config` flips the integration off with **no audit write** — the flag isn't in `DEFAULT_FEATURE_FLAGS`, so it bypasses the business-modules audit engine too. A tenant can go dark and come back leaving no record the gap occurred.

For a product whose Pakistani differentiator *is* tax compliance, "we cannot prove every sale reached FBR" is the finding that matters most commercially.

### 3B.7 Continuity: the only real backup is the one outside this repo

The platform backup endpoint dumps `public` plus every tenant schema to R2 with **no application-level encryption**. It is **not scheduled** — no cron invokes it, and `boot/workers.js:159-161` gates auto-backup behind `!process.env.DATABASE_URL`, so it never runs in production. **The only functioning automated backup is Supabase's own daily snapshot plus 7-day PITR**, which is outside this codebase and outside your control surface. Restore has zero test coverage and is simultaneously the audit-erasure vector in P0-3.

Dependency failure behaviour, verified: Supabase down → total outage, no degradation path (pg-boss is Postgres-backed, so workers stop too). R2 down → sales still complete, but the local-disk fallback only triggers when R2 env vars are *absent*, not when R2 is *erroring* — and Railway wipes that directory on deploy. Resend down → lifecycle emails survive via pg-boss, but **receipts do not**: `POST /api/email/send-receipt-v2` calls the provider synchronously with no queue and no retry, so the request 500s and the receipt is lost rather than deferred.

### 3B.8 Measured availability — and a monitor watching the wrong thing

No audit has ever cited the *measured* SLA of this POS. Pulled from UptimeRobot for this engagement:

| Window | Uptime |
|---|---|
| 24 h / 7 d / 30 d | **100%** |
| 90 d | **99.818%** |
| Average response | 324 ms |

The clean recent record is real — 70 unbroken days since 2026-05-20. The incident history behind it is less comforting. Three outages, every one a **502 Bad Gateway**:

| Start | Duration |
|---|---|
| 2026-04-18 20:35 | **22 h 27 m** |
| 2026-04-20 12:16 | 58 m |
| 2026-05-19 22:24 | **3 h 55 m** |

**A 22-hour outage means a merchant could not sell for an entire business day.** The 99.818% figure is only that high because the two April incidents fall outside the 90-day window; the residual 0.182% is precisely the May outage. And 502 is the signature of the container being down or crash-looping — exactly what the single-instance topology plus `restartPolicyMaxRetries = 3` plus migrations-in-the-boot-path (P1 #8) produces. The architecture predicted this failure mode and the monitor recorded it three times.

Two caveats make the green number weaker than it looks. First, **the 70-day perfect streak coincides exactly with the collapse in usage** — sales went 36 in May to 2 in July. An idle system is a reliable one. Second, and more seriously:

**The monitoring measures the wrong endpoint on the wrong hostname.**

- There is **exactly one monitor**, and it points at `oneshoppos-production.up.railway.app` — the Railway fallback domain. The SPA actually calls **`api.sanopos.com`**. A custom-domain, DNS or TLS-certificate failure would take every merchant offline while UptimeRobot reported 100% green.
- It polls `/api/health` **without** `?deep=true`. Verified at `registerAllRoutes.js:52-56`: the quick path returns `{status:"ok"}` unconditionally and **touches no dependency**. It is a liveness probe. **A total Supabase outage — which §3B.7 establishes as a full outage with no degradation path — returns HTTP 200 and raises no alert.**
- There is **no monitor at all** on the frontend (`sanopos.com`), on either customer portal, or on the deep health check.

So the one number that looks unambiguously good in this entire assessment is measuring a hostname users don't hit, via an endpoint that cannot fail for the reason most likely to take the system down. Pointing a second monitor at `https://api.sanopos.com/api/health?deep=true` is a five-minute change and converts this from decoration into an actual control.

---

## 4. The three things nobody is looking at

### 4.1 Documentation has become a substitute for validation

**397 markdown files. 151,194 lines.** Against ~300,000 lines of application code and 59 sales. `docs/fable5/` alone holds 26 programme directories, including **three overlapping architecture descriptions** — `platform-architecture-vnext` (proposed), `technical-architecture-report` (current-state), and `platform-architecture-claude-report` (current-state, live-verified) — each requiring a precedence rule in `CLAUDE.md` to tell a reader which to believe.

That precedence rule is the tell. When a codebase needs a documented hierarchy of which of its own documents to trust, documentation has stopped reducing uncertainty and started producing it. The audit itself found **three project-doc claims that are actively wrong** (`max_connections` 200 vs 60; background marketplace sync that doesn't exist; a stock-ledger consolidation that never happened) — and we found a fourth class: the report's own headline understating its own top finding.

An agency would say this plainly: **the effort spent producing 151k lines of documentation about a product with 5 selling tenants would have been better spent on 5 more selling tenants.** Documentation is a lagging artefact of validated decisions. Here it has become the primary output.

*(This document adds to that pile. Delete it once acted upon. That is not a joke — a stale assessment is worse than none.)*

### 4.2 Bus factor is 1, and no control exists to catch a mistake before production

**A correction to an earlier draft of this document, which said no rollback procedure was written down.** That was wrong. `docs/fable5/go-live/DEPLOY-RUNBOOK.md` exists — 116 lines with a pre-push go/no-go checklist, migration verification, health and worker checks, a smoke list, and a real rollback section. It is the single best operational artefact in the repository. It is also **frozen to one release** (v109→v122, written 2026-07-07) with hardcoded SHAs and stale TODOs — a deploy journal rather than a maintained runbook. There is still no incident log, no on-call definition and no escalation path.

**Code review is not thin — it is absent.**

| Measure | Value |
|---|---|
| Pull requests, all time | 30 (all authored by the sole developer) |
| PRs reviewed by a second **human** | **0** |
| Reviews that were `APPROVED` or `CHANGES_REQUESTED` | **0** — all 43 are bot `COMMENTED` (`gemini-code-assist`, `chatgpt-codex-connector`) |
| Commits that never appeared in a PR | **1,861 of 1,923 — 96.8%** |
| PRs in the last three months | **0** |

**Main is unprotected and *cannot* be protected** — `gh api .../branches/main/protection` returns 403: the repo is private on a plan without branch protection. No required reviews, no required checks, no force-push block. The runbook's own rollback fast path depends on that remaining true.

**Three free security switches are all off:** Dependabot alerts (disabled), Dependabot security updates (disabled), secret scanning and push protection (disabled). This is not a permissions denial — the features were never enabled. Combined with the 30 known vulnerabilities in P0-4, this is the cheapest gap in the entire assessment to close.

**CI history is worse than its current state suggests.** A third workflow (`API Parity Audit`) failed **86 of 102 runs (84%)**, mostly on main, then was deleted. **Between 2026-03-14 and 2026-07-09 the repository had zero CI** — a four-month gap covering the heaviest development period in its history (749 commits in April alone). `lint-guard.yml` was added on 2026-07-28, *one day* before the audited HEAD.

**No staging environment exists.** `railway status` shows a single `production` environment. `git push origin main` is simultaneously the deploy trigger for backend and frontend, with no pre-production gate and no integration tests in CI.

**Production credentials are committed.** `frontend/tests/helpers/auth.js` exports store code, username, password and PIN as **literal fallback defaults**, paired with `playwright.config.js:17` pointing at `https://sanopos.com`. A clone of this repo yields a working login to the live application with zero setup. Six `onboard-*.spec.js` files and the functional sweep carry hardcoded passwords used to create real tenants on production. *(Backend integration tests with hardcoded passwords are fine — those run against ephemeral local schemas. The git history is otherwise clean: no `.env` was ever tracked, and strict scans for AWS/Shopify/Anthropic/GitHub key formats return zero real hits.)*

**What only one person can do, and where it is written down:** Railway env writes, Vercel, Supabase — *the only database and the only PITR restore path* — Cloudflare DNS, Sentry, UptimeRobot, R2, and super-admin panel access. Every credential lives in one gitignored file on one Windows machine. **None of it is documented anywhere in-repo.** `backend/.env.example` lists 15 variables against a production set of 25+, and only 2 secrets are hard-asserted at boot. If that machine dies, production keeps serving traffic but becomes permanently unmodifiable and unrecoverable — the Supabase restore itself needs dashboard access nobody else has.

### 4.2a The one place discipline genuinely held

Worth recording because it cuts against the rest of this section. **Tests outgrew source.** Backend test-to-route byte ratio: 0.59 (Apr) → 0.76 (May) → 0.71 → 0.71 → **0.89** (Jul), with test files (260) now outnumbering route files (180). For a solo developer that inverts the usual pattern and is the strongest signal in the whole engagement.

Commit hygiene shows the same arc: conventional-commit rate went 12% (Feb) → 90% (Mar) → **99%** (May), and recent messages state *why*, not just what — `fix(e2e): make the Playwright net fail loudly instead of proving nothing` is a better commit message than most teams write.

Two caveats keep this from being a clean win: **70% of the 629 commits touching `backend/routes` shipped with no test change in the same commit** — coverage is built in periodic batches rather than alongside the change — and the suite never runs in CI, so it is a refreshed artefact, not a gate. The instinct is right. The enforcement is missing. That is this entire assessment in one sentence.

### 4.3 You are optimising a system nobody has stress-tested — including you

The audit explicitly states: the test suite was not run, concurrency was not load-tested, no code was executed beyond read-only probes. Our own attempt at performance profiling was cut short. So: **nobody, at any point, has established what this system does under concurrent load.**

Every concurrency defence catalogued — `FOR UPDATE` gates, advisory locks, the GiST exclusion constraint (which may silently not exist, per report §5.5), the two-phase credit gate — is *reasoned* correct and *never demonstrated* correct. For a multi-tenant POS with eight competing stock writers, that gap is the whole ballgame. The first busy Saturday at a real merchant is currently scheduled to be the first load test.

---

## 5. What we would do, in order

Sequenced by risk retired per unit of effort. Weeks 1–2 are all small.

**Before anything else — one env-var lookup**
Check `R2_PUBLIC_URL` on Railway. If it is **set**, patient attachments, consent signatures, CNIC/passport photos and full database dumps are world-readable right now, and that outranks every other item in this document. If it is **unset** (as the incoming report recorded), those features are silently 404-ing in the owner UI and need fixing as functionality, not as a breach.

**Day 1 — the things that are broken right now**
0a. **Fix P0-1.** Point the release query at `inventory_reservations`, add the missing `r.web_order_id = $1` correlation predicate, and stop swallowing the error into `ok:true`. Then reconcile: every `web_orders` row with `payment_status IN ('failed','cancelled')` has stock that was never returned.
0b. **Delete `sqlite3`.** Dead dependency, sole source of the critical CVE, also removes `python3 make g++` from the Docker build. One line.
0c. **Add `redact` to the Pino logger** and stop logging payment tokens at `payment-gateway.js:245/:256`.
0d. **Upgrade `nodemailer`, `multer`, `sharp`, `path-to-regexp`, `minimatch`, `brace-expansion`, `js-yaml`.** All have fixes. Then decide what to do about `xlsx` — there is no upgrade, so the options are sandboxing the parse, replacing the library, or restricting upload to CSV.
0e. **Add `requirePerm` to `POST /api/action-history`** (`receipt-templates.js:179`). One line closes audit-log forgery.
0f. **Default `backup_restore` to `false`** (`middleware/feature-flags.js:25`). It is an untested, unaudited, evidence-destroying primitive that is currently on for every tenant.
0g. **Delete the `manualChunks` block** (`vite.config.js:19-31`) and make `EndlessAisleModal` lazy. Removes ~910 KB raw / ~217 KB gzip from every first load in the product.
0j. **Rotate the production credentials in `frontend/tests/helpers/auth.js`** and drop the literal fallbacks to `undefined` so the suite fails loudly without env vars.
0k. **Enable Dependabot alerts, Dependabot security updates, secret scanning and push protection.** Four toggles, no code, all free. They are currently all off.
0l. **Repoint monitoring at reality** — add a monitor on `https://api.sanopos.com/api/health?deep=true` (the hostname users actually hit, via the endpoint that can actually fail) plus one on `sanopos.com`. Five minutes. Today a total database outage reports 200 OK.

**Week 1 — stop the bleeding (all low-risk, hours each)**
0h. **Fix the 42 broken `action_history` inserts** — either add the three columns in a migration or correct the call sites to the 5-column shape. Start with `restaurant/void-comp.js`, which is the theft vector.
0i. **Add `transaction` to `master-db-pg.js`**, then wrap the billing webhook (P0-2) and reorder it to activate the tenant *before* marking the intent complete. Same for the invoice-payment-link path.
1. Move the Shopify webhook mount before the tenant wall. Add a test asserting it returns *invalid signature*, not `AUTH_REQUIRED` — that distinction **is** the bug.
2. Fix `GET /api/feature-flags`: require a real JWT; return 404 for unknown tenants.
3. Add a graceful-shutdown handler — capture the server handle, trap SIGTERM/SIGINT, call `server.close()` and the already-written `shutdownBoss()`.
4. Pin `{ algorithms: ['HS256'] }` at all six `jwt.verify` sites.
5. Make `encryptSecret` **throw** without a key, add a boot assertion for `INTEGRATION_SECRET_KEY` mirroring the portal-secret guard, then audit `integration_settings` for unprefixed rows.
6. Decide `POST /api/sales` explicitly — add `requirePerm`, or a comment recording that open access is intentional. Then decide the same about its rate-limit exemption.

**Weeks 2–4 — restore the ability to detect regressions**
7. Triage the 36 broken integration files: port to `createTestApp-pg` or **delete them**. Leaving them in-tree makes the suite look four times healthier than it is. Same for the 4 Jest-under-Vitest files.
8. Put the integration suite in CI — nightly against a throwaway Postgres is enough. Use the existing baseline-diff pattern (fail on new/changed, not totals) so it can go green on day one.
9. Add `tsc --noEmit` and `vite build` to the PR gate. These are free and currently ungated.
10. Add a drift guard for the duplicated `PERMISSION_RULES` in the test helper. You already have the pattern eight times over.
11. Un-skip the wholesale credit-limit tests.

**Months 2–3 — retire the structural risks**
12. **Collapse the stock writers.** Migrate `routes/sales.js` first, then `kit-engine`, `storefront`, `orders`, `aggregator-orders`, `reservation`, `shopify/order-service`. Add a runtime assertion that the ledger is inside a transaction — today that contract is a comment. Budget this properly; it is the highest-value correctness work available and it is bigger than the audit implied.
13. Move gateway capture outside the sale transaction: authorise before, capture after commit, with a reconciliation path for the gap.
14. Add the schema-vs-migrations drift test (provision from `schema-pg.sql`, provision by replaying migrations, diff `information_schema`). This fits your existing culture exactly.
15. Move migrations out of the boot path into a release phase. Document a rollback procedure and **rehearse it once**.
16. Add a linter to the backend.
17. Switch migration versioning to a set difference.

**Before any growth**
18. Externalise cache invalidation and rate-limit state (Redis). Treat "add a second instance" as **blocked** until this lands — the failure mode is a module toggle that works, then appears to revert, depending on which instance answered.
19. Recompute capacity against the real `max_connections = 60`.
20. Stand up a staging environment and move Playwright off production.
21. Restore-test a backup. You have never done this. An untested backup is a hypothesis.

**Process — cheap, and currently the thing most likely to prevent the next P0**
22. **Write the infra-access and credential-recovery document that exists nowhere.** Who can reach Railway, Vercel, Supabase, Cloudflare, R2, Sentry, and how a second person would get in. This is a one-hour task standing between the business and permanent unrecoverability.
23. **Stand up a staging Railway environment** so `git push origin main` is not the only path to production.
24. Consider a plan that permits branch protection, or adopt a self-imposed PR discipline. With 96.8% of commits never entering a PR and zero human reviews ever, there is currently no mechanism — social or technical — that could have caught any of the four P0s.
25. Refresh `DEPLOY-RUNBOOK.md` off its frozen release, and delete the ~64 merged-but-undeleted branches.

**Not a code task, and the most important one**
26. Freeze vertical development. Pick one vertical. Get twenty merchants transacting daily. Let usage decide what the other 1,300 endpoints are worth.

---

## 6. What we would refuse to sign off, and why

If asked to certify this system as production-ready for a real merchant base, we would decline on six grounds. None is unfixable; all are non-negotiable.

1. **Code paths in production that have provably never worked.** The storefront release query targets a non-existent table (P0-1); the billing webhook cannot be made atomic because the master DB has no transaction support (P0-2); 42 audit writes target columns that have never existed (P0-3). All fail silently. That these shipped, and that a careful source audit missed them, is the strongest possible argument that the next item is the real problem.
1a. **The audit trail is absent where it matters and forgeable by any cashier.** Restaurant void/comp — the textbook POS theft vector — has never been logged. `POST /api/action-history` is unguarded. `backup_restore` is on by default, untested, and can rewrite history wholesale. For a system that will handle cash, this is disqualifying on its own.
2. **No working regression net.** 36 broken test files covering sales, returns, RBAC and security, with CI running 5 of 334 and no signal that anything is wrong. You cannot safely change a money system you cannot re-test — and P0-1 is what that costs.
3. **Eight implementations of the stock invariant** (plus a second gift-card debit path). No amount of care in any one compensates for the others drifting.
4. **Money can move twice, or move and vanish.** A card charged for a sale that rolls back; a refund that pays commission on the refunded sale; a gateway refund with no local record whose retry refunds again; a gift card debited twice on a POS retry.
5. **A permanently-vulnerable parser on an attacker-controlled upload path.** `xlsx@0.18.5`, no fix available, in both packages, plus a critical CVE imported entirely by a dead `sqlite3` dependency.
6. **No tested restore, no review, no second operator.** Restore has zero test coverage and is simultaneously the audit-erasure vector. Zero commits have ever been reviewed by another human, main cannot be protected on the current plan, and every production credential lives in one gitignored file on one machine. There is no mechanism — technical or social — that could have caught any of the four P0s above, which is precisely why they are still there.

Everything else in this document is an engineering backlog. Those six are the reason we would not put our name on it yet.

**The mitigating fact, stated once more because it is genuinely favourable:** there are no merchants and no revenue, so all six currently have zero blast radius. This is cheap to fix now and expensive to fix later. It is the best possible time to receive this news.

---

## 7. The one-paragraph version

SanoPOS is a genuinely capable, genuinely over-built product with real craft in its foundations and a validation record of zero. The multi-tenancy, fail-closed defaults and drift-guard culture are better than most teams achieve. But there is no revenue, no external merchant has ever transacted, 8 of the 10 shipped verticals have never held a single row of production data, and the test suite that should have caught the consequences is largely non-functional and invisible to CI — which is precisely how two money-path defects that have *never once worked* reached production unnoticed. The technical fixes are weeks, not a rewrite, and they are unusually cheap right now because nobody is standing on the system. The strategic fix — stop building, and go find one merchant who will pay — is the one that decides whether any of the technical work was worth doing.

---

### Appendix — verification record

Re-derived from source for this assessment, independent of the incoming report:

| Claim | Verdict |
|---|---|
| `POST /api/sales` unguarded, no `PERMISSION_RULES` entry | **CONFIRMED** — `sales.js:595`; `permissions.js:126-364` has no match |
| Three stock-movement implementations | **FALSE** — at least 8 sale-side writers; ~12 more non-sale writers |
| Gateway HTTP call inside sale transaction | **CONFIRMED** — `sales.js:2113` within transaction opened at `:1697` |
| No SIGTERM/SIGINT/unhandledRejection handler; `shutdownBoss()` uncalled | **CONFIRMED** — zero `process.on(` in backend source |
| `encryptSecret` silently stores plaintext | **CONFIRMED** — `crypto.js:26`; `decryptSecret:39` throws for the same condition |
| 36 integration files require a deleted helper | **CONFIRMED** — exactly 36 of 202; helper absent; no vitest `exclude` so all are collected |
| 4 files use `jest.*` globals under Vitest | **CONFIRMED** |
| CI gates neither integration tests, `tsc --noEmit`, nor `vite build` | **CONFIRMED** — 2 workflows, 5 test files |
| `requirePlanLimit` at exactly 3 call sites | **CONFIRMED** — `employees.js:91`, `outlets.js:57`, `products.js:790` |
| No `algorithms` pin on any `jwt.verify` | **CONFIRMED** — 6 sites, zero occurrences of `algorithms` |
| Migration `current = MAX(version)`, not a set difference | **CONFIRMED** — `migrate-pg.js:10030-10034` |
| H1 price gate fails open per-line and globally | **CONFIRMED** — `sales.js:1250-1298` |
| Plan limits and subscription enforcement fail open | **CONFIRMED** — `plan-limits.js` (`catch → next()`, `.catch(() => next())`) |
| Audit logs mutated only in tests, never in production code | **CONFIRMED** |
| No i18n framework or RTL support in `frontend/src` | **CONFIRMED** |
| Documentation volume | **CONFIRMED** — 397 files, 151,194 lines |
| Deploy config: single instance, migrations in boot, 3-retry cap | **CONFIRMED** — `start.sh`, `railway.toml` |
| **`storefront_cart_reservations` does not exist** | **CONFIRMED** — repo-wide grep: 2 hits, both in `webhooks.js:435/:452`, plus one planning doc. Absent from `schema-pg.sql` and all 137 migrations. Real table is `inventory_reservations` (`schema-pg.sql:2358`) |
| **Release block swallows the error and returns `ok:true`** | **CONFIRMED** — read `webhooks.js:425-475`; status updates at `:425-431` succeed, release throws at `:433`, caught at `:456`, `return { ok: true }` at `:475` |
| **Release query has no correlation predicate** | **CONFIRMED** — `JOIN web_orders wo ON wo.id = $1` with no `r.web_order_id` link; WHERE scopes nothing to the order |
| **`masterDb` exports no `transaction`** | **CONFIRMED** — `master-db-pg.js:245` exports exactly `{ init, createTenant, getTenantBySlug, getTenantById, query }` |
| **Zero real revenue; all payments sandbox** | **CONFIRMED (live)** — 6/6 `payment_records` and 7/7 `payment_intents` are `gateway='sandbox'`; `upgrade_requests` empty |
| **Zero current external merchants** | **CONFIRMED (live)** — 33/36 tenants owner-created; the 2 plausibly-external merchants were deleted months ago |
| **8 of 10 verticals have zero production rows** | **CONFIRMED (live)** — appointments, classes, rentals, rooms, treatment plans, service tickets, projects/forms, packages: 0 rows across all 29 schemas |
| **30 production vulnerabilities, 1 critical / 14 high** | **CONFIRMED** — `npm audit --omit=dev` in `backend/`; `xlsx` has `fixAvailable: false` |
| **`action_history` has no `employee_id`/`action`/`details` columns** | **CONFIRMED** — `schema-pg.sql:1086-1092` is 5 columns; `grep action_history backend/migrate-pg.js` → **0** |
| **42 audit inserts across 19 files write to those non-existent columns** | **CONFIRMED** — counted directly; all wrapped in silent `catch {}` |
| **`POST /api/action-history` has no permission guard** | **CONFIRMED** — `receipt-templates.js:179` bare; `:195` and `:213` guarded; no `PERMISSION_RULES` entry |
| **Entry chunk statically imports `reports` + `recharts`; both modulepreloaded** | **CONFIRMED** — `vite.config.js:19-31`; `dist/assets/index-*.js`; `dist/index.html` |
| **POS uses none of the design system** | **CONFIRMED** — 40 files in `pages/redesign/pos/`: 0 import `ui/primitives`, 0 `role="dialog"`, 0 `aria-modal` |
| **`R2_PUBLIC_URL` decides between world-readable and 404** | **CONFIRMED (source)** — `index.js:159-183`. Production value **not re-checked in this engagement**; incoming report §11 recorded it unset. ⚠️ **Verify before acting** |
| **0 PRs reviewed by a human; 96.8% of commits bypassed PR** | **CONFIRMED** — `gh pr list`: 30 PRs, 43 reviews all bot `COMMENTED`; 62 of 1,923 commits reachable via PR merges |
| **Main is unprotected and cannot be protected** | **CONFIRMED** — `gh api .../branches/main/protection` → 403, private repo on a plan without the feature |
| **Dependabot, secret scanning, push protection all disabled** | **CONFIRMED** — 404/403 from the respective `gh api` endpoints; no `dependabot.yml` or `renovate.json` |
| **~4-month CI gap (2026-03-14 → 2026-07-09)** | **CONFIRMED** — deleted `API Parity Audit` workflow failed 86 of 102 runs; `lint-guard.yml` added 2026-07-28 |
| **Production credentials committed in a tracked test helper** | **CONFIRMED** — `frontend/tests/helpers/auth.js` literal fallbacks + `playwright.config.js:17` → `https://sanopos.com` |
| **Tests outgrew routes** (positive) | **CONFIRMED** — test:route byte ratio 0.59 → 0.89; 260 test files vs 180 route files |
| **A deploy runbook with a rollback section DOES exist** | **CONFIRMED** — `docs/fable5/go-live/DEPLOY-RUNBOOK.md`. **This corrects an earlier claim in this document.** |
| **Measured uptime: 100% (30 d), 99.818% (90 d)** | **CONFIRMED (live)** — UptimeRobot API, this engagement |
| **Three prior outages, all 502: 22 h 27 m, 58 m, 3 h 55 m** | **CONFIRMED (live)** — UptimeRobot event log |
| **Only one monitor; it watches the Railway fallback domain, not `api.sanopos.com`** | **CONFIRMED (live)** — monitor URL is `oneshoppos-production.up.railway.app` |
| **Quick `/api/health` touches no dependency — a DB outage returns 200** | **CONFIRMED (source)** — `registerAllRoutes.js:52-56` returns `{status:"ok"}` unless `?deep=true` |
