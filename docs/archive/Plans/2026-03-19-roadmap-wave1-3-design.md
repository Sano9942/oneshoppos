# SanoPOS Roadmap Waves 1-3 — Design Document

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build 15 features across 3 waves — customer communication, operational tools, integrations, AI insights, multi-channel, and PWA.

**Architecture:** Leverages existing infrastructure (Resend, nodemailer, ESC/POS, feature flags, receipt system) with new modules for import, courier dispatch, AI insights, and PWA.

**Tech Stack:** React 19, Tailwind CSS v4, Node.js + Express, PostgreSQL, no new major dependencies except `@anthropic-ai/sdk` for AI insights.

---

## Wave 1: Customer Communication + Operational Foundation

### Feature 1: Receipt Email to Customers

**Decision:** Tenant SMTP (nodemailer via `email_config`) first, Resend fallback if no SMTP configured.

**Backend:**
- `POST /api/sales/:id/email-receipt` — accepts `{ email }`, loads sale + items + payments + template, calls `buildReceiptEmailHtml()`, sends via tenant SMTP or Resend fallback
- Reuses existing `utils/receiptEmail.js` — no new template needed
- Rate limit: 5 receipt emails per sale (prevent spam)

**Frontend:**
- `POSReceiptModal.jsx` — add "Email Receipt" button after sale completes
- Email input field, auto-filled if customer has email on file
- Uses `useToast()` for success/error feedback

---

### Feature 2: Shareable Receipt URL

**Decision:** Public, no auth, identified by invoice number.

**Backend:**
- `GET /api/receipts/:invoiceNumber/public` — no auth required, returns sale + items + payments + store info (name, address, logo)
- Mounted before auth middleware (like `/api/health`)
- Multi-tenant: resolves tenant from sale's outlet → schema

**Frontend:**
- New public page: `ReceiptPublicPage.jsx` at `/receipt/:invoiceNumber`
- Read-only receipt with store branding, item table, payment breakdown, print button
- Mobile-friendly, clean layout

**Integration points:**
- Thermal receipts: QR code linking to `https://sanopos.vercel.app/receipt/{invoiceNumber}`
- Email receipts: "View online" link in footer
- WhatsApp sharing: includes receipt URL in message

---

### Feature 3: WhatsApp Receipt Sharing

**Decision:** wa.me links now, official WhatsApp Business API later.

**Implementation:**
- Utility function: `buildWhatsAppLink(sale, receiptUrl)` → returns `https://wa.me/?text=...`
- Message template: "Receipt from {storeName}\nInvoice: {invoiceNumber}\nTotal: {total}\nView: {receiptUrl}"
- "Share on WhatsApp" button in `POSReceiptModal.jsx` (green WhatsApp icon)
- Opens in new tab — user selects contact in WhatsApp

**No backend needed** — purely frontend link generation.

---

### Feature 4: Bulk Data Import

**Decision:** CSV + Excel (.xlsx) + downloadable templates.

**Backend:**
- `POST /api/import/products` — accepts multipart file upload, parses CSV/xlsx, validates, bulk inserts
- `POST /api/import/customers` — same pattern
- `POST /api/import/suppliers` — same pattern
- `GET /api/import/template/:entity` — returns downloadable .xlsx template
- All endpoints require `all_access` permission
- Validation: check required fields, duplicate SKU/barcode detection, category/tax group lookup by name
- Transaction: validate all rows first → return errors → user confirms → bulk insert in single transaction

**Frontend:**
- New page: `ImportRedesign.jsx` at `/import` (admin-only)
- Three tabs: Products, Customers, Suppliers
- Each tab: download template button + drag-and-drop file upload + preview table showing parsed rows + error highlighting + "Import X rows" button
- Uses existing xlsx library (already bundled)

**Product template columns:** name, sku, barcode, category_name, brand_name, tax_group_name, selling_price, cost_price, stock_quantity, reorder_level, unit
**Customer template columns:** name, phone, email, address
**Supplier template columns:** name, contact_person, phone, email, address, credit_limit

---

### Feature 5: Backup Status Notifications

**Backend:**
- New table: `backup_log` (id, schema_name, status, size_bytes, duration_ms, error_message, created_at)
- Existing `backup-pg.js` writes to this table after each backup
- `GET /api/admin/backup-status` — returns latest backup per tenant schema

**Frontend:**
- Dashboard card (admin only): last backup time, status badge (green/amber/red), size
- Amber warning if > 24h since last backup, red if > 72h
- "Backup Now" button triggers manual backup

---

### Feature 6: FBR E-Invoicing Export

