# Frontend Tests — Claude Guide

- **Three test suites**, two frameworks:
  - **Live E2E** (`tests/live/`): Playwright, 24 specs, targets `https://sanopos.com`. Sequentially numbered + stateful (state.json threading). API-first (no browser UI for data setup)
  - **Dev E2E** (`tests/e2e/`): Playwright, 8 specs, targets `http://localhost:5000`. Mix of browser + direct API
  - **Unit** (`tests/unit/`): Vitest + React Testing Library, 4 files, pure component/function tests
- **Live specs are order-dependent** — running out of sequence fails because each spec reads IDs written by earlier specs
- **File naming**: Live/E2E use `*.spec.js`, unit tests use `*.test.jsx`
- **Config files**: `playwright.config.live.js` (live), `playwright.config.js` (dev e2e), `vitest.config.js` (unit)
- **Run**: `npx playwright test tests/live/ --config=playwright.config.live.js` (live), `npx vitest run tests/unit/` (unit)
