# OneShopPOS Daily SOP

This manual describes the exact daily operating flow for OneShopPOS.

> **Note for SaaS deployments:** Currency denominations and employee PINs are configured per business. The cash denominations shown below are examples from the default Pakistan configuration. Your setup may differ.

## 1. Roles Used in This System

The project currently uses these roles:

- `Administrator`
- `Manager`
- `Cashier`

There is no separate `Salesman` role right now. In daily store operations, the `Cashier` role is the selling role at the counter.

## 2. Opening the Day

### Step 1: Start the software

1. Start the system from the store computer.
2. The login screen will appear.

### Step 2: Manager or Administrator logs in

1. A `Manager` or `Administrator` logs in using username and PIN.
2. This person is responsible for opening the day and preparing the branch for sales.

### Step 3: Open the kiosk for staff attendance

1. Open the `Kiosk` screen.
2. Each employee clocks in using their own PIN.
3. This includes the cashier and any other staff starting work.

If the manager also plans to sell, the manager should also clock in through the kiosk.

### Step 4: Open POS

1. Open the `POS` screen.
2. The POS will first require branch selection.
3. Select the correct branch / outlet.

### Step 5: Open shift directly from POS

If no shift is open for the selected branch, POS will block selling until a shift is opened.

The `Manager` or `Administrator` must open the shift by counting the opening cash denominations:

- `Rs 5000`
- `Rs 1000`
- `Rs 500`
- `Rs 100`
- `Rs 50`
- `Rs 20`
- `Rs 10`

The system totals these denominations and uses the result as the opening float. Available denominations are configured per business.

### Step 6: Start selling

After shift opening:

- the manager can sell directly in POS, or
- the manager can log out of POS and the cashier can log in and begin selling

Because staff already clocked in through the kiosk, the cashier can proceed normally after login.

## 3. Required Rules Enforced by the System

The POS now follows these mandatory rules:

### Rule 1: Cannot checkout unless shift is open

A sale cannot be completed unless the selected branch has an active open shift.

If no shift is open:

- POS stays blocked
- manager or administrator must open the shift first

### Rule 2: Employee must be clocked in before checkout

A sale cannot be completed unless the logged-in employee is currently clocked in for that branch.

Checkout is blocked if the employee is:

- `not clocked in`
- `on break`
- `clocked out`

This means:

- branch shift must be open
- employee must be actively clocked in

Both conditions are required for checkout.

## 4. Daily Sales Operation

Once the branch is open and the shift is active:

1. Cashier logs in to POS.
2. Select the branch if needed.
3. Scan items and build the cart.
4. Take payment.
5. Complete the sale and print the receipt.

If the cashier goes on break:

1. Leave POS.
2. Go to kiosk.
3. Enter PIN.
4. Start break with the correct reason.

When returning:

1. Go to kiosk.
2. Enter PIN.
3. Clock back in.

## 5. Closing the Day

### Step 1: Cashier stops selling

1. Finish the last customer.
2. Make sure no incomplete sale remains in the cart.
3. Cashier logs out of POS.

### Step 2: Manager closes shift

1. Manager logs in if needed.
2. Open the shift closing flow in POS.
3. Count the closing cash using the same denominations:
   - `Rs 5000`
   - `Rs 1000`
   - `Rs 500`
   - `Rs 100`
   - `Rs 50`
   - `Rs 20`
   - `Rs 10`
4. Close the shift.
5. Record variance notes if required.

Shift closing remains a manager-controlled action.

### Step 3: Employees clock out

After shift closure:

1. Each employee opens the kiosk.
2. Each employee enters their own PIN.
3. Each employee performs `End of Day Clock Out`.

This includes the cashier and any other employee who worked that day.

## 6. Full Daily Flow Summary

### Opening

1. Start software
2. Manager / Administrator logs in
3. Open kiosk
4. Each employee clocks in
5. Open POS
6. Select branch
7. Open shift from POS by entering opening denominations
8. Manager sells, or logs out and cashier logs in

### During the day

