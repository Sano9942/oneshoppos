# Root tooling findings

## TC-001 — Medium — `verify-audit.sh` can report a nonexistent live suite as passed and targets production mutations

- Severity/confidence: Medium / High.
- Evidence: `verify-audit.sh:66-79` claims to run a live E2E suite against `sanopos.com`, loops only over `frontend/tests/live/00-20`, and skips every absent match; `frontend/tests/live/` and `frontend/playwright.config.live.js` do not exist, so `E2E_FAILED` remains zero and the script reports that all specs passed. The same script instructs manual production mutations—tax-rate CRUD, support-ticket submission, and making a sale—at `verify-audit.sh:105-120`. Backend integration execution uses `npx jest` at line 40, while supported package scripts use Vitest (`backend/package.json:14-18`).
- Affected conditions: developer/operator runs `bash verify-audit.sh` as the advertised post-audit/release verification command.
- Verification: inspect the absent live paths, or bypass/complete step 1 and observe step 2 performs zero specs yet increments no failure and prints success.
- Counterevidence/uncertainty: `set -e` may terminate earlier if the obsolete Jest invocation fails, preventing the false live-suite success in some environments. This makes the script broken rather than safe. The production target is printed visibly.
- Impact: release assurance can be false or the operator can be directed into unapproved production mutations; regressions may ship under an “all automated checks passed” message.
- Remediation direction: delete or replace the script with package-script-backed Vitest and an explicitly local/staging Playwright configuration; fail when zero tests are discovered; require an explicit production-mutation approval flag and never include production CRUD in the default audit command.
- Regression tests: CI invokes the verification entry point, asserts nonzero discovered tests, rejects a production base URL by default, and fails when the config/spec paths are absent.

