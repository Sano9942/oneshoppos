# SanoPOS — Consolidated Audit Findings (Session 2026-07-11)

> This file consolidates everything from the 2026-07-11 working session so it can be reviewed in
> one place. It covers: the Business Modules v2 plan, three independent audits I ran, and three
> "second-eye" review reports the owner supplied — each cross-checked against source. **Nothing in
> this session changed application code.** Only docs/plan/scanner files were written (all untracked
> in git at time of writing). Detailed per-audit reports live in sibling folders (linked below);
> this is the index + the deduplicated critical-findings register.
>
> Verdict shorthand: **CONFIRMED** = I verified the claim against current source this session.
> **PLANNED** = already addressed by an existing plan. **DESIGN** = roadmap/opinion, not a defect.

---

## 0. What was produced this session (file map)

| File | What it is |
|---|---|
| `docs/fable5/business-modules/PLAN-V2.md` | The Business Modules **v2 plan** (deferred items D1–D8), 16 steps, amended after a second-eye review. **Not started.** |
| `docs/fable5/business-modules/AUDIT-FINDINGS.md` | **This file** — consolidated findings register. |
| `docs/fable5/frontend-coverage-audit/REPORT.md` + `scan.cjs` + `matrix.json` | "Backend-built-but-no-UI" audit + re-runnable scanner. |
| `docs/fable5/archive/role-audit/REPORT.md` + `role-audit.cjs` + `role-matrix.json` | Role/permission consistency audit + re-runnable scanner. |

Re-run either scanner from repo root: `node docs/fable5/<folder>/<scanner>.cjs`.

---

## 1. Business Modules v2 plan (PLAN-V2.md) — status

- Executes all eight deferred items (D1–D8) from `PLAN.md`'s "Deferred to v2" table.
- **Owner decisions locked**: full scope; one branch (`feat/business-modules-v2`) with **three
  merge/deploy gates** (governance → per-outlet → per-outlet roles); D4 = **split posture**
  (pristine-default Cashiers → sales-only, customized roles grandfathered); full v1-style
  verification tail.
- **Amended after second-eye review** (folded into the file): D6 moved after D1; one shared
  validated outlet resolver; outlet-scoped operational routes fail closed
  (`403 OUTLET_CONTEXT_REQUIRED`); `hybrid`-scoped cards stay tenant-wide in v2; `default_outlet_enabled`
  write path + sparse-row rule; D2 hardened (`ON DELETE SET NULL`, base+effective identity,
  bootstrap-served effective perms, 6-case no-context matrix); D8 copies modules-only with an
  owner-gated allowlist pause; query budgets with query-count assertions.
- **Riskiest steps**: Step 9 (`requireFeature` on every request + resolver refactor) and Step 13
  (permission resolution on every request) — both pause-gated with whole-suite regression gates.
- **Status: planned, NOT started.** Step 0 = commit the plan; Step 1 = branch.

**Change log note (owner asked)**: PLAN-V2.md was written once, then **rewritten once** in this
session to fold in the second-eye amendments above (the `+237/-188` diff the owner saw). No edits to
it after that rewrite.

---

## 2. Frontend coverage audit — "built in backend, not showing on front"

Full report: `docs/fable5/frontend-coverage-audit/REPORT.md`. Method: static route↔caller↔page↔
nav↔flag cross-reference + manual sample verification.

**Verdict**: suspicion CONFIRMED but concentrated. Of 1,347 endpoints, **78 (~6%) have no frontend
caller** after removing external-by-design and dynamically-called routes. Flags (0 orphans), pages
(1 orphan), and frontend→backend calls (0 broken) layers are clean.

The 78 cluster into the deep halves of the vertical-depth waves:

| Cluster | Orphaned | Merchant can't… |
|---|---|---|
| Clinical / treatment (V05) | 11 | mark no-shows, record lab results, issue prescriptions, edit chart entries |
| Shopify ops console | 8 | trigger sync, retry failed events, push inventory, auto-map products |
| Rentals asset layer (V09) | 7 | manage assets, log maintenance, see maintenance-due |
| Packages / prepaid (F02) | 6 | edit/delete templates, sell from customer screen, manually redeem/reverse |
| Rooms (V10) | 5 | group bookings + master folio, guest documents |
| Approvals | 4 + dead `POSApprovalModal.jsx` | edit/delete approval policies |
| Courier tracking | 4 | view or refresh shipment tracking |
| Van sales (V02) | 2 | end-of-day van reconciliation |
| Workflow dead-ends | — | **complete a cycle-count session**, shift variance-approve, member-kiosk lookup |

Doc contradiction: `POST /api/auth/kiosk-login` has **zero** frontend callers though CLAUDE.md
documents it as the kiosk login (kiosk pages use PIN endpoints). Legacy-to-delete or wiring gap.