**Decision:** Export file first, real-time FBR API later.

**Backend:**
- `GET /api/reports/fbr-export?from=YYYY-MM-DD&to=YYYY-MM-DD` — generates FBR-compliant CSV
- FBR required columns: NTN, STRN, invoice_number, invoice_date, buyer_name, buyer_ntn, item_description, quantity, unit_price, tax_amount, total_amount, tax_rate
- Requires `e_invoicing_export` feature flag (already exists in defaults)

**Frontend:**
- New tab in Reports page (or standalone page): date range picker + "Download FBR Export" button
- Preview table showing generated data before download

---

### Feature 7: Onboarding Walkthrough

**Backend:**
- New column: `company_profile.onboarding_dismissed` (BOOLEAN, default false)
- `PUT /api/company-profile/onboarding-dismiss` — sets flag to true

**Frontend:**
- `OnboardingChecklist.jsx` component shown on Dashboard when `!onboarding_dismissed`
- Checklist items with completion detection:
  1. "Add your first product" → link to `/products/new` → complete when products count > 0
  2. "Set up an outlet" → link to `/outlets` → complete when outlets count > 1 (default outlet exists)
  3. "Open a shift" → link to `/pos` → complete when any shift exists
  4. "Make your first sale" → link to `/pos` → complete when sales count > 0
- Progress bar, checkmarks on completed items
- "Dismiss" button → calls API → hides permanently

---

### Feature 8: Self-Service Signup + Onboarding Email

**Backend:**
- `POST /api/auth/signup` — public endpoint, accepts `{ store_name, owner_name, email, password, plan }`
- Creates tenant in master DB → provisions schema → creates admin employee → sends welcome email via Resend
- Welcome email includes setup link (`/setup?token=xxx&tenant=slug`)
- Feature-flagged `self_service_signup` (off by default)
- Rate limited: 3 signups per IP per hour

**Frontend:**
- New page: `SignupPage.jsx` at `/signup`
- Form: store name, your name, email, password, plan selector (Free/Starter/Pro with feature comparison)
- Success state: "Check your email for setup instructions"

---

## Wave 2: Integrations

### Feature 9: Cloud Printing (Generic Network TCP/IP)

**Decision:** Generic TCP/IP ESC/POS commands to any network printer.

**Backend:**
- Extend `services/printer.js`: new `printToNetwork(ip, port, escPosBuffer)` function
- Uses Node `net.createConnection()` to send raw ESC/POS bytes over TCP
- `printer_config` table already exists — add `printer_type` (usb/network), `printer_ip`, `printer_port` columns

**Frontend:**
- `PrinterSettingsRedesign.jsx` — add "Network Printer" radio option
- When selected: IP address + port fields + "Test Print" button
- Test print sends a sample receipt to validate connection

---

### Feature 10: Payroll Export

**Backend:**
- `GET /api/hr/payroll-export?period_id=X` — generates CSV
- Columns: employee_name, department, days_worked, hours_total, overtime_hours, leave_days_taken, gross_pay, deductions, net_pay
- Uses existing attendance + payroll period + payroll line items data

**Frontend:**
- "Export Payroll" button on HR payroll tab
- Uses existing `downloadCsv()` utility

---

### Feature 11: AI Insights (Hybrid)

**Decision:** Pre-built insight cards (free, always-on) + optional Claude AI chat (feature-flagged, requires API key).

**Pre-built insight cards:**
- Backend: `GET /api/insights/auto` — runs analytical queries:
  - Revenue trend (% change vs last week/month)
  - Top product shift (what changed in top 5)
  - Low stock alerts count
  - Busiest hour/day pattern
  - Average transaction value trend
- Returns structured JSON array of insight cards
- No API key needed — pure SQL analytics

**AI chat panel:**
- Backend: `POST /api/insights/ask` — accepts `{ question }`
  - Gathers context: last 30 days sales summary, current inventory levels, top products, recent trends
  - Sends to Claude API with system prompt: "You are a retail analytics assistant for {storeName}..."
  - Returns Claude's response
  - Rate limit: 20 queries/day per tenant
- Requires `ANTHROPIC_API_KEY` env var + `ai_insights` feature flag
- Frontend: floating "Ask AI" button on dashboard → opens chat panel
- Chat history within session (not persisted)

---

## Wave 3: Multi-Channel & Advanced

### Feature 12: Mobile Manager PWA

**Decision:** PWA shell now, dedicated manager views later.

