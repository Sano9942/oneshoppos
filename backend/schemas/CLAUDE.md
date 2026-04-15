# Zod Schemas — Claude Guide

- **28 files** — all use Zod. One file per domain. Imported by routes via `validate(Schema)` middleware
- **Pattern**: Required fields strict, optional fields use `.passthrough()` to preserve extra DB columns
- **Export naming**: all schemas PascalCase *except* `integrations.js` and `customer-portal.js` (both use camelCase exports)

---

## Core domain schemas

### `auth.js`
Exports: `LoginSchema`, `MtLoginSchema`, `KioskLoginSchema`, `ForgotPasswordSchema`, `ResetPasswordSchema`, `SignupSchema`

- `LoginSchema` / `MtLoginSchema` — both accept `password` OR `pin` via `.refine()` (one required, error thrown if neither)
- `MtLoginSchema` adds `tenant_slug` (required)
- `KioskLoginSchema` — `pin` + `tenant_slug` both required (always MT)
- `ResetPasswordSchema` — `token` + `new_password` (min 8 chars) + optional `store_code`
- `SignupSchema` — `store_name`, `owner_name`, `email`, `password` (min 8); `plan` optional

### `employees.js`
Exports: `ValidatePinSchema`, `CreateEmployeeSchema`, `SetPasswordSchema`, `ChangePasswordSchema`, `ChangePinSchema`

- `CreateEmployeeSchema` — `pin_code` regex: `^\d{4,10}$` (4–10 digits only)
- `ChangePasswordSchema` — `new_password` (min 8) + requires `current_password` OR `pin` via `.refine()`
- `ChangePinSchema` — `current_pin` (any string) + `new_pin` (regex: `^\d{4,10}$`)
- `ValidatePinSchema` — just `pin_code: string`

### `sales.js`
Exports: `CreateSaleSchema`, `VoidSaleSchema`

- `CartItemSchema` — `id` (not `product_id`), `price` (not `unit_price`), `quantity` — mirrors frontend cart shape
- `CreateSaleSchema` — `cartItems: CartItemSchema[]` (min 1) + `outlet_id`; `.passthrough()` preserves `paymentMethod`, `payments`, `employee_id`, `customer_id`, `shift_id`, `discount_amount`
- `VoidSaleSchema` — `void_reason: string` (required) — used by `PUT /api/sales/:id/void`

### `products.js`
Exports: `CreateProductSchema`, `BulkDeleteSchema`, `BulkStatusSchema`

- `CreateProductSchema` — `name` + `price` (positive); all other fields passthrough
- `BulkDeleteSchema` / `BulkStatusSchema` — `ids: number[]` (min 1); `BulkStatusSchema` adds `status: "active" | "inactive"`

### `returns.js`
Exports: `CreateReturnSchema`

- `ReturnItemSchema` — `product_id`, `quantity`, `refund_price` (passthrough preserves `variant_id`, `name`)
- `CreateReturnSchema` — `outlet_id`, `total_refund`, `refund_method` (required); `items: ReturnItemSchema[]` (min 1); `original_sale_id`, `employee_id`, `customer_id`, `reason` via passthrough

### `customers.js`
Exports: `CreateCustomerSchema`, `UpdateCustomerSchema`

- Both require `name`; all else (`mobile`, `email`, `address`, `cnic`, `ntn_cnic`) via passthrough

### `inventory.js`
Exports: `CreateTransferSchema`, `CreateAdjustmentSchema`

- `CreateTransferSchema` — `product_id`, `from_outlet_id`, `to_outlet_id`, `quantity` (positive, not int — allows decimals)
- `CreateAdjustmentSchema` — `product_id`, `outlet_id`, `quantity_change` (any number, can be negative), `reason` (required)
- Both are **single-record** (not array) — only one transfer/adjustment per request

### `purchase-orders.js`
Exports: `CreatePOSchema`

- `POItemSchema` — `product_id`, `quantity` (int), `cost_price`
- `CreatePOSchema` — `supplier_id` + `items: POItemSchema[]` (min 1); `total_cost`, `due_date`, `outlet_id` via passthrough

### `orders.js`
Exports: `BulkUpdateOrdersSchema`, `MarkCompleteSchema`, `ORDER_STATUSES`, `PAYMENT_STATUSES`, `FULFILLMENT_STATUSES`

- `BulkUpdateOrdersSchema` — `ids` (1–100 max), at least one of `order_status | payment_status | fulfillment_status` required via `.refine()`
- `MarkCompleteSchema` — `ids` (1–100 max) + optional `set_paid: boolean` — marks orders complete, optionally flipping payment status
- `ORDER_STATUSES`: `["open", "closed", "cancelled", "on_hold"]`
- `PAYMENT_STATUSES`: `["pending", "authorized", "paid", "failed"]`
- `FULFILLMENT_STATUSES`: `["unfulfilled", "partial", "fulfilled", "restocked"]`

