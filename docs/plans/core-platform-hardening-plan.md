# Core Platform Hardening Plan

**Date:** 2026-04-16
**Purpose:** Continue the strategy after the tenant preset engine work: one strong core app, business modes, and industry presets.
**Current direction:** Stop adding speculative verticals. Improve the shared foundation so every supported industry becomes more reliable, faster, and easier to sell.

---

## 1. Strategic Summary

The product direction is:

> One strong core app + business modes + industry presets.

We should not build 50+ separate mini-products. The better approach is to harden the shared core and let modes/presets shape the product for each tenant.

The core app provides the universal foundation:

- POS checkout
- products, services, and catalog
- customers
- employees and permissions
- inventory
- invoices
- payments
- reports
- accounting
- loyalty and wallet
- tenant setup
- feature flags
- integrations
- portal
- receipts
- shifts

Business modes turn on real workflows:

- `retail` - implicit base/default behavior
- `restaurant`
- `appointments`
- `service_projects`
- `subscriptions`
- `workflow_tickets`
- `rentals`
- `room_management`
- `treatment_plans`
- later: `manufacturing`

Industry presets configure labels, navigation, onboarding, dashboard widgets, POS layout, reports, portal tabs, sample data, and default modes so each tenant feels like the software was designed for their business.

---

## 2. What The Codebase Already Has

This plan is based on local code research, not old Claude notes.

### Presets And Modes

Key files:

- [`backend/config/industry-config.js`](../../backend/config/industry-config.js)
- [`backend/config/mode-registry.js`](../../backend/config/mode-registry.js)
- [`frontend/src/contexts/PresetContext.jsx`](../../frontend/src/contexts/PresetContext.jsx)
- [`frontend/src/ui/nav-config.js`](../../frontend/src/ui/nav-config.js)

Current reality:

- There are 23 live/current industry presets.
- Presets include retail, restaurant, salon, grocery, cafe, clinic, repair shop, gym, wholesale, photography studio, weighted retail presets, rental presets, hospitality presets, and clinical presets.
- `retail` is the implicit default mode.
- Explicit modes exist for restaurant, appointments, commissions, service projects, subscriptions, workflow tickets, rentals, room management, and treatment plans.
- Manufacturing is not built yet and should remain demand-driven.

### Public And Customer-Facing Surfaces

Key file:

- [`frontend/src/routes/publicRoutes.jsx`](../../frontend/src/routes/publicRoutes.jsx)

Current public/customer surfaces:

- Storefront: `/store/:tenantSlug`
- Customer portal: `/portal/:tenantSlug`
- Public booking: `/book/:tenantSlug`
- Public restaurant menu: `/menu/:token`
- Public receipt: `/receipt/:invoiceNumber`
- Customer display: `/customer-display`

### Route And Module Coverage

Key files:

- [`backend/routes/registerAllRoutes.js`](../../backend/routes/registerAllRoutes.js)
- [`frontend/src/routes/appRoutes.jsx`](../../frontend/src/routes/appRoutes.jsx)

Core and mode modules are wired into the app route tree. Important mode route modules include:

- [`backend/routes/restaurant.js`](../../backend/routes/restaurant.js)
- [`backend/routes/bookings.js`](../../backend/routes/bookings.js)
- [`backend/routes/projects.js`](../../backend/routes/projects.js)
- [`backend/routes/contracts.js`](../../backend/routes/contracts.js)
- [`backend/routes/service-tickets.js`](../../backend/routes/service-tickets.js)
- [`backend/routes/rentals.js`](../../backend/routes/rentals.js)
- [`backend/routes/rooms.js`](../../backend/routes/rooms.js)
- [`backend/routes/treatment-plans.js`](../../backend/routes/treatment-plans.js)
- [`backend/routes/subscriptions.js`](../../backend/routes/subscriptions.js)

---

## 3. POS Findings

Key files:

- [`frontend/src/pages/redesign/pos/POSContext.jsx`](../../frontend/src/pages/redesign/pos/POSContext.jsx)
- [`frontend/src/pages/redesign/pos/POSCheckoutModal.jsx`](../../frontend/src/pages/redesign/pos/POSCheckoutModal.jsx)
- [`frontend/src/pages/redesign/pos/POSCartTable.jsx`](../../frontend/src/pages/redesign/pos/POSCartTable.jsx)
- [`frontend/src/pages/redesign/pos/POSSearchArea.jsx`](../../frontend/src/pages/redesign/pos/POSSearchArea.jsx)
- [`frontend/src/pages/redesign/pos/cartMath.js`](../../frontend/src/pages/redesign/pos/cartMath.js)
- [`frontend/src/utils/offlineQueue.js`](../../frontend/src/utils/offlineQueue.js)

