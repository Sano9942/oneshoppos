# Competitive Analysis 2 — SanoPOS vs Global POS Leaders

**Date**: 2026-04-09
**Scope**: SanoPOS measured against **Square POS Premium** ($149/mo) and **Shopify POS Pro** ($89/mo) — the two dominant global POS platforms
**Companion doc**: `competitive-analysis.md` covers Pakistan-market competitors (Assaan Retail, XStak)
**Research source**: `square-premium-vs-shopify-pos-pro-research.md` (detailed feature-by-feature breakdown with sources)

---

## Vision

SanoPOS aspires to be a **Square Premium-class business operations platform** — not just a retail POS, but a system that runs an entire business. From Square we take the **breadth** (retail + restaurant + appointments + services + financial tools). From Shopify we take the **omnichannel depth** (BOPIS, ship-from-store, endless aisle, unified online+offline on one database).

Our unique advantages (built-in accounting, payroll, loyalty, FBR compliance, AI analytics) are things both competitors either charge extra for or don't have at all.

---

## Where SanoPOS Already LEADS Both Platforms

These are capabilities where SanoPOS is ahead of Square Premium AND Shopify POS Pro:

| Category | SanoPOS | Square Premium | Shopify POS Pro |
|---|---|---|---|
| **Built-in accounting** | Native P&L, balance sheet, cash flow (summary + daily), AP/AR, AP aging (30/60/90+ buckets), tax ledger, expense ledger, chart of accounts (20 seeded), journal entries (double-entry), credit/debit notes, post-dated cheque tracking, customer + supplier ledgers, accounting periods | No built-in — exports to QuickBooks/Xero | No built-in — third-party apps |
| **Built-in loyalty** | Free — points, 4 tiers (Bronze/Silver/Gold/Platinum), auto-upgrade, multipliers, points transfer, RFM segmentation (11 segments) | $45+/mo add-on — points/visits, tiers, bonus events | No built-in — third-party apps (Smile.io ~$50+/mo) |
| **Built-in payroll** | Free — hourly/daily/monthly, attendance-based, leave deductions | $35/mo + $6/person add-on | No built-in — third-party only |
| **Built-in HR/attendance** | Clock-in/out, breaks, kiosk PIN check-in, attendance reports | Included (Square Shifts) — comparable | No built-in — third-party only |
| **FBR tax compliance** | Deepest implementation: real-time DI posting, queue + retry (5 attempts, exponential backoff), HS code inheritance via category tree, ~96 seeded tax codes, tax rate suggestions | N/A (US-only) | N/A (non-Pakistan) |
| **AI analytics** | Claude-powered analytics chat (`POST /api/insights/ask`) + 5 auto-generated insight cards | Square AI beta (recommendations only) | None |
| **Native fulfillment** | Pick/pack/dispatch (scan-driven), loadsheets (courier grouping + CSV), scan & dispatch, scan & receive (barcode GRN) | Via ShipStation/third-party | Ship from store (labels/packing slips from POS) — different but comparable |
| **Pakistan courier network** | 13 native adapters (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) | Via ShipStation | Via Shopify Shipping (USPS/UPS/DHL/FedEx) |
| **CRM + quotations** | Leads, quotation lifecycle, quotation-to-sale conversion | Estimates → invoices (different — service-business focused) | None |
| **Customer wallet** | Full wallet ledger with topup/deduct + wallet payments in POS | Store credit refunds only | Store credit only (Pro) |
| **Promotions engine** | %, fixed, BOGO buy-X-get-Y, date-based activation, category/product scoping, min order, cart quote endpoint | BOGO, category discounts | BOGO, spend-threshold (auto-apply on Pro) |
| **Product reviews** | `product_reviews` table, moderation queue, star ratings, verified purchase badges | None | None |
| **Customer profiling** | DOB, gender, city, tags[], customer groups, notes, preferred payment/contact, enriched profile with purchase summary + top products | Auto-created profiles, segmentation, notes | Profiles, metafields, LTV |
| **Customer blacklisting** | Blacklist/unblacklist + POS checkout block + red badge | None | None |
| **Test coverage** | 562 automated tests (308 integration + 162 unit + 92 production E2E) | Unknown | Unknown |
| **Self-service signup** | Signup → 45-day trial → 7-day grace → expired lifecycle, automated | N/A (no SaaS self-serve) | N/A (Shopify is the platform) |
| **Dark mode** | CSS variable theming, persisted | No | No |
| **PWA** | Manifest + service worker, installable | No | No |

---

## Where SanoPOS Is At Parity

