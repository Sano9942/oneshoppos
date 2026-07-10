# SanoPOS - Project Guide for Claude

> **Note**: This guide is accurate as of the last update, but code evolves fast. When in doubt, check actual source files (`backend/migrate-pg.js` for migrations, `package.json` for test tools, route files for API contracts). Always verify against code before making critical implementation decisions.

## What This Is

A full-stack, multi-tenant Point of Sale (POS) system with Shopify/marketplace integrations, wholesale/B2B distribution features, and vertical presets (retail, restaurant, clinic, rental, salon/rooms).

- Backend: Node.js + Express v5 + PostgreSQL (via `pg` pool, `backend/db-pg.js`)
- Frontend: React 19 + Vite 7 + Tailwind CSS v4
- **Database: Postgres ONLY (active)** — SQLite archives exist (`backend/archive/`, `backend/archive/legacy/`) for historical purposes, but all active code uses Postgres only. Schema source of truth: `backend/schema-pg.sql`.
- **Multi-tenant is LIVE** — `MULTI_TENANT=1` on Railway, `VITE_MULTI_TENANT=1` on Vercel

## Sub-Guides (loaded automatically when working in those directories)

- **`backend/CLAUDE.md`** — Postgres query patterns, middleware chain detail, DB routing internals, per-file middleware reference, key conventions, environment variables
- **`frontend/CLAUDE.md`** — app composition, route wrapper skip list, conventions (Tailwind v4, timestamps, currency, API calls), POS architecture, provider hierarchy, test suites

Deeper per-directory `CLAUDE.md` files exist under `backend/routes/`, `backend/services/`, `backend/middleware/`, `backend/workers/`, `backend/schemas/`, `backend/tests/`, `backend/shopify/`, `backend/utils/`, `backend/boot/`, and various `frontend/src/*` subdirectories — read those when working inside the matching directory rather than asking here first.

## Efficiency Rules (Read First)

### Model Usage
- **Default to Sonnet** for all implementation tasks — code edits, file reads, bug fixes, route changes
- **Switch to Opus only** for architecture decisions, planning multi-step features, or when genuinely stuck on a complex design problem
- Once a plan is approved and execution starts, stay on Sonnet

### Reading Files
- **Grep first** — before reading any file, grep for the specific function/route/table name. Only read the file if grep result is insufficient
- **Read only what's needed** — never read a whole directory; read the single relevant file
- **No re-read after edit** — after a successful Edit or Write, do not re-read the file. Trust the tool unless it returned an error
- **One reference rule** — when adding a new route or component, read ONE similar existing file as reference, not multiple
- **Trust CLAUDE.md** — if the answer is documented here or in sub-guides, don't read source files to verify it

### Off-Limits Unless Explicitly Needed
- `backend/index.js` — middleware order and boot sequence are documented in `backend/CLAUDE.md`; don't read unless task is specifically about server config
- `backend/routes/registerAllRoutes.js` — route mounting is documented here; never read for domain-level changes
- `frontend/src/App.jsx` — composition only; route definitions in `frontend/src/routes/*.jsx`. Don't read unless task is about routing guards
- `backend/schema-pg.sql` — grep for specific table names instead of reading the whole file (it has hundreds of `CREATE TABLE` statements)

### Response Style
- No trailing summaries ("Here's what I did...") — the diff speaks for itself
- No restating the task before acting — just do it

## Project Structure