The POS is already tenant-aware in several important ways:

- It reads preset labels through `usePreset()`.
- It uses preset-specific POS search config.
- It supports grid/list POS layout behavior.
- It supports weighted/length units through preset unit vocabulary.
- It supports room folio charging when `room_management` applies.
- It supports treatment plan folio charging when `treatment_plans` applies.
- It supports wallet/loyalty checkout.
- It has shift and attendance gates.
- It uses an offline sale queue.
- It sends cart state to the customer display.
- It has POS layout tiles and item suggestions.

Important backend sale path:

- [`backend/routes/sales.js`](../../backend/routes/sales.js)

Sale processing already includes:

- Zod validation through [`backend/schemas/sales.js`](../../backend/schemas/sales.js)
- transaction-wrapped sale creation
- stock row locks with `FOR UPDATE`
- duplicate-sale protection through `idempotency_key`
- split payment recording
- card payment gateway bridge
- wallet balance protection and wallet debit ledger
- room folio attachment
- treatment folio attachment
- invoice number assignment
- post-commit inventory sync events
- low-stock notifications
- optional FBR enqueue

This is a strong foundation. The main issue is that the POS behavior is spread across one very large context and several components. The next step is to make tenant-specific behavior explicit, testable, and easier to extend.

---

## 4. Subscription And SanoPay Clarification

Subscriptions should be treated as built, not unfinished.

Key files:

- [`backend/routes/subscriptions.js`](../../backend/routes/subscriptions.js)
- [`backend/services/subscriptions.js`](../../backend/services/subscriptions.js)
- [`backend/services/payment-gateway.js`](../../backend/services/payment-gateway.js)
- [`backend/routes/sandbox.js`](../../backend/routes/sandbox.js)

What exists:

- subscription plans
- customer subscriptions
- pause/resume/cancel
- cancel reason
- detail endpoint
- renewal history
- by-customer endpoint
- churn stats
- renewal worker
- `auto_charge`
- `gateway_token`
- `subscription_runs.charge_status`
- sandbox tokenization
- sandbox saved-instrument charge
- adapter method `tokenize()`
- adapter method `chargeSavedInstrument()`

Remaining work is provider/product polish:

- real xPay or other provider saved-card tokenization when vendor API is confirmed
- admin/customer UI to collect a saved instrument and store the gateway token
- clearer UI around auto-charge status

The SanoPay sandbox should remain the default development and test path for payment-touching features.

---

## 5. Main Hardening Opportunities

### 5.1 Normalize Mode Gates

Goal:

Every vertical workflow should be protected by the correct mode and feature flag, not just navigation.

Known finding from research:

- `restaurant`, `bookings`, `projects`, `contracts`, `service-tickets`, `treatment-plans`, and `subscriptions` use `requireMode()`.
- `rentals` and `rooms` appeared to use `requireFeature()` only during the research pass and should be checked/fixed first.

Target files:

- [`backend/routes/rentals.js`](../../backend/routes/rentals.js)
- [`backend/routes/rooms.js`](../../backend/routes/rooms.js)
- [`backend/middleware/feature-flags.js`](../../backend/middleware/feature-flags.js)

Acceptance criteria:

- Retail tenants cannot call rental or room APIs unless the matching mode is enabled.
- Existing tenants with rental/room presets keep access through existing setup/backfill behavior.
- Add or update tests for mode-off access.

### 5.2 Create A POS Behavior Layer

Goal:

Replace scattered tenant-specific conditionals with one explicit behavior map.

Possible shape:

```js
const POS_BEHAVIOR_BY_MODE = {
  retail: {
    allowWeightedItems: true,
    allowRoomCharge: false,
    allowTreatmentCharge: false,
    defaultLayout: "grid",
  },
  restaurant: {
    defaultLayout: "list",
    useOrderLanguage: true,
  },
  room_management: {
    allowRoomCharge: true,
  },
  treatment_plans: {
    allowTreatmentCharge: true,
  },
};
```

This does not need to be the final exact API, but the principle is important: POS behavior should be declared in one place and consumed by POS screens.

Target files:

