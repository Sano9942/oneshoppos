# Backend-Frontend Parity Playbook

This playbook defines how to prove every backend API capability is either surfaced in frontend or intentionally excluded.

## Goal

For every endpoint in `backend/routes/**`, one of these must be true:

- It is directly mapped in frontend (`frontend_mapped`).
- It is intentionally backend-only (`backend_only_by_design`).
- It is internal/operational only (`internal_system_only`).
- It is explicitly marked legacy (`deprecated_pending_removal`).

No endpoint should be unclassified.

## Artifacts

- Scanner: `tools/api-parity-audit.js`
- Human report: `docs/API_PARITY_AUDIT.md`
- Machine report: `docs/api-parity/audit-latest.json`
- Registry: `docs/api-parity/parity-registry.json`
- Method mismatch registry: `docs/api-parity/method-mismatch-registry.json`
- Intentional markdown (generated): `docs/INTENTIONAL_BACKEND_ONLY_APIS.md`

## Commands

```bash
node tools/api-parity-audit.js --format both
node tools/api-parity-audit.js --format both --sync-registry
node tools/api-parity-audit.js --format both --fail-on frontend-only
node tools/api-parity-audit.js --format both --fail-on unclassified
```

Exit codes:

- `0`: pass
- `2`: frontend-only mismatch exists (`--fail-on frontend-only`)
- `3`: unclassified backend-only exists (`--fail-on unclassified`)

## Registry Schema

Each entry in `parity-registry.json` includes:

- `endpoint` (`METHOD /api/path`)
- `classification`
- `frontend_refs[]`
- `reason`
- `owner`
- `review_date`

## Audit Workflow

1. Run scanner in baseline mode (`--format both`).
2. Review:
   - `frontend_only`
   - `method_mismatches`
   - `confidence_warnings`
3. Record known static-scan noise in `method-mismatch-registry.json` with owner/reason/review date.
4. Sync missing backend-only entries into registry (`--sync-registry`).
5. Update classification/reason/owner/review date where needed.
6. Re-run baseline and enforcement checks.
7. Commit generated artifacts with related API/UI changes.

## CI Rollout

- Phase 1: publish reports (non-blocking).
- Phase 2: block on `frontend_only > 0`.
- Phase 3: block on `unclassified_backend_only > 0`.

Current workflow enforces both Phase 2 and Phase 3.

## Ownership and SLA

- Default owner: route module maintainer (derived from source file).
- Review cadence: monthly.
- Any unclassified endpoint must be classified in the same PR that introduces it.

## Required Quality Checks

- Backend integration tests for changed API families.
- Frontend tests for each exposed state/action path.
- E2E coverage for high-risk flows (auth/rbac, feature-flag toggles, reports, shopify, attendance kiosk).
