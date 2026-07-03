# Square Software Audit

> **Purpose:** A deep, standalone catalog of Square's **software** product surface — the full feature set a Square competitor would need to cover. Researched directly from Square's live product pages (via browser), July 2026.
>
> **In scope:** Every customer-facing software product and its features — POS platform, all vertical POS editions, e-commerce, invoicing/estimates/contracts, payment links, subscriptions, marketing, CRM, loyalty, gift cards, messaging, staff/payroll, reporting/dashboard, AI features, franchise/enterprise, and the consumer booking marketplace.
>
> **Explicitly out of scope (per project decision):** hardware; open-source libraries; financial services (Checking, Savings, Loans, Credit Card, banking); Square Virtual Terminal; Tap to Pay; Cash App Pay / Afterpay merchant tooling; the Square App Marketplace / third-party integration ecosystem; developer APIs; and geographic/international availability.
>
> **Pricing accuracy:** all prices and processing rates are **as of July 2026** from Square's US site. Re-verify against [Sources](#sources) before quoting.

---

## 1. Executive summary

Square is an all-in-one commerce platform. A single account gives a business a shared **item library, customer directory, inventory, and reporting**, with purpose-built POS front-ends layered on top for each vertical. Around it sits a full suite of growth and back-office software: e-commerce, invoicing, marketing, loyalty, gift cards, messaging, staff management, payroll, and franchise tools.

The defining structural facts to understand before building:

1. **One platform, verticalized.** The same backend powers **7 POS modes** — Quick-Service, Full-Service, and Bar (the three Food & Beverage modes), plus Retail, Beauty, Services, and a general "all businesses" mode. A competitor isn't building 7 apps; it's building one core with vertical feature layers.
2. **Unified 3-tier pricing.** Square collapsed ~18 legacy subscriptions into **Free / Plus / Premium**, priced per location, with a **Pro** tier for high-volume merchants. Moving up a tier lowers your card-processing rate and unlocks more software.
3. **Everything cross-sells everything.** Every product page pushes every other product. Loyalty feeds Marketing; Marketing reads the Customer Directory; Payment Links carry Loyalty and Subscriptions; the Dashboard ties it all together. The **integration between products is the moat**, more than any single feature.

---

## 2. Pricing model (the backbone)

Priced **per location**. Higher tier → lower processing rate → more software.

| Tier | Monthly | In-person rate | Online rate | Positioning |
|------|---------|----------------|-------------|-------------|
| **Free** | $0 | 2.6% + 15¢ | 3.3% + 30¢ | Business essentials; pay only when you take a payment |
| **Plus** | $49 | 2.5% + 15¢ | 2.9% + 30¢ | Advanced, industry-specific features; "best value" |
| **Premium** | $149 | 2.4% + 15¢ | 2.9% + 30¢ | Lowest rates, 24/7 support, full capability suite |
| **Pro** | Custom | Custom | Custom | For merchants processing **>$250k/yr**; adds hardware discounts, onboarding/implementation support, technical specialists, dedicated account management |

- **30-day free trial** on Plus & Premium. No locked-in contracts; upgrade/cancel anytime.
- **Separate from the unified tiers:** Square Payroll (own pricing) and Square for Franchises (custom).
- **Square for Restaurants keeps its own plan structure** — see §6.
- Some standalone tools (Marketing, Loyalty, Gift Cards, Messages) are marketed as "get one plan for your entire business," i.e. bundled into the tier rather than separately priced.

---

## 3. Industries / business types served

| Macro-vertical | Business types |
|----------------|----------------|
| **Food & Beverage** | Coffee shops, quick service, drive-thrus, full-service restaurants, bars & breweries, food trucks, catering, bakeries, pizzerias |
| **Retail** | Clothing, home & gift, wine & liquor, grocery, garden centers |
| **Beauty** | Hair salons, nail salons, day spas, barbershops, tattoo & piercing, med spas |
| **Services** | Home repair, automotive, transportation, contractors, professional services, pet services, nonprofits, cleaning, landscaping, recreation, healthcare |

---

## 4. Core POS platform (shared by all editions)

The universal engine beneath every vertical edition:

- **Take any payment** — in person, online, over the phone, or in the field; swipe/dip/tap, digital wallets, QR, gift cards, Afterpay.
- **Offline mode** — keep taking card payments when the internet is down; they auto-process on reconnect (must reconnect within 24h).
- **Single item library** — items, products, services, and custom packages all in one catalog; a **custom item grid** for fast ring-up; real-time stock awareness.
- **Instant access to funds** (with a Square account) and next-day or instant transfers.
- **Real-time data & insights** across sales, team, and customers.
- **Fast setup / no training** positioning; intuitive UI.
- **Multi-location** from 1 to 100+ locations on the same account.

