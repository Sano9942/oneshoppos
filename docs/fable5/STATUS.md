# fable5 — Status Index

**What this is:** one row per effort in this folder, so you can see at a glance what was finished,
what was deferred, and where each effort's own detailed register lives. Built 2026-08-17.

**This file is an index, not a source of truth.** Each effort's own register is authoritative — this
tells you which one to open. When they disagree, the linked register wins, and source wins over both.

## Coverage of this index — read before trusting a row

The folder holds **170 markdown files**. This index was built at *effort* granularity: for each of
the 25 top-level efforts I read its primary doc + any `VERIFICATION*` companion, then mechanically
cross-referenced every plan file against its parent register. I did **not** read all 170 files.

**Mechanically verified — every plan file is accounted for in a register:**

| Set | Files | Result |
|---|---|---|
| `completion/plans/` | 12 | ✅ all 12 in the README register |
| `vertical-depth/plans/` | 23 | 🟡 20 in ROADMAP; **3 orphans** (below) |
| `vertical-depth/findings/` | 11 | ✅ all 11 referenced |
| `remediation/prompts/` | 8 | ✅ all 8 (WS1a–WS5) referenced in PLAN.md |
| `platform-architecture-vnext/adrs/` | 12 | ✅ status read from each: **1 Accepted (ADR-002), 11 Proposed** |

**Read only at folder level, not file by file** — these are reference/finding sets with no plan to
close, but no one has walked them line by line: `technical-architecture-report/` (9),
`platform-architecture-vnext/` body (16), `platform-architecture-claude-report/subsystem-audits/`
(8), `platform-study/` (5), `claim-audit/` (5), `core-research/` (5), `business-modules/`
non-verification docs (`AUDIT-FINDINGS`, `FEATURE-CATALOG`, `REPORT-PERMS`, `W0A`/`W0B`).
If you need a *finding* rather than a *status*, open these directly — this index will not have it.

### The 3 orphans — found, chased down, resolved

Three plan files sit in `vertical-depth/plans/` referenced by no register, and all three still carry
an **"AWAITING APPROVAL"** header. **All three were in fact approved and executed** — the headers are
stale, in the same way `admin-refresh/PLAN.md` is stale:

| File | Header says | Actually |
|---|---|---|
| `F04-migration-proposal.md` | AWAITING APPROVAL (pause-list) | ✅ landed — F04 is done in ROADMAP |
| `F04-webhook-dispatch-proposal.md` | AWAITING APPROVAL (HARD GATE #2) | ✅ landed — F04 is done in ROADMAP |
| `V02-migration-proposal.md` | pause-list, proposes v110–v113 | ✅ **v110, v111, v112, v113 all exist in `backend/migrate-pg.js`** |
| `completion/proposals/folio-tax-proposal.md` | "APPROVED … **Not yet implemented**" | ✅ **v118 exists**; completion register row 06 confirms it resolved the folio-tax gap |

**This is the single biggest reason the folder reads as unfinished when it isn't**: a doc whose
header was written before the work and never updated after it. Four confirmed cases so far. Assume
there are more, and never take a header `Status:` at face value.

> ⚠️ Noticed while verifying: `backend/migrate-pg.js` head is **v138**, not v137 as
> `CLAUDE.md` and several docs here state. v138 is the `action_history` column repair.

---

## How to check status (the method — because there is no single convention)

Four different conventions are in use. In rough order of reliability:

1. **A `VERIFICATION*.md` companion exists** → the plan was executed and checked. This is the
   strongest signal in the folder. Currently: `business-modules` (×4), `claim-audit`, `plan-v3`,
   `platform-architecture-claude-report`, `ai-platform-strategy` (`VERIFIED-STATE.md`).
   ```bash
   find docs/fable5 -iname "*VERIF*"
   ```
2. **A register table with a Status column** — `completion/README.md` §register and
   `vertical-depth/ROADMAP.md` both carry a per-plan status with branch + date + caveats. These are
   the richest records in the folder.
3. **`- [x]` / `- [ ]` checkboxes** — only `admin-roadmap`, `independent-assessment`, `go-live` and
   `fast-entry-build-plan` use them.
   > ⚠️ **Do not count checkboxes to measure progress.** `go-live/DEPLOY-RUNBOOK.md` has 7 unticked
   > boxes and that deploy *shipped* — it is a re-runnable runbook, not a backlog.
   > `fast-entry-build-plan.md`'s 5 unticked items are open *questions*, not tasks.
4. **A `Status:` line in the header** — least reliable, because it records the status *at authoring
   time* and is often never updated. `admin-refresh/PLAN.md` still says **AWAITING APPROVAL**
   although `feat/admin-refresh` was merged to `main` (recorded at `admin-roadmap/ROADMAP.md` batch
   0.5). Treat a header `Status:` as a claim to verify, not an answer.

**The tiebreaker is always git**, since nearly every plan names its own branch:
```bash
git log --oneline --all --grep="business-modules" | head
```

---

## Findings disposition — the line-by-line pass (2026-08-17)

The index above tracks **plans**. This section tracks **findings**, which is a different question: an
audit can be "complete" while its findings go nowhere. Every disposition below was checked **against
current source**, not against the remediation docs' own claims.

### ✅ Fully discharged — verified in source

**`claim-audit/LEAKS.md` top 5** — all five fixed, and each fix carries a comment naming the finding:
`CHART_PRESET_ALIASES` + `resolveChartPreset` (#1, including the `dental`→`dental_adult` naming trap
the verifier caught); `"Restaurant"` added to restaurant/cafe `visible_report_groups` (#2);
`ClinicalTab` imported + `"Clinical"` group present (#3); portal routes for
`subscriptions`/`contracts`/`tickets` exist (#4); `/api/feature-flags` now unions DB-only rows (#5).

**`core-research/01-CORE-SPINE.md` HIGHs H1–H7** — all fixed, comments cite the IDs. H2 adds
`taxTotalSnapshot` on exclusive mode; H3 clamps loyalty under `FOR UPDATE`; H5 caps `refund_price`
at the sold price; H6 store_credit credits the wallet; H7 quotation-convert routes through
`services/stock-ledger`. MEDIUMs M1/M3/M4/M5/M6/M9 and L2 also fixed.

**`core-research/02-INTEGRATIONS.md`** — courier `config_json` now parsed; courier credentials now
AES-GCM; WhatsApp inbound no longer uses the public pool; FBR failures now call
`alerting.recordError`; Meta webhook HMAC-verified. Daraz stays unsigned **by decision**
(plan-v3 → V4). Marketplace worker still schedules nothing — now deliberate and documented in-file.

**`claim-audit` hardening** — rental deposit math, overdue-rental availability, and the asymmetric
credit-limit override audit are all fixed (V2/V5 comments in source).

### 🟡 Reported, never actioned, still true in source

| Finding | Source today |
|---|---|
| **L-6** retail spine never subtracted for service industries | `nav-config.js` has **no** `business_model` exclusions — a clinic still sees Catalog/Inventory/Procurement |
| **L-7** public QR menu not mode-gated | `public-restaurant.js` has no `requireMode` |
| **N-9** `dashboard_widgets` largely decorative | only `inventory_alerts` is consumed |
| **M-8** vocabulary bleed | `PortalOrders.jsx` still hardcodes "Order history" / "Order #" |
| `chart_area` codes unvalidated | schema is still bare `z.string().min(1).max(100)` |
| **L7** GRN scan-receive moves no stock | `grn.js` increments `qty_received` only |

### ❌ The real gap — audit risk registers that were never routed into any plan

`claim-audit` and `core-research` were **consumed properly**: they fed `remediation/`, which executed.
The 2026-07-29 architecture audits were not. They carry large risk registers that exist **only as
description**:

| Register | Items | Reached an action plan |
|---|---|---|
| `subsystem-audits/06-security-posture.md` §9 | 13 | 7 — **6 never mentioned in any plan** |
| `subsystem-audits/01-backend-core.md` §9 | 25 | 3 of 14 sampled |
| `subsystem-audits/02-api-route-surface.md` §7 | 15 | not systematically routed |
| `subsystem-audits/04-data-model.md` §7 | — | not systematically routed |
| `technical-architecture-report/08-risks-and-assessment.md` | 10 | 6 |

**The 6 orphaned security gaps — all three spot-checked are still real in source today:**

1. **Legacy plaintext-PIN fallback** (Med) — `attendance.js` and `services/manager-pin.js:46` still
   compare `String(emp.pin_code) === pin`; pre-v14 rows remain plaintext at rest, compared
   non-constant-time. **Verified present.**
2. **Helmet CSP + COEP disabled** (Low-Med) — `index.js:121-122`, still `false`. **Verified present.**
3. **`cleanup-dead-tenants.js:51`** interpolates a DB-stored slug into `DROP SCHEMA` with no
   re-validation, unlike the admin route's own DROP. **Verified present.**
4. No admin/employee account lockout (rate limiters only).
5. `getClient()` session-level `search_path` outside a transaction (fail-safe, but fragile).
6. Turnstile is env-conditional and silently absent when unset.

Notable individually-orphaned items from audit 01: `ensureDefaultRolePermissions` is a permanent
silent no-op in MT mode; tenant-keyed rate limiters are bypassable by rotating a client header; the
revocation block swallows every error; `migrate()` versions off `MAX(version)` so a tenant can fall
permanently behind while the deploy reports success; the global error handler leaks `err.message`.

**None of these are new defects and none are P0.** The point is narrower and worth acting on: a
finding that lives only in a descriptive audit is not tracked, and nobody is going to rediscover it
by reading the plan folder. They need routing into `independent-assessment/03-action-plan.md`
(or an explicit "accepted, won't fix" line) before this folder can be called accounted-for.

### Still unread after this pass

`platform-study/` (5 files, competitor research — no findings to route), the
`platform-architecture-vnext/` body (16 files — Proposed target, nothing to close), and
`business-modules/` `FEATURE-CATALOG`/`REPORT-PERMS`/`AUDIT-FINDINGS` (spec + verification companions
to plans already closed).

---

## The ledger

Legend: ✅ done · 🟡 partly done, remainder tracked · ⏸ deferred by decision · 📋 findings/reference
only (nothing to "finish") · 🔵 active

| Effort | Kind | State | Authoritative register | What's still open |
|---|---|---|---|---|
| [independent-assessment](independent-assessment/) | Assessment + launch plan | 🔵 **ACTIVE** — the current working plan | [03-action-plan.md](independent-assessment/03-action-plan.md) | 16 done / 42 open. All 4 P0s + Phase 0 closed. Phase 1 (test net) in progress |
| [completion](completion/) | 12 plans, mode by mode | ✅ 11 of 12 done or absorbed | [README.md](completion/README.md) §register | Plan **09 service-projects** still reads `planned`. Many P1s deliberately deferred to F0x/V0x |
| [vertical-depth](vertical-depth/) | 10 vertical + 7 foundation plans | ✅ **all V01–V10 + F01–F07 done** | [ROADMAP.md](vertical-depth/ROADMAP.md) | V06 marked 🟡 in the register — check its row before assuming closed |
| [business-modules](business-modules/) | v1 + v2 build plans | ✅ v1 LIVE (v132) · ✅ v2 DEPLOYED (v137) | [VERIFICATION.md](business-modules/VERIFICATION.md), [VERIFICATION-V2.md](business-modules/VERIFICATION-V2.md) | v2's *Deferred to v3* table: **E1–E8**. v2 is live but inert until a per-outlet override row is written |
| [plan-v3](plan-v3/) | Public-surface + v2-deferral remediation | ✅ closed | [VERIFICATION-V3.md](plan-v3/VERIFICATION-V3.md) | `W0-ops 4.4` R2 domain ⏸ **open by design**. Daraz webhook sig ⏸ deferred to V4 (contract unpublished) |
| [remediation](remediation/) | 5 workstreams from claim-audit + core-research | ✅ WS2/3/4/5 complete; WS1 largely remediated | [PLAN.md](remediation/PLAN.md) | WS1 stock-writer collapse is the surviving item — now tracked by independent-assessment Phase 3 |
| [admin-roadmap](admin-roadmap/) | Super-admin backlog, batched | 🟡 Batches 0, A, B, C1 done | [ROADMAP.md](admin-roadmap/ROADMAP.md) | **C2** flag kill switch is next · then D (tenant intel), E (analytics), F (compliance) |
| [admin-refresh](admin-refresh/) | Predecessor of admin-roadmap | ✅ built + merged to `main` | [PLAN.md](admin-refresh/PLAN.md) | None. ⚠️ its header still says "AWAITING APPROVAL" — **stale** |
| [marketing-site](marketing-site/) | Public site, phase 1+2 | ✅ merged (14 pages) | [PLAN.md](marketing-site/PLAN.md) | `demo@sanopos.com` Cloudflare Email Routing rule |
| [go-live](go-live/) | V01–V10 deploy audit + runbook | ✅ deployed (v109 → v122) | [DEPLOY-AUDIT.md](go-live/DEPLOY-AUDIT.md) | Nothing. The runbook's unticked boxes are re-runnable steps |
| [fast-entry-build-plan.md](fast-entry-build-plan.md) | Fast catalog/stock entry | 🟡 Phase 1 + AI descriptions + invoice-photo LIVE | the file itself | Phase 3 not started · 5 open *decisions* (not tasks), incl. R2 retention of parsed invoices |
| [ai-platform-strategy](ai-platform-strategy/) | AI gateway + 3 front doors | ⏸ **planned, nothing built** | [VERIFIED-STATE.md](ai-platform-strategy/VERIFIED-STATE.md) | The whole plan. Read VERIFIED-STATE first — it is the exists/doesn't-exist ledger |
| [role-audit](role-audit/) | Role/permission consistency | ✅ largely discharged at migration v134 | [REPORT.md](role-audit/REPORT.md) | Remainder folded into business-modules **E8** |
| [frontend-coverage-audit](frontend-coverage-audit/) | Backend-built / frontend-missing | 📋 findings; baseline frozen | [REPORT.md](frontend-coverage-audit/REPORT.md) | 78 endpoints with no UI, accepted as baseline — only *new* orphans fail the guard |
| [claim-audit](claim-audit/) | "Speaks your industry's language" | 📋 findings → fed remediation WS2 (✅ done) | [README.md](claim-audit/README.md) | Nothing — consumed by remediation |
| [core-research](core-research/) | Pre-build-wave health check | 📋 findings → fed remediation WS1/3/4 | [README.md](core-research/README.md) | Nothing — consumed by remediation |
| [public-surface-audit](public-surface-audit/) | Externally-reachable surfaces | 📋 findings → fed plan-v3 (✅ closed) | [REPORT.md](public-surface-audit/REPORT.md) | Holds the **global-vs-Pakistan coupling inventory** — still the reference for any i18n work |
| [technical-architecture-report](technical-architecture-report/) | Current-state architecture | 📋 **reference — verified current-state** | [README.md](technical-architecture-report/README.md) | n/a. Use this when you need "how it works today" |
| [platform-architecture-claude-report](platform-architecture-claude-report/) | Source+live verified report | 📋 reference | [02-verification-log.md](platform-architecture-claude-report/02-verification-log.md) | n/a |
| [platform-architecture-vnext](platform-architecture-vnext/) | Target architecture + 12 ADRs | ⏸ **PROPOSED — not built, not current** | [adrs/](platform-architecture-vnext/adrs/) | Only **ADR-002 is Accepted** (2026-07-17). ADR-001 + 003–012 are Proposed. Never implement from this |
| [platform-study](platform-study/) | Square/modern-POS research | 📋 reference | [modern-pos-playbook.md](platform-study/modern-pos-playbook.md) | n/a |
| [build-plan.md](build-plan.md) · [playbook.md](playbook.md) · [prompt-templates.md](prompt-templates.md) · [redesign-spec.md](redesign-spec.md) · [redesign-prompt.md](redesign-prompt.md) | Process / how-to-run docs | 📋 reference | — | Square redesign itself: ✅ all 5 phases done |
| [SANOPOS-FUNCTIONAL-INVENTORY.md](SANOPOS-FUNCTIONAL-INVENTORY.md) | Factual feature baseline | 📋 reference (code-verified 2026-07-10) | — | n/a |

---

## The short answer, if you read nothing else

**Everything is finished except four things**, and they are all tracked in a register above:

1. **[independent-assessment](independent-assessment/03-action-plan.md)** — the only 🔵 active plan.
   42 open items; Phase 1 (getting a working test net) is where the work currently is.
2. **[admin-roadmap](admin-roadmap/ROADMAP.md) batches C2 → F** — self-paced backlog, nothing blocked.
3. **[business-modules](business-modules/PLAN-V2.md) E1–E8** — deliberate v3 deferrals.
4. **[ai-platform-strategy](ai-platform-strategy/PLAN.md)** — fully planned, zero built. The largest
   unstarted thing in the folder, and it is unstarted *by decision*, not by neglect.

Plus two by-design ⏸ holds: plan-v3's R2 custom domain (`W0-ops 4.4`) and its Daraz webhook signature.

---

## Keeping this honest

This file goes stale the moment a plan closes. Two rules:

- When you close an effort, update **its own register first**, then this row. Never only this row.
- When you add a new effort folder, add a row here in the same commit. A plan with no row here is
  how the folder became unreadable the first time.