```
oneshoppos/
├── backend/
│   ├── index.js                  # Main Express server — orchestrator; worker startup in boot/workers.js, auth/perms/flags in middleware/
│   ├── db-pg.js                  # Postgres connection pool (query, transaction, getClient, end, pool). Pool size: 20. SSL disabled in non-prod. Does NOT load dotenv.
│   ├── schema-pg.sql             # Full DDL — single source of truth
│   ├── migrate-pg.js             # Postgres migration runner. exports { migrate, MIGRATIONS }. CLI: node backend/migrate-pg.js
│   ├── jwt-auth.js               # JWT sign/verify — signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, hashToken, defaults
│   ├── category-tree.js          # Category tree enrichment + resolveInheritedField (FBR HS code/tax inheritance)
│   ├── seed-admin-pg.js          # CLI: --email, --password (min 8), --name. Idempotent — prints existing ID and exits if already exists.
│   ├── swagger.js                # OpenAPI spec via swagger-jsdoc; served at /api-docs?key=API_DOCS_KEY
│   ├── start.sh                  # Railway entrypoint: sets TZ, runs migrate-pg.js, then exec node index.js
│   ├── railway.toml              # Dockerfile builder, healthcheck /api/health, restart config, /data volume mount
│   ├── routes/
│   │   ├── registerAllRoutes.js  # Contains inline health check routes, feature-flag routes, middleware wiring, and outlet-assignment enforcement
│   │   ├── admin/                # /api/admin/* — auth, tenants, monitoring, billing, operations, compliance, messaging, system — mounted BEFORE tenant middleware
│   │   ├── auth.js               # /api/auth/*
│   │   ├── sales.js              # /api/sales
│   │   ├── products.js           # /api/products
│   │   ├── returns.js            # /api/returns
│   │   ├── customers.js          # /api/customers
│   │   ├── employees.js          # /api/employees
│   │   ├── attendance.js         # /api/attendance + kiosk PIN endpoints
│   │   ├── inventory.js          # /api/transfers + /api/adjustments
│   │   ├── purchase-orders.js    # /api/purchase-orders
│   │   ├── grn.js                # GRN + supplier payables
│   │   ├── setup.js              # /api/setup/* (first-run wizard)
│   │   ├── receipts.js           # /api/receipts (public shareable receipt)
│   │   ├── import.js             # /api/import (bulk CSV/XLSX import)
│   │   ├── couriers.js           # /api/couriers (delivery dispatch)
│   │   ├── woocommerce.js        # /api/integrations/woocommerce
│   │   ├── insights.js           # /api/insights/auto (pre-built analytics cards)
│   │   ├── insights-ai.js        # /api/insights/ask (Claude AI chat)
│   │   ├── support.js            # /api/support/* (tickets + screenshot upload)
│   │   ├── billing.js            # /api/billing/* (subscription billing + payment checkout)
│   │   ├── webhooks.js           # /api/webhooks/* (payment gateway + marketplace webhooks, no auth) — mounted BEFORE tenant middleware
│   │   ├── fbr.js                # /api/fbr/* (FBR config, dashboard, retry)
│   │   ├── tax-lookup.js         # /api/tax-lookup (HS code search, suggest)
│   │   ├── fulfillment.js        # /api/fulfillment/* (picklists, loadsheets, dispatch)
│   │   ├── receipt-templates.js  # /api/receipt-templates
│   │   ├── supplier-returns.js   # /api/supplier-returns
│   │   ├── customer-display.js   # /api/customer-display
│   │   ├── country-packs.js      # GET /api/country-packs/:country — no auth, pre-seeded tax rates + flags
│   │   ├── service-tickets.js    # CRUD workflow tickets (phase4_workflow_tickets gated)
│   │   ├── rentals.js            # Rental contracts, asset check-out/in (phase4_rentals gated)
│   │   ├── rooms.js              # Room CRUD, bookings, folio, check-in/check-out (phase4_room_management gated)
│   │   ├── treatment-plans.js / treatment-plan-templates.js # Clinical treatment plans + reusable templates (phase4_treatment_plans gated)
│   │   ├── field.js              # Field-rep mobile PWA: check-in/out, GPS+selfie, order capture (wholesale_field_sales gated)
│   │   ├── manufacturer-partners.js / manufacturer-portal/ # Manufacturer-partner directory (admin CRUD) + parallel manufacturer-portal auth/data routes
│   │   ├── restaurant.js / restaurant-kiosk.js / restaurant-inbox.js / restaurant/ # Floor plans, KDS, tabs, counter-mode customer kiosk, online ordering inbox
│   │   ├── customer-portal/      # Customer self-service portal routes (parallel JWT scope, mounted before tenant middleware)
│   │   ├── sandbox.js            # Test payment endpoints (sandbox mode only)
│   │   ├── reports/              # /api/reports/* (modular — includes fbr-export, clinical, multichannel)
│   │   ├── integrations/         # /api/integrations/* (hub, credentials, daraz, facebook, whatsapp, google-merchant)
│   │   ├── shopify/              # /api/integrations/shopify* (modular)
│   │   ├── tier4/                # Tier 4 features (accounting, approvals, notifications, crm, hr, commissions, report-builder)
│   │   └── [other domain files]  # taxes, categories, outlets, roles, brands, suppliers, promotions, orders, attribute-sets, barcode-expenses, parked-sales, shifts, projects, contracts, bookings, gift-cards(+public), loyalty, holds, tips, modifiers, price-books/price-lists/price-list-assignments, pos-devices, pos-layouts, scheduled-changes, smart-collections, subscriptions, customer-invoices, draft-orders, item-suggestions, inventory-intelligence, risk-controls, approval-policies, override-reasons, return-policies, outlet-tax-profiles, outlet-visibility, storefront.js, marketing.js, messaging.js, printer.js, kds.js, product-serials.js, schedules.js, van.js (wholesale van sales), backorders.js, batches.js (expiry/FEFO), classes.js (gym/studio), client-service-records.js, forms.js, handouts.js, member-kiosk.js, members.js, notification-settings.js, packages.js (prepaid credits), recalls.js, report-builder.js, stock-conversions.js, ai.js (content/invoice generation), commissions.js, etc.
│   ├── middleware/
│   │   ├── plan-limits.js        # requireActiveSubscription + requirePlanLimit (tenant plan cap + subscription enforcement)
│   │   ├── rate-limit.js         # Rate limiter config (global, auth, webhook, portal, booking)
│   │   ├── tenant-auth.js        # loadTenantAndPerms, resolveTenant, loadCompanyProfile, resolveContext
│   │   ├── permissions.js        # requirePerm, requireAnyPerm, requireContextOutlet, PERMISSION_RULES, role defaults
│   │   ├── feature-flags.js      # requireFeature, requireMode, flag cache, notification helpers
│   │   ├── validate.js           # Zod validation helper — validate(schema) middleware factory
│   │   ├── upload-validation.js  # Centralized MIME + extension whitelist for file uploads
│   │   ├── request-id.js         # UUID per request (X-Request-Id header) + Pino logging
│   │   ├── customer-auth.js      # Customer portal JWT auth — scope "customer", delegates tenant routing to services/public-tenant-context.js
│   │   └── manufacturer-auth.js  # Manufacturer portal JWT auth — scope "manufacturer", same pattern as customer-auth.js, plus partner status check
│   ├── schemas/                  # Zod schemas, one file per domain, consumed by validate(schema) middleware. admin.js has a few placeholder Update* schemas not consumed by any route — verify with grep before assuming a schema is wired up (pos-devices.js IS consumed by routes/pos-devices.js, unlike a stale prior note claimed).
│   ├── boot/workers.js           # Worker startup — mixes pg-boss jobs with `setInterval` pollers; not all workers are pg-boss
│   ├── shopify/                  # client.js, crypto.js (secret encrypt/decrypt + event logging), order-service.js, utils.js
│   ├── services/
│   │   ├── crypto.js             # Generalized AES-256-GCM encryption (all integrations). Format: enc:v1:{iv}:{tag}:{ciphertext}
│   │   ├── payment-gateway.js    # Payment gateway adapter (xPay, extensible to Stripe/JazzCash)
│   │   ├── marketplace/          # Marketplace API clients (base, daraz, meta-commerce, whatsapp, google-merchant)
│   │   ├── couriers/             # Courier adapter pattern (base, generic, 13 adapters: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex)
│   │   ├── printer.js            # ESC/POS thermal + network TCP/IP printer. printToNetwork(host, port, buffer) via raw TCP socket.
│   │   ├── logger.js             # Pino logger instance — always require this, never create another instance
│   │   ├── alerting.js           # In-memory sliding window counters. Emails via Resend on error spikes (10+/5min), DB pressure (>80%)
│   │   ├── email.js              # Unified sendEmail() + enqueueEmail() orchestrator
│   │   ├── email-templates.js    # HTML builder functions for all transactional email types
│   │   ├── fbr.js                # FBR API client, payload builders, queue helper
│   │   ├── boss.js               # pg-boss instance factory (shared Postgres-backed job queue) — always getBoss(), never new PgBoss()
│   │   ├── geo.js                # Geocoding + geofence distance helpers (wholesale field-sales check-in)
│   │   ├── manager-pin.js        # Manager PIN override verification (void/comp/price-override flows)
│   │   ├── moq.js                # Minimum-order-qty + case-pack enforcement (portal + field-rep order capture; POS bypasses)
│   │   ├── product-visibility.js # Customer-group catalog visibility resolution (wholesale Option C/C2)
│   │   ├── phase4-polling.js     # Shared polling helpers for phase4 vertical workers
│   │   ├── public-tenant-context.js # resolvePublicTenantDb() — tenant routing for portal auth modules (customer + manufacturer), bypasses resolveTenant
│   │   ├── stock-ledger.js       # decrementStock/incrementStock — the ONE shared "move on-hand stock" implementation (POS sale, quotation-convert, transfers, supplier returns, PO receive, stock count all funnel through it). Must run inside caller's deps.db.transaction(...); takes FOR UPDATE.
│   │   ├── tax-snapshot.js       # resolveTaxSnapshot() — the ONE shared per-line tax cascade (outlet tax profile → product tax_id → legacy gst → category-inherited → 0) every sale writer applies
│   │   └── [restaurant/clinic/rental/room/booking services] # restaurant-checks, restaurant-floor, restaurant-kds, modifiers, tips, booking-availability, booking-services, booking-reminders, rental-service, room-service, room-deposits, room-channel-sync, room-night-audit, treatment-plan-service, treatment-plan-deposits, service-tickets, contracts, projects, project-billing, customer-invoicing, quote.js, pricing.js, allocation.js, approval-policy.js, inventory-intelligence.js, catalog-scheduler.js, online-inbox.js, menu-schedule-resolver.js, marketing.js, messaging.js, sms.js, subscriptions.js, storefront-cart.js, reservation.js, retail-flag-preset.js, batch-stock.js, kit-engine.js, preset-apply.js, lifecycle-events.js, embedded-barcode.js, aggregator-orders.js, credit.js, backorder.js, commission-calc.js, promo-engine.js, recall-service.js, deposit-engine.js, waitlist.js, members.js, class-bookings.js, packages.js, forms.js, client-service-records.js, sms-templates.js, customer-notify.js, admin-login-alert.js, admin-totp.js, ai.js, import/
│   ├── workers/                  # pg-boss workers, one file per background job, each `<name>-worker-boss.js`. Covers email, FBR, cleanup, marketplace sync, rental/room overdue checks, subscription grace transitions, treatment plan reminders, ABC classification, anomaly detection, attendance auto-close, course release, hold expiry, KDS load snapshot, orphan schema scan, reservation + reservation-reminder, retail digest, shift auto-close. `tenant-job-context.js` exports withTenantContext() — prefer this over raw schema-string interpolation for new tenant-scoped workers.
│   ├── tenant-db-proxy-pg.js     # Primary MT proxy — AsyncLocalStorage + Proxy. exports: asyncStore, createDbProxy, getCurrentDb. Proxies query/transaction/getClient.
│   ├── tenant-db-manager-pg.js   # Per-tenant DB manager with short-lived cache, per-query search_path reset. exports: init, getDb, healthCheck, clearCache, closeDb, closeAll
│   ├── tenant-db-pg.js           # Older ALS proxy — checks out ONE pool client per request via runWithTenant. exports: asyncStore, getProxy, getStore, runWithTenant
│   ├── tenant-multer.js          # Multer storage factories: createProductImageStorage, createCompanyLogoStorage, createRestoreStorage. Requires req.tenantDir.
│   ├── master-db-pg.js           # Master tenant registry. exports: init, createTenant, getTenantBySlug, getTenantById, query. Manages the public-schema tenant registry tables.
│   ├── tenant-provisioner-pg.js  # exports provision(db, opts) and validateSlug(slug). Slug regex: ^[a-z0-9_]{3,40}$. Returns { tenantId, employeeId, outletId, setupToken }.
│   ├── scripts/seed-tax-rates.js # One-time seed for tax_rate_reference (Urdu-described HS codes)
│   ├── shared/                   # (reserved — constants currently inline in middleware/permissions.js + middleware/feature-flags.js)
│   └── utils/                    # tz.js, r2.js, receiptEmail.js, digestEmail.js, backup-pg.js, resendEmail.js, alertEmail.js, ics.js (calendar invite generation)
└── frontend/src/
    ├── App.jsx                   # Route orchestrator (composition only — route defs in routes/*.jsx)
    ├── api.js                    # Centralized API service layer — api.get/post/put/del/upload/raw (handles URL/auth/JSON/errors). All paths must include /api/ prefix.
    ├── auth/AuthProvider.jsx     # Patches window.fetch globally — all /api/ calls get auth headers automatically. Silent token refresh on 401+TOKEN_EXPIRED.
    ├── auth/authStore.js         # Token storage helpers
    ├── auth/adminAuthStore.js    # Admin session storage helpers (separate from tenant auth)
    ├── auth/customerPortalStore.js    # Customer portal session storage (slug-scoped localStorage)
    ├── auth/manufacturerPortalStore.js # Manufacturer portal session storage (slug-scoped localStorage)
    ├── config.js                 # API_BASE, IS_MULTI_TENANT, SENTRY_DSN, TURNSTILE_SITE_KEY, ENV_MODE, IS_PROD, IS_DEV — sole import.meta.env reader
    ├── types/                    # TypeScript declarations: auth.ts, api.ts (tsconfig: allowJs + noEmit). Includes isApiError(res) runtime guard.
    ├── routes/                   # Route config split: publicRoutes.jsx, appRoutes.jsx, adminRoutes.jsx, RouteLoading.jsx
    ├── contexts/
    │   ├── CurrencyContext.jsx   # useCurrency() → { symbol, code, fmt, refresh, denominations }
    │   ├── ToastContext.jsx      # useToast() → { toast, success, error, warning }. Max 3 visible, 4s auto-dismiss.
    │   └── PresetContext.jsx     # usePreset() → { labels, hasMode, label, enabled_modes, unit_vocabulary, pos_layout_mode, presetLoaded }
    ├── hooks/
    │   ├── useFeatureFlags.js    # { flags, loading } — uses raw fetch() intentionally (runs before interceptor wired). DO NOT pass inline {} as authHeaders each render.
    │   └── useReportFilters.js   # Shared filter state hook for report tab components
    ├── ui/                      # Square design system — light-only, tokens in ui/tokens.css (--ui-* vars)
    │   ├── primitives.jsx        # PageShell (title/subtitle/right props), SectionCard (children/className only), Button (tone not variant), Input, Select, Badge, Modal, Drawer, ConfirmDialog, TabBar, Toggle, Tooltip, FilterPill, EmptyState
    │   ├── tokens.css            # --ui-* CSS variables: black primary, hairline borders, flat/no shadow, pill buttons, Inter
    │   ├── Breadcrumbs.jsx       # Route-based breadcrumb nav (auto-derived from pathname). Skipped on dashboard, POS, kiosk, customer-display.
    │   ├── ErrorBoundary.jsx     # Named export { ErrorBoundary } — global + page-level. Reports to Sentry.
    │   ├── SupportWidget.jsx     # Floating support ticket widget
    │   ├── ImpersonationBanner.jsx # Amber banner during tenant impersonation
    │   ├── AnnouncementBanner.jsx  # Platform announcement banners (fetches /api/announcements/active)
    │   ├── SubscriptionBanner.jsx  # Global trial countdown / grace warning / expired state banner
    │   ├── PwaInstallPrompt.jsx  # Install-app prompt banner
    │   ├── FBRPromptBanner.jsx   # Nudges GST-registered tenants to enable FBR integration
    │   ├── MultiOutletEnabledBanner.jsx # Nudge banner when a 2nd outlet is added
    │   ├── StarRating.jsx        # Named exports: StarDisplay (read-only) + StarPicker (interactive)
    │   └── nav-config.js         # Sidebar nav entries, guarded by requiredPerm/requiredFlag/requiredMode
    ├── utils/
    │   ├── dates.js              # UTC + LOCAL timestamp formatters. fmtUtcDateTime/fmtUtcDate/fmtUtcTime + fmtLocalDateTime/fmtLocalDate/fmtLocalTime
    │   ├── receipt.js            # Receipt rendering — buildReceiptSections, buildReceiptHtml, printToHardware
    │   ├── categoryTree.js       # Category tree UI helpers
    │   ├── offlineQueue.js       # IndexedDB-backed offline queue (sale/return/check_in/field_order types)
    │   ├── chunkReload.js        # Stale-chunk recovery — reloads on vite:preloadError / unhandledrejection
    │   └── csvExport.js          # downloadCsv(headers, rows, filename) — use for all new pages, not inline Blob
    └── pages/
        ├── redesign/             # Most active tenant UI pages (*Redesign.jsx)
        │   ├── POSRedesign.jsx
        │   ├── pos/POSContext.jsx     # Composes ~8 domain hooks — all POS state + keyboard shortcuts, behind usePOS()
        │   ├── pos/POSShortcutsOverlay.jsx # F-key help modal
        │   ├── pos/cartMath.js        # Pure cart calculation functions (extracted for testability)
        │   ├── ProfileRedesign.jsx    # Employee profile page (PIN/password change)
        │   ├── MyTicketsRedesign.jsx  # Tenant-side support ticket viewer (/my-tickets)
        │   ├── BillingRedesign.jsx    # Trial countdown, Pay Now (gateway), payment history, upgrade requests
        │   ├── ImportRedesign.jsx     # Bulk CSV/XLSX import (products, customers, suppliers)
        │   ├── IntegrationsHubRedesign.jsx # Unified integrations hub (/settings/integrations)
        │   ├── CourierSettingsRedesign.jsx # Delivery courier configuration
        │   ├── WooCommerceIntegrationRedesign.jsx # WooCommerce sync
        │   ├── FBRSettingsRedesign.jsx  # FBR config (NTN, token, province, enable toggle)
        │   ├── FBRDashboardRedesign.jsx # FBR invoice queue dashboard
        │   ├── TaxLookupRedesign.jsx   # Tax rate lookup (province-aware search)
        │   ├── ManufacturerPartnersRedesign.jsx # Admin CRUD for manufacturer partners (wholesale secondary-sales)
        │   ├── RentalsRedesign.jsx     # Rental contracts, asset check-out/in
        │   ├── RoomManagementRedesign.jsx # Room CRUD, bookings, folio, check-in/check-out
        │   ├── ServiceTicketsRedesign.jsx # Workflow ticket board
        │   ├── TreatmentPlansRedesign.jsx # Clinical treatment plan management
        │   ├── field/                  # Field-rep mobile PWA pages (check-in, order capture, visit log)
        │   └── treatment/              # Treatment plan sub-pages (templates, per-patient views)
        ├── reports/              # Report domain modules (includes FBRExportTab, ReportsMultichannel)
        ├── dashboard/            # Dashboard components (includes InsightCards, AIChatPanel, BackupStatusCard, InfrastructurePanel)
        ├── shopify/              # Shopify tab modules
        ├── admin/                # Super-admin panel (AdminLogin, AdminLayout, AdminDashboard, AdminTenantList, AdminTenantDetail, AdminActivity, AdminEmails, AdminSupportTickets, AdminDeadLetters, AdminTaxRates)
        ├── portal/               # Customer self-service portal (separate auth via PortalAuthProvider)
        ├── storefront/           # Embedded storefront for Orders feature
        ├── LandingPage.jsx       # Public landing page (competitive positioning, pricing, login)
        ├── ResetPassword.jsx     # Public password reset page (/reset-password?token=xxx)
        ├── ReceiptPublicPage.jsx # Public shareable receipt (/receipt/:invoiceNumber)
        ├── SignupPage.jsx        # Public self-service signup (/signup)
        ├── Reports.jsx           # Reports orchestrator (NOT legacy)
        └── [*Route.jsx]          # Thin wrappers — never edit
```