---

## 5. Square for Retail

Retail-optimized POS with the deepest inventory tooling.

**Inventory & catalog**
- Real-time stock across locations and channels (never oversell)
- Full inventory history (every sale, restock, adjustment)
- Bulk organize / update / receive inventory
- Purchase orders + vendor profiles (order, track, receive)
- Barcode label creation & printing (supported printers/templates)
- **Stocktake tool** — count inventory using the iPhone/iPad camera
- Build catalog via bulk import, barcode scan, or manual entry
- **AI setup** — generate item descriptions and professional product photos

**Checkout**
- All payment types incl. Afterpay & digital wallets
- Manual & automatic discounts
- Full/partial refunds **and exchanges**
- Sales sync across in-store + online + inventory

**Reporting / intelligence**
- Detailed item/category sales reports (how, when, where things sell)
- **Cost of Goods Sold (COGS)** + profitability tracking
- Inventory **sell-through** tracking
- **Slow-moving / aging stock** detection

**Plan breakdown**
| Plan | Adds |
|------|------|
| Free ($0) | Auto-create items & SKUs, discounts & refunds, sales reporting |
| Plus ($49) | Inventory management & stock intake, vendor & PO management, COGS + inventory reporting |
| Premium ($149) | Cross-location returns & fulfillment, transfer orders, 24/7 phone support |
| Pro | Custom (>$250k/yr) |

---

## 6. Square for Restaurants

Full F&B suite across the three modes (QSR, full-service, bar). **Its own pricing, not the unified $49/$149:**

- **Free** — basic day-to-day service
- **Plus** — **$60/mo per location + $40/mo per additional device** (Square KDS included, no extra device charge)
- **Premium** — custom (contact sales)
- **Flat 2.65% processing** on all restaurant plans
- **Device add-on note:** on the *unified* plans, the **Square KDS app** is a per-device add-on ($30/device on Plus, $20/device on Premium) and the **Square Kiosk app** is $50/device (Plus) / $30/device (Premium); the dedicated *Square for Restaurants Plus* plan bundles KDS at no extra device charge. Confirm which plan a feature is priced under.
- **Advanced/newer features (Premium-tier unless noted):** seat management, course management, **reservation integrations** (third-party — Square has no native reservations product), **Send & Stay**, **Drive-Thru**, plus (Plus-tier) advanced modifiers, order guide, item availability, bulk menu edits, house accounts, QR-code payments, order-ready texts, split/reopen checks.

**Quick-Service (QSR)**
- Fast order entry (customizable displays, menu photos)
- **Auto-86 & item counts** prevent overselling by auto-updating menu availability from stock
- Automatic **order-ready texts** to customers
- **Square Kiosk** — customer self-order in-store
- Guest profiles (contact, purchase history, saved cards, preferences)
- **Third-party delivery integration** — Uber Eats, DoorDash

**Full-Service**
- **Coursing** — time dishes, organize orders, streamline BOH communication
- **Table & seat management** — track tables, manage orders, maximize covers
- **Customizable floor plan editor**
- **Split checks** any way — by item, by seat, equal payments
- **Square KDS** — send orders to kitchen instantly, customize tickets, **prep insights** to optimize flow

**Bar service**
- Running **tabs**
- **Preauthorized bar tabs** for fast close-out
- **Dark mode** display for low-light rooms
- **Auto-gratuity** for larger parties
- Menu reporting (top drinks/snacks)

**Restaurant essentials (all modes)**
- Offline payments
- Order sync across in-store/online/locations
- **Close-of-day + live sales reports** on the POS
- **Tableside** order + payment
- **Sales vs. labor insights** for staffing

**Plan feature split**
| Plan | Features |
|------|----------|
| All plans | Fast Order Entry, Menu Manager, Order Manager, Table Management, Open Bills, Auto Gratuity, Remote Device Management, Multi-Location, free Team plan, 6am–6pm PT support |
| Plus adds | Close of Day reports, Auto 86ing, Item Counts, Shared Device Settings, Advanced Reporting, Square KDS included |

---

## 7. Square Appointments

Booking-first POS for services & beauty. Free for solo operators; unified tier pricing.

