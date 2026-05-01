# Routes Directory — Claude Guide

This directory contains all Express route handlers for the backend API. Most files mount after tenant middleware and have full session context (`deps.db`, `req.employee`, `req.company`, `req.context`). A small set mount before tenant middleware and must never assume that context.

---

## Subdirectory Modules

Each subdirectory has its own CLAUDE.md. Summary:

### admin/
Routes at `/api/admin/*`. Mounted **before** tenant middleware — no `deps.db` proxy, no `req.company`, no `req.employee`. Most routes require `requireAllowedIp` + `requireSuperAdmin`; the exception is `POST /api/admin/auth/login` itself, which uses `requireAllowedIp` and `authLimiter` but NOT `requireSuperAdmin` (it is the route that creates the admin token). Uses `db` (direct pool) for cross-schema queries and `masterDb` for public-schema-only tables. Sub-modules: `auth.js` (login), `tenants.js` (CRUD, flags, notes, migration), `monitoring.js` (global stats, infra, cleanup), `billing.js` (plan pricing, payments), `operations.js` (support tickets, impersonation, dead letters), `compliance.js` (tax rates, FBR health), `messaging.js` (email queue, broadcast, announcements), `system.js` (worker status, orphaned schemas, backup). Most mutations call `logAdminAction()`, but some routes (tax/compliance mutations, email queue retry, announcement updates, backup verify) do not. Frontend uses `adminFetch()` (not `api.js`).

### integrations/
Routes at `/api/integrations/*`. Feature flag `marketplace_integrations` required on every route. Sub-modules: `hub.js` (unified dashboard), `credentials.js` (BYOK connect/disconnect/test/status — test is DB-only, not a live API call), `daraz.js`, `facebook.js`, `whatsapp.js`, `google-merchant.js`. Credentials stored AES-256-GCM encrypted in `integration_settings`. Inbound webhooks (Meta, Daraz, WhatsApp) are handled in `webhooks.js` (mounted before tenant middleware), not here. DB provider key for Google is `google_merchant` (underscore); URL path is `/google-merchant/` (hyphen) — don't mix them.

### reports/
Routes at `/api/reports/*`. Standard tenant middleware — `req.company.timezone` always present. Orchestrated by `index.js` which returns `{ processPendingReportSchedules }` for the report schedule worker. Sub-modules: `helpers.js` (shared `pgWhere`, `buildReportFilterParts`, `toCsvLines`, `parsePaging`, date utils), `dashboard.js`, `sales.js`, `inventory.js`, `analytics.js`, `purchasing.js`, `finance.js`, `staff.js`, `shifts.js`, `governance.js` (scheduled reports + saved views), `fbr-export.js`, `stock-aging.js`, `multichannel.js`, `clinical.js`, `kds-analytics.js`, `menu-engineering.js`. Date params differ by module — `date_from`/`date_to` for most; `from`/`to` for fbr-export and multichannel; `session_id` only for shift-summary. `sales.timestamp` is UTC — always use `toUtcStart`/`toUtcEnd`.

### shopify/
Routes at `/api/integrations/shopify/*` and `/api/integrations/mappings/*`. Mounted after tenant middleware. Sub-modules: `config.js`, `health.js`, `sync.js`, `orders.js`, `import.js`, `mappings.js`, `webhooks.js` (public — no auth, signature-verified via HMAC-SHA256 on `rawBody`), `reconciliation.js`. Only one `shopify_connections` row is `is_active=true` at a time. `rawBody` is captured by global `express.json` middleware at boot — don't add a json parser to individual routes. Only `orders/create` webhook topic is implemented; the setup endpoint advertises `orders/updated`, `orders/cancelled`, `refunds/create` but those handlers don't exist.

### tier4/
Routes at `/api/*` (mixed prefix). Mounted after tenant middleware. Sub-modules: `notifications.js` (flag: `notifications`; `read-all` route must be registered before `/:id/read` — factory enforces this), `company-profile.js` (includes public `/currency` endpoint, no auth; `PUT` with `industry_type` resets all mode flags), `accounting.js` (flag: `accounting_core`; date params are `from`/`to` not `date_from`/`date_to`; COA delete is soft; journal debit/credit must balance within 0.005 tolerance), `hr.js` (flag: `advanced_hr`; payroll generate is N+1 per employee), `crm.js` (flag: `crm_quotations`; quotation convert requires status to be `accepted` first; uses nodemailer directly, not `services/email.js`), `approvals.js` (flag: `approvals`; PO statuses use capital D/A: `'Draft'`→`'pending_approval'`→`'Approved'`; transfer statuses are all-lowercase).

### customer-portal/
Routes at `/api/portal/*`. Mounted **before** tenant middleware. Uses `loadCustomerAuth` + `resolvePublicTenantDb` instead of the standard employee middleware chain. Sub-modules: `auth.js`, `data.js`, `payments.js`, `appointments.js`, `stays.js`, `treatments.js`. No sub-guide — read source files directly.