## Key Architecture Facts

- Most API routes are in `backend/routes/<domain>.js` — read only the relevant file
- `registerAllRoutes.js` contains inline health check routes, feature-flag routes, middleware wiring, and outlet-assignment enforcement — not a pure orchestrator
- **Super-admin routes** (`routes/admin/`), **webhook routes** (`webhooks.js`), **customer portal routes** (`customer-portal/`), and **manufacturer portal routes** (`manufacturer-portal/`) are all mounted BEFORE `loadTenantAndPerms`/`resolveTenant` — none of them see `req.employee` or the ALS-proxied `deps.db`. Portal routes get `req.db` set directly by their own auth middleware.
- **Multi-tenant DB routing**: `deps.db` is a Proxy that delegates to tenant DB via AsyncLocalStorage. Middleware order: `loadTenantAndPerms` → `resolveTenant` → tenant `/uploads` → `loadCompanyProfile` → `resolveContext`
- **`backend/schemas/`**: a few Zod schema files may not be wired to any live route (e.g. `pos-devices.js` looked unused on last check) and `admin.js` has some schemas that look like placeholders — grep for the schema name's usage in `routes/` before assuming it's enforced.
- Internal product categories are hierarchical; leaf-only assignment
- Frontend: port 5173 (Vite dev), Backend: port 5000