1. Cashier records sales in POS
2. Staff use kiosk for breaks and returns from break
3. POS checkout works only when shift is open and employee is clocked in

### Closing

1. Cashier finishes last sale and logs out
2. Manager closes shift
3. Each employee performs end-of-day clock out in kiosk

## 7. Responsibility Split

### Manager / Administrator

- opens the day
- selects branch
- opens shift
- supervises selling
- closes shift

### Cashier

- clocks in
- logs into POS
- records sales
- uses kiosk correctly for breaks
- logs out after selling
- performs end-of-day clock out

## 8. Important Operating Note

The correct business order is now:

1. login
2. kiosk clock-in
3. branch selection
4. shift opening
5. selling
6. cashier logout
7. manager shift closing
8. employee end-of-day clock out

This is the official recommended operating procedure for this project.

Login uses:

- **Username:** employee name (as configured in the system)
- **PIN:** employee PIN code
  Hassan 2580 Administrator
  mubashir 2222 Manager
  naeem shah 1234 Manager
  ishtiaq 3333 Cashier

Employee accounts are managed in the Employees section by an Administrator. Each employee's PIN is set when their account is created.

Phase 6C is 5 deferred tracks — all blocked on pre-conditions that don't exist yet:

Track What it is Blocked on
Performance Load tests with 10k+ sales Need a large seed dataset + load tooling. Deferred until SaaS multi-tenant mode.
Migration testing Schema diff before/after each migration Only matters when migrate62.js is written. Add tests alongside that migration.
Backup/restore Test the backup/restore feature end-to-end Feature is flag-gated. Needs a snapshot fixture. Deferred to post-launch.
Cross-browser Run E2E suite in Firefox/WebKit Zero new code needed — just add --project=firefox to the Playwright command when wanted.
Observability Test that errors are logged correctly Pre-condition: structured log transport. Currently only console.error exists.
Short version: Phase 6C has no work to do right now. Each track unlocks when something else ships first — a new migration, a log transport, SaaS mode, or post-launch. Nothing here should be worked on proactively.

what is feature development
Looking at the SAAS conversion plan and overall project state to understand what feature development means in this context:

Read d:\newprojects\oneshoppos\SAAS_CONVERSION_PLAN.md (lines 2-81)
Read d:\newprojects\oneshoppos\SAAS_CONVERSION_PLAN.md (lines 81-180)
Here's the full picture of what "feature development" means for this project right now:

Two Tracks of Feature Development
Track A — SaaS Conversion (the big next thing)
The SAAS_CONVERSION_PLAN.md lays out a full roadmap to convert OneShopPOS from a single-tenant local app to a cloud-hosted multi-tenant SaaS product:

Phase What Status
Pre-req Timezone fix ✅ Done (Post-5)
Phase 1 Master DB + tenant management layer ❌ Not started
Phase 2 JWT authentication overhaul ❌ Not started
Phase 3 Multi-tenancy middleware (AsyncLocalStorage + DB proxy) ❌ Not started
Phase 4+ Billing, admin dashboard, deployment ❌ Not started
The key insight in the plan: because all 26 route files already use deps.db via dependency injection, the multi-tenant DB swap can be done at the middleware layer with zero changes to most routes.

Track B — POS Feature Backlog
New POS features (e.g. loyalty program improvements, new report types, new Shopify sync capabilities, etc.) — nothing currently queued.

The natural next step is SaaS Phase 1 — it's purely additive (no existing files modified), creates the foundation everything else builds on, and the test infrastructure is now solid enough to support it properly.

Want to start brainstorming/planning SaaS Phase 1?

Feature Can do now? Blocks anything?
ESC/POS printer ✅ Yes Nothing
Email receipts ✅ Yes Nothing
Cross-outlet reports ✅ Yes Nothing
Payment gateway ✅ Yes (but better after JWT) Better after SaaS Phase 2
2FA/MFA ✅ Yes (but better with JWT) Better after SaaS Phase 2
SaaS Phase 1 ✅ Yes All other SaaS phases
SaaS Phase 2+ ❌ Needs Phase 1 first Sequential
