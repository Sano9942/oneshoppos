# SanoPOS vs Square — Feature Comparison

> **What this is:** a two-way, feature-by-feature comparison of **SanoPOS** against the full Square software catalog (see [square-software-audit.md](square-software-audit.md)).
>
> **Method:** every SanoPOS verdict was **code-verified** — checked against actual routes (`backend/routes/`), services (`backend/services/`), schema, and frontend pages — not taken from CLAUDE.md docs. Verified July 2026.
>
> **Legend:** ✅ Have · 🟡 Partial (exists but narrower than Square, or vertical-specific) · ❌ Missing · ⚪ N/A or out-of-scope for this market.
>
> **Scope match:** compared against the in-scope Square catalog (excludes open source, financial services, Virtual Terminal, Tap to Pay, Cash App/Afterpay, App Marketplace, geography).

---

## 1. Executive summary

**SanoPOS matches or exceeds Square across core commerce, operations, accounting, and vertical depth. It trails Square specifically in consumer-facing website building and marketing-automation polish.**

- **At parity or ahead:** POS + checkout, inventory (deeper than Square — ABC, cycle counts, serials), restaurant, bookings, invoicing/estimates/contracts/projects, subscriptions, loyalty, gift cards, CRM, reporting, staff/payroll, multi-location.
- **SanoPOS goes well beyond Square:** FBR tax compliance, **full double-entry accounting**, wholesale/B2B (credit, field-sales PWA, manufacturer portal, schemes), 13 courier integrations + fulfillment, rentals/rooms/clinical verticals, native reservations, marketplace channels, approval/risk workflows, and the multi-tenant SaaS platform itself.
- **Square is ahead:** a true **website builder** (themes, custom domains, SEO), **marketing automations** (welcome/birthday/win-back/abandoned-cart triggers), **Google Reviews collection**, **Apple Wallet loyalty passes**, **standalone payment links/buy-buttons**, AI catalog tooling (item descriptions/photos), the **Square Go** consumer marketplace, and native mobile apps.

The gaps are mostly **growth/consumer-marketing surface**, not core commerce. SanoPOS's disadvantages are narrower than its advantages.

---

## 2. Core POS & checkout

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| POS app, any payment (in-person/online/phone/field) | ✅ | `sales.js`, `POSRedesign`, field app |
| Offline mode | ✅ | `utils/offlineQueue.js` (IndexedDB queue) |
| Single item library (items/services/packages) | ✅ | `products.js` + variants; services via bookings |
| Custom item grid / per-device layout | ✅ | `pos-layouts.js`, `pos-devices.js` |
| Discounts & refunds | ✅ | `sales.js`, `returns.js`, `POSDiscountModal` |
| Exchanges | 🟡 | Returns fully supported; explicit item-swap exchange flow is thin |
| Age-verification prompts | ❌ | Not found |
| Cross-location returns & fulfillment | 🟡 | Multi-outlet transfers + returns exist; single cross-location return UX not explicit |
| Instant payouts | ⚪ | Tied to Square banking (out of scope); SanoPOS uses payment gateway |

---

## 3. Retail inventory & catalog

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Real-time multi-location stock | ✅ | `outlet_stock`, `variant_outlet_stock` |
| Inventory history | ✅ | adjustments/transfers ledgers |
| Bulk intake / update / import | ✅ | `import.js`, product bulk-import |
| Purchase orders + vendor management | ✅ | `purchase-orders.js`, `suppliers.js`, `grn.js` |
| Barcode label printing | ✅ | `barcode-expenses.js`, `BarcodeTemplatesRedesign` |
| Stocktake / cycle counts | ✅ | `inventory-intelligence.js`, `StockCountRedesign` |
| Cost of goods sold (COGS) | ✅ | `accounting.js` P&L, `cost_price_at_sale` |
| Sell-through / aging stock | ✅ | `stock-aging.js`, ABC (`abc-worker-boss.js`) |
| Transfer orders | ✅ | `inventory.js` (`/api/transfers`) |
| Low-stock alerts | ✅ | `notifyLowStockForSale`, reorder alerts |
| Serialized inventory | ✅ | `product-serials.js` |
| **ABC classification + reorder intelligence** | ✅➕ | Deeper than Square (`inventory-intelligence.js`) |
| AI item descriptions / product photos | ❌ | No AI cataloging (AI is chat-only via `insights-ai.js`) |
| Product bundles | 🟡 | `smart-collections.js`; true bundle SKUs limited |