### `billing.js`
Exports: `RequestUpgradeSchema`, `CreateCheckoutSchema`

- `RequestUpgradeSchema` — `plan: "pro"` (only Pro), `cycle` enum, optional `message`
- `CreateCheckoutSchema` — `cycle` enum, defaults to `"monthly"`
- Cycle enum (both schemas): `"monthly" | "quarterly" | "semi_annual" | "annual"`

### `admin.js`
Exports: `CreateTenantSchema`, `UpdateTenantSchema`, `CreateAnnouncementSchema`, `UpdateAnnouncementSchema`, `CreateTaxRateSchema`, `UpdateTaxRateSchema`

- `CreateTenantSchema` — `slug` (min 3), `name`, `pin` — pin uses `z.union([z.string(), z.number()]).transform(String)` (accepts both types, coerces to string)
- `UpdateTenantSchema` — fully passthrough, validation done in handler
- `CreateTaxRateSchema` — `hs_code` + `description_en` required; province tax rates via passthrough
- Update schemas are fully passthrough (no required fields)

### `integrations.js`
Exports: `connectProviderSchema`, `disconnectProviderSchema` *(lowercase, unlike all other schema files)*

- `connectProviderSchema` — `provider` (required); optional `category`, `store_url`, `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token`, `config_json`
- `category` enum: `"marketplace" | "social" | "messaging" | "feeds" | "payment" | "sms"`
- `disconnectProviderSchema` — just `provider: string`

---

## scheduled-changes.js (anti-injection schema)
Exports: `createScheduledChangeSchema`, `updateScheduledChangeSchema`, `PRODUCT_FIELDS`, `VARIANT_FIELDS`

- `PRODUCT_FIELDS` (10): `price`, `cost_price`, `compare_at_price`, `stock`, `status`, `min_qty`, `max_qty`, `tags`, `vendor`, `product_type`
- `VARIANT_FIELDS` (6): `price`, `cost_price`, `compare_at_price`, `stock`, `barcode`, `weight`
- `CHANGE_TYPES` (4, not exported): `["price", "visibility", "status", "tax"]` — **must match DB CHECK constraint** on `scheduled_catalog_changes.change_type` (see `schema-pg.sql:~2124`). Adding a value here without a migration causes 500 on INSERT.
- `new_value` — union of `string | number | boolean`, always `.transform()`ed to `String` before storage
- `scheduled_at` — ISO datetime + `.refine()` that it's in the future
- **Cross-field injection guard**: uses `.superRefine()` (not `.refine()`) — Zod 4 dropped function-form second arg to `refine()`. Rejects any `field_name` not in the allowlist for the given `entity_type`, preventing SQL injection in the catalog worker's UPDATE string interpolation.
- `updateScheduledChangeSchema` — all fields optional; `status` can only be set to `"cancelled"` (no other status transitions via API)

---

## Wave-16 / Tier-4 domain schemas

### `bookings.js` (Phase 4 appointments)
Exports: `createServiceSchema`, `updateServiceSchema`, `createAppointmentSchema`, `rescheduleSchema`, `cancelSchema`, `availabilityQuerySchema`, `publicBookingSchema`

- `createServiceSchema` — `duration_minutes` (int, positive), `padding_minutes` (min 0, default 0), `price` (min 0, default 0), `requires_confirmation` (bool, default false), `max_advance_days` (default 90), optional `staff_ids: number[]`
- `availabilityQuerySchema` — IDs are **strings** (query param shape, not body) — caller coerces from `req.query`
- `publicBookingSchema` — no-auth endpoint schema; `customer_name` + `customer_phone` required (vs. optional in `createAppointmentSchema`)
- `cancelSchema` — optional `reason` only

### `commissions.js` (Phase 2)
Exports: `createPlanSchema`, `updatePlanSchema`

- `ruleSchema` (nested) — `scope_type: "all" | "category" | "product" | "brand"`, `rate` (0–100), optional `min_threshold` (default 0), optional `max_cap`, `priority` (default 0)
- `createPlanSchema` — `type: "percentage" | "fixed_per_sale" | "fixed_per_item" | "tiered"`, rules: 1–50 max, optional `starts_at`/`ends_at` (ISO datetime)
- `updatePlanSchema` — `createPlanSchema.partial()` + `is_active` boolean

### `contracts.js` (Phase 4)
Exports: `createContractSchema`, `updateContractSchema`, `createTemplateSchema`, `signContractSchema`

