# Square Complete Platform Research

**Date:** 2026-04-13  
**Purpose:** Comprehensive analysis of Square's entire platform — products, modes, industries, ecosystem, strategy — to inform SanoPOS architecture  
**Target:** Build equivalent of Square's Premium tier ($149/mo) restaurant features as first mode

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [POS Modes](#2-pos-modes)
3. [Industries Served](#3-industries-served)
4. [Pricing Model](#4-pricing-model)
5. [Add-On Products](#5-add-on-products)
6. [Hardware Lineup](#6-hardware-lineup)
7. [Banking & Financial Services](#7-banking--financial-services)
8. [Loyalty Program](#8-loyalty-program)
9. [Marketing (Email + SMS)](#9-marketing-email--sms)
10. [Team Management](#10-team-management)
11. [Inventory Management](#11-inventory-management)
12. [Invoicing](#12-invoicing)
13. [Analytics & AI](#13-analytics--ai)
14. [Online Store & Ecommerce](#14-online-store--ecommerce)
15. [Appointments & Beauty](#15-appointments--beauty)
16. [Developer Platform & API](#16-developer-platform--api)
17. [International Expansion](#17-international-expansion)
18. [Onboarding Flow](#18-onboarding-flow)
19. [Multi-Location Support](#19-multi-location-support)
20. [Competitive Positioning](#20-competitive-positioning)
21. [Square's Evolution](#21-squares-evolution)
22. [Block Ecosystem Strategy](#22-block-ecosystem-strategy)
23. [Square's Weaknesses](#23-squares-weaknesses)
24. [Restaurant Deep Dive — How Each Feature Works](#24-restaurant-deep-dive)
25. [Restaurant Tier Comparison](#25-restaurant-tier-comparison)
26. [SanoPOS Gap Analysis](#26-sanopos-gap-analysis)
27. [Strategic Takeaways for SanoPOS](#27-strategic-takeaways-for-sanopos)

---

## 1. Platform Overview

Square (part of Block, Inc.) is a commerce platform serving 4+ million merchants. It operates as **one unified platform with multiple personalities** — the same codebase transforms based on business type, device, and plan tier.

**The Three-Part Block Ecosystem:**
- **Square** (Merchants) — POS + payments + business tools
- **Cash App** (Consumers) — P2P payments + banking (100M+ users)
- **Afterpay** (BNPL) — buy-now-pay-later at checkout

**Revenue Breakdown (2022):**
- Transaction processing fees: ~62% of revenue
- Software subscriptions: growing but secondary
- Hardware: sold near-cost (razor-and-blade model)
- Financial services: loans, payroll, cash advances

---

## 2. POS Modes

Square has **7 distinct operational modes** within one app:

| Mode | Target | Key Features |
|------|--------|-------------|
| **Full Service** | Sit-down restaurants | Floor plans, seat management, coursing, tableside ordering |
| **Quick Service** | Counter service, food trucks | Fast ordering, pre-set combos, pickup numbers |
| **Bar** | Bars, breweries | Quick no-fuss checkout, preauthorized tabs |
| **Retail** | Product-based stores | Inventory, vendor POs, bulk intake, barcode scanning |
| **Bookings** | Appointment businesses | Connected to Square Appointments |
| **Services** | Professional services | Connected to Square Invoices |
| **Standard** | Generic / any business | Universal POS features |

### How Modes Work

- **Selection**: Merchants pick mode during onboarding or change via Settings
- **Per-device**: Different devices can run different modes simultaneously (e.g., Full Service on dining floor iPad, Quick Service on counter register)
- **No mixing**: Cannot combine features from multiple modes into a hybrid. Must switch modes completely
- **Switching**: POS switches after reboot, completed transaction, or app close/reopen
- **Hardware constraint**: Full Service, Quick Service, and Bar modes require dedicated Square hardware (not available on phones/generic tablets)
- **AI verification**: Square uses RoBERTa ML models to verify merchant categories and auto-correct wrong selections

### What Each Mode Changes

The mode controls:
- POS layout and checkout flow
- Floor plan visibility
- Coursing availability
- KDS behavior and ticket routing
- Available buttons and shortcuts
- Default checkout settings
- Which add-ons are visible

---

## 3. Industries Served

### Food & Beverage
- Full-service restaurants
- Quick-service restaurants (QSR)
- Fast-casual restaurants
- Bars and breweries
- Catering services
- Coffee shops
- Food trucks
- Pop-up shops
- Bakeries and cafes

### Retail
- Clothing and fashion
- Home and gift
- Wine and liquor
- Grocery
- Garden and outdoor
- General merchandise
- Specialty retail

### Beauty & Personal Services
- Hair salons
- Nail salons
- Day spas
- Barbershops
- Tattoo and piercing studios
- Med spas

### Professional Services
- Web designers
- Law firms
- Freelancers
- Contractors
- Consultants
- Physicians
- Photographers
- Accountants

### Health & Fitness
- Healthcare practices
- Fitness studios
- Gyms
- Wellness centers

### Other
- Home and commercial services
- Automotive services
- Transportation services
- Home repair
- Nonprofits
- Creatives

---

## 4. Pricing Model

Square consolidated from 18 à la carte subscriptions to three unified tiers (October 2025):

| | **Free** | **Plus** | **Premium** |
|---|---|---|---|
| Monthly fee | $0 | $49/location | $149/location |
| In-person rate | 2.6% + 15¢ | 2.5% + 15¢ | 2.4% + 15¢ |
| Online rate | 3.3% + 30¢ | 2.9% + 30¢ | 2.9% + 30¢ |
| Manual entry | 3.5% + 15¢ | 3.5% + 15¢ | 3.5% + 15¢ |
| Gift card loads | 2.5% | 2.5% | 0% |
| KDS | — | $30/device/mo | $20/device/mo |
| Kiosk | — | $50/device/mo | $30/device/mo |
| SMS included | — | 500/mo | 2,500/mo |
| Phone support | 90 days only | M-F business hours | 24/7 |
| Free trial | — | 30 days | 30 days |

**Strategy**: Free tier is customer acquisition. Real margin comes from processing fees on every transaction + upselling to Plus/Premium. Merchants processing $25,000+/mo save enough on the 0.1% rate reduction to justify $49/mo.

---

## 5. Add-On Products

| Product | What It Does | Pricing |
|---------|-------------|---------|
| **Square KDS** | Kitchen display system on Android tablets | $20-30/device/mo |
| **Square Kiosk** | Self-service ordering station | $30-50/device/mo |
| **Square Loyalty** | Digital loyalty program (points, tiers) | $45/mo |
| **Square Marketing** | Email + SMS campaigns | $15-40/mo (email), $20-195/mo (SMS) |
| **Square Payroll** | Employee payroll + tax filing | $35/mo + $6/employee |
| **Square Online** | Ecommerce website + online ordering | Free (included) |
| **Square Invoices** | Estimates, invoices, recurring billing | Free (basic), Plus for advanced |
| **Square Gift Cards** | Digital + physical gift cards | Included (processing fee on loads) |
| **Square Appointments** | Online booking + scheduling | Free (solo), $29-149/mo |
| **Square Banking** | Checking, savings, loans, instant deposits | Free (no monthly fees) |
| **Square Card** | Business debit card | Free |

---

## 6. Hardware Lineup

| Device | Price | What It Does |
|--------|-------|-------------|
| **Square Register** | $899 | 13.25" touchscreen + customer display, built-in payments, 5 USB ports |
| **Square Terminal** | $299 | 7" portable all-in-one, built-in printer + payments, 24h battery |
| **Square Stand** | ~$149 | iPad mount with integrated card reader |
| **Square Reader** (2nd gen) | ~$49 | Portable BLE 5.3 contactless/chip reader, USB-C, 24h offline |
| **Square KDS Display** | $699-899 | MicroTouch 15.6" or 21.5" Android touchscreen |
| **Square Kiosk Mount** | Varies | Wall/countertop/VESA-compatible iPad mount |
| **Square Reader for Magstripe** | Free/Low | Legacy magnetic stripe reader |

---

## 7. Banking & Financial Services

**Square Checking:**
- Instant deposits of processing funds (same-day)
- No monthly fees
- Real-time balance visibility in POS dashboard

**Square Savings:**
- Automatic deposit sweep across FDIC-insured partner banks
- Up to $2.5M FDIC insurance coverage
- Automated "folders" for taxes, supplies, payroll
- Personalized savings recommendations based on cash flow

**Square Loans:**
- Proactive, personalized loan offers based on sales data
- Instant deposit to Square Checking
- Automatic repayment via percentage of daily Square sales
- No hidden fees — simple, transparent terms
- $200B+ total credit provided across Block ecosystem

**Square Card:**
- Business debit card tied to Square Checking
- Cash back on select purchases
- No foreign transaction fees

---

## 8. Loyalty Program

**How It Works:**
- Customers enroll via POS, website, or invoice using phone number
- Digital tracking — no physical cards needed
- Points earned per-visit or per-spend (configurable)

**Features:**
- Tier-based rewards with different benefits per tier
- Reward types: discount on sale, specific item free, combo rewards
- Transactional SMS notifications (points earned, reward available)
- Integration with Square Marketing for targeted campaigns
- Digital wallet integration (Apple Wallet loyalty pass)
- Tap smartphone on contactless reader to redeem
- Works on app, web, and in-store

**Pricing:** Starting at $45/month

---

## 9. Marketing (Email + SMS)

**Email Campaigns:**
- Customer segmentation: new, lapsed, regular, high-value
- Automated campaigns: welcome, birthday, abandoned cart, win-back
- AI-powered content creation (OpenAI integration)
- 1.7x higher open rates, 2.3x higher coupon redemption vs one-off blasts
- Campaign scheduling and multi-channel follow-ups

**SMS Campaigns:**
- Automated recurring SMS
- Loyalty reminders (nearing reward, available reward, anniversary)
- Birthday and lapsed customer re-engagement
- Plus: 500 texts/mo then 3¢/text
- Premium: 2,500 texts/mo then 1.5¢/text

**Key Feature:** Built-in CRM (Square Customer Directory) auto-builds opt-in lists from transactions. Campaign attribution ties marketing spend to actual sales.

---

## 10. Team Management

**Square Shifts (Scheduling):**
- Create team schedules
- Track availability and assign shifts
- Staff access via Square Team App
- Time-off requests and shift swapping
- Open-shift scheduling

**Time Tracking:**
- Digital timecards (clock in/out via PIN at register or mobile app)
- Geofencing enforcement (verify employee location)
- Automatic break tracking
- Overtime calculations
- Shift history and workday summaries

**Square Payroll:**
- Timecards sync directly with payroll
- Automatic tip and commission calculations
- Automated tax filings
- Export to third-party payroll systems
- $35/month + $6 per employee

**Square Team App:**
- One app for communication, schedules, timecards
- View hours worked, breaks, overtime, estimated pay
- Mobile clock in/out
- Real-time notifications

---

## 11. Inventory Management

**Core Features:**
- Unlimited item catalog
- Multi-location inventory tracking
- Real-time stock transfers between locations
- Barcode integration
- Stock alerts and low-inventory warnings

**COGS (Cost of Goods Sold):**
- Track unit costs per item and variation
- Automatic COGS calculations on sales
- Profit margin analysis
- Inventory turnover metrics

**Vendor Management:**
- Create vendor profiles
- Vendor Sales report (which suppliers sell best)
- Purchase order integration
- Track supplier performance

**Restaurant-Specific (MarketMan, 2026):**
- AI-driven ingredient and recipe management
- Real-time visibility into ingredient usage across locations
- Forecast ingredient needs from historical + live demand
- Automatic POS ↔ inventory sync
- Order Guide: AI-powered procurement, vendor comparison

**Reports (Plus/Premium):**
- Advanced COGS reports
- Inventory Sell-Through
- Aging Inventory
- Profit margin analysis

---

## 12. Invoicing

**Core Features:**
- Unlimited free invoicing (all plans)
- Automatic payment reminders (before, on, after due date)
- Batch invoicing to multiple customers
- Invoice customization and templates
- Mobile app for creating/sending invoices

**Estimates:**
- Detailed estimates sent via email, text, or link
- Convert accepted estimates to invoices automatically
- Request instant payment

**Recurring Invoices:**
- Automatically email invoices on custom schedule
- Auto-payment if customer has card on file

**Payment Schedules & Deposits:**
- Split payments into multiple milestones (up to 12 per invoice)
- Schedule deposits and final balance separately
- Progress-based or time-based payment schedules

---

## 13. Analytics & AI

**Square AI (launched May 2025):**
- Conversational chat interface within Dashboard
- Ask questions about sales, transactions, staff, customers in natural language
- AI interprets queries and surfaces data automatically
- Pinnable, saveable data visualizations on custom dashboards
- Mobile app with voice control

**Neighborhood Insights (2026):**
- External data: weather, events, news, reviews
- Merged with business metrics
- Real-time staffing, menu, and inventory recommendations

**Standard Reporting:**
- Real-time sales dashboards
- Employee/staff performance reports
- Customer analytics
- Inventory and COGS reports (Plus/Premium)
- Payment and transaction summaries
- Close-of-day reports
- Shift reports

**Restaurant-Specific:**
- Kitchen performance reports (prep times, throughput)
- Menu performance tracking (by item, category, payment type)
- Service reports (section-level sales, comps, voids)
- AI-powered demand forecasting

---

## 14. Online Store & Ecommerce

**Square Online (included free):**
- Drag-and-drop website builder (no coding)
- Free SSL certificate and hosting
- Unlimited bandwidth
- Unlimited products with photos, descriptions, variations
- SEO tools
- Social selling integration

**Omnichannel Integration:**
- Bidirectional sync with POS Item Library
- Unified inventory across in-store and online
- Consolidated reporting
- Customer tracking across channels

**Sales Channels:**
- Square Online Store
- Instagram Shop
- Facebook Shop
- Google Food Ordering (restaurants)
- Google Product Listings

**Fulfillment:**
- Shipping (configurable rates)
- Local pickup
- Delivery (DoorDash, Uber Eats integration)
- Curbside pickup with text notifications

**Third-Party Ecommerce Integrations:**
- Shopify, WooCommerce, BigCommerce, Wix, Magento, Squarespace
- Amazon, Walmart, eBay (marketplace sync)

---

## 15. Appointments & Beauty

**Pricing:**
- Solo/Individual: Free ($0/mo)
- Plus: $29-49/mo per location
- Premium: $149/mo per location

**Online Booking:**
- 24/7 customer booking via customizable booking website
- QR codes for contactless booking
- Embed booking widget on existing website
- Waitlist management (auto-fills cancellations)

**Staff & Service Management:**
- Multi-staff appointments
- Resource management (rooms, stations, chairs)
- Real-time calendar syncing (Google Calendar)
- Service-to-staff assignment
- Staff commissions tracking

**No-Show Protection:**
- Customizable no-show policies and fees
- Prepayment requirements
- 21% reduction in no-shows when cancellation fees enforced

**Automation:**
- Email/SMS confirmations and reminders
- Square Assistant (AI) auto-responds to reschedule/cancel requests 24/7
- Waitlist auto-filling

**Beauty-Specific:**
- Retail product inventory alongside services
- Client loyalty programs
- Tipping options
- Salons selling services + products see 43% higher annual sales than service-only

---

## 16. Developer Platform & API

**APIs Available:**
- Payments API — accept and manage payments, refunds
- Orders API — create, manage, track orders
- Invoicing API — create, configure, publish invoices
- Subscriptions API — manage recurring billing
- Inventory API — track stock across locations
- Catalog API — manage product catalogs
- Customers API — build customer directories
- Employees API — manage team and shifts
- Bookings API — manage appointments
- Vendors API — manage suppliers

**App Marketplace:**
- Third-party integrations built on Square's platform
- Categories: accounting (QuickBooks, Xero), delivery (DoorDash, Uber Eats), CRM, inventory, analytics
- Marketplace listing requires: 5+ active sellers, technical requirements met, partner approval

---

## 17. International Expansion

**Current Footprint:** 8 countries
- United States (94% of revenue)
- United Kingdom
- Canada
- Australia
- Japan
- Ireland
- Spain
- France

**Strategy:** Cautious, selective expansion into English-speaking markets with similar regulatory frameworks. Each country requires different payment methods, VAT/GST rules, regulatory reporting, and data residency compliance.

**Key Insight:** Square is NOT a global platform. It's a US platform with careful toe-holds in a few mature markets. International is only 6% of total revenue after 15+ years.

---

## 18. Onboarding Flow

**Process:**
1. Account creation (5 minutes, no credit check, no proof of revenue)
2. Business type selection from pre-defined dropdown
3. Business details: name, address, structure
4. Verification against business registries
5. Account activation with default features for selected business type
6. Mode pre-configuration based on business type
7. Hardware shipped (if ordered)
8. Download app → connect reader → accept first payment immediately

**Philosophy:** Remove every barrier. No application approval. No underwriting. No waiting. All onboarding is self-service — no sales reps.

**Post-Onboarding:** Square uses AI (RoBERTa models) to verify merchant category accuracy and auto-correct if wrong.

---

## 19. Multi-Location Support

**What Works:**
- Create locations in dashboard
- Centralized reporting across all locations
- Same POS app across all locations
- Shared inventory (basic)
- Unified customer view

**What Doesn't Work Well:**
- Per-location role-based permissions (limited)
- Per-location pricing strategies
- Complex inter-location inventory transfers
- Per-location compliance/tax rules
- Staff scheduling across multiple locations
- Advanced cost controls per location

**Key Insight:** This is where 10-100 location chains leave Square for Toast or Lightspeed. SanoPOS already has multi-outlet support — this could be a differentiator.

---

## 20. Competitive Positioning

| Competitor | Market Share | Strength | Weakness |
|-----------|-------------|----------|----------|
| **Square** | 28.1% | Breadth — serves all business types | Depth — can't match specialists |
| **Toast** | 23.5% | Deep restaurant specialization | Restaurant-only |
| **Clover** | ~15% | Hardware-first, simple checkout | Limited software depth |
| **Lightspeed** | ~8% | Enterprise inventory complexity | Too complex for small businesses |
| **Shopify POS** | ~10% | Ecommerce-first omnichannel | Weak in-store POS |

**Square's Moat:** Ecosystem switching cost. 44% of gross profit comes from merchants using 4+ Square products. When you use Payments + POS + Payroll + Loyalty + Appointments, switching becomes costly.

---

## 21. Square's Evolution

| Period | Focus |
|--------|-------|
| 2009-2014 | Pure payment processing + hardware innovation |
| 2015-2017 | Vertical expansion (inventory, appointments, delivery) |
| 2018-2020 | Acquisitions (Weebly, Caviar sold to DoorDash) |
| 2021 | Rebrand to Block Inc. Acquire Afterpay + Tidal |
| 2022-2023 | Ecosystem integration. Cash App + Square synergies |
| 2024-2025 | Focus shift — "Rule of 40" profitability. Consolidate products. Launch AI |
| 2025-2026 | Unified pricing (3 tiers). Square AI. MarketMan partnership. Voice ordering |

**Key Strategic Shift (2024+):** Stop trying to own everything. Scale back Tidal, wind down TBD (blockchain tools). Focus on synergies between core products. Move from expansion to efficiency.

---

## 22. Block Ecosystem Strategy

**The Three-Part Flywheel:**
1. **Square** (Merchants) → Payment processing + business tools
2. **Cash App** (Consumers) → P2P payments + banking (100M+ users, 3.5% APY)
3. **Afterpay** (BNPL) → Consumer flexibility + merchant checkout boost

**The Synergy:**
- Merchant accepts Afterpay → attracts Cash App users
- Cash App user sees merchant promotions → drives transaction volume
- Both feed data into unified Square dashboard
- Cross-sells: Square seller → Cash App user; Cash App user → becomes merchant

**Also:**
- Bitcoin acceptance with zero processing fees through 2026 (loss leader)
- $200B+ total credit provided across ecosystem

---

## 23. Square's Weaknesses

### Product Gaps
- Advanced inventory (multi-location reordering, complex SKUs)
- Complex restaurant workflows (deep kitchen management)
- Enterprise reporting/analytics
- Advanced CRM beyond basic directory
- Specialized compliance (healthcare HIPAA, salon licensing)
- Detailed food cost percentage tracking
- Advanced table management depth

### Customer Service Gaps
- No phone support for non-paying accounts
- Account freezes with minimal recourse (3,283+ BBB complaints)
- Long response times
- Support codes required to reach a rep
- No escalation path for frozen accounts
- Some holds last up to 180 days

### Technical Gaps
- WiFi reliability issues during high-volume events
- Limited reporting customization
- Full Service/Quick Service/Bar modes require dedicated Square hardware
- KDS only on Android tablets
- No advanced forecasting without MarketMan

---

## 24. Restaurant Deep Dive — How Each Feature Works

### Floor Plan (Operational Detail)

- Accessed via Settings > Restaurant settings > Floor plans in Square Dashboard
- Drag-and-drop table positioning on a grid
- Multiple floor plans per location (e.g., lunch layout vs dinner layout)
- **Sections**: named areas like Dining Room, Bar, Patio — each section gets its own group of tables
- Tables have: label, size, shape (customizable to match physical layout)
- Tables can be removed from floor plan without losing data
- Color-coded timers:
  - Tables turn **yellow** after configurable time (e.g., 30 min)
  - Tables turn **red** after configurable time (e.g., 60 min)
  - Helps staff identify tables that need attention or are ready to turn
- Real-time occupancy tracking across all tables
- Floor plans configured in Dashboard but displayed in POS app

### Table & Seat Management (Operational Detail)

Three seat tracking modes (configurable per device mode):

1. **Cover count only** — just track how many guests
2. **Cover count with optional seat positions** — can assign items to seats but not required
3. **Cover count with required seat positions** — must assign every item to a seat number

Each seat can have its own items, enabling per-seat billing and check splitting by seat.

### Coursing — Hold & Fire (Operational Detail)

Setup: Settings > Device Management > Modes > Enable Course Management

How it works in the POS:

1. Server opens/creates a check on a table
2. Taps a course in the cart to select it (e.g., "Appetizers")
3. Adds items to that course
4. Can create additional courses via "Add Course" button
5. Courses can be **held** or **fired**:
   - **Held**: items stay in the check but are NOT sent to kitchen
   - **Fired**: tap fire icon → tickets print to kitchen printers AND appear on KDS
6. Items can be dragged between courses if guests change their minds
7. Firing options: preset straight-firing, one-tap firing, and holding
8. KDS display options:
   - Show fired and held courses (both visible)
   - Only show fired courses (held courses hidden until fired)
9. "View all courses" on KDS shows consolidated ticket summary for a table

### Kitchen Display System — KDS (Operational Detail)

- Runs on Android tablets (Square-specific; SanoPOS runs in browser — any device)
- **Station configuration**: set up multiple stations (prep, expo, bar) matching kitchen layout
- **Ticket routing**: items route to the correct station based on item category/type
- **Custom ticket layouts**: adjust text sizes, layout per station's needs
- **Ticket timers**: color-coded time indicators (green → yellow → red)
- **Bump/recall**: kitchen staff bump completed tickets; can recall if needed
- **Multi-device sync**: all KDS screens stay in sync in real-time
- **Kitchen performance reports**: prep times, throughput, efficiency metrics
- **Auto-printing**: tickets auto-print to station-specific printers when fired
- KDS is a paid add-on ($20-30/mo per device depending on plan)

### Check Management (Operational Detail)

- Split by seat — each seat becomes its own check
- Split by item — custom assignment of items to new checks
- Equal split — divide total evenly
- Move items between checks
- Reopen closed checks (Plus/Premium only)
- Bar tabs with card preauthorization
- Automatic gratuity for large parties
- Check adjustments (service charge, gratuity, rounding)

### AI & Advanced Restaurant Features (Premium, 2026)

- **Square AI forecasting**: predicts demand, staff shifts, and ingredient usage
- **MarketMan integration**: AI-driven ingredient and recipe management
  - Real-time visibility into ingredient usage across locations
  - Forecast ingredient needs from historical + live demand
  - Automatic POS ↔ inventory sync
- **Order Guide**: AI-powered procurement tool
  - Centralized vendor data
  - Compare offerings across suppliers
  - Track trends, spot gaps
- **Square AI neighborhood insights**: merges weather, events, news, reviews with sales data
- **Vendor sales reporting**: cross-supplier analysis

---

## 25. Restaurant Tier Comparison

### All Plans (Free + Plus + Premium)

- Menu management & modifiers
- Real-time menu sync across channels
- Bulk menu editing
- Item availability marking
- Online ordering page
- All payment types (tap, chip, swipe, Apple Pay, Google Pay, Cash App Pay)
- Offline payment processing
- QR code payments
- Bar tab preauthorization
- Basic sales dashboards
- Time tracking, role-based permissions, shift scheduling, tip pooling
- Third-party order consolidation (DoorDash, Grubhub)

### Plus Plan Additions ($49/mo)

- Custom floor plans (drag-and-drop)
- Seat management (3 modes: count only, optional seats, required seats)
- Course management (hold/fire)
- Split checks (by seat, by item, equal)
- KDS integration (ticket routing, timers, bump/recall)
- Close-of-day reports
- Shift reports
- Order-ready texts to customers
- Reservation integration (OpenTable, Resy)
- Reopen closed checks
- Automatic gratuity for large parties
- Advanced inventory tools
- Team management tools
- Sales trend reporting

### Premium Plan Additions ($149/mo)

Everything in Plus, plus:

- Vendor sales reporting
- AI-powered demand forecasting (ingredient needs from historical + live data)
- Advanced inventory management (MarketMan integration)
- Square AI — merges weather, events, reviews with sales data for staffing/menu decisions
- Lower processing rates (2.4% + 15¢)
- Free gift card loads (0% fee)
- 24/7 phone support
- Lower KDS pricing ($20/device vs $30)
- Lower Kiosk pricing ($30/device vs $50)
- 2,500 SMS/mo (vs 500)

---

## 26. SanoPOS Gap Analysis

### What SanoPOS Already Has (Backend Done)

| Square Feature | SanoPOS Backend | SanoPOS Frontend |
|---|---|---|
| Custom floor plans | `restaurant_floor_plans` + `restaurant_floor_sections` tables | List view only, "New Plan" button is stub |
| Drag-and-drop tables | `pos_x`, `pos_y`, `shape`, `capacity` fields in schema | Not built |
| Multiple floor plans | API supports multiple per outlet | Works (tab selector) |
| Table sessions (seat/unseat) | `restaurant_table_sessions` table + API | Basic seat modal |
| Seat management | `restaurant_check_seats` table + API | Not built |
| Course management (hold/fire) | `restaurant_course_fires` table + API | Button exists but untested |
| KDS with ticket routing | `kds_stations`, `kds_tickets`, `kds_station_routes` + API | Stuck on loading bug |
| KDS ticket timers | — | Has elapsed time + color (green/yellow/red) |
| Split checks (seat/item) | `splitCheckBySeat()`, `splitCheckByItem()` service functions | Basic modal, untested |
| Bar tabs | `restaurant_tabs` table + API | Not built |
| Card preauth on tabs | `restaurant_preauth_holds` table + API | Not built |
| Check adjustments (gratuity etc.) | `restaurant_check_adjustments` table | Not built |
| QR customer ordering | Public routes: `/api/public/restaurant/menu/:token` | Not built |
| Automatic gratuity | Via check_adjustments | Not built |
| Close-of-day / shift reports | Shift reports exist | Works |

### What SanoPOS Does NOT Have Yet

| Square Feature | Status | Effort |
|---|---|---|
| Color-coded table timers (yellow/red) | Not built | Small — frontend only |
| Reopen closed checks | Not built | Small — backend + frontend |
| Drag items between courses | Not built | Medium — frontend UX |
| Reservation integration | Not built | Large — no equivalent partner |
| Order-ready texts to customers | Not built | Medium — SMS integration needed |
| AI demand forecasting | Not built | Large — restaurant-specific AI |
| Ingredient/recipe management | No schema | Large — new domain |
| Vendor sales reporting | Not built | Medium — reporting |
| MarketMan-style inventory | Not built | Large — new integration |

### What SanoPOS Has That Square Charges Extra For

| Feature | Square | SanoPOS |
|---|---|---|
| KDS | $20-30/mo per device | **Included** |
| Kiosk ordering | $30-50/mo per device | **Included** (KioskRedesign) |
| Multi-outlet support | Varies by plan | **Included** |

### Recommended Build Waves

**Wave 1 — Core Restaurant Flow (make it work end-to-end):**

1. POS restaurant mode (table context, seat selector, course selector, send-to-kitchen)
2. Floor Plan page (visual drag-and-drop, sections, color-coded timers)
3. KDS page (fix loading bug, add station management, improve ticket display)
4. Checks page (create checks, manage open checks, split, close)

**Wave 2 — Full Service Features:**

5. Bar tabs with preauth
6. Check adjustments (automatic gratuity, service charge)
7. QR ordering (public menu page)
8. Reopen closed checks
9. Drag items between courses

**Wave 3 — Premium Features:**

10. AI-powered demand forecasting
11. Ingredient/recipe management
12. Vendor sales reporting
13. Kitchen performance reports
14. Order-ready texts

---

## 27. Strategic Takeaways for SanoPOS

### What to Copy

1. **Mode/preset system** — One app that transforms per business type. This is the single most important architectural decision.

2. **Unified pricing tiers** — Three simple tiers (not 70 feature flags). Industry doesn't change the price — it changes the experience.

3. **Frictionless onboarding** — Pick business type → app adapts → start selling. No sales reps, no 30-minute setup.

4. **Composable add-ons** — Core POS is free/cheap. Revenue from processing + premium add-ons (KDS, loyalty, marketing).

5. **Per-device modes** — Different devices can run different modes. Restaurant has Full Service on dining floor, Quick Service at counter.

6. **Integrated ecosystem** — Payments + POS + loyalty + marketing + team = switching cost moat.

### What to Do Better Than Square

1. **Customer support** — Square's #1 complaint. Be responsive. Don't freeze accounts without explanation.

2. **Multi-location depth** — Square is weak here. SanoPOS already has multi-outlet with per-outlet inventory, transfers, and outlet-scoped permissions.

3. **KDS on any device** — Square requires Android tablets. SanoPOS runs in browser — any device can be a KDS.

4. **Include KDS for free** — Square charges $20-30/device/mo. Include it — instant differentiator.

5. **Pakistan/emerging market focus** — Square only serves 8 countries (94% US). Dominate Pakistan, then expand regionally. Square can't serve your market.

6. **FBR/tax compliance** — Built-in FBR digital invoicing. Square has nothing for Pakistan tax compliance.

7. **Deeper restaurant features** — Square's restaurant mode is good but not best-in-class (Toast wins here). Build toward Toast-level depth with Square-level breadth.

### What NOT to Copy

1. **Payment processing as core revenue** — In Pakistan, the processing market is different. Focus on software subscriptions + SanoPay orchestration fees.

2. **Hardware dependency** — Square sells hardware at cost and profits on processing. SanoPOS should remain hardware-agnostic (BYOD).

3. **Consumer app (Cash App)** — Don't build a consumer payment app. That's a completely different business. Partner with JazzCash/Easypaisa instead.

4. **Global expansion before dominating one market** — Square is still 94% US after 15 years. Focus on Pakistan first.

### SanoPOS Competitive Positioning

The strongest position for SanoPOS is:

> **Square's breadth + Toast's restaurant depth + Pakistan-first compliance — all in one platform, at a fraction of the cost**

This means:
- Mode/preset system like Square (retail, restaurant, salon, services)
- Restaurant depth approaching Toast (floor plans, coursing, KDS, QR ordering)
- Built-in Pakistan compliance (FBR, courier integrations, local payment rails)
- Pricing for emerging markets (not $149/mo — value pricing for Pakistani SMBs)

---

## Sources

### Square Official
- [Square POS Platform](https://squareup.com/us/en/point-of-sale)
- [Square Pricing](https://squareup.com/us/en/pricing)
- [Square for Restaurants](https://squareup.com/us/en/point-of-sale/restaurants)
- [Square for Retail](https://squareup.com/us/en/point-of-sale/retail)
- [Square Appointments](https://squareup.com/us/en/appointments)
- [Square Banking](https://squareup.com/us/en/banking)
- [Square Loyalty](https://squareup.com/us/en/software/loyalty)
- [Square Marketing](https://squareup.com/us/en/marketing)
- [Square Online](https://squareup.com/us/en/online-store)
- [Square Invoices](https://squareup.com/us/en/invoices)
- [Square AI](https://squareup.com/us/en/ai)
- [Square KDS](https://squareup.com/us/en/press/square-kds)
- [Square Shifts](https://squareup.com/us/en/staff/shifts)
- [Square Developer](https://developer.squareup.com/us/en)
- [Square Industries](https://squareup.com/us/en/industry)
- [POS Modes Help](https://squareup.com/help/us/en/article/8458-use-modes-with-square-point-of-sale)
- [MarketMan Integration](https://squareup.com/us/en/press/square-restaurant-inventory-marketman)
- [Square AI Launch](https://squareup.com/us/en/press/square-releases-ai)

### Square Restaurant (Operational Detail)
- [Square Floor Plan Help](https://squareup.com/help/us/en/article/6427-building-your-floor-plan)
- [Square Coursing (Hold & Fire)](https://squareup.com/help/us/en/article/8172-hold-and-fire-courses-with-square-kds-and-square-for-restaurants)
- [Square Table Management Settings](https://squareup.com/help/us/en/article/8146-customize-table-management-settings)
- [Square Restaurant POS Pricing](https://squareup.com/us/en/point-of-sale/restaurants/pricing)
- [Square Restaurant POS Features](https://squareup.com/ca/en/point-of-sale/restaurants/features)

### Reviews & Analysis
- [NerdWallet — Square for Restaurants](https://www.nerdwallet.com/business/software/reviews/square-for-restaurants)
- [NerdWallet — Square for Retail](https://www.nerdwallet.com/business/software/reviews/square-for-retail)
- [Merchant Maverick — Square Review](https://www.merchantmaverick.com/reviews/square-for-restaurants-pos-review/)
- [POSUSA — Square Review](https://www.posusa.com/square-for-restaurants-review/)
- [The Retail Exec — Square Pricing](https://theretailexec.com/tools/square-pricing/)
- [Korona POS — Square Review](https://koronapos.com/blog/square-pos-review/)
- [Toast vs Square](https://pos.toasttab.com/compare/toast-vs-square)

### Strategy & Business
- [Block Competitive Advantage](https://www.fool.com/investing/2023/03/23/magnificent-competitive-advantage-block-stock-buy/)
- [Block Strategic Pivot](https://markets.financialcontent.com/stocks/article/finterra-2026-2-27-the-lean-machine-inside-blocks-40-pivot-to-an-ai-native-future-sq)
- [Block Lending Growth](https://www.pymnts.com/consumer-finance/2026/blocks-lending-tops-200-billion-across-cash-app-afterpay-and-square/)
- [Square Business Model Canvas](https://vizologi.com/business-strategy-canvas/square-business-model-canvas/)
- [Square Target Market](https://research-methodology.net/square-segmentation-targeting-positioning/)
- [Block Acquisitions](https://tracxn.com/d/acquisitions/acquisitions-by-square/)
- [Square International](https://fool.com/investing/2021/05/12/investors-shouldnt-discount-squares-international/)
- [RoBERTa Merchant Categorization](https://developer.squareup.com/blog/roberta-model-for-merchant-categorization-at-square/)
