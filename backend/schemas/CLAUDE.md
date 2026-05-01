# Zod Schemas — Claude Guide

All files use Zod. One file per domain. Imported by routes via `validate(Schema)` middleware (`middleware/validate.js`).

**Pattern**: Required fields strict, optional/passthrough fields use `.passthrough()` to preserve extra DB columns the route writes directly. Update schemas use `.strict()` where drift protection is needed. Cross-field constraints use `.superRefine()` (not `.refine()`) when the error message must include a dynamic path.

**Export naming**: PascalCase for core domain schemas (sales, auth, employees, etc.). camelCase for `integrations.js` and `customer-portal.js`.

---

## Core transaction schemas

### `auth.js`
Routes: `routes/auth.js`
Exports: `LoginSchema`, `MtLoginSchema`, `KioskLoginSchema`, `ForgotPasswordSchema`, `ResetPasswordSchema`, `SignupSchema`

- `LoginSchema` — `username` (required) + `password` OR `pin` (at least one required via `.refine()`); `outlet_id` coerced int optional
- `MtLoginSchema` — same as `LoginSchema` + `tenant_slug` (required); used by `POST /api/auth/mt-login`
- `KioskLoginSchema` — `pin` + `tenant_slug` both required; always MT mode
- `ForgotPasswordSchema` — just `username`
- `ResetPasswordSchema` — `token` + `new_password` (min 8) + optional `store_code`
- `SignupSchema` — `store_name`, `owner_name`, `email` (validated), `password` (min 8); gated by `SELF_SERVICE_SIGNUP=1` env var

### `sales.js`
Routes: `routes/sales.js`
Exports: `CartItemSchema`, `PriceOverrideSchema`, `PaymentLineSchema`, `CreateSaleSchema`, `VoidSaleSchema`

- `CartItemSchema` — `id` (not `product_id`), `price` (not `unit_price`), `quantity` (decimal allowed for weight/length items); optional `price_override: PriceOverrideSchema`
- `PriceOverrideSchema` — `original_price` (nonnegative), optional `reason_id` + `approval_event_id`; `approval_event_id` is mandatory when cashier lacks `override_price` perm (validated in route, not here)
- `PaymentLineSchema` — `method` (free-form string, max 100), `amount` (min 0), optional `reference` (max 500) + `change`; passthrough preserves denomination breakdown and gateway blobs
- `CreateSaleSchema` — `cartItems: CartItemSchema[]` (min 1) + `outlet_id`; `payments: PaymentLineSchema[]` optional; passthrough preserves `employee_id`, `customer_id`, `shift_id`, `discount_amount`, `staff_id`, `room_id`, `plan_id`
- `VoidSaleSchema` — `void_reason` required; used by `PUT /api/sales/:id/void`

### `returns.js`
Routes: `routes/returns.js`
Exports: `CreateReturnSchema`

- `ReturnItemSchema` (internal) — `product_id`, `quantity` (int), `refund_price`; optional `serials: number[]` (serial IDs returned), `warranty_claim: boolean` (routes serial to warranty status), `restock_flag: boolean`, `reason_code_id`; passthrough preserves `variant_id`, `name`
- `CreateReturnSchema` — `outlet_id`, `total_refund`, `refund_method` (required); `items: ReturnItemSchema[]` (min 1); `original_sale_id`, `employee_id`, `customer_id`, `reason` via passthrough

### `inventory.js`
Routes: `routes/inventory.js` (`/api/transfers`, `/api/adjustments`)
Exports: `CreateTransferSchema`, `CreateAdjustmentSchema`

- Both are single-record bodies (not arrays — one operation per request)
- `CreateTransferSchema` — `product_id`, `from_outlet_id`, `to_outlet_id`, `quantity` (positive, allows decimals); optional `variant_id` (routes through `variant_outlet_stock`)
- `CreateAdjustmentSchema` — `product_id`, `outlet_id`, `quantity_change` (any number, negative = shrink), `reason` (required); optional `variant_id`

### `products.js`
Routes: `routes/products.js`
Exports: `CreateProductSchema`, `BulkDeleteSchema`, `BulkStatusSchema`

- `CreateProductSchema` — `name` + `price` (positive); all other fields passthrough
- `BulkDeleteSchema` — `ids: number[]` (min 1)
- `BulkStatusSchema` — `ids: number[]` (min 1) + `status: "active" | "inactive"`

### `customers.js`
Routes: `routes/customers.js`
Exports: `CreateCustomerSchema`, `UpdateCustomerSchema`