**Scheduling**
- Free **online booking site** (24/7 self-booking) + booking integrations
- **Unlimited staff schedules & calendars**; book any team member at any location
- **Google Calendar sync** (blocks personal events, avoids double-booking)
- **Resource management** — assign rooms/stations/chairs to services
- **Class bookings** — single or recurring sessions

**Payments**
- All types: cards, wallets, QR, payment links, Cash App Pay, gift cards
- **Cards on file** for no-show protection, prepayments, cancellation fees
- Afterpay (pay-over-time; merchant paid upfront)

**Automation & retention**
- Customizable email/SMS confirmations, reminders, rescheduling
- **No-show policies, fees, and prepayments**
- **Waitlist** that auto-fills cancellation openings
- **Square Assistant** — AI that auto-replies to clients to confirm/cancel/reschedule
- Customer profiles (preferences, birthdays, documents, images, files)
- **Intake forms & contracts collected during booking**

**Growth**
- **Square Go** — free consumer marketplace app where clients discover & book (see §19)
- Social booking (book from social pages)
- **Pre-paid service packages**
- Sell retail products alongside services in one transaction (with inventory)

**Plan breakdown**
| Plan | Rate (in-person / online) | Adds |
|------|---------------------------|------|
| Free ($0) | 2.6%+15¢ / 3.3%+30¢ | Online booking site + integrations, appointment reminders, unlimited calendars, invoicing |
| Plus ($49) | 2.5%+15¢ / 2.9%+30¢ | Everything in Free, lower rates, cancellation policy & no-show fees, multi-staff booking, waitlist, email & text marketing |
| Premium ($149) | 2.4%+15¢ / 2.9%+30¢ | Everything in Plus, lowest rates, 24/7 support, future-bookings report, service cost tracking, resource management |

---

## 8. Square Websites (e-commerce)

Free website + online-ordering builder (formerly "Square Online"), sharing the same catalog/inventory/customer directory as the POS.

- **Website builder**, no coding; customizable e-commerce **themes**
- **Custom domain** connect; free hosting
- Customer **accounts** (order tracking, tailored recommendations)
- Merchandising: spotlight new/top/sale/related products
- **Product drops & flash sales** promoted via pop-ups and banners
- **Fulfillment:** shipping (with discounts + real-time rates), free in-store pickup, local delivery (third-party couriers or own staff)
- **SEO tools** + Google & Meta integrations; sell on search & social
- Sell eGift cards; run promotions; reward loyalty online
- Cited stat: **+38% average revenue** for Square sellers who add a website

**Plan breakdown**
| Plan | Adds |
|------|------|
| Free ($0) | Website builder + SEO, pickup/local delivery/shipping, sell on search & social |
| Plus ($49) | Expanded site customization (buttons, badges, animations, premium stock photos), advanced item settings, **QR-code ordering & subscriptions** |
| Premium ($149) | Real-time shipping rates, advanced reporting, 24/7 support |

---

## 9. Square Payment Links

Sell without a website — a single reusable link/button/QR.

- Create a link in seconds; save as a **buy button** or **QR code**; reuse for standard offerings
- Customize with logo, business name, **custom fields**, buyer-entered amounts, tips
- Accept payment for deposits, classes, **recurring subscriptions**, and more
- One link can collect from **multiple customers simultaneously**
- Share via email, group text, social posts, embedded buy buttons, printed QR
- Built-in tracking/reporting in Square Dashboard
- Integrates with Marketing, Loyalty, Messages, Subscriptions
- **Pricing:** no monthly fee; **3.3% + 30¢** online (6% + 30¢ Afterpay)

---

## 10. Square Invoices (+ Estimates, Contracts, Projects)

A connected billing suite for service businesses.

**Invoicing & payments**
- Send digital invoices via email, SMS, or shareable link
- Pay by card, Apple/Google/Cash App Pay, **ACH bank transfer**, Afterpay
- In-person payments + refunds from Dashboard or POS
- **Cards on file** + automated billing
- Automatic taxes & discounts; accept tips

**Automation**
- **Recurring invoices** / recurring billing
- **Automatic payment reminders** (before, on, after due date)
- **Deposit requests** with separate due date for balance
- **Milestone/phase payment schedules** (multiple payments per job)
- **Batch invoices** (one invoice to many customers)

**Estimates → invoices**
- Professional estimates; auto-convert accepted estimates to invoices