## Middleware Chain (request lifecycle order)

```
1. helmet               — security headers (CSP + COEP disabled)
2. cors                 — CORS_ORIGIN (CSV) or localhost:5173
3. express.json(10mb)   — rawBody captured for /api/webhooks/* and /api/integrations/shopify/webhooks/*
4. malformed JSON handler — 400 instead of Sentry bubble for entity.parse.failed
5. /uploads static      — single-tenant static file serving
6. /r2/*key proxy       — streams R2 object (only when R2_PUBLIC_URL not set)
7. compression
8. cookieParser
9. globalLimiter        — global rate limit (skips POS burst paths: /api/sales, /api/products/search, /api/products/scan/, /api/orders)
10. requestId           — UUID per request (X-Request-Id header)

--- admin routes (routes/admin/) mount here — NO tenant context ---
--- webhook routes (routes/webhooks.js) mount here — NO auth; only `/api/webhooks/xpay` is HMAC/signature verified via `paymentGateway.verifyWebhook`; Meta, WhatsApp, and Daraz POST handlers are rate-limited but not signature-verified ---
--- customer portal routes mount here — customerPortalAuthLimiter/customerPortalOtpLimiter/customerPortalDataLimiter → loadCustomerAuth(deps) → handler ---
--- manufacturer portal routes mount here — manufacturerPortalAuthLimiter/manufacturerPortalDataLimiter → loadManufacturerAuth(deps) → handler ---

11. loadTenantAndPerms  — decode JWT, look up tenant, attach req.employee + req.employeePerms + req.tenantId
12. resolveTenant       — SET search_path to tenant schema, attach deps.db proxy
13. tenant /uploads     — serve tenant-specific uploaded files
14. loadCompanyProfile  — cache company_profile row → req.company (currency, timezone, FBR config)
15. resolveContext      — attach req.context (outlet, employee context from headers)

--- all tenant routes mount here ---

16. requirePerm / requireAnyPerm  — per-route permission check
17. requireFeature / requireMode  — per-route feature flag / mode check
18. validate(schema)              — per-route Zod request body validation
19. requirePlanLimit(resource)    — per-route plan cap check (POST only)
20. requireActiveSubscription     — blocks all writes if payment_status = 'expired'
```

Full per-file behavior (cache TTLs, error codes, retry semantics) is documented in `backend/CLAUDE.md` and `backend/middleware/CLAUDE.md` — read those before touching auth/tenant-resolution code.

## UX Features

- **No dark mode** — removed in the Square reskin. `utils/theme.js` does not exist; there is no `[data-theme]` toggle. The app is light-only, styled entirely off `--ui-*` tokens in `ui/tokens.css`. Don't reintroduce dark-mode logic without an explicit request.
- **Toast notifications**: `useToast()` from `contexts/ToastContext.jsx` → `{ success, error, warning, toast }`. Max 3 visible, 4s auto-dismiss. Provider order: `CurrencyProvider → ToastProvider → AuthProvider → PresetProvider`.
- **Profile dropdown**: Shows role, links to `/profile`, logout.
- **Employee profile page**: `/profile` route — account info, change PIN (`PUT /api/employees/:id/change-pin`), change password. Self-service, no admin perm required.
- **POS keyboard shortcuts**: F1=help, F2=discount, F3=park, F4=customer search, F5=parked sales, F8=remove last, F9=checkout, F10=clear cart, Esc=close modal. Work even when focus is in an input.
- **Breadcrumbs**: Auto-derived from `useLocation().pathname` via label map in `ui/Breadcrumbs.jsx`. Skipped on dashboard, POS, kiosk, customer-display.

## Customer Communication

- **Receipt email**: `POST /api/email/send-receipt-v2` — SMTP first (tenant `email_config`), Resend fallback. Reuses `buildReceiptEmailHtml()`.
- **Shareable receipt URL**: `/receipt/:invoiceNumber` public page. Backend: `GET /api/receipts/:invoiceNumber/public?tenant=slug`. No auth.
- **WhatsApp sharing**: `wa.me/?text=` link in POS receipt modal. Zero infrastructure — pure frontend link builder.

## Integrations