### restaurant/
Sub-router under `routes/restaurant/`. Gated by `requireFeature("phase4_restaurant")`. Sub-modules: `availability.js`, `menu-schedules.js`, `void-comp.js`, `pay-at-table.js`, `reservations.js`, `waitlist.js`. No sub-guide.

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
| `draft-orders.js` | `/api/draft-orders` | Draft order hold/resume (flag: `phase2_draft_orders`) |
| `holds.js` | `/api/holds` | Inventory holds/reservations |
| `pos-devices.js` | `/api/pos-devices` | POS device registration |
| `pos-layouts.js` | `/api/pos-layouts` | POS layout config (flag: `phase2_pos_layouts`) |
| `customer-display.js` | `/api/customer-display` | Customer-facing display events |
| `gift-cards.js` | `/api/gift-cards` | Gift card CRUD + redemption (auth) |
| `gift-cards-public.js` | `/api/gift-cards` | **Mounted before tenant middleware** — public gift card balance lookup |

### Inventory & Products
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `inventory.js` | `/api/transfers`, `/api/adjustments` | Stock transfers + adjustments |
| `purchase-orders.js` | `/api/purchase-orders` | PO CRUD; credit supplier warning on submit (not blocked) |
| `grn.js` | `/api/grn` | GRN receiving + supplier payables (flag: `supplier_payables`) |
| `supplier-returns.js` | `/api/supplier-returns` | Return stock to suppliers |
| `categories.js` | `/api/categories` | Category CRUD (hierarchical; leaf-only assignment) |
| `brands.js` | `/api/brands` | Brand CRUD |
| `attribute-sets.js` | `/api/attribute-sets` | Product variant attribute definitions |
| `barcode-expenses.js` | `/api/barcode-expenses` | Barcode print job logging + expenses (flags: `backup_restore`, `e_invoicing_export`) |
| `price-lists.js` | `/api/price-lists` | Price list CRUD — gated by `manage_inventory` perm only, no feature flag |
| `price-list-assignments.js` | `/api/price-list-assignments` | Assign price lists to outlets (flag: `phase2_outlet_pricing`) |
| `price-books.js` | `/api/price-books` | Price book management |
| `outlet-tax-profiles.js` | `/api/outlet-tax-profiles` | Per-outlet tax profile config (flag: `phase2_outlet_tax`) |
| `outlet-visibility.js` | `/api/outlet-visibility` | Per-product outlet visibility (flag: `phase2_outlet_visibility`) |
| `smart-collections.js` | `/api/smart-collections` | Rule-based auto-collections (flag: `phase2_smart_collections`) |
| `scheduled-changes.js` | `/api/scheduled-changes` | Scheduled product/price changes (flag: `phase2_scheduled_changes`) |
| `item-suggestions.js` | `/api/item-suggestions` | POS affinity / upsell suggestions (flag: `phase2_item_suggestions`) |
| `inventory-intelligence.js` | `/api/inventory-intelligence` | Demand forecasting + ABC analysis |
| `product-serials.js` | `/api/product-serials` | Serial number tracking per product |
| `import.js` | `/api/import` | Bulk CSV/XLSX import for products, customers, suppliers; `?preview=1` supported |

### Employees & HR
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `employees.js` | `/api/employees` | Employee CRUD, PIN/password change, validate-pin (POS re-auth) |
| `attendance.js` | `/api/attendance` | Attendance sessions + kiosk PIN check-in endpoint |
| `roles.js` | `/api/roles` | Role + permission management |
| `schedules.js` | `/api/schedules` | Employee scheduling (flag: `phase2_scheduling`) |
| `commissions.js` | `/api/commissions` | Commission plans + earnings (flag: `phase2_commissions`) |
| `approval-policies.js` | `/api/approval-policies` | POS discount approval rules (flag: `phase2_pos_approvals`) |
| `override-reasons.js` | `/api/override-reasons` | Manager override reason codes |
| `risk-controls.js` | `/api/risk-controls` | Cashier risk/fraud controls |

### Finance
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `taxes.js` | `/api/taxes` | Tax rate CRUD |
| `suppliers.js` | `/api/suppliers` | Supplier CRUD |
| `promotions.js` | `/api/promotions` | Promotion/discount rules |
| `customer-invoices.js` | `/api/customer-invoices` | Accounts receivable invoices (flag: `customer_invoicing`) |
| `billing.js` | `/api/billing` | Subscription billing status, pricing, checkout, payment history, upgrade requests |
| `webhooks.js` | `/api/webhooks` | **Mounted before tenant middleware** — payment gateway webhooks (xPay HMAC-verified), Meta/WhatsApp/Daraz inbound webhooks |