- Both require `name`; all else (`mobile`, `email`, `address`, `cnic`, `ntn_cnic`) via passthrough

### `employees.js`
Routes: `routes/employees.js`
Exports: `ValidatePinSchema`, `CreateEmployeeSchema`, `SetPasswordSchema`, `ChangePasswordSchema`, `ChangePinSchema`

- `CreateEmployeeSchema` — `name`, `pin_code` (regex `^\d{4,10}$`), `role_id` (int, positive)
- `ValidatePinSchema` — just `pin_code`; used by `POST /api/employees/validate-pin` (POS session re-auth)
- `SetPasswordSchema` — `password` (min 8); admin-only set
- `ChangePasswordSchema` — `new_password` (min 8) + `current_password` OR `pin` required via `.refine()`; self-service
- `ChangePinSchema` — `current_pin` + `new_pin` (regex `^\d{4,10}$`)

### `purchase-orders.js`
Routes: `routes/purchase-orders.js`
Exports: `CreatePOSchema`

- `POItemSchema` (internal) — `product_id`, `quantity` (int), `cost_price`
- `CreatePOSchema` — `supplier_id` + `items: POItemSchema[]` (min 1); `total_cost`, `due_date`, `outlet_id` via passthrough

### `orders.js`
Routes: `routes/orders.js` (web/Shopify orders)
Exports: `BulkUpdateOrdersSchema`, `MarkCompleteSchema`, `ORDER_STATUSES`, `PAYMENT_STATUSES`, `FULFILLMENT_STATUSES`

- `BulkUpdateOrdersSchema` — `ids: number[]` (1–100 max) + at least one of `order_status | payment_status | fulfillment_status` via `.refine()`; all status fields are `.nullish()`
- `MarkCompleteSchema` — `ids: number[]` (1–100 max) + optional `set_paid: boolean`
- `ORDER_STATUSES`: `["open", "closed", "cancelled", "on_hold"]`
- `PAYMENT_STATUSES`: `["pending", "authorized", "paid", "failed"]`
- `FULFILLMENT_STATUSES`: `["unfulfilled", "partial", "fulfilled", "restocked"]`

---

## Billing & admin schemas

### `billing.js`
Routes: `routes/billing.js`
Exports: `RequestUpgradeSchema`, `CreateCheckoutSchema`

- `RequestUpgradeSchema` — `plan: "pro"` (only value) + `cycle` enum + optional `message`
- `CreateCheckoutSchema` — `cycle` enum only, defaults to `"monthly"`
- Cycle enum (both): `"monthly" | "quarterly" | "semi_annual" | "annual"`

### `admin.js`
Routes: `routes/admin/` (tenants, announcements, compliance)
Exports: `CreateTenantSchema`, `UpdateTenantSchema`, `CreateAnnouncementSchema`, `UpdateAnnouncementSchema`, `CreateTaxRateSchema`, `UpdateTaxRateSchema`

- `CreateTenantSchema` — `slug` (min 3), `name`, `pin` — pin uses `z.union([z.string(), z.number()]).transform(String)` (accepts numeric PIN from admin UI, coerces to string)
- `UpdateTenantSchema` — fully passthrough; validation in handler
- `CreateAnnouncementSchema` — `message` required; `type`, `ends_at` via passthrough
- `CreateTaxRateSchema` — `hs_code` + `description_en` required; province tax rates (`punjab_pra`, `sindh_srb`, etc.) via passthrough
- Update variants (`UpdateTenantSchema`, `UpdateAnnouncementSchema`, `UpdateTaxRateSchema`) are empty objects with `.passthrough()` — all fields optional

### `integrations.js`
Routes: `routes/integrations/credentials.js`
Exports: `connectProviderSchema`, `disconnectProviderSchema` *(camelCase — unlike all other schema files)*

- `connectProviderSchema` — `provider` required; optional `category` enum (`"marketplace" | "social" | "messaging" | "feeds" | "payment" | "sms"`), `store_url` (validated URL), `api_key`, `api_secret`, `oauth_token`, `oauth_refresh_token`, `config_json`
- `disconnectProviderSchema` — just `provider: string`

---

## Scheduled changes (injection-guard schema)

### `scheduled-changes.js`
Routes: `routes/scheduled-changes.js`
Exports: `createScheduledChangeSchema`, `updateScheduledChangeSchema`, `PRODUCT_FIELDS`, `VARIANT_FIELDS`

