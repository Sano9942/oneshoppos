# Role / Permission Consistency Audit — Admin vs Manager vs Cashier vs Field Rep

> Owner question (2026-07-11): *"admin/manager/cashier have different roles and the view/feel/
> functions change accordingly… I feel there is some kind of error or mismatch there."*
> Scope agreed: all four mismatch directions, four default roles, **backend perms are the standard
> of truth**, static matrix + intended live API probe.
> Method: static cross-reference scanner at [role-audit.cjs](role-audit.cjs) (re-runnable:
> `node docs/fable5/archive/role-audit/role-audit.cjs`, writes `role-matrix.json`) + direct source
> verification of every guard cited below. Read-only — nothing changed.
> **Live-probe note**: the HTTP probe was not executed because the local backend was not running;
> however every finding below rests on **boolean `all_access` permission checks** whose outcome is
> deterministic from the known role permission sets (a Manager's 24 perms do not include
> `all_access`), so these are source-certain, not inferred. A live probe would only add the
> frontend nuance of "does the page 403 loudly or degrade quietly."

## Verdict

**Your instinct is right, and it has one dominant root cause: `all_access` is over-used as a
lazy "admin-only" gate on actions a Manager-tier permission was clearly meant to cover.** The
role *model* is sound (clean 4-role default set, a 29-string catalog, a working drift test, a
consistent `all_access` bypass). The *mismatch* is that the **Manager** role — which a merchant
reasonably expects to run the store — can open ~20+ pages whose main content loads but whose
secondary actions silently return 403, because those actions demand `all_access` (Administrator)
rather than the Manager permission that already exists. That is exactly the "feels broken /
inconsistent" sensation.

| Direction | What it means | Count | Severity |
|---|---|---|---|
| **A — Visible but forbidden** | Page gate admits the role, but an action inside 403s | ~20 pages (Manager) | **The main problem** |
| **B — Hidden but allowed** | Nav hides it, but the frontend route is open | 4 | Minor/cosmetic |
| **C — Unguarded backend** | Mutation route with no `requirePerm` | 47 candidates → ~3 worth a decision | Mostly by-design |
| **D — Frontend-only enforcement** | UI checks role, backend doesn't | subset of B | Minor |

## Direction A — Visible but forbidden (the real finding)

### A1. The `all_access`-only employee list breaks staff dropdowns on 21 pages
`GET /api/employees` is gated `requirePerm("all_access")` ([employees.js:45](backend/routes/employees.js:45)),
but **Manager does not have `all_access`** — it has `manage_employees` (verified: Manager holds 24
perms, none is `all_access`). Yet 21 Manager-reachable pages call `GET /api/employees` to populate a
"staff" / "performed-by" filter dropdown:

`/sales-history, /cash-management, /crm, /quotations, /reports, /returns, /expenses,
/purchase-orders, /attendance, /appointments/{services,calendar,bookings}, /classes/timetable,
/service-tickets, /treatment-plans (+ /active, /calendar, /labs, /templates, /chart/:id, /:id)`

On every one, a Manager's staff filter comes back empty (403) while the rest of the page works —
the textbook "half-broken" feeling. **Manager has `manage_employees`; the GET should accept it.**
This single guard line is the highest-impact item in the audit.

### A2. Manager-tier pages whose management actions require `all_access`
Each of these pages is reachable by Manager (its route gate is a Manager perm or none), but a core
action 403s because it demands `all_access`. Verified guards:

| Page | Action a Manager can't do | Backend guard |
|---|---|---|
| `/customers` | Edit or delete a customer, view customer groups | `PUT /api/customers/:id` → `manage_customers` ([customers.js:722](backend/routes/customers.js:722)); Manager lacks `manage_customers` |
| `/attendance` | Edit an attendance record | `PUT /api/attendance/:id` → **inline `all_access`** ([attendance.js:591](backend/routes/attendance.js:591)) — and this **overrides** the `PERMISSION_RULES` entry that declares `manage_employees` for the same path, making that rule dead/misleading |
| `/receipt-templates` | Save / edit a template (nav shows it to `manage_inventory`) | `PUT /api/receipt-templates/:id` → `all_access` ([receipt-templates.js:84](backend/routes/receipt-templates.js:84)) |
| `/adjustments` | Delete an adjustment | `DELETE /api/adjustments/*` → `all_access` |
| `/transfers` | Reverse a transfer | `POST /api/transfers/:id/reverse` → `all_access` |
| `/supplier-payables` | Void a supplier payment | `POST /api/supplier-payments/:id/void` → `all_access` |
| `/settings/integrations`, `/integrations/woocommerce` | Connect / disconnect an integration (nav shows it to `manage_inventory`) | `POST /api/integrations/connect|disconnect` → `all_access` |
| `/cod-settlements` | Approve a COD settlement | `POST /api/fulfillment/cod/settlements/:id/approve` → `all_access` |
| `/retail-risk` | Configure risk / review anomaly flags | `GET|PUT /api/risk/config` → `all_access` |
| `/products/new`, `/products/:id` | Set outlet-visibility, view customer groups | `PUT /api/products/:id/outlet-visibility` → `all_access`; groups → `manage_customers` |
| `/reports` | Export FBR data | `GET /api/reports/fbr-export` → `all_access` |
| `/kds` | Read print config | `GET /api/print/config` → `all_access` |

