# Onboarding E2E Test Plan — Design Document

**Date**: 2026-03-28
**Target**: Live production (`sanopos.vercel.app` / Railway backend)
**Tool**: Playwright (matches existing live E2E suite)

## Goal

Simulate a complete real-world onboarding experience for all 3 plan tiers (Free, Starter, Pro). Each test run creates a real tenant, walks through the full journey from signup to first sale, verifies plan-specific limits, then the tenant is manually soft-deleted from super-admin before running the next plan.

## Test Structure

Three new spec files, run sequentially:

```
frontend/tests/live/
  21-onboard-free.spec.js
  22-onboard-starter.spec.js
  23-onboard-pro.spec.js
```

Plus shared helpers:

```
frontend/tests/live/helpers/
  onboarding.js          # Shared onboarding functions (signup, setup, login, etc.)
```

And a test log:

```
docs/test-logs/2026-03-28-onboarding-tests.md
```

## Shared Test Credentials

| Field | Value |
|-------|-------|
| Email | `sano9942@hotmail.com` |
| Password | `TestOnboard2026!` |
| Admin PIN | `1234` |
| Owner Name | `Test Owner` |

## Per-Plan Test Store Names

Slugs include a timestamp suffix to avoid conflicts with soft-deleted tenants:

| Plan | Store Name | Slug Pattern |
|------|-----------|-------------|
| Free | `Test Free {ts}` | `test_free_{ts}` |
| Starter | `Test Starter {ts}` | `test_starter_{ts}` |
| Pro | `Test Pro {ts}` | `test_pro_{ts}` |

Where `{ts}` is `Date.now()` at test start (e.g., `test_free_1711612800000`).

## Plan Limits Reference

| Resource | Free | Starter | Pro |
|----------|------|---------|-----|
| Outlets | 1 | 3 | 10 |
| Employees | 3 | 10 | 50 |
| Products | 500 | 2,000 | Unlimited |

## Test Flow Per Plan

Each spec file follows this sequence. Each step is a separate `test()` block so we get granular pass/fail visibility.

### Step 0: Pre-flight Health Check
- `GET /api/health?deep=true` against Railway backend
- **Verify**: Status 200, Postgres connected, Resend reachable
- Abort test run early if backend is unhealthy

### Step 1: Landing Page Pricing
- Navigate to `/` (landing page)
- **Verify**: Pricing section renders with actual prices (not `...` loading state)
- **Validates**: The duplicate pricing route fix from today

### Step 2: Signup
- Navigate to `/signup?plan={plan}`
- Fill: store name, owner name, email, password
- Select plan (radio button)
- Submit form
- **Verify**: Success response, redirect to `/setup?token=...&tenant=...`
- **Side effect**: Welcome email sent via Resend to `sano9942@hotmail.com`
- Save `slug` and `setupToken` to state file

### Step 3: Setup Wizard
- Navigate to `/setup?token={token}&tenant={slug}`
- **Step 1 of 4 — Store Identity**: Fill store name, country (Pakistan), city, phone
- **Step 2 of 4 — Time & Currency**: Verify auto-populated timezone (Asia/Karachi), currency (PKR), denominations. Optionally add a tax.
- **Step 3 of 4 — First Outlet**: Fill outlet name and address
- **Step 4 of 4 — Admin Account**: Fill name, PIN (1234), confirm PIN
- Submit setup
- **Verify**: "Setup complete!" message, redirect to `/login`

### Step 4: First Login
- Navigate to `/login`
- Fill: store code (slug), username (owner name), password
- Submit
- **Verify**: Lands on `/context-select` or auto-redirects to `/dashboard`
- If context-select: select the outlet, proceed
- **Verify**: Dashboard renders with welcome state (no sales data yet)
- Save auth token to state for API calls

### Step 5: Verify Billing Page
- Navigate to `/billing`
- **Verify**: Page renders, shows correct plan name (Free/Starter/Pro)
- **Validates**: Subscription billing layer from recent work

### Step 6: Verify Support Widget
- On any authenticated page (dashboard)
- **Verify**: Floating support widget button is visible
- **Validates**: Support ticket infrastructure from recent work