- `PRODUCT_FIELDS` (10): `price`, `cost_price`, `compare_at_price`, `stock`, `status`, `min_qty`, `max_qty`, `tags`, `vendor`, `product_type`
- `VARIANT_FIELDS` (6): `price`, `cost_price`, `compare_at_price`, `stock`, `barcode`, `weight`
- `CHANGE_TYPES` (internal, not exported): `["price", "visibility", "status", "tax"]` — must match DB `CHECK` constraint on `scheduled_catalog_changes.change_type` (schema-pg.sql ~line 2124); adding a value here without a migration causes 500 on INSERT
- `new_value` — `z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v))` — always stored as string
- `scheduled_at` — ISO datetime + `.refine()` that value is in the future
- **Injection guard**: `.superRefine()` rejects any `field_name` not in the allowlist for the given `entity_type` — prevents SQL injection in the catalog worker's UPDATE string interpolation. Uses `superRefine` (not `refine`) so the error path includes the rejected field name
- `updateScheduledChangeSchema` — all fields optional; `status` can only be set to `"cancelled"` (no other transitions via API)

---

## Smart collections & commissions (Phase 2)

### `smart-collections.js`
Routes: `routes/smart-collections.js`
Exports: `createCollectionSchema`, `updateCollectionSchema`, `ruleSchema`

- `ruleSchema` (also exported standalone — used by worker) — `field: "category_id" | "brand_id" | "product_type" | "vendor" | "tags" | "price" | "stock" | "status"`, `operator: "equals" | "not_equals" | "greater_than" | "less_than" | "contains" | "starts_with" | "in"`, `value: string`
- `createCollectionSchema` — `rules: ruleSchema[]` (1–20 max), `disjunctive: boolean` (default false = AND; true = OR), `sort_order` enum (default `"manual"`)
- `updateCollectionSchema` — `createCollectionSchema.partial()` extended with `is_active: boolean`

### `commissions.js`
Routes: `routes/commissions.js`
Exports: `createPlanSchema`, `updatePlanSchema`

- `ruleSchema` (internal) — `scope_type: "all" | "category" | "product" | "brand"` (default `"all"`), `scope_id` (nullable int), `rate` (0–100), `min_threshold` (default 0), `max_cap` (nullable), `priority` (default 0)
- `createPlanSchema` — `name` (max 200), `type: "percentage" | "fixed_per_sale" | "fixed_per_item" | "tiered"` (default `"percentage"`), `rules: ruleSchema[]` (1–50 max), optional `starts_at`/`ends_at` (ISO datetime)
- `updatePlanSchema` — `createPlanSchema.partial()` extended with `is_active: boolean`

---

## Appointments & bookings (Phase 4)

### `bookings.js`
Routes: `routes/bookings.js`
Exports: `createServiceSchema`, `updateServiceSchema`, `createAppointmentSchema`, `rescheduleSchema`, `cancelSchema`, `availabilityQuerySchema`, `publicBookingSchema`

- `createServiceSchema` — `name`, `duration_minutes` (int positive), `padding_minutes` (min 0, default 0), `price` (min 0, default 0), `requires_confirmation` (default false), `max_advance_days` (default 90), optional `staff_ids: number[]`
- `availabilityQuerySchema` — all fields are **strings** (query-param shape from `req.query`; caller coerces): `service_id`, `date` required; `employee_id`, `outlet_id` optional
- `publicBookingSchema` — no-auth endpoint: `customer_name` + `customer_phone` required (both optional in `createAppointmentSchema`)
- `rescheduleSchema` — `start_at` required + optional `employee_id`
- `cancelSchema` — optional `reason` only

---

## Customer-facing CRM schemas

### `contracts.js`
Routes: `routes/contracts.js`
Exports: `createContractSchema`, `updateContractSchema`, `createTemplateSchema`, `signContractSchema`

- `createContractSchema` — `title` required; optional `project_id`, `customer_id`, `template_id`, `body_html`, `expires_at`, `signers[]` (each: `name`, optional `email`, `role` default `"signer"`)
- `updateContractSchema` — `status: "draft" | "sent" | "viewed" | "signed" | "countersigned" | "expired" | "cancelled"` optional + title/body/expires
- `signContractSchema` — `signer_id: number` + `signature_data: string` (captures e-signature)

### `customer-invoices.js`
Routes: `routes/customer-invoices.js`
Exports: `createInvoiceSchema`, `batchInvoiceSchema`, `recordPaymentSchema`