---

## 3. Frontend "second-eye" review — verified additions to §2

The owner supplied a second review of the same question. Cross-checked against source; verdicts:

- **CONFIRMED (P1, most important) — POS redirect replaces retail till.** `POSRoute.jsx:19`
  redirects to `/pos/restaurant` on `hasMode("restaurant") && flags.phase4_restaurant`;
  `enabled_modes` comes from the **`tenant_modes` table** (`auth.js:213`), so a retail tenant that
  enables the Restaurant module gets its POS replaced. This **contradicts v1's gate-only decision,
  the shipped card copy, and v1 VERIFICATION.md item 1 (which passed — a verification miss).** Fix:
  key the redirect on preset industry / `pos_layout_mode` / explicit choice, not the mode row.
- **CONFIRMED — public rental booking has no page** (my scan misbucketed `/api/public/rentals` as
  external). The `rental_online_booking` sub-toggle enables a customer-unreachable capability.
- **CONFIRMED — flag *truthfulness* ≠ *reachability*.** My "0 orphan flags" tested classification.
  Flags with **no runtime consumer**: `phase4_restaurant_seats`, `receipt_designer_v2`,
  `phase4_contract_ai` (grep of backend minus tests/config = empty).
- **CONFIRMED — onboarding proxies** (`DashboardOnboarding.jsx:101`): membership `done:false`
  hardcoded; rental checkout = any contract row; room-rate = room count. **PLAN-V2 Step 11 (D6
  checklists) must REPLACE these, not add a parallel checklist.**
- **CONFIRMED — recipe-costing reports** (`reports/recipe-costing.js`) have no frontend tab.
- Systemic rec (adopt): extend the drift-test family with a **flag→runtime-consumer +
  capability→surface** registry test.

---

## 4. Role / permission consistency audit + third-eye review (MERGED, security-focused)

Full report: `docs/fable5/archive/role-audit/REPORT.md`. My audit focused on the UX-mismatch direction; the
owner's third-eye review added the security/under-enforcement direction I under-weighted. **All ~10
third-eye claims I checked are CONFIRMED against source.** Root cause of both: **`all_access` is
over-used as a lazy "admin-only" gate, and several controls are enforced only in the UI, not the API.**

### 4A. Security-grade (do these before deferred-feature work)

| # | Finding | Source | Verdict |
|---|---|---|---|
| S1 | **`pos_discount` NOT enforced** — `POST /api/sales` reads `discount_amount` from body and applies it with no `pos_discount` check anywhere; any authenticated employee (even a custom role without the perm) applies arbitrary discounts | `sales.js:593,601,1319` | **CONFIRMED (new)** — I had mislabeled this endpoint "intentional/open" in my own audit and missed the unchecked discount |
| S2 | **Outlet-conflict validation** — enforcement resolves one outlet `context‖header‖query‖body` and validates only that; a route reading a *different* query/body `outlet_id` acts on an unvalidated outlet | `registerAllRoutes.js:283` | **CONFIRMED** — same root as **PLAN-V2 Step 9** (shared validated resolver + fail-closed); PLANNED there |
| S3 | **Field Rep over-reach** — `manage_field_sales` does double duty (rep-self + owner endpoints `GET /api/field/visits`, `POST/GET /api/admin/field-routes`); Field Rep default holds it; outlet-assignment enforcement **skips** anyone with it | `permissions.js:75`, `field.js:283`, `registerAllRoutes.js:276` | **CONFIRMED** — split into `execute_field_sales` (own) vs `manage_field_sales` (admin) + explicit field-order scoping |
| S4 | **Admin self-lockout** — `PUT /api/roles/:id/permissions` guards stop non-admins escalating but do NOT stop an Administrator submitting role-1 perms that omit `all_access` → all admins lose authority (boot re-adds it as accidental recovery) | `roles.js:161` | **CONFIRMED (footgun)** — force system-admin role to always retain `all_access`; block removing last admin |
| S5 | **Cost/data over-exposure via `view_reports`** — `GET /api/products` returns `SELECT p.*` incl. cost/margin to any `view_reports` holder; Cashier has `view_reports` | `products.js:267` | **CONFIRMED** — PLAN-V2 **D4** splits `view_reports`; add a cost-free POS product response |

### 4B. Consistency / UX (the "feels broken" the owner sensed)

