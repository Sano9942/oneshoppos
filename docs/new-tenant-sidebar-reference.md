# New Tenant Sidebar Reference — 2026-04-27

What a brand-new `general_retail` tenant sees in the left sidebar after sign-up, post-PR 1–9 retail launch.

This is a launch-readiness reference: it answers "what does the merchant actually see when they finish the wizard and land on the dashboard?" without re-tracing nav-config.js + feature-flag seeds + mode gates by hand each time.

Source files this document was derived from:
- [frontend/src/ui/nav-config.js](../frontend/src/ui/nav-config.js)
- [backend/services/retail-flag-preset.js](../backend/services/retail-flag-preset.js)
- [backend/middleware/feature-flags.js](../backend/middleware/feature-flags.js)
- [backend/config/industry-config.js](../backend/config/industry-config.js)
- [backend/middleware/plan-limits.js](../backend/middleware/plan-limits.js)
- [frontend/src/ui/SubscriptionBanner.jsx](../frontend/src/ui/SubscriptionBanner.jsx)

## Free vs Pro — Identical Sidebar

**Both Free and Pro tenants see the exact same sidebar.** Plan only gates resource caps, not feature visibility.

The actual Free/Pro differences:

| Difference | Free | Pro |
|---|---|---|
| Plan caps (enforced on POST routes) | 1 outlet, 3 employees, 100 products | 1 outlet default (pay-per-extra), unlimited employees, unlimited products |
| Subscription banner (PR 1) | Hidden (`SubscriptionBanner` returns `null`) | Trial countdown / grace warning / expired banner |
| Cap-hit interceptor (PR 3) | Same 403 → upgrade modal → `PlanUsageBanner` at ≥80% usage | Same |
| Add-outlet flow (PR 5) | Blocked by 1-outlet cap → upgrade prompt | `/billing/add-outlet` flow; 2nd outlet creation seeds 5 multi-outlet flags |

Feature flags are NOT plan-gated. Both see identical features.

## The Seed State

A fresh tenant signing up via `/signup` and picking `general_retail` lands on the dashboard with this resolved state:

### Modes
**Empty.** `general_retail` ships with `modes: []` in `industry-config.js`. No mode-gated nav appears.

### Multi-outlet flags
**Not seeded.** Free has 1-outlet cap so never fires; Pro fires on 2nd outlet creation (PR 5).

### Feature flags ON

**21 from `DEFAULT_FEATURE_FLAGS`:**
`accounting_core`, `crm_quotations`, `advanced_hr`, `multi_company`, `supplier_payables`, `approvals`, `notifications`, `backup_restore`, `marketplace_integrations`, `phase2_returns_policy`, `phase2_smart_collections`, `phase2_scheduled_changes`, `phase2_outlet_tax`, `phase2_pos_layouts`, `phase2_scheduling`, `phase2_report_builder`, `marketing_campaigns`, `customer_messaging`, `customer_invoicing`, `e_invoicing_export`, `receipt_designer_v2`

**19 from `RETAIL_SEED_FLAGS` (PR 2):**

*Core retail polish (8):* `phase2g_omni_input`, `phase2g_variant_picker`, `phase2g_price_override`, `phase2g_receipt_barcode_lookup`, `phase2g_per_line_restock`, `phase2_pos_approvals`, `phase2g_risk_controls`, `retail_weekly_digest`

*Opt-in extras (7):* `phase2g_gift_cards`, `phase2g_loyalty`, `phase2g_holds`, `phase2g_inventory_intelligence`, `phase2g_label_designer`, `phase2_draft_orders`, `phase2_item_suggestions`

*Integrations (4):* `phase5_cod_reconciliation`, `phase5_shipping_automation`, `phase5_sms_providers`, `sms_campaigns`

### Feature flags OFF (notable)

`fbr_integration` (until merchant fills FBR settings — PR 2 flips it ON), `subscription_billing`, `phase2_commissions`, `payment_links`, all `phase4_*`, `phase5_payment_gateways`, `phase2g_serialized_inventory`, `phase2g_price_books` (until 2nd outlet), `shift_auto_close`, `offline_returns`

## Sidebar Visible to a New Tenant

12 groups visible, ~60 nav items.