- `invoiceItemSchema` (internal) — `description`, `quantity` (positive), `unit_price` (min 0), `tax_rate` (default 0), optional `product_id`/`variant_id`
- `reminderRuleSchema` (internal) — `reminder_type: "before_due" | "on_due" | "after_due"`, `days_offset` (int, min 0), `channel: "email" | "sms"` (default `"email"`)
- `createInvoiceSchema` — `customer_id` + `items[]` (min 1); optional `due_date`, `discount_amount` (default 0), `reminders[]`
- `batchInvoiceSchema` — `customer_ids: number[]` (min 1) + same `items[]` — creates identical invoice for multiple customers at once; no `reminders` field
- `recordPaymentSchema` — `amount` (positive), `payment_method`, `payment_type: "payment" | "deposit" | "refund"` (default `"payment"`)

### `subscriptions.js`
Routes: `routes/subscriptions.js` (customer subscription billing)
Exports: `createPlanSchema`, `updatePlanSchema`, `createSubscriptionSchema`, `cancelSubscriptionSchema`

- `createPlanSchema` — `name`, `price` (positive), `billing_interval: "monthly" | "quarterly" | "yearly"` (default `"monthly"`), `billing_interval_count` (default 1), `trial_days` (min 0, default 0)
- `updatePlanSchema` — name/description/price optional + `is_active: boolean`
- `createSubscriptionSchema` — `plan_id` + `customer_id` + `auto_charge: boolean` (default false — manual renewal by default)
- `cancelSubscriptionSchema` — optional `cancel_reason` (max 500)

### `messaging.js`
Routes: `routes/messaging.js`
Exports: `sendMessageSchema`, `updateThreadSchema`

- `sendMessageSchema` — `content: string` + `message_type: "text" | "image" | "document" | "template"` (default `"text"`)
- `updateThreadSchema` — `status: "open" | "closed" | "snoozed"` optional + `assigned_to` (nullable int)

### `marketing.js`
Routes: `routes/marketing.js`
Exports: `createTemplateSchema`, `createCampaignSchema`, `scheduleCampaignSchema`

- `createTemplateSchema` — `name`, `channel: "email" | "sms"` (default `"email"`), optional `subject`, `body_html`, `body_text`
- `createCampaignSchema` — `name`, `channel`, optional `template_id`, `subject`, `body_html`, `audience_filters: [{ filter_type, filter_value }][]`
- `scheduleCampaignSchema` — just `scheduled_at: string` (used in separate schedule endpoint)

---

## Projects & service operations (Phase 4)

### `projects.js`
Routes: `routes/projects.js`
Exports: `createProjectSchema`, `updateProjectSchema`, `createMilestoneSchema`, `updateMilestoneSchema`

- `updateProjectSchema` — `status: "draft" | "active" | "on_hold" | "completed" | "cancelled"` optional
- `createMilestoneSchema` — `invoice_on_completion: boolean` (default false) — triggers auto-invoice when milestone marked complete; `sort_order` (int, default 0)
- `updateMilestoneSchema` — `status: "pending" | "in_progress" | "completed" | "skipped"` optional

### `service-tickets.js`
Routes: `routes/service-tickets.js`
Exports: `createTicketSchema`, `updateTicketSchema`, `addNoteSchema`, `STATUSES`

- `STATUSES`: `["intake", "approved", "in_progress", "on_hold", "completed", "invoiced", "cancelled"]`
- `createTicketSchema` — `title` (max 300) + optional `customer_id`, `outlet_id`, `assigned_to`, `expected_completion`, `deposit_amount`, `deposit_method` (max 50), `notes`
- `updateTicketSchema` — partial of above fields + `status` enum; uses `.strict()` (no extra keys)
- `addNoteSchema` — just `description` (min 1, max 2000)

---

## Rentals & room management (M7, M9)

### `rentals.js`
Routes: `routes/rentals.js`
Exports: `createRentalItemSchema`, `updateRentalItemSchema`, `createRentalAssetSchema`, `updateRentalAssetSchema`, `contractLineSchema`, `createContractSchema`, `updateContractSchema`, `checkoutSchema`, `returnSchema`, `cancelSchema`, `noteSchema`, `availabilityQuerySchema`, `PAYMENT_POLICIES`, `RATE_TYPES`, `ASSET_STATUSES`, `CONTRACT_STATUSES`