- `createContractSchema` — `title` required; optional `project_id`, `customer_id`, `template_id`, `body_html`, `expires_at`, `signers[]` (each: `name`, optional `email`, `role` default `"signer"`)
- `updateContractSchema` — `status` enum: `"draft" | "sent" | "viewed" | "signed" | "countersigned" | "expired" | "cancelled"`
- `signContractSchema` — `signer_id: number` + `signature_data: string` (captures e-signature)

### `customer-invoices.js` (Phase 4 / Wave-16)
Exports: `createInvoiceSchema`, `batchInvoiceSchema`, `recordPaymentSchema`

- `invoiceItemSchema` (nested) — `description`, `quantity`, `unit_price` (min 0), `tax_rate` (default 0), optional `product_id`/`variant_id`
- `reminderRuleSchema` (nested) — `reminder_type: "before_due" | "on_due" | "after_due"`, `days_offset` (int, min 0), `channel: "email" | "sms"` (default `"email"`)
- `createInvoiceSchema` — `customer_id` + `items[]` (min 1); optional `due_date`, `discount_amount` (default 0), `reminders: reminderRuleSchema[]`
- **`batchInvoiceSchema`** — `customer_ids: number[]` (min 1) + same `items[]` — creates identical invoice for multiple customers at once
- `recordPaymentSchema` — `amount` (positive), `payment_method`, `payment_type: "payment" | "deposit" | "refund"` (default `"payment"`), optional `reference`/`notes`

### `marketing.js` (Phase 4 / Wave-16)
Exports: `createTemplateSchema`, `createCampaignSchema`, `scheduleCampaignSchema`

- `createTemplateSchema` — `channel: "email" | "sms"` (default `"email"`), optional `subject`, `body_html`, `body_text`
- `createCampaignSchema` — optional `audience_filters: [{ filter_type: string, filter_value: string }][]`
- `scheduleCampaignSchema` — just `scheduled_at: string` (used in separate schedule endpoint)

### `messaging.js` (Phase 4)
Exports: `sendMessageSchema`, `updateThreadSchema`

- `sendMessageSchema` — `content: string` + `message_type: "text" | "image" | "document" | "template"` (default `"text"`)
- `updateThreadSchema` — `status: "open" | "closed" | "snoozed"` + optional `assigned_to` (nullable int)

### `projects.js` (Phase 4)
Exports: `createProjectSchema`, `updateProjectSchema`, `createMilestoneSchema`, `updateMilestoneSchema`

- `updateProjectSchema` — `status: "draft" | "active" | "on_hold" | "completed" | "cancelled"`
- `createMilestoneSchema` — `invoice_on_completion: boolean` (default false) — triggers auto-invoice when milestone marked complete
- `updateMilestoneSchema` — milestone `status: "pending" | "in_progress" | "completed" | "skipped"`

### `restaurant.js` (Phase 4)
Exports: `createFloorPlanSchema`, `updateFloorPlanSchema`, `createTableSchema`, `updateTableSchema`, `createSessionSchema`, `createCheckSchema`, `splitCheckSchema`, `fireCourseSchema`, `createTabSchema`, `createKdsStationSchema`, `updateKdsStationSchema`

- `createTableSchema` — `shape: "square" | "round" | "rectangle"` (default `"square"`), `capacity` (default 4)
- `createCheckSchema` — `order_context: "dine_in" | "takeout" | "delivery" | "bar"` (default `"dine_in"`); accepts either `table_session_id` OR `tab_id`
- `splitCheckSchema` — `split_type: "by_item" | "by_seat" | "equal"`; by_item requires `item_assignments[]` with `target_check_index`
- `fireCourseSchema` — just `course_name: string` (fires a named course to KDS)
- `createTabSchema` — `outlet_id` + optional `customer_id`/`customer_name` (bar tab)
- `createKdsStationSchema` / `updateKdsStationSchema` — `station_role: "prep" | "expo"` (default `"prep"`)

### `smart-collections.js` (Phase 2)
Exports: `createCollectionSchema`, `updateCollectionSchema`, `ruleSchema`

- `ruleSchema` (also exported standalone for workers) — `field: "category_id" | "brand_id" | "product_type" | "vendor" | "tags" | "price" | "stock" | "status"`, `operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "starts_with" | "in"`, `value: string`
- `createCollectionSchema` — `rules: ruleSchema[]` (1–20 max), `disjunctive: boolean` (default false — AND logic; true = OR), `sort_order: "manual" | "name_asc" | "name_desc" | "price_asc" | "price_desc" | "created_at_desc"` (default `"manual"`)
- `updateCollectionSchema` — `createCollectionSchema.partial()` + `is_active: boolean`

### `subscriptions.js` (Wave-16 customer subscription billing)
Exports: `createPlanSchema`, `updatePlanSchema`, `createSubscriptionSchema`