### Overview
- Dashboard

### Commerce (14 items)
POS · Orders · Fulfillment · **COD Settlements** (PR 2 seed) · Parked Sales · **Holds & Layaway** (PR 2 seed) · Customers · Customer Groups · Loyalty Tiers · **Gift Cards** (PR 2 seed) · Returns · Return Policies · Sales History · Cash Management

### Inventory (10 items)
Products · Categories · Brands · Taxes · Attribute Sets · Promotions · Price Lists · Review Moderation · Smart Collections · Scheduled Changes

### Stock Control (8 items)
Purchase Orders · Inventory Audit · Stock Adjustments · Transfers · Returned Stock · Supplier Payables · Reorder Alerts · **Intelligence** (PR 2 seed)

### Procurement (3 items)
Suppliers · Expenses · Approvals

### Insights (7 items)
Reports · Report Builder · Accounting · Chart of Accounts · Journal Entries · Credit/Debit Notes · Post-Dated Cheques

### Operations (7 items)
Kiosk · CRM · Quotations · Attendance · HR · Scheduling · Notifications

*Commissions hidden — requires `commissions` mode*

### Setup (13 items)
Employees · Outlets · Company Profile · Integrations · Courier Settings · Barcode Templates · Receipt Templates · Printer Settings · Import Data · Import from Shopify/Square · Backup & Restore · Outlet Tax Profiles · POS Layouts

### Marketing & Billing (3 items)
Campaigns · Inbox · Customer Invoices

*Subscriptions hidden — requires `subscriptions` mode*

### Online Store (1 item)
View Storefront

### Compliance (2 items at first)
FBR Settings · Tax Lookup

*FBR Invoices appears after merchant fills FBR Settings (PR 2 flips `fbr_integration` ON when valid NTN+token+province saved)*

### Admin (5 items)
Administrator · Action History · **Retail Risk** (PR 2 seed) · Billing · My Tickets

## Hidden Groups (Mode-Gated)

These entire groups are invisible to a `general_retail` tenant because the corresponding mode is not seeded:

| Group | Required mode |
|---|---|
| Restaurant | `restaurant` |
| Appointments | `appointments` |
| Projects & Contracts | `service_projects` |
| Service Tickets | `workflow_tickets` |
| Rentals | `rentals` |
| Rooms | `room_management` |
| Clinical | `treatment_plans` |

These are correct hides — they're for vertical-specific tenants, not retail. A `general_retail` merchant should never see "Floor Plan" or "Treatment Plans".

## UX Quirks Worth Knowing

**1. "FBR Invoices" appears mid-onboarding.** A PK tenant configures FBR in Settings → flag flips ON → "FBR Invoices" appears in Compliance group on next page load. Slightly jarring. The FBR prompt banner (PR 7) on the dashboard helps set this expectation.

