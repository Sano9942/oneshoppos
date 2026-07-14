# Routes Directory — Claude Guide

This directory contains all Express route handlers for the backend API. Most files mount after tenant middleware and have full session context (`deps.db`, `req.employee`, `req.company`, `req.context`). A small set mount before tenant middleware and must never assume that context.

---

## Subdirectory Modules

Each subdirectory has its own CLAUDE.md. Summary:

### admin/
Routes at `/api/admin/*`. Mounted **before** tenant middleware — no `deps.db` proxy, no `req.company`, no `req.employee`. Most routes require `requireAllowedIp` + `requireSuperAdmin`; the exception is `POST /api/admin/auth/login` itself (uses `requireAllowedIp` + `authLimiter` only — it mints the admin token) and `GET /api/announcements/active` (fully public). Uses `db` (direct pool, schema-qualified queries) for cross-tenant fanout and `masterDb` for public-schema-only tables. Sub-modules: `auth.js`, `tenants.js` (CRUD, flags, notes, migration, PIN reset), `monitoring.js` (global stats, infra, cleanup), `billing.js` (plan pricing, payments), `operations.js` (support tickets, impersonation, dead letters), `compliance.js` (tax rates, FBR health), `messaging.js` (email queue reads `pgboss.job`, broadcast, announcements), `system.js` (worker status, orphaned schemas, backup). Not every mutation calls `logAdminAction()` — tax/compliance mutations, email-queue retry, announcement updates, and backup verify are notable gaps. Frontend uses `adminFetch()` (not `api.js`), token in `adminAuthStore.js`.

### integrations/
Routes at `/api/integrations/*`. Every sub-module is `(router, deps) => {}` receiving the shared router. `requireFeature("marketplace_integrations")` applied per-route (not centrally) except `POST /:provider/send-test-sms`, gated by `phase5_sms_providers`. Sub-modules: `hub.js` (unified dashboard — aggregates channels/payment/sms/couriers/shopify/woocommerce), `credentials.js` (generic BYOK connect/disconnect/test/status — `/test` is DB-only, never calls the live API), `daraz.js`, `facebook.js`, `whatsapp.js`, `google-merchant.js` (one file per channel, each with its own local `getXClient()`, no caching). Credentials AES-256-GCM encrypted in `integration_settings` via `services/crypto.js`. Inbound webhooks (Meta, Daraz, WhatsApp) are handled in `routes/webhooks.js` (mounted before tenant middleware), not here — this directory is outbound-only. DB provider key for Google is `google_merchant` (underscore); URL path segment is `/google-merchant/` (hyphen) — don't mix them.

### reports/
Routes at `/api/reports/*`. Standard tenant middleware — `req.company.timezone` always present. Most routes have no permission/feature guard beyond the tenant middleware chain; guards are called out per-file where present (e.g. `clinical.js`, `kds-analytics.js`, `menu-engineering.js` all gate on mode + feature + perm; profit-layer reports gate on `reports_profit_layer`). Orchestrated by `index.js`, returns `{ processPendingReportSchedules }` for the report-schedule worker. Sub-modules: `dashboard.js`, `sales.js` (largest file), `inventory.js`, `analytics.js`, `purchasing.js`, `finance.js`, `staff.js`, `shifts.js` (most routes require `session_id`), `governance.js` (scheduled report exports + saved views — the only file doing CSV generation + R2 upload + direct nodemailer sending), `fbr-export.js`, `stock-aging.js`, `multichannel.js`, `clinical.js`, `kds-analytics.js`, `menu-engineering.js`. Date params are **not consistent** — most use `date_from`/`date_to`; `multichannel.js` and `kds-analytics.js` use `from`/`to`; `fbr-export.js` requires `from`/`to`. A duplicate/shadow `stock-aging` route exists in both `stock-aging.js` (ungated) and `inventory.js` (gated `reports_inventory_health_plus`) — registration order in `reports/index.js` determines which serves.

