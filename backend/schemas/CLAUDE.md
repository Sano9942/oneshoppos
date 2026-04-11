# Zod Schemas — Claude Guide

- **23 files** — all use Zod. One file per domain. Imported by routes via `validate(Schema)` middleware
- **Pattern**: Required fields strict, optional fields use `.passthrough()` to preserve extra DB columns
- **`auth.js`** — `LoginSchema`, `MtLoginSchema` (both accept password OR pin via `.refine()`), `KioskLoginSchema`, `ForgotPasswordSchema`, `ResetPasswordSchema`, `SignupSchema`
- **`sales.js`** — `CreateSaleSchema` with nested `CartItemSchema`. Items use `id` (not `product_id`) and `price` (not `unit_price`) — mirrors frontend cart shape
- **`employees.js`** — `CreateEmployeeSchema` (PIN regex: `^\d{4,10}$`), `ChangePasswordSchema` (requires `current_password` OR `pin`), `ValidatePinSchema`, `SetPasswordSchema`, `ChangePinSchema`
- **`orders.js`** — `BulkUpdateOrdersSchema` (caps at 100 IDs), exports `ORDER_STATUSES`, `PAYMENT_STATUSES`, `FULFILLMENT_STATUSES` constants
- **`products.js`** — `CreateProductSchema`, `BulkDeleteSchema`, `BulkStatusSchema`
- **`returns.js`** — `CreateReturnSchema` with nested `ReturnItemSchema`
- **`purchase-orders.js`** — `CreatePOSchema` with nested `POItemSchema`
- **`customers.js`**, **`inventory.js`**, **`billing.js`**, **`admin.js`** — standard CRUD schemas
- **`integrations.js`** — Zod schemas for integration credential connect/disconnect requests
- **`scheduled-changes.js`** — `createScheduledChangeSchema`, `updateScheduledChangeSchema`. Field-name allowlist for catalog scheduler: `PRODUCT_FIELDS` (10 items) and `VARIANT_FIELDS` (6 items) exported as plain arrays so `services/catalog-scheduler.js` can reuse them. Cross-field `.refine()` rejects `field_name` not in the allowlist for the given `entity_type` — prevents SQL injection in the worker's UPDATE string interpolation
- **Adding a schema**: Create `schemas/<domain>.js`, export named schemas, use in route via `validate(Schema)`
