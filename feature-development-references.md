# Feature Development References

**Date**: 2026-04-09 | **Last reorganized**: 2026-04-09
**Purpose**: Single lookup file for building SanoPOS features. Every gap from `competitive-analysis-2.md` is mapped to vendor documentation, open-source references, and architecture notes.
**Companion doc**: `competitive-analysis-2.md` (gap analysis + priority ranking)

---

## How to Use This File

1. **Know your feature ID?** → Jump to the phase section (Phase 1–5) and find the feature header (e.g., `SQ-1`, `SP-7`)
2. **Want a quick overview?** → See the Master Cross-Reference Table below
3. **Building something from the open-source audit?** → See Section 8 (OS-1 through OS-169)
4. **Need a repo URL or API hub link?** → See Section 9 (Reference Library)
5. **Checking license before copying code?** → See Section 9.4 (License Guidance)

Each feature section bundles: vendor docs (Shopify/Square URLs), best open-source references, and architecture notes — everything in one place.

---

## Master Cross-Reference Table

One row per feature. Use this to quickly see what resources exist before diving into the detailed section.

### Phase 1 — Omnichannel Foundation

| ID | Feature | Best Vendor Docs | Best Open-Source | Section |
|---|---|---|---|---|
| SQ-1 / SQ-2 | Online storefront / ordering page | Shopify Hydrogen, Square eCommerce API | Medusa, Saleor Storefront | [Phase 1](#sq-1--sq-2-online-storefront--ordering-page) |
| BOPIS | Buy online, pick up in store | Shopify Local Pickup API, FulfillmentOrder | Medusa (fulfillment module) | [Phase 1](#bopis--buy-online-pick-up-in-store) |
| SP-1 | Ship from store | Shopify FulfillmentService, FulfillmentOrder | Medusa (fulfillment module) | [Phase 1](#sp-1-ship-from-store) |
| SP-2 | Endless aisle | Shopify Draft Order API (POS), Multi-Location | Medusa, Saleor | [Phase 1](#sp-2-endless-aisle) |
| SP-4 | In-store return of online orders | Shopify Returns Processing API | Medusa (returns), Saleor | [Phase 1](#sp-4-in-store-return-of-online-orders) |
| SP-5 | Unified cross-channel customer history | Shopify Customer API, Square Customers API | — (custom aggregation) | [Phase 1](#sp-5-unified-cross-channel-customer-history) |
| SP-6 | Omnichannel promotions | Shopify Discount Functions | Vendure (promotions engine) | [Phase 1](#sp-6-omnichannel-promotions) |
| SQ-3 | Curbside pickup | Extension of BOPIS | — | [Phase 1](#sq-3-curbside-pickup) |
| SQ-4 | Local delivery management | Square local delivery product | — (custom build) | [Phase 1](#sq-4-local-delivery-management) |

### Phase 2 — Operational Depth

| ID | Feature | Best Vendor Docs | Best Open-Source | Section |
|---|---|---|---|---|
| SQ-16 | Shift scheduling UI | Square Labor API | Cal.com, SirChri/employee-shift-scheduler | [Phase 2](#sq-16-shift-scheduling-ui) |
| SQ-25a | Time-off request management | Square Labor API | Cal.com | [Phase 2](#sq-25a-time-off-request-management) |
| SP-7 | Location-specific pricing | Shopify PriceList, Markets | Saleor (channels), Medusa (price lists) | [Phase 2](#sp-7-location-specific-pricing) |
| SP-10 | Synced draft orders | Shopify DraftOrder API | Medusa (draft orders), Saleor | [Phase 2](#sp-10-synced-draft-orders) |
| SP-14 | Manager approval workflow | Shopify Manager Approvals | — (custom build) | [Phase 2](#sp-14-manager-approval-workflow) |
| SP-11 | Auto-apply promotions | Shopify Discount Functions | Vendure (promotions engine) | [Phase 2](#sp-11-auto-apply-promotions) |
| SP-12 | Return rules / policies | Shopify Returns Processing API | Medusa (returns), Saleor | [Phase 2](#sp-12-return-rules--policies) |
| SP-20 | Smart collections | Shopify SmartCollection API | Saleor (collections) | [Phase 2](#sp-20-smart-collections) |
| SQ-58 / SP-18 | Custom report builder | Shopify Polaris-Viz | Metabase, Lightdash, react-grid-layout | [Phase 2](#sq-58--sp-18-custom-report-builder) |
| SP-8 | Location-specific product visibility | Shopify Catalogs for Markets | Saleor (channels) | [Phase 2](#sp-8-location-specific-product-visibility) |
| SP-9 | Location-specific tax rules | Shopify Markets | — | [Phase 2](#sp-9-location-specific-tax-rules) |
| SP-16 | Staff performance attribution | — | — (custom build) | [Phase 2](#sp-16-staff-performance-attribution) |
| SQ-17 | Geofenced clock-in | — | — (Browser Geolocation API) | [Phase 2](#sq-17-geofenced-clock-in) |
| SQ-20 | Commission tracking | Square Team API (wages only) | — (custom build) | [Phase 2](#sq-20-commission-tracking) |
| SQ-22 | Labor vs. sales dashboard | — | — (custom build) | [Phase 2](#sq-22-labor-vs-sales-dashboard) |
| SP-23 | Smart Grid / POS tile layout | Shopify POS UI Extensions | — (custom build) | [Phase 2](#sp-23-smart-grid--customizable-pos-tile-layout) |
| SP-24 | Sale item suggestions at checkout | — | — (custom build) | [Phase 2](#sp-24-sale-item-suggestions-at-checkout) |
| SQ-61a | Scheduled price/product updates | — | — (custom build) | [Phase 2](#sq-61a-scheduled-priceproduct-updates) |

### Phase 3 — Marketing & Engagement

| ID | Feature | Best Vendor Docs | Best Open-Source | Section |
|---|---|---|---|---|
| SQ-7 | Recurring billing / subscriptions | Square Subscriptions API | Medusa (subscriptions), Kill Bill | [Phase 3](#sq-7-recurring-billing--subscriptions) |
| SQ-8 | Batch invoicing | Square Invoices API | Invoice Ninja | [Phase 3](#sq-8-batch-invoicing) |
| SQ-9 | Payment links | Square Checkout API | Medusa (payment links) | [Phase 3](#sq-9-payment-links) |
| SQ-26 | Email marketing campaigns | — (no vendor API) | Listmonk | [Phase 3](#sq-26-email-marketing-campaigns) |
| SQ-27 | SMS marketing campaigns | — | — (Twilio / local providers) | [Phase 3](#sq-27-sms-marketing-campaigns) |
| SQ-28 | 2-way customer messaging | — | Chatwoot | [Phase 3](#sq-28-2-way-customer-messaging) |
| SQ-56b | Automatic payment reminders | Square Invoices API | Invoice Ninja | [Phase 3](#sq-56b-automatic-payment-reminders) |
| SQ-56a | Invoice deposits | Square Invoices API | Invoice Ninja | [Phase 3](#sq-56a-invoice-deposits) |

### Phase 4 — New Verticals

| ID | Feature | Best Vendor Docs | Best Open-Source | Section |
|---|---|---|---|---|
| SQ-31–40 | Restaurant mode | Square product pages (UX only) | URY, OpenKDS, FoodStreams | [Phase 4](#sq-3140-restaurant-mode) |
| SQ-41–50 | Appointment booking | Square Bookings API | Cal.com | [Phase 4](#sq-4150-appointment-booking) |
| SQ-51–56 | Service business tools | Square Invoices + Subscriptions | Invoice Ninja, Kill Bill | [Phase 4](#sq-5156-service-business-tools) |

### Phase 5 — Pakistan-Specific & Integrations

| ID | Feature | Best Vendor Docs | Best Open-Source | Section |
|---|---|---|---|---|
| SP-22 | Shipping label generation | Shopify CarrierService, active_shipping | — | [Phase 5](#sp-22-shipping-label-generation) |
| CA-19–23 | Payment gateways | Square Web Payments SDK | — | [Phase 5](#ca-1923-payment-gateways) |
| CA-1–30 | Remaining integrations | — | — (API key dependent) | [Phase 5](#remaining-integrations) |

### Features with No External Documentation (Build from Scratch)

| ID | Feature | What's Available |
|---|---|---|
| SQ-31 | Table management / floor plan | Square product page UX only |
| SQ-35 | KDS (Kitchen Display System) | Square product page + setup guide UX only |
| SQ-32 | Course management / hold & fire | No documentation |
| SQ-20 | Commission tracking | Square Team API has wages, not commissions |
| SQ-17 | Geofenced clock-in | Use Browser Geolocation API + validate against outlet coordinates |
| SQ-16 (sub) | Shift swap workflows | Application-level logic on scheduling primitives |
| SQ-34 | Check splitting logic | Both platforms support multiple payments per order but no split UI/logic |
| SQ-33 | Bar tab state management | Use open order pattern — keep order open, add items, finalize on close |
| SQ-54 | Contracts with e-signatures | No reference from either platform |
| CA-43 | Visual loyalty rule builder | No reference — consider xyflow/xyflow for node-builder UI |
| SQ-23 | Team chat / messaging | No reference from either platform |

---

## Phase 1 — Omnichannel Foundation

### SQ-1 / SQ-2: Online Storefront / Ordering Page

**What to build**: Customer-facing online store with product browse, cart, checkout, domain.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Hydrogen (GitHub) | https://github.com/Shopify/hydrogen | Full React storefront with product browse, cart, checkout — study architecture |
| Hydrogen Demo Store | https://github.com/Shopify/hydrogen-demo-store | Working template with collections, search, account pages |
| Shopify JS Buy SDK | https://github.com/Shopify/js-buy-sdk | Lightweight JS SDK for embedding storefront into any website |
| Hydrogen React Components | https://github.com/Shopify/hydrogen/tree/main/packages/hydrogen-react | Reusable React cart/product/checkout components and hooks |
| Square eCommerce API Guide | https://developer.squareup.com/docs/ecommerce-api | Customer-facing ordering page pattern using Orders + Checkout API |
| Square Online API | https://developer.squareup.com/docs/online-api | Sites + Snippets customization for hosted ordering pages |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) (32.6k★) | Headless commerce engine — product catalog, cart, checkout, fulfillment. TypeScript + Node + Postgres (closest to our stack) |
| [saleor/storefront](https://github.com/saleor/storefront) (1.4k★) | React storefront built on Saleor — product browse, cart, checkout, customer accounts |
| [medusajs/nextjs-starter-medusa](https://github.com/medusajs/nextjs-starter-medusa) (2.7k★) | Working storefront template — clone and study immediately |

---

### BOPIS — Buy Online, Pick Up In Store

**What to build**: Online order → store pickup workflow with customer notification.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Local Pickup API | https://shopify.dev/docs/api/functions/unstable/local-pickup-delivery-option-generator | Data model for pickup locations, availability per product per location |
| Storefront API Local Pickup | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/local-pickup | Display pickup availability on product pages |
| Build Local Pickup Function | https://shopify.dev/docs/apps/build/orders-fulfillment/order-routing-apps/build-local-pickup-options-function | Custom pickup option generator (checkout flow) |
| Generate Pickup Points | https://shopify.dev/docs/apps/build/checkout/delivery-shipping/delivery-methods/generate-pickup-points | Third-party pickup location model (post offices, lockers) |
| Shopify Local Pickup Changelog | https://shopify.dev/changelog/introducing-the-local-pickup-api | LocalPickupSettingsV2 field for managing pickup settings per location |
| Shopify FulfillmentOrder (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder | Core object for order routing — which location fulfills which items |
| Prepared for Pickup Mutation | https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentOrderLineItemsPreparedForPickup | Triggers "Ready for Pickup" customer notification |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Fulfillment module — multi-location fulfillment, order routing |

#### Architecture Note

Shopify's BOPIS, ship-from-store, and endless aisle are ALL built on the same core: `FulfillmentOrder` API + order routing + multi-location inventory. One shared inventory pool with per-location quantities — no separate sync mechanism.

---

### SP-1: Ship from Store

**What to build**: Fulfill online orders from store inventory with shipping labels + packing slips from POS.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify FulfillmentService API | https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillmentservice | Model store as fulfillment center |
| Fulfillment Order Sample App | https://github.com/Shopify/fulfillment-order-sample-app | Working code for accepting/rejecting fulfillment requests |
| Shopify Fulfillment Integration | https://github.com/Shopify/shopify-fulfillment-integration | Example service that receives orders, processes, reports back |
| Fulfillment (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillment | Fulfillment lifecycle, tracking, status updates |
| Fulfillment Orders Blog | https://www.shopify.com/partners/blog/shopify-fulfillment-orders-api | Architecture overview of fulfillment order system |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Fulfillment module with multi-location routing |

---

### SP-2: Endless Aisle

**What to build**: Buy in store, ship from another location. Sell product not in stock at current store.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Endless Aisles Guide | https://www.shopify.com/retail/endless-aisles-for-retail | Concept: in-store shopper orders out-of-stock item, shipped from another location |
| Shopify Draft Order API (POS context) | https://shopify.dev/docs/api/pos-ui-extensions/latest/apis/draft-order-api | Create orders from POS for items not in current store |
| Multi-Location Inventory | https://help.shopify.com/en/manual/products/inventory/setup/multi-managed-inventory | Cross-location inventory visibility |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Cross-location inventory + draft orders |
| [saleor/saleor](https://github.com/saleor/saleor) | Channels + warehouses for cross-location order logic |

---

### SP-4: In-Store Return of Online Orders

**What to build**: Return web purchases at any physical store. Unified order lookup across channels.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Build for Return Management | https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management | Return management app architecture |
| Returns Processing API (2025-07) | https://shopify.dev/changelog/returns-processing-api | `returnProcess` mutation — disposition + financial processing |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Returns module with return policies, eligibility checks |

---

### SP-5: Unified Cross-Channel Customer History

**What to build**: Single view merging POS + Shopify + Daraz + WooCommerce orders per customer.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Customer API | https://shopify.dev/docs/api/admin-rest/latest/resources/customer | Customer object with order history |
| Square Customers API | https://developer.squareup.com/docs/customers-api/what-it-does | Customer profiles + purchase history |

#### Architecture Note

Both platforms have unified customer records because they own the entire stack. For SanoPOS, aggregate from `sales` + `web_orders` + marketplace order tables per customer. No external reference needed — this is a custom aggregation layer.

---

### SP-6: Omnichannel Promotions

**What to build**: Same discount works across online + in-store.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Discount Function API | https://shopify.dev/docs/api/functions/latest/discount | Custom discount logic architecture |

#### Open-Source References

| Project | Why |
|---|---|
| [vendurehq/vendure](https://github.com/vendurehq/vendure) | Promotions engine with condition + action pattern, channel-scoped |

---

### SQ-3: Curbside Pickup

**What to build**: Customer notifies arrival, staff brings order out. Extension of BOPIS.

No dedicated vendor docs — this is a workflow layer on top of BOPIS (customer status updates + staff notification). Build using the BOPIS infrastructure above.

---

### SQ-4: Local Delivery Management

**What to build**: Zone config by radius/zip, own drivers, delivery windows, fees, minimums.

No dedicated vendor API. SanoPOS has courier dispatch but not own-fleet local delivery with zone config. Build from scratch — study Square's product page for UX patterns only.

---

## Phase 2 — Operational Depth

### SQ-16: Shift Scheduling UI

**What to build**: Visual calendar, shift swaps, open shifts, availability tracking, push notifications.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Labor API: Scheduling | https://developer.squareup.com/docs/labor-api/scheduling | **Complete data model** — draft vs published shifts, job assignments, location binding |
| Manage Scheduled Shifts | https://developer.squareup.com/docs/labor-api/manage-scheduled-shifts | Create/update/publish shifts, bulk publish |
| Retrieve Scheduled Shifts | https://developer.squareup.com/docs/labor-api/retrieve-scheduled-shifts | Search by team member, location, date range, status |
| Labor API Overview | https://developer.squareup.com/docs/labor-api/what-it-does | Full scope: time tracking + scheduling + wages |
| Labor API Reference | https://developer.squareup.com/reference/square/labor-api | Every endpoint, field, and enum |

#### Open-Source References

| Project | Why |
|---|---|
| [calcom/cal.com](https://github.com/calcom/cal.com) (41k★) | Availability engine, calendar UI, time slot management |
| [SirChri/employee-shift-scheduler](https://github.com/SirChri/employee-shift-scheduler) (71★) | React + Java + PostgreSQL shift scheduler — schema design |
| [oasido/shift-scheduler](https://github.com/oasido/shift-scheduler) (33★) | JavaScript shift scheduling with absence requests |
| [fullcalendar/fullcalendar](https://github.com/fullcalendar/fullcalendar) (20.4k★) | Calendar UI component |

#### Architecture Note

Square's model has draft→published states. Managers prepare schedules privately, then publish to make visible to staff. Shifts have job IDs + location IDs + team member assignment + start/end times. Bulk publish supported.

**Not exposed by Square**: Visual calendar UI, shift swap logic — build these yourself.

---

### SQ-25a: Time-Off Request Management

**What to build**: Employees submit time-off requests, manager approve/deny.

Sub-feature of scheduling (SQ-16) but independently actionable. Study Cal.com's availability blocking patterns and Square Labor API for the data model.

---

### SP-7: Location-Specific Pricing

**What to build**: Different prices per store while keeping accounting centralized.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify PriceList (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/pricelist | Fixed prices or percentage adjustments per variant per market |
| Shopify Markets | https://shopify.dev/docs/apps/build/markets | Markets → Catalogs → PriceLists system |
| Catalogs for Different Markets | https://shopify.dev/docs/apps/build/markets/catalogs-different-markets | Market-scoped catalogs with price list associations |
| International Pricing on Storefronts | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/markets/international-pricing | `@inContext(country:)` GraphQL directive for location-aware pricing |

#### Open-Source References

| Project | Why |
|---|---|
| [saleor/saleor](https://github.com/saleor/saleor) | Channels with per-channel pricing |
| [medusajs/medusa](https://github.com/medusajs/medusa) | Price lists with named override sets |

#### Architecture Note

Shopify: Markets → Catalogs → PriceLists. Each PriceList has fixed prices or percentage adjustments per variant, scoped to a market/catalog.

---

### SP-10: Synced Draft Orders

**What to build**: Park a sale on one POS terminal, retrieve on another. Server-side parked sales.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify DraftOrder (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/draftorder | Server-side cart model — line items, customer binding, tax calc, discounts |
| Shopify DraftOrder (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder | Modern API (REST is legacy as of Oct 2024) |
| POS Draft Order API | https://shopify.dev/docs/api/pos-ui-extensions/latest/apis/draft-order-api | Read-only draft order context from POS |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Draft orders with server-side cart persistence |
| [saleor/saleor](https://github.com/saleor/saleor) | Draft order lifecycle |

#### Architecture Note

Shopify POS Pro saves carts as draft orders, completable from any device/location. This is exactly what SanoPOS needs to replace localStorage-based parked sales.

---

### SP-14: Manager Approval Workflow

**What to build**: Require manager override for specific actions (discounts, returns, voids).

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Manager Approvals Changelog | https://changelog.shopify.com/posts/set-up-manager-approvals-for-more-control-over-new-pos-permissions | 3-tier model: Allowed / Denied / **Approval Required** |
| POS Roles Documentation | https://help.shopify.com/en/manual/sell-in-person/shopify-pos/staff-management/pos-roles | Actions that support approval gates: discounts, ship-to-customer, edit taxes, custom sales, refunds |

#### Architecture Note

"Approval Required" means another staff member (manager) must enter their PIN to authorize the action. This is a built-in POS feature, not exposed as a third-party API — but the UX pattern is well-documented.

---

### SP-11: Auto-Apply Promotions

**What to build**: BOGO/spend-threshold automatically applied without manual quote.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Discount Function API | https://shopify.dev/docs/api/functions/latest/discount | Custom discount logic architecture (edge-executed) |
| discountAutomaticBasicCreate | https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountAutomaticBasicCreate | Amount-off auto-applied at cart and checkout |
| discountAutomaticAppCreate | https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountAutomaticAppCreate | App-managed automatic discounts with custom logic |
| Function Examples (GitHub) | https://github.com/Shopify/function-examples | Working discount function implementations (Rust + JS) |
| Discount App Components | https://github.com/Shopify/discount-app-components | React component library for discount builder UIs |
| Discounts Reference App | https://github.com/Shopify/discounts-reference-app | Collection of discount sample apps |
| Volume Discount Tutorial | https://github.com/Shopify/tutorial-discount-functions-with-remix | Step-by-step volume discount with Shopify Functions |

#### Open-Source References

| Project | Why |
|---|---|
| [vendurehq/vendure](https://github.com/vendurehq/vendure) | Promotions engine with condition + action pattern, stackable rules |

#### Architecture Note

Shopify allows only one automatic discount per customer at a time. Vendure's model is more flexible — study both.

---

### SP-12: Return Rules / Policies

**What to build**: Configurable rules — when returns accepted, time window, fee policy, receipt required.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Build for Return Management | https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management | Return management app architecture |
| Returns Processing API (2025-07) | https://shopify.dev/changelog/returns-processing-api | `returnProcess` mutation — combines disposition + financial processing. Exposes return eligibility incorporating merchant return rules. |
| Returns in Customer Accounts API | https://shopify.dev/changelog/returns-now-supported-in-customer-accounts-api | Customer-facing return requests |
| Refund (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/refund | Restock types, refund line items |
| Refund (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/Refund | Modern refund processing |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Returns module — return policies, eligibility checks, refund processing |

---

### SP-20: Smart Collections

**What to build**: Rule-based auto-sort by type, tag, price range, season.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Collection (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/Collection | Rule engine: column + relation + condition. 5,000 smart collections per store. REST SmartCollection API deprecated Oct 2024. |
| Collection (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/Collection | Modern collection API |
| Category Descendants Rule | https://shopify.dev/changelog/introducing-productcategoryidwithdescendants-in-collectionrulecolumn-for-smart-collections | Hierarchical category matching (relevant to SanoPOS category tree) |

#### Open-Source References

| Project | Why |
|---|---|
| [saleor/saleor](https://github.com/saleor/saleor) | Rule-based product grouping with faceted search |

#### Architecture Note

Rules use column (type, vendor, tag, price, weight, inventory stock, category) + relation (equals, contains, greater_than, less_than) + condition value. Supports hierarchical category matching via `PRODUCT_CATEGORY_ID_WITH_DESCENDANTS`.

---

### SQ-58 / SP-18: Custom Report Builder

**What to build**: User-defined filters, columns, saved views. Drag-and-drop report creation.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify Polaris-Viz (GitHub) | https://github.com/Shopify/polaris-viz | Data visualization components (charts, graphs) in React + React Native |
| Shopify Polaris (GitHub) | https://github.com/Shopify/polaris | Design system — data table, filter, and layout components |

#### Open-Source References

| Project | Why |
|---|---|
| [metabase/metabase](https://github.com/metabase/metabase) (46.8k★) | Saved reports, dashboards, embedded analytics, report-builder UX |
| [lightdash/lightdash](https://github.com/lightdash/lightdash) (5.7k★) | Self-serve BI, dashboard UX, metrics model ideas |
| [react-grid-layout/react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) (22.2k★) | Drag-and-drop report layouts and dashboard tiles |

---

### SP-8: Location-Specific Product Visibility

**What to build**: Hide/show products per outlet.

Study Shopify's Catalogs for Different Markets and Saleor's channels system for per-channel product availability. No dedicated vendor API beyond what's listed under SP-7.

---

### SP-9: Location-Specific Tax Rules

**What to build**: Tax rate overrides per location.

Study Shopify Markets for market-scoped tax configuration. Custom build on SanoPOS — extend existing tax_rates with outlet_id scoping.

---

### SP-16: Staff Performance Attribution

**What to build**: Discounts applied, returns processed, avg order value per employee.

No external reference. Data exists in SanoPOS (sales by employee) — needs richer aggregation report endpoint + UI.

---

### SQ-17: Geofenced Clock-In

**What to build**: Validate clock-in by physical location.

No external reference. Use Browser Geolocation API at clock-in time, validate against outlet GPS coordinates stored in `outlets` table.

---

### SQ-20: Commission Tracking

**What to build**: Sales commission calculations linked to payroll.

Square Team API has wages but not commissions. Sales attribution exists in SanoPOS — needs commission rules + payroll integration. Custom build.

---

### SQ-22: Labor vs. Sales Dashboard

**What to build**: Side-by-side labor cost vs revenue dashboard.

No external reference. Data exists (shifts + sales) — needs a combined report endpoint + UI.

---

### SP-23: Smart Grid / Customizable POS Tile Layout

**What to build**: Drag-and-drop product tiles, category nav, discount dropdown on POS screen.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify POS UI Extensions | https://shopify.dev/docs/api/pos-ui-extensions/latest | POS extension architecture, Smart Grid tiles |
| POS Smart Grid Tutorials | https://github.com/Shopify/pos-ui-extensions-tutorials | Smart grid tile implementation |

#### Architecture Note

Shopify's `pos.home.tile.render` target. Tiles are dynamic (change based on cart/device state). System controls grid layout. 64KB bundle limit. Offline support since POS 11.0.

---

### SP-24: Sale Item Suggestions at Checkout

**What to build**: Cross-sell/upsell suggestions at checkout based on cart contents.

No external reference. "Frequently bought together" or "suggested add-ons" during checkout. Build using co-purchase analysis from `sale_items` data.

---

### SQ-61a: Scheduled Price/Product Updates

**What to build**: Time-based price changes, scheduled product availability windows.

No external reference. Set future price or visibility date — cron job or pg-boss worker auto-activates on schedule.

---

## Phase 3 — Marketing, Engagement & Financial Tools

### SQ-7: Recurring Billing / Subscriptions

**What to build**: Card-on-file or ACH auto-charge for memberships, subscription boxes.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Subscriptions Overview | https://developer.squareup.com/docs/subscriptions-api/overview | Full subscription lifecycle — create, pause, resume, cancel, change plan |
| Create Plans Walkthrough | https://developer.squareup.com/docs/subscriptions-api/walkthrough | Plan creation via Catalog API, then enrollment |
| Subscription Billing & Invoices | https://developer.squareup.com/docs/subscriptions-api/subscription-billing | Auto-charge card on file or email invoice with payment link |
| Plans & Variations | https://developer.squareup.com/docs/subscriptions-api/plans-and-variations | Phases (free trial → paid), cadences, pricing |
| Subscription Plan Checkout | https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout | Convert plan into hosted checkout page |
| Sample App: node_subscription | https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_subscription | Working Node.js Express app |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Subscription module — plan lifecycle, billing cycles |
| [killbill/killbill](https://github.com/killbill/killbill) (5.4k★) | Subscription billing concepts and lifecycle design |

#### Architecture Note

Square: Plan = CatalogObject of type SUBSCRIPTION_PLAN. Each plan has variations with phases (trial, recurring). Subscription links customer + plan. Square handles invoicing, payment collection, and lifecycle events via webhooks.

---

### SQ-8: Batch Invoicing

**What to build**: Send same invoice to multiple customers, billing groups.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Invoices API | https://developer.squareup.com/docs/invoices-api/overview | Invoice lifecycle — create, schedule, publish, collect |
| Create & Publish Invoices | https://developer.squareup.com/docs/invoices-api/create-publish-invoices | Each invoice linked to an Order. Public payment URL auto-generated. |
| Pay/Refund Invoices | https://developer.squareup.com/docs/invoices-api/pay-refund-invoices | Payment tracking, refund processing |
| Sample App: node_invoices | https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_invoices | Working Node.js Express app |

#### Open-Source References

| Project | Why |
|---|---|
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja) (9.6k★) | Invoice lifecycle, batch operations, reminders |

#### Architecture Note

No batch endpoint in Square — loop CreateInvoice calls. Each invoice needs an Order created first.

---

### SQ-9: Payment Links

**What to build**: Share via SMS/email/social for remote payment.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Checkout API | https://developer.squareup.com/docs/checkout-api | Hosted checkout — quick pay (ad-hoc item + price) or full order checkout |
| CreatePaymentLink Reference | https://developer.squareup.com/reference/square/checkout-api/create-payment-link | Supports tipping, custom fields, shipping |
| Manage Checkout | https://developer.squareup.com/docs/checkout-api/manage-checkout | Retrieve, list, update, delete payment links |

#### Open-Source References

| Project | Why |
|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | Payment links module |

---

### SQ-26: Email Marketing Campaigns

**What to build**: Automated campaigns — welcome, birthday, win-back, post-purchase.

#### Vendor Documentation

Square has no public email marketing API. Square Marketing is closed.

#### Open-Source References

| Project | Why |
|---|---|
| [knadh/listmonk](https://github.com/knadh/listmonk) (19.5k★) | **Best reference** — campaign builder, templates, subscriber segmentation, scheduling, analytics, bounce handling |

#### Architecture Note

SanoPOS already has Resend infrastructure — build campaign builder + templates + scheduling on top of existing email service. Study Listmonk for UX patterns (AGPL — study only, don't copy code).

---

### SQ-27: SMS Marketing Campaigns

**What to build**: SMS campaigns to customer segments.

No relevant docs from either platform. Both use third-party providers. Evaluate Twilio or local providers (Monty Mobile, BizSMS, TelloTalk).

---

### SQ-28: 2-Way Customer Messaging

**What to build**: Unified inbox, suggested replies, conversation history.

#### Open-Source References

| Project | Why |
|---|---|
| [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) (28.3k★) | **Best reference** — unified inbox, conversation history, customer messaging, automation. MIT license. |

#### Architecture Note

WhatsApp integration exists in SanoPOS but not a unified inbox. Chatwoot is the strongest open-source reference for this pattern.

---

### SQ-56b: Automatic Payment Reminders

**What to build**: Auto-email/SMS for overdue invoices on schedule.

Email infrastructure exists (Resend). Needs reminder scheduler + templates. Study Square Invoices API for reminder scheduling patterns and Invoice Ninja for implementation.

---

### SQ-56a: Invoice Deposits

**What to build**: Collect partial upfront payment on estimate/invoice before full service delivery.

Study Square Invoices API for partial payment patterns. Invoice Ninja has deposit/upfront payment workflows.

---

## Phase 4 — New Verticals

### SQ-31–40: Restaurant Mode

**What to build**: Table management, course management, bar tabs, check splitting, KDS, kiosk, QR ordering, quick-service mode, kitchen reports, ingredient tracking.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Table Management (product page) | https://squareup.com/us/en/point-of-sale/restaurants/features/table-management-system | UX description — visual floor plan, color-coded time, server assignment |
| Square KDS (product page) | https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system | UX description — ticket routing, timers, alerts, station grouping |
| Square KDS Setup Guide | https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android | How KDS connects to POS, routing rules |
| Square Orders API | https://developer.squareup.com/docs/orders-api/what-it-does | Order object has `table` field on fulfillments — only API exposure for restaurant |

#### Open-Source References

| Project | Why |
|---|---|
| [ury-erp/ury](https://github.com/ury-erp/ury) (251★) | Restaurant management — table management, KOT, floor plan, order routing |
| [ury-erp/mosaic](https://github.com/ury-erp/mosaic) (42★) | Kitchen Display System — order display, KOT printing, station routing |
| [BenClementt/OpenKDS](https://github.com/BenClementt/OpenKDS) (10★) | KDS station routing, timers |
| [calvincchong/FoodStreams](https://github.com/calvincchong/FoodStreams) (13★) | Real-time order display patterns |
| [BryanTheLai/RestaurantProject](https://github.com/BryanTheLai/RestaurantProject) (216★) | Restaurant POS with table management, orders, menu |
| [abelborit/kitchen-display-system](https://github.com/abelborit/kitchen-display-system) (2★) | TypeScript KDS ticket lifecycle patterns |

#### Architecture Note

**Critical**: Table management, KDS, course management, and kitchen reports have **NO public API from either platform**. These must be built entirely from scratch. Study Square's product pages for UX patterns only. Restaurant OSS is much weaker than ecommerce and scheduling — these repos are useful for concepts and UI patterns, not as direct foundations.

---

### SQ-41–50: Appointment Booking

**What to build**: Online booking website, multi-staff calendars, waitlists, classes, cancellation policies, resource scheduling, reminders, Google Calendar sync.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Bookings API | https://developer.squareup.com/docs/bookings-api/what-it-is | Full booking system — availability search, create/update/cancel, service/staff/location binding |
| Bookings API Concepts | https://developer.squareup.com/docs/bookings-api/get-ready-to-use-the-api | Services as CatalogObjects, team member assignments, SearchAvailability for open slots |
| Sample App: node_bookings | https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_bookings | **Complete Express app with routes and views** — the best starting reference |
| Bookings API Blog Post | https://developer.squareup.com/blog/introducing-bookings-api-beta/ | Architecture overview and design decisions |

#### Open-Source References

| Project | Why |
|---|---|
| [calcom/cal.com](https://github.com/calcom/cal.com) (41k★) | **Best-in-class** — availability engine, booking lifecycle, multi-staff calendars, resource allocation, waitlists, reminders, Google Calendar sync, cancellation policies. AGPL — study architecture, don't copy code. |
| [open-reception/appointment-booking-software](https://github.com/open-reception/appointment-booking-software) (141★) | TypeScript booking system architecture |

#### Architecture Note

Square: Services = CatalogObjects. Team members have service assignments. `SearchAvailability` returns open slots. `CreateBooking` reserves a slot. Custom attributes on bookings + webhooks for booking events.

---

### SQ-51–56: Service Business Tools

**What to build**: Estimates with approval, recurring invoices, milestone payments, contracts with e-signatures, project workspace.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Invoices API | https://developer.squareup.com/docs/invoices-api/overview | Estimates → invoices → payment lifecycle |
| Square Subscriptions API | https://developer.squareup.com/docs/subscriptions-api/overview | Recurring invoices pattern |

#### Open-Source References

| Project | Why |
|---|---|
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja) (9.6k★) | Estimates, recurring invoices, reminders, deposits, service-business workflows |

#### Architecture Note

Contracts with e-signatures and milestone-based payments have no API reference from either platform. Build from scratch.

---

## Phase 5 — Pakistan-Specific & Integration Depth

### SP-22: Shipping Label Generation

**What to build**: Compare carrier rates, print shipping labels.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Shopify active_shipping (GitHub) | https://github.com/Shopify/active_shipping | Ruby library abstracting carrier APIs — rate calc, tracking, label generation |
| Shopify CarrierService API | https://shopify.dev/docs/api/admin-rest/latest/resources/carrierservice | Custom carrier rate calculation at checkout |
| Shipping Labels Guide | https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/shipping-labels | How Shopify generates labels from fulfillment data |

---

### CA-19–23: Payment Gateways

**What to build**: Stripe, JazzCash, Easypaisa, bank gateways.

#### Vendor Documentation

| Source | URL | What You Learn |
|---|---|---|
| Square Web Payments SDK | https://developer.squareup.com/docs/web-payments/overview | Payment form patterns (card, ACH, wallets) |
| Web Payments Quickstart (GitHub) | https://github.com/square/web-payments-quickstart | Frontend payment form examples |

---

### Remaining Integrations

CA-1 through CA-30 (couriers, marketplaces, ERP, marketing tools) are **API-key dependent** — no architecture research needed. When credentials are acquired, implement using each provider's official API docs. See `competitive-analysis-2.md` for the full list.

---

## Open-Source Audit Gaps (OS-1 through OS-169)

**Source**: Audited 5 major open-source platforms (NexoPOS, Medusa, OpenSourcePOS, ERPNext, Vendure + Saleor) for features NOT covered in `competitive-analysis-2.md`. These represent blind spots in our Square/Shopify-focused competitive analysis — features that real-world POS/commerce systems implement but that neither Square nor Shopify prominently documents.

**Scope**: Global market relevance, not Pakistan-specific.

These features are not yet assigned to phases. When you decide to build one, add it to the appropriate phase section above with references.

---

### Category 1: POS Checkout & Cart Operations

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-1 | **Unit groups & unit conversion** | NexoPOS | Sell same SKU in different units (piece, dozen, carton) with conversion factors and per-unit pricing. | **HIGH** |
| OS-2 | **Scale barcode support (weighable products)** | NexoPOS | Parse EAN-13 scale barcodes (prefix "2x") to extract embedded product code and weight/price. | **HIGH** |
| OS-3 | **Wholesale price toggle on POS** | NexoPOS | Dedicated wholesale price tier switchable per transaction. | **HIGH** |
| OS-4 | **Quick product creation from POS** | NexoPOS | Create new product on-the-fly from POS screen without leaving checkout. | **MEDIUM** |
| OS-5 | **Editable unit price at POS** | NexoPOS | Allow/prevent cashiers from overriding unit price per line item. | **MEDIUM** |
| OS-6 | **Decimal quantity support** | NexoPOS | Toggle for fractional quantities (0.5 kg). | **MEDIUM** |
| OS-7 | **Merge similar cart items** | NexoPOS | Auto-merge duplicate product entries (increment qty). Configurable. | **SMALL** |
| OS-8 | **Pinned/favorite products on POS grid** | NexoPOS | Pin products to top of POS grid for quick access. | **MEDIUM** |
| OS-9 | **Category & product display reordering** | NexoPOS | Custom display order for categories and products on POS grid. | **SMALL** |
| OS-10 | **Hide exhausted products/empty categories** | NexoPOS | Auto-hide out-of-stock products and empty categories from POS. | **SMALL** |
| OS-11 | **Multiple POS layout modes** | NexoPOS | Switchable layouts: "Retail" (grid) vs. "Clothing" (list/detail). | **MEDIUM** |
| OS-12 | **POS audio feedback** | NexoPOS | Configurable sounds for sale completion and item added. | **SMALL** |
| OS-13 | **Gross vs. net price display** | NexoPOS | Toggle tax-inclusive or tax-exclusive prices per product. | **MEDIUM** |
| OS-14 | **Force barcode auto-focus** | NexoPOS | Permanently keep focus on barcode input for scanner-heavy workflows. | **SMALL** |
| OS-15 | **Order type system (delivery/takeaway/dine-in)** | NexoPOS | Classify orders by type with different workflows per type. | **MEDIUM** |
| OS-16 | **Delivery status tracking on orders** | NexoPOS | Separate `delivery_status` independent of payment and process status. | **MEDIUM** |
| OS-17 | **Note visibility control** | NexoPOS | Order notes: staff-only vs. customer-visible toggle. | **SMALL** |
| OS-18 | **Default/walking customer** | NexoPOS | Configurable default customer for anonymous walk-in sales. | **SMALL** |
| OS-19 | **Configurable order code generation** | NexoPOS | Sequential, random, or number-sequential invoice/receipt numbering. | **SMALL** |
| OS-20 | **Order address management (billing + shipping)** | NexoPOS | Separate billing and shipping addresses per order. | **MEDIUM** |
| OS-21 | **Shipping cost on orders** | NexoPOS | Track shipping amounts added to POS/order totals. | **MEDIUM** |
| OS-22 | **Surcharges on orders** | Vendure | Arbitrary extra line items (handling fee, rush processing). | **MEDIUM** |
| OS-23 | **Temporary/one-time items** | OpenSourcePOS | Add items to a sale that don't exist in inventory. | **MEDIUM** |

### Category 2: Payments & Credit

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-24 | **Order instalments / layaway** | NexoPOS | Payment schedule with future partial payments and due dates. | **HIGH** |
| OS-25 | **Unpaid / partially paid order workflows** | NexoPOS | Allow orders without full payment. Persist with "due" status. | **HIGH** |
| OS-26 | **Customer credit limits** | ERPNext | Configurable credit limit per customer. Auto-block when exceeded. | **HIGH** |
| OS-27 | **Customer credit & account system** | NexoPOS | Customer account balance (advance deposits or store credit). Can run negative. | **HIGH** |
| OS-28 | **Saved payment methods / tokenization** | Medusa, Saleor | Save customer payment methods for faster repeat checkout. | **MEDIUM** |
| OS-29 | **Cash rounding** | OpenSourcePOS | Round cash totals to nearest increment for jurisdictions without small denominations. | **MEDIUM** |
| OS-30 | **POS write-off limit** | ERPNext | Auto-write-off small payment shortfalls below threshold. | **SMALL** |

### Category 3: Inventory & Stock Management

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-31 | **Inventory reservations** | Medusa, Saleor, ERPNext | Soft-allocate stock on order placement. Prevents overselling. | **HIGH** |
| OS-32 | **Serial number tracking** | ERPNext | Individual serial number lifecycle per unit — warranty, customer, warehouse. | **HIGH** |
| OS-33 | **Batch tracking with expiry + FIFO/LIFO** | ERPNext | Batch numbers with expiry dates, auto-zero-pricing for expired. Configurable picking rules. | **HIGH** |
| OS-34 | **Product expiration tracking** | NexoPOS | Expiration date per product with `on_expiration` policy. | **MEDIUM** |
| OS-35 | **Incoming inventory quantity tracking** | Medusa | Track `incoming_quantity` per item per location for stock on its way. | **MEDIUM** |
| OS-36 | **Landed cost voucher** | ERPNext | Allocate freight, customs, insurance across purchase items. Adjusts COGS. | **HIGH** |
| OS-37 | **Item alternatives / substitutes** | ERPNext | Define interchangeable items. Suggest when out of stock. | **MEDIUM** |
| OS-38 | **Putaway rules** | ERPNext | Warehouse capacity rules with priority-based auto-assignment. | **MEDIUM** |
| OS-39 | **Stock freeze / frozen period** | ERPNext | Lock stock transactions before a date. Role-based override. | **MEDIUM** |
| OS-40 | **Negative stock control with override** | ERPNext | Global allow/disallow negative stock with role override. | **SMALL** |
| OS-41 | **Over-delivery/receipt allowance** | ERPNext | Configurable percentage tolerance for receiving more/less than ordered. | **SMALL** |
| OS-42 | **Warehouse hierarchy (nested set)** | ERPNext | Parent-child warehouse tree. Group vs. leaf, in-transit types. | **MEDIUM** |
| OS-43 | **Multiple valuation methods** | ERPNext | FIFO, Moving Average, or LIFO per item or globally. Perpetual inventory. | **HIGH** |
| OS-44 | **Average cost calculation on receiving** | OpenSourcePOS | Weighted average cost recalculation when receiving new stock. | **MEDIUM** |
| OS-45 | **Stock reservation for checkout sessions** | Saleor | Temporary stock hold during active checkout sessions. | **MEDIUM** |
| OS-46 | **Packing slips** | ERPNext | Track how items are packed — case numbers, gross/net weight. | **MEDIUM** |
| OS-47 | **Quality inspection on receipt/delivery** | ERPNext | Mandatory or optional quality checks on incoming/outgoing goods. | **MEDIUM** |
| OS-48 | **Custom inventory dimensions** | ERPNext | Additional tracking dimensions beyond warehouse (shelf, rack, project). | **SMALL** |
| OS-49 | **Sample retention warehouse** | ERPNext | Designated warehouse for product samples. | **SMALL** |
| OS-50 | **Material request (internal requisition)** | ERPNext | Formal internal request for materials — types: Purchase, Transfer, Issue. | **MEDIUM** |

### Category 4: Purchasing & Supplier Management

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-51 | **Request for Quotation (RFQ)** | ERPNext | Send RFQ to multiple suppliers, compare quotes, convert to PO. | **HIGH** |
| OS-52 | **Supplier scorecard** | ERPNext | Automated performance scoring (delivery, quality, pricing). | **MEDIUM** |
| OS-53 | **Blanket orders** | ERPNext | Framework purchase/sales agreements for fixed quantity/amount over period. | **MEDIUM** |
| OS-54 | **Supplier categories** | OpenSourcePOS | Category-based supplier organization. | **SMALL** |

### Category 5: Accounting & Finance

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-55 | **Bank reconciliation tool** | ERPNext | Match bank statement transactions against system payments. Auto-matching. | **HIGH** |
| OS-56 | **Budget management** | ERPNext | Set budgets per cost center/project. Stop/Warn/Ignore when exceeded. | **HIGH** |
| OS-57 | **Dunning (overdue payment notices)** | ERPNext | Automated late-payment letters with escalating fees, interest calculation. | **MEDIUM** |
| OS-58 | **Tax withholding (TDS/WHT)** | ERPNext | Auto-calculate withholding tax on supplier payments. | **HIGH** |
| OS-59 | **Deferred revenue/expense accounting** | ERPNext | Spread recognition over multiple periods based on service dates. | **MEDIUM** |
| OS-60 | **Cash register (drawer) management** | NexoPOS, ERPNext | Named registers with opening float, cash-in/out log, closing count, variance. | **HIGH** |
| OS-61 | **POS invoice consolidation** | ERPNext | Merge individual POS invoices into consolidated sales invoices. | **MEDIUM** |
| OS-62 | **Financial year start date** | OpenSourcePOS | Configurable fiscal year start (Jul 1, Apr 1, Oct 1, etc.). | **MEDIUM** |
| OS-63 | **Accounting period locking** | ERPNext | Lock closed periods. Role-based exemptions. | **MEDIUM** |
| OS-64 | **Period closing voucher** | ERPNext | Transfer P&L balances to retained earnings at period end. | **MEDIUM** |
| OS-65 | **Exchange rate revaluation** | ERPNext | Revalue foreign-currency receivables/payables at period-end rates. | **MEDIUM** |
| OS-66 | **Cost center allocation** | ERPNext | Split costs from one center to multiple child centers by percentage. | **SMALL** |
| OS-67 | **Transaction action rules (auto journal entries)** | NexoPOS | Rules that auto-create offsetting journal entries on business events. | **HIGH** |
| OS-68 | **Cheque print templates** | ERPNext | Pixel-precise cheque printing with configurable field positions. | **MEDIUM** |
| OS-69 | **Invoice discounting / factoring** | ERPNext | Sell unpaid invoices to bank at discount for immediate cash. | **SMALL** |
| OS-70 | **Payment reconciliation tool** | ERPNext | Match unallocated payments against outstanding invoices. | **HIGH** |
| OS-71 | **Process Statement of Accounts** | ERPNext | Auto-generate and email customer account statements. | **MEDIUM** |
| OS-72 | **Finance books (parallel depreciation)** | ERPNext | Parallel depreciation schedules (tax vs. IFRS). | **SMALL** |
| OS-73 | **Ledger merge tool** | ERPNext | Merge multiple ledger accounts into one. | **SMALL** |
| OS-74 | **Recurring/scheduled transactions** | NexoPOS | Automatic recurring expenses/income with patterns. | **MEDIUM** |

### Category 6: Orders & Fulfillment

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-75 | **Order claims (warranty/defect workflow)** | Medusa | Separate from returns — defective/incorrect item. Claim for replacement/refund. | **HIGH** |
| OS-76 | **Order edits after placement** | Medusa, Saleor | Modify confirmed order line items before fulfillment. Versioned changes. | **HIGH** |
| OS-77 | **Preorder support** | Saleor | Sell products before in stock. Preorder end dates and quantity thresholds. | **MEDIUM** |
| OS-78 | **Delivery trip planning** | ERPNext | Route planning with driver assignment, multiple stops, distance calc. | **MEDIUM** |
| OS-79 | **Configurable order state machine** | Vendure | Customizable order workflow states and transitions. | **MEDIUM** |
| OS-80 | **Configurable payment state machine** | Vendure | Customizable payment workflow states. | **SMALL** |
| OS-81 | **Work orders (service/repair jobs)** | OpenSourcePOS | Sale type for service/repair with own numbering. | **MEDIUM** |
| OS-82 | **Shipping profiles** | Medusa | Group products sharing same shipping rules. | **MEDIUM** |
| OS-83 | **Fulfillment sets (rule-based routing)** | Medusa | Link stock locations to shipping options, service zones. | **MEDIUM** |
| OS-84 | **Shipping zones with weight/price-based rates** | Saleor | Configurable shipping methods per zone with thresholds. | **MEDIUM** |
| OS-85 | **Warehouse allocation strategies** | Saleor | Configurable stock allocation per channel — sorting order vs. highest-stock. | **MEDIUM** |
| OS-86 | **Click-and-collect per warehouse** | Saleor | Per-warehouse toggle for click-and-collect. | **SMALL** |

### Category 7: Pricing & Promotions

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-87 | **Price lists (named override sets)** | Medusa | Named groups of override prices under conditions (VIP, date range, channel). | **HIGH** |
| OS-88 | **Tiered promotional schemes (slabs)** | ERPNext | Buy 1-5 get 10%, 6-10 get 15%, 11+ get 20%. | **HIGH** |
| OS-89 | **Pricing rules with auto-add free items** | ERPNext | Rules that auto-add free items to cart with recursive application. | **MEDIUM** |
| OS-90 | **Coupon system with targeting rules** | NexoPOS | Coupons with validity windows, min/max cart value, usage limits. | **MEDIUM** |
| OS-91 | **Voucher codes (single-use/reusable)** | Saleor | Voucher codes with usage limits, min spend, per-product targeting. | **MEDIUM** |
| OS-92 | **Catalog-level vs. order-level promotions** | Saleor | Promotions that change catalog price vs. apply at checkout. | **MEDIUM** |
| OS-93 | **Campaign management for promotions** | Medusa | Group promotions under campaign with shared dates and budget caps. | **MEDIUM** |
| OS-94 | **Reward system with coupon generation** | NexoPOS | Spending thresholds generate coupons. Tied to customer groups. | **SMALL** |
| OS-95 | **Party-specific item restrictions** | ERPNext | Whitelist/blacklist items per customer or supplier. | **SMALL** |
| OS-96 | **Price preferences (tax-inclusive toggle)** | Medusa | Per-region config: tax-inclusive or tax-exclusive pricing. | **MEDIUM** |
| OS-97 | **Incoterms on transactions** | ERPNext | International Commercial Terms on sales/purchase documents. | **SMALL** |

### Category 8: Tax & Compliance

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-98 | **Tax jurisdictions & compound tax** | OpenSourcePOS | Multi-jurisdiction tax — city + state + federal stacking. | **HIGH** |
| OS-99 | **Destination-based tax** | OpenSourcePOS | Calculate tax based on customer's address, not store location. | **HIGH** |
| OS-100 | **Customer tax categories** | OpenSourcePOS | Tax-exempt, reseller, government customer types. | **MEDIUM** |
| OS-101 | **Tax zones with zone-based rates** | Vendure | Tax rates per geographic zone with tax categories on products. | **MEDIUM** |
| OS-102 | **Synchronous tax calculation webhooks** | Saleor | External tax service integration (Avalara/TaxJar). | **MEDIUM** |
| OS-103 | **GDPR compliance / privacy enforcement** | OpenSourcePOS | Toggle to restrict PII in reports and receipts. | **MEDIUM** |
| OS-104 | **Configurable invoice types** | OpenSourcePOS | Standard, tax, custom invoice formats with own numbering. | **SMALL** |

### Category 9: Product Catalog & Content

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-105 | **Grouped/composite products (BOM)** | NexoPOS, ERPNext | Products referencing sub-products with quantities. Selling deducts component stock. | **HIGH** |
| OS-106 | **Product types (Physical/Digital/Service)** | Medusa | Classification influencing tax, fulfillment, and business logic. | **MEDIUM** |
| OS-107 | **Digital products** | Medusa | Sell non-physical goods. Auto-email download links. | **MEDIUM** |
| OS-108 | **Personalized products** | Medusa | Customer customization per order (upload image, engraving text). | **MEDIUM** |
| OS-109 | **Product gallery with ordering & featured image** | NexoPOS | Multiple gallery images with display order and featured flag. | **MEDIUM** |
| OS-110 | **Media manager** | NexoPOS | Built-in file/image management with thumbnails, browsable library. | **MEDIUM** |
| OS-111 | **Dynamic thumbnail generation** | Saleor | On-the-fly image resizing/format conversion with presets. | **SMALL** |
| OS-112 | **Faceted search / faceted filtering** | Vendure | Structured facets for drill-down product filtering. | **HIGH** |
| OS-113 | **Search engine integration (Algolia/MeiliSearch)** | Medusa | Full-text search — typo-tolerant, faceted, indexed. | **MEDIUM** |
| OS-114 | **Product collections (merchandising)** | Medusa | Curated product groups ("Summer Sale", "New Arrivals"). | **MEDIUM** |
| OS-115 | **Product option groups** | Vendure | Structured option groups that generate variant combinations. | **SMALL** |
| OS-116 | **Collection-based organization with filter rules** | Vendure | Already tracked as SP-20. | — |

### Category 10: Sales Channels & Commerce Architecture

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-117 | **Sales channels (B2B, B2C, wholesale)** | Medusa, Saleor | Per-channel pricing, currency, stock visibility, tax config. | **HIGH** |
| OS-118 | **Regions (geographic commerce zones)** | Medusa | Region entities grouping countries, assigning currency, linking providers. | **HIGH** |
| OS-119 | **Multi-vendor marketplace** | Medusa | Multiple independent vendors sell within same platform. | **MEDIUM** |
| OS-120 | **Seller entity per channel** | Vendure | First-class Seller entity enabling marketplace. | **MEDIUM** |
| OS-121 | **CMS pages with page types** | Saleor | Content management pages with custom types, rich text, SEO fields. | **MEDIUM** |
| OS-122 | **Navigation menu management** | Saleor | Hierarchical menu builder for storefront. | **MEDIUM** |
| OS-123 | **SEO metadata on all content** | Saleor | seo_title and seo_description on products, categories, collections, pages. | **MEDIUM** |
| OS-124 | **CMS integration pattern** | Medusa | Integration with headless CMS for rich content. | **SMALL** |

### Category 11: Refunds, Returns & Reasons

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-125 | **Refund reasons (managed list)** | Medusa | Standardized refund reasons for consistent reporting. | **MEDIUM** |
| OS-126 | **Return reasons (managed list)** | Medusa | Managed catalog of return reasons. | **MEDIUM** |
| OS-127 | **Store credit accounts** | Medusa | Dedicated store credit balances per customer. | **MEDIUM** |
| OS-128 | **Granted refunds with line-level tracking** | Saleor | Partial refunds at order-line granularity with reason. | **MEDIUM** |
| OS-129 | **Order modification entity with audit trail** | Saleor | Formal modification record for post-order edits. | **MEDIUM** |

### Category 12: Platform Infrastructure & Extensibility

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-130 | **Webhook event system (100+ events)** | Saleor | Granular async + sync webhook events for every domain action. | **HIGH** |
| OS-131 | **Custom fields/metadata on all entities** | Saleor, Vendure | Arbitrary key-value data on orders, products, customers without schema changes. | **HIGH** |
| OS-132 | **Plugin/module system** | NexoPOS, Vendure | Full extension architecture — routes, menus, migrations, hook events. | **HIGH** |
| OS-133 | **Admin UI extension SDK** | Vendure | Pluggable admin dashboard with custom UI extensions. | **MEDIUM** |
| OS-134 | **App/plugin marketplace architecture** | Saleor | Installable third-party apps with OAuth tokens. | **MEDIUM** |
| OS-135 | **Publishable & secret API keys** | Medusa | Two key types: publishable (client-side) and secret (server-side). | **MEDIUM** |
| OS-136 | **API key management entity** | Vendure | First-class API key for machine-to-machine auth. | **SMALL** |
| OS-137 | **Async CSV/XLSX export with email notification** | Saleor | Background export jobs with status tracking and email-when-done. | **MEDIUM** |
| OS-138 | **Notification module (multi-channel)** | Medusa | Pluggable notification system abstracting email/SMS/push. | **MEDIUM** |
| OS-139 | **Analytics module (PostHog integration)** | Medusa | Commerce event tracking sent to analytics providers. | **MEDIUM** |
| OS-140 | **Synchronous webhooks for shipping rates** | Saleor | External shipping rate providers via sync webhooks. | **SMALL** |
| OS-141 | **External reference IDs** | Saleor | `external_reference` field for syncing with external ERP. | **SMALL** |
| OS-142 | **Distributed locking module** | Medusa | Postgres/Redis resource locking for race conditions. | **SMALL** |
| OS-143 | **Workflow engine with compensating transactions** | Medusa | Saga engine — each step has rollback function. | **SMALL** |
| OS-144 | **Query complexity analysis (API hardening)** | Vendure | GraphQL query scoring to prevent abusive queries. | **SMALL** |
| OS-145 | **Separate admin/shop API permissions** | Vendure | Different permission models for admin vs. storefront API. | **SMALL** |

### Category 13: UI/UX & Configuration

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-146 | **Customizable dashboard widgets** | NexoPOS | Widget system — choose which data cards to display per user. | **MEDIUM** |
| OS-147 | **Multi-language / i18n** | Saleor, OpenSourcePOS, Medusa | Translatable product names, descriptions, UI. 40+ languages. | **HIGH** |
| OS-148 | **Selectable UI themes** | OpenSourcePOS | Theme gallery (not just dark/light). | **SMALL** |
| OS-149 | **Configurable receipt content toggles** | OpenSourcePOS | Fine-grained show/hide for receipt elements. | **SMALL** |
| OS-150 | **Receipt default behavior persistence** | OpenSourcePOS | Default email/print checkboxes: always/never/remember last. | **SMALL** |
| OS-151 | **Auto-return delay after print** | OpenSourcePOS | Configurable delay before POS returns to register. | **SMALL** |
| OS-152 | **Office/back-office menu separation** | OpenSourcePOS | Toggle splitting POS view from admin view. | **MEDIUM** |
| OS-153 | **Configurable barcode label dimensions** | OpenSourcePOS | Barcode type, width/height, font family/size customization. | **MEDIUM** |

### Category 14: System Maintenance & Data

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-154 | **System "Doctor" / data integrity repair** | NexoPOS | Diagnostic tool fixing inconsistencies. | **MEDIUM** |
| OS-155 | **Soft reset / data wipe** | NexoPOS | Wipe transactional data while keeping config. Go-live after testing. | **MEDIUM** |
| OS-156 | **Sale soft delete & restore** | OpenSourcePOS | Soft-delete sales, recoverable by admin. | **MEDIUM** |
| OS-157 | **Quotation expiration auto-cleanup** | NexoPOS | Auto-expire and delete quotations after configurable days. | **SMALL** |
| OS-158 | **Stock reposting / valuation correction** | ERPNext | Background job recalculating historical stock valuations. | **SMALL** |
| OS-159 | **Account confirmation / email verification** | Saleor | Explicit confirmation request, email change, account deletion flows. | **SMALL** |
| OS-160 | **Google reCAPTCHA on login** | OpenSourcePOS | Optional CAPTCHA for brute-force protection. | **SMALL** |

### Category 15: Manufacturing (Retail-Adjacent)

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-161 | **Bill of Materials (multi-level BOM)** | ERPNext | Recursive tree: finished good → components → sub-components. | **MEDIUM** |
| OS-162 | **Production planning** | ERPNext | Generate production plans from sales orders. Auto-create work orders. | **SMALL** |
| OS-163 | **Work orders / job cards** | ERPNext | Track production runs with operation-level time logging. | **SMALL** |
| OS-164 | **Subcontracting** | ERPNext | Send raw materials to external vendors for processing. | **SMALL** |

### Category 16: Asset Management

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-165 | **Fixed asset register with depreciation** | ERPNext | Full lifecycle: purchase, depreciation, transfers, disposal. | **MEDIUM** |
| OS-166 | **Asset capitalization** | ERPNext | Convert stock items into fixed assets. | **SMALL** |

### Category 17: Sales Attribution & Partners

| # | Feature | Source | Description | Impact |
|---|---|---|---|---|
| OS-167 | **Sales partner / channel tracking** | ERPNext | Track sales through partners with UTM parameters. | **MEDIUM** |
| OS-168 | **Staff notification recipients** | Saleor | Configurable list of staff who receive system notifications. | **SMALL** |
| OS-169 | **Customer notes (staff-only)** | Saleor | Already exists in SanoPOS (CRM notes). | — |

---

### Open-Source Audit Summary

| Category | Count | HIGH | MEDIUM | SMALL |
|---|---|---|---|---|
| POS Checkout & Cart | 23 | 3 | 10 | 10 |
| Payments & Credit | 7 | 4 | 2 | 1 |
| Inventory & Stock | 20 | 6 | 10 | 4 |
| Purchasing & Suppliers | 4 | 1 | 2 | 1 |
| Accounting & Finance | 20 | 6 | 9 | 5 |
| Orders & Fulfillment | 12 | 3 | 7 | 2 |
| Pricing & Promotions | 11 | 3 | 5 | 3 |
| Tax & Compliance | 7 | 3 | 3 | 1 |
| Product Catalog & Content | 12 | 2 | 7 | 3 |
| Sales Channels & Architecture | 8 | 2 | 4 | 2 |
| Refunds/Returns/Reasons | 5 | 0 | 5 | 0 |
| Platform Infrastructure | 16 | 3 | 6 | 7 |
| UI/UX & Configuration | 8 | 1 | 3 | 4 |
| System Maintenance | 7 | 0 | 3 | 4 |
| Manufacturing | 4 | 0 | 1 | 3 |
| Asset Management | 2 | 0 | 1 | 1 |
| Sales Attribution | 3 | 0 | 1 | 2 |
| **TOTAL** | **~169** | **~37** | **~79** | **~53** |

### Top 20 Most Impactful Newly Discovered Features

| Rank | Feature | Why |
|---|---|---|
| 1 | **Inventory reservations** (OS-31) | Prevents overselling in omnichannel — prerequisite for online+POS selling same stock |
| 2 | **Unit groups & conversion** (OS-1) | Wholesale/retail businesses globally need piece/dozen/carton selling |
| 3 | **Order instalments / layaway** (OS-24) | Payment plans are standard in retail globally |
| 4 | **Bank reconciliation** (OS-55) | Biggest accounting time-sink — auto-matching saves hours weekly |
| 5 | **Sales channels** (OS-117) | B2B, B2C, wholesale as separate channels — fundamental architecture |
| 6 | **Cash register management** (OS-60) | Multiple named registers per location — basic POS ops |
| 7 | **Serial number tracking** (OS-32) | Electronics, appliances, high-value goods per-unit tracking |
| 8 | **Batch tracking with expiry** (OS-33) | Food, pharma, cosmetics — FIFO picking for perishables |
| 9 | **Landed cost voucher** (OS-36) | Import businesses need freight/customs allocation for accurate COGS |
| 10 | **Price lists** (OS-87) | Named price overrides (VIP, seasonal, channel) — B2B essential |
| 11 | **Tiered promotional schemes** (OS-88) | Volume discount slabs — wholesale standard |
| 12 | **Order edits after placement** (OS-76) | Modify confirmed orders before fulfillment — B2B standard |
| 13 | **Order claims (warranty/defect)** (OS-75) | Warranty workflow distinct from returns |
| 14 | **Customer credit limits** (OS-26) | Auto-block sales exceeding credit — fundamental B2B control |
| 15 | **RFQ to suppliers** (OS-51) | Compare supplier quotes side-by-side — standard procurement |
| 16 | **Webhook event system** (OS-130) | 100+ events for third-party integration — platform foundation |
| 17 | **Custom fields/metadata** (OS-131) | Extensibility without migrations |
| 18 | **Multi-language / i18n** (OS-147) | Global market requirement |
| 19 | **Tax jurisdictions & compound tax** (OS-98) | US, Canada, India need city+state+federal stacking |
| 20 | **Budget management** (OS-56) | Financial control per cost center/project |

### Audit Sources

| Platform | GitHub | Stars | Key Contribution |
|---|---|---|---|
| NexoPOS | [Blair2004/NexoPOS](https://github.com/Blair2004/NexoPOS) | 1,174 | POS operations depth (units, scale, register, layaway, wholesale) |
| Medusa | [medusajs/medusa](https://github.com/medusajs/medusa) | 32,600 | Commerce architecture (channels, reservations, claims, price lists) |
| OpenSourcePOS | [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) | 4,114 | Tax compliance, receipt config, cost calculation, i18n |
| ERPNext | [frappe/erpnext](https://github.com/frappe/erpnext) | 32,761 | Enterprise depth (serial/batch, landed cost, BOM, budgets, bank recon) |
| Vendure | [vendurehq/vendure](https://github.com/vendurehq/vendure) | 8,029 | Extension architecture (custom fields, state machines, faceted search) |
| Saleor | [saleor/saleor](https://github.com/saleor/saleor) | 22,777 | Headless commerce (channels, webhooks, vouchers, preorders, i18n) |

---

## Reference Library

### 9.1 Open-Source Projects by Tier

#### Tier 1 — High-Value (10k+ stars, active, directly relevant)

| Project | Stars | Stack | What to Study |
|---|---|---|---|
| [medusajs/medusa](https://github.com/medusajs/medusa) | 32,600 | TypeScript, Node.js, Postgres | Headless commerce — catalog, cart, checkout, fulfillment, returns, promotions, subscriptions |
| [calcom/cal.com](https://github.com/calcom/cal.com) | 41,000 | TypeScript, Next.js, Prisma, Postgres | Scheduling — availability, booking lifecycle, multi-staff calendars, reminders |
| [saleor/saleor](https://github.com/saleor/saleor) | 22,800 | Python, GraphQL, Postgres | Channels, warehouses, fulfillment, vouchers, draft orders, gift cards, returns |
| [saleor/storefront](https://github.com/saleor/storefront) | 1,400 | TypeScript, Next.js, Tailwind | React storefront — product browse, cart, checkout, customer accounts |
| [knadh/listmonk](https://github.com/knadh/listmonk) | 19,500 | Go, Postgres | Email marketing — campaigns, segmentation, templates, scheduling, analytics |
| [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | 28,300 | Ruby on Rails, Postgres | Unified inbox, conversation history, customer messaging, automation |
| [metabase/metabase](https://github.com/metabase/metabase) | 46,800 | Clojure, TypeScript | Saved reports, dashboards, embedded analytics, report-builder UX |

#### Tier 2 — Solid Reference (1k–10k stars)

| Project | Stars | Stack | What to Study |
|---|---|---|---|
| [vendurehq/vendure](https://github.com/vendurehq/vendure) | 8,000 | TypeScript, NestJS, GraphQL | Plugin architecture, promotions engine, faceted search, collections |
| [medusajs/nextjs-starter-medusa](https://github.com/medusajs/nextjs-starter-medusa) | 2,700 | TypeScript, Next.js | Working storefront template |
| [opensourcepos/opensourcepos](https://github.com/opensourcepos/opensourcepos) | 4,100 | PHP, MySQL | Full POS — sales, inventory, reports, gift cards, returns |
| [lightdash/lightdash](https://github.com/lightdash/lightdash) | 5,700 | TypeScript | Self-serve BI, dashboard UX |
| [invoiceninja/invoiceninja](https://github.com/invoiceninja/invoiceninja) | 9,600 | PHP, TypeScript | Estimates, recurring invoices, deposits, service-business workflows |
| [killbill/killbill](https://github.com/killbill/killbill) | 5,400 | Java | Subscription billing concepts and lifecycle |

#### Tier 3 — Focused Components

| Project | Stars | What to Study |
|---|---|---|
| [ury-erp/ury](https://github.com/ury-erp/ury) | 251 | Restaurant management — table management, KOT, floor plan |
| [ury-erp/mosaic](https://github.com/ury-erp/mosaic) | 42 | KDS — order display, station routing |
| [fullcalendar/fullcalendar](https://github.com/fullcalendar/fullcalendar) | 20,400 | Calendar UI component |
| [react-grid-layout/react-grid-layout](https://github.com/react-grid-layout/react-grid-layout) | 22,200 | Drag-and-drop layouts |
| [xyflow/xyflow](https://github.com/xyflow/xyflow) | 36,000 | Visual workflow/node builder |
| [qzind/tray](https://github.com/qzind/tray) | — | Browser printing, Zebra/ZPL integration |
| [oasido/shift-scheduler](https://github.com/oasido/shift-scheduler) | 33 | JavaScript shift scheduling |
| [SirChri/employee-shift-scheduler](https://github.com/SirChri/employee-shift-scheduler) | 71 | React + Postgres shift scheduler |
| [BryanTheLai/RestaurantProject](https://github.com/BryanTheLai/RestaurantProject) | 216 | Restaurant POS UI patterns |
| [open-reception/appointment-booking-software](https://github.com/open-reception/appointment-booking-software) | 141 | Booking system architecture |
| [BenClementt/OpenKDS](https://github.com/BenClementt/OpenKDS) | 10 | KDS station routing |
| [calvincchong/FoodStreams](https://github.com/calvincchong/FoodStreams) | 13 | Real-time kitchen display |
| [akbarwjyy/poslify](https://github.com/akbarwjyy/poslify) | 11 | Multi-tenant POS API (similar stack) |

---

### 9.2 Vendor GitHub Repos

#### Shopify

| Repo | Stars | What It Is |
|---|---|---|
| [Shopify/hydrogen](https://github.com/Shopify/hydrogen) | 1,900+ | React headless storefront framework |
| [Shopify/hydrogen-demo-store](https://github.com/Shopify/hydrogen-demo-store) | 223 | Full working demo store |
| [Shopify/fulfillment-order-sample-app](https://github.com/Shopify/fulfillment-order-sample-app) | 20 | FulfillmentOrder API flow |
| [Shopify/function-examples](https://github.com/Shopify/function-examples) | 239 | Discount functions (Rust + JS) |
| [Shopify/ui-extensions](https://github.com/Shopify/ui-extensions) | 328 | POS UI extension APIs |
| [Shopify/discount-app-components](https://github.com/Shopify/discount-app-components) | — | React discount builder UI |
| [Shopify/polaris](https://github.com/Shopify/polaris) | 5,900+ | Design system — components, tokens |
| [Shopify/polaris-viz](https://github.com/Shopify/polaris-viz) | 368 | Data visualization (charts) |
| [Shopify/shopify-app-bridge](https://github.com/Shopify/shopify-app-bridge) | 103 | App Bridge JS SDK |
| [Shopify/pos-ui-extensions-tutorials](https://github.com/Shopify/pos-ui-extensions-tutorials) | 2 | POS smart grid tile tutorials |
| [Shopify/active_fulfillment](https://github.com/Shopify/active_fulfillment) | 155 | Fulfillment service integration |
| [Shopify/active_shipping](https://github.com/Shopify/active_shipping) | — | Carrier API abstraction |
| [Shopify/shopify-function-javascript](https://github.com/Shopify/shopify-function-javascript) | 33 | JS SDK for Shopify Functions |
| [Shopify/function-runner](https://github.com/Shopify/function-runner) | 80 | Local dev runner for Functions |
| [Shopify/shopify-app-template-remix](https://github.com/Shopify/shopify-app-template-remix) | 546 | Official Remix app template |
| [Shopify/shopify-app-template-node](https://github.com/Shopify/shopify-app-template-node) | 1,005 | Node.js app template |
| [Shopify/shopify.github.com](https://github.com/Shopify/shopify.github.com) | 531 | Index of ALL Shopify OSS |

#### Square

| Repo | Stars | What It Is |
|---|---|---|
| [square/connect-api-examples](https://github.com/square/connect-api-examples) | 407 | Node.js sample apps (bookings, subscriptions, invoices) |
| [square/connect-api-specification](https://github.com/square/connect-api-specification) | 76 | Full OpenAPI spec |
| [square/square-nodejs-sdk](https://github.com/square/square-nodejs-sdk) | 108 | TypeScript client for ALL Square APIs |
| [square/square-mcp-server](https://github.com/square/square-mcp-server) | 95 | MCP server for AI assistants |
| [square/web-payments-quickstart](https://github.com/square/web-payments-quickstart) | 102 | Frontend payment form examples |
| [square/catalog-api-demo](https://github.com/square/catalog-api-demo) | 7 | Product catalog CRUD patterns |

#### Shopify Partner Gists

| Gist | What It Shows |
|---|---|
| [Adding POS cart items](https://gist.github.com/shopifypartners/fc716189f28349d9fb4cfe27aeb3fb0d) | App Bridge cart manipulation |
| [Managing POS line items](https://gist.github.com/shopifypartners/c67eec5d406a33f1c3dac26b63df3acc) | Line item CRUD from POS extension |
| [Setting POS toast notices](https://gist.github.com/shopifypartners/275f6fc039359ee2ea8cb45db27fcb0c) | Toast notification patterns |

---

### 9.3 Vendor API Reference Hubs

#### Shopify

| API | URL |
|---|---|
| All Shopify APIs | https://shopify.dev/docs/api |
| POS UI Extensions (latest) | https://shopify.dev/docs/api/pos-ui-extensions/latest |
| Admin REST API | https://shopify.dev/docs/api/admin-rest/latest |
| Admin GraphQL API | https://shopify.dev/docs/api/admin-graphql/latest |
| Storefront API | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api |
| Building for POS | https://shopify.dev/docs/apps/build/pos |
| Changelog | https://shopify.dev/changelog |

#### Square

| API | URL |
|---|---|
| Full API Reference | https://developer.squareup.com/reference/square |
| Developer Docs Home | https://developer.squareup.com/docs |
| Commerce APIs | https://developer.squareup.com/docs/commerce |
| Staff APIs (Team + Labor) | https://developer.squareup.com/docs/staff |
| Tip Reporting | https://developer.squareup.com/docs/payments/scenarios/tip-reporting |
| Changelog | https://developer.squareup.com/docs/changelog/connect |

---

### 9.4 License Guidance

Study open source freely. Do not assume every repo is safe to copy code from directly.

#### Lower-Risk Licenses (direct reuse OK with attribution)

- **MIT**, **BSD**, **Apache-2.0**

Projects safe for implementation reuse:
- `medusajs/medusa` — MIT
- `chatwoot/chatwoot` — MIT
- `fullcalendar/fullcalendar` — MIT
- `react-grid-layout/react-grid-layout` — MIT
- `xyflow/xyflow` — MIT

#### Higher-Caution Licenses (study architecture, don't copy code)

- **GPL**, **AGPL**, **source-available**, **commercial dual-license**

Architecture references only:
- `calcom/cal.com` — AGPL
- `vendure-ecommerce/vendure` — GPL (dual-licensed commercial)
- `knadh/listmonk` — AGPL
- Some restaurant/KDS repos — check individually

#### Practical Rule

- Copy **ideas, schemas, workflows, and UX patterns** freely from any project.
- Reuse **actual code** only after checking the license in that specific repository.
- Prefer building our own implementation when a project is GPL/AGPL or license status is unclear.

---

### 9.5 Research Strategy

#### 1. Use Official Vendor Docs for Product Modeling

When defining data models, lifecycle states, or API contracts:
- **Shopify** for omnichannel, fulfillment, draft orders, discounts, POS extensions
- **Square** for bookings, labor/scheduling, subscriptions, invoices, terminal flows

#### 2. Use Open Source for Architecture and UX

When deciding how to structure major subsystems:
- `medusajs/medusa` for omnichannel commerce
- `calcom/cal.com` for booking and scheduling
- `chatwoot/chatwoot` for messaging inboxes
- `knadh/listmonk` for campaigns
- `metabase/metabase` and `lightdash/lightdash` for reporting UX

#### 3. Avoid Searching Randomly

Prefer the curated shortlist and study a few strong repos deeply:

1. `medusajs/medusa`
2. `Shopify/hydrogen`
3. `Shopify/function-examples`
4. `saleor/saleor`
5. `calcom/cal.com`
6. `square/connect-api-examples`
7. `chatwoot/chatwoot`
8. `knadh/listmonk`
9. `metabase/metabase`
10. `invoiceninja/invoiceninja`

---

### 9.6 Key Architecture Patterns

#### From Shopify

1. **Omnichannel inventory**: Single source of truth — one shared inventory pool with per-location quantities (`InventoryLevel`). No separate "sync" mechanism.
2. **BOPIS / Ship-from-Store / Endless Aisle**: All three built on the SAME core: `FulfillmentOrder` + order routing + multi-location inventory.
3. **Manager approvals**: 3-tier permission model — Allowed / Denied / Approval Required. "Approval Required" = another staff member enters PIN.
4. **Smart collections**: Rule engine with column + relation + condition. Supports hierarchical category matching.
5. **Location-specific pricing**: Markets → Catalogs → PriceLists. Per variant, scoped to market/catalog.
6. **Draft orders (synced carts)**: Server-side saved carts completable from any device/location.
7. **Auto-apply discounts**: Only one automatic discount per customer at a time. Custom logic via Shopify Functions.
8. **POS Smart Grid tiles**: `pos.home.tile.render` target. Dynamic tiles, 64KB bundle limit, offline since POS 11.0.

#### From Square

1. **Shift scheduling**: Draft → published states. Managers prepare privately, publish to staff. Bulk publish supported.
2. **Subscription lifecycle**: Plan (CatalogObject) → Variations (phases: trial → paid) → Subscription. Auto-invoicing + webhooks.
3. **Payment links**: `CreatePaymentLink` generates hosted checkout with just name + price. Supports tipping, shipping, Apple/Google Pay.
4. **Bookings**: Services = CatalogObjects. `SearchAvailability` returns open slots. Custom attributes + webhook lifecycle.
5. **Invoices**: Each linked to an Order. Published invoices auto-generate public payment URL. Supports scheduled send.