**Contracts**
- Editable, reusable **contract templates**; build clauses from scratch, **use AI**, or adapt prebuilt clauses
- **E-signature** from anywhere
- Custom contract fields to capture client info

**Projects**
- Full **project pipeline** view — invoice delivery → review → paid, in real time
- Share details; clients review & sign invoices/estimates/contracts in one place

**Branding**
- Logo + color scheme; multiple saved layouts/templates; custom fields (terms, policies, messages)

---

## 11. Square Subscriptions

Standalone **recurring-billing** product, free (no monthly cost), managed from Square Dashboard.

- **Customizable billing models** — choose when payments process; monitor recurring revenue
- **Generate checkout links** — control how/where subscribers sign up
- Add/edit subscription plans; update plan details on the fly
- Use cases: donations, membership fees, professional services, subscription boxes, recurring services
- Also surfaced inside Websites (QR ordering & subscriptions), Payment Links (recurring), and Invoices (recurring billing)

---

## 12. Square Marketing

Personalized email + text campaigns to retain and reach customers.

- **Email marketing** — create, send, track campaigns from templates by goal
- **Text-message marketing** — one-time + automated (cited 98% open rate)
- **Automations** (one-time setup): welcome new customers, birthday, win-back lapsed customers, **abandoned-cart reminders**, more
- **Google Reviews collection** — auto email/text after a sale to gather reviews (no extra cost)
- Follow an email campaign with a reminder text
- Coupons/promotions with tracked redemption
- Track campaign success in Dashboard; attributed sales
- Bundled into the business plan (no separate contract)

---

## 13. Square Customer Directory (CRM)

Free built-in CRM, the data layer under Marketing/Loyalty.

- 360° customer view; stores info + interaction history
- **Custom groups/segments** by purchasing habits
- Syncs sales across all channels & locations
- Tracks **attributed sales** and coupon redemption
- Feeds Marketing, Loyalty, Messages

---

## 14. Square Loyalty

Points-based rewards that integrate across POS, website, and invoices.

- Earn by **visits, amount spent, or items/categories** purchased
- Enroll at POS, via website, or via invoice (phone-number based)
- Automatic transactional texts on points/rewards earned
- Redeem in-store or online
- **Promotions** — bonus points, limited-time or recurring
- **Digital loyalty passes** in Apple Wallet
- **VIP tiers** (new) — customizable name/structure; faster earning for frequent visitors
- 360° loyalty data — top customers, loyalty-attributed sales, avg spend loyalty vs non-loyalty
- Integrates with Marketing for campaign promotion

---

## 15. Square Gift Cards

Physical + digital gift cards, sold in person and online.

- Order physical cards; set up eGift cards
- **Scannable QR codes / barcodes** for redemption; store as card-on-file
- **Reload & balance-check** by customers themselves
- **Refund to gift card** as store credit
- Pre-designed or fully custom uploaded designs
- Syncs with POS reporting (no extra hardware/software)
- Promote via email marketing + social

---

## 16. Square Messages (+ Square Assistant)

Unified customer-communication hub.

- Manage **texts, emails, and payment links** from one inbox
- Send payment links in-thread (transaction context stays together)
- Access from Dashboard or mobile app
- Organizes Appointments questions/cancellations/confirmations and Invoices/estimates
- **Square Assistant** — AI auto-responder, **available only with Square Appointments**
- Tiering: payment links included with Free; starting new email/text conversations requires Plus/Premium

---

## 17. Square Feedback

Not a standalone marketed product — a **feature within customer engagement**: collect private customer **feedback from digital receipts**, viewable in the Dashboard's customer engagement tools. Pairs with the Google Reviews collection in Marketing for public reviews.

---

## 18. Staff & operations

Delivered through the **Square Team app** (one place for staff to communicate, view schedules/timecards, stay in sync).

- **Square Payroll** *(separate add-on)* — full-service **$35/mo + $6/person**; contractor-only **$6/person**. Pays W-2 + 1099, unlimited pay runs, **automatic federal/state tax filing** at no charge, imports timecards & tips from POS, benefits (401(k) via Vestwell; medical/dental/vision), pay by check/direct deposit/Cash App.
- **Square Shifts** — scheduling, timecards, wage management, labor-cost control.
- **Square Team Communication** — instant messaging, announcements, info sharing.
- **Square Advanced Access** — unlimited **custom permission sets** limiting what staff see/do across Dashboard, POS, and Team app; team-member-attributed activity log + monitoring.

---

## 19. Square Go (consumer booking marketplace)