- new file under `frontend/src/pages/redesign/pos/`
- [`frontend/src/pages/redesign/pos/POSContext.jsx`](../../frontend/src/pages/redesign/pos/POSContext.jsx)
- [`frontend/src/pages/redesign/pos/POSCheckoutModal.jsx`](../../frontend/src/pages/redesign/pos/POSCheckoutModal.jsx)
- [`frontend/src/pages/redesign/pos/POSSearchArea.jsx`](../../frontend/src/pages/redesign/pos/POSSearchArea.jsx)
- [`frontend/src/pages/redesign/pos/POSCartTable.jsx`](../../frontend/src/pages/redesign/pos/POSCartTable.jsx)

Acceptance criteria:

- Room charge visibility is driven by POS behavior, not scattered checks.
- Treatment plan charge visibility is driven by POS behavior.
- Weighted item behavior is driven by preset/unit vocabulary plus behavior rules.
- Tests cover at least retail, restaurant, room, treatment, and weighted retail behavior.

### 5.3 Split POSContext

Goal:

Reduce risk by moving high-risk behavior into smaller hooks/modules.

Suggested extraction order:

1. Offline queue/sync hook
2. Checkout/payment hook
3. Shift and attendance gate hook
4. Customer/wallet hook
5. Room/treatment charge hook
6. Receipt/printer hook
7. Customer display hook

Why start with offline queue:

- It is high-risk.
- It touches real money/sales.
- It is currently localStorage-based.
- It can be tested independently.

Target files:

- [`frontend/src/pages/redesign/pos/POSContext.jsx`](../../frontend/src/pages/redesign/pos/POSContext.jsx)
- [`frontend/src/utils/offlineQueue.js`](../../frontend/src/utils/offlineQueue.js)

Acceptance criteria:

- `POSContext.jsx` becomes smaller without behavior regression.
- Offline queue behavior has focused tests.
- Sync duplicate handling is preserved.

### 5.4 Upgrade Offline POS Durability

Goal:

Move from lightweight localStorage queue to a more durable offline sale store.

Current:

- [`frontend/src/utils/offlineQueue.js`](../../frontend/src/utils/offlineQueue.js) stores queued sales in localStorage.
- There is a max queue limit.
- Sale sync removes successful or duplicate sales.

Future:

- IndexedDB-backed queue
- sale sync states: queued, syncing, synced, failed, duplicate
- retry count
- last error
- queued timestamp
- age warnings
- admin-visible stuck queue
- crash recovery
- explicit conflict visibility

Acceptance criteria:

- Browser restart does not lose queued sales.
- Network failure does not create duplicate sale.
- Duplicate idempotency response clears the queue item.
- Cashier can see when a queued sale is stuck.

### 5.5 Mature Payment Lifecycle

Goal:

Use the SanoPay adapter pattern consistently for every money flow.

Payment flows to standardize:

- POS card payment
- invoice payment
- storefront checkout
- booking deposits
- room deposits
- treatment deposits
- wallet top-up
- subscriptions
- refunds

Key files:

- [`backend/services/payment-gateway.js`](../../backend/services/payment-gateway.js)
- [`backend/routes/sandbox.js`](../../backend/routes/sandbox.js)
- [`backend/routes/webhooks.js`](../../backend/routes/webhooks.js)
- [`backend/tests/integration/pg-sandbox-payment.test.js`](../../backend/tests/integration/pg-sandbox-payment.test.js)

Acceptance criteria:

- Any feature writing a `gateway_ref` has a sandbox integration test.
- Webhook routing is adapter-agnostic.
- Payment state transitions are explicit and auditable.
- Refund behavior is tested through the gateway adapter where possible.

### 5.6 Improve Observability And Reconciliation

Goal:

Admins should be able to understand what happened when money, sales, inventory, or sync goes wrong.

Targets:

- sale created
- sale duplicated/replayed
- offline sale queued/synced/failed
- payment authorized/captured/failed/refunded
- wallet debit/credit
- invoice paid/partially paid
- shift variance
- stock deduction/restoration
- webhook processed/ignored/failed

Future screens or reports:

- payment reconciliation
- offline queue monitor
- duplicate sale detector
- stuck webhook/payment intent monitor
- shift discrepancy review

### 5.7 Harden Tenant, Outlet, And Branch Context

Goal:

Make the multi-branch model behave like Shopify/Square: one business account can have many locations, each operational action knows its location, and users can only work in the locations they are allowed to access.

Current product direction:

- Every customer should be treated as multi-branch capable.
- A tenant with one branch is still using the same multi-branch model.
- The plan or subscription controls how many outlets/branches the tenant can create.
- Extra branches should be monetized through a higher plan or paid add-on.
- The code should not maintain separate "single tenant" and "multi tenant" business logic paths for normal production behavior.