- `PAYMENT_POLICIES`: `["upfront", "on_return"]`
- `RATE_TYPES`: `["hourly", "daily", "weekly"]`
- `ASSET_STATUSES`: `["available", "rented", "maintenance", "retired"]`
- `CONTRACT_STATUSES`: `["reserved", "confirmed", "checked_out", "returned", "completed", "invoiced", "cancelled"]`
- `createRentalItemSchema` — `name` (max 200), `daily_rate` (min 0), optional `hourly_rate`/`weekly_rate`, `deposit_amount` (default 0), `payment_policy` (default `"upfront"`)
- `contractLineSchema` — `rental_item_id`, `quantity` (int, default 1), `rate_type` (default `"daily"`), `duration_value` (min 0.01); optional `rental_asset_id`
- `createContractSchema` — `rental_start` + `expected_return` (both required strings), `lines: contractLineSchema[]` (min 1); optional `deposit_collected`, `payment_policy`
- `updateContractSchema` — uses `.strict()` (only: `customer_id`, `expected_return`, `rental_end`, `notes`, `discount_amount`)
- `returnSchema` — optional `condition_notes`, `late_fee`, `late_fee_override: boolean`
- `availabilityQuerySchema` — `from` + `to` (both required strings)

### `rooms.js`
Routes: `routes/rooms.js`
Exports: `createRoomTypeSchema`, `updateRoomTypeSchema`, `createRateOverrideSchema`, `updateRateOverrideSchema`, `createRoomSchema`, `updateRoomSchema`, `housekeepingSchema`, `createBookingSchema`, `updateBookingSchema`, `cancelBookingSchema`, `checkInSchema`, `checkOutSchema`, `addFolioLineSchema`, `attachSaleSchema`, `settleFolioSchema`, `depositPreAuthSchema`, `OCCUPANCY_STATUSES`, `HOUSEKEEPING_STATUSES`, `BOOKING_STATUSES`, `FOLIO_LINE_TYPES`, `DEPOSIT_STATUSES`

- `BOOKING_STATUSES`: `["reserved", "confirmed", "checked_in", "checked_out", "completed", "invoiced", "cancelled", "no_show"]`
- `FOLIO_LINE_TYPES`: `["room_night", "pos_sale", "manual_charge", "discount", "tax"]`
- `createRateOverrideSchema` — `from_date` + `to_date` (regex `^\d{4}-\d{2}-\d{2}$`) + `rate`; `.refine()` enforces `from_date <= to_date`
- `createBookingSchema` — `room_type_id` required; `check_in_date`/`check_out_date` (YYYY-MM-DD regex); `.refine()` enforces `check_out_date > check_in_date`
- `updateBookingSchema` — uses `.strict()` (only: `customer_id`, `room_id`, `notes`)
- `addFolioLineSchema` — `line_type: "manual_charge" | "discount"` (default `"manual_charge"`), `description`, `quantity` (min 0.001), `unit_price`
- `depositPreAuthSchema` — optional `amount`, `return_url` (URL), `cancel_url` (URL)

---

## Clinical treatment plans (M10)

### `treatment-plans.js`
Routes: `routes/treatment-plans.js`
Exports: `createPatientSubjectSchema`, `updatePatientSubjectSchema`, `createPlanSchema`, `updatePlanSchema`, `planStatusTransitionSchema`, `planNoteSchema`, `createSessionSchema`, `updateSessionSchema`, `completeSessionSchema`, `addChartEntrySchema`, `updateChartEntrySchema`, `createLabOrderSchema`, `updateLabOrderSchema`, `recordLabResultSchema`, `signConsentSchema`, `uploadClinicalDocumentSchema`, `createPrescriptionSchema`, `addFolioLineSchema`, `attachSaleToFolioSchema`, `settleFolioSchema`
Plus constants: `SUBJECT_TYPES`, `PLAN_STATUSES`, `SESSION_STATUSES`, `CONDITION_CODES`, `SEVERITY_LEVELS`, `LAB_STATUSES`, `CONSENT_RELATIONS`, `DOCUMENT_TYPES`, `FOLIO_LINE_TYPES`