A **free consumer-facing marketplace app** that surfaces Square Appointments sellers to nearby clients for discovery and booking — a demand-generation channel for beauty/wellness/service businesses, complementing their own booking site.

---

## 20. Square Dashboard + Square Analytics

The web + mobile **back-office headquarters**, free with any account.

- **Real-time reports** — hourly sales by location; compare performance over time
- **Square Analytics** — plain-language sales/business intelligence (advanced reports)
- **Dashboard mobile app** — manage the business and act on urgent tasks on the go
- Location management (compare locations, edit menus/prices across all, manage timecards)
- Customer engagement hub (directory download, **receipt feedback**, email campaigns, insights)
- Inventory management (real-time item edits, bulk upload, low-stock email alerts)
- Invoice tracking (who owes, who's paid)
- Team permissions (Advanced Access) with attributed activity log

---

## 21. Square AI (embedded capabilities)

Not a standalone product — AI woven through the platform:

- **Catalog setup** — AI-generated item descriptions and professional product photos (Retail)
- **Contract clauses** — AI-assisted clause generation (Invoices/Contracts)
- **Square Assistant** — automated client messaging (Appointments)
- Dashboard insights / automated setup tooling

---

## 22. Square for Franchises (enterprise / multi-unit)

Central operations hub for franchise brands — separate, custom-priced.

- **Corporate permissions** — control what franchisees can do/change from one central dashboard
- **Automated royalty calculation**
- **Menu catalog** publish / manage / approve centrally; location-level real-time updates
- Central multi-location **sales reporting** (health of any location)
- Multi-location **loyalty + gift cards** (earn/redeem at all locations)
- Offline mode; easy franchisee onboarding
- **Dedicated account manager**, custom processing rates, guided onboarding

---

## 23. Software surface — quick index (build checklist)

**Sell / transact:** Core POS · Retail POS · Restaurant POS (QSR/Full/Bar) · Appointments POS · Websites (e-comm) · Payment Links · Invoices · Estimates · Contracts · Subscriptions · Gift Cards · Offline mode · Kiosk self-order · KDS
**Grow / retain:** Marketing (email + text + automations) · Customer Directory (CRM) · Loyalty (+ VIP tiers) · Messages (+ Assistant) · Feedback · Google Reviews · Square Go marketplace
**Operate:** Payroll · Shifts · Team Communication · Advanced Access · Dashboard + Analytics (web + mobile) · Multi-location management · Inventory (bulk, PO, vendors, barcode, stocktake, COGS, sell-through) · Franchises

---

## 24. Appendix — full plan comparison matrix (Free / Plus / Premium)

Derived from Square's live interactive comparison table. Legend: **(all)** = every tier · **(Plus+)** = Plus & Premium only · **(Premium)** = Premium only · add-on prices noted. Out-of-scope rows (Square Banking; Tap to Pay; Cash App Pay/Afterpay; international/bitcoin fees) omitted.

**Payments & checkout**
- (all): discounts & refunds, age-verification prompts, bottle deposits, ACH bank transfers
- (Plus+): exchanges
- (Premium): cross-location returns & fulfillment

**Restaurant operations**
- (all): item & menu management, third-party order management, service charges, open checks & house accounts, auto-numbering, remote device management, automatic gratuity (simple % on Free → party-size thresholds on Plus+)
- (Plus+): custom floor plans, item availability, advanced modifiers, order guide, bulk-edit items in menus, instant payouts, QR-code payments, order-ready texts, split/reopen checks, preauthorize bar tabs, take orders tableside
- (Premium): seat management, course management, **reservation integrations** (third-party — no native reservations product), Send & Stay, Drive-Thru
- Add-ons: **Square KDS app** $30/device (Plus) · $20/device (Premium) — not in Free. **Square Kiosk app** $50/device (Plus) · $30/device (Premium) — not in Free

**Bookings**
- (all): unlimited calendars, custom scheduling, online booking site & integrations, prepayments & automatic contracts, appointment deposits, digital wallets in booking, appointment reminders/custom notifications, Square Assistant, Instagram/Facebook/Google integrations
- (Plus+): processing time, multi-staff booking, cancellation policy & no-show fees, daily booking limit, class booking & packages, multi-location management, waitlist, custom emails **& texts** (Free gets emails only), Google Calendar sync, Bookings API
- (Premium): resource management

**Inventory & catalog management**
- (all): auto-create items & SKUs, **auto-polish item image (AI)**, low-stock alerts, Shopify sync via Thrive
- (Plus+): inventory tracking, product bundles, inventory management, barcode label printing, manage unit costs, inventory history, inventory counting tool, vendor & purchase-order management, bulk inventory intake
- (Premium): import purchase orders, transfer orders, print barcode labels from POs
- Add-on: **Square Restaurant Inventory by MarketMan** $99/mo per location (Plus+)

**Reporting & analytics**
- (all): sales insights, reconciliation report, custom work week, daily sales summary email, deferred sales tracking, catalog reporting, invoices reporting, **Square AI (AI-powered insights)**
- (Plus+): aging inventory, COGS, sell-through, projected profit, marketing reports, live section & shift reporting, close-of-day reporting, menu reports, kitchen performance reporting, team sales & activity reporting, labor-cost reporting, site & e-commerce data
- (Premium): future bookings report, service cost tracking, team performance report, vendor sales

**Online selling**
- (all): customer accounts, multiple website management, age-verification pop-up, Wix sync, Order with Google, online ordering profile, pickup & local delivery, shipping-label printing & discounts, fraud controls, restaurant preorders, accept multiple payment types, discounts on in-person & online sales, free-delivery progress bar, item quick view & checkout, time-based categories, website builder with SEO, coupons/pop-ups/lead-capture forms, social-media integration
- (Plus+): password-protected pages, voice ordering, QR-code ordering, retail preorders, free-shipping progress bar, abandoned-cart emails, product reviews, item badges/quantity limits/scheduled updates, bundles & subscriptions, custom domain connect, custom code & native video embed, expanded site customization
- (Premium): real-time shipping rates

**Customer engagement**
- (all): customer directory, automatic customer data collection & segmentation, service messages + reply via SMS/email, do-not-disturb, Google Reviews monitoring, coupons
- (Plus+): dedicated business phone number, message new customers, PDF sharing, call-to-text & voicemail transcription, loyalty rewards program & promotions, email marketing, text-message marketing (500 msgs then 3¢ / Premium 2,500 then 1.5¢), customized receipts, automated campaigns
- Gift cards: physical & eGift on all tiers; **load fee 2.5% (Free & Plus) → 0% (Premium)**

**Invoicing**
- (all): invoices & recurring invoices, deposits, automatic payment reminders, project workspace & dashboard, contracts + templates + e-signature, estimates
- (Plus+): custom invoice templates, batch invoices, payment schedule, invoice customization, custom contract fields, require contract signature, multi-package estimates, auto-convert estimates to invoices

**Staff management** — *all Plus+*
- Timecards with break & overtime, clock in/out with passcodes or badges, shift scheduling/time-off/trades, team chats & file sharing, tip pooling & commissions tracking, new-hire onboarding, unlimited custom permission sets

**Support**
- Chat & email: all tiers
- Phone: Free = 6am–6pm PT M–F (first 90 days) · Plus = 6am–6pm PT M–F · Premium = 24/7

---

## Sources

*Captured directly from Square's live US product pages (July 2026):*
- [Point of Sale (platform)](https://squareup.com/us/en/point-of-sale)
- [Square for Retail](https://squareup.com/us/en/point-of-sale/retail)
- [Square for Restaurants](https://squareup.com/us/en/point-of-sale/restaurants)
- [Square Appointments](https://squareup.com/us/en/appointments)
- [Square Websites / Online](https://squareup.com/us/en/online-store)
- [Square Payment Links](https://squareup.com/us/en/payment-links)
- [Square Invoices](https://squareup.com/us/en/invoices)
- [Square Marketing](https://squareup.com/us/en/marketing)
- [Square Loyalty](https://squareup.com/us/en/software/loyalty)
- [Square Gift Cards](https://squareup.com/us/en/gift-cards)
- [Square Messages](https://squareup.com/us/en/messages)
- [Square Staff](https://squareup.com/us/en/staff)
- [Square Payroll pricing](https://squareup.com/us/en/payroll/pricing)
- [Square Dashboard / Analytics](https://squareup.com/us/en/point-of-sale/features/dashboard)
- [Square for Franchises](https://squareup.com/us/en/franchises)
- [Square Subscriptions](https://squareup.com/us/en/subscriptions)
- [Full plan comparison & pricing matrix](https://squareup.com/us/en/pricing)
- [Unified pricing & packaging (press)](https://squareup.com/us/en/press/unified-pricing-and-packaging)
- [Payment fees](https://squareup.com/us/en/payments/our-fees)