---

## 4. Restaurant

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Floor plans + table management | ✅ | `restaurant-floor.js`, `RestaurantFloorRedesign` |
| KDS (kitchen display) | ✅ | `kds.js`, `restaurant-kds.js`, KDS analytics |
| Coursing / course timing | ✅ | `course-release-worker-boss.js` |
| Split / reopen checks | ✅ | `SplitCheckModal`, `restaurant-checks.js` |
| Open tabs / house accounts | ✅ | open-check support |
| Modifiers (advanced) | ✅ | `modifiers.js`, `ModifierGroupsRedesign` |
| Auto-86 (availability) | ✅ | `Restaurant86Redesign` |
| Auto-gratuity / tips | ✅ | `tips.js`, `TipPoolsRedesign` |
| Kiosk self-order | ✅ | `restaurant-kiosk.js`, `OrderKiosksRedesign` |
| Online ordering inbox | ✅ | `restaurant-inbox.js`, `online-inbox.js` |
| QR pay-at-table | ✅ | `restaurant/pay-at-table.js`, `RestaurantPayPage` |
| Waitlist | ✅ | `restaurant/waitlist.js` |
| Menu schedules (dayparts) | ✅ | `menu-schedule-resolver.js` |
| **Native reservations** | ✅➕ | `reservation.js` — Square only *integrates* third-party |
| Third-party delivery (DoorDash/Uber Eats) | 🟡 | Has courier + marketplace dispatch, not those specific US apps |
| Drive-Thru / Send & Stay | ❌ | Niche Square-only |
| Preauthorized bar tabs | 🟡 | Tabs exist; card-preauth hold not explicit |

---

## 5. Bookings / appointments

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Calendars + scheduling | ✅ | `bookings.js`, `schedules.js`, `AppointmentsCalendarRedesign` |
| Online booking site | ✅ | `public-bookings.js` |
| Staff availability | ✅ | `booking-availability.js` |
| Resource / room management | ✅ | `rooms.js`, `booking-services.js` |
| Automated reminders | ✅ | `booking-reminders.js` |
| No-show fees / cancellation policy | 🟡 | Deposits exist for rooms/treatments; appointment no-show *fee* flow thin |
| Prepaid packages | 🟡 | Via subscriptions / treatment plans, not a generic package builder |
| Class booking (group sessions) | ❌ | No group-class scheduling |
| Intake forms at booking | 🟡 | Clinical document capture exists; generic intake form limited |
| Square Assistant (AI auto-reply) | ❌ | No AI booking auto-responder |
| Google Calendar sync | ❌ | Not found |

---

## 6. E-commerce / websites

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Online store / ordering | 🟡 | `storefront.js` is a **headless** storefront API + cart handoff — not a full site builder |
| Website builder + themes | ❌ | No theme system |
| Custom domain connect | ❌ | Not found |
| SEO tools | ❌ | Not found |
| Pickup / local delivery / shipping | ✅ | `fulfillment.js`, `couriers.js` |
| Customer accounts | ✅ | Customer portal (`customer-portal/`) |
| Abandoned-cart recovery | ❌ | Not found |
| Product reviews | ✅ | Full pipeline: public submit `products.js:1607` (rate-limited), moderation queue/approve/reject `products.js:1661-1735`, `avg_rating`/`review_count` recalc `products.js:1576`, storefront display `storefront.js:254-328`, admin `ReviewModerationRedesign` |
| **Marketplace channels (Daraz/Meta/WhatsApp/Google/Shopify/Woo)** | ✅➕ | `integrations/`, `marketplace/` — beyond Square |

