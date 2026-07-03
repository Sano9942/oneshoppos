# Dependency and Advisory Report

Observed with `npm.cmd audit --json` on 2026-07-03. Scanner output is inventory evidence, not proof of application reachability. No dependency versions were changed.

## Backend lockfile

- Total advisories: 31 — 0 critical, 14 high, 15 moderate, 2 low.
- Direct runtime packages flagged high: `multer`, `nodemailer`, `sqlite3`, `xlsx`.
- Direct runtime packages flagged moderate: `@anthropic-ai/sdk`, `@sentry/node`, `resend`.
- `xlsx` reported no automatic fix. Several `sqlite3`-chain alerts propose changing `sqlite3`; SQLite is documented as inactive but remains a production dependency, so removal/reachability should be verified before interpreting those transitive alerts.
- Other high transitive packages include `fast-xml-builder`, `fast-xml-parser`, `form-data`, `minimatch`, `path-to-regexp`, `tar`, and `vite`.

Installed direct versions and reachability evidence:

- `multer@2.0.2`: production-reachable across product, support, receipt-template, treatment-plan, company-logo and import uploads.
- `nodemailer@8.0.1`: production-reachable in email, CRM and governance report routes.
- `xlsx@0.18.5`: production-reachable for attacker/operator-supplied import workbooks and template generation; prioritize manual advisory analysis because npm reports no fix.
- `@anthropic-ai/sdk@0.80.0`, `@sentry/node@10.46.0`, and `resend@6.9.4`: production-reachable in AI insights, error capture and email flows.
- `sqlite3@5.1.7`: no active production import was found; references were legacy scripts/tests. It remains installed as a runtime dependency and should be removed or moved if truly inactive.

## Frontend lockfile

- Total advisories: 15 — 1 critical, 9 high, 3 moderate, 2 low.
- The critical item is direct dev dependency `vitest` (`>=4.0.0 <4.1.0`), so it affects the test/build environment unless a production-reachable path is separately demonstrated.
- Direct runtime packages flagged high: `react-router-dom`, `xlsx`.
- Direct dev package flagged high: `vite`.
- High transitive packages include `react-router`, `rollup`, `undici`, `flatted`, `minimatch`, and `picomatch`.
- `xlsx` reported no automatic fix.

Installed direct versions and reachability evidence:

- `react-router-dom@7.13.0`: production-critical routing dependency imported throughout the application.
- `xlsx@0.18.5`: production-reachable through dynamic imports in inventory and COD/import workflows handling local workbook files.
- `vite@7.3.1` and `vitest@4.0.18`: build/test-time tools, not shipped as application runtime dependencies by the observed Vite build.

## Required follow-up

1. Export exact advisory IDs/descriptions and map each to runtime import paths and attacker-controlled inputs.
2. Upgrade fixable direct dependencies in a separate change set, then run unit/build/integration/E2E regression suites.
3. Decide whether inactive `sqlite3` can be removed from backend production dependencies.
4. Replace or isolate `xlsx` if upstream remains without a fix; prioritize import paths accepting untrusted workbooks.