### Step 7: Add Products
- Navigate to `/products` (or use API)
- Add 2 test products with prices and initial stock
- **Verify**: Products appear in product list
- Save product IDs to state

### Step 8: Open Cash Shift
- Navigate to `/pos` or use API
- Open a new cash shift with opening float (e.g., PKR 5,000)
- **Verify**: Shift is active, POS is ready

### Step 9: Clock In (Attendance)
- Use API to clock in the admin employee
- **Verify**: Employee has active attendance session

### Step 10: First Sale
- In POS, search/scan for test product
- Add to cart
- Apply cash payment
- Complete sale
- **Verify**: Sale succeeds, invoice number generated
- **Verify**: Receipt modal shows correct items and total
- Save sale ID and invoice number to state

### Step 11: Verify Sale Recorded
- Navigate to `/sales-history` or use API
- **Verify**: Sale appears with correct total, items, payment method
- Check dashboard counters updated

### Step 12: Plan Limit Tests (plan-specific)

**Free Plan:**
- Try to create a 2nd outlet → expect 403 `PLAN_LIMIT_REACHED`
- Create 2 more employees (total 3) → should succeed
- Try to create a 4th employee → expect 403 `PLAN_LIMIT_REACHED`

**Starter Plan:**
- Create 2nd and 3rd outlets → should succeed
- Try 4th outlet → expect 403
- Create employees up to 10 → should succeed
- Try 11th → expect 403

**Pro Plan:**
- Create multiple outlets and employees freely → no limit errors
- Verify advanced features accessible (reports pages load, accounting page loads)

### Step 13: Cleanup Note
- Log completion status
- User manually deletes tenant from super-admin (`/admin`) before running next plan

## Execution Workflow

```
1. Run:  npx playwright test tests/live/21-onboard-free.spec.js --config=playwright.config.live.js
2. Review test log, fix any failures
3. Delete test tenant from super-admin UI
4. Run:  npx playwright test tests/live/22-onboard-starter.spec.js --config=playwright.config.live.js
5. Review, fix, delete tenant
6. Run:  npx playwright test tests/live/23-onboard-pro.spec.js --config=playwright.config.live.js
7. Review, fix, delete tenant
```

## Test Log Format

`docs/test-logs/2026-03-28-onboarding-tests.md` tracks results in real-time:

```markdown
## Free Plan — test_free_{ts}
| # | Step | Status | Issue | Fix |
|---|------|--------|-------|-----|
| 1 | Signup | ? | — | — |
| 2 | Setup wizard | ? | — | — |
| ...
```

Updated after each step. Issues get root-caused and fixed before proceeding.

## Key Design Decisions

1. **Unique slugs per run** — Tenant deletion is soft-delete only (sets `status='deleted'`). Reusing the same slug would hit "Store name already taken". Timestamp suffix avoids this.

2. **No separate globalSetup** — These specs don't use the existing `live-auth.json` session (that's for `packagesmall`). Each spec handles its own signup → login flow and saves its own auth state.

3. **UI-driven where possible** — Signup, setup wizard, login, and POS sale are done through the UI (not API) to test the real user experience. Plan limit tests use API calls for speed (no need to navigate the UI to create 10 employees).

4. **Sequential execution** — `fullyParallel: false`, `workers: 1` (matches existing config). Each test depends on the previous (login needs signup, sale needs products, etc.).

5. **Same email for all 3 plans** — Tests Resend welcome email delivery. Since tenants are deleted between runs, the email is reused.

6. **State file per plan** — Each spec writes to the shared `state.json` with plan-prefixed keys (e.g., `free_slug`, `free_token`) to avoid collisions if state isn't cleaned between runs.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/tests/live/helpers/onboarding.js` | Shared signup, setup, login, product creation, shift, sale helpers |
| `frontend/tests/live/21-onboard-free.spec.js` | Free plan: full onboarding + limit tests |
| `frontend/tests/live/22-onboard-starter.spec.js` | Starter plan: full onboarding + limit tests |
| `frontend/tests/live/23-onboard-pro.spec.js` | Pro plan: full onboarding + limit tests |
| `docs/test-logs/2026-03-28-onboarding-tests.md` | Real-time test result log |