- `SUBJECT_TYPES`: `["self", "dependent", "pet"]`
- `PLAN_STATUSES`: `["draft", "active", "on_hold", "completed", "discontinued", "invoiced"]`
- `CONDITION_CODES` (12): dental/vet conditions — `healthy`, `caries`, `restoration`, `extraction`, `crown`, `root_canal`, `missing`, `implant`, `mobility`, `plaque`, `gingivitis`, `custom`
- `CONSENT_RELATIONS`: `["self", "parent", "guardian", "owner", "next_of_kin"]`
- `DOCUMENT_TYPES` (8): `lab_report`, `imaging_xray`, `imaging_ct`, `imaging_mri`, `photo`, `referral_letter`, `discharge_summary`, `other`
- `createPlanSchema` — `customer_id` + `title` required; optional `subject_id`, `provider_id`, `diagnosis_code/notes`, `total_sessions_planned` (min 1, default 1), `estimated_total`, `deposit_collected`
- `updatePlanSchema` — uses `.strict()` (no unknown keys)
- `completeSessionSchema` — SOAP fields (subjective/objective/assessment/plan, each max 5000) + optional `vitals[]` (`vitalSignInputSchema`), `prescriptions[]` (`prescriptionInputSchema`), `chart_entries[]` (`chartEntryInputSchema`) — all captured in one transaction
- `vitalSignInputSchema` (internal) — BP sys/dia, heart rate, respiratory rate, temp, O2 sat, weight, height, `pain_score` (int 0–10), `custom_vitals: z.record(z.any())`
- `signConsentSchema` — `form_template_key`, `title`, `body_markdown`, `signed_by_name`, `signed_by_relation` (enum, default `"self"`), optional `signature_image_base64`, `session_id`, `witnessed_by_id`
- `addFolioLineSchema` — `line_type: "manual_charge" | "discount" | "lab_cost"` (default `"manual_charge"`)

---

## Customer portal (M8)

### `customer-portal.js`
Routes: `routes/customer-portal.js`
Exports (all camelCase): `loginSchema`, `signupSchema`, `requestOtpSchema`, `verifyOtpSchema`, `requestPasswordResetSchema`, `resetPasswordSchema`, `verifyEmailSchema`, `updateProfileSchema`, `addressSchema`, `bookAppointmentSchema`, `rescheduleAppointmentSchema`, `cancelAppointmentSchema`

- Shared primitives (internal): `emailSchema` (trimmed, lowercased, validated), `passwordSchema` (min 8, max 128), `otpCodeSchema` (regex `^\d{6}$`)
- `signupSchema` — `email`, `password`, `name` (trim, max 120), optional `mobile` (max 32)
- `requestOtpSchema` / `verifyOtpSchema` — `purpose: "login" | "email_verify" | "password_reset"` (default `"login"`)
- `resetPasswordSchema` — `token` (min 16, max 256) + `password` (passwordSchema)
- `updateProfileSchema` — `gender: "male" | "female" | "other"` nullable optional; consent booleans (`email_consent`, `sms_consent`, `whatsapp_consent`); `preferred_contact: "email" | "sms" | "whatsapp" | "phone"` nullable
- `addressSchema` — `line1` required (max 200); `label` max 40; standard address fields + `is_default: boolean`
- `bookAppointmentSchema` — `service_id` required; `start_at` required; `employee_id`/`outlet_id` nullable optional

---

## Shifts, attendance & HR

### `shifts.js`
Routes: `routes/shifts.js`
Exports: `OpenShiftSchema`, `CloseShiftSchema`, `VarianceApproveSchema`, `DenominationSchema`

- `DenominationSchema` — `denomination` (coerced positive number), `count` (coerced int, min 0)
- `OpenShiftSchema` — `outlet_id` (int positive), `opening_float` (min 0); optional `employee_id`, `denominations: DenominationSchema[]`
- `CloseShiftSchema` — `closing_cash` (min 0); optional `notes` (max 2000), `variance_reason` (max 500), `variance_approved_by` (max 200), `denominations[]`
- `VarianceApproveSchema` — `approved_by` (min 1, max 200) + optional `approval_note` (max 500)

### `attendance.js`
Routes: `routes/attendance.js` (kiosk PIN attendance)
Exports: `PinStatusSchema`, `PinCheckinSchema`, `PinCheckoutSchema`

- `PinStatusSchema` — `pin_code` (max 20) + optional `outlet_id`
- `PinCheckinSchema` — `pin_code` + `outlet_id` (required here, unlike status) + optional `latitude`/`longitude` (coerced floats)
- `PinCheckoutSchema` — `pin_code` + `break_reason: "lunch" | "prayer" | "bathroom" | "personal" | "other"` nullable optional

---

## Restaurant schemas

### `restaurant.js`
Routes: `routes/restaurant.js`
Exports: `createFloorPlanSchema`, `updateFloorPlanSchema`, `createTableSchema`, `updateTableSchema`, `createSessionSchema`, `createCheckSchema`, `splitCheckSchema`, `mergeChecksSchema`, `fireCourseSchema`, `holdCourseSchema`, `expediteCourseSchema`, `createTabSchema`, `createKdsStationSchema`, `updateKdsStationSchema`, `createKdsRouteSchema`, `updateKdsRouteSchema`

