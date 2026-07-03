# Backend routes A–M audit shard

Read-only source audit. Application/configuration/Git files were not modified.

## Inspected paths and evidence scope

- `backend/routes/approval-policies.js` — all route declarations and full manager-PIN authorization/evaluation/price-override handlers; feature/permission guards, bcrypt PIN scan, approval-event writes.
- `backend/routes/attendance.js` — full PIN-resolution helpers and kiosk status/check-in/check-out flows; auth exemption, outlet assignment/geofence, day/session read-modify-write behavior; manager correction declarations.
- `backend/routes/attribute-sets.js` — all route declarations and transaction/query inventory; CRUD permission boundary.
- `backend/routes/barcode-expenses.js` — all route declarations and guard inventory; barcode/expense/backup/invoice/export/notification/serial endpoint surface.
- `backend/routes/billing.js` — route declarations and billing upgrade/add-outlet/checkout flows; tenant lookup, pricing, payment-intent and gateway calls.
- `backend/routes/bookings.js` — complete route/guard/validation inventory; mode, feature, and booking permission gate applied to every handler.
- `backend/routes/brands.js` — complete CRUD route/guard/query inventory.
- `backend/routes/categories.js` — complete route/guard/query/transaction inventory, including tree move/delete operations.
- `backend/routes/commissions.js` — complete route and query/transaction inventory.
- `backend/routes/contracts.js` — complete route/guard/validation/query inventory.
- `backend/routes/country-packs.js` — complete public static router inventory.
- `backend/routes/couriers.js` — full configuration and shipment-booking path, plus route/guard/query inventory for tracking/cancel flows.
- `backend/routes/customer-display.js` — complete file; in-memory tenant/shift keying and POST/GET authentication behavior.
- `backend/routes/customer-invoices.js` — complete route/guard/validation/query inventory.
- `backend/routes/customers.js` — complete route/permission/feature/query inventory.
- `backend/routes/draft-orders.js` — complete file; list/detail/create/update/claim/complete/cancel authorization and transaction behavior.
- `backend/routes/email.js` — complete file; SMTP config masking/admin writes, receipt lookup/render/send paths and Resend fallback.
- `backend/routes/employees.js` — complete route/permission/validation/query inventory; full PIN validation and password/PIN self-service paths.
- `backend/routes/field.js` — complete route/guard/query/transaction inventory.
- `backend/routes/fulfillment.js` — full COD settlement match/resolve/approve flow and complete route/guard/query inventory.
- `backend/routes/gift-cards-public.js` — complete file; anonymous tenant resolution and balance disclosure.
- `backend/routes/gift-cards.js` — full issue/activate/balance/redeem paths and transaction/locking behavior.
- `backend/routes/grn.js` — full scan-receive and supplier payment/void paths, plus complete route/guard/query inventory.
- `backend/routes/holds.js` — complete route/guard/query/transaction inventory.
- `backend/routes/insights.js` — complete route/query inventory.
- `backend/routes/insights-ai.js` — complete file; feature check, tenant-keyed in-memory quota, analytics context and Anthropic call.
- `backend/routes/inventory.js` — complete route/guard/query/transaction inventory.
- `backend/routes/inventory-intelligence.js` — complete route/feature/permission/query/transaction inventory.
- `backend/routes/item-suggestions.js` — complete route/guard/query inventory.
- `backend/routes/kds.js` — complete route/mode/feature/permission/validation/query inventory.
- `backend/routes/loyalty.js` — complete route/feature/permission/query/transaction inventory.
- `backend/routes/manufacturer-partners.js` — complete route/feature/permission/validation/query/transaction inventory.
- `backend/routes/marketing.js` — complete route/feature/permission/validation/query inventory.
- `backend/routes/messaging.js` — complete route/feature/permission/validation/query/external-send inventory.
- `backend/routes/modifiers.js` — complete route/mode/feature/permission/validation/query inventory.

Supporting counterevidence inspected: `backend/middleware/tenant-auth.js` (JWT identity bridge, public tenant allowlist, kiosk exemption), `backend/middleware/permissions.js` (global fallback rules), `backend/routes/registerAllRoutes.js` (mount order/outlet enforcement), `backend/schema-pg.sql` (attendance constraints/indexes), and targeted integration-test declarations.

## New source-backed findings

Findings are being finalized below; none duplicate BE-001 through BE-009.