### shopify/
Routes at `/api/integrations/shopify/*` and `/api/integrations/mappings/*`. Mounted after tenant middleware, except the inbound order webhook which has no auth. Sub-modules: `config.js` (connection config), `health.js` (status, live verify, UAT checklist), `sync.js` (event retry/process), `orders.js` (manual order pull), `import.js` (product/inventory import — the product-delete route is checked by `ensureCriticalRoutesRegistered()` at boot), `mappings.js` (product/location/customer mapping), `webhooks.js` (public, HMAC-SHA256-verified via `rawBody` — only `orders/create` topic is actually implemented despite the setup endpoint advertising more), `reconciliation.js` (full-table-replace inventory reconciliation, gated `requireFeature("approvals")` on the fix-request route only). Only one `shopify_connections` row is `is_active=true` at a time. `rawBody` is captured globally by `express.json` at boot for this path — never add a body-parser to the webhook route.

### tier4/
Routes at `/api/*` (mixed prefix, not `/api/tier4/*`). Mounted after tenant middleware. Sub-modules: `notifications.js` (flag `notifications`; `read-all` registered after `/:id/read` but doesn't shadow — different segment shape), `company-profile.js` (`GET /api/company-profile/currency` is the one fully public route in the directory; `PUT` with a valid `industry_type` re-seeds all mode-derived flags), `accounting.js` (flag `accounting_core`; date params `from`/`to` except `cashflow/daily`; journal debit/credit must balance within 0.005 tolerance; COA delete is soft), `hr.js` (flag `advanced_hr`; payroll generation is O(employees) sequential — no batching), `crm.js` (flag `crm_quotations`; quotation `convert` requires status `accepted` first; sends via raw nodemailer against tenant `email_config`, bypassing `services/email.js`), `approvals.js` (flag `approvals`; PO statuses use capitalized `Draft`/`Approved`, transfer statuses are all-lowercase — different state machines despite the parallel shape). `x-employee-id` header (not `req.employee.id`) is the attribution source for `approved_by`/`created_by`/etc. throughout this directory.

### customer-portal/
Routes at `/api/portal/*`. Mounted **before** tenant middleware. Uses `loadCustomerAuth` + `resolvePublicTenantDb` instead of the standard employee middleware chain — `req.employee`/`req.company` never set; `req.db` is set directly by the portal auth middleware. Sub-modules: `auth.js`, `data.js`, `payments.js`, `appointments.js`, `stays.js`, `treatments.js`. No sub-guide — read source directly.

### restaurant/
Sub-router under `routes/restaurant/`. Gated by `requireFeature("phase4_restaurant")`. Sub-modules: `availability.js`, `menu-schedules.js`, `void-comp.js`, `pay-at-table.js`, `reservations.js`, `waitlist.js`. No sub-guide.

### manufacturer-portal/
Routes at `/manufacturer-portal/:slug` API surface. Mounted **before** tenant middleware, parallel in structure to `customer-portal/` — uses `loadManufacturerAuth` (scope `"manufacturer"`, `MANUFACTURER_PORTAL_JWT_SECRET`) instead of the standard employee chain; `req.employee`/`req.company` never set. Backs the brand-scoped manufacturer-partner directory (`routes/manufacturer-partners.js` is the admin-side CRUD; this directory is the partner-facing read surface). Only `customers.city` is ever exposed to a manufacturer partner — a deliberate PII invariant, don't widen the query without checking that constraint first. No sub-guide.

---

## Top-Level Route Files

### Core POS
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `auth.js` | `/api/auth` | Login, logout, refresh token, forgot/reset password, self-service signup |
| `sales.js` | `/api/sales` | Sales (POST body: `cartItems`, item `id`, item `price`), voids, sale detail |
| `returns.js` | `/api/returns` | Return/refund flow; body needs `original_sale_id`, `total_refund`, `refund_method`, items need `refund_price` |
| `products.js` | `/api/products` | Product CRUD, variants, stock lookup, bulk import/delete/status, price history |
| `customers.js` | `/api/customers` | Customer CRUD, loyalty, wallet, purchase history |
| `receipts.js` | `/api/receipts` | **Mounted before tenant middleware** — public shareable receipt endpoint; manual tenant resolution |
| `parked-sales.js` | `/api/parked-sales` | Park/retrieve cart state |
| `shifts.js` | `/api/shifts` | Cash shift open/close; `GET /api/shifts/active?outlet_id=1` for active shift (no status filter on base GET) |
| `kds.js` | `/api/kds` | Kitchen display system — orders/tickets (flag: `phase4_restaurant_kds`) |
| `modifiers.js` | `/api/modifiers` | POS item modifier groups |
| `tips.js` | `/api/tips` | Tip recording |
| `draft-orders.js` | `/api/draft-orders` | Draft order hold/resume |
| `holds.js` | `/api/holds` | Inventory holds/reservations |
| `pos-devices.js` | `/api/pos-devices` | POS device registration |
| `pos-layouts.js` | `/api/pos-layouts` | Per-device POS layout config |
| `customer-display.js` | `/api/customer-display` | Customer-facing display events |
| `gift-cards.js` | `/api/gift-cards` | Gift card CRUD + redemption (auth) |
| `gift-cards-public.js` | `/api/gift-cards` | **Mounted before tenant middleware** — public gift card balance lookup |

### Inventory & Products
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `inventory.js` | `/api/transfers`, `/api/adjustments` | Stock transfers + adjustments |
| `purchase-orders.js` | `/api/purchase-orders` | PO CRUD; credit supplier warning on submit (not blocked) |
| `grn.js` | `/api/grn` | GRN receiving + supplier payables |
| `supplier-returns.js` | `/api/supplier-returns` | Return stock to suppliers |
| `categories.js` | `/api/categories` | Category CRUD (hierarchical; leaf-only assignment) |
| `brands.js` | `/api/brands` | Brand CRUD |
| `attribute-sets.js` | `/api/attribute-sets` | Product variant attribute definitions |
| `barcode-expenses.js` | `/api/barcode-expenses` | Barcode print job logging + expenses |
| `price-lists.js` | `/api/price-lists` | Price list CRUD — gated by `manage_inventory` perm only, no feature flag |
| `price-list-assignments.js` | `/api/price-list-assignments` | Assign price lists to outlets |
| `price-books.js` | `/api/price-books` | Price book management |
| `outlet-tax-profiles.js` | `/api/outlet-tax-profiles` | Per-outlet tax profile config |
| `outlet-visibility.js` | `/api/outlet-visibility` | Per-product outlet visibility |
| `smart-collections.js` | `/api/smart-collections` | Rule-based auto-collections |
| `scheduled-changes.js` | `/api/scheduled-changes` | Scheduled product/price changes |
| `item-suggestions.js` | `/api/item-suggestions` | POS affinity / upsell suggestions |
| `inventory-intelligence.js` | `/api/inventory-intelligence` | ABC classification, cycle counts, reorder suggestions |
| `product-serials.js` | `/api/product-serials` | Serial number tracking per product |
| `import.js` | `/api/import` | Bulk CSV/XLSX import for products, customers, suppliers; `?preview=1` supported |

### Employees & HR
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `employees.js` | `/api/employees` | Employee CRUD, PIN/password change, validate-pin (POS re-auth) |
| `attendance.js` | `/api/attendance` | Attendance sessions + kiosk PIN check-in endpoint |
| `roles.js` | `/api/roles` | Role + permission management. `GET /api/roles` + all role mutations require `manage_roles` (PLAN-V2 Step 2 — was all_access; Administrators still pass via the `requireAnyPerm` all_access bypass); `GET /:id/permissions` is self-or-admin (every employee reads their own role on boot); `PUT /:id/permissions` rejects strings not in `config/permissions-catalog.js`; `GET /api/permissions-catalog` (also `manage_roles`) backs the role editor |
| `schedules.js` | `/api/schedules` | Employee scheduling |
| `commissions.js` | `/api/commissions` | Commission plans + earnings |
| `approval-policies.js` | `/api/approval-policies` | POS discount approval rules |
| `override-reasons.js` | `/api/override-reasons` | Manager override reason codes |
| `risk-controls.js` | `/api/risk-controls` | Cashier risk/fraud controls |

### Finance
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `taxes.js` | `/api/taxes` | Tax rate CRUD |
| `suppliers.js` | `/api/suppliers` | Supplier CRUD |
| `promotions.js` | `/api/promotions` | Promotion/discount rules, including slab-percent wholesale schemes |
| `customer-invoices.js` | `/api/customer-invoices` | Accounts receivable invoices |
| `billing.js` | `/api/billing` | Subscription billing status, pricing, checkout, payment history, upgrade requests |
| `webhooks.js` | `/api/webhooks` | **Mounted before tenant middleware** — payment gateway webhooks (xPay HMAC-verified), Meta/WhatsApp/Daraz inbound webhooks |

### Reporting & Analytics
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `insights.js` | `/api/insights/auto` | 5 pre-built analytics insight cards |
| `insights-ai.js` | `/api/insights/ask` | Claude AI chat for data questions (requires `ANTHROPIC_API_KEY`) |
| `fbr.js` | `/api/fbr` | FBR Digital Invoicing config, invoice queue dashboard, retry |
| `tax-lookup.js` | `/api/tax-lookup` | HS code search + suggest corrections |
| `report-builder.js` | `/api/report-builder` | Custom report builder |

### Orders & Fulfillment
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `orders.js` | `/api/orders` | Web/marketplace order management |
| `fulfillment.js` | `/api/fulfillment` | Picklists, loadsheets, dispatch, COD settlements |
| `couriers.js` | `/api/couriers` | Courier CRUD + ship/track (13-adapter pattern in `services/couriers/`) |
| `woocommerce.js` | `/api/integrations/woocommerce` | WooCommerce connect, product import, stock sync |

### Restaurant
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `restaurant.js` | `/api/restaurant` | Floor plan, table management, tabs, KOT |
| `restaurant-inbox.js` | `/api/restaurant-inbox` | Restaurant order inbox |
| `restaurant-kiosk.js` | `/api/restaurant/kiosk-tokens` | QR self-order kiosk token issue/list (gated `phase4_restaurant_qr` + `manage_restaurant`) |
| `public-restaurant.js` | `/api/public-restaurant` | **Mounted before tenant middleware** — QR menu public endpoint |
| `kds.js` | `/api/kds` | Kitchen display system |

### Bookings & Services
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `bookings.js` | `/api/bookings` | Appointment CRUD, services, staff |
| `public-bookings.js` | `/api/public-bookings` | **Mounted before tenant middleware** — public booking flow |
| `service-tickets.js` | `/api/service-tickets` | Workflow ticket CRUD |
| `rentals.js` | `/api/rentals` | Rental contracts, asset check-out/in |
| `rooms.js` | `/api/rooms` | Room CRUD, bookings, folio |
| `treatment-plans.js` | `/api/treatment-plans` | Clinical treatment plans |
| `treatment-plan-templates.js` | `/api/treatment-plan-templates` | Reusable plan templates |
| `projects.js` | `/api/projects` | Service projects |
| `contracts.js` | `/api/contracts` | Service contracts |
| `subscriptions.js` | `/api/subscriptions` | Customer subscription billing |

### Wholesale / B2B
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `field.js` | `/api/field`, `/api/admin/field-routes` | Wholesale field-rep app: today's route, GPS+selfie check-in, visit history, owner summary cards (flag `wholesale_field_sales`, perm `manage_field_sales`) |
| `manufacturer-partners.js` | `/api/manufacturer-partners` | Manufacturer-partner CRUD backing the brand-scoped partner portal (flag `wholesale_secondary_sales`, perm `manage_inventory`) |

### Customer-Facing
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `customers.js` | `/api/customers` | See above |
| `loyalty.js` | `/api/loyalty` | Loyalty program rules + point calculations |
| `return-policies.js` | `/api/return-policies` | Return policy definitions |
| `messaging.js` | `/api/messaging` | Customer messaging inbox |
| `marketing.js` | `/api/marketing` | Campaign management |

### Setup & Config
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `setup.js` | `/api/setup` | First-run wizard with `setupTenantDbManager` (not standard tenant middleware). Seeds roles 1-3 / outlet 1 / receipt_template 1 with explicit ids, then setvals those sequences (explicit-id inserts never advance nextval) |
| `business-modules.js` | `/api/business-modules` | Self-service module toggles: GET page payload (cards + computed state + roles_with_access; on multi-outlet tenants each `scope:"outlet"` card also carries `outlets[]`/`enabled_outlet_count`/`default_outlet_enabled`, and enabled covered Bucket A cards carry a `checklist`), GET `:key/impact` confirm preview (`?outlet_id=` scopes disable counts where the table is outlet-dimensioned, else `tenant_wide:true`), POST `:key/toggle` (company-level), POST `:key/outlet-toggle` (per-outlet override or the new-outlet default). The company toggle stays `requirePerm("manage_business_modules")`; the other three are `requireAnyPerm(["manage_business_modules","manage_outlet_modules"])` — neither perm has a default role; admins pass via all_access. Rules live in `services/business-modules.js` |
| `receipt-templates.js` | `/api/receipt-templates` | Receipt layout templates |
| `email.js` | `/api/email` | Send receipt email (`send-receipt-v2`) |
| `support.js` | `/api/support` | Support ticket submit + screenshot upload |

### Misc / Infrastructure
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `country-packs.js` | `/api/country-packs` | **Mounted before tenant middleware** — pre-seeded tax rates + flags for signup flow |
| `sandbox.js` | `/api/sandbox` | **No auth, mounted before tenant middleware** — test payment simulation (only when `PAYMENT_GATEWAY=sandbox`) |
| `storefront.js` | `/api/storefront` | **Mounted before tenant middleware** — public storefront API using `resolvePublicTenantDb` |
| `public-reservations.js` | `/api/public-reservations` | **Mounted before tenant middleware** — public restaurant reservation form |

---

## Key Conventions & Gotchas

### Mounting order
Routes mounted **before** tenant middleware (no standard session context): `admin/`, `webhooks.js`, `receipts.js`, `customer-portal/`, `storefront.js`, `public-restaurant.js`, `public-bookings.js`, `public-reservations.js`, `country-packs.js`, `sandbox.js`, `gift-cards-public.js`. Never add `req.employee`-dependent logic to these files.

### registerAllRoutes.js
Contains inline health check routes, feature-flag routes, middleware wiring, outlet-assignment enforcement, and restore guard — not a pure orchestrator. Mounts every route module under `/api/<domain>`. Only edit it when adding a new route module — never for domain-level changes.

### Auth on GET routes
Most authenticated tenant GETs use `requirePerm` or `requireAnyPerm`. Public GETs exist by design (e.g. receipts, country-packs, public bookings, storefront). Some authenticated GETs rely on shared auth/session context rather than an explicit permission guard — the rule is not absolute.

### Error conventions
Success: `res.json({...})` or `res.status(201).json({...})`. Client errors: `res.status(4xx).json({ error: "..." })`. Server errors: `res.status(500).json({ error: err.message })` in catch blocks. `validate(schema)` middleware returns 400 with `{ error, details }` automatically.

### Transactions
`deps.db.transaction(async (client) => {...})` — client inherits tenant `search_path`. For atomicity-critical flows, reads can go outside the transaction while writes go inside.

### Feature-flagged routes
Apply `requireFeature("<flag>")` as middleware, sometimes combined with `requireMode("<mode>")` for vertical-specific gating. See `backend/middleware/CLAUDE.md` for the flag/mode registry mechanics.

### Validation
`validate(schema)` middleware from `middleware/validate.js` using Zod schemas in `backend/schemas/`. Not yet universal — check the specific route file.

### Boot guard
`ensureCriticalRoutesRegistered()` in `index.js` verifies 4 routes exist at startup and crashes boot if missing: `POST /api/products/bulk-import`, `POST /api/products/bulk-delete`, `POST /api/products/bulk-status`, `DELETE /api/integrations/shopify/import/products`.