- `createTableSchema` — `floor_plan_id`, `label`, `capacity` (default 4), `shape: "square" | "round" | "rectangle"` (default `"square"`), `pos_x`/`pos_y` (int, default 0)
- `createCheckSchema` — `outlet_id` (required), `order_context: "dine_in" | "takeout" | "delivery" | "bar" | "drive_thru"` (default `"dine_in"`), optional `dining_option`, `seat_count`; accepts either `table_session_id` OR `tab_id`
- `splitCheckSchema` — `split_type: "by_item" | "by_seat" | "equal" | "by_amount" | "evenly"`; uses `.superRefine()`: `parts` required when split_type is by_amount/evenly/equal; `item_assignments[]` required when by_item
- `mergeChecksSchema` — `target_id` + `source_ids: number[]` (min 1)
- `holdCourseSchema` — `course_name` + `hold_until: string.datetime()`
- `createKdsStationSchema` — `outlet_id`, `name`, `station_role: "prep" | "expo"` (default `"prep"`), optional `printer_id`
- `updateKdsStationSchema` — adds `balance_strategy: "priority" | "round_robin" | "least_loaded"` + `target_prep_seconds` (int positive nullable)
- `createKdsRouteSchema` — `outlet_id`, `station_id`, `priority`; uses `.superRefine()` to enforce exactly one of `product_id | modifier_group_id | category_id | match_all` is set; optional `station_role_filter: "prep" | "expo"`

### `modifiers.js`
Routes: `routes/modifiers.js` (draft order item modifiers)
Exports: `createGroupSchema`, `updateGroupSchema`, `createOptionSchema`, `updateOptionSchema`, `linkGroupSchema`, `attachModifiersSchema`

- `createGroupSchema` — `name`, `selection_type: "single" | "multi"`, `min_select` (int, default 0), `max_select` (nullable int), `is_required` (default false), `display_order` (int, default 0)
- `createOptionSchema` — `name`, `price_delta` (default 0), `is_default` (default false), `display_order` (int, default 0)
- `linkGroupSchema` — `group_id` + `display_order` (int, default 0); links a modifier group to a product
- `attachModifiersSchema` — `draft_order_item_id` + `option_ids: number[]` (min 1); attaches selected modifier options to a draft order line

### `restaurant-inbox.js`
Routes: `routes/restaurant.js` (online ordering inbox)
Exports: `acceptInboxSchema`, `rejectInboxSchema`

- `acceptInboxSchema` — `order_context: "online" | "takeout" | "delivery" | "dine_in"` (default `"online"`); optional `outlet_id`; converts a web_order into a restaurant draft order
- `rejectInboxSchema` — `reason` (min 1, max 500) required

