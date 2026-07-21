# Routes Directory — Claude Guide

Express route handlers for the backend API. Most files mount after tenant middleware and have full session context (`deps.db` tenant proxy, `req.employee`, `req.company`, `req.context`, `req.outletContext`). A smaller set mount before tenant middleware and must never assume that context — see the mounting-order section below.

---

## Subdirectory Modules

Each subdirectory has its own CLAUDE.md with full detail. Summary:

### admin/
Routes at `/api/admin/*`. Mounted **before** tenant middleware — no `deps.db` proxy, no `req.company`, no `req.employee`. Most routes require `requireSuperAdmin`; exceptions are the login/2FA-exchange/refresh endpoints (which mint the session) and `GET /api/announcements/active` (fully public). There is deliberately no IP allowlist — the `ADMIN_ALLOWED_IPS` layer was deleted rather than configured (it failed open); password + TOTP + `requireSuperAdmin` is the gate. See `admin/CLAUDE.md`. Uses `db` (direct pool, schema-qualified queries) for cross-tenant fanout and `masterDb` for public-schema-only tables; `tenantDbManager.getDb(tenantId)` for single-tenant-scoped work. Sub-modules: `auth.js` (login, TOTP, sessions), `tenants.js` (CRUD, flags, modes, notes, migration, PIN reset, flag-drift repair), `monitoring.js` (global stats, infra introspection, cleanup), `billing.js` (plan pricing, payments, trial lifecycle), `operations.js` (support tickets, impersonation, dead letters), `compliance.js` (tax rates, FBR health), `messaging.js` (email queue reads the pg-boss job table directly, broadcast, announcements), `system.js` (worker status, orphaned schemas, backup), `module-locks.js` (platform-level module enable locks). Cross-tenant fanout is the dominant pattern here — always wrapped in a per-tenant try/catch so one tenant with a missing table doesn't break the whole response. Not every mutation calls the audit-log helper — verify per-route. Frontend uses `adminFetch()` (not `api.js`), token in `adminAuthStore.js`.

### integrations/
Routes at `/api/integrations/*`. Every sub-module is `(router, deps) => {}` receiving the shared router. `requireFeature("marketplace_integrations")` is applied per-route (not centrally) except the SMS test-send route, gated by a separate SMS-provider flag. Sub-modules: `hub.js` (unified dashboard aggregating channels/payment/sms/couriers/shopify/woocommerce), `credentials.js` (generic BYOK connect/disconnect/test/status — `/test` is DB-only, never calls the live API), `daraz.js`, `facebook.js`, `whatsapp.js`, `google-merchant.js` (one file per channel, each with its own local client-getter, no caching). Credentials are AES-256-GCM encrypted in `integration_settings` via `services/crypto.js`. Inbound webhooks (Meta, Daraz, WhatsApp) are handled in `routes/webhooks.js` (mounted before tenant middleware), not here — this directory is outbound-only. The DB provider key for Google Merchant uses an underscore; the URL path segment uses a hyphen — don't conflate them.

### reports/
Routes at `/api/reports/*`. Standard tenant middleware — `req.company.timezone` always present. Every route file carries an explicit permission guard keyed to the class of data it returns, rather than one blanket reporting permission: five data-classified permissions (`view_sales_reports`, `view_inventory_reports`, `view_financial_reports`, `view_hr_reports`, `view_customer_reports`) plus a governance permission for the scheduling/export surface — see `reports/CLAUDE.md` for the per-file map. Cross-outlet reports pass a company-level override to `requireFeature`/`requireMode` so history stays readable where a module is switched off at the viewer's outlet. Orchestrated by `index.js`, which returns a handle consumed by the report-schedule worker. Sub-modules: `dashboard.js`, `sales.js` (largest file), `inventory.js`, `analytics.js`, `purchasing.js`, `finance.js`, `staff.js`, `shifts.js` (most routes require `session_id`), `governance.js` (scheduled report exports + saved views — the only file doing CSV generation, R2 upload, and direct SMTP sending), `fbr-export.js`, `stock-aging.js`, `multichannel.js`, `clinical.js`, `kds-analytics.js`, `menu-engineering.js`, `recipe-costing.js`. Date params are **not** consistent across files — most use `date_from`/`date_to`; a handful use `from`/`to` instead; check the specific file before wiring a new frontend tab.