**2. "Loyalty Tiers" has no flag gate in nav.** [nav-config.js:77](../frontend/src/ui/nav-config.js#L77) — `requiredPerm: "all_access"` only, no `requiredFlag`. Visible regardless of `phase2g_loyalty` state. PR 2 seeds the flag ON anyway for `general_retail` so it's consistent at launch, but a non-`general_retail` tenant created via admin would also see this entry.

**3. Multi-outlet sub-features have no nav entries.** When PR 5 fires on 2nd outlet creation, `phase2_outlet_pricing`, `phase2_outlet_visibility`, and `phase2g_price_books` flip ON — but these are backend gates only. The merchant sees no new sidebar items; the new behavior surfaces inside existing pages (Customer Groups gets a Price Book sub-page, Price Lists gets outlet assignments, products get outlet visibility toggles).

**4. Free tenants will never see multi-outlet UI.** They cannot create a 2nd outlet, so the 5 multi-outlet flags never seed. If they upgrade to Pro and add a 2nd outlet, the multi-outlet flags seed exactly once and persist (`multi_outlet_flags_seeded` column on `company_profile`).

## Click Behavior — What Each Item Does

One row per nav item. Purpose + what happens when the merchant clicks it.

### Overview

| Item | Purpose & Click Behavior |
|---|---|
| **Dashboard** | Lands on `/dashboard`. Auto-refreshes every 60s. Shows: today's revenue / sales count / avg bill, attention queue (low stock, overdue POs, failed FBR), 7-step onboarding checklist (PR 7), quick actions, recent sales, AI chat panel (if `ANTHROPIC_API_KEY` set). FBR prompt banner for PK tenants. |

### Commerce

| Item | Purpose & Click Behavior |
|---|---|
| **POS** | Opens `/pos` in a **new tab** (full-screen register). Scan barcodes, search, build cart, apply discounts, take payment (cash / card / split / wallet / gift card), print or email receipt, share via WhatsApp link. F-key shortcuts: F1 help, F2 discount, F3 park, F9 checkout, F10 clear. |
| **Orders** | Lists web orders + storefront orders. Filter by status (new, paid, fulfilled, refunded). Click an order → detail panel with payment, allocation, fulfillment timeline. |
| **Fulfillment** | Pick / pack / dispatch workflow for online orders. Generate picklists, loadsheets, scan-dispatch barcodes. Marks orders as shipped + writes courier tracking. |
| **COD Settlements** | Reconcile cash-on-delivery batches from couriers. Import remit file → match to orders → post to ledger. |
| **Parked Sales** | List of paused carts. Click to resume in POS — pre-fills items and customer. Useful for "customer left to grab another item." |
| **Holds & Layaway** | Customer reservations with optional deposit. Hold expires automatically (`hold-expiry-worker-boss` frees stock). Click to convert to sale or release. |
| **Customers** | Customer master. List + detail panel with 3 tabs: Profile (incl. wallet top-up), Ledger (wallet ledger + loyalty points), Order History. Blacklist with reason, segment by RFM. |
| **Customer Groups** | Group customers (e.g. "Wholesale", "VIP"). Drives group-level pricing and loyalty. After 2nd outlet, adds a Price Book sub-page per group. |
| **Loyalty Tiers** | CRUD loyalty tiers (Bronze / Silver / Gold etc.) with point multipliers and discount %. Tiers auto-upgrade based on customer spend. |
| **Gift Cards** | Admin issue + manage gift cards. Set value, expiry, recipient. Public balance-check page exists at `/gift-card/:code` (no auth) so customers can verify. |
| **Returns** | Look up an original sale, pick items to return, choose refund method (cash / wallet / gift card / store credit). Restocks inventory; `phase2g_per_line_restock` evaluates restock per line. |
| **Return Policies** | Define rules: return window in days, restocking fee, allowed reasons. Applied at return-time. |
| **Sales History** | All sales list, with filters (date range, outlet, employee, customer, payment method). CSV export. Click sale → reprint receipt, view items, void/refund. |
| **Cash Management** | Cash drawer state — open shift / close shift / cash counts / drops / pay-outs. Reconciles cash on hand vs expected at shift end. |

### Inventory

| Item | Purpose & Click Behavior |
|---|---|
| **Products** | Catalog list. Click "+" → product form (variants, attributes, taxes, images). Bulk import / export / status toggles. Image converted to WebP and uploaded to R2. |
| **Categories** | Hierarchical tree. Drag-drop reorder. Tax + HS code inherits down the tree (FBR uses this). |
| **Brands** | Simple list of brands. Used as filter/grouping on products. |
| **Taxes** | Tax rate CRUD. Province-aware. Outlets can override via Outlet Tax Profiles. |
| **Attribute Sets** | Templates for variants (e.g. "Apparel" = size + color). Reused across many products. |
| **Promotions** | Discount campaigns: % off, fixed off, BOGO, with date windows + customer/category targeting. |
| **Price Lists** | Tiered pricing — link a customer or customer group to specific prices for specific products. Applied automatically at POS. |
| **Review Moderation** | Approve / reject product reviews from storefront. Star rating + comment. |
| **Smart Collections** | Rule-based product groups (e.g. "Products with stock > 10 AND brand = X"). Auto-updates as catalog changes. |
| **Scheduled Changes** | Future-dated price or availability flips. `catalog-scheduler` worker fires them at the scheduled time. |

### Stock Control

| Item | Purpose & Click Behavior |
|---|---|
| **Purchase Orders** | PO lifecycle: draft → sent → received (becomes a GRN). Per-line costs, currency, supplier credit checks. |
| **Inventory Audit** | Physical stock counts. Generate count sheets, capture counted qty, post variance as adjustments. |
| **Stock Adjustments** | Write-on / write-off / damaged / wastage. Reason codes required. |
| **Transfers** | Move stock between outlets. In-transit status, partial receipt support. |
| **Returned Stock** | Stock that came back from customer returns. Decide: restock, write-off, or send back to supplier. |
| **Supplier Payables** | A/P aging — supplier invoices, due dates, payments. Click → record payment, attach cheque, mark settled. |
| **Reorder Alerts** | Items below reorder point. Click → generate PO directly from the alert. |
| **Intelligence** | 4 sub-tabs: ABC classification, aging, cycle counts, reorder. `abc-worker-boss` runs daily and writes the classifications. |

### Procurement

| Item | Purpose & Click Behavior |
|---|---|
| **Suppliers** | Supplier master with credit terms, contacts, payment history. |
| **Expenses** | Business expense tracking with category, receipt upload (R2), supplier link. Optional approval flow. |
| **Approvals** | Approval queue — POs above limit, manual discounts, returns, voids. Click → approve / reject with reason. |

### Insights

| Item | Purpose & Click Behavior |
|---|---|
| **Reports** | 20+ tabs: sales summary / detail, inventory health, finance, governance, exceptions, FBR export, commissions, multichannel, profit margin, etc. CSV export per tab. |
| **Report Builder** | Drag-drop custom report designer. Save as named report, schedule for email delivery. |
| **Accounting** | P&L, balance sheet, cash flow, AP/AR aging. Date-range filtered. |
| **Chart of Accounts** | COA tree CRUD. Pre-seeded with standard COA on tenant provision. |
| **Journal Entries** | Manual debit/credit entries. Multi-line, balanced check. |
| **Credit/Debit Notes** | A/R adjustments — credit memos for refunds, debit memos for chargebacks. |
| **Post-Dated Cheques** | Track future-dated cheques received from customers and issued to suppliers. Reminder when cheque date arrives. |

### Operations

| Item | Purpose & Click Behavior |
|---|---|
| **Kiosk** | Opens `/kiosk` in **new tab**. Public, no login. Employees punch PIN → clock in / clock out / break in / break out. Outlet locked if `kiosk_context_locked` flag is on. |
| **CRM** | Lead and opportunity tracking. Pipeline stages, follow-up reminders. |
| **Quotations** | B2B quotation flow. Create → send to customer → accept → convert to sale or invoice. |
| **Attendance** | View clock-in / clock-out logs, hours worked, leave balances, leave requests. |
| **HR** | Employee records, payroll, salary, deductions. Pro-tier features but not plan-gated. |
| **Scheduling** | Shift planning calendar. Assign employees to outlets / shifts. |
| **Notifications** | In-app notifications inbox — low stock alerts, overdue POs, failed FBR posts, support ticket replies, billing events. |

### Setup

| Item | Purpose & Click Behavior |
|---|---|
| **Employees** | Employee CRUD. Set role (Administrator / Manager / Cashier), PIN, password, outlet assignments. PIN min 4 digits. Subject to plan cap (3 for Free). |
| **Outlets** | Outlet locations. Free is capped at 1; Pro can buy additional via `/billing/add-outlet` (PR 5). 2nd outlet creation triggers multi-outlet flag seed. |
| **Company Profile** | Business name, logo, currency, timezone, address, FBR fields, email config. Logo uploaded to R2. |
| **Integrations** | Unified hub: Shopify, WooCommerce, Daraz, Facebook Shop, Instagram, WhatsApp, Google Merchant + 13 couriers + payment + SMS. Connect / disconnect / test / manual sync. (Daraz / Meta / WhatsApp / Google Merchant show "Manual sync only" disclaimer per the marketplace stub.) |
| **Courier Settings** | Configure shipping couriers — credentials, default service, weight rules. |
| **Barcode Templates** | Design barcode labels (size, format, what to print). Print job sent to thermal/sheet printer. |
| **Receipt Templates** | Customize receipt layout — header logo, footer text, fields shown, paper width. v2 designer (default ON). |
| **Printer Settings** | Configure thermal printers — USB, network TCP/IP, paper width (80mm / 76mm / 58mm). Test print button. |
| **Import Data** | Bulk import via CSV/XLSX: products, customers, suppliers, expenses, payments. Preview-then-confirm flow. |
| **Import from Shopify/Square** | One-time competitor migration. Pull catalog and customers from Shopify or Square via OAuth. |
| **Backup & Restore** | Trigger tenant backup → uploaded to R2 (`backups/tenant_{slug}/...sql.gz`). Restore from earlier backup. |
| **Outlet Tax Profiles** | Per-outlet tax overrides (e.g. different province rate per outlet). |
| **POS Layouts** | Customize the POS button grid per outlet (favorites, categories, payment buttons). |

### Marketing & Billing

| Item | Purpose & Click Behavior |
|---|---|
| **Campaigns** | Marketing email / SMS campaigns. Audience filters (group, tag, RFM segment), template, send / schedule. SMS sends gated by `sms_campaigns` runtime check + provider config. |
| **Inbox** | Unified messaging inbox — WhatsApp, SMS, email replies. Auto-resolves customer by phone number. Reply directly. |
| **Customer Invoices** | B2B invoicing. Generate `INV-000001` numbers, send via email with payment link (if `payment_links` ON), reminder schedule, payment recording. |

### Online Store

| Item | Purpose & Click Behavior |
|---|---|
| **View Storefront** | Opens public storefront `/store/{tenantSlug}` in **new tab**. Customer-facing catalog + cart + checkout. No auth needed. |

### Compliance

| Item | Purpose & Click Behavior |
|---|---|
| **FBR Settings** | Pakistani tenants only. Enter NTN, STRN, FBR API token, environment (sandbox/live), province, default HS code. Test connection button. Saving valid creds flips `fbr_integration` ON (PR 2). |
| **FBR Invoices** | Appears AFTER FBR is enabled. Queue of pending / posted / failed FBR invoices with retry button, IRN, QR code preview. `fbr-worker-boss` posts in background with retry. |
| **Tax Lookup** | HS code search with province-aware tax rate lookup. Suggest correction button (super-admin reviews). |

### Admin

| Item | Purpose & Click Behavior |
|---|---|
| **Administrator** | High-level admin shortcuts: feature flags, roles, permissions, password resets, SQL console (if enabled). |
| **Action History** | Audit log of mutations — who changed what, when, before / after. Date filterable, CSV export. |
| **Retail Risk** | Shrink + fraud anomaly scoring. `anomaly-worker-boss` scores transactions; this page shows flagged events. |
| **Billing** | Subscription state — trial countdown, payment history, upgrade card (Pro monthly 8000 PKR / annual 80000 PKR per outlet). Free→Pro checkout via `payment-gateway` adapter (currently `sandbox` until xPay env vars set). |
| **My Tickets** | Tenant-side support ticket viewer. Submit new ticket via floating widget; replies from super-admin appear here with notification. |

## Group-Wide Click Behaviors

**`newTab: true` items** open in a new browser tab instead of replacing the current view:
- POS — full-screen register UX
- Kiosk — public, no auth
- View Storefront — public storefront

**Permission gate inside the page**:
Most items have a `requiredPerm` in `nav-config.js` (e.g. `manage_inventory`). Since a new tenant's admin user has `all_access`, all gates pass. But if they later create a Cashier-role employee, that employee will only see the items their role permits — Cashier essentially sees POS + Customers + Returns + Sales History + Cash Management.

**Feature-flag gate inside the page**:
Most flagged pages also re-check the flag on mount and `<Navigate to="/" replace />` if off. So if an admin disables a flag mid-session, the user gets bounced back to the dashboard on next click.

## Refresh Triggers

Refresh this file when any of these change:

- New nav entry added to `nav-config.js`
- New flag added to `DEFAULT_FEATURE_FLAGS` or `RETAIL_SEED_FLAGS`
- Default value of any nav-relevant flag flipped
- New mode added that gates a nav group
- Plan caps in `plan-limits.js` changed
- Industry config defaults for `general_retail` changed
- New retail-launch PR ships changes to setup-wizard seed flow
- New page added to a sidebar group, or click behavior of an existing page materially changes
