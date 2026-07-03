# Frontend test evidence

## Test configuration and safety

- Unit tests: Vitest, local/mocked (`frontend/package.json:14-16`; `tests/unit/`). Safe to run.
- E2E/smoke/sweep: Playwright base URL is production (`playwright.config.js:16-18`), one worker, shared production auth; sweep is headed and provisions a tenant (`:25-50`). Not run in this audit because the assignment prohibited production mutations.
- Existing E2E tenant is documented as deleted in `frontend/tests/CLAUDE.md`, which would also make many legacy failures non-diagnostic.

## Commands attempted

| Command | Result |
|---|---|
| `npm.cmd run lint` | Failed: 944 problems (825 errors, 119 warnings). This is a quality-gate failure; individual lint reports are not automatically product defects. |
| `npm.cmd run typecheck` | Passed. |
| `npm.cmd run test:unit` | Passed: 18 files, 155/155 tests. Repeated React `act(...)` warnings were emitted by POS/loyalty tests. |
| Targeted `npx.cmd eslint` over auth/routes/API/primitives/receipt/treatment/field/POS-offline files | Failed: 28 errors and 4 warnings. Notable results were four `react-hooks/preserve-manual-memoization` errors in `useOfflineQueue.js`, unused values, hook-dependency warnings, and numerous project-specific `sano/no-raw-interactive` violations in treatment/field pages. This is a scoped result, not the full-tree total. |
| Playwright E2E/smoke/sweep | Not run: production target and mutating behavior. |

## Coverage observations from test source

- Unit coverage exists for `RequireAuth`/`RequirePerm`, shared Modal basics (role, Escape, backdrop, focus restore), TabBar selection, cart math/tax, POS context restaurant check state, IndexedDB queue CRUD, POS offline hook, loyalty, omni input and chunk recovery.
- No unit test mounts the real `AuthProvider` interceptor to exercise header injection, Request inputs, concurrent token refresh, retry, synthetic offline responses, subscription expiry or tenant-switch cleanup.
- Offline tests do not cover tenant identity, the `check_in`/`field_order` type-to-endpoint map, linked ordering, or reconnect transition from failed state.
- Upload tests do not cover `api.upload` raw-response semantics or the receipt/clinical callers.
- Modal tests do not assert a focus trap; POS inline dialogs are not covered by the shared Modal suite.
- Navigation E2E checks only that dark theme toggles/persists (`navigation-ux.spec.js:108-152`), not computed colors/contrast.
- `@axe-core/playwright` is installed (`package.json:40`) but no safe local/staging accessibility project is configured.

## Tooling defect

`parity:audit` and related scripts cannot run because `tools/api-parity-audit.js` is absent; recorded as F-10.
