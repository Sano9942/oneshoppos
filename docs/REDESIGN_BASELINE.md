# Redesign Baseline Contract (Phase 0)

Last Updated: 2026-02-26

This document freezes the pre-redesign behavior contract for phased rollout safety.

## Route and Access Contract

- Frontend route source: `frontend/src/App.jsx`
- Backend endpoint source: `backend/routes/registerAllRoutes.js` and `backend/routes/tier4.js`
- Permission guards:
  - Route-level: `frontend/src/components/RequirePerm.jsx`
  - API-level: `requirePerm` and permission rule middleware in `backend/index.js`

## Feature Flag Contract

Baseline existing flags:

- `backup_restore`
- `e_invoicing_export`
- `supplier_payables`
- `approvals`
- `notifications`
- `accounting_core`
- `crm_quotations`
- `advanced_hr`
- `multi_company`

Redesign rollout flags added:

- `ui_redesign_enabled`
- `ui_redesign_inventory`
- `ui_redesign_orders`
- `ui_redesign_pos`
- `ui_redesign_reports`
- `ui_redesign_admin`

## Key API Response Shape Baseline

Current API error baseline is primarily:

```json
{ "error": "message" }
```

Standardized error-envelope migration is deferred to later waves to avoid breaking clients.

## Out-of-Scope for Redesign

- Placeholder routes:
  - `/lookup`
  - `/custom-fields`
  - `/partners`
  - `/shopcast`
- Email/SMS receipts implementation (`Tier 3.1`)