| # | Finding | Source | Verdict |
|---|---|---|---|
| C1 | **`GET /api/employees` needs `all_access`** but Manager has `manage_employees` → staff-filter dropdown 403s empty on **21 Manager pages** | `employees.js:45` | **CONFIRMED** — highest-impact one-line fix (relax to `manage_employees`) |
| C2 | ~12 Manager pages whose management action needs `all_access` (edit customer, edit attendance, save receipt template, reverse transfer, void supplier payment, connect integration, approve COD, configure risk) | (per REPORT.md table) | **CONFIRMED** — each needs a policy call: relax to Manager perm or hide the control |
| C3 | **Dashboard infers Manager from `view_reports`** → Cashier gets owner cards | `DashboardRedesign.jsx:47` | **CONFIRMED** — gate every widget by its real permission, never infer role |
| C4 | **Default-role edits NOT durable** — `ensureDefaultRolePermissions` re-inserts every default perm on every boot; a removed Manager/Cashier default reappears on restart. **⚠ Load-bearing for D4: the view_reports split must remove it from `DEFAULT_ROLE_PERMISSIONS`, not just from `role_permissions` rows, or the migration is undone at next boot** | `permissions.js:80` | **CONFIRMED** — recommends immutable role `system_key` |
| C5 | **Custom roles labeled "Cashier"** — account drawer hardcodes id 1=Admin, 2=Manager, else Cashier | `AppLayoutRedesign.jsx:33` | **CONFIRMED** — use backend `role_name` |
| C6 | **`manage_employees` overloaded** — also gates accounting mutations, credit/debit notes, cheques, report scheduling; a staff perm shouldn't confer financial authority | (multiple) | **CONFIRMED** — split into narrower perms (aligns with PLAN-V2 D7) |
| C7 | 4 nav/route mismatches (Attribute Sets, Recalls, Handouts, Receipt Templates) — nav hides, frontend route open | `role-matrix.json` | **CONFIRMED (minor)** |
| C8 | Permission changes don't refresh frontend until reload; `roles_with_access` can misreport card access (cards with empty `permissions:[]`) | `AuthProvider.jsx:245`, `services/business-modules.js:140` | **CONFIRMED** — known v1 caveat; refresh-on-change + card perm-mapping cleanup |

### 4C. Design / roadmap (gaps, not defects)

Preset-specific operator roles are missing across verticals (Restaurant Server, Receptionist,
Clinician, Technician, Rental Agent, Front Desk) — every vertical is currently "manage everything"
vs "access nothing." **DESIGN** — good roadmap input; fold into the permission wave, not bug-fix now.

**Unguarded backend mutations**: 47 candidates, ~44 intentional (POS actions open to all staff,
manager-PIN endpoints checking PIN in-handler, self-service, kiosk PIN). Worth a decision:
`billing/add-outlet`, `billing/create-checkout`, `commissions/calculate`.

---

## 5. How it all connects to PLAN-V2 (recommended sequencing)

> **RESOLVED 2026-07-11 (owner-approved)**: this recommendation was executed — PLAN-V2.md was
> amended to fold every finding in (Wave 0 W0a/W0b + Gate 0 to `main` pre-branch, Step 2 S3 split,
> Step 3/4 rulings batch, Step 6b registry tests, Step 11 proxy replacement, Step 14 C8, E7/E8
> deferrals). The authoritative routing is now PLAN-V2.md's **audit-disposition table** (end of
> that file), which Step 15 walks. The table below is the historical recommendation.

The audits and PLAN-V2 are the same permission/capability theme. Recommended: **do the four
security items (S1–S4) as a small pre-wave, then run PLAN-V2 with these amendments folded in.**

| Audit finding | Where it lands |
|---|---|
| S1 `pos_discount`, S4 admin-lockout | **New small security pre-wave** (not currently in PLAN-V2) |
| S2 outlet-conflict | **PLAN-V2 Step 9** (shared resolver) — already planned |
| S3 Field Rep split | Pairs with **D2/D7** permission work |
| S5 + C1/C6 (`view_reports`, `manage_employees`, `all_access` overuse) | **PLAN-V2 D4 + D7** — already planned; **apply C4 caveat to the D4 migration** |
| POS redirect bug (§3) | **New P1 fix** (one file) + correct v1 card copy + VERIFICATION.md erratum |
| Onboarding proxies (§3) | **PLAN-V2 Step 11 (D6)** must replace, not duplicate |
| Truthless flags (§3), roles_with_access (C8) | Systemic **capability-registry CI test** — extends the v1 drift-test family |
| Coverage clusters (§2) | Separate remediation plan per cluster (optional, owner-gated) |

---

## 6. Confidence & limitations

- Every finding marked **CONFIRMED** was checked against current source this session; the
  role-audit security findings rest on boolean `all_access`/perm checks whose outcome is
  deterministic from the known role permission sets (a live HTTP probe was not run because the local
  backend was down, but that only affects the "does the page 403 loudly vs quietly" nuance).
- The scanners are static — treat cluster/domain findings as high confidence and raw counts as
  triaged upper bounds (both reports document their parse limits inline).
- No application code was modified in this session. All outputs are docs + scanners, currently
  untracked in git.