### `restaurant-availability.js`
Routes: restaurant routes (86'd items / menu availability)
Exports: `soldOutSetSchema`

- `soldOutSetSchema` — `reason` (min 1, max 200) + optional `until: string.datetime()` nullable (auto-clear timestamp)

### `restaurant-void-comp.js`
Routes: restaurant routes (void/comp adjustments)
Exports: `voidCompAdjustSchema`, `voidReasonUpdateSchema`

- `voidCompAdjustSchema` — `adjustment_type: "void" | "comp"`, `reason_code` (max 64), optional `reason_note` (max 500), `amount` (positive), `manager_pin` (regex `^\d{4,8}$`)
- `voidReasonUpdateSchema` — optional `is_active: boolean`, `sort_order` (int 0–10000), `label` (max 120)

### `menu-schedules.js`
Routes: restaurant routes (menu availability schedules)
Exports: `scheduleCreateSchema`, `scheduleUpdateSchema`

- `scheduleBase` (internal) — `name` (max 120), optional `outlet_id`, `day_of_week` (int 0–6 nullable), `start_time`/`end_time` (regex `^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$` — HH:MM or HH:MM:SS), optional `timezone`, `product_ids: number[]` (default `[]`)
- Both schemas use `.refine()` that `start_time !== end_time`

### `menu-engineering.js`
Routes: `routes/reports/` (menu engineering report)
Exports: `menuEngineeringQuerySchema`

- Query-string schema for `GET /api/reports/menu-engineering`; all fields optional: `from`, `to`, `outlet_id`, `category_id` (all accept string or number — query params come as strings)

### `pay-at-table.js`
Routes: restaurant routes (pay-at-table)
Exports: `paymentSessionCreateSchema`

- `paymentSessionCreateSchema` — optional `tip_amount` (coerced, nonnegative, max 100000); passthrough for other fields

### `reservations.js`
Routes: restaurant reservation routes
Exports: `reservationCreateSchema`, `reservationUpdateSchema`, `reservationSmsSchema`, `publicReservationCreateSchema`

- `reservationCreateSchema` — `customer_name` (max 200), `party_size` (int positive, max 50), `reservation_start` (ISO datetime) required; optional `phone`, `email` (validated), `reservation_end`, `outlet_id`/`table_id` (coerced), `notes` (max 1000), `source: "staff" | "web" | "phone"`
- `reservationUpdateSchema` — all fields optional; `status: "pending" | "confirmed" | "seated" | "completed" | "no_show" | "cancelled" | "waitlisted"`
- `reservationSmsSchema` — `template: "confirmation" | "reminder" | "cancellation"`
- `publicReservationCreateSchema` — stricter (no `status`/`source`); `party_size` max 20 (vs 50 for staff), `notes` max 500

### `waitlist.js`
Routes: restaurant waitlist routes
Exports: `waitlistCreateSchema`, `waitlistSeatSchema`

- `waitlistCreateSchema` — `customer_name`, `party_size` (max 50) required; optional `phone`, `outlet_id`, `quoted_wait_minutes` (coerced int, nonneg, max 240), `notes` (max 500)
- `waitlistSeatSchema` — optional `table_id` (coerced int nullable)

### `tips.js`
Routes: `routes/tips.js` (tip pool management)
Exports: `openPoolSchema`, `closePoolSchema`, `distributePoolSchema`, `voidPoolSchema`, `createDistributionRuleSchema`, `updateDistributionRuleSchema`

- `openPoolSchema` — `outlet_id` (coerced int) + `business_date` (regex `^\d{4}-\d{2}-\d{2}$`); idempotent — returns existing pool if open
- `closePoolSchema` — empty passthrough (no required body)
- `distributePoolSchema` — optional `rule_id` (coerced int); omit to use outlet's default rule
- `voidPoolSchema` — optional `reason` (max 500)
- `createDistributionRuleSchema` — `outlet_id` + `name` (max 100) + `strategy: "equal_share" | "hours_weighted" | "role_weighted" | "points"`; optional `config_jsonb: z.record(z.any())`, `is_default: boolean`, `is_active: boolean`

---

## POS feature schemas

### `holds.js`
Routes: layaway/hold/special-order routes
Exports: `CreateHoldSchema`, `AddPaymentSchema`, `CompleteHoldSchema`, `CancelHoldSchema`

- `HoldItemSchema` (internal) — `product_id`, `quantity` (positive, decimals allowed), `price_at_hold` (nonnegative); optional `variant_id`
- `CreateHoldSchema` — `outlet_id`, `items: HoldItemSchema[]` (min 1), `total_amount` (nonnegative) required; optional `customer_id`, `customer_phone`/`name`, `deposit_amount`/`method`, `hold_until` (ISO datetime nullable) or `hold_days` (int positive), `notes`
- `AddPaymentSchema` — `amount` (positive) + `method` (max 64); optional `gateway_ref`
- `CompleteHoldSchema` — optional `payments[]` (each: `method`, `amount` positive, optional `reference`); optional `employee_id`
- `CancelHoldSchema` — optional `reason` (max 500) + `forfeit_deposit: boolean` (coerced)

### `pos-devices.js`
Routes: POS device registry routes
Exports: `RegisterDeviceSchema`, `UpdateDeviceSchema`

- `RegisterDeviceSchema` — `device_uuid` (min 8, max 200); optional `outlet_id` (coerced int nullable), `label` (max 200 nullable)
- `UpdateDeviceSchema` — optional `label` + `outlet_id`

### `risk-controls.js`
Routes: risk/audit routes
Exports: `UpdateRiskConfigSchema`, `NoSaleEventSchema`, `ReviewAnomalyFlagSchema`

- `UpdateRiskConfigSchema` — all optional coerced numbers: `refund_approval_threshold`, `variance_approval_threshold` (both min 0), `anomaly_z_score_threshold` (min 0, max 10)
- `NoSaleEventSchema` — `reason_code` (required string) + optional `note` (max 500), `outlet_id` (coerced int)
- `ReviewAnomalyFlagSchema` — optional `review_note` (max 1000 nullable)

---

## Adding a schema

Create `schemas/<domain>.js`, export named schemas, import in route via `validate(Schema)` from `middleware/validate.js`. Use `.passthrough()` on creation schemas so DB-level columns not validated here are preserved. Use `.strict()` on update schemas where key drift would be a bug. Cross-field constraints that need dynamic error paths: use `.superRefine()` not `.refine()`.