- `createPlanSchema` — `price` (positive), `billing_interval: "monthly" | "quarterly" | "yearly"` (default `"monthly"`), `billing_interval_count` (default 1), `trial_days` (min 0, default 0)
- `updatePlanSchema` — partial update; `is_active` boolean
- `createSubscriptionSchema` — `plan_id` + `customer_id` + `auto_charge: boolean` (default false — manual renewal by default)

### `customer-portal.js` (M8 customer portal)
Exports (all camelCase): `loginSchema`, `signupSchema`, `requestOtpSchema`, `verifyOtpSchema`, `requestPasswordResetSchema`, `resetPasswordSchema`, `verifyEmailSchema`, `updateProfileSchema`, `addressSchema`, `bookAppointmentSchema`, `rescheduleAppointmentSchema`, `cancelAppointmentSchema`

- OTP codes are 6-digit strings
- `resetPasswordSchema` — `new_password` min 8, max 128
- `bookAppointmentSchema` — customer self-service booking; `service_id` required, `start_time` ISO datetime

### `rentals.js` (M7 rentals mode)
Exports: `createRentalItemSchema`, `updateRentalItemSchema`, `createRentalAssetSchema`, `updateRentalAssetSchema`, `contractLineSchema`, `createContractSchema`, `updateContractSchema`, `checkoutSchema`, `returnSchema`, `cancelSchema`, `noteSchema`, `availabilityQuerySchema`

- Constants: `PAYMENT_POLICIES` (`["upfront","on_return"]`), `RATE_TYPES` (`["hourly","daily","weekly"]`), `ASSET_STATUSES` (`["available","rented","maintenance","retired"]`), `CONTRACT_STATUSES` (7 values: draft, confirmed, checked_out, returned, completed, cancelled, overdue)
- `updateContractSchema` is `.strict()`
- `createContractSchema` — `customer_id` + `lines: contractLineSchema[]` (min 1), optional `deposit_amount`, `payment_policy`

### `rooms.js` (M9 room management)
Exports: `createRoomTypeSchema`, `updateRoomTypeSchema`, `createRateOverrideSchema`, `updateRateOverrideSchema`, `createRoomSchema`, `updateRoomSchema`, `housekeepingSchema`, `createBookingSchema`, `updateBookingSchema`, `cancelBookingSchema`, `checkInSchema`, `checkOutSchema`, `addFolioLineSchema`, `attachSaleSchema`, `settleFolioSchema`, `depositPreAuthSchema`

- Constants: `OCCUPANCY_STATUSES`, `HOUSEKEEPING_STATUSES`, `BOOKING_STATUSES`, `FOLIO_LINE_TYPES`, `DEPOSIT_STATUSES`
- `createRateOverrideSchema` has `.refine()` that `from_date <= to_date`
- `createBookingSchema` requires `check_out_date > check_in_date`
- `updateBookingSchema` is `.strict()`

### `service-tickets.js` (phase4_workflow_tickets)
Exports: `createTicketSchema`, `updateTicketSchema`, `addNoteSchema`

- `STATUSES` (also exported): `["intake","approved","in_progress","on_hold","completed","invoiced","cancelled"]`
- `updateTicketSchema` is `.strict()`

### `treatment-plans.js` (M10 clinical)
Exports: `createPatientSubjectSchema`, `updatePatientSubjectSchema`, `createPlanSchema`, `updatePlanSchema`, `planStatusTransitionSchema`, `planNoteSchema`, `createSessionSchema`, `updateSessionSchema`, `completeSessionSchema`, `addChartEntrySchema`, `updateChartEntrySchema`, `createLabOrderSchema`, `updateLabOrderSchema`, `recordLabResultSchema`, `signConsentSchema`, `uploadClinicalDocumentSchema`, `createPrescriptionSchema`, `addFolioLineSchema`, `attachSaleToFolioSchema`, `settleFolioSchema`

- Constants: `SUBJECT_TYPES`, `PLAN_STATUSES`, `SESSION_STATUSES`, `CONDITION_CODES` (12 values), `SEVERITY_LEVELS`, `LAB_STATUSES`, `CONSENT_RELATIONS`, `DOCUMENT_TYPES`, `FOLIO_LINE_TYPES`
- Most complex schema file — covers dental/vet/physio clinical suite: SOAP notes, vitals, prescriptions, chart entries, lab orders, consent, documents, folio management

---

## Adding a schema
Create `schemas/<domain>.js`, export named schemas, import in route via `validate(Schema)`. Use `.passthrough()` on body schemas so DB-level columns not validated here are preserved. Cross-field constraints: use `.superRefine()` not `.refine()` when you need to emit a custom error with dynamic field-path targeting.