---

## 7. Payment links, invoicing suite, subscriptions

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Standalone payment links / buy-buttons / QR | 🟡 | Invoice + portal payment links + pay-at-table exist; no generic "link for anything" generator |
| Invoices + recurring | ✅ | `customer-invoices.js`, `subscriptions.js` |
| Deposits | ✅ | invoice + booking deposits |
| Automatic payment reminders | 🟡 | Present in AR flows; automated cadence not fully confirmed |
| Batch invoices | 🟡 | Not clearly present |
| Estimates → invoice conversion | ✅ | `crm.js` quotations (`convert` after `accepted`) |
| Contracts + e-signature | ✅ | `contracts.js` `signContract(...signature_data...)` |
| Project workspace / pipeline | ✅ | `projects.js`, `project-billing.js` |
| Subscriptions (recurring billing) | ✅ | `subscriptions.js` |

---

## 8. Marketing, CRM, loyalty, gift cards, messaging

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Email campaigns | ✅ | `marketing.js`, `email.js` |
| Text / SMS marketing | ✅ | `sms.js`, `messaging.js` |
| **Marketing automations** (welcome/birthday/win-back/abandoned) | ❌ | No lifecycle-trigger automations found |
| Google Reviews collection | ❌ | Not found — no post-sale review-request email/SMS with a Google review link. (Distinct from native **Product reviews**, which SanoPOS has — §6.) This is the real review gap. |
| Coupons / promotions | ✅ | `promotions.js` (incl. wholesale slab schemes) |
| Customer directory / CRM + segmentation | ✅ | `customers.js`, `crm.js` (leads, activities) |
| Loyalty — points (visit/spend/item) | ✅ | `loyalty.js` (earn/redeem/adjust/expire ledger) |
| Loyalty — VIP tiers | ✅ | `LoyaltyTiersRedesign` |
| Loyalty — Apple Wallet pass | ❌ | In-app wallet balance only; no `.pkpass` |
| Gift cards (physical + eGift) | ✅ | `gift-cards.js`, `GiftCardsAdminRedesign` |
| Unified messaging hub (text+email+links) | 🟡 | `messaging.js` customer inbox; less unified than Square Messages |
| Receipt feedback / Square Assistant | ❌ | No receipt-feedback capture or AI assistant |

---

## 9. Staff, payroll, reporting, AI, franchises

| Square feature | SanoPOS | Evidence / notes |
|---|---|---|
| Payroll runs | ✅ | `tier4/hr.js` — periods, generate from attendance/leave/commissions, salary types, OT, CSV export |
| Payroll — automated gov tax filing / direct deposit / benefits | ⚪ | US-specific; SanoPOS is Pakistan-market (FBR instead) |
| Shift scheduling / time off | ✅ | `schedules.js`, `shifts.js` |
| Timecards / attendance | ✅ | `attendance.js` (+ kiosk PIN) |
| Tip pooling / commissions | ✅ | `tips.js`, `commissions.js` |
| Advanced access / custom permission sets | ✅ | `roles.js`, `permissions.js`, outlet visibility |
| Team communication / staff chat | ❌ | Notifications exist; no staff-to-staff chat |
| New-hire onboarding | 🟡 | HR records exist; guided onboarding flow limited |
| Real-time dashboard | ✅ | `DashboardRedesign` + dashboard components |
| Advanced reporting & analytics | ✅➕ | Extensive `reports/` suite (sales, inventory, finance, governance, menu engineering) |
| AI insights | ✅ | `insights.js` (cards) + `insights-ai.js` (Claude chat) |
| Native mobile app | 🟡 | Responsive web + field PWA; no native iOS/Android app |
| Multi-location management | ✅ | `outlets.js`, multi-tenant platform |
| Franchise: corporate permissions | ✅ | roles + advanced access + outlet visibility |
| Franchise: central menu publish | 🟡 | `scheduled-changes.js`, `price-books.js` (partial) |
| Franchise: royalty calculation | ❌ | Not found |