**Implementation:**
- `public/manifest.json` — app name, icons, theme color, start_url, display: standalone
- Service worker: cache static assets (JS/CSS/fonts), network-first for API calls
- `main.jsx`: register service worker in production
- Install prompt: browser-native "Add to Home Screen" banner

---

### Feature 13: WooCommerce Sync

**Architecture:** Mirror existing Shopify integration pattern.

**Backend:**
- New directory: `routes/woocommerce/` (mirroring `routes/shopify/`)
- Files: `auth.js` (WooCommerce REST API key setup), `import.js` (product import), `sync.js` (stock sync), `orders.js` (order import)
- WooCommerce REST API v3 — uses consumer key/secret auth
- Feature-flagged `woocommerce_integration`

**Frontend:**
- New page: `WooCommerceIntegrationRedesign.jsx` — mirrors `ShopifyIntegrationRedesign.jsx`
- Tabs: Connection, Products, Orders, Sync Log

**Deferred:** TikTok Shop, Instagram Shopping (lower demand, add when tenants request)

---

### Feature 14: Delivery / Courier Dispatch

**Decision:** Courier-agnostic plugin system — tenants configure their own preferred couriers.

**Database:**
- `courier_integrations` table: id, name, adapter_key, api_base_url, api_key (encrypted), api_secret (encrypted), tracking_url_template, enabled, config_json, created_at
- Pre-seeded rows (disabled): Leopards, TCS, BlueEx, Trax, PostEx, Rider, Call Courier, M&P, Bykea

**Backend adapter pattern:**
```
services/couriers/
  base-adapter.js       — interface: bookShipment(), getTracking(), cancelShipment()
  leopards-adapter.js   — Leopards API (first built-in adapter)
  tcs-adapter.js        — TCS API
  blueex-adapter.js     — BlueEx API
  generic-adapter.js    — manual tracking entry (no API, fallback for any courier)
```

Each adapter implements:
- `bookShipment({ order, sender, receiver, weight, cod_amount })` → `{ tracking_number, label_url }`
- `getTracking(tracking_number)` → `{ status, events[] }`
- `cancelShipment(tracking_number)` → `{ success }`

**Endpoints:**
- `GET /api/couriers` — list enabled couriers for tenant
- `POST /api/orders/:id/ship` — book shipment via courier adapter
- `GET /api/orders/:id/tracking` — get tracking status
- `PUT /api/couriers/:id` — tenant configures courier (API key, enable/disable)
- `POST /api/couriers` — tenant adds custom courier (name, tracking URL template)

**Frontend:**
- Settings → Delivery Couriers page: list of available couriers, enable/disable toggle, API key fields
- "Add Custom Courier" button for unlisted couriers
- Order detail → "Ship" button → select courier → auto-book or manual tracking entry
- Tracking timeline in order detail

**Rollout:** Feature-flagged `delivery_dispatch`. Phase A (generic UI + manual tracking) first, then Leopards adapter, then TCS/BlueEx as demand dictates.

---

### Feature 15: CRM/Marketing Sync + Inventory Marketplace

**Deferred** to tenant demand. When built:
- Customer export to Mailchimp/HubSpot (CSV first, then API)
- Product listing on Daraz/Facebook Marketplace
- Same adapter pattern as courier dispatch

---

## Architecture Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Receipt email transport | Tenant SMTP → Resend fallback | Free for tenants with SMTP, works for those without |
| Public receipts | No auth, by invoice number | Industry standard, data isn't sensitive |
| WhatsApp | wa.me links now, official API later | Zero cost/setup, covers top use case |
| Bulk import | CSV + xlsx + template download | Template reduces errors, xlsx already bundled |
| FBR | Export file first, real-time API later | FBR API unreliable, export covers compliance |
| Cloud printing | Generic TCP/IP ESC/POS | One code path, works with all brands |
| AI insights | Pre-built cards + optional Claude chat | Value without API key, premium differentiator with |
| PWA | Shell now, manager views later | Trivial to ship, defer UX decisions to real feedback |
| Courier dispatch | Adapter pattern, tenant-configured | Tenants choose their own couriers, we add adapters over time |
| WooCommerce | Mirror Shopify pattern | Proven architecture, 9-file template exists |

## Migration Requirements

- `backup_log` table
- `company_profile.onboarding_dismissed` column
- `courier_integrations` table + pre-seeded rows
- `printer_config` columns: `printer_type`, `printer_ip`, `printer_port`

## Feature Flags (new)

- `self_service_signup` (default: off)
- `ai_insights` (default: off)
- `delivery_dispatch` (default: off)
- `woocommerce_integration` (default: off)
- `e_invoicing_export` (already exists)