None of these is a security *hole* (the backend correctly refuses) — they are **UX/consistency
bugs**: the app shows a Manager a page and a button, then refuses the button. The decision for each
is *policy*: either (a) the action really is Administrator-only → the UI should hide/disable it for
Manager (Direction-D fix), or (b) a Manager should do it → relax the guard to the matching
Manager permission. My read is that most of these want option (b) — especially A1, customers,
attendance, receipt-templates, and integrations.

## Direction B — Hidden but allowed (4, minor)

Nav config hides these behind a permission, but their **frontend route has no `perm()` wrapper**,
so the nav and the route disagree:

| Item | Nav requires | Frontend route | Backend writes still need |
|---|---|---|---|
| Attribute Sets | `manage_inventory` | open | `manage_inventory` |
| Recalls | `manage_treatment_plans` | open | (varies) |
| Handouts | `manage_treatment_plans` | open | `manage_treatment_plans` |
| Receipt Templates | `manage_inventory` | open | `all_access` (see A2) |

Impact is small — the backend still enforces on writes — but a role that lacks the nav permission
could reach the page by direct URL and see a shell the nav implied was off-limits. Fix: add the
same `perm()` wrapper to the route so nav and route agree (backend-as-truth means aligning both to
the backend's actual requirement).

## Direction C — Unguarded backend mutations (47 candidates → ~3 decisions)

47 mutation routes have no `requirePerm`. **The large majority are intentional** and should NOT be
"fixed" blindly — the app's design is that POS-side and self-service actions are open to any
authenticated staff member (including Cashiers):

- **POS / checkout actions (by design open to Cashiers)**: `POST /api/sales`, `POST /api/customers`,
  `POST /api/draft-orders` (+claim/complete — POS park), `POST /api/promotions/quote`,
  `POST /api/pos/customer-display`, `POST /api/pos-devices/register`, `POST /api/print/*`.
- **Manager-PIN endpoints that verify the PIN inside the handler** (perm-open by design):
  `POST /api/approvals/pos-authorize|evaluate|price-override` (feature-gated only —
  [approval-policies.js:94](backend/routes/approval-policies.js:94)).
- **Self-service**: `PUT /api/employees/:id/change-password|change-pin`, `/me/preferences`,
  `PUT /api/notifications/:id/read`, `read-all`.
- **Kiosk / PIN attendance**: `POST /api/attendance/pin-*`, `checkin`, `:id/checkout`.
- **External / infra**: `POST /api/integrations/shopify/webhooks/orders-create`, `POST /complete`
  (setup wizard), `POST /api/support/*`, `POST /api/action-history`.

**Worth an explicit owner decision** (money-adjacent, no perm and no obvious in-handler check):
- `POST /api/billing/add-outlet` — any authenticated user can request a billable outlet add
  ([billing.js](backend/routes/billing.js)); likely should be `all_access` or `manage_business_modules`.
- `POST /api/billing/create-checkout`, `POST /api/billing/request-upgrade` — same class.
- `POST /api/commissions/calculate` — triggers a commission run; probably wants `manage_employees`.

(Some scanner candidates like `accounting/cheques` are actually guarded via a spread array
`...chequeAuth = [requireAnyPerm(["manage_employees","all_access"]), …]` — verified guarded, false
positive. The count reflects residual static-parse limits, not 47 real holes.)

## Direction D — Frontend-only enforcement

The inverse of A is rare here (the backend is consistently the stricter side, which is the safe
direction). The Direction-B nav/route mismatches are the main instances where the frontend's
implied rule is looser than nav suggests; the backend still guards the writes.

## Root cause + systemic recommendation

**`all_access` is doing two different jobs**: "genuinely Administrator-only" and "I didn't pick a
specific permission." The audit can't tell them apart, and neither can a Manager — they just hit a
wall. Every finding in Direction A is an instance of the second job leaking into a Manager surface.

Recommended guard (fits the existing drift-test family from Business Modules v1): a test asserting
**no route is reachable-by-page-gate for a role but denied-by-API for that same role** — i.e. if
`appRoutes` lets Manager open `/x`, every API `/x`'s page calls must be satisfiable by Manager's
permission set, OR the action must be explicitly marked admin-only so the UI hides it. That check
would have caught all of Direction A at CI time. It also dovetails with **PLAN-V2**: D7 (delegation
perms) and D4 (splitting `view_reports`) are the same "give the right permission instead of
all_access" theme, and D2 (per-outlet roles) will make effective-role correctness even more
important — worth folding a note into PLAN-V2 that this all_access-overuse cleanup should ride
alongside the D4/D7 permission work rather than as a separate wave.

## Recommended priority

1. **A1 — relax `GET /api/employees` to accept `manage_employees`** (or a read-scoped perm). One
   line, fixes empty staff dropdowns on 21 Manager pages. Highest impact, lowest risk.
2. **A2 — triage each `all_access` action on a Manager page**: relax to the Manager perm where a
   Manager should act (customers edit, attendance edit, receipt templates, integrations,
   COD approve), or hide/disable the control where it's truly Administrator-only.
3. **Fix the dead `PERMISSION_RULES` attendance entry** (it claims `manage_employees` while the
   inline guard is `all_access` — pick one; they currently contradict).
4. **Decide the 3 billing/commission unguarded mutations** (add a perm or confirm open-by-design).
5. **Align the 4 nav/route pairs** (Direction B) so nav and route agree.
6. **Add the reachability CI test** so this class can't regrow.

This audit modified no code. `role-audit.cjs` + `role-matrix.json` stay in this folder for re-runs
after any permission change. Note the scanner still has minor static-parse limits on exotic guard
spreads (documented inline) — treat the Direction-A findings (source-verified) as high confidence
and the Direction-C count as an upper bound already triaged above.