Reference model from Shopify and Square:

- Business/store/merchant account maps to our `tenant`.
- Location/branch maps to our `outlet`.
- Product catalog is usually tenant-wide.
- Inventory quantities are location-specific.
- POS devices/users work from a selected location.
- Reports can run for one location or all locations.
- Staff permissions are separate from location access.
- Some catalog visibility can be location-specific when the business needs it.
- Payments, refunds, inventory changes, shifts, restaurant checks, and POS sales should always be tied to a specific location.

Recommended internal model:

```text
tenant = customer/business/brand
outlet = branch/location inside tenant
employee = user inside tenant
role/permissions = what the user can do
employee_outlet_assignment = where the user can work
```

Copy the Square-style assignment concept:

```text
assignment_type:
  ALL_CURRENT_AND_FUTURE_OUTLETS
  EXPLICIT_OUTLETS
```

Example:

```text
Tenant admin:
  assignment = ALL_CURRENT_AND_FUTURE_OUTLETS
  permission = all_access

Branch manager:
  assignment = EXPLICIT_OUTLETS [Branch A, Branch B]
  permission = manager permissions

Cashier:
  assignment = EXPLICIT_OUTLETS [Branch A]
  permission = POS only
```

Known current flow:

- `GET /api/context/bootstrap` returns all active outlets for admins with `all_access`.
- Admin users should see `All Branches` plus every active outlet.
- Non-admin users should see only assigned outlets.
- Context selection writes the selected outlet/scope into frontend auth context.
- Authenticated API calls send `x-outlet-id`, `x-company-id`, and `x-scope-mode`.
- Backend context middleware reads those headers and can inject the selected outlet into `req.query.outlet_id`.

Key files:

- [`backend/routes/auth.js`](../../backend/routes/auth.js)
- [`backend/middleware/tenant-auth.js`](../../backend/middleware/tenant-auth.js)
- [`backend/middleware/permissions.js`](../../backend/middleware/permissions.js)
- [`frontend/src/pages/ContextSelect.jsx`](../../frontend/src/pages/ContextSelect.jsx)
- [`frontend/src/components/ContextSwitcher.jsx`](../../frontend/src/components/ContextSwitcher.jsx)
- [`frontend/src/components/RequireContext.jsx`](../../frontend/src/components/RequireContext.jsx)
- [`frontend/src/auth/AuthProvider.jsx`](../../frontend/src/auth/AuthProvider.jsx)

Current gaps found during inspection:

- Restaurant floor and checks screens hard-code `outlet_id=1` and ignore the selected branch.
- Reports UI defaults to all outlets and does not clearly initialize from selected branch context.
- Some inventory and stock adjustment screens default to the first outlet, not the selected outlet.
- The context switcher updates local frontend context but should also refresh/update backend token context.
- Product add/delete currently behaves tenant-wide. This is probably correct for a shared catalog, but branch-specific product visibility needs an explicit rule if required.
- Existing employees are not automatically granted access to newly added outlets unless their assignment model says they should be.

Target files for known fixes:

- [`frontend/src/pages/redesign/RestaurantFloorRedesign.jsx`](../../frontend/src/pages/redesign/RestaurantFloorRedesign.jsx)
- [`frontend/src/pages/redesign/RestaurantChecksRedesign.jsx`](../../frontend/src/pages/redesign/RestaurantChecksRedesign.jsx)
- [`frontend/src/pages/Reports.jsx`](../../frontend/src/pages/Reports.jsx)
- [`frontend/src/pages/redesign/InventoryRedesign.jsx`](../../frontend/src/pages/redesign/InventoryRedesign.jsx)
- [`frontend/src/pages/redesign/StockAdjustmentsRedesign.jsx`](../../frontend/src/pages/redesign/StockAdjustmentsRedesign.jsx)
- [`frontend/src/pages/redesign/ReturnsRedesign.jsx`](../../frontend/src/pages/redesign/ReturnsRedesign.jsx)
- [`frontend/src/components/ContextSwitcher.jsx`](../../frontend/src/components/ContextSwitcher.jsx)
- [`backend/routes/outlets.js`](../../backend/routes/outlets.js)
- [`backend/routes/employees.js`](../../backend/routes/employees.js)
- [`backend/middleware/plan-limits.js`](../../backend/middleware/plan-limits.js)

Branch-context rules to enforce:

- No POS, inventory, restaurant, report, shift, attendance, payment, refund, or stock operation should use hard-coded outlet IDs.
- No branch-specific form should default to the first outlet when a selected outlet exists.
- If selected context is a single branch, transaction forms should default to that branch.
- If selected context is `All Branches`, transaction forms that create operational records should require an explicit outlet choice.
- Tenant-wide catalog actions should be labeled and treated as tenant-wide.
- Reports should clearly show whether they are using one branch or all branches.
- Backend routes should validate that the requested outlet belongs to the current tenant and is accessible to the current employee.

Acceptance criteria:

- A tenant admin with three active outlets sees all three outlets plus `All Branches` after login.
- The same admin can switch outlets from the app shell and backend context stays in sync.
- POS, sales, shifts, attendance, restaurant checks, stock adjustments, returns, and inventory counts use the selected outlet unless `All Branches` requires explicit outlet selection.
- Reports open with a clear branch/all-branches state that matches selected context.
- Non-admin users can only see and operate on assigned outlets.
- Adding a new outlet respects plan limits and does not silently expose it to employees who should not have access.
- Tests cover admin all-branch access, employee explicit-outlet access, selected-branch POS sale, selected-branch report defaults, and hard rejection of inaccessible outlet IDs.

---

## 6. Preset Test Matrix

Do not test every industry as a separate app. Test behavior classes.

Recommended matrix:

| Behavior Class | Example Preset | What To Test |
|---|---|---|
| Base retail | `general_retail` | POS sale, inventory, customer, receipt, reports |
| Weighted retail | `butcher`, `sweet_shop`, `textile` | decimal quantity, unit vocabulary, stock deduction, returns |
| Restaurant | `restaurant`, `cafe` | checks, KDS, order language, public menu |
| Appointments | `salon`, `clinic` | services, booking calendar, public booking, staff |
| Subscription + appointment | `gym` | membership plan, subscription renewal, appointment booking |
| Service project | `photography_studio` | quotation, project, contract, invoice |
| Workflow ticket | `repair_shop` | ticket intake, job status, invoice |
| Rentals | `car_rental`, `equipment_hire` | rental asset, contract, checkout, return, overdue |
| Room management | `hotel`, `guesthouse`, `hostel` | room booking, folio, POS charge to room, stay portal |
| Treatment plans | `dental_clinic`, `veterinary`, `physiotherapy` | plan, sessions, chart/labs, consent, POS charge to plan |

This gives high confidence without building 50 separate QA flows.

---

## 7. Recommended Next Session Order

Start here:

1. Fix branch context leaks first: remove hard-coded `outlet_id=1` from restaurant floor/checks.
2. Make reports initialize from selected context: selected branch by default, or clear `All Branches`.
3. Make inventory, stock adjustment, and returns forms default to selected outlet instead of the first outlet.
4. Make `ContextSwitcher` update backend/token context when changing branches.
5. Add tests for admin all-outlet access, employee explicit-outlet access, selected-branch POS sale, and inaccessible outlet rejection.
6. Verify `rentals` and `rooms` backend mode gates.
7. Add `requireMode("rentals")` and `requireMode("room_management")` where missing.
8. Add focused tests for mode-off access to those APIs.
9. Create a small POS behavior module/hook.
10. Wire room/treatment charge visibility through the behavior layer.
11. Add frontend tests for POS behavior by preset/mode.
12. Extract offline queue logic from `POSContext.jsx` into a dedicated hook.
13. Plan IndexedDB migration for offline queue as the next hardening step.

Do not start manufacturing unless a factory/production tenant commits. Manufacturing remains the next real new mode, but it should not distract from hardening the core.

---

## 8. Product Rule Going Forward

Before adding a new preset or industry, ask:

1. Can an existing mode handle this with labels, nav, sample data, portal tabs, and report defaults?
2. Is the missing piece a small extension to a current mode?
3. Is this actually a new operational mode?
4. Would improving the shared core solve this for many industries at once?

Build a new mode only when the answer to #3 is clearly yes. Otherwise, improve the core or add preset configuration.

---

## 9. Definition Of Success

This hardening phase is successful when:

- POS behavior is predictable across presets.
- Mode APIs are protected consistently.
- Offline sale handling is durable and visible.
- Payment flows share one adapter/state-machine pattern.
- Subscription auto-charge remains testable through sandbox.
- Adding a new industry usually means adding config, not building a new app.
- Improving POS, payments, inventory, reporting, and portal improves many industries at the same time.
