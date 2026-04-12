# Test Suite Guide

## Overview
24 self-contained Playwright specs (~290 tests) auditing every page and feature against production.

## Running Tests

```bash
# All specs
cd frontend && npx playwright test

# Single spec
cd frontend && npx playwright test tests/auth.spec.js

# With headed browser
cd frontend && npx playwright test tests/auth.spec.js --headed

# Show report
cd frontend && npx playwright show-report
```

## Test Tenant
- Store: `packagesmall`
- User: `hassan` / `Danish11`
- PIN: `2580`

## Architecture
- **Production-only**: all tests hit `sanopos.com` + `api.sanopos.com`
- **Self-contained**: each spec sets up its own data via API, no shared state
- **Global setup**: `global-setup.js` logs in once, saves `auth.json` + `token.json`
- **Helpers**: `helpers/auth.js` (credentials), `helpers/api.js` (REST), `helpers/nav.js` (navigation)

## Spec Files (24 specs)
`auth`, `products`, `customers`, `inventory`, `purchasing`, `orders`, `pos-core`, `pos-advanced`, `employees-hr`, `crm`, `reports`, `accounting`, `settings`, `billing`, `fbr`, `integrations`, `import-export`, `permissions`, `navigation-ux`, `admin-panel`, `public-pages`, `onboard-free`, `onboard-starter`, `onboard-pro`

## Smoke Tests (14 specs)
- Location: `tests/smoke/` — broader E2E coverage for competitive features
- Specs: `bookings`, `catalog-advanced`, `commissions-reports`, `draft-orders-returns`, `insights-dashboard`, `invoicing-subscriptions`, `marketing-messaging`, `omnichannel-admin`, `phase5-pakistan`, `pricing-promotions`, `restaurant`, `service-workspace`, `storefront-public`, `workforce`
- Smoke helpers: `tests/smoke/helpers/` — `cleanup.js`, `featureFlags.js`, `mockPaymentGateway.js`, `smokeRunId.js`

## Unit Tests (4 files — Vitest)
- Location: `tests/unit/` — `auth_guards.test.jsx`, `contexts.test.jsx`, `layout.test.jsx`, `primitives.test.jsx`
- Run: `npx vitest run tests/unit/`

## Config
- Single config: `playwright.config.js` (production target)
- No separate live/onboarding configs