### Reporting & Analytics
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `insights.js` | `/api/insights/auto` | 5 pre-built analytics insight cards |
| `insights-ai.js` | `/api/insights/ask` | Claude AI chat for data questions (flag: `ai_insights`, requires `ANTHROPIC_API_KEY`) |
| `fbr.js` | `/api/fbr` | FBR Digital Invoicing config, invoice queue dashboard, retry |
| `tax-lookup.js` | `/api/tax-lookup` | HS code search + suggest corrections |
| `report-builder.js` | `/api/report-builder` | Custom report builder (flag: `phase2_report_builder`) |

### Orders & Fulfillment
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `orders.js` | `/api/orders` | Web/marketplace order management |
| `fulfillment.js` | `/api/fulfillment` | Picklists, loadsheets, dispatch (flags: `phase5_shipping_automation`, `phase5_cod_reconciliation`) |
| `couriers.js` | `/api/couriers` | Courier CRUD + ship/track (13 adapter pattern in `services/couriers/`) |
| `woocommerce.js` | `/api/integrations/woocommerce` | WooCommerce connect, product import, stock sync |

### Restaurant
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `restaurant.js` | `/api/restaurant` | Floor plan, table management, tabs, KOT (flag: `phase4_restaurant`) |
| `restaurant-inbox.js` | `/api/restaurant-inbox` | Restaurant order inbox |
| `public-restaurant.js` | `/api/public-restaurant` | **Mounted before tenant middleware** — QR menu public endpoint (flag: `phase4_restaurant_qr`) |
| `kds.js` | `/api/kds` | Kitchen display system (flag: `phase4_restaurant_kds`) |

### Bookings & Services
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `bookings.js` | `/api/bookings` | Appointment CRUD, services, staff (flag: `phase4_appointments`) |
| `public-bookings.js` | `/api/public-bookings` | **Mounted before tenant middleware** — public booking flow |
| `service-tickets.js` | `/api/service-tickets` | Workflow ticket CRUD (flag: `phase4_workflow_tickets`) |
| `rentals.js` | `/api/rentals` | Rental contracts, asset check-out/in (flag: `phase4_rentals`) |
| `rooms.js` | `/api/rooms` | Room CRUD, bookings, folio (flag: `phase4_room_management`) |
| `treatment-plans.js` | `/api/treatment-plans` | Clinical treatment plans (flag: `phase4_treatment_plans`) |
| `treatment-plan-templates.js` | `/api/treatment-plan-templates` | Reusable plan templates (flag: `phase4_treatment_plans`) |
| `projects.js` | `/api/projects` | Service projects (flag: `phase4_service_projects`) |
| `contracts.js` | `/api/contracts` | Service contracts (flag: `phase4_service_contracts`) |
| `subscriptions.js` | `/api/subscriptions` | Customer subscription billing (flag: `subscription_billing`) |

### Customer-Facing
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `customers.js` | `/api/customers` | See above |
| `loyalty.js` | `/api/loyalty` | Loyalty program rules + point calculations |
| `return-policies.js` | `/api/return-policies` | Return policy definitions (flag: `phase2_returns_policy`) |
| `messaging.js` | `/api/messaging` | Customer messaging inbox (flag: `customer_messaging`) |
| `marketing.js` | `/api/marketing` | Campaign management (flag: `marketing_campaigns`) |

### Setup & Config
| File | Mount prefix | What it does |
|------|-------------|--------------|
| `setup.js` | `/api/setup` | First-run wizard with `setupTenantDbManager` (not standard tenant middleware) |
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
674 lines — contains inline health check routes, feature-flag routes, middleware wiring, outlet-assignment enforcement, and restore guard; not a pure orchestrator. Mounts every route module under `/api/<domain>`. Only edit it when adding a new route module — never for domain-level changes.

### Auth on GET routes
Most authenticated tenant GETs use `requirePerm` or `requireAnyPerm`. Public GETs exist by design (e.g. receipts, country-packs, public bookings, storefront). Some authenticated GETs rely on shared auth/session context rather than an explicit permission guard — the rule is not absolute.

### Error conventions
Success: `res.json({...})` or `res.status(201).json({...})`. Client errors: `res.status(4xx).json({ error: "..." })`. Server errors: `res.status(500).json({ error: err.message })` in catch blocks. `validate(schema)` middleware returns `400` with `{ error, details }` automatically.

### Transactions
`deps.db.transaction(async (client) => {...})` — client inherits tenant `search_path`. For atomicity-critical flows, reads can go outside the transaction while writes go inside.

### Feature-flagged routes
Apply `requireFeature("<flag>")` as middleware. See `backend/CLAUDE.md` for the full flag registry. Some routes use mode guards (`requireMode`) in addition.

### Validation
`validate(schema)` middleware from `middleware/validate.js` using Zod schemas in `backend/schemas/`. Not yet universal — check the specific route file.

### Boot guard
`ensureCriticalRoutesRegistered()` in `index.js` verifies 4 routes exist at startup and crashes boot if missing: `POST /api/products/bulk-import`, `POST /api/products/bulk-delete`, `POST /api/products/bulk-status`, `DELETE /api/integrations/shopify/import/products`.
