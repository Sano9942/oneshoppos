# Competitive Analysis — SanoPOS vs Pakistan Market

**Date**: 2026-04-08 (updated after full system audit test suite — 308 integration + 162 unit + 92 E2E tests)
**Previous audits**: 2026-04-07 (competitive-waves + integrations-hub), 2026-04-03 (initial)

---

## Competitor 1: Assaan Retail (asaanretail.io)

### Overview
Assaan Retail is an **omnichannel OMS (Order Management System)** first, POS second. Their core advantage is **Daraz + multi-courier integration** — something pure POS systems rarely offer. They target retailers, e-commerce businesses, agencies, 3PLs, and D2C brands across Pakistan.

### Core Products (7 Modules)
1. **Inventory Management** — multichannel inventory sync
2. **Order Management** — multi-channel order handling from creation to fulfillment
3. **Warehouse Management** — multi-location inventory tracking
4. **Accounting Management** — financial management for small and large businesses
5. **Reporting & Analytics** — data-driven retail and e-commerce insights
6. **Point of Sales (POS)** — tax-compliant retail system
7. **Purchase Management** — supplier and purchase management tools

### Pricing

| Plan | Price | Order Limit |
|---|---|---|
| Essential | USD 0/mo | 0–500 orders/mo |
| Growth (Recommended) | USD 0/mo | 0–500 orders/mo |
| Enterprise | Custom | 5000+ orders/mo |

**PKR Pricing** (from schema):
- Startup: PKR 4,000/mo
- Growing: PKR 8,000/mo
- Professional: PKR 12,000/mo
- Enterprise: Custom

**Add-ons**: Location $65/mo, User $40/mo, Courier $10/mo, WhatsApp & IVR custom

**Billing options**: Monthly, Quarterly (10% off), Semi-annually (15% off), Yearly (20% off)

**Trial**: 14 days, no credit card

### Integrations (22 partners)

**Marketplaces**: Daraz, Shopify, WooCommerce

**Couriers (16)**: TCS, BlueEx, PostEx, CallCourier, Swyft, Rider, Trax, Steadfast, DoDeliver, Leopards, M&P, Fardar Express, eCourier, Smartlane, ShipNOC, InstaWorld

**SMS**: Monty Mobile

**POS**: FBR POS

**Notable clients**: Bagerz, Discounters, Kiho, Startup Pakistan, Paolo Rossi, Kidzmart, Hypercart, Giftcity, TracePK, Scents and Secrets, Warsak, Highstreet, Productify

### Feature-by-Feature: Assaan Retail vs SanoPOS

#### Order Management
| Feature | Assaan Retail | SanoPOS |
|---|---|---|
| Multi-channel order sync (Daraz + Shopify + WooCommerce) | Yes | **Yes** — Shopify + WooCommerce + **Daraz** (product sync, order pull, inventory push via `routes/integrations/daraz.js`) |
| Automated order confirmations (SMS, WhatsApp, Email, **IVR calls**) | Yes | WhatsApp link only, email receipts |
| Pick, Pack & Dispatch (scan-driven workflow with picklists + loadsheets) | Yes | **Yes** — `routes/fulfillment.js` with picklists, pick-scan, pack-scan, dispatch + loadsheet generation + CSV export |
| Order aging summary (flag stale orders) | Yes | **Yes** — `GET /api/orders/aging-summary` with 4 buckets (fresh/aging/stale/critical) + per-order aging_days |
| Order split (split fulfillment across locations) | Yes | **No** |
| Shipper advice management | Yes | **No** |
| Bulk order status updates | Yes | **Yes** — `PATCH /api/orders/bulk-status` with multi-select UI, Zod validation, max 100 orders |
| Returns, Refunds & Exchanges | Yes | **Yes** — full return + exchange flow (`POSReturnExchangeModal.jsx` with refund/exchange mode toggle, exchange creates return credit + new sale) |
| Customer blacklisting | Yes | **Yes** — `PUT /api/customers/:id/blacklist` + POS checkout block + red badge UI |
| Customer profiling (preferences, demographics) | Yes | **Yes** — extended fields (DOB, gender, city, tags[], customer groups, notes, preferred payment/contact), enriched profile endpoint with purchase summary + top products |
| Feedback & reviews management | Yes | **Yes** — `product_reviews` table, moderation queue, star ratings, verified purchase badges |
| Order tracking (real-time courier status sync) | Yes | **Yes** — 13 courier adapters (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) with tracking URL templates |
| Duplicate order detection | Unknown | **Yes** — idempotency key on sales prevents duplicate submissions |

#### Inventory Management
| Feature | Assaan Retail | SanoPOS |
|---|---|---|
| Real-time multi-location sync | Yes | **Yes** (stock transfers between outlets) |
| Inventory audit / stock counts via scan | Yes | **Yes** — `stock_counts` + `stock_count_items` tables, barcode scan-to-count, variance report, auto-adjust option |
| Product bundling / kits | Yes | **Yes** — `product_bundles` table, bundle components with qty, POS badge, stock deducted from components on sale |
| Inventory forecasting (predict stockouts) | Yes | **Yes** — `GET /api/reports/forecast-demand` (moving average velocity) + `GET /api/reports/replenishment-smart` (days_of_cover, suggested_reorder_qty, configurable 7–90 day lookback) |
| Low stock alerts | Yes | **Yes** — `notifyLowStockForSale()` in `feature-flags.js` creates in-app notifications when outlet stock <= 10 after sale. Shown in NotificationBell + DashboardInventoryAlerts |
| Multi-channel inventory sync (marketplace <-> warehouse) | Yes | **Yes** — Shopify + WooCommerce + **Daraz** (inventory push via `daraz-client.js`) + **Google Merchant Center** feed sync |
| Stock adjustments (shrinkage, damage) | Yes | **Yes** — full CRUD at `GET/POST/PUT/DELETE /api/adjustments` |
| Stock transfers between locations | Yes | **Yes** — `GET/POST /api/transfers` + reverse transfers |

#### Accounting & Finances
| Feature | Assaan Retail | SanoPOS |
|---|---|---|
| Chart of Accounts (customizable) | Yes | **Yes** — `chart_of_accounts` table with tree structure, 20 seeded Pakistan-standard accounts, CRUD + balance computation |
| Profit & Loss statements | Yes | **Yes** — `GET /api/accounting/pnl` (gross sales, discounts, returns, COGS, operating expenses by category, net profit, gross/net margins) |
| Balance sheets | Yes | **Yes** — `GET /api/accounting/balance-sheet` (assets: inventory value + cash on hand; liabilities: supplier AP + customer credit; equity) |
| Cash flow statements | Yes | **Yes** — `GET /api/accounting/cashflow` (inflows by payment method, outflows: expenses + supplier payments) + `GET /api/accounting/cashflow/daily` (per-day breakdown with outlet filter) |
| General journal entries | Yes | **Yes** — `journal_entries` + `journal_entry_lines` tables, double-entry validation (debits=credits), post/void lifecycle, trial balance report |
| Credit & debit notes | Yes | **Yes** — `credit_notes` + `debit_notes` tables, auto-numbering, approve/cancel workflow, customer/supplier balance adjustment |
| Post-dated cheque tracking | Yes | **Yes** — `postdated_cheques` table, status pipeline (pending→deposited→cleared/bounced), maturity alerts, upcoming cheques dashboard |
| Supplier & customer ledgers | Yes | **Yes** — `GET /api/customers/:id/ledger` (UNION ALL sales+returns+wallet+points with running balance), `GET /api/suppliers/:id/ledger` (POs+GRNs+payments with running balance) |
| Tax ledger | Yes | **Yes** — `GET /api/accounting/tax-ledger` (tax collected per rate, taxable amounts, transaction counts) |
| AP/AR summary | Yes | **Yes** — `GET /api/accounting/ap-ar` (total AP, total AR, net position) |
| AP aging buckets | Unknown | **Yes** — `GET /api/accounting/ap-aging` (current/30/60/90/90+ day buckets with totals) |
| Expense ledger | Yes | **Yes** — `GET /api/accounting/expenses` (filterable by date, category, outlet) + full expense CRUD + expense categories |
| Accounting periods (open/close) | Unknown | **Yes** — `GET/POST/PUT /api/accounting/periods` (create, close with closed_by/closed_at, reopen) |
| Tax management (VAT/GST auto-calculations) | Yes | **Yes** — FBR tax + per-product tax assignment + category-level HS code inheritance |
| Payment reconciliation (auto-fetch courier COD payments) | Yes | **No** |
| Daraz payment cycle reconciliation | Yes | **No** |
| Bulk payment & expense file importing | Yes | **Yes** — `POST /api/import/expenses` + `POST /api/import/payments` with preview mode, XLSX templates, same pattern as product/customer import |
| Product costing / profitability analysis | Yes | **Yes** — COGS tracked per sale item (`cost_price_at_sale`), included in P&L. Item-wise reports show cost vs revenue |

