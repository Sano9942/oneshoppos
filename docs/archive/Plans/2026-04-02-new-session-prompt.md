# New Session Prompt

Copy-paste this into a new Claude Code session:

---

Read these files first, in order:
1. `docs/plans/2026-04-02-fix24-api-service-layer.md`
2. `docs/plans/2026-04-02-fix25-zod-validation.md`
3. `docs/plans/2026-04-02-audit-fix-session-handoff.md`

We're on branch `fix/architecture-audit-fixes`. Phases 1-7 are done (419 tests passing, commit `e8834c1`).

Execute Fix 25 (Zod validation) first — it's backend-only and testable. Then do Fix 24 (api.js service layer). Both plans have been reviewed against the actual codebase and include all gotchas.

Key things to know:
- **Git workflow**: commit frequently, push to branch, NEVER merge to main, NEVER create a PR
- **Test command**: `cd backend && npx jest tests/integration/pg-batchN-name.test.js --no-coverage --forceExit`
- **Full suite**: loop through all 12 batch files (pg-batch1-crud through pg-batch11-admin + pg-tenant-isolation)
- **Frontend build check**: `cd frontend && npm run build`
- **Zod critical**: use `.passthrough()` on every schema, use `z.coerce.number()` for string fields
- **api.js critical**: don't touch AuthProvider.jsx or AdminLogin.jsx, use `api.raw()` for callers checking res.status

Start with Fix 25. Read `backend/routes/billing.js` first (lowest risk), create the schema + validate middleware, wire it in, run tests. Then move to auth, employees, products, sales in that order.