### shopify/
Routes at `/api/integrations/shopify/*` and `/api/integrations/mappings/*`. Mounted after tenant middleware, except the inbound order webhook, which has no auth. Sub-modules: `config.js` (connection config), `health.js` (status, live verify, go-live checklist), `sync.js` (event retry/process), `orders.js` (manual order pull), `import.js` (product/inventory import — the product-delete route is one of the boot-time critical-route checks), `mappings.js` (product/location/customer mapping), `webhooks.js` (public, HMAC-SHA256-verified via the captured raw body — only the order-create topic is actually implemented despite the setup endpoint advertising more), `reconciliation.js` (full-table-replace inventory reconciliation; the fix-request route is the only one gated by an additional feature flag). Only one Shopify connection row is active at a time. The raw request body is captured globally by the JSON body-parser at boot specifically for this path — never add another body parser here, or HMAC verification breaks.

### tier4/
Routes at mixed `/api/*` prefixes (not one shared prefix). Mounted after tenant middleware. Sub-modules: `notifications.js` (in-app notification inbox, gated by a flag; no permission guard — any authenticated user manages their own), `company-profile.js` (the currency-lookup route is the one fully public route in the directory; changing `industry_type` re-seeds every mode-derived feature flag through the shared preset-apply service), `accounting.js` (P&L/cashflow/balance-sheet reporting, accounting periods, credit/debit notes, chart of accounts, post-dated cheques, journal entries — journal debits/credits must balance within a small tolerance; chart-of-accounts delete is soft), `hr.js` (leave requests, payroll period generation — sequential per-employee, no batching — and overtime alerting), `crm.js` (leads, quotations; quotation-to-sale conversion requires `accepted` status first and funnels stock decrement through the shared stock-ledger service; quotation email uses raw SMTP against tenant mail config, bypassing the shared email service), `approvals.js` (purchase-order and stock-transfer submit/approve workflows — PO statuses are capitalized, transfer statuses are all-lowercase; these are different state machines despite the parallel shape). The employee-id header (not the authenticated session's employee object) is the attribution source for approved-by/created-by/closed-by fields throughout this directory — a deliberate, longstanding convention here, not an oversight.

### customer-portal/
Routes at `/api/portal/*`. Mounted **before** tenant middleware. Uses a dedicated customer-auth middleware plus a public tenant resolver instead of the standard employee middleware chain — `req.employee`/`req.company` are never set; `req.db` is set directly by the portal auth middleware. Sub-modules: `auth.js`, `data.js`, `payments.js`, `appointments.js`, `stays.js`, `treatments.js`. No sub-guide — read source directly.

### restaurant/
Sub-router under `routes/restaurant/`. Gated by the restaurant-mode feature flag. Sub-modules: `availability.js`, `menu-schedules.js`, `void-comp.js`, `pay-at-table.js`, `reservations.js`, `waitlist.js`. No sub-guide.

### manufacturer-portal/
Routes backing a brand-scoped manufacturer partner portal. Mounted **before** tenant middleware, structurally parallel to `customer-portal/` — uses a dedicated manufacturer-auth middleware instead of the standard employee chain; `req.employee`/`req.company` never set. `routes/manufacturer-partners.js` is the admin-side CRUD; this directory is the partner-facing read surface. Only a customer's city is ever exposed to a manufacturer partner — a deliberate privacy invariant; don't widen any query here without preserving that constraint. No sub-guide.

---

## Top-Level Route Files

### Core POS
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `auth.js` | `/api/auth` | Login, logout, refresh, forgot/reset password, self-service signup. Also hosts the context-bootstrap route (despite living under a different prefix) — the payload the frontend boots from, carrying the employee's base role, effective role (after any per-outlet override), and the outlet-effective permission array. Each outlet row in the response carries its own role override. This is the only path by which the frontend learns its effective permission set. |
| `sales.js` | `/api/sales` | Sales (POST body uses `cartItems`, item `id`, item `price`), voids, sale detail. |
| `returns.js` | `/api/returns` | Return/refund flow; body needs `original_sale_id`, `total_refund`, `refund_method`, items need `refund_price`. |
| `products.js` | `/api/products` | Product CRUD, variants, stock lookup, bulk import/delete/status, price history. |
| `customers.js` | `/api/customers` | Customer CRUD, loyalty, wallet, purchase history. |
| `receipts.js` | `/api/receipts` | **Mounted before tenant middleware** — public shareable receipt endpoint; resolves its own tenant. |
| `parked-sales.js` | `/api/parked-sales` | Park/retrieve cart state. |
| `shifts.js` | `/api/shifts` | Cash shift open/close; the active-shift lookup takes `outlet_id` (there's no status filter on the base list route). |
| `kds.js` | `/api/kds` | Kitchen display system — orders/tickets, gated by a restaurant-KDS feature flag. |
| `modifiers.js` | `/api/modifiers` | POS item modifier groups. |
| `tips.js` | `/api/tips` | Tip recording. |
| `draft-orders.js` | `/api/draft-orders` | Draft order hold/resume. |
| `holds.js` | `/api/holds` | Inventory holds/reservations. |
| `pos-devices.js` | `/api/pos-devices` | POS device registration. |
| `pos-layouts.js` | `/api/pos-layouts` | Per-device POS layout config. |
| `customer-display.js` | `/api/customer-display` | Customer-facing display events. |
| `gift-cards.js` | `/api/gift-cards` | Gift card CRUD + redemption (authenticated). |
| `gift-cards-public.js` | `/api/gift-cards` | **Mounted before tenant middleware** — public gift card balance lookup. |

### Inventory & Products
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `inventory.js` | `/api/transfers`, `/api/adjustments` | Stock transfers + adjustments. |
| `purchase-orders.js` | `/api/purchase-orders` | PO CRUD; over-credit-limit warning on submit (not blocked). |
| `grn.js` | `/api/grn` | GRN receiving + supplier payables. |
| `supplier-returns.js` | `/api/supplier-returns` | Return stock to suppliers. |
| `categories.js` | `/api/categories` | Category CRUD — hierarchical, leaf-only product assignment. |
| `brands.js` | `/api/brands` | Brand CRUD. |
| `attribute-sets.js` | `/api/attribute-sets` | Product variant attribute definitions. |
| `barcode-expenses.js` | `/api/barcode-expenses` | Barcode print job logging + expenses. |
| `price-lists.js` | `/api/price-lists` | Price list CRUD — permission-gated only, no feature flag. |
| `price-list-assignments.js` | `/api/price-list-assignments` | Assign price lists to outlets. |
| `price-books.js` | `/api/price-books` | Price book management. |
| `outlet-tax-profiles.js` | `/api/outlet-tax-profiles` | Per-outlet tax profile config. |
| `outlet-visibility.js` | `/api/outlet-visibility` | Per-product outlet visibility. |
| `smart-collections.js` | `/api/smart-collections` | Rule-based auto-collections. |
| `scheduled-changes.js` | `/api/scheduled-changes` | Scheduled product/price changes. |
| `item-suggestions.js` | `/api/item-suggestions` | POS affinity / upsell suggestions. |
| `inventory-intelligence.js` | `/api/inventory-intelligence` | ABC classification, cycle counts, reorder suggestions. |
| `product-serials.js` | `/api/product-serials` | Serial number tracking per product. |
| `import.js` | `/api/import` | Bulk CSV/XLSX import for products, customers, suppliers; supports a preview mode. |

### Employees & HR
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `employees.js` | `/api/employees` | Employee CRUD, PIN/password change, validate-pin (POS re-auth). Outlet assignments: the read route returns per-row role override (null = inherit) plus the base role id; the write route is bulk-replace and takes an optional per-outlet role map — omitting it clears every existing override, so callers must round-trip the full map. Multi-outlet assignment is legal for every role; outlet-assignment enforcement is what confines a non-admin employee to assigned outlets. |
| `attendance.js` | `/api/attendance` | Attendance sessions + kiosk PIN check-in endpoint. |
| `roles.js` | `/api/roles` | Role + permission management. Role listing and all role mutations require a dedicated role-management permission (administrators still pass via the blanket bypass); reading one's own role's permission list is self-or-admin; the permissions-catalog endpoint backs the role editor and rejects any permission string not registered in the catalog. |
| `schedules.js` | `/api/schedules` | Employee scheduling. |
| `commissions.js` | `/api/commissions` | Commission plans + earnings. |
| `approval-policies.js` | `/api/approval-policies` | POS discount approval rules. |
| `override-reasons.js` | `/api/override-reasons` | Manager override reason codes. |
| `risk-controls.js` | `/api/risk-controls` | Cashier risk/fraud controls. |

### Finance
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `taxes.js` | `/api/taxes` | Tax rate CRUD. |
| `suppliers.js` | `/api/suppliers` | Supplier CRUD. |
| `promotions.js` | `/api/promotions` | Promotion/discount rules, including slab-percent wholesale schemes. |
| `customer-invoices.js` | `/api/customer-invoices` | Accounts receivable invoices. |
| `billing.js` | `/api/billing` | Subscription billing status, pricing, checkout, payment history, upgrade requests. |
| `webhooks.js` | `/api/webhooks` | **Mounted before tenant middleware** — payment gateway webhooks plus inbound Meta/WhatsApp/Daraz and delivery-aggregator webhooks. Signature verification differs per provider and one provider is deliberately unverified — see "Webhook signature verification" below before touching any handler here. |

### Reporting & Analytics
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `insights.js` | `/api/insights/auto` | Pre-built analytics insight cards. |
| `insights-ai.js` | `/api/insights/ask` | AI chat for data questions (requires an AI provider key). |
| `fbr.js` | `/api/fbr` | Tax-authority digital-invoicing config, invoice queue dashboard, retry. |
| `tax-lookup.js` | `/api/tax-lookup` | HS code search + suggest corrections. |
| `report-builder.js` | `/api/report-builder` | Custom report builder. |

### Orders & Fulfillment
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `orders.js` | `/api/orders` | Web/marketplace order management. |
| `fulfillment.js` | `/api/fulfillment` | Picklists, loadsheets, dispatch, COD settlements. |
| `couriers.js` | `/api/couriers` | Courier CRUD + ship/track (adapter pattern in `services/couriers/`). |
| `woocommerce.js` | `/api/integrations/woocommerce` | WooCommerce connect, product import, stock sync. |

### Restaurant
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `restaurant.js` | `/api/restaurant` | Floor plan, table management, tabs, kitchen order tickets. |
| `restaurant-inbox.js` | `/api/restaurant-inbox` | Restaurant order inbox. |
| `restaurant-kiosk.js` | `/api/restaurant/kiosk-tokens` | QR self-order kiosk token issue/list. |
| `public-restaurant.js` | `/api/public-restaurant` | **Mounted before tenant middleware** — QR menu public endpoint. |
| `kds.js` | `/api/kds` | Kitchen display system. |

### Bookings & Services
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `bookings.js` | `/api/bookings` | Appointment CRUD, services, staff. |
| `public-bookings.js` | `/api/public-bookings` | **Mounted before tenant middleware** — public booking flow. |
| `service-tickets.js` | `/api/service-tickets` | Workflow ticket CRUD. |
| `rentals.js` | `/api/rentals` | Rental contracts, asset check-out/in. |
| `rooms.js` | `/api/rooms` | Room CRUD, bookings, folio. |
| `treatment-plans.js` | `/api/treatment-plans` | Clinical treatment plans. |
| `treatment-plan-templates.js` | `/api/treatment-plan-templates` | Reusable plan templates. |
| `projects.js` | `/api/projects` | Service projects. |
| `contracts.js` | `/api/contracts` | Service contracts. |
| `subscriptions.js` | `/api/subscriptions` | Customer subscription billing. |

### Wholesale / B2B
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `field.js` | `/api/field`, `/api/admin/field-routes` | Wholesale field-rep app: today's route, GPS+selfie check-in, visit history, owner summary cards. Two permission tiers: the rep-self surface accepts either a narrow execute-only permission or the broader management permission; the owner-facing surfaces (all-reps visit log, route planning, summary cards) require the management permission. The default Field Rep role holds only the narrow execute permission. |
| `manufacturer-partners.js` | `/api/manufacturer-partners` | Manufacturer-partner CRUD backing the brand-scoped partner portal. |

### Customer-Facing
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `customers.js` | `/api/customers` | See above. |
| `loyalty.js` | `/api/loyalty` | Loyalty program rules + point calculations. |
| `return-policies.js` | `/api/return-policies` | Return policy definitions. |
| `messaging.js` | `/api/messaging` | Customer messaging inbox. |
| `marketing.js` | `/api/marketing` | Campaign management. |

### Setup & Config
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `setup.js` | `/api/setup` | First-run wizard. Seeds the base roles/outlet/receipt template with explicit ids and resets the corresponding sequences afterward — explicit-id inserts never advance a sequence's `nextval()` on their own. |
| `business-modules.js` | `/api/business-modules` | Self-service module toggles: page payload (cards + computed state + roles with access; multi-outlet tenants additionally see a per-outlet breakdown and default; enabled cards with a defined setup flow carry a checklist), an impact-preview route, a company-level toggle route, and a per-outlet toggle route. The company toggle requires a dedicated module-management permission; the other three additionally accept a narrower outlet-module-management permission — neither has a default role holder, so only administrators (via the blanket bypass) or an explicit grant reach them. Underlying rules live in `services/business-modules.js`. |
| `receipt-templates.js` | `/api/receipt-templates` | Receipt layout templates. |
| `email.js` | `/api/email` | Send receipt email. |
| `support.js` | `/api/support` | Support ticket submit + screenshot upload. |

### Misc / Infrastructure
| File | Mount prefix | What it does |
|------|-------------|---------------|
| `country-packs.js` | `/api/country-packs` | **Mounted before tenant middleware** — pre-seeded tax rates + flags for the signup flow. |
| `sandbox.js` | `/api/sandbox` | **No auth, mounted before tenant middleware** — test payment simulation, only reachable when a sandbox payment gateway is configured. |
| `storefront.js` | `/api/storefront` | **Mounted before tenant middleware** — public storefront API using the shared public tenant resolver. |
| `public-reservations.js` | `/api/public-reservations` | **Mounted before tenant middleware** — public restaurant reservation form. |

---

## Key Conventions & Gotchas

### Mounting order
Routes mounted **before** tenant middleware (no standard session context): `admin/`, `webhooks.js`, `receipts.js`, `customer-portal/`, `manufacturer-portal/`, `storefront.js`, `public-restaurant.js`, `public-bookings.js`, `public-reservations.js`, `country-packs.js`, `sandbox.js`, `gift-cards-public.js`. Never add `req.employee`-dependent logic to these files.

### registerAllRoutes.js
Contains inline health-check routes, feature-flag routes, middleware wiring (including the blanket permission-rules middleware and outlet-assignment enforcement), and a restore guard — not a pure orchestrator. Mounts every route module under its `/api/<domain>` prefix. Only edit it when adding a brand-new route module — never for domain-level changes.

### Auth on GET routes
Most authenticated tenant GETs use `requirePerm` or `requireAnyPerm`. Public GETs exist by design (receipts, country-packs, public bookings, storefront). Some authenticated GETs rely on shared auth/session context rather than an explicit permission guard — the rule is not absolute; check the specific file.

### Error conventions
Success: `res.json({...})` or `res.status(201).json({...})`. Client errors: `res.status(4xx).json({ error: "..." })`. Server errors: `res.status(500).json({ error: err.message })` in catch blocks. `validate(schema)` middleware returns 400 with `{ error, details }` automatically.

### Transactions
`deps.db.transaction(async (client) => {...})` — the client inherits the tenant's search path. For atomicity-critical flows, reads can go outside the transaction while writes go inside.

### Feature-flagged routes
Apply `requireFeature("<flag>")` as middleware, sometimes combined with `requireMode("<mode>")` for vertical-specific gating. See `backend/middleware/CLAUDE.md` for the flag/mode registry mechanics.

### Validation
`validate(schema)` middleware from `middleware/validate.js`, using Zod schemas in `backend/schemas/`. Not yet universal — check the specific route file.

### Boot guard
A boot-time assertion verifies four critical routes exist at startup and crashes boot if any are missing: bulk product import, bulk product delete, bulk product status, and the Shopify product-delete route. If you rename or remove one of these, update the assertion too.

### Webhook signature verification — per-provider, NOT one shared scheme

There are **four different inbound-webhook verification contracts** in this codebase and they are not interchangeable. Reusing the wrong one does not throw — it silently rejects every real delivery, and a rejected webhook just vanishes. Check this table before adding or "unifying" a verifier.

| Endpoint | Verified? | Signature header | Digest | Secret source | Verify before or after tenant resolution? |
|---|---|---|---|---|---|
| `/api/webhooks/xpay` | yes | gateway adapter's own | adapter | env (gateway API key) | before — no tenant needed |
| `/api/webhooks/meta` | yes | `x-hub-signature-256` | **hex**, `sha256=` prefix | **env app secret** (`META_APP_SECRET`) | **before** — secret is app-level |
| `/api/webhooks/whatsapp` | yes | `x-hub-signature-256` | **hex**, `sha256=` prefix | **env app secret** (`WHATSAPP_APP_SECRET`, falls back to `META_APP_SECRET`) | **before** — secret is app-level |
| `/api/webhooks/{foodpanda,careem}` | yes | aggregator-specific | **base64** | **encrypted per-tenant** (`integration_settings.webhook_secret`) | **after** — must route by store id first to find the secret |
| `/api/webhooks/daraz` | **no — deferred** | — | — | — | — |
| `/api/integrations/shopify/webhooks/*` | yes | `X-Shopify-Hmac-Sha256` | **base64** | encrypted per-connection | after |

**The secret-source split is the load-bearing distinction.** Meta signs with the app secret of *our* Meta app (tenants connect their Page/WABA to it), so the key is knowable without knowing the tenant — which is why verification runs first. The aggregators sign with a per-tenant secret, so routing must precede verification. Get this backwards and you either can't find the key or you process an unverified payload.

Implementations: `services/meta-webhook.js` (Meta/WhatsApp), `services/aggregator-orders.js:verifyWebhook` (aggregators), `shopify/utils.js:verifyWebhookSignature` (Shopify). All three return `{ ok, reason }` and compare in constant time.

**Replay windows are conditional.** Only apply one where the provider actually sends a *signed* timestamp — the aggregators do, Meta does not. Meta authenticity therefore rests on the signature alone; duplicate suppression rests on the handler's own idempotency (`web_orders` upserts `ON CONFLICT`). Note WhatsApp inbound messages have **no** idempotency on `external_id` — a replayed, validly-signed delivery would duplicate inbox rows.

**Daraz is deliberately unverified**, not overlooked. Its *outbound* scheme (`services/marketplace/daraz-client.js:_sign`) is parameter-based (sorted concat, hex, uppercased, `sign` param) and does not describe inbound pushes; the inbound contract is not published in any reachable doc. Guessing a format would fail-close a tenant's first real webhook, so it stays as-is pending the contract. Full rationale is in the comment above the handler — read it before "fixing" this.

**The `undefined === undefined` trap** (fixed, don't reintroduce): the Meta/WhatsApp GET handshakes compared `token === process.env.X`. With the env var unset — its actual state — omitting `hub.verify_token` made both sides `undefined` and the handshake echoed the challenge to anyone. Any secret/token comparison must first refuse when the expected value is **unset**, never compare two absent values. `tests/unit/meta-webhook.test.js` pins this.

### Permission-rules is live middleware, not a reference table
A declarative array of path-regex-to-permission rules is mounted as blanket middleware ahead of every route module — it runs in addition to, not instead of, each route's own guard, and a rule keyed on a path prefix also catches self-scoped sub-endpoints beneath it. Tightening a rule's required permission means auditing every sub-path under its regex before shipping the change.