- **Bulk import**: `/import` page (admin-only). `POST /api/import/{products,customers,suppliers}` with `?preview=1` support. `GET /api/import/template/:entity` downloads .xlsx template.
- **WooCommerce**: `routes/woocommerce.js` — connect, import products, sync stock. Uses WooCommerce REST API v3 with consumer key/secret.
- **Cloud printing**: `services/printer.js` has `printToNetwork(host, port, buffer)` via raw TCP socket. `POST /api/print/test` for testing.
- **Courier dispatch**: `routes/couriers.js` — CRUD couriers, ship orders, get tracking. `services/couriers/` adapter pattern (base → generic → 13 adapters: leopards, tcs, blueex, trax, callcourier, mnp, postex, rider, swyft, bykea, pakpost, dhl, fedex). `courier_integrations` table with 13 pre-seeded couriers.
- **Integrations Hub**: Unified hub at `/settings/integrations` covering marketplace/channel + courier integrations. Feature-flagged `marketplace_integrations`. Routes: `routes/integrations/` (hub.js, credentials.js, daraz.js, facebook.js, whatsapp.js, google-merchant.js). Marketplace clients: `services/marketplace/` (base, daraz, meta-commerce, whatsapp, google-merchant). Credentials encrypted via `services/crypto.js` (AES-256-GCM). Background worker: `workers/marketplace-sync-worker-boss.js` (pg-boss, `MARKETPLACE_SYNC_WORKER_ENABLED=1`). Webhooks: `POST /api/webhooks/{daraz,meta,whatsapp}`.
- **FBR export**: `GET /api/reports/fbr-export?from=X&to=Y` — generates FBR-compliant CSV data.
- **FBR Digital Invoicing**: Real-time invoice posting to FBR DI API. Feature-flagged per tenant (`fbr_integration`, DB-seeded, not in `DEFAULT_FEATURE_FLAGS`). Sales/returns/voids enqueue payloads to `fbr_invoices` table. Background worker (`workers/fbr-worker-boss.js`, pg-boss backed) polls queue with exponential backoff retry (5 attempts: 60s → 5m → 15m → 1h → 4h). Routes: `routes/fbr.js` (config, dashboard, retry), `routes/tax-lookup.js` (HS code search, suggest corrections). Admin: `routes/admin/compliance.js` has tax rate CRUD + FBR health endpoint. Category-level HS code + tax inheritance via `category-tree.js:resolveInheritedField()`. Tax rate reference table (`tax_rate_reference`) in public schema with Urdu-described HS codes. Frontend: `/settings/fbr` (config), `/fbr` (invoice queue dashboard), `/tax-lookup` (rate search), `/admin/tax-rates` (super-admin CRUD).
- **Tax architecture**: `tax_mode` on company_profile + per-line tax snapshot on `sales`/`sale_items` — supports mixed-rate and tax-inclusive modes.
- **AI insights**: `GET /api/insights/auto` (pre-built analytics cards). `POST /api/insights/ask` (Claude AI chat, soft-gated by `ai_insights` in the route rather than via `requireFeature`, requires `ANTHROPIC_API_KEY`).
- **Self-service signup**: `POST /api/auth/signup` — creates tenant + admin employee + welcome email. Gated by `SELF_SERVICE_SIGNUP=1` env var. Rate-limited. Free (1 outlet, limited employees/products) or Pro (1 outlet default, unlimited employees/products, 45-day trial) plans. Dead tenant cleanup job removes tenants that never complete setup after 7 days.
- **Subscription lifecycle**: `requireActiveSubscription` middleware gates all business routes. Trial (45 days) → grace (7 days) → expired (read-only). Email worker sends `trial_warning`, `trial_ended`, `account_locked` automatically. Renewal emails (`renewal_due`, `renewal_overdue`) for paid tenants. `ui/SubscriptionBanner.jsx` shows trial countdown / grace warning / expired state globally.
- **Subscription billing**: `routes/billing.js` — `GET /api/billing/status` (includes `payment_enabled`, trial/grace status), `GET /api/billing/pricing`, `GET /api/billing/payment-history`, `POST /api/billing/request-upgrade` (manual path), `POST /api/billing/create-checkout` (gateway path). Admin billing UI in `AdminTenantDetail.jsx`. Tables: `plan_pricing`, `payment_records`, `upgrade_requests`, `payment_intents`.
- **Payment integration**: `services/payment-gateway.js` — gateway adapter (xPay implementation, extensible). `routes/webhooks.js` — `POST /api/webhooks/xpay` (HMAC-verified, mounted before tenant middleware). Feature-gated by `PAYMENT_GATEWAY`/`XPAY_API_KEY` env vars — when unset, system uses manual admin payments. Checkout flow: create intent → gateway redirect → webhook confirms → tenant auto-activated + payment record + confirmation email.
- **Unified Email Service**: `services/email.js` — single `sendEmail()` for all email types. Tenant->customer emails from `slug@sanopos.com`, platform->tenant from `noreply@sanopos.com`. `email_queue` table + `workers/email-worker-boss.js` (pg-boss backed, `EMAIL_WORKER_ENABLED=1`).
- **PWA**: `manifest.webmanifest` + service worker for installable app. The wholesale field-rep app is also a PWA (offline check-in/order queueing).
- **Serialized inventory**: `product_serial_numbers` + `sale_item_serials`. `products.serial_required` flag.
- **Restaurant**: Floor plans, KDS, tabs, tip capture/pooling, split bills, modifiers, course timing, online ordering inbox, counter-mode customer kiosk. Feature-flagged (`phase4_restaurant`, `phase4_restaurant_kds`, etc.).
- **Inventory intelligence**: ABC class (`product_abc_class`), cycle count schedules/sessions, lead-time/safety-stock columns, background `abc-worker-boss.js` classification job.
- **Fulfillment (shipping automation)**: Picklists, loadsheets, COD settlements, order shipments + tracking events. Feature-flagged (`phase5_shipping_automation`, `phase5_cod_reconciliation`).
- **Wholesale / B2B distribution** (Pakistan-market wedge, built in tiers, extends existing retail schema rather than a parallel stack):
  - **Credit & AR**: customer credit limits, block modes, payment terms, on-account sales linked via `sales.customer_invoice_id`, AR aging buckets, statements.
  - **Field sales**: mobile PWA at a field-rep route (`routes/field.js`, `pages/redesign/field/`) for GPS+selfie check-in/out against `field_visits`/`field_rep_routes`, geofenced via `services/geo.js` + `company_profile.field_geofence_meters`. "Field Rep" role has a minimal `manage_field_sales`-only permission set. Order capture posts to `POST /api/sales` with `field_visit_id` linking the sale back to the visit.
  - **Schemes/promotions**: `promotions` table extended with `slab_percent` type + `tier_rules` JSONB + brand scope + priority; `sale_promotion_applications` audit table freezes the applied snapshot.
  - **Secondary sales / manufacturer portal**: `manufacturer_partners` directory (brand-scoped, NOT customers — manufacturers monitor onward sales, they don't buy) with its own auth scope, JWT secret (`MANUFACTURER_PORTAL_JWT_SECRET`), session store, and portal UI at `/manufacturer-portal/:slug`. Admin CRUD at `/settings/manufacturer-partners`. Only `customers.city` is ever exposed to a manufacturer partner (PII invariant).
  - **Reorder + catalog rules**: portal/storefront reorder flow (web + in-store sales UNION, cart handoff via `?adopt=` URL param), MOQ + case-pack enforcement (`services/moq.js` — portal + field-rep only, POS bypasses), customer-group catalog visibility (`services/product-visibility.js`, `products.visibility` + `customer_group_products` — ungrouped customers see only `visibility='all'` products).

## Reliability & Monitoring

- **Structured logging**: Pino via `services/logger.js` + `middleware/request-id.js`. Every request gets UUID (`X-Request-Id` header). JSON in prod, pretty-print in dev. Tenant/employee context enriched after auth.
- **Error tracking**: Sentry (`@sentry/node` + `@sentry/react`). No-op without `SENTRY_DSN`/`VITE_SENTRY_DSN`. Errors tagged with tenant slug + request ID.
- **ErrorBoundary**: `ui/ErrorBoundary.jsx` — **named export** `{ ErrorBoundary }`, not default — global (full-page) + page-level (compact card). Reports to Sentry.
- **Alerting**: `services/alerting.js` — in-memory sliding window counters. Emails via Resend on error spikes (10+/5min), DB pressure (>80%), health check failures. `ALERT_EMAIL` env var.
- **Health checks**: `GET /api/health` (quick), `GET /api/health?deep=true` (checks Postgres + Resend with timeouts).
- **Uptime monitoring**: UptimeRobot pings `/api/health` every 5 min, emails on downtime.
- **Support tickets**: `POST /api/support/tickets` + `POST /api/support/upload` (R2). Floating widget on all authenticated pages. Admin viewer at `/admin/support`.
- **Dead letter queue**: `/admin/dead-letters` — failed webhook events with retry/dismiss actions.
- **Tenant impersonation**: `POST /api/admin/impersonate/:tenantId` — short-lived JWT with a per-token `jti` and hard-revoke support, amber banner, audit trail in `impersonation_sessions` table (now with `token_jti`/`revoked_at` columns). Actions tagged "(impersonated by Super-Admin)". Impersonation JWT is verified server-side (not decoded via atob() client-side).
- **Admin activity logging**: Most admin mutations call `logAdminAction()`, but some routes (tax/compliance mutations, email queue retry, announcement updates, backup verify) do not. Security events (login success/failure) logged to `admin_security_log`. Cross-tenant activity via `GET /api/admin/tenant-activity`.
- **Worker monitoring**: `GET /api/admin/worker-status` (in `routes/admin/system.js`) reads heartbeat globals (`global.__<name>WorkerStatus`) exposed by each pg-boss worker. `queueDepth` is a real `SELECT COUNT(*)` from the queue table. Dashboard shows running/stopped status, real queue depth, processed today.
- **Cleanup worker**: `CLEANUP_WORKER_ENABLED=1` env var. Removes tenants with no setup after 7 days.
- **Orphaned schema detection**: `GET /api/admin/orphaned-schemas` + `POST /api/admin/orphaned-schemas/cleanup`, backed by `workers/orphan-schema-scan-worker-boss.js`.
- **Infra monitoring**: `GET /api/admin/infra` — super-admin only. Queries `pg_stat_activity`, `pg_database_size`, `pg_statio_user_tables`, schema sizes, active slow queries (>1s). Optional `pg_stat_statements` (try/catch if extension unavailable).
- **Infra cache**: `public.infra_cache` table — keyed snapshots written by background workers for expensive cross-schema introspection results.
- **Announcements**: `GET/POST/PUT/DELETE /api/admin/announcements` (admin), `GET /api/announcements/active` (public, no auth). Tenant-side banner via `ui/AnnouncementBanner.jsx` in AppLayout.
- **Tenant notes**: `GET/POST/DELETE /api/admin/tenants/:id/notes` — admin-only CRM notes per tenant.
- **Support ticket replies**: `PUT /api/admin/support-tickets/:tenantId/:ticketId/reply` + in-app notification. Tenant-side "My Tickets" page at `/my-tickets`.
- **Boot guard**: `ensureCriticalRoutesRegistered()` in `index.js` — verifies 4 routes exist at startup; crashes boot if any missing: `POST /api/products/bulk-import`, `POST /api/products/bulk-delete`, `POST /api/products/bulk-status`, `DELETE /api/integrations/shopify/import/products`.
- **Row-level security**: RLS is enabled on every `public` schema table (migration v98). Backend connects as `postgres` (bypassrls), so this only blocks the Supabase PostgREST anon/authenticated auto-API from reading tenant registry data — it does not affect app queries. An idempotent every-deploy sweep (`enableRlsOnPublicTables`, called from `migrateAllTenants()`) re-covers any future public table so a forgotten migration can't leave a new table anon-readable.

## Running Tests

### Postgres Integration Tests (primary) + Unit Tests
- `npm test` or `npx vitest run backend/tests/integration/pg-batch1-crud.test.js` (requires `DATABASE_URL`)
- Integration files span numbered pg-batch files, phase batches, full-audit domain tests, pg-standalone files, and one legacy smoke-gate file — see `backend/tests/CLAUDE.md` for the current breakdown rather than counting here
- Unit tests: `backend/tests/unit/` + `frontend/tests/unit/` (Vitest)
- **Note**: Backend uses **Vitest**, not Jest (see `backend/package.json`). Exception: `reports_accuracy.test.js` uses Jest syntax — run with `npx jest`.
- **Local vs production DB**: `tests/helpers/vitest-setup.js` prefers `backend/.env.test` when present (local Postgres), falls back to `backend/.env` (Supabase). Both gitignored.
- Factory: `tests/helpers/createTestApp-pg.js` (isolated schema per test)

### Production E2E Tests (Playwright, full system audit against production)
- `cd frontend && npx playwright test tests/auth.spec.js`
- Self-contained Playwright specs at `frontend/tests/*.spec.js`, target `sanopos.com`
- Config: `playwright.config.js` (single config, no separate live/onboarding configs)
- Global setup: `global-setup.js` logs in once, saves `auth.json` + `token.json`
- Helpers: `helpers/auth.js`, `helpers/api.js`, `helpers/nav.js`
- Includes onboarding specs (`onboard-free`, `onboard-starter`, `onboard-pro`, `onboard-dental-clinic`, `onboard-physiotherapy`, `onboard-veterinary`) — create real test tenants, delete from `/admin` after each run
- Key gotcha: clock-in uses `/api/attendance/pin-checkin?tenant=${slug}` (NOT `/clock-in`)
- **Known reliability gap**: the shared test tenant these specs log into (`packagesmall`) has been deleted from production. `global-setup.js` only *warns* on login failure instead of failing the run, so specs silently proceed with a stale/invalid session and produce misleading pass/fail results. Verify the target tenant actually exists in `/admin` before trusting a green run, or re-provision it.

### Smoke Tests (competitive feature coverage)
- Location: `frontend/tests/smoke/` — bookings, catalog-advanced, commissions-reports, draft-orders-returns, insights-dashboard, invoicing-subscriptions, marketing-messaging, omnichannel-admin, phase5-pakistan, pricing-promotions, restaurant, service-workspace, storefront-public, workforce, and others — shared helpers (`cleanup`, `featureFlags`, `mockPaymentGateway`, `smokeRunId`)

### Legacy SQLite Tests (do not use unless explicitly asked)
- `smoke-gate.test.js` has pre-existing failures on main — do NOT investigate

## Authentication System

- **Dashboard login**: password-based (`POST /api/auth/login` or `/api/auth/mt-login` with `{ username, password }`)
- **Graceful fallback**: if no `password_hash` set, the password field is treated as a PIN (transition period)
- **Kiosk login**: PIN-only (`POST /api/auth/kiosk-login`) — unchanged, never uses passwords
- **POS session re-auth**: PIN-only via `/api/employees/validate-pin` — NOT `/api/auth/login`
- **Forgot password**: `POST /api/auth/forgot-password` → sends Resend email → `POST /api/auth/reset-password`
- **Reset page**: `/reset-password?token=xxx&tenant=slug` (public, no auth)
- **Resend email service**: system-level transactional emails (`RESEND_API_KEY` env var on Railway)
- **Nodemailer/SMTP**: tenant-level emails (receipts, digest, CRM) — uses `email_config` table per tenant
- **Customer portal**: separate JWT (`CUSTOMER_PORTAL_JWT_SECRET`). Session stored slug-scoped in localStorage via `auth/customerPortalStore.js`.
- **Manufacturer portal**: separate JWT (`MANUFACTURER_PORTAL_JWT_SECRET`), scope `"manufacturer"`. Session stored slug-scoped via `auth/manufacturerPortalStore.js`. Structurally near-identical to the customer portal auth module but has drifted on TTL defaults and status-check details — check both if fixing a shared bug.
- **JWT access token payload**: `{ tid, eid, rid, oid, scope, jti }` (jti = random UUID per token). Access: 24h default. Refresh: 7d default, SHA-256 hashed before DB storage.

## Permission System

- **Roles**: Administrator (`all_access`), Manager (broad permission set), Cashier (view_reports, pos_discount, pos_park), Field Rep (`manage_field_sales` only — minimal role for the wholesale mobile order-booker app)
- **Middleware**: `requirePerm("perm")` and `requireAnyPerm(["perm1", "perm2"])` in route handlers
- **Frontend**: `hasPerm("perm")` from `useAuth()` — returns true if `all_access` or specific permission
- **Admin-only routes**: employees CRUD, outlets, email config, printer config, roles, action-history logging
- **Manager+Admin routes**: products (write), orders, purchase orders, inventory, attribute sets, barcode print jobs, restaurant ops (`manage_restaurant`), KDS (`manage_kds`), bookings (`manage_bookings`), projects (`manage_projects`), contracts (`manage_contracts`), service tickets (`manage_tickets`), rentals (`manage_rentals`), room management (`manage_rooms`), treatment plans (`manage_treatment_plans`), tips (`manage_tips`), void/comp override (`override_void_comp`), gift cards (`manage_gift_cards`), price override (`override_price`), credit-limit override (`override_credit_limit`), field-sales management (`manage_field_sales`)
- **All authenticated**: view reports, read-only data, send receipts, POS operations
- **All GET routes require auth** — `requirePerm` or `requireAnyPerm` on every data-returning GET

## Migrations

- **Current version**: check `backend/migrate-pg.js` (`MIGRATIONS` array) for the authoritative latest version and description — this section summarizes the shape of the history, not an exact head number, because it drifts (v130 at last check)
- Early waves (roughly v1-v30): Core features (auth, billing, FBR, email, KDS, products, feature flags, etc.)
- Next waves (roughly v31-v49): Tenant preset engine (service tickets, clinic extension, decimal quantities, payment sandbox, rentals, portal auth, rooms, treatment plans), walk-in staff assignment, mode-gate backfill, NUMERIC widening, treatment plan templates, appointment deposits, tax-inclusive room rates
- Restaurant expansion wave: infra_cache, split-bill, modifiers, course timing, KDS routing rules, online ordering inbox, tip capture/pooling, several restaurant waves
- Retail/inventory hardening wave: gift cards/loyalty, manager price override, variant outlet stock, serialized inventory, return reason codes, schema hygiene, inventory intelligence hub (ABC class + cycle counts), layaway/holds, per-device quick grid, anti-theft shrinkage tracking, refund idempotency, merchant home preference, receipt designer + shift auto-close
- Retail launch + dedup wave: retail launch flags, email verification columns, loyalty-tier/chart-of-accounts/courier-integration dedup fixes, products.sku partial unique index, tax_mode + per-line tax snapshot, backup_log column union
- Restaurant kiosk + wholesale wave (most recent): customer order kiosk (counter-mode tablet), tenant legal-consent tracking, Tier 0 wholesale foundation (AR aging), Tier 0.1 wholesale (credit limits/payment terms + hotfix), Tier 1.1 wholesale field sales (geocoding, geofence, field visits/routes, Field Rep role + hotfix), Tier 1.2 field sales (sale↔visit link), Tier 1.3 wholesale schemes (slab_percent promotions + audit table), Tier 1.4 wholesale secondary sales (manufacturer partners), Tier 2.2 MOQ, Tier 2.11 catalog visibility, impersonation jti/revocation columns, and the public-schema RLS enablement sweep
- **migrate-pg.js CLI**: `node backend/migrate-pg.js` — migrates public schema AND all `status='active'` tenant schemas sequentially
- **Tenant migration gotcha**: existing tenants need `schema_version` table seeded with previous versions before first run — otherwise migrate sees version 0 and tries to re-apply v1 (idempotent but slow)
- **Per-tenant failures**: caught and logged per-tenant — one failed tenant doesn't block others
- **Every-deploy RLS sweep**: `migrateAllTenants()` unconditionally re-runs `enableRlsOnPublicTables()` against the public schema on every boot, independent of version gating — see the RLS note under Reliability & Monitoring

## Live API Contracts (check actual route files for current behavior)

- **Sales POST**: body uses `cartItems` (not `items`), item `id` (not `product_id`), item `price` (not `unit_price`)
- **Returns POST**: needs `original_sale_id`, `total_refund`, `refund_method`; items need `refund_price`
- **Dashboard fields**: `totalRevenueToday`, `saleCount`, `averageBill`
- **Accounting**: `from`/`to` params (not `start`/`end`); requires `accounting_core` feature flag
- **Shifts**: no status filter on `GET /api/shifts` — use `GET /api/shifts/active?outlet_id=1`
- **Action history**: `date_from`/`date_to` params
- **Notifications mark-read**: `PUT /api/notifications/read-all` (not POST)
- **Kiosk MT mode**: `/kiosk?tenant=<slug>` required for unauthenticated endpoints
- **Reports that exist**: `item-wise`, `inventory-dump`, `product-movement`, `cash-flow`, `shift-summary` (needs `session_id`), `shrinkage`
- **Quotations**: must PUT status to `accepted` before `convert` works
- **Sales table**: timestamp column is named `timestamp` NOT `created_at`
- **Report date params**: most tabs use `date_from`/`date_to`; `ReportsMultichannel` and `FBRExportTab` use `from`/`to`

## Production Deployment

- **Frontend**: `https://sanopos.com` (Vercel, custom domain — `sanopos.vercel.app` still works as fallback)
- **Backend**: `https://api.sanopos.com` (Railway custom domain; `oneshoppos-production.up.railway.app` still works as fallback)
- **Super-admin**: `https://sanopos.com/admin`
- **Database**: Supabase Postgres, `public` schema holds the master tenant registry + cross-tenant queue tables (tenants, admin_activity_log, admin_security_log, tenant_notes, announcements, broadcast_log, payment_intents, email_queue, fbr_invoices, pgboss job tables, infra_cache, etc.), tenant data lives in `tenant_<slug>` schemas
- **Resend**: `RESEND_API_KEY` env var on Railway for system emails (password reset, alerts, welcome). Sender: `RESEND_FROM_EMAIL=SanoPOS <noreply@sanopos.com>` (custom domain, SPF/DKIM/DMARC verified on `sanopos.com` via Cloudflare)
- **Sentry**: `SENTRY_DSN` on Railway (backend), `VITE_SENTRY_DSN` on Vercel (frontend) — sanopos.sentry.io
- **Alerts**: `ALERT_EMAIL` env var on Railway — receives error spike / DB pressure / support ticket notifications
- **Uptime**: UptimeRobot monitors `/api/health` every 5 min
- **Railway env vars**: `MULTI_TENANT=1`, `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN=https://sanopos.com,https://www.sanopos.com,https://sanopos.vercel.app`, `TZ=Asia/Karachi`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SENTRY_DSN`, `ALERT_EMAIL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `FBR_WORKER_ENABLED=1`, `EMAIL_WORKER_ENABLED=1`, `CLEANUP_WORKER_ENABLED=1`
- **Railway gotchas**: `PORT` env var is overridden by Railway (binds to 8080); this is fine
- To seed super-admin: `railway run node backend/seed-admin-pg.js --email <email> --password <password> --name <name>`
- See `backend/CLAUDE.md` for full environment variable reference

## CLI Tools & Service Access

Claude has authenticated CLI access to the full production stack. Credentials stored in `.claude/settings.local.json` (gitignored).

| Service | Tool | What It Does |
|---------|------|-------------|
| **GitHub** | `gh` CLI | PRs, issues, repo management (account: Sano9942) |
| **Vercel** | MCP tools | Deployments, build logs, runtime logs |
| **Railway** | `railway` CLI | Deploy logs, env vars, service status (project: `oneshoppos`) |
| **Supabase** | `npx supabase` | DB management, project info (project ref: `tpjewvfoqtskscmwjtjj`) |
| **Sentry** | `sentry-cli` | Error tracking, issues, releases (org: `sanopos`, projects: `node-express` + `sanopos-frontend`) |
| **UptimeRobot** | REST API via curl | Monitor status, uptime history (monitor-specific key) |
| **Cloudflare** | REST API via curl | DNS management for `sanopos.com` (token in `settings.local.json`) |

## Infrastructure Capacity

> **Always verify tier before relying on this section.** Supabase / Railway / Vercel plans change. Confirm via:
> - Supabase: project dashboard → Billing, or `mcp__claude_ai_Supabase__get_organization`
> - Railway: `railway status` + dashboard billing
> - Vercel: `mcp__claude_ai_Vercel__list_teams`

### Current Stack Tier

| Service | Plan | Key Limit |
|---------|------|-----------|
| **Supabase** | **Pro** ($25/mo) | Daily auto-backups + 7-day PITR, 8GB DB included, ~200 max Postgres connections, no auto-pause |
| **Railway** | Hobby/Pro | Single Node.js instance, single-threaded event loop |
| **Vercel** | Pro | 100GB bandwidth/mo — not a bottleneck |
| **Cloudflare R2** | Free tier | 10M reads/mo free, then $0.015/M — negligible at current scale |

### DB Connection Pool

- Pool size: **20 connections** (hardcoded in `backend/db-pg.js`)
- All tenants share this pool — no per-tenant pooling
- **Supabase Transaction Pooler is ENABLED** (verified via `pg_stat_activity`: `application_name='Supavisor'`). Railway `DATABASE_URL` connects on port `6543` (transaction-mode pooling), NOT direct port `5432`. Each app-side connection only holds a real Postgres connection for the duration of a query, not the full request lifecycle.
- **Caveat**: transaction-mode pooling does NOT preserve session-level features across queries — `LISTEN/NOTIFY`, prepared statements, `SET SESSION`, advisory locks held across statements won't work. Codebase doesn't use any of these today (parameterized `$1/$2` queries only, pg-boss handles its own LISTEN via direct connection). If a future feature needs session-level Postgres, that connection must go via direct port `5432`, not the pooler.

### Realistic Pro Tenant Capacity

| Scenario | Tenant Count |
|----------|-------------|
| **Current (Transaction Pooler ON, port 6543)** | **300+ Pro tenants** |
| Hypothetical: direct port 5432, no pooler | 50–100 Pro tenants (no longer applicable — pooler is live) |

### Backups (Supabase Pro)

- **Daily automated backups** retained 7 days (configurable to 14/30 in dashboard)
- **Point-in-time recovery (PITR)** for the last 7 days
- Restore via Supabase dashboard → Database → Backups, or `pg_restore` from a downloaded snapshot
- App-level `pg_dump` to R2 (`POST /api/admin/backup` + `POST /api/backup/download`) is supplementary for tenant-self-export, not the primary DR strategy

## Storage Destination Map

### Supabase PostgreSQL — all transactional and config data

- **Sales**: `sales`, `sale_items`, `sale_payments` — every transaction, FBR IRN + QR code, tax snapshot (tax_rate_snapshot, tax_mode per line)
- **Customers**: personal info, loyalty points, wallet balance, CRM notes, purchase history, credit limit/payment terms (wholesale)
- **Products**: data, variants, pricing — `image_url` is a text column pointing to R2 URL. `serial_required` flag for serialized inventory. `min_order_qty`/`order_increment` (MOQ), `visibility` (catalog visibility).
- **Inventory**: stock levels per outlet (outlet_stock + variant_outlet_stock), transfers, adjustments, stock counts, cycle count sessions
- **HR**: employee records, hashed PINs (`pin_hash`), hashed passwords (`password_hash`), attendance, leave, payroll, `employee_type` classification (field rep vs in-store)
- **Finance**: POs, GRNs, supplier invoices/payments, expenses, journal entries, chart of accounts, postdated cheques, AR aging/statements
- **Wholesale field sales**: `field_visits`, `field_rep_routes`, customer geocoding (lat/lng), `company_profile.field_geofence_meters`
- **Manufacturer portal**: `manufacturer_partners`, brand mapping, refresh tokens — isolated from `customers`
- **Encrypted credentials** (AES-256-GCM in DB): Shopify tokens, Daraz/Facebook/WooCommerce API keys, courier API keys — format: `enc:v1:{iv}:{tag}:{ciphertext}`
- **Background queues** (public schema, cross-tenant): `email_queue` (full HTML body stored until sent), `fbr_invoices` (FBR API payloads), `pgboss` job tables, `public.infra_cache`
- **Logs**: `admin_activity_log`, `admin_security_log`, `action_history`, `impersonation_sessions` (now with `token_jti`/`revoked_at`), `backup_log` (metadata only)
- **JSONB blobs**: `support_tickets.screenshots` (R2 URLs), `fbr_invoices.payload/fbr_response`, `web_orders.raw_payload`, `integration_settings.config_json`, `promotions.tier_rules` (wholesale slab schemes)

### Cloudflare R2 — binary files only

Bucket: `sanopos-uploads` (env var `R2_BUCKET`)

| File Type | Path Pattern | Size Limit |
|-----------|-------------|-----------|
| Product images (WebP converted) | `products/{product_id}.webp` | 10MB |
| Additional product media | `products/{variant_id}/{filename}` | 10MB |
| Company/store logo | `company/{account_id}/logo.{ext}` | 5MB |
| Support ticket screenshots | `support/{random_id}.{ext}` | 5MB |
| Database backups | `backups/tenant_{slug}/backup_YYYYMMDD.sql.gz` | — |

**Fallback risk:** if R2 env vars missing on Railway, files fall to `backend/exports/` on the local filesystem — wiped on every Railway deploy. Always verify `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are set.

### Resend — transient delivery only, no permanent storage

Fires and forgets. Email HTML is stored in `email_queue` (Postgres) pre-send, then deleted after delivery.

| Email Type | Trigger |
|-----------|---------|
| Receipt | Customer purchase |
| Password reset | Forgot password |
| Welcome | New tenant signup |
| Trial warning / ended / locked | Subscription lifecycle (auto) |
| Payment recorded / expiry warning | Billing events |
| Renewal due / overdue | Billing cycle |
| Support ticket received / reply | Ticket flow |
| Daily digest | Scheduled report worker |
| Alert emails | Error spikes, DB pressure |

### What is NOT stored anywhere (by design)

| Thing | Why |
|-------|-----|
| Receipt PDFs | Rendered on-the-fly from DB data — no file saved |
| Report CSVs | Generated on demand, streamed to browser — not saved |
| Payment card data | Never touched — handled entirely by xPay gateway |
| Raw passwords/PINs | bcrypt hashes only |
| Resend email history | Not archived — `email_queue` is pre-send only |
</content>