#### Shipment Management
| Feature | Assaan Retail | SanoPOS |
|---|---|---|
| **16 Pakistan couriers** (TCS, BlueEx, PostEx, CallCourier, Swyft, Rider, Trax, Steadfast, DoDeliver, Leopards, M&P, Fardar Express, eCourier, Smartlane, ShipNOC, InstaWorld) | Yes | **13 couriers** — Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx (adapter pattern for easy additions) |
| Bulk courier booking | Yes | **No** |
| Courier payment reconciliation (COD) | Yes | **No** |
| Loadsheet generation | Yes | **Yes** — `loadsheets` + `loadsheet_orders` tables, courier grouping, finalize/handover workflow, CSV export |
| Scan & dispatch | Yes | **Yes** — `POST /api/fulfillment/scan-dispatch` with multi-field lookup (tracking#, order#, ID), session counter |
| Courier performance reports | Yes | **No** |

#### Reporting & Analytics
| Feature | Assaan Retail | SanoPOS |
|---|---|---|
| Sales reports | Yes | **Yes** — item-wise, sales summary, daily/hourly breakdown |
| Product performance tracking | Yes | **Yes** — item-wise sales, product movement reports |
| KPI dashboards (configurable) | Yes | **Yes** — dashboard with revenue, sale count, average bill, insight cards, AI chat panel |
| Stock tracking & audit reports | Yes | **Yes** — inventory dump, product movement, shrinkage reports |
| Courier reports (shipment details, payment status) | Yes | **No** |
| Supplier performance reports | Yes | **Partial** — purchase reports with supplier filtering, total/itemwise purchases. No dedicated performance KPIs |
| Purchase reports | Yes | **Yes** — total purchases, itemwise purchases, PO reports with supplier_id filtering |
| Location-based reports | Yes | **Yes** — ALL reports support `outlet_id` filtering (260+ references across report endpoints) |
| Multi-channel aggregated reports | Yes | **Yes** — `routes/reports/multichannel.js` with summary, daily trends, and cross-channel product breakdown (POS+Shopify+WooCommerce) |
| Financial reports (P&L, balance sheet, cash flow) | Yes | **Yes** — full accounting module (see Accounting section above) |
| Customer RFM segmentation | Unknown | **Yes** — `GET /api/reports/customer-rfm` + frontend with 11 segments (Champions, Loyal, Potential Loyalist, New, Promising, Need Attention, At Risk, Can't Lose, Hibernating, Lost) with R/F scoring |
| Inventory forecasting reports | Unknown | **Yes** — forecast demand + smart replenishment with days_of_cover |

#### Purchase Management
| Feature | Assaan Retail | SanoPOS |
|---|---|---|
| Purchase orders | Yes | **Yes** — full PO lifecycle (draft → approved → received) |
| GRN (Goods Received Notes) | Yes | **Yes** — `GET/POST /api/grn` with item-level receipt tracking |
| Supplier management | Yes | **Yes** — full CRUD + credit_days/credit_limit + running_balance |
| Supplier payables / ledger | Yes | **Yes** — supplier invoices, supplier payments, AP aging, AP detail |
| Price lists management | Yes | **Yes** — `price_lists` + `price_list_items` tables, customer/volume/promotional types, POS price resolution, bulk item management |
| Scan & receive (barcode GRN) | Yes | **Yes** — `POST /api/grn/:id/scan-receive` with barcode lookup, over-received flagging, progress tracking |

#### Additional Features SanoPOS Has (Assaan Retail doesn't advertise)
| Feature | SanoPOS | Assaan Retail |
|---|---|---|
| Promotions engine (%, fixed, BOGO, date-based, category/product scoping) | **Yes** — `routes/promotions.js` with quote endpoint | Unknown |
| Gift cards (create, track balance, redeem) | **Yes** — `gift_cards` table + CRUD + redemption | **No** |
| Customer wallet / store credit | **Yes** — `customer_wallet_ledger` table + topup/deduct + wallet payments in POS | **No** |
| Loyalty points (earn on sale, redeem at POS) | **Yes** — `loyalty_points` on customers, `points_earned/redeemed` on sales | **No** |
| Barcode scanning in POS | **Yes** — real-time scanner emulation with 50ms keystroke detection | Unknown |
| Expense tracking with categories | **Yes** — full CRUD + categories + summary reports | Unknown |
| Payroll (hourly/daily/monthly, attendance-based, leave deductions) | **Yes** — `tier4/hr.js` with payroll periods/lines generation | **No** |
| Attendance / time tracking (clock in/out, breaks) | **Yes** — `routes/attendance.js` + kiosk PIN check-in | **No** |
| Quotations / estimates (leads → quotations → conversion) | **Yes** — `tier4/crm.js` with CRM + quotation lifecycle | **No** |
| Action history / audit log | **Yes** — full audit trail with date filtering | Unknown |
| Role-based permissions (custom roles, granular perms) | **Yes** — RBAC with `requirePerm`/`requireAnyPerm`, custom role CRUD | Unknown |
| Multi-currency per company | **Yes** — `CurrencyContext` with configurable symbol/code/denominations | Unknown |
| Custom receipt templates (header, footer, barcode, logo toggle) | **Yes** — `receipt_templates` table + full CRUD + live preview | Unknown |
| Employee profile self-service (PIN change, password change) | **Yes** — `/profile` route | **No** |
| Dark mode | **Yes** — CSS variable theming, persisted | **No** |
| PWA (installable) | **Yes** — manifest + service worker | Unknown |
| AI analytics chat | **Yes** — Claude-powered `/api/insights/ask` | **No** |
| FBR Digital Invoicing (real-time queue, retry, HS codes) | **Yes** — deepest FBR implementation | **No** |
| Support ticket system | **Yes** — floating widget + admin panel | Unknown |
| Tenant impersonation (super-admin) | **Yes** — 1-hour JWT, audit trail | **No** |
| Shareable receipt URLs | **Yes** — public `/receipt/:invoiceNumber` | Unknown |
| Comprehensive test suite (308 integration + 162 unit + 92 E2E) | **Yes** — full system audit | Unknown |

### Where SanoPOS Leads Over Assaan Retail
- **FBR Digital Invoicing** — real-time, automated, queue + retry + HS code inheritance
- **POS-first** — actual cashier UI, kiosk mode, offline queuing, keyboard shortcuts, barcode scanning
- **Built-in accounting** — P&L, balance sheet, cash flow, AP/AR, AP aging, tax ledger, expense ledger, accounting periods
- **Customer engagement** — loyalty points, wallet/store credit, gift cards, promotions engine (%, BOGO, date-based)
- **HR module** — payroll (hourly/daily/monthly), attendance tracking, kiosk PIN check-in
- **CRM** — leads, quotations, quotation-to-sale conversion
- **Self-service signup** with 45-day trial lifecycle
- **Employee management** — PIN + password auth, kiosk login, custom roles/permissions
- **AI Insights** (Claude-powered analytics)
- **Exchanges** — full exchange flow (not just returns)
- **Inventory forecasting** — demand prediction + smart replenishment
- **RFM customer segmentation** — 11-segment analysis
- **Custom receipt templates**
- **Dark mode, PWA**

---

## Competitor 2: XStak (xstak.com)

### Overview
XStak is an **enterprise commerce platform** — fundamentally different class from Assaan Retail. They serve major Pakistani brands (Maria B, Alkaram, Generation, Bonanza, Diners). They own their **payment gateway (XPay)**, plus a **loyalty engine**, **AI recommendation engine**, **PIM**, and **working capital financing**. They're essentially a miniature Shopify-for-Pakistan-enterprise.

### Product Modules
1. **Order Management System (OMS)** — distributed inventory + multichannel order management
2. **Point of Sale** — cloud-based, offline-capable
3. **XPay** — their own payment gateway (redirects to xpay.postexglobal.com)
4. **XStak AI** — recommendation engine, visual search, shopping assistant, forecasting
5. **Shopify Apps** — 7 apps in the Shopify App Store
6. **Omnichannel App** — white-label branded shopping app
7. **PIM** — Product Information Management
8. **Loyalty Management System** — points, tiers, RFM segmentation
9. **Credit Book Financing** — in-app working capital loans

### Solution Verticals
- **RetailTech** — omnichannel retail operations
- **FinTech** — payment processing (XPay)
- **MarTech** — customer acquisition + retention marketing

### Pricing
- **Usage-based pricing model** — no upfront financial commitments
- No published prices — custom quotes via form
- Transaction-based per module

### Integrations (70+ partners)

**Payments (10)**: Stripe, JazzCash, Bank Alfalah, Easypaisa, MCB, HBL, PayFast, Cyber, 2Checkout, NiftePay

**Ecommerce Platforms (6)**: Shopify, Magento, WooCommerce, Volusion, BigCommerce, Fabric

**POS Systems (7)**: Salesforce, Xenia, Retail Pro, Microsoft Dynamics 365, Vend, Clover, Candela

**ERP/Accounting (8)**: Technosys, SAP, NetSuite, Microsoft Dynamics, Linnworks, Oracle, QuickBooks, Xero

**Marketing (9)**: Facebook, Google, Mailchimp, Klaviyo, OneSignal, Twilio, TelloTalk, BizSMS, Contegris

**Logistics/Couriers (26+)**: DHL, Swyft, FedEx, WCC, UPS, TCS, BlueEx, CallCourier, Trax, Forrun, Leopards, Insta, M&P, Postex, Cheetay, OCS, Kangaroo, Hawai, Daewoo, Tookan, SmartLane, CourierX, Aramex, Lyve, DoDeliver, Bosta, PDC, Mylerz, Rider, Skynet, Shypp, Stallion, Dayar

**Regulatory (2)**: FBR, Zakat Tax

**Marketplaces (3)**: Daraz, Bagallery, Jomo

### Notable Clients
PriceOye, Nature Hedonist, Republic, Zara Shahjahan, Lazurde, MLS, Designer Bazar, WalkeAze, Noon, OneShop, Maria B, Insignia, Kitchen Cuisine, Alkaram, Meme, Punjab Beef, Unze, Hub, Bonanza, OmaCart, Ego, Faisal Silk, Baked, SuperTuff, Carters, Imrozia, Generation, ChampsLand, Raja Sahib, Zeesy, Latt Liv, Diners, Hummingbird

### Case Studies
1. **Maria B + XPay** — Fraud engine prevented chargeback scams during peak sales
2. **MLS + POS** — 3.5x revenue growth across 13 locations with omnichannel POS
3. **L'azurde + OMS** — Luxury jewelry retail omnichannel operations

### Feature-by-Feature: XStak vs SanoPOS

#### Order Management System
| Feature | XStak | SanoPOS |
|---|---|---|
| Multi-channel order sync (Daraz, Shopify, WooCommerce, Magento, BigCommerce) | Yes | **Yes** — Shopify + WooCommerce + **Daraz** + Facebook/Instagram Shop (Magento, BigCommerce not yet) |
| Automated courier booking | Yes | **Yes** — 13 courier adapters with `createShipment()` + tracking via unified courier service |
| Duplicate / fake order flagging | Yes (fraud scoring) | **Partial** — idempotency-based duplicate detection on sales, no fraud scoring |
| Buy Online Pickup In-Store (BOPIS) | Yes | **No** |
| Buy Online Return In-Store (BORIS) | Yes | **No** |
| Ship from Store | Yes | **No** |
| Order split across locations | Yes | **No** |
| SMS/email customer notifications (automated) | Yes | Email receipts + **WhatsApp Business API** (catalog sync, order notifications via `whatsapp-client.js`) + WhatsApp link sharing |
| Performance-based courier selection | Yes | **No** |
| Returns & exchanges | Yes | **Yes** — full return + exchange flow with exchange mode in POS |

#### Inventory Management
| Feature | XStak | SanoPOS |
|---|---|---|
| Real-time multi-location sync | Yes | **Yes** (transfers + outlet stock) |
| Inventory forecasting (ML-based) | Yes (ML) | **Yes** (moving average — `forecast-demand` + `replenishment-smart` endpoints with configurable lookback) |
| Stock aging analysis | Yes | **Yes** — `GET /api/reports/stock-aging` with 4 aging buckets (0-30/31-60/61-90/90+ days), stock value per bucket |
| Inventory audit via scan | Yes | **Yes** — barcode scan-to-count, variance report, auto-adjust |
| Product bundling | Yes | **Yes** — bundle components, POS stock deduction from components |
| Low stock alerts | Yes | **Yes** — auto-notification when outlet stock <= 10 after sale, shown in dashboard + notification bell |
| Multi-channel inventory sync | Yes | **Yes** — Shopify + WooCommerce + Daraz + Google Merchant Center |

#### Cloud POS
| Feature | XStak | SanoPOS |
|---|---|---|
| Cloud-based POS | Yes | **Yes** |
| Offline with auto-sync | Yes | **Yes** (offline sale queue in localStorage, replays on reconnect) |
| Multi-store visibility | Yes | **Yes** |
| Receipt printing | Yes | **Yes** (ESC/POS thermal + network TCP/IP) |
| Hardware integration (barcode, receipt) | Yes | **Yes** (barcode scanner emulation with 50ms keystroke detection) |
| Custom receipt templates | Yes | **Yes** — `receipt_templates` table, full CRUD (name, header, footer, show_barcode, show_logo), live preview |
| Integrated loyalty program | Yes | **Yes** — loyalty points earned on sale, redeemable at POS, per-customer tracking |
| Mobile-responsive POS | Yes | **Yes** — separate mobile layout with tab UI (Cart/Search/Pay), `md:` breakpoint responsive |
| Keyboard shortcuts | Unknown | **Yes** — F1–F10 shortcuts (help, discount, park, customer search, checkout, etc.) |
| Kiosk mode | Unknown | **Yes** — dedicated kiosk with PIN login |
| Parked sales | Unknown | **Yes** — park/recall sales |
| Customer display | Unknown | **Yes** — separate customer-facing display |

#### XPay — Payment Gateway
| Feature | XStak | SanoPOS |
|---|---|---|
| Onsite checkout (no redirect) | Yes | **No** (redirect to xPay) |
| Card tokenization (1-tap repeat payments) | Yes | **No** |
| Subscription/recurring billing | Yes | **No** (manual only) |
| Fraud engine (XShield) — BIN, IP, fingerprint | Yes | **No** |
| Payment links (SMS, email, social) | Yes | **No** |
| Google Pay | Yes | **No** |
| BIN-based bank discounts | Yes | **No** |
| Dynamic routing across gateways | Yes | **No** |
| PCI-DSS certified | Yes | **No** |
| SDKs: React Native, Flutter, Kotlin, Swift | Yes | **No** |

#### XStak AI
| Feature | XStak | SanoPOS |
|---|---|---|
| Product recommendation engine (collaborative + content filtering) | Yes | **No** |
| "People who bought this also bought" | Yes | **No** |
| Image similarity / visual search | Yes | **No** |
| AI shopping assistant (natural language) | Yes | **No** |
| Inventory forecasting (ML) | Yes | **Yes** — moving average forecasting with smart replenishment |
| AI insights (Claude-powered analytics chat) | **No** | **Yes** — `POST /api/insights/ask` with Claude AI |
| Pre-built analytics cards | **No** | **Yes** — `GET /api/insights/auto` (5 auto-generated insight cards) |

#### Product Information Management (PIM)
| Feature | XStak | SanoPOS |
|---|---|---|
| Centralized product catalog across channels | Yes | **No** (per-channel) |
| Multi-channel product distribution | Yes | **No** |
| Bulk product import/editing | Yes | **Yes** (CSV/XLSX import for products, customers, suppliers + template downloads) |
| Custom attributes & variants | Yes | **Yes** — attribute sets + product variants with individual SKU/barcode/stock/price |
| SEO optimization tools | Yes | **No** |
| Selective channel visibility | Yes | **No** |

#### Loyalty Management System
| Feature | XStak | SanoPOS |
|---|---|---|
| Points/rewards program | Yes (full engine) | **Yes** — `loyalty_points` on customers, `points_earned`/`points_redeemed` on sales, earn+redeem at POS |
| RFM customer segmentation | Yes | **Yes** — `GET /api/reports/customer-rfm` + 11-segment frontend (Champions, Loyal, At Risk, Lost, etc.) with R/F scoring |
| Visual rule builder (no-code) | Yes | **No** |
| Points transfer between members | Yes | **Yes** — `POST /api/customers/transfer-points` with atomic transaction, wallet ledger entries |
| Tiered loyalty programs | Yes | **Yes** — `loyalty_tiers` table (Bronze/Silver/Gold/Platinum), spend thresholds, points multipliers, auto-upgrade on sale, tier badges |
| Cross-channel loyalty (POS + online) | Yes | **Partial** (POS-based only) |
| Fraud detection on loyalty | Yes | **No** |

#### Warehouse Management
| Feature | XStak | SanoPOS |
|---|---|---|
| Pick/pack/dispatch workflow | Yes | **Yes** — `picklists` + `picklist_items`, scan-driven picking/packing, status pipeline (pending→picking→packed→dispatched) |
| Route optimization for delivery | Yes | **No** |
| Quick commerce fulfillment | Yes | **No** |
| Loadsheet generation | Yes | **Yes** — courier grouping, finalize/handover, CSV export |
| Own fleet management | Yes | **No** |

#### Logistics (26+ couriers)
| Feature | XStak | SanoPOS |
|---|---|---|
| 26+ Pakistan & international couriers | Yes | **13 couriers** (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) |
| Courier performance analytics | Yes | **No** |
| Own fleet OR 3PL fulfillment | Yes | **No** |
| COD reconciliation | Yes | **No** |

#### MarTech / Marketing
| Feature | XStak | SanoPOS |
|---|---|---|
| Facebook/Instagram/Google ad integration | Yes | **Partial** — Facebook/Instagram Shop integration (`meta-commerce.js`) + Google Merchant Center feed (`google-merchant.js`). No ad platform integration yet |
| Lookalike audience creation | Yes | **No** |
| Email/SMS marketing automation (Mailchimp, Klaviyo) | Yes | **No** |
| Promotions across web + email + print + in-store | Yes | **Yes** — promotions engine (percentage, fixed amount, BOGO buy-X-get-Y, min order, category/product scoping, date-based activation). `POST /api/promotions/quote` evaluates cart |
| Customer RFM segmentation | Yes | **Yes** — 11-segment RFM with R/F scoring |
| Tier-based customer rewards | Yes | **Yes** — Bronze/Silver/Gold/Platinum tiers with auto-upgrade, points multipliers, tier discounts |

#### Credit Book / Working Capital Financing
| Feature | XStak | SanoPOS |
|---|---|---|
| In-app business financing | Yes | **No** |
| 48-hour approval | Yes | **No** |
| Working capital loans | Yes | **No** |

#### Shopify Apps (7 apps in Shopify App Store)
| App | What It Does | SanoPOS Equivalent? |
|---|---|---|
| XPay | Payment processing | Partial (redirect) |
| Shopcast | AI product recommendations | **No** |
| Feedofy | Multi-marketplace product feed | **No** |
| Swatch Specialist | Variant color/image swatches | **No** |
| Shipstak | Shipping management | **No** |
| Simstak | Order verification | **No** |
| XAP OMS | Order management + returns | Partial |

#### Integrations Ecosystem Comparison
| Category | XStak | SanoPOS |
|---|---|---|
| Payments | 10 (Stripe, JazzCash, Easypaisa, HBL, MCB, Alfalah, PayFast, 2Checkout, NiftePay, Cyber) | 1 (xPay adapter, Stripe schema prepped) |
| Ecommerce | 6 (Shopify, Magento, WooCommerce, BigCommerce, Volusion, Fabric) | 2 (Shopify, WooCommerce) + 4 channels (Daraz, Facebook/Instagram, WhatsApp, Google Merchant) |
| ERP/Accounting | 8 (SAP, NetSuite, Oracle, QuickBooks, Xero, Dynamics, Linnworks, Technosys) | **0** (but built-in accounting module) |
| Marketing | 9 (Facebook, Google, Mailchimp, Klaviyo, Twilio, OneSignal, etc.) | **Partial** — Facebook Shop + Google Merchant Center (no email/SMS marketing automation yet) |
| Couriers | 26+ | **13** (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) |
| Marketplaces | 3 (Daraz, Bagallery, Jomo) | **1** (Daraz) + Facebook/Instagram Shop + WhatsApp Business + Google Merchant Center |
| POS systems | 7 (Salesforce, Dynamics 365, Vend, Clover, etc.) | N/A (is POS) |
| **Total** | **70+** | **~20** (13 couriers + 2 ecommerce + 4 channels + xPay — plus deep built-in features) |

#### Platform & Infrastructure
| Feature | XStak | SanoPOS |
|---|---|---|
| API-first architecture (public docs) | Yes | **Yes** — Swagger UI at `/api-docs` with 15+ annotated endpoints, OpenAPI 3.0 spec |
| Usage-based pricing (no upfront) | Yes | Fixed transparent plans |
| White-label omnichannel app | Yes | **No** |
| Enterprise clients (Maria B, Alkaram, etc.) | Yes | SMB focus |

#### Security
| Feature | XStak | SanoPOS |
|---|---|---|
| PCI-DSS certified | Yes | No |
| End-to-end encryption | Yes | Yes (HTTPS everywhere, Cloudflare) |
| Fraud detection + alerts | Yes (XShield) | **Partial** — error spike alerts, DB pressure alerts, duplicate sale detection |
| Off-site credit card storage | Yes | N/A (no card storage) |

#### Features SanoPOS Has That XStak Doesn't Advertise
| Feature | SanoPOS | XStak |
|---|---|---|
| FBR Digital Invoicing (real-time queue, retry, HS codes, category inheritance) | **Yes** — deepest implementation | Listed as integration only |
| Gift cards (create, balance, redeem) | **Yes** | Unknown |
| Customer wallet / store credit | **Yes** — `customer_wallet_ledger` with topup/deduct | Unknown |
| Promotions engine (%, fixed, BOGO, date-based, category scoping) | **Yes** | Unknown |
| Payroll (hourly/daily/monthly, attendance-based, leave deductions) | **Yes** — `tier4/hr.js` | **No** |
| Attendance tracking (clock in/out, breaks, kiosk PIN) | **Yes** | **No** |
| CRM quotations (leads → quotations → sale conversion) | **Yes** — `tier4/crm.js` | **No** |
| Expense tracking with categories | **Yes** — full CRUD + reports | Unknown |
| Action history / audit log | **Yes** — complete audit trail | Unknown |
| AI analytics chat (Claude-powered) | **Yes** | **No** (AI is recommendation-focused, not analytics) |
| Self-service signup with trial lifecycle | **Yes** — 45-day trial → grace → expired | **No** (sales-led) |
| Kiosk mode with PIN auth | **Yes** | Unknown |
| POS keyboard shortcuts (F1–F10) | **Yes** | Unknown |
| Offline sale queuing | **Yes** — localStorage queue, auto-replay | Unknown (they claim offline) |
| Dark mode | **Yes** | **No** |
| PWA (installable) | **Yes** | **No** |
| Support ticket system (floating widget + admin) | **Yes** | **No** |
| Tenant impersonation (super-admin, 1-hour JWT, audit trail) | **Yes** | Unknown |
| Shareable receipt URLs (public, no auth) | **Yes** | Unknown |
| Dead letter queue (failed webhook retry) | **Yes** | Unknown |
| Worker monitoring dashboard (email, FBR, cleanup workers) | **Yes** | Unknown |
| Comprehensive test suite (308 integration + 162 unit + 92 E2E) | **Yes** — full system audit against production | Unknown |

---

## Three-Way Competitive Positioning

| Dimension | XStak | Assaan Retail | SanoPOS |
|---|---|---|---|
| **Target market** | Enterprise retail + D2C brands | Mid-market e-commerce + retail | SMB retail stores |
| **Core strength** | Full-stack commerce (payments, AI, loyalty, PIM) | E-commerce OMS + fulfillment | POS + FBR + built-in business tools |
| **Couriers** | 26+ | 16 | **13** (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) |
| **Total integrations** | 70+ | 22 | **~20** (13 couriers + 2 ecommerce + 4 channels + xPay) |
| **Payment gateway** | Own (XPay) | None | Adapter (xPay) |
| **AI capabilities** | Recommendation engine, visual search, shopping assistant | None | Claude-powered analytics chat + auto-insights |
| **Accounting** | QuickBooks/Xero/SAP integration | Built-in P&L, ledgers | **Built-in** (P&L, balance sheet, cash flow daily, AP/AR, AP aging, tax ledger, expense ledger, accounting periods, **chart of accounts, journal entries, credit/debit notes, cheque tracking, customer+supplier ledgers**) |
| **Loyalty program** | Full engine (points, tiers, RFM, visual builder) | None | **Yes** — loyalty points + **tiered loyalty (Bronze/Silver/Gold/Platinum)** + points transfer + RFM segmentation (11 segments) |
| **Promotions** | Unknown | Unknown | **Yes** — %, fixed, BOGO, date-based, category/product scoping |
| **Gift cards + wallet** | Unknown | None | **Yes** — gift card CRUD + customer wallet ledger |
| **HR / Payroll** | None | None | **Yes** — payroll + attendance + kiosk |
| **CRM** | None | None | **Yes** — leads + quotations |
| **POS depth** | Good (cloud, offline) | Secondary | **Strongest** (shortcuts, kiosk, offline queue, barcode scan, exchanges, parked sales, customer display) |
| **FBR compliance** | Listed as integration | "Tax-compliant" | **Deepest** (real-time DI, queue, retry, HS codes, category inheritance) |
| **Inventory intelligence** | ML forecasting | Basic forecasting | **Yes** — demand forecast + smart replenishment + low stock alerts |
| **Pricing** | Custom/enterprise | PKR 4k–12k/mo | PKR 8k/mo |
| **Trial** | Demo-based | 14 days | 45 days |
| **Self-service signup** | No (sales-led) | No (sales-led) | Yes |
| **Test coverage** | Unknown | Unknown | **562 tests** (308 integration + 162 unit + 92 E2E against prod) |

---

## Where SanoPOS Wins (across both competitors)

1. **FBR Digital Invoicing** — deepest implementation: real-time posting, queue + retry, HS code inheritance via category tree, tax rate reference with ~96 codes
2. **POS UX** — keyboard shortcuts (F1–F10), kiosk mode, offline queuing, employee PIN auth, parked sales, customer display, barcode scanning, mobile-responsive tabs
3. **Built-in accounting** — P&L, balance sheet, cash flow (summary + daily), AP/AR, AP aging (30/60/90+ day buckets), tax ledger, expense ledger, supplier payment history, accounting periods, **chart of accounts, journal entries (double-entry), credit/debit notes, post-dated cheque tracking, customer + supplier ledgers** — all native, no third-party integration required
4. **Customer engagement stack** — **tiered loyalty (Bronze/Silver/Gold/Platinum with auto-upgrade)**, loyalty points (earn/redeem at POS), **points transfer**, customer wallet/store credit, gift cards, promotions engine (%, BOGO, date-based), RFM segmentation (11 segments), **customer profiling (demographics, tags, groups, preferences)**, **customer blacklisting**, **product reviews & ratings**
5. **HR module** — payroll (hourly/daily/monthly with attendance-based calculation, leave deductions), attendance tracking, kiosk PIN check-in — neither competitor has this
6. **CRM** — leads management, quotation lifecycle, quotation-to-sale conversion — neither competitor has this
7. **Exchanges** — full exchange flow in POS (return credit → new sale), not just refunds
8. **Inventory intelligence** — demand forecasting (configurable lookback), smart replenishment (days_of_cover, suggested_reorder_qty), low stock auto-notifications, **stock aging analysis (4 buckets)**, **barcode-driven inventory audit/stock counts**, **product bundling/kits**
9. **Fulfillment operations** — **pick/pack/dispatch workflow (scan-driven)**, **loadsheet generation (courier grouping + CSV export)**, **scan & dispatch**, **scan & receive (barcode GRN)**
10. **Self-service onboarding** — signup → 45-day trial → grace → expired lifecycle, fully automated
11. **AI Insights** — Claude-powered analytics chat (neither competitor has this)
12. **Multi-channel reports** — **cross-channel summary, daily trends, product breakdown across POS + Shopify + WooCommerce**
13. **Commerce features** — **price lists (customer/volume/promotional pricing)**, **bulk order status updates**, **order aging summary**, **quarterly/yearly billing discounts**, **bulk import for expenses & payments**
14. **Public API docs** — **Swagger UI at /api-docs with OpenAPI 3.0 spec**
15. **Custom receipt templates** — configurable header/footer/barcode/logo per template
16. **Simpler pricing** — transparent PKR 8k/mo vs custom enterprise quotes or per-add-on pricing
17. **Dark mode + PWA** — installable app with theme support
18. **Operational tooling** — support tickets, tenant impersonation, worker monitoring, dead letter queue, action history audit log
19. **Integrations Hub** — unified settings page with 5 marketplace/channel integrations (Daraz, Facebook/Instagram, WhatsApp Business, Google Merchant Center + Shopify/WooCommerce) + 13 courier adapters, AES-256-GCM credential encryption, pg-boss background sync worker
20. **Test coverage** — 562 automated tests (308 Postgres integration + 162 unit + 92 production E2E against live sanopos.com). Full system audit covering auth, RBAC, products, sales, returns, inventory, categories, customers, employees, outlets, shifts, reports, FBR, integrations, kiosk, onboarding. Neither competitor advertises any test infrastructure

---

## Complete Remaining Gaps — Every Feature Either Competitor Has That SanoPOS Doesn't

**Total: 120 features/integrations identified (Apr 3). After competitive-waves + integrations-hub merge (Apr 7): 40 closed, 80 remaining.**

### Integrations (52 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 1 | ~~Daraz marketplace integration~~ | Yes | Yes | **CLOSED** — `routes/integrations/daraz.js` + `daraz-client.js` (product sync, order pull, inventory push, webhook) |
| 2 | Magento integration | No | Yes | |
| 3 | BigCommerce integration | No | Yes | |
| 4 | Volusion integration | No | Yes | |
| 5 | Fabric integration | No | Yes | |
| 6 | ~~TCS courier~~ | Yes | Yes | **CLOSED** — `services/couriers/tcs-adapter.js` |
| 7 | ~~BlueEx courier~~ | Yes | Yes | **CLOSED** — `services/couriers/blueex-adapter.js` |
| 8 | ~~CallCourier~~ | Yes | Yes | **CLOSED** — `services/couriers/callcourier-adapter.js` |
| 9 | ~~Trax courier~~ | Yes | Yes | **CLOSED** — `services/couriers/trax-adapter.js` |
| 10 | ~~M&P courier~~ | Yes | Yes | **CLOSED** — `services/couriers/mnp-adapter.js` |
| 11 | ~~Swyft courier~~ | Yes | Yes | **CLOSED** — `services/couriers/swyft-adapter.js` |
| 12 | ~~PostEx courier~~ | Yes | Yes | **CLOSED** — `services/couriers/postex-adapter.js` |
| 13 | ~~Rider courier~~ | Yes | Yes | **CLOSED** — `services/couriers/rider-adapter.js` |
| 14 | Steadfast courier | Yes | No | |
| 15 | DoDeliver courier | Yes | Yes | |
| 16 | Fardar Express | Yes | No | |
| 17 | eCourier | Yes | No | |
| 18 | Smartlane | Yes | Yes | |
| 19 | ShipNOC | Yes | No | |
| 20 | InstaWorld | Yes | Yes | |
| 21 | ~~DHL~~ | No | Yes | **CLOSED** — `services/couriers/dhl-adapter.js` |
| 22 | ~~FedEx~~ | No | Yes | **CLOSED** — `services/couriers/fedex-adapter.js` |
| 23 | UPS | No | Yes | International |
| 24 | Aramex | No | Yes | International |
| 25 | Cheetay | No | Yes | |
| 26 | Daewoo | No | Yes | |
| 27 | OCS / Kangaroo / Hawai / CourierX / others | No | Yes | ~10 more niche couriers |
| 28 | Bagallery marketplace | No | Yes | |
| 29 | Jomo marketplace | No | Yes | |
| 30 | Stripe payment | No | Yes | Schema prepped, not implemented |
| 31 | JazzCash payment | No | Yes | |
| 32 | Easypaisa payment | No | Yes | |
| 33 | HBL payment | No | Yes | |
| 34 | MCB payment | No | Yes | |
| 35 | Bank Alfalah payment | No | Yes | |
| 36 | PayFast payment | No | Yes | |
| 37 | 2Checkout / NiftePay / Cyber | No | Yes | |
| 38 | SAP integration | No | Yes | ERP |
| 39 | NetSuite integration | No | Yes | ERP |
| 40 | Oracle integration | No | Yes | ERP |
| 41 | QuickBooks integration | No | Yes | ERP/Accounting |
| 42 | Xero integration | No | Yes | ERP/Accounting |
| 43 | Microsoft Dynamics integration | No | Yes | ERP |
| 44 | Linnworks integration | No | Yes | ERP |
| 45 | ~~Facebook/Instagram integration~~ | No | Yes | **CLOSED** — `routes/integrations/facebook.js` + `meta-commerce.js` (catalog sync, order pull, Instagram Shopping). Ad platform integration not yet |
| 46 | ~~Google Merchant Center integration~~ | No | Yes | **CLOSED** — `routes/integrations/google-merchant.js` + `google-merchant.js` (product feed, status checks). Google Ads integration not yet |
| 47 | Mailchimp integration | No | Yes | Email marketing |
| 48 | Klaviyo integration | No | Yes | Email marketing |
| 49 | Twilio integration | No | Yes | SMS |
| 50 | OneSignal integration | No | Yes | Push notifications |
| 51 | TelloTalk / BizSMS / Contegris | No | Yes | Local SMS providers |
| 52 | Monty Mobile (SMS) | Yes | No | |

### Omnichannel / Fulfillment (12 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 53 | Buy Online Pickup In-Store (BOPIS) | No | Yes | |
| 54 | Buy Online Return In-Store (BORIS) | No | Yes | |
| 55 | Ship from Store | No | Yes | |
| 56 | ~~Pick / Pack / Dispatch workflow (scan-driven)~~ | Yes | Yes | **CLOSED** — picklists, pick-scan, pack-scan, dispatch, loadsheets |
| 57 | Order split across locations | Yes | Yes | Partial fulfillment |
| 58 | ~~Bulk order status updates~~ | Yes | No | **CLOSED** — `PATCH /api/orders/bulk-status` |
| 59 | ~~Order aging summary (flag stale orders)~~ | Yes | No | **CLOSED** — `GET /api/orders/aging-summary` |
| 60 | Shipper advice management | Yes | No | |
| 61 | Performance-based courier selection | No | Yes | Auto-route to best courier |
| 62 | Own fleet management | No | Yes | Non-3PL delivery |
| 63 | Route optimization for delivery | No | Yes | |
| 64 | Quick commerce fulfillment | No | Yes | |

### Shipping / COD (6 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 65 | Bulk courier booking | Yes | Yes | |
| 66 | COD payment reconciliation (auto-fetch) | Yes | Yes | Auto-fetch courier COD settlements |
| 67 | Daraz payment cycle reconciliation | Yes | No | |
| 68 | ~~Loadsheet generation~~ | Yes | Yes | **CLOSED** — courier grouping, finalize/handover, CSV export |
| 69 | Courier performance analytics | Yes | Yes | On-time, cost, success rate |
| 70 | ~~Scan & dispatch~~ | Yes | No | **CLOSED** — `POST /api/fulfillment/scan-dispatch` |

### Notifications (3 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 71 | SMS order confirmations (API-based) | Yes | Yes | |
| 72 | ~~WhatsApp Business API notifications~~ | Yes | No | **CLOSED** — `routes/integrations/whatsapp.js` + `whatsapp-client.js` (send messages, catalog sync, conversation tracking) |
| 73 | IVR call confirmations | Yes | No | |

### Inventory (3 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 74 | ~~Product bundling / kits~~ | Yes | Yes | **CLOSED** — `product_bundles` table, POS bundle badge, component stock deduction |
| 75 | ~~Inventory audit via barcode scan~~ | Yes | Yes | **CLOSED** — `stock_counts` + scan-to-count + variance report |
| 76 | ~~Stock aging analysis~~ | No | Yes | **CLOSED** — `GET /api/reports/stock-aging` with 4 buckets |

### Accounting Gaps (7 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 77 | ~~Chart of Accounts (customizable account structure)~~ | Yes | Via integrations | **CLOSED** — `chart_of_accounts` with tree structure, 20 seeded accounts |
| 78 | ~~General journal entries~~ | Yes | Via integrations | **CLOSED** — double-entry validation, post/void, trial balance |
| 79 | ~~Credit & debit notes~~ | Yes | No | **CLOSED** — auto-numbering, approve/cancel workflow |
| 80 | ~~Post-dated cheque tracking~~ | Yes | No | **CLOSED** — status pipeline, maturity alerts |
| 81 | ~~Full customer ledger (transaction-level history)~~ | Yes | Yes | **CLOSED** — UNION ALL with running balance |
| 82 | ~~Full supplier ledger (transaction-level history)~~ | Yes | Yes | **CLOSED** — POs+GRNs+payments with running balance |
| 83 | ~~Bulk payment & expense file importing~~ | Yes | No | **CLOSED** — expenses + payments import with preview mode |

### Customer (7 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 84 | ~~Customer blacklisting~~ | Yes | No | **CLOSED** — blacklist/unblacklist + POS checkout block |
| 85 | ~~Rich customer profiling (preferences, demographics)~~ | Yes | No | **CLOSED** — extended fields, tags, groups, enriched profile |
| 86 | ~~Feedback / reviews management~~ | Yes | No | **CLOSED** — product_reviews, moderation queue, star ratings |
| 87 | ~~Tiered loyalty programs (bronze/silver/gold)~~ | No | Yes | **CLOSED** — 4 tiers, auto-upgrade, points multipliers |
| 88 | Visual loyalty rule builder (no-code) | No | Yes | Drag-and-drop offer creation |
| 89 | ~~Points transfer between members~~ | No | Yes | **CLOSED** — atomic transfer with wallet ledger entries |
| 90 | Loyalty fraud detection | No | Yes | |

### Pricing / Commerce (2 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 91 | ~~Price lists / multi-price per product~~ | Yes | No | **CLOSED** — customer/volume/promotional pricing, POS resolution |
| 92 | ~~Scan & receive (barcode-driven GRN)~~ | Yes | No | **CLOSED** — `POST /api/grn/:id/scan-receive` |

### Multi-channel Reports (2 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 93 | ~~Multi-channel aggregated reports~~ | Yes | Yes | **CLOSED** — summary, daily trends, product breakdown |
| 94 | Courier-specific reports (shipment details, payment status) | Yes | Yes | |

### Payment Gateway — XPay-level Features (9 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 95 | Onsite checkout (no redirect) | No | Yes | Embedded payment form |
| 96 | Card tokenization (1-tap repeat payments) | No | Yes | |
| 97 | Fraud engine (BIN, IP, fingerprint) | No | Yes | XShield |
| 98 | Payment links (SMS, email, social) | No | Yes | |
| 99 | Google Pay | No | Yes | |
| 100 | BIN-based bank discounts | No | Yes | |
| 101 | Dynamic routing across gateways | No | Yes | |
| 102 | PCI-DSS certification | No | Yes | |
| 103 | Mobile SDKs (React Native, Flutter, Kotlin, Swift) | No | Yes | |

### AI / ML (4 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 104 | Product recommendation engine | No | Yes | Collaborative + content filtering |
| 105 | "People who bought this also bought" | No | Yes | |
| 106 | Image similarity / visual search | No | Yes | |
| 107 | AI shopping assistant (natural language product search) | No | Yes | |

### PIM (4 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 108 | Centralized multi-channel product catalog | No | Yes | |
| 109 | Multi-channel product distribution | No | Yes | Push to Daraz/Shopify/etc |
| 110 | SEO optimization tools | No | Yes | |
| 111 | Selective channel visibility | No | Yes | Show/hide per channel |

### Platform (3 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 112 | White-label / branded app | No | Yes | |
| 113 | ~~Public API documentation (Swagger/OpenAPI)~~ | No | Yes | **CLOSED** — Swagger UI at `/api-docs`, OpenAPI 3.0 |
| 114 | Working capital financing (in-app loans) | No | Yes | Business partnership |

### Billing (1 item)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 115 | ~~Quarterly/yearly billing discounts~~ | Yes | N/A | **CLOSED** — quarterly (10%), semi-annual (15%), annual (17%) |

### Shopify Apps (5 items)

| # | Feature | Assaan Retail | XStak | Notes |
|---|---|---|---|---|
| 116 | Shopcast (AI product recommendations for Shopify) | No | Yes | Shopify App Store |
| 117 | Feedofy (multi-marketplace product feed) | No | Yes | Shopify App Store |
| 118 | Swatch Specialist (variant swatches on collection page) | No | Yes | Shopify App Store |
| 119 | Shipstak (shipping management) | No | Yes | Shopify App Store |
| 120 | Simstak (order verification) | No | Yes | Shopify App Store |

### Breakdown of 120 Gaps (updated Apr 7, post-integrations-hub)

| Category | Original | Closed | Remaining | Nature |
|---|---|---|---|---|
| Courier/payment/platform integrations | ~45 | **15** | ~30 | 12 courier adapters closed + Daraz + Facebook + Google Merchant. Remaining: ~20 niche couriers, payment gateways, ERP/accounting integrations |
| XPay payment gateway features | ~9 | 0 | ~9 | Requires owning a payment gateway (business, not code) |
| Enterprise/omnichannel | ~15 | 0 | ~15 | BOPIS, PIM, white-label, ERP, fleet management |
| AI/ML features | ~8 | 0 | ~8 | Recommendation engine, visual search, shopping assistant |
| Shopify App Store apps | 5 | 0 | 5 | Separate Shopify apps |
| **Buildable product features** | **~40** | **25** | **~15** | SMS, COD reconciliation, courier reports, order splitting, etc. |

---

## Prioritized Implementation Roadmap

### Tier 1 — High Impact, Needed to Compete

| # | Feature | Who Has It | Notes |
|---|---|---|---|
| 1 | ~~**More courier integrations** — TCS, Trax, M&P, BlueEx, CallCourier minimum~~ | Both (16–26+) | **CLOSED** — 12 new adapters shipped (TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) |
| 2 | ~~**Daraz integration** — Pakistan's #1 marketplace~~ | Both | **CLOSED** — `routes/integrations/daraz.js` + `daraz-client.js` (product sync, order pull, inventory push, webhook) |
| 3 | **COD payment reconciliation** — auto-fetch courier COD settlements | Both | Critical for e-commerce operations |
| 4 | **SMS notifications** — order confirmations via SMS API | Both | Twilio or local provider (Monty Mobile) |

### Tier 2 — Competitive Differentiation

| # | Feature | Who Has It | Notes |
|---|---|---|---|
| 5 | ~~**Product bundling / kits**~~ | Both | **CLOSED** — competitive-waves |
| 6 | ~~**Pick / Pack / Dispatch workflow**~~ | Both | **CLOSED** — competitive-waves |
| 7 | **BOPIS** (Buy Online Pickup In-Store) | XStak | Omnichannel feature |
| 8 | ~~**Tiered loyalty programs**~~ | XStak | **CLOSED** — competitive-waves |
| 9 | ~~**Customer blacklisting**~~ | Assaan | **CLOSED** — competitive-waves |
| 10 | ~~**Stock aging analysis**~~ | XStak | **CLOSED** — competitive-waves |
| 11 | ~~**Inventory audit via scan**~~ | Both | **CLOSED** — competitive-waves |
| 12 | ~~**Accounting gaps**~~ | Assaan (built-in), XStak (integrations) | **CLOSED** — competitive-waves |

### Tier 3 — Aspirational (enterprise features)

| # | Feature | Who Has It | Notes |
|---|---|---|---|
| 13 | **PIM (Product Information Management)** | XStak | Centralized multi-channel catalog |
| 14 | **Marketing integrations** (Facebook, Google, Mailchimp) | XStak | Ad platform + email automation |
| 15 | **AI product recommendations** | XStak | "People who bought this also bought" |
| 16 | **ERP integrations** (QuickBooks, Xero) | XStak | For enterprises with existing accounting |
| 17 | **Working capital financing partnerships** | XStak | Business partnership, not code |
| 18 | **White-label app** | XStak | For chains wanting own branding |
| 19 | ~~**Price lists / multi-price per product**~~ | Assaan | **CLOSED** — competitive-waves |
| 20 | ~~**API documentation** (Swagger/OpenAPI)~~ | XStak | **CLOSED** — competitive-waves |
| 21 | ~~**Quarterly/yearly billing discounts**~~ | Assaan | **CLOSED** — competitive-waves |
| 22 | **Visual search / image similarity** | XStak | AI-powered product discovery |
| 23 | ~~**Feedback / reviews management**~~ | Assaan | **CLOSED** — competitive-waves |

---

## Summary: The Real Picture (updated Apr 8, post-full-system-audit)

SanoPOS has **closed 40 of the 120 total gaps** identified on Apr 3 — 25 buildable product features (competitive-waves) + 15 integration gaps (integrations-hub). As of Apr 8, the entire system is backed by **562 automated tests** (308 integration + 162 unit + 92 production E2E) — a quality bar neither competitor publicly demonstrates.

**Integration breadth** — previously the biggest gap — has been **dramatically narrowed**:
- **Couriers**: 1 → **13** (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) — covers ~80% of Pakistan courier volume
- **Marketplaces**: 0 → **1** (Daraz — Pakistan's #1 e-commerce platform)
- **Social commerce**: 0 → **3** (Facebook/Instagram Shop, WhatsApp Business API, Google Merchant Center)
- **Integrations Hub UI**: unified settings page at `/settings/integrations` showing all 5 channels + 13 couriers with connect/disconnect/status
- **Background sync**: pg-boss worker for marketplace order polling + feed status checks
- **Credential security**: AES-256-GCM encryption for all integration secrets via `services/crypto.js`

**Omnichannel fulfillment** — previously a major gap — is now **closed**: pick/pack/dispatch, loadsheets, scan & dispatch, scan & receive are all live.

In **built-in business features**, SanoPOS now **leads both competitors across every category**:
- **Accounting** — native P&L, balance sheet, cash flow, AP/AR, AP aging, tax ledger, **plus chart of accounts, journal entries (double-entry), credit/debit notes, post-dated cheques, full customer + supplier ledgers**
- **Inventory** — stock transfers, adjustments, forecasting, low stock alerts, **plus stock aging analysis, barcode inventory audit, product bundling, scan & receive, price lists**
- **Fulfillment** — **pick/pack/dispatch, loadsheets, scan & dispatch** (previously zero)
- **Customer engagement** — loyalty points, wallet/store credit, gift cards, promotions, RFM segmentation, **plus tiered loyalty (4 tiers with auto-upgrade), points transfer, customer profiling (demographics, tags, groups), customer blacklisting, product reviews & ratings**
- **Commerce** — **bulk order status, order aging, billing discounts, bulk import (expenses + payments), multichannel reports, public API docs**
- HR/Payroll (neither competitor has this)
- CRM/Quotations (neither competitor has this)
- FBR compliance (deepest implementation)
- POS depth (best in class)
- AI analytics (unique to SanoPOS)

The remaining gaps are concentrated in:
1. **Niche couriers** (~15 remaining — Steadfast, DoDeliver, Fardar, eCourier, Smartlane, ShipNOC, InstaWorld, UPS, Aramex, Cheetay, Daewoo, etc.)
2. **Payment gateways** (~9 — Stripe, JazzCash, Easypaisa, HBL, MCB, etc.)
3. **Enterprise features** (~15 — BOPIS, PIM, white-label, ERP integrations, fleet management)
4. **AI/ML** (~8 — recommendation engine, visual search, shopping assistant)
5. **Marketing automation** (~5 — Mailchimp, Klaviyo, Twilio, OneSignal, SMS)
6. **Buildable product features** (~15 — SMS notifications, COD reconciliation, courier reports, order splitting)

---

## Actionable Build Roadmap — Zero External Dependencies

**Constraint**: No API keys, no paid third-party services, no courier/marketplace credentials available. Everything below is pure code — no external dependencies.

**Date**: 2026-04-06
**Status**: ✅ **ALL 25 ITEMS COMPLETE** — merged to main 2026-04-07, deployed to production (Railway + Vercel)

---

### What We Can vs Cannot Build

#### Buildable Right Now (code only) — ~25 items
No blockers — just engineering time. These are the items in the waves below.

#### Buildable With an API Key Purchase — ~5 items
Requires signing up for a third-party service (Twilio, Stripe, OneSignal, Mailchimp, WhatsApp Business API). **Deferred — no budget for paid services currently.**

#### Buildable Once We Get Courier API Access — ~15 couriers
The adapter pattern is already built in `backend/services/couriers/`. Each courier (TCS, BlueEx, Trax, M&P, CallCourier, etc.) is ~2-3 days of work once we have their API docs + test credentials. **Deferred — need to apply for credentials.**

#### Buildable Once We Get Marketplace Access — ~3 items
Daraz (priority), Bagallery, Jomo. **Deferred — need Daraz Seller Center API approval.**

#### Cannot Build (business/licensing/infrastructure) — ~25 items
- **Payment gateway features** (XPay-level): onsite checkout, tokenization, fraud engine, PCI-DSS, Google Pay, BIN discounts, dynamic routing, mobile SDKs — requires building/owning a payment gateway (banking licenses, PCI-DSS certification, card network partnerships). This is a separate company.
- **Working capital financing / in-app loans**: requires fintech licensing + banking partnership.
- **ERP integrations** (SAP, NetSuite, Oracle, Dynamics, Linnworks): each is a massive API surface for enterprise customers we don't have.
- **White-label branded app**: requires React Native/Flutter mobile app + per-tenant build pipeline. Major product line.
- **AI product recommendations / visual search / shopping assistant**: requires ML infrastructure, training pipelines, image processing. XStak has a dedicated AI team.
- **Own fleet management / route optimization**: separate logistics product (maps API, driver apps, route algorithms).
- **IVR call confirmations**: requires IVR telephony provider + call center infrastructure.
- **BOPIS / BORIS / Ship from Store**: requires e-commerce storefront integration (omnichannel architecture).

#### Not Worth Building for SMB Market — ~10+ items
Visual loyalty rule builder, loyalty fraud detection, quick commerce fulfillment, performance-based courier selection (premature without multiple couriers), Shopify App Store apps (5 separate products).

---

### Wave 1 — Quick Wins (~3 days, closes 7 gaps) ✅ COMPLETE

Small effort, big perception. Each takes 1-2 days and closes a visible gap on any feature comparison sheet.

| # | Feature | Effort | Competitor | Notes |
|---|---|---|---|---|
| 1 | **Customer blacklisting** | ~2 hours | Assaan | Boolean flag on customers table + block check at POS checkout. Signals operational maturity. |
| 2 | **Order aging summary** | ~3 hours | Assaan | Query on order `created_at` with configurable threshold (e.g., flag orders older than 3 days). |
| 3 | **Bulk order status updates** | ~3 hours | Assaan | Batch PUT endpoint + multi-select UI on orders page. |
| 4 | **Quarterly/yearly billing discounts** | ~4 hours | Assaan | Discount multiplier in billing logic. Assaan offers 10/15/20% off for quarterly/semi-annual/yearly. |
| 5 | **Full customer ledger** | ~4 hours | Both | Join sales + returns + wallet + payments by customer. Currently have balance only. Transaction-level history. |
| 6 | **Full supplier ledger** | ~4 hours | Both | Join POs + GRNs + payments by supplier. Currently have payments only. Transaction-level history. |
| 7 | **Points transfer between members** | ~2 hours | XStak | Ledger debit/credit between two customers. Simple wallet-style transfer. |

---

### Wave 2 — Accounting Completeness (~9 days, closes 5 more gaps) ✅ COMPLETE

SanoPOS's accounting module already leads both competitors in depth. These additions make it genuinely enterprise-grade — neither competitor has all of them natively.

| # | Feature | Effort | Competitor | Notes |
|---|---|---|---|---|
| 8 | **Credit & debit notes** | ~2 days | Assaan | Formal documents for purchase/sales adjustments. Standard accounting requirement in Pakistan. |
| 9 | **Post-dated cheque tracking** | ~1 day | Assaan | Very common in Pakistan retail — suppliers and customers both use post-dated cheques. New table with maturity date, status, alerts. |
| 10 | **Chart of Accounts** | ~3 days | Assaan (built-in), XStak (via integrations) | Customizable account structure. Links all financial data (expenses, revenues, assets, liabilities). Foundation for journal entries. |
| 11 | **General journal entries** | ~2 days | Assaan | Manual debit/credit entries. Requires Chart of Accounts first (item #10). |
| 12 | **Bulk payment & expense importing** | ~1 day | Assaan | CSV/XLSX parser — pattern already exists in `routes/import.js`. Apply same pattern to payments/expenses. |

---

### Wave 3 — Inventory & Commerce (~12 days, closes 5 more gaps) ✅ COMPLETE

Core retail features that both competitors have and SanoPOS doesn't.

| # | Feature | Effort | Competitor | Notes |
|---|---|---|---|---|
| 13 | **Product bundling / kits** | ~3 days | Both | Combo products (e.g., "Shampoo + Conditioner" as single SKU). New `product_bundles` table + POS cart logic to expand bundle into component items for stock deduction. |
| 14 | **Stock aging analysis** | ~2 days | XStak | Report showing how long inventory has been sitting (from GRN received date). Aging buckets: 0-30, 30-60, 60-90, 90+ days. Helps avoid clearance losses. |
| 15 | **Inventory audit via barcode scan** | ~3 days | Both | Physical stock count workflow: create count session → scan items → compare actual vs system → generate variance report. Scanner pattern already exists in POS (`50ms keystroke detection`). |
| 16 | **Scan & receive (barcode GRN)** | ~1 day | Assaan | Reuse POS barcode scanner pattern on GRN receiving page. Scan barcode → auto-fill item + quantity. |
| 17 | **Price lists / multi-price per product** | ~3 days | Assaan | Customer-group or volume-based pricing. New `price_lists` + `price_list_items` tables. POS resolves price based on attached customer's group. |

---

### Wave 4 — Customer & Loyalty Depth (~8 days, closes 3 more gaps) ✅ COMPLETE

| # | Feature | Effort | Competitor | Notes |
|---|---|---|---|---|
| 18 | **Tiered loyalty programs** | ~3 days | XStak | Bronze/Silver/Gold tiers with spend thresholds, auto-upgrade/downgrade logic, per-tier point multipliers. Upgrade from current flat points system. |
| 19 | **Rich customer profiling** | ~2 days | Assaan | Extended profile fields: preferences, demographics, purchase behavior tags, notes, customer groups/segments. Beyond current basic contact info. |
| 20 | **Feedback / reviews management** | ~3 days | Assaan | Product ratings/reviews collection (post-purchase), moderation UI, average rating display on product pages. |

---

### Wave 5 — Fulfillment Operations (~8 days, closes 3 more gaps) ✅ COMPLETE

| # | Feature | Effort | Competitor | Notes |
|---|---|---|---|---|
| 21 | **Pick / Pack / Dispatch workflow** | ~5 days | Both | Largest single item. New tables: `picklists`, `pack_slips`. Flow: order → generate picklist → scan items to pack → mark dispatched. Scan-driven UI. |
| 22 | **Loadsheet generation** | ~2 days | Both | PDF/CSV export of shipments grouped by courier + route. Used for handover to courier driver. |
| 23 | **Scan & dispatch** | ~1 day | Assaan | Barcode scan to mark individual orders as dispatched. Quick status update via scanner. |

---

### Wave 6 — Platform Polish (~5 days, closes 2 more gaps) ✅ COMPLETE

| # | Feature | Effort | Competitor | Notes |
|---|---|---|---|---|
| 24 | **Multi-channel aggregated reports** | ~2 days | Both | Join sales data by channel (POS / Shopify / WooCommerce) into unified report. Channel breakdown, channel comparison, channel trends. |
| 25 | **Public API documentation (Swagger/OpenAPI)** | ~3 days | XStak | Add `swagger-jsdoc` annotations to existing routes. Auto-generate interactive API docs. Opens door to third-party integrations without engineering support. |

---

### The Full Picture

| Wave | Items | Est. Days | Actual | Status |
|---|---|---|---|---|
| 1 — Quick Wins | 7 | ~3 | 1 day | ✅ Done |
| 2 — Accounting | 5 | ~9 | 1 day | ✅ Done |
| 3 — Inventory & Commerce | 5 | ~12 | 1 day | ✅ Done |
| 4 — Customer & Loyalty | 3 | ~8 | 1 day | ✅ Done |
| 5 — Fulfillment | 3 | ~8 | 1 day | ✅ Done |
| 6 — Platform Polish | 2 | ~5 | 1 day | ✅ Done |
| **Total** | **25** | **~45 days** | **~2 days** | **✅ All shipped** |

**25 out of 120 gaps closed** with **zero external dependencies, zero API keys, zero paid services**. Completed in ~2 days using parallel Claude Code sessions (estimated 45 days). 61 files changed, +16,902 lines added. Deployed to production 2026-04-07. Full system audit test suite added 2026-04-08 — **562 tests total** (308 integration + 162 unit + 92 production E2E, all passing).

### The Remaining 95 Gaps

| Category | Count | Blocker |
|---|---|---|
| Courier/marketplace integrations | ~18 | Need their API access + credentials |
| Paid third-party services (SMS, WhatsApp, push, email marketing, Stripe) | ~5 | Need budget for API subscriptions |
| Payment gateway features (XPay-level) | ~9 | Need to own a payment gateway (banking license, PCI-DSS) |
| Enterprise features (SAP, ERP, white-label, fleet) | ~15 | Not our market (SMB focus) |
| AI/ML features (recommendations, visual search) | ~8 | Need ML infrastructure + dedicated team |
| Shopify App Store apps | 5 | Separate products, separate distribution |
| Not worth building for SMB | ~10+ | Visual rule builders, loyalty fraud detection, quick commerce |
| Remaining buildable product features | ~15 | SMS notifications, COD reconciliation, courier reports, order splitting, BOPIS |
| Unlocked after courier integrations | ~1 | Performance-based courier selection needs multiple couriers live |

**Next priorities**: Pursue courier API credentials (TCS, BlueEx, Trax — biggest impact) and Daraz Seller API access as the next expansion. Continue expanding test coverage as new features ship.

---

## Integration Security & Trust — Gaps to Address

The Integrations Hub stores third-party API keys (Daraz, Facebook, WhatsApp, Google, courier APIs) using AES-256-GCM encryption. To earn tenant trust with their credentials, these gaps need closing.

### What We Have (baseline security)
- Helmet security headers
- CORS locked to our domains only
- Rate limiting (global, auth, webhook)
- AES-256-GCM encrypted credential storage (`services/crypto.js`)
- Per-tenant schema isolation
- HTTPS only (Railway + Vercel)

### What's Missing (gaps that matter)

1. **No audit trail on credential operations** — connect/disconnect/test actions don't write to `action_history`. Tenants can't see who added or removed an API key.
2. **No credential access logging** — when the system decrypts a key to make an API call, there's no record. If there's a breach, we can't trace what was accessed or when.
3. **No "show once" pattern** — after connecting, API keys should be completely hidden. Currently `maskSecret` shows last 4 chars, but there's no server-side guarantee the full key can't be retrieved via API.
4. **No privacy policy / security page** — no public documentation explaining how we handle third-party credentials.
5. **No SOC 2 / ISO 27001** — enterprise customers expect compliance certifications.
6. **Super-admin impersonation access** — operators can technically access any tenant's decrypted credentials through impersonation. No technical barrier prevents this.

### Short-Term Fixes (high trust impact, low effort)

- [ ] Add `action_history` logging to all credential connect/disconnect/test operations in `routes/integrations/credentials.js`
- [ ] Add a security explainer section to the Integrations Hub UI (inline banner explaining "Your credentials are encrypted with AES-256-GCM and never stored in plaintext")
- [ ] Make credentials truly write-only — remove any endpoint that could return decrypted keys, only ever return masked values

### Medium-Term Improvements (serious trust)

- [ ] Add a `/security` page on the landing site explaining encryption, isolation, and data handling practices
- [ ] BYOK (Bring Your Own Key) option — let tenants supply their own encryption key so even we can't read their secrets
- [ ] Two-factor auth requirement for credential management operations (connect/disconnect)
- [ ] Credential access logging — log every decrypt operation with timestamp, purpose, and requesting employee

### Market Reality

Most Pakistani SMBs using Daraz/TCS/BlueEx won't ask about SOC 2. They'll trust us if:
1. The UI looks professional and clearly explains what happens with their keys
2. They can see an audit trail of who connected/disconnected credentials
3. There's a clear "we encrypt your credentials, we can't see them" message
4. Other businesses they know are already using SanoPOS integrations

---

## Multi-Industry Expansion Strategy

**Date**: 2026-04-08

SanoPOS's core engine — multi-tenant POS + inventory + employees + customers + payments + reports + FBR compliance — is a horizontal platform that can serve many verticals. The approach is **one codebase, many faces**: the backend stays the same, the frontend adapts per industry via configuration (labels, nav visibility, POS layout, dashboard widgets).

### Implementation Approach: Industry Config (Not Code Forks)

During onboarding, tenants select their business type. An `industry_type` field on the tenant record drives the entire frontend adaptation:

```js
const INDUSTRY_CONFIG = {
  restaurant: {
    labels: { product: "Menu Item", sale: "Order", customer: "Guest" },
    nav: { show: ["tables", "kitchen"], hide: ["transfers", "purchase-orders"] },
    pos: { layout: "grid", showModifiers: true },
    receipt: { title: "Order", showTable: true },
    features: ["table_management", "kitchen_display"],
    onboarding: { sampleItems: "menu" },
  },
  salon: {
    labels: { product: "Service", sale: "Appointment", customer: "Client" },
    nav: { show: ["appointments", "staff-schedule"], hide: ["inventory", "suppliers"] },
    pos: { layout: "staff-first", showDuration: true },
    receipt: { title: "Receipt", showStylist: true },
    features: ["appointments", "staff_commission"],
    onboarding: { sampleItems: "services" },
  },
  retail: { /* current default — everything as-is */ },
};
```

Existing `feature_flags` system already toggles features per tenant — `industry_type` is a natural extension.

---

### Tier 1 — Works Today (Zero Code Changes)

| # | Industry | Example Businesses |
|---|----------|--------------------|
| 1 | **General Retail** | Clothing, shoes, accessories, bags |
| 2 | **Grocery / Supermarket** | Corner stores, mini marts, supermarkets |
| 3 | **Electronics** | Mobile shops, computer stores, appliance dealers |
| 4 | **Pharmacy / Medical Store** | Pharmacies, surgical supply shops |
| 5 | **Bookstore / Stationery** | Book shops, office supply stores |
| 6 | **Hardware / Building Materials** | Paint shops, electrical supply, plumbing |
| 7 | **Cosmetics / Beauty Supply** | Makeup stores, skincare, perfume shops |
| 8 | **Pet Shop** | Pet food, accessories, aquarium supplies |
| 9 | **Toy Store** | Toy shops, hobby stores |
| 10 | **Sports / Fitness Equipment** | Sports goods, gym equipment |
| 11 | **Furniture / Home Decor** | Furniture showrooms, home accessories |
| 12 | **Jewelry Store** | Gold, silver, artificial jewelry |
| 13 | **Optical / Eyewear** | Glasses shops (without prescription tracking) |
| 14 | **Gift Shop / Souvenir** | Gift stores, handicraft shops |
| 15 | **Auto Parts** | Car accessories, spare parts shops |
| 16 | **Wholesale / Distribution** | Distributors, cash-and-carry |
| 17 | **Tobacco / Vape Shop** | Cigarette, hookah, vape retailers |
| 18 | **Art Supply** | Canvas, paint, craft materials |
| 19 | **Musical Instruments** | Instrument shops, audio equipment |
| 20 | **Garden / Nursery** | Plant nurseries, garden supply stores |
| 21 | **Printing / Copy Shop** | Print shops selling supplies (paper, ink, toner) |

### Tier 2 — Small Additions (1-3 Weeks Each)

| # | Industry | What to Add |
|---|----------|-------------|
| 22 | **Bakery / Cafe / Juice Bar** | Order type (dine-in/takeaway), modifier notes, quick-add grid |
| 23 | **Fast Food / Counter Service** | Same as above + kitchen ticket printing |
| 24 | **Food Truck / Kiosk** | Simplified POS (no tables), quick-tap menu |
| 25 | **Sweet Shop / Mithai** | Weight-based pricing (per kg), box/packaging charges |
| 26 | **Ice Cream / Dessert Parlor** | Modifier-heavy (toppings, sizes, cones), combo deals |
| 27 | **Florist** | Perishable inventory tracking, delivery scheduling |
| 28 | **Butcher / Meat Shop** | Weight-based pricing, scale integration |
| 29 | **Dry Fruits / Spice Shop** | Weight-based pricing, loose/packed variants |
| 30 | **Convenience Store / Kiryana** | Quick POS, Urdu labels, simple credit book (udhar) |
| 31 | **Tailor / Alteration Shop** | Measurement fields on order, status workflow (ordered → in-progress → ready) |
| 32 | **Laundry / Dry Cleaning** | Item count per garment type, status tracking, collection date |
| 33 | **Car Wash** | Service items, vehicle info (plate #, type), membership packages |
| 34 | **Photography Studio** | Service packages, event date booking, delivery tracking |

### Tier 3 — Medium Additions (3-6 Weeks Each)

| # | Industry | What to Add | Effort | Market Size in PK |
|---|----------|------------|--------|-------------------|
| 35 | **Full-Service Restaurant** | Table management, KDS, modifiers, course firing, tip handling | 4-6 weeks | Huge — thousands of restaurants |
| 36 | **Salon / Barbershop / Spa** | Service items, appointment booking, staff commission, time slots | 3-4 weeks | Large |
| 37 | **Medical Clinic / Doctor** | Patient records, appointment scheduling, prescription printing, consultation fee | 4-5 weeks | Large |
| 38 | **Dental Clinic** | Treatment plans, tooth chart (visual), appointment scheduling | 4-5 weeks | Medium |
| 39 | **Veterinary Clinic** | Pet patient records, vaccination tracking, appointment booking | 3-4 weeks | Small |
| 40 | **Gym / Fitness Studio** | Membership plans (recurring billing), check-in, class scheduling, freeze/transfer | 4-6 weeks | Medium |
| 41 | **Repair Shop** (mobile, laptop, appliance) | Repair ticket workflow (intake → diagnose → quote → repair → collect), parts from stock | 3-4 weeks | Large |
| 42 | **Tuition Center / Academy** | Student records, monthly fee billing, attendance, fee slip as receipt | 3-4 weeks | Huge in PK |
| 43 | **Driving School** | Student enrollment, lesson scheduling, instructor assignment, package billing | 3-4 weeks | Small |
| 44 | **Coworking Space** | Desk/room booking, hourly/daily/monthly billing, access management | 4-6 weeks | Small |
| 45 | **Rental Business** (event, costume, equipment) | Check-out/check-in, rental duration billing, deposit, damage assessment | 4 weeks | Niche |
| 46 | **Hotel / Guest House** | Room inventory, check-in/check-out, night billing, minibar charges | 5-6 weeks | Medium |
| 47 | **Event Venue / Banquet Hall** | Date-based booking, package pricing, advance deposits, event timeline | 4 weeks | Medium |
| 48 | **Courier / Logistics Office** | Parcel intake, weight-based pricing, tracking number, delivery status | 3 weeks | Small |

### Tier 4 — Niche but High Value in Pakistan

| # | Industry | Why It Matters in PK |
|---|----------|---------------------|
| 49 | **Kiryana (credit book / udhar)** | Millions of shops, all paper-based. Simple credit tracking per customer would be revolutionary |
| 50 | **Textile / Fabric Shop** | Meter-based pricing, roll tracking, wholesale + retail pricing |
| 51 | **Fertilizer / Agri Supply** | Seasonal stock, bulk pricing, farmer credit accounts |
| 52 | **Medical Lab** | Test catalog as products, patient info, result printing, doctor referral tracking |
| 53 | **Atta Chakki (flour mill)** | Weight-based billing, customer wheat storage tracking |
| 54 | **Dastarkhwan / Charity Kitchen** | Meal tracking (not billing), donor management, daily distribution reports |

---

### The 6 Business Models (Build Modules, Not Industries)

All 54 industries map to just **6 core business models**. Building 6 feature modules covers every vertical:

| Model | Industries That Use It | Core Feature Needed | Status |
|-------|----------------------|-------------------|--------|
| **Buy & Sell** | #1–21 | Current POS | ✅ Done |
| **Order & Prepare** | #22–28, #35 | Order type + kitchen/prep queue | Not started |
| **Service & Appointment** | #36–40, #43–44 | Service items + time booking | Not started |
| **Intake & Workflow** | #31–33, #41, #45–48 | Status-tracked tickets/jobs | Not started |
| **Billing & Membership** | #42, #40, #44 | Recurring billing + enrollment | Not started |
| **Credit & Ledger** | #30, #49–51 | Customer credit book (udhar) | Not started |

### Cross-Cutting Features That Unlock Multiple Verticals

| Feature | Verticals Unlocked | Effort |
|---------|-------------------|--------|
| **Weight-based pricing** | Butcher, dry fruits, fabric, spices, flour mill | 1 week |
| **Service items (non-stock)** | Salon, clinic, car wash, repair, laundry | 1 week |
| **Appointment/booking module** | Salon, clinic, gym, driving school, coworking | 3 weeks |
| **Status workflow engine** | Tailor, laundry, repair shop, rental, hotel | 2 weeks |
| **Customer credit book (udhar)** | Kiryana, agri supply, fabric shop, wholesale | 2 weeks |
| **Table management** | Full-service restaurant, cafe, hotel dining | 3 weeks |
| **Kitchen Display System** | Restaurant, fast food, bakery, hotel kitchen | 2 weeks |
| **Recurring billing** | Gym, tuition, coworking, membership clubs | 2 weeks |

### SanoPOS Differentiators Across All Verticals

These advantages apply regardless of industry — no competitor in Pakistan offers this combination:

1. **FBR compliance** — mandatory for all businesses, very few local POS systems handle it
2. **Multi-tenant SaaS** — no installation, works on any browser, mobile-ready (PWA)
3. **Urdu-ready** (tax rates already have Urdu descriptions, expandable to full Urdu UI)
4. **13 local courier integrations** — pre-built for Pakistani logistics
5. **WhatsApp integration** — the dominant communication channel in PK
6. **Affordable** — Free tier + Pro at PKR 8k/mo, vs competitors charging PKR 12-50k/mo or sales-led pricing
7. **Self-service onboarding** — signup and start in minutes, no sales call required
8. **AI insights** — Claude-powered analytics chat, unique in the PK market
9. **Offline-capable POS** — works without internet, syncs when back online
10. **Complete HR/payroll** — attendance, shifts, payroll — no competitor has this built-in

### Pakistan-Specific Market Opportunities

| Opportunity | Why Now |
|-------------|---------|
| **Kiryana digital udhar** | Millions of shops, all paper. WhatsApp balance reminders would drive viral adoption |
| **Tuition center fee management** | Parents want printed fee receipts (our receipt system), centers need FBR compliance |
| **Medical clinic billing** | FBR is pushing clinic compliance. Being the affordable FBR-ready option is a massive opportunity |
| **Restaurant POS** | Largest POS vertical globally. No affordable FBR-compliant option exists in PK |
| **Salon appointment booking** | Growing urban market, currently using paper or WhatsApp groups |

### Recommended Expansion Sequence

1. **Phase 1**: Add `industry_type` to tenant + label/nav config system (1 week) — enables Tier 1 industries to feel purpose-built
2. **Phase 2**: Weight-based pricing + service items (2 weeks) — unlocks bakeries, butchers, salons, clinics
3. **Phase 3**: Customer credit book / udhar (2 weeks) — unlocks kiryana, wholesale, agri — massive PK market
4. **Phase 4**: Table management + KDS (4 weeks) — unlocks restaurant vertical
5. **Phase 5**: Appointment booking module (3 weeks) — unlocks salons, clinics, gyms
6. **Phase 6**: Status workflow engine (2 weeks) — unlocks repair shops, laundry, tailors, rentals
