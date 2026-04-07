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
- **Unit tests**: `unit/` directory — Vitest, 4 files, unchanged

## Config
- Single config: `playwright.config.js` (production target)
- No separate live/onboarding configs