---

## 10. Where SanoPOS EXCEEDS Square (SanoPOS-only)

These have **no Square equivalent** and are genuine differentiators:

- **FBR Digital Invoicing** — real-time Pakistan tax-authority invoice posting, HS codes, retry queue (`fbr.js`, `fbr-worker-boss.js`).
- **Full double-entry accounting** — journal entries, chart of accounts, trial balance, P&L, balance sheet, credit/debit notes, post-dated cheques (`tier4/accounting.js`). Square has none of this.
- **Wholesale / B2B distribution** — customer credit limits + AR aging + statements, **field-sales mobile PWA** (GPS + selfie check-in), **manufacturer-partner portal** (secondary-sales monitoring), **slab/tier promotion schemes**, MOQ + case-pack enforcement, customer-group catalog visibility.
- **13 courier integrations + fulfillment** — Leopards, TCS, BlueEx, Trax, PostEx, etc., plus picklists, loadsheets, and **COD reconciliation** (`couriers/`, `fulfillment.js`).
- **Extra verticals** — rentals (asset check-out/in), rooms/hospitality (folio, deposits, check-in/out), clinical treatment plans + templates, service/workflow tickets.
- **Native reservations** (Square only integrates third-party).
- **Self-service portals** — customer portal + manufacturer portal (separate JWT scopes).
- **Governance** — approval workflows, risk/fraud controls, override reason codes, price books/lists, scheduled changes, smart collections.
- **Multi-tenant SaaS platform** — the whole tenant-provisioning, per-tenant schema, super-admin, billing/subscription-lifecycle machinery Square doesn't expose because it *is* the SaaS, not a builder of them.

---

## 11. Prioritized gap summary (to reach Square parity)

Ranked by impact-to-effort for a Square-competitor positioning:

**High impact**
1. **Website builder** — themes, custom domain, SEO. Biggest structural gap (current storefront is headless). Large effort.
2. **Marketing automations** — welcome / birthday / win-back / abandoned-cart triggers on top of existing `marketing.js`. Medium effort, high retention value.
3. **Standalone payment links / buy-buttons / QR** — generalize existing invoice/portal payment links into a "charge for anything" generator. Low–medium effort.

**Medium impact**
4. **Google Reviews collection** — post-sale review-request automation. Low effort.
5. **Apple/Google Wallet loyalty passes** — `.pkpass` generation on the existing loyalty ledger. Low–medium effort.
6. **Class/group booking + generic intake forms** — extend `bookings.js`. Medium effort.
7. **AI catalog tooling** — item descriptions + product photos (reuse `ANTHROPIC_API_KEY`). Medium effort.

**Lower impact / niche**
8. Exchange (item-swap) flow polish; cross-location return UX.
9. Team-to-staff chat.
10. Square Assistant-style AI booking auto-reply.
11. Franchise royalty calculation (only if targeting franchise brands).
12. Native mobile apps (vs. current responsive web + PWA).

**Deliberately skip** (out of your stated scope / wrong market): Drive-Thru, Send & Stay, US payroll tax filing, Square Go marketplace, instant-payout banking.

---

## Sources & method

- Square side: [docs/research/square-software-audit.md](square-software-audit.md) (live Square pages, July 2026).
- SanoPOS side: code-verified against `backend/routes/`, `backend/services/`, `backend/schema-pg.sql`, and `frontend/src/pages/` (July 2026). Verdicts reflect code presence, not documentation claims.
- Confidence: High on ✅/❌ (route/service existence directly checked). 🟡 marks where a capability exists but is narrower or vertical-specific than Square's — worth a deeper per-feature code read before committing roadmap decisions.