| Category | Status |
|---|---|
| Core POS checkout (cart, barcode scan, search, tipping) | At parity with both |
| Split payments / split tender | At parity |
| Parked/saved sales | At parity (device-local — see gap for cross-device sync) |
| Custom sale / ad-hoc items | At parity |
| Order notes | At parity |
| Returns & exchanges (full/partial, exchange flow) | At parity |
| Gift cards (create, track balance, redeem) | At parity |
| Offline mode (sale queue, auto-replay) | At parity |
| Inventory tracking (real-time, multi-location, per-variant) | At parity |
| Low stock alerts | At parity |
| Stock transfers between locations | At parity |
| Stock counts / stocktakes (barcode scan) | At parity |
| Purchase orders (create, receive, lifecycle) | At parity |
| GRN with scan-receive | At parity |
| Product variants (size/color with individual SKU/barcode/price) | At parity |
| Product bundling / kits | At parity |
| Inventory aging reports | At parity with Square (Shopify doesn't have) |
| Bulk CSV/XLSX import/export | At parity |
| Customer profiles with purchase history | At parity |
| Customer segmentation | At parity |
| RFM segmentation | At parity (SanoPOS has 11 segments) |
| Staff roles & permissions (granular) | At parity |
| POS PIN login per employee | At parity |
| Multi-location support (outlet-level everything) | At parity |
| Cross-location returns | At parity |
| Receipt options (print, email, shareable URL) | At parity (SanoPOS has shareable URL — unique) |
| Custom receipt templates | At parity |
| Reports (sales, inventory, cash flow, shifts) | At parity |
| Multi-location comparison reporting | At parity |
| Marketplace integrations (Daraz, Facebook/Instagram, WhatsApp, Google Merchant) | At parity with Square Online channels |
| Expense tracking with categories | At parity with Square (Shopify doesn't have) |
| Action history / audit log | At parity |
| Support ticket system | At parity (floating widget + admin panel) |

---

## Complete Gap Analysis — Every Feature Either Platform Has That SanoPOS Doesn't

### Carried Forward from competitive-analysis.md (Pakistan competitors — 80 remaining)

These items were identified in the original competitive analysis and remain open. They are included here for completeness and consolidated into the master gap list below.

#### Remaining Integrations (30 items from competitive-analysis.md)

| # | Feature | Source | Blocker |
|---|---|---|---|
| CA-1 | Magento integration | XStak | Code — needs API access |
| CA-2 | BigCommerce integration | XStak | Code — needs API access |
| CA-3 | Volusion integration | XStak | Code — needs API access |
| CA-4 | Fabric integration | XStak | Code — needs API access |
| CA-5 | Steadfast courier | Assaan Retail | Needs courier API credentials |
| CA-6 | DoDeliver courier | Both | Needs courier API credentials |
| CA-7 | Fardar Express courier | Assaan Retail | Needs courier API credentials |
| CA-8 | eCourier | Assaan Retail | Needs courier API credentials |
| CA-9 | Smartlane courier | Both | Needs courier API credentials |
| CA-10 | ShipNOC courier | Assaan Retail | Needs courier API credentials |
| CA-11 | InstaWorld courier | Both | Needs courier API credentials |
| CA-12 | UPS courier | XStak | Needs courier API credentials |
| CA-13 | Aramex courier | XStak | Needs courier API credentials |
| CA-14 | Cheetay courier | XStak | Needs courier API credentials |
| CA-15 | Daewoo courier | XStak | Needs courier API credentials |
| CA-16 | ~10 niche couriers (OCS, Kangaroo, Hawai, CourierX, etc.) | XStak | Needs courier API credentials |
| CA-17 | Bagallery marketplace | XStak | Needs marketplace API access |
| CA-18 | Jomo marketplace | XStak | Needs marketplace API access |
| CA-19 | Stripe payment gateway | XStak | Schema prepped, needs API key |
| CA-20 | JazzCash payment | XStak | Needs API key + business agreement |
| CA-21 | Easypaisa payment | XStak | Needs API key + business agreement |
| CA-22 | HBL / MCB / Bank Alfalah payments | XStak | Needs banking partnerships |
| CA-23 | PayFast / 2Checkout / NiftePay / Cyber | XStak | Needs API keys |
| CA-24 | SAP / NetSuite / Oracle / Dynamics ERP | XStak | Massive API surface, enterprise only |
| CA-25 | QuickBooks integration | XStak | Needs API key |
| CA-26 | Xero integration | XStak | Needs API key |
| CA-27 | Linnworks integration | XStak | Needs API key |
| CA-28 | Mailchimp integration | XStak | Needs API key |
| CA-29 | Klaviyo integration | XStak | Needs API key |
| CA-30 | Twilio / OneSignal / TelloTalk / BizSMS / Monty Mobile (SMS/push) | Both | Needs API keys |

#### Remaining Product Features (15 items from competitive-analysis.md)

| # | Feature | Source | Notes |
|---|---|---|---|
| CA-31 | COD payment reconciliation (auto-fetch courier settlements) | Both | Critical for e-commerce |
| CA-32 | Daraz payment cycle reconciliation | Assaan Retail | Marketplace-specific |
| CA-33 | SMS order confirmations (API-based) | Both | Needs SMS provider |
| CA-34 | IVR call confirmations | Assaan Retail | Niche |
| CA-35 | Bulk courier booking | Both | Batch shipment creation |
| CA-36 | Courier performance analytics (on-time, cost, success rate) | Both | Buildable |
| CA-37 | Order split across locations (partial fulfillment) | Both | Buildable |
| CA-38 | Shipper advice management | Assaan Retail | Niche |
| CA-39 | Performance-based courier selection (auto-route) | XStak | Buildable once courier analytics exist |
| CA-40 | Own fleet management | XStak | Separate logistics product |
| CA-41 | Route optimization for delivery | XStak | Maps API + algorithms |
| CA-42 | Quick commerce fulfillment | XStak | Niche |
| CA-43 | Visual loyalty rule builder (no-code drag-and-drop) | XStak | Buildable |
| CA-44 | Loyalty fraud detection | XStak | Buildable |
| CA-45 | Courier-specific reports (shipment details, payment status) | Both | Buildable |

#### Remaining Cannot-Build Items (35 items from competitive-analysis.md)

| # | Feature | Source | Blocker |
|---|---|---|---|
| CA-46 | XPay-level payment gateway (onsite checkout, tokenization, fraud engine, PCI-DSS, Google Pay, BIN discounts, dynamic routing, mobile SDKs) | XStak | Requires owning a payment gateway — banking licenses, PCI-DSS, card network partnerships |
| CA-47 | Working capital financing / in-app loans | XStak | Fintech licensing + banking partnership |
| CA-48 | White-label branded app | XStak | React Native/Flutter + per-tenant build pipeline |
| CA-49 | AI product recommendations / visual search / shopping assistant | XStak | ML infrastructure, training pipelines, dedicated team |
| CA-50 | PIM (Product Information Management) — centralized multi-channel catalog | XStak | Large product, enterprise-focused |
| CA-51 | Multi-channel product distribution (push to Daraz/Shopify/etc.) | XStak | Extension of PIM |
| CA-52 | SEO optimization tools | XStak | Requires online storefront |
| CA-53 | Selective channel visibility (show/hide per channel) | XStak | Requires PIM |
| CA-54 | XStak Shopify Apps (Shopcast, Feedofy, Swatch Specialist, Shipstak, Simstak) | XStak | Separate Shopify App Store products |

---

### NEW Gaps from Square Premium (not in competitive-analysis.md)

#### Omnichannel & Online Store

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-1 | **Online store / storefront** (product pages, checkout, domain) | **CRITICAL** | Yes (large) | Square Online included free. This is the foundation for all omnichannel features. Without a storefront, BOPIS/endless-aisle/ship-from-store are impossible. |
| SQ-2 | **Online ordering page** (branded, no-commission) | **HIGH** | Yes (large) | Every Square merchant gets a free ordering page. Restaurant + retail. |
| SQ-3 | **Curbside pickup** (customer notifies arrival, staff brings order) | **MEDIUM** | Yes | Extension of BOPIS — needs online ordering first |
| SQ-4 | **Local delivery management** (zone config by radius/zip, own drivers, delivery windows, fees, minimums) | **MEDIUM** | Yes | SanoPOS has courier dispatch but not own-fleet local delivery with zone config |
| SQ-5 | **On-demand delivery** (Uber integration for third-party drivers) | **LOW** | Needs API | Pakistan equivalent would be Bykea/Careem API |
| SQ-6 | **Product reviews on online store** | **LOW** | Yes | SanoPOS has product reviews in POS; would need to surface on storefront |
| SQ-6a | **eGift cards purchasable from online store** | **LOW** | Yes | Gift cards exist; need online storefront purchase flow. Dependent on SQ-1 |
| SQ-6b | **Coupons, pop-up notifications, lead capture forms** (online marketing tools) | **LOW** | Yes | Online store marketing features — pop-ups, email capture widgets. Dependent on SQ-1 |

#### Payments & Financial

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-7 | **Recurring billing / subscriptions** (card-on-file or ACH auto-charge for memberships) | **HIGH** | Yes | Manual billing only today. Needs stored payment method + scheduler |
| SQ-8 | **Batch invoicing** (send same invoice to multiple customers, billing groups) | **MEDIUM** | Yes | Straightforward extension of existing invoicing |
| SQ-9 | **Payment links** (share via SMS/email/social for remote payment) | **MEDIUM** | Yes | Generate a link, customer pays online |
| SQ-10 | **Embedded banking** (checking, savings, debit card, 1% APY) | **HIGH** | **No** | Requires banking license — Block/Square's moat |
| SQ-11 | **Business loans** ($100K–$350K, flat fee, repaid as % of sales) | **HIGH** | **No** | Requires fintech license + capital |
| SQ-12 | **Afterpay BNPL** (buy now pay later, 4 installments) | **MEDIUM** | **No** | Block owns Afterpay. Pakistan equivalent: partner with a BNPL provider |
| SQ-13 | **Instant deposits** (access funds within minutes, 1.5% fee) | **MEDIUM** | **No** | Requires payment processor partnership |
| SQ-14 | **Chargeback protection** ($250/mo covered) | **LOW** | **No** | Requires insurance/underwriting |
| SQ-15 | **ACH bank transfers** (1% fee) | **LOW** | **No** | Pakistan equivalent: JazzCash/Easypaisa (needs API keys) |
| SQ-15a | **Gift Card Marketplace API** (partner platforms list and sell your eGift cards in public directories) | **LOW** | Yes | Requires gift card infrastructure (exists) + public API endpoint |

#### Staff & Operations

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-16 | **Shift scheduling UI** (visual calendar, shift swaps, open shifts, availability tracking, push notifications) | **HIGH** | Yes | Attendance exists but no scheduling. Major HR gap. |
| SQ-17 | **Geofenced clock-in** (validate by physical location) | **MEDIUM** | Yes | Browser geolocation API at clock-in time |
| SQ-18 | **Auto clock-out** (prevent forgotten clock-outs) | **SMALL** | Yes | Scheduler job to auto-close open attendance records |
| SQ-19 | **Early/unscheduled clock-in blocking** (require schedule adherence) | **SMALL** | Yes | Policy check against schedule on clock-in |
| SQ-20 | **Commission tracking linked to payroll** | **MEDIUM** | Yes | Sales attribution exists; needs payroll integration |
| SQ-21 | **Tip pooling / distribution** | **SMALL** | Yes | Tips recorded on sales; need pool rules + distribution calc |
| SQ-22 | **Labor vs. sales dashboard** (side-by-side labor cost vs revenue) | **MEDIUM** | Yes | Data exists (shifts + sales); just needs a report endpoint + UI |
| SQ-23 | **Team chat and file sharing** | **LOW** | Yes (large) | Internal messaging system — significant build |
| SQ-24 | **Team announcements** | **LOW** | Yes | Simpler version of team chat — broadcast to employees |
| SQ-25 | **New-hire onboarding documents** | **LOW** | Yes | Document upload/checklist per employee |
| SQ-25a | **Time-off request management** (employees submit time-off requests, manager approve/deny) | **MEDIUM** | Yes | Sub-feature of scheduling (SQ-16) but independently actionable. Attendance exists, no time-off request workflow |
| SQ-25b | **Overtime alerts** (alert managers when employees approach overtime thresholds for labor cost control) | **SMALL** | Yes | Break tracking exists; overtime cost alerting does not |

#### Marketing & CRM

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-26 | **Email marketing campaigns** (automated: welcome, birthday, win-back, post-purchase) | **HIGH** | Partial | Email infrastructure exists (Resend). Needs campaign builder + templates + scheduling |
| SQ-27 | **SMS marketing campaigns** | **HIGH** | Needs API | Twilio or local provider (Monty Mobile). Overlaps with CA-33 |
| SQ-28 | **2-way customer messaging** (unified inbox, suggested replies, conversation history) | **MEDIUM** | Yes | WhatsApp integration exists but not a unified inbox |
| SQ-29 | **Google Reviews monitoring** | **LOW** | Needs API | Google My Business API |
| SQ-30 | **Customized receipts with promo content** (marketing on receipts) | **SMALL** | Yes | Custom receipt templates exist; add promo section |

#### Restaurant Vertical (new product line)

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-31 | **Table management** (visual floor plan builder, color-coded time elapsed, server assignment) | **HIGH** | Yes (large) | New vertical — significant UI + data model |
| SQ-32 | **Course management / hold & fire** (drag-and-drop courses, hold items, fire to kitchen) | **HIGH** | Yes (large) | Restaurant-specific order flow |
| SQ-33 | **Bar tabs** (open tab, preauth cards) | **MEDIUM** | Yes | Extension of parked sales with card preauth |
| SQ-34 | **Check splitting** (split by item or equal shares) | **MEDIUM** | Yes | Split-tender exists; check splitting is different (split order into multiple bills) |
| SQ-35 | **KDS (Kitchen Display System)** (ticket timers, expeditor mode, auto-text on ready) | **HIGH** | Yes (large) | Separate display application |
| SQ-36 | **Self-order kiosk** (customer-facing ordering on iPad/tablet) | **MEDIUM** | Yes | Customer display exists; needs ordering capability |
| SQ-37 | **QR code ordering** (scan at table, order from phone) | **MEDIUM** | Yes | Needs online ordering system first |
| SQ-38 | **Quick-service mode** (counter-service optimized checkout) | **SMALL** | Yes | POS mode variant |
| SQ-39 | **DoorDash / Uber Eats / third-party delivery aggregation** | **MEDIUM** | Needs API | Via Deliverect/Otter/Chowly |
| SQ-40 | **Kitchen performance reports** (speed, ticket times, covers/hour) | **SMALL** | Yes | Requires KDS data |
| SQ-40a | **Ingredient-level tracking, recipe costing, waste tracking** (MarketMan-style restaurant inventory) | **MEDIUM** | Yes | Restaurant-specific: track ingredients per dish, calculate food cost %, log waste. Square added via MarketMan partnership Apr 2026 |
| SQ-40b | **Order Guide / vendor-cost comparison tools** (compare supplier pricing for same ingredients) | **SMALL** | Yes | Restaurant-specific purchasing optimization |

#### Appointments Vertical (new product line)

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-41 | **Online booking website** (24/7 booking page, embed widget, QR code) | **HIGH** | Yes (large) | New vertical — booking system + public page |
| SQ-42 | **Multi-staff calendars** (view all staff availability) | **HIGH** | Yes | Calendar UI + staff availability data |
| SQ-43 | **Waitlists** (join waitlist for popular slots) | **MEDIUM** | Yes | Queue management |
| SQ-44 | **Group classes / recurring sessions** | **MEDIUM** | Yes | Extension of booking |
| SQ-45 | **Cancellation policies** (time frames, card-at-booking, no-show fees) | **MEDIUM** | Yes | Policy rules + payment hold |
| SQ-46 | **Resource scheduling** (rooms, chairs, equipment alongside staff) | **MEDIUM** | Yes | Resource allocation data model |
| SQ-47 | **Automated appointment reminders** (SMS/email) | **MEDIUM** | Partial | Email exists; SMS needs provider |
| SQ-48 | **Instagram booking integration** | **LOW** | Needs API | Instagram API for booking links |
| SQ-49 | **Google Calendar sync** | **MEDIUM** | Needs API | Google Calendar API |
| SQ-50 | **Multi-service bookings** (one appointment, multiple services, different staff) | **MEDIUM** | Yes | Complex booking model |

#### Service Business (estimates, invoices, contracts)

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-51 | **Estimates with approval flow** | **MEDIUM** | Yes | CRM quotations exist; needs estimate-specific workflow |
| SQ-52 | **Recurring invoices** (automatic on schedule) | **MEDIUM** | Yes | Linked to SQ-7 recurring billing |
| SQ-53 | **Milestone-based payment schedules** | **SMALL** | Yes | Invoice splitting by milestone |
| SQ-54 | **Contracts with e-signatures** | **MEDIUM** | Yes (medium) | Document generation + signature capture |
| SQ-55 | **AI-generated contract clauses** | **LOW** | Yes | Claude API for clause generation |
| SQ-56 | **Project workspace / dashboard** (organize invoices + estimates per project) | **MEDIUM** | Yes | Square Projects equivalent |
| SQ-56a | **Invoice deposits** (collect partial upfront payment on estimate/invoice before full service delivery) | **MEDIUM** | Yes | Service business feature — deposit at booking/estimate stage |
| SQ-56b | **Automatic payment reminders** (auto-email/SMS for overdue invoices on schedule) | **MEDIUM** | Yes | Email infrastructure exists (Resend). Needs reminder scheduler + templates |

#### Reporting & Analytics

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-57 | **Vendor sales reports** (which products from which vendor, performance by vendor) | **MEDIUM** | Yes | Data exists (supplier on products + sales); needs report endpoint |
| SQ-58 | **Advanced custom report builder** (user-defined filters, columns, saved views) | **HIGH** | Yes (large) | Significant UI build — drag-and-drop report creation |
| SQ-59 | **COGS reporting** (cost of goods sold) | **MEDIUM** | Yes | `cost_price_at_sale` tracked on sale items; needs dedicated report |
| SQ-59a | **Discount usage reports** (track coupon/discount code redemptions, amounts, frequency) | **SMALL** | Yes | Data exists on sales; needs aggregation report |

#### Hardware / Platform

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SQ-60 | **Customer-facing display with full interaction** (dual-screen register, customer selects tip/receipt) | **LOW** | Yes | Customer display exists; needs interactive features |
| SQ-61 | **Barcode label printing** (Zebra ZD411 native) | **MEDIUM** | Yes | SanoPOS has barcode generation; needs print-to-Zebra integration |
| SQ-61a | **Scheduled price/product updates** (time-based price changes, scheduled product availability windows) | **MEDIUM** | Yes | Set future price or visibility date — auto-activates on schedule. Square retail feature |
| SQ-61b | **Terminal remote control API** (programmatically send payment requests, display items on payment terminal from server) | **LOW** | Yes | Developer feature — control payment hardware via API for custom checkout flows |

---

### NEW Gaps from Shopify POS Pro (not in competitive-analysis.md, not overlapping with Square)

#### Omnichannel (Shopify's architectural strength)

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-1 | **Ship from store** (fulfill online orders from store inventory, print shipping labels + packing slips from POS) | **HIGH** | Yes | SanoPOS has courier dispatch but not "fulfill web order from POS with shipping labels" |
| SP-2 | **Buy in store, ship to customer / endless aisle** (sell product not in stock at this store, ship from another location) | **HIGH** | Yes | Requires cross-location inventory visibility in POS + shipping |
| SP-3 | **Send cart** (email cart link for customer to complete purchase online) | **MEDIUM** | Yes | Cart serialization + email + online checkout |
| SP-4 | **In-store return of online orders** (return web purchases at any physical store) | **HIGH** | Yes | Needs unified order lookup across channels |
| SP-5 | **Unified cross-channel customer order history** (single view merging POS + Shopify + Daraz + WooCommerce orders per customer) | **HIGH** | Yes | Data exists in separate channels; needs aggregation |
| SP-6 | **Omnichannel promotions** (same discount works across online + in-store) | **MEDIUM** | Yes | Promotions are POS-only today |

#### Location Intelligence

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-7 | **Location-specific pricing** (different prices per store while keeping accounting centralized) | **HIGH** | Yes | Price lists exist but not location-bound |
| SP-8 | **Location-specific product publishing** (hide/show products per outlet) | **MEDIUM** | Yes | Currently all products visible at all outlets |
| SP-9 | **Location-specific tax & discount rules** | **MEDIUM** | Yes | Tax rates per product exist, not per location override |

#### Checkout & Cart

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-10 | **Draft orders synced across devices/locations** (park a sale on one POS terminal, retrieve on another) | **HIGH** | Yes | Parked sales are device-local (localStorage). Need server-side parked sales |
| SP-11 | **Auto-apply promotions at cart** (BOGO/spend-threshold automatically applied without manual quote) | **MEDIUM** | Yes | Promotions require manual `POST /api/promotions/quote`. Need auto-evaluation on cart change |
| SP-12 | **Return rules** (configurable: when returns accepted, time window, fee policy, receipt required) | **MEDIUM** | Yes | Returns are ad-hoc today. Need policy rules |
| SP-13 | **Buyer-facing receipt selection** (customer chooses print vs email vs none on customer display) | **SMALL** | Yes | Customer display exists; needs self-service receipt choice |

#### Staff

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-14 | **Manager approval workflow** (require manager override for specific actions like discounts, returns, voids) | **HIGH** | Yes | Permissions gate access today; no "request approval" flow |
| SP-15 | **PII visibility permission** (granular control: which roles can see customer phone, email, address) | **SMALL** | Yes | New permission type |
| SP-16 | **Staff performance attribution** (discounts applied, returns processed, avg order value per employee) | **MEDIUM** | Yes | Sales by employee exists; need richer attribution |

#### Reporting

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-17 | **60+ pre-built report templates** | **MEDIUM** | Yes | SanoPOS has ~15 report types. Gap is breadth. |
| SP-18 | **Custom report builder** (drag-and-drop, save views) | **HIGH** | Yes (large) | Same as SQ-58 — significant UI build |

#### Products & Catalog

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-19 | **Product QR codes** (scan in-store → browse online → buy) | **SMALL** | Yes | Barcode generation exists; need QR + online link |
| SP-20 | **Smart collections** (rule-based auto-sort: by type, tag, price range, season) | **MEDIUM** | Yes | Categories are manual today |

#### Platform & API

| # | Feature | Impact | Buildable? | Notes |
|---|---|---|---|---|
| SP-21 | **POS UI Extensions API** (third-party apps embed custom UI directly in POS checkout) | **LOW** | Yes (very large) | Plugin architecture for POS. Aspirational. |
| SP-22 | **Shipping label generation + rate shopping** (compare USPS/UPS/DHL/FedEx rates, print labels) | **MEDIUM** | Needs API | Requires shipping provider API access |
| SP-23 | **Smart Grid / customizable POS tile layout** (drag-and-drop product tiles, category nav, discount code dropdown on checkout screen) | **MEDIUM** | Yes | POS UI customization — quick-access tiles for frequent items/actions. Shopify's Winter 2026 update added discount dropdown |
| SP-24 | **Sale item suggestions in POS** (cross-sell/upsell suggestions at checkout based on cart contents) | **MEDIUM** | Yes | "Frequently bought together" or "suggested add-ons" during checkout. Shopify inventory feature |

---

## Master Gap Summary — All Sources Combined

### By Category

| Category | From competitive-analysis.md | From Square Premium | From Shopify POS Pro | Total |
|---|---|---|---|---|
| **Integrations** (couriers, payments, ERP, marketing) | 30 | 0 | 0 | **30** |
| **Omnichannel / Online Store** | 4 (BOPIS, BORIS, ship-from-store, order split) | 8 (online store, ordering page, curbside, local delivery, on-demand delivery, product reviews online, eGift cards online, online marketing tools) | 6 (ship-from-store, endless aisle, send cart, in-store return online orders, unified history, omnichannel promos) | **~14 unique** |
| **Payments & Financial** | 0 | 10 (recurring billing, batch invoicing, payment links, gift card marketplace API, banking, loans, BNPL, instant deposits, chargeback, ACH) | 0 | **10** |
| **Staff & Operations** | 0 | 12 (scheduling, geofence, auto-clock-out, early-clock-in block, commissions, tip pooling, labor dashboard, team chat, announcements, onboarding docs, time-off requests, overtime alerts) | 3 (manager approval, PII permission, staff attribution) | **15** |
| **Marketing & CRM** | 0 | 5 (email campaigns, SMS campaigns, 2-way messaging, Google Reviews, receipt promo) | 0 | **5** |
| **Restaurant Vertical** | 0 | 12 (tables, courses, bar tabs, check splitting, KDS, kiosk, QR ordering, quick-service, delivery aggregation, kitchen reports, ingredient tracking/recipe costing, vendor-cost comparison) | 0 | **12** |
| **Appointments Vertical** | 0 | 10 (booking website, calendars, waitlists, classes, cancellation policy, resources, reminders, Instagram, Google Cal, multi-service) | 0 | **10** |
| **Service Business** | 0 | 8 (estimates, recurring invoices, milestones, contracts, AI clauses, project workspace, invoice deposits, automatic payment reminders) | 0 | **8** |
| **Reporting** | 1 (courier reports) | 4 (vendor reports, custom builder, COGS, discount usage reports) | 2 (60+ templates, custom builder) | **~6 unique** |
| **Checkout & Cart** | 0 | 0 | 6 (synced drafts, auto-apply promos, return rules, buyer receipt choice, smart grid/tile layout, sale item suggestions) | **6** |
| **Location Intelligence** | 0 | 0 | 3 (location pricing, product visibility, location tax rules) | **3** |
| **Products & Catalog** | 2 (PIM, channel visibility) | 2 (barcode label printing, scheduled price/product updates) | 2 (QR codes, smart collections) | **6** |
| **Platform / API** | 1 (white-label) | 2 (customer-facing display interaction, terminal remote control API) | 2 (POS extensions API, shipping labels) | **5** |
| **AI/ML** | 4 (recommendations, visual search, shopping assistant) | 0 | 0 | **4** |
| **Cannot Build** (business/licensing) | 9 (payment gateway, financing, ERP enterprise) | 6 (banking, loans, BNPL, instant deposits, chargeback, ACH) | 0 | **~12 unique** |
| **TOTAL** | **~80** | **~74** | **~24** | **~134 unique gaps** |

### By Buildability

| Status | Count | Examples |
|---|---|---|
| **Buildable now (pure code, no external dependencies)** | ~60 | Location pricing, synced draft orders, auto-apply promos, return rules, manager approvals, scheduling UI, labor dashboard, check splitting, vendor reports, COGS report, smart collections, smart grid tiles, sale item suggestions, scheduled price updates, discount usage reports, time-off requests, overtime alerts, invoice deposits, payment reminders |
| **Buildable with API keys / service signup** | ~20 | SMS (Twilio), email campaigns (existing Resend), Google Calendar, shipping labels, delivery aggregation |
| **Buildable but large (new product verticals)** | ~30 | Online store, restaurant mode (tables + KDS + ingredient tracking + recipe costing), appointment booking, POS extensions API, custom report builder, terminal remote control API |
| **Cannot build (business/licensing)** | ~12 | Banking, loans, BNPL, payment gateway, PCI-DSS, working capital financing |
| **Niche / low priority** | ~12 | IVR calls, Daewoo courier, Bagallery marketplace, shipper advice mgmt, gift card marketplace API, eGift online, vendor-cost comparison |

### By Priority

#### CRITICAL (unlocks entire capability categories)

| # | Feature | Sources | Why Critical |
|---|---|---|---|
| 1 | **Online ordering / storefront** | Square, Shopify | Foundation for ALL omnichannel: BOPIS, curbside, endless aisle, ship-from-store, QR ordering. Without this, SanoPOS remains a pure in-store POS. |
| 2 | **BOPIS** (buy online, pick up in store) | Square, Shopify, XStak | The #1 omnichannel feature. Drives foot traffic + online conversion. |
| 3 | **Ship from store** | Shopify, XStak | Use store inventory to fulfill online orders. Reduces shipping time + cost. |

#### HIGH IMPACT (competitive differentiation)

| # | Feature | Sources | Notes |
|---|---|---|---|
| 4 | **Endless aisle** (buy in store, ship from another location) | Shopify | Never lose a sale because item isn't in stock at this outlet |
| 5 | **In-store return of online orders** | Shopify, XStak | Unified return experience across channels |
| 6 | **Location-specific pricing** | Square, Shopify | Different prices per outlet, centralized accounting |
| 7 | **Draft orders synced across devices** | Shopify | Park sale on terminal 1, complete on terminal 2 |
| 8 | **Manager approval workflow** | Shopify | Security: require override for discounts, returns, voids |
| 9 | **Shift scheduling UI** | Square | Biggest HR gap — attendance exists but no scheduling |
| 10 | **Recurring billing / subscriptions** | Square | Auto-charge memberships, subscription boxes |
| 11 | **Email marketing campaigns** | Square | Infrastructure exists (Resend). Needs campaign builder |
| 12 | **Unified cross-channel customer history** | Shopify | Single view: POS + Shopify + Daraz + WooCommerce per customer |
| 13 | **COD reconciliation** | Assaan, XStak | Critical for Pakistan e-commerce operations |
| 14 | **Custom report builder** | Square, Shopify | Most requested reporting feature globally |
| 15 | **SMS notifications** | Square, Both Pakistan | Needs SMS provider API key |

#### MEDIUM IMPACT (polish and depth)

| # | Feature | Sources |
|---|---|---|
| 16 | Auto-apply promotions at cart | Shopify |
| 17 | Return rules / policies | Shopify |
| 18 | Staff performance attribution (discounts/returns per employee) | Shopify |
| 19 | Labor vs. sales dashboard | Square |
| 20 | Commission tracking linked to payroll | Square |
| 21 | Geofenced clock-in | Square |
| 22 | 2-way customer messaging inbox | Square |
| 23 | Location-specific product visibility | Shopify |
| 24 | Location-specific tax rules | Shopify |
| 25 | Omnichannel promotions (online + POS) | Shopify |
| 26 | Batch invoicing | Square |
| 27 | Payment links (shareable) | Square |
| 28 | Vendor sales reports | Square |
| 29 | COGS dedicated report | Square |
| 30 | Barcode label printing (Zebra) | Square |
| 31 | Smart collections (rule-based) | Shopify |
| 32 | Product QR codes | Shopify |
| 33 | Courier performance analytics | Both Pakistan |
| 34 | Bulk courier booking | Both Pakistan |
| 35 | Order split across locations | Both Pakistan |
| 36 | Shipping label generation + rate shopping | Shopify |
| 37 | Local delivery management (zones, own drivers) | Square |
| 38 | Curbside pickup | Square |
| 39 | Customer-facing display interaction (tip/receipt) | Square |
| 40 | Buyer-facing receipt selection | Shopify |
| 41 | Scheduled price/product updates (time-based auto-activation) | Square |
| 42 | Smart Grid / customizable POS tile layout | Shopify |
| 43 | Sale item suggestions at checkout (cross-sell/upsell) | Shopify |
| 44 | Invoice deposits (partial upfront payment) | Square |
| 45 | Automatic payment reminders for invoices | Square |
| 46 | Time-off request management | Square |
| 47 | Overtime alerts | Square |
| 48 | Discount usage reports | Square, Shopify |

#### NEW VERTICALS (future product lines)

| # | Vertical | Key Features | Source |
|---|---|---|---|
| 49 | **Restaurant mode** | Table management, course management, bar tabs, check splitting, KDS, kiosk, QR ordering, quick-service mode, kitchen reports, ingredient tracking/recipe costing, vendor-cost comparison | Square |
| 50 | **Appointment booking** | Online booking, multi-staff calendars, waitlists, classes, cancellation policies, resource scheduling, reminders, Google Calendar sync | Square |
| 51 | **Service business tools** | Estimates with approval, recurring invoices, milestone payments, contracts with e-signatures, project workspace | Square |

#### CANNOT BUILD (business/licensing barriers)

| # | Feature | Source | Blocker |
|---|---|---|---|
| 52 | Embedded banking (checking, savings, debit card) | Square | Banking license required |
| 53 | Business loans ($100K–$350K) | Square, XStak | Fintech license + capital |
| 54 | Afterpay BNPL (buy now pay later) | Square | Block owns Afterpay; could partner with Pakistan BNPL |
| 55 | Instant deposits | Square | Payment processor partnership |
| 56 | Chargeback protection ($250/mo) | Square | Insurance/underwriting |
| 57 | ACH bank transfers | Square | Pakistan equivalent: JazzCash/Easypaisa (needs API) |
| 58 | Payment gateway (onsite checkout, tokenization, fraud engine, PCI-DSS) | XStak | Requires owning a gateway — separate company |
| 59 | Working capital financing / in-app loans | XStak | Fintech licensing + banking partnership |
| 60 | White-label branded mobile app | XStak | React Native/Flutter + per-tenant pipeline |
| 61 | AI product recommendations / visual search | XStak | ML infrastructure + dedicated team |

---

## Strategic Roadmap Recommendation

### Phase 1 — Omnichannel Foundation (highest ROI)
Build online ordering + BOPIS + ship-from-store. This transforms SanoPOS from "POS" to "commerce platform." Requires:
- Customer-facing online ordering page (catalog browse, cart, checkout)
- Store pickup fulfillment workflow
- Ship-from-store with shipping labels
- Unified order view across channels

### Phase 2 — Operational Depth
Close the medium-impact gaps that deepen existing capabilities:
- Shift scheduling UI
- Location-specific pricing
- Synced draft orders (server-side parked sales)
- Manager approval workflow
- Auto-apply promotions
- Return rules/policies
- Custom report builder

### Phase 3 — Marketing & Engagement
Build the customer engagement pipeline:
- Email marketing campaigns (Resend infrastructure exists)
- SMS notifications (once SMS provider selected)
- 2-way customer messaging inbox
- Unified cross-channel customer history

### Phase 4 — New Verticals
Expand into new business types:
- Restaurant mode (table management + KDS + QR ordering)
- Appointment booking system
- Service business tools (contracts, recurring invoices)

### Phase 5 — Pakistan-Specific Integration Depth
Activate with API credentials as acquired:
- Additional courier adapters (~15 remaining)
- Pakistan payment gateways (JazzCash, Easypaisa, Stripe)
- ERP integrations (QuickBooks, Xero)
- COD reconciliation
- SMS providers

---

## Score Summary

| Dimension | SanoPOS vs Square Premium | SanoPOS vs Shopify POS Pro |
|---|---|---|
| Core POS | At parity | At parity |
| Inventory | At parity | At parity |
| Accounting | **SanoPOS leads** | **SanoPOS leads** |
| Loyalty & CRM | **SanoPOS leads** (free vs $45/mo) | **SanoPOS leads** (built-in vs none) |
| HR / Payroll | **SanoPOS leads** (free vs $35+/mo) | **SanoPOS leads** (built-in vs none) |
| Fulfillment | **SanoPOS leads** (native vs third-party) | At parity (different approaches) |
| FBR compliance | **SanoPOS leads** (unique) | **SanoPOS leads** (unique) |
| AI analytics | **SanoPOS leads** | **SanoPOS leads** |
| Omnichannel | **Square leads** (online store + BOPIS + curbside) | **Shopify leads** (architectural — same DB) |
| Online store | **Square leads** (Square Online) | **Shopify leads** (world-class ecommerce) |
| Restaurant | **Square leads** (full vertical) | N/A |
| Appointments | **Square leads** (full vertical) | N/A |
| Financial services | **Square leads** (banking, loans, BNPL) | N/A |
| Marketing | **Square leads** (email/SMS campaigns) | Tie (both need third-party) |
| Staff scheduling | **Square leads** (Shifts) | **Square leads** |
| App ecosystem | Comparable | **Shopify leads** (much larger) |
| Hardware | **Square leads** (Handheld, Register, KDS) | **Shopify leads** (POS Hub, Terminal) |
| Pakistan market fit | **SanoPOS leads** (FBR, couriers, PKR) | **SanoPOS leads** (FBR, couriers, PKR) |

**Bottom line**: SanoPOS is already the strongest POS for Pakistan by feature depth. The path to Square Premium-class starts with omnichannel (online ordering + BOPIS + ship-from-store), then expands into restaurant/appointments verticals.

---

## Pricing Caveat — Square Loyalty/Marketing Entitlements

Square's Oct 2025 unified pricing restructure describes Premium as including "nearly all" software offerings. However, Square support pages and product pages still describe Square Loyalty and some Marketing features in subscription-style terms with separate pricing (~$45+/mo and ~$15+/mo). For roadmap purposes, treat Square as having these capabilities in its ecosystem, but the exact entitlement boundary between "included in $149" and "separate add-on" remains ambiguous in Square's current documentation.

---

## Feature Visibility Gaps (not code gaps — positioning gaps)

An independent research pass against SanoPOS source files flagged the following features as "no clear evidence" — meaning they exist in code but are not easily discoverable through documentation, API docs, or marketing materials. These are not missing features, but they represent a **discoverability/positioning problem**:

| Feature | Code Reality | Visibility Problem |
|---|---|---|
| Split payments / mixed tenders | `sale_payments` supports multiple payment methods per sale | Not prominently documented or marketed |
| Labor vs. sales reporting | Shift data + sales data exist, no combined dashboard | Data exists but no dedicated report/UI |
| Commission tracking | Sales attributed per employee | No dedicated commission UI or payroll link |
| Invoicing | CRM quotations with quotation-to-sale conversion | Labeled as "quotations" not "invoices" — naming gap |
| Barcode label printing | Barcode generation exists | No Zebra/printer integration — partial implementation |
| Deposits / staged payments | No code | Genuine gap (covered as SQ-56a) |

These are worth addressing through documentation, landing page copy, or feature naming — even before building new features.

---

## Phase 1 Omnichannel — Implementation Status (2026-04-09)

> **Branch:** `omnichannel-phase1` — 21 commits, 30 files changed (+5,464 lines)
>
> Phase 1 is **code-complete**. All 8 workstreams shipped. Only manual regression verification remains before merge.

### Phase 1 Features — DONE

| Feature | Competitive ID | Workstream | Commits |
|---------|---------------|------------|---------|
| Online storefront (catalog, cart, checkout) | SQ-1, SQ-2 | WS2 + WS4 | `056637a`, `e341de8`, `40e16d8`, `91ca51c`, `4647f69`, `9a495e1` |
| BOPIS (buy online, pick up in store) | SQ-3, SP-1 | WS5 | `58d7372`, `6a91d31` |
| Curbside pickup (arrival signal) | SQ-3 | WS5 | `58d7372` |
| Ship-from-store (fulfill web orders from store inventory) | SP-1 | WS6 | `c91406b` |
| Endless aisle (sell from another location's stock via POS) | SP-2 | WS6 | `7688d6f`, `2128c47` |
| In-store return of online orders | SP-4 | WS7 | `7a9e861` |
| Unified cross-channel customer history | SP-5 | WS7 | `3d9c23e`, `7c213d0` |
| Omnichannel promotions (same promo logic online + POS) | SP-6 | WS8 | `36c38b7` |
| Channel publication management (publish/unpublish per channel) | SP-8 (partial) | WS8 | `e4f89d2` |
| Product reviews on storefront | SQ-6 | WS2 | `e341de8` |
| Reservation + allocation engine | (infra) | WS3 | `e240153`, `ad9b89b`, `ed23642` |
| Schema migration v18 (7 new tables, 2 extended) | (infra) | WS1 | `22eb50b` |

### Phase 1 In-Scope Deferrals (built partially or punted to Phase 2)

| # | Deferred Item | Location | Impact | Priority for Phase 2 |
|---|--------------|----------|--------|---------------------|
| 1 | **Shipping cost calculation** | `backend/services/quote.js:192` — `shippingTotal = 0` hardcoded | Storefront only supports free shipping. No rate calculation or shipping method selection. | High |
| 2 | **Payment processing at checkout** | `POST /api/storefront/checkout` creates order with `payment_status = 'pending'` but collects no payment | Orders placed but payment handled externally (admin/manual). No Stripe/xPay on storefront. xPay gateway adapter exists for billing — natural extension point. | Critical |
| 3 | **Pickup window scheduling** | Design doc: "future-ready flags for curbside and pickup windows" | Customer can't choose a pickup time slot. Schema has `pickup_ready_at` / `picked_up_at` / `curbside_arrived_at` but no scheduling UI. | Medium |
| 4 | **Subdomain-based storefront URLs** | Implementation plan: "path-based now, subdomain-ready later" | Only `example.com/store/acme-retail/*` works. Tenant resolution code is pluggable — path-param extraction only. | Low |
| 5 | **Regression testing (Task 8.3)** | 13 manual checklist items in implementation plan | Code-complete but unverified against live/staging DB. Required before merge. | Blocker |

### Competitive Analysis Phase 1 Items NOT Built

These are features the competitive analysis tagged as Phase 1 priority but the implementation plan chose to defer:

| Feature | Competitive ID | Why Deferred |
|---------|---------------|-------------|
| Shipping label printing from POS | SP-1 (detail), SP-22 | Needs shipping provider API keys (USPS/DHL/FedEx or Pakistan courier label APIs) |
| Send cart (email cart link to complete purchase online) | SP-3 | Scoped out — Phase 2. Cart serialization + email + online checkout link needed |
| Local delivery management (zones, own drivers, delivery windows, fees) | SQ-4 | Only `ship_to_customer` delivery method exists. No zone config, no own-fleet management |
| eGift cards purchasable from online store | SQ-6a | Gift cards exist in POS but no online purchase flow. Low priority |
| Online marketing tools (pop-ups, email capture, lead forms) | SQ-6b | Phase 3 territory (Marketing & Engagement) |

### Explicitly Out of Scope for Phase 1 (design doc §13)

| Item | Target Phase |
|------|-------------|
| Separate standalone storefront application | Phase 2+ |
| Restaurant vertical (tables, KDS, QR ordering) | Phase 4 |
| Appointments vertical (booking, calendars) | Phase 4 |
| Service-business tooling (contracts, recurring invoices) | Phase 4 |
| Banking / BNPL / financial-licensing features | Cannot build (licensing) |
| Location-specific pricing as full subsystem | Phase 2 |
| Full CMS / page-builder system | Phase 2+ |

### Updated Gap Count After Phase 1

| Category | Gaps Before Phase 1 | Closed by Phase 1 | Remaining |
|----------|---------------------|-------------------|-----------|
| Omnichannel / Online Store | ~14 unique | 10 (storefront, BOPIS, curbside, ship-from-store, endless aisle, online returns, unified history, omnichannel promos, channel publication, product reviews online) | ~4 (send cart, local delivery zones, eGift online, marketing tools) |
| **Total across all categories** | **~134 unique** | **~10** | **~124** |

Phase 1 closed the single most critical gap category — omnichannel. SanoPOS moved from "**Square/Shopify leads** (online store + BOPIS + curbside)" to **at parity** on core omnichannel capabilities.
