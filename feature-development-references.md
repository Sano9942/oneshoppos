# Feature Development References — Shopify & Square Documentation

**Date**: 2026-04-09
**Purpose**: Maps each SanoPOS gap (from `competitive-analysis-2.md`) to the Shopify/Square documentation, GitHub repos, and sample code that can accelerate development.
**Companion doc**: `competitive-analysis-2.md` (gap analysis + priority ranking)

---

## Repos to Clone First

| Repo | Stars | What It Is | Accelerates |
|---|---|---|---|
| [Shopify/hydrogen](https://github.com/Shopify/hydrogen) | 1,900+ | React headless storefront framework — product pages, cart, checkout, local pickup | Online ordering page, BOPIS |
| [Shopify/fulfillment-order-sample-app](https://github.com/Shopify/fulfillment-order-sample-app) | 20 | Working FulfillmentOrder API flow — order routing, accept/reject fulfillment | Ship-from-store, BOPIS |
| [Shopify/function-examples](https://github.com/Shopify/function-examples) | 239 | Discount functions in Rust + JS — volume discounts, BXGY, delivery customization | Auto-apply promotions |
| [square/connect-api-examples](https://github.com/square/connect-api-examples) | 407 | Node.js sample apps for bookings, subscriptions, invoices, orders, gift cards | Recurring billing, invoicing, appointment booking |
| [square/connect-api-specification](https://github.com/square/connect-api-specification) | 76 | Full OpenAPI spec — machine-readable schema for every Square API endpoint | Data model design for all features |
| [Shopify/hydrogen-demo-store](https://github.com/Shopify/hydrogen-demo-store) | 223 | Full working demo store with collections, cart, checkout | Online storefront UI patterns |
| [Shopify/ui-extensions](https://github.com/Shopify/ui-extensions) | 328 | TypeScript definitions for all Shopify UI extension APIs including POS | POS extension architecture, Smart Grid tiles |

---

## Phase 1 — Omnichannel Foundation

### SQ-1 / SQ-2: Online Ordering Page / Storefront

| Source | URL | What You Learn |
|---|---|---|
| Shopify Hydrogen (GitHub) | https://github.com/Shopify/hydrogen | Full React storefront with product browse, cart, checkout — study architecture |
| Hydrogen Demo Store | https://github.com/Shopify/hydrogen-demo-store | Working template with collections, search, account pages |
| Shopify JS Buy SDK | https://github.com/Shopify/js-buy-sdk | Lightweight JS SDK for embedding storefront into any website |
| Hydrogen React Components | https://github.com/Shopify/hydrogen/tree/main/packages/hydrogen-react | Reusable React cart/product/checkout components and hooks |
| Square eCommerce API Guide | https://developer.squareup.com/docs/ecommerce-api | Customer-facing ordering page pattern using Orders + Checkout API |
| Square Online API | https://developer.squareup.com/docs/online-api | Sites + Snippets customization for hosted ordering pages |

### BOPIS — Buy Online, Pick Up In Store

| Source | URL | What You Learn |
|---|---|---|
| Shopify Local Pickup API | https://shopify.dev/docs/api/functions/unstable/local-pickup-delivery-option-generator | Data model for pickup locations, availability per product per location |
| Storefront API Local Pickup | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/local-pickup | Display pickup availability on product pages |
| Build Local Pickup Function | https://shopify.dev/docs/apps/build/orders-fulfillment/order-routing-apps/build-local-pickup-options-function | Custom pickup option generator (checkout flow) |
| Generate Pickup Points | https://shopify.dev/docs/apps/build/checkout/delivery-shipping/delivery-methods/generate-pickup-points | Third-party pickup location model (post offices, lockers) |
| Shopify Local Pickup Changelog | https://shopify.dev/changelog/introducing-the-local-pickup-api | LocalPickupSettingsV2 field for managing pickup settings per location |
| Shopify FulfillmentOrder (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder | Core object for order routing — which location fulfills which items |
| Prepared for Pickup Mutation | https://shopify.dev/docs/api/admin-graphql/latest/mutations/fulfillmentOrderLineItemsPreparedForPickup | Triggers "Ready for Pickup" customer notification |

**Architecture note**: Shopify's BOPIS, ship-from-store, and endless aisle are ALL built on the same core: `FulfillmentOrder` API + order routing + multi-location inventory. One shared inventory pool with per-location quantities — no separate sync mechanism.

### SP-1: Ship from Store

| Source | URL | What You Learn |
|---|---|---|
| Shopify FulfillmentService API | https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillmentservice | Model store as fulfillment center |
| Fulfillment Order Sample App | https://github.com/Shopify/fulfillment-order-sample-app | Working code for accepting/rejecting fulfillment requests |
| Shopify Fulfillment Integration | https://github.com/Shopify/shopify-fulfillment-integration | Example service that receives orders, processes, reports back |
| Fulfillment (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/fulfillment | Fulfillment lifecycle, tracking, status updates |
| Fulfillment Orders Blog | https://www.shopify.com/partners/blog/shopify-fulfillment-orders-api | Architecture overview of fulfillment order system |

### SP-2: Endless Aisle (Buy in Store, Ship from Another Location)

| Source | URL | What You Learn |
|---|---|---|
| Shopify Endless Aisles Guide | https://www.shopify.com/retail/endless-aisles-for-retail | Concept: in-store shopper orders out-of-stock item, shipped from another location |
| Shopify Draft Order API (POS context) | https://shopify.dev/docs/api/pos-ui-extensions/latest/apis/draft-order-api | Create orders from POS for items not in current store |
| Multi-Location Inventory | https://help.shopify.com/en/manual/products/inventory/setup/multi-managed-inventory | Cross-location inventory visibility |

---

## Phase 2 — Operational Depth

### SQ-16: Shift Scheduling UI

| Source | URL | What You Learn |
|---|---|---|
| Square Labor API: Scheduling | https://developer.squareup.com/docs/labor-api/scheduling | **Complete data model** — draft vs published shifts, job assignments, location binding |
| Manage Scheduled Shifts | https://developer.squareup.com/docs/labor-api/manage-scheduled-shifts | Create/update/publish shifts, bulk publish |
| Retrieve Scheduled Shifts | https://developer.squareup.com/docs/labor-api/retrieve-scheduled-shifts | Search by team member, location, date range, status |
| Labor API Overview | https://developer.squareup.com/docs/labor-api/what-it-does | Full scope: time tracking + scheduling + wages |
| Labor API Reference | https://developer.squareup.com/reference/square/labor-api | Every endpoint, field, and enum |

**Architecture note**: Square's model has draft→published states. Managers prepare schedules privately, then publish to make visible to staff. Shifts have job IDs + location IDs + team member assignment + start/end times.

**Not exposed**: Visual calendar UI, shift swap logic — build these yourself.

### SP-7: Location-Specific Pricing

| Source | URL | What You Learn |
|---|---|---|
| Shopify PriceList (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/pricelist | Fixed prices or percentage adjustments per variant per market |
| Shopify Markets | https://shopify.dev/docs/apps/build/markets | Markets → Catalogs → PriceLists system |
| Catalogs for Different Markets | https://shopify.dev/docs/apps/build/markets/catalogs-different-markets | Market-scoped catalogs with price list associations |
| International Pricing on Storefronts | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/markets/international-pricing | `@inContext(country:)` GraphQL directive for location-aware pricing |

### SP-10: Synced Draft Orders (Server-Side Parked Sales)

| Source | URL | What You Learn |
|---|---|---|
| Shopify DraftOrder (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/draftorder | Server-side cart model — line items, customer binding, tax calc, discounts |
| Shopify DraftOrder (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder | Modern API (REST is legacy as of Oct 2024) |
| POS Draft Order API | https://shopify.dev/docs/api/pos-ui-extensions/latest/apis/draft-order-api | Read-only draft order context from POS — how POS interacts with saved carts |

**Architecture note**: Shopify POS Pro saves carts as draft orders, completable from any device/location. This is exactly what SanoPOS needs to replace localStorage-based parked sales.

### SP-14: Manager Approval Workflow

| Source | URL | What You Learn |
|---|---|---|
| Shopify Manager Approvals Changelog | https://changelog.shopify.com/posts/set-up-manager-approvals-for-more-control-over-new-pos-permissions | 3-tier model: Allowed / Denied / **Approval Required** |
| POS Roles Documentation | https://help.shopify.com/en/manual/sell-in-person/shopify-pos/staff-management/pos-roles | Actions that support approval gates: discounts, ship-to-customer, edit taxes, custom sales, refunds |

**Architecture note**: "Approval Required" means another staff member (manager) must enter their PIN to authorize the action. This is a built-in POS feature, not exposed as a third-party API — but the UX pattern is well-documented.

### SP-11: Auto-Apply Promotions at Cart

| Source | URL | What You Learn |
|---|---|---|
| Shopify Discount Function API | https://shopify.dev/docs/api/functions/latest/discount | Custom discount logic architecture (edge-executed) |
| discountAutomaticBasicCreate | https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountAutomaticBasicCreate | Amount-off auto-applied at cart and checkout |
| discountAutomaticAppCreate | https://shopify.dev/docs/api/admin-graphql/latest/mutations/discountAutomaticAppCreate | App-managed automatic discounts with custom logic |
| Function Examples (GitHub) | https://github.com/Shopify/function-examples | Working discount function implementations (Rust + JS) |
| Discount App Components | https://github.com/Shopify/discount-app-components | React component library for discount builder UIs |
| Discounts Reference App | https://github.com/Shopify/discounts-reference-app | Collection of discount sample apps |
| Volume Discount Tutorial | https://github.com/Shopify/tutorial-discount-functions-with-remix | Step-by-step volume discount with Shopify Functions |

**Limitation**: Shopify allows only one automatic discount per customer at a time.

### SP-12: Return Rules / Policies

| Source | URL | What You Learn |
|---|---|---|
| Build for Return Management | https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management | Return management app architecture |
| Returns Processing API (2025-07) | https://shopify.dev/changelog/returns-processing-api | New `returnProcess` mutation — combines disposition + financial processing. Exposes return eligibility incorporating merchant return rules. |
| Returns in Customer Accounts API | https://shopify.dev/changelog/returns-now-supported-in-customer-accounts-api | Customer-facing return requests |
| Refund (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/refund | Restock types, refund line items |
| Refund (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/Refund | Modern refund processing |

### SP-20: Smart Collections (Rule-Based Auto-Sort)

| Source | URL | What You Learn |
|---|---|---|
| SmartCollection (REST) | https://shopify.dev/docs/api/admin-rest/latest/resources/smartcollection | Rule engine: column + relation + condition. Max 60 conditions, 5,000 smart collections. |
| Collection (GraphQL) | https://shopify.dev/docs/api/admin-graphql/latest/objects/Collection | Modern collection API |
| Category Descendants Rule | https://shopify.dev/changelog/introducing-productcategoryidwithdescendants-in-collectionrulecolumn-for-smart-collections | Hierarchical category matching (relevant to SanoPOS category tree) |

**Data model**: Rules use column (type, vendor, tag, price, weight, inventory stock, category) + relation (equals, contains, greater_than, less_than) + condition value.

### SQ-58 / SP-18: Custom Report Builder

| Source | URL | What You Learn |
|---|---|---|
| Shopify Polaris-Viz (GitHub) | https://github.com/Shopify/polaris-viz | Data visualization components (charts, graphs) in React + React Native |
| Shopify Polaris (GitHub) | https://github.com/Shopify/polaris | Design system — data table, filter, and layout components |

---

## Phase 3 — Marketing, Engagement & Financial Tools

### SQ-7: Recurring Billing / Subscriptions

| Source | URL | What You Learn |
|---|---|---|
| Square Subscriptions Overview | https://developer.squareup.com/docs/subscriptions-api/overview | Full subscription lifecycle — create, pause, resume, cancel, change plan |
| Create Plans Walkthrough | https://developer.squareup.com/docs/subscriptions-api/walkthrough | Plan creation via Catalog API, then enrollment |
| Subscription Billing & Invoices | https://developer.squareup.com/docs/subscriptions-api/subscription-billing | Auto-charge card on file or email invoice with payment link |
| Plans & Variations | https://developer.squareup.com/docs/subscriptions-api/plans-and-variations | Phases (free trial → paid), cadences, pricing |
| Subscription Plan Checkout | https://developer.squareup.com/docs/checkout-api/subscription-plan-checkout | Convert plan into hosted checkout page |
| Sample App: node_subscription | https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_subscription | Working Node.js Express app |

**Architecture note**: Plan = CatalogObject of type SUBSCRIPTION_PLAN. Each plan has variations with phases (trial, recurring). Subscription links customer + plan. Square handles invoicing, payment collection, and lifecycle events via webhooks.

### SQ-8: Batch Invoicing

| Source | URL | What You Learn |
|---|---|---|
| Square Invoices API | https://developer.squareup.com/docs/invoices-api/overview | Invoice lifecycle — create, schedule, publish, collect |
| Create & Publish Invoices | https://developer.squareup.com/docs/invoices-api/create-publish-invoices | Each invoice linked to an Order. Public payment URL auto-generated. |
| Pay/Refund Invoices | https://developer.squareup.com/docs/invoices-api/pay-refund-invoices | Payment tracking, refund processing |
| Sample App: node_invoices | https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_invoices | Working Node.js Express app |

**Note**: No batch endpoint — loop CreateInvoice calls. Each invoice needs an Order created first.

### SQ-9: Payment Links

| Source | URL | What You Learn |
|---|---|---|
| Square Checkout API | https://developer.squareup.com/docs/checkout-api | Hosted checkout pages — quick pay (ad-hoc item + price) or full order checkout |
| CreatePaymentLink Reference | https://developer.squareup.com/reference/square/checkout-api/create-payment-link | Endpoint details — supports tipping, custom fields, shipping |
| Manage Checkout | https://developer.squareup.com/docs/checkout-api/manage-checkout | Retrieve, list, update, delete payment links |

### SQ-26: Email Marketing Campaigns

| Source | URL | What You Learn |
|---|---|---|
| Square Customers API | https://developer.squareup.com/docs/customers-api/what-it-does | Customer segmentation data for targeting |

**Note**: Square has no public email marketing API. Square Marketing is closed. SanoPOS already has Resend infrastructure — build campaign builder + templates + scheduling on top of existing email service.

### SQ-27: SMS Marketing Campaigns

**No relevant docs from either platform.** Both use third-party providers. For SanoPOS, evaluate Twilio or local Pakistan providers (Monty Mobile, BizSMS, TelloTalk).

### SP-5: Unified Cross-Channel Customer History

| Source | URL | What You Learn |
|---|---|---|
| Shopify Customer API | https://shopify.dev/docs/api/admin-rest/latest/resources/customer | Customer object with order history |
| Square Customers API | https://developer.squareup.com/docs/customers-api/what-it-does | Customer profiles + purchase history |

**Note**: Both platforms have unified customer records because they own the entire stack. For SanoPOS, aggregate from `sales` + `web_orders` + marketplace order tables per customer.

---

## Phase 4 — New Verticals

### SQ-31–40: Restaurant Mode (Table Management, KDS, etc.)

| Source | URL | What You Learn |
|---|---|---|
| Square Table Management (product page) | https://squareup.com/us/en/point-of-sale/restaurants/features/table-management-system | UX description — visual floor plan, color-coded time, server assignment |
| Square KDS (product page) | https://squareup.com/us/en/point-of-sale/restaurants/kitchen-display-system | UX description — ticket routing, timers, alerts, station grouping |
| Square KDS Setup Guide | https://squareup.com/help/us/en/article/7944-get-started-with-square-kds-android | How KDS connects to POS, routing rules |
| Square Orders API | https://developer.squareup.com/docs/orders-api/what-it-does | Order object has `table` field on fulfillments — only API exposure for restaurant |

**Critical note**: Table management, KDS, course management, and kitchen reports have **NO public API from either platform**. These must be built entirely from scratch. Study Square's product pages for UX patterns only.

### SQ-41–50: Appointment Booking System

| Source | URL | What You Learn |
|---|---|---|
| Square Bookings API | https://developer.squareup.com/docs/bookings-api/what-it-is | Full booking system — availability search, create/update/cancel, service/staff/location binding |
| Bookings API Concepts | https://developer.squareup.com/docs/bookings-api/get-ready-to-use-the-api | Services as CatalogObjects, team member assignments, SearchAvailability for open slots |
| Sample App: node_bookings | https://github.com/square/connect-api-examples/tree/master/connect-examples/v2/node_bookings | **Complete Express app with routes and views** — the best starting reference |
| Bookings API Blog Post | https://developer.squareup.com/blog/introducing-bookings-api-beta/ | Architecture overview and design decisions |

**Architecture note**: Services = CatalogObjects. Team members have service assignments. `SearchAvailability` returns open slots. `CreateBooking` reserves a slot. Supports custom attributes on bookings + webhooks for booking events.

### SQ-51–56: Service Business Tools (Estimates, Recurring Invoices, Contracts)

| Source | URL | What You Learn |
|---|---|---|
| Square Invoices API | https://developer.squareup.com/docs/invoices-api/overview | Estimates→invoices→payment lifecycle |
| Square Subscriptions API | https://developer.squareup.com/docs/subscriptions-api/overview | Recurring invoices pattern |

**Note**: Contracts with e-signatures and milestone-based payments have no API reference from either platform. Build from scratch.

---

## Phase 5 — Pakistan-Specific Integration Depth

### SP-22: Shipping Label Generation

| Source | URL | What You Learn |
|---|---|---|
| Shopify active_shipping (GitHub) | https://github.com/Shopify/active_shipping | Ruby library abstracting carrier APIs (UPS, FedEx, USPS, Canada Post) — rate calculation, tracking, label generation |
| Shopify CarrierService API | https://shopify.dev/docs/api/admin-rest/latest/resources/carrierservice | Custom carrier rate calculation at checkout |
| Shipping Labels Guide | https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/shipping-labels | How Shopify generates labels from fulfillment data |

### CA-19 / CA-20–23: Payment Gateways (Stripe, JazzCash, Easypaisa)

| Source | URL | What You Learn |
|---|---|---|
| Square Web Payments SDK | https://developer.squareup.com/docs/web-payments/overview | Payment form patterns (card, ACH, wallets) |
| Web Payments Quickstart (GitHub) | https://github.com/square/web-payments-quickstart | Frontend payment form examples |

---

## Cross-Cutting References

### Shopify GitHub Repos (Additional)

| Repo | Stars | What It Is | Useful For |
|---|---|---|---|
| [Shopify/polaris](https://github.com/Shopify/polaris) | 5,900+ | Design system — React components, tokens, icons | UI component patterns for all features |
| [Shopify/polaris-viz](https://github.com/Shopify/polaris-viz) | 368 | Data visualization (charts, graphs) | Report builder, dashboard analytics |
| [Shopify/shopify-app-bridge](https://github.com/Shopify/shopify-app-bridge) | 103 | App Bridge JS SDK — cart manipulation, navigation | POS extension architecture patterns |
| [Shopify/pos-ui-extensions-tutorials](https://github.com/Shopify/pos-ui-extensions-tutorials) | 2 | POS smart grid tile tutorials | Smart Grid / customizable POS tiles (SP-23) |
| [Shopify/active_fulfillment](https://github.com/Shopify/active_fulfillment) | 155 | Fulfillment service integration library | Fulfillment adapter patterns |
| [Shopify/shopify-function-javascript](https://github.com/Shopify/shopify-function-javascript) | 33 | JS SDK for Shopify Functions | Discount function development |
| [Shopify/function-runner](https://github.com/Shopify/function-runner) | 80 | Local dev runner for Shopify Functions | Test discount/delivery functions locally |
| [Shopify/shopify-app-template-remix](https://github.com/Shopify/shopify-app-template-remix) | 546 | Official Remix app template | App scaffolding patterns |
| [Shopify/shopify-app-template-node](https://github.com/Shopify/shopify-app-template-node) | 1,005 | Node.js app template | Backend app patterns |
| [Shopify/checkout-sheet-kit-react-native](https://github.com/Shopify/checkout-sheet-kit-react-native) | 71 | Native checkout SDK | Mobile checkout patterns |
| [Shopify/shopify.github.com](https://github.com/Shopify/shopify.github.com) | 531 | Index of ALL Shopify open-source projects | Discovery |

### Square GitHub Repos (Additional)

| Repo | Stars | What It Is | Useful For |
|---|---|---|---|
| [square/square-nodejs-sdk](https://github.com/square/square-nodejs-sdk) | 108 | TypeScript client for ALL Square APIs | Reference for API shapes and types |
| [square/square-mcp-server](https://github.com/square/square-mcp-server) | 95 | MCP server — AI assistants access 20+ Square APIs | AI-assisted operations |
| [square/web-payments-quickstart](https://github.com/square/web-payments-quickstart) | 102 | Frontend payment form examples | Payment UI patterns |
| [square/catalog-api-demo](https://github.com/square/catalog-api-demo) | 7 | Java Catalog API demo | Product catalog CRUD patterns |
| [square/point-of-sale-android-sdk](https://github.com/square/point-of-sale-android-sdk) | 124 | Android POS SDK | Mobile POS architecture |
| [square/SquarePointOfSaleSDK-iOS](https://github.com/square/SquarePointOfSaleSDK-iOS) | 98 | iOS POS SDK | Mobile POS architecture |

### Square API Reference Hub

| API | URL |
|---|---|
| Full API Reference | https://developer.squareup.com/reference/square |
| Developer Docs Home | https://developer.squareup.com/docs |
| Commerce APIs Overview | https://developer.squareup.com/docs/commerce |
| Staff APIs (Team + Labor combined) | https://developer.squareup.com/docs/staff |
| Tip Reporting | https://developer.squareup.com/docs/payments/scenarios/tip-reporting |
| Release Notes / Changelog | https://developer.squareup.com/docs/changelog/connect |

### Shopify API Reference Hub

| API | URL |
|---|---|
| All Shopify APIs | https://shopify.dev/docs/api |
| POS UI Extensions (latest) | https://shopify.dev/docs/api/pos-ui-extensions/latest |
| Admin REST API | https://shopify.dev/docs/api/admin-rest/latest |
| Admin GraphQL API | https://shopify.dev/docs/api/admin-graphql/latest |
| Storefront API | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api |
| Changelog | https://shopify.dev/changelog |
| Building for POS (overview) | https://shopify.dev/docs/apps/build/pos |

### Shopify Partner Gists (POS Code Snippets)

| Gist | What It Shows |
|---|---|
| [Adding POS cart items](https://gist.github.com/shopifypartners/fc716189f28349d9fb4cfe27aeb3fb0d) | App Bridge cart manipulation |
| [Managing POS line items](https://gist.github.com/shopifypartners/c67eec5d406a33f1c3dac26b63df3acc) | Line item CRUD from POS extension |
| [Setting POS toast notices](https://gist.github.com/shopifypartners/275f6fc039359ee2ea8cb45db27fcb0c) | Toast notification patterns |

---

## Features with No External Documentation (Build from Scratch)

These features exist in Square/Shopify products but have **no public API or open-source code**:

| Feature | Gap IDs | What's Available |
|---|---|---|
| Table management / floor plan | SQ-31 | Square product page describes UX only |
| KDS (Kitchen Display System) | SQ-35 | Square product page + setup guide describe UX only |
| Course management / hold & fire | SQ-32 | No documentation |
| Email marketing campaign builder | SQ-26 | Resend infrastructure exists in SanoPOS; build templates + scheduling |
| Commission tracking | SQ-20 | Square Team API has wages, not commissions |
| Geofenced clock-in | SQ-17 | Use browser Geolocation API + validate against outlet coordinates |
| Shift swap workflows | SQ-16 (sub-feature) | Application-level logic on scheduling primitives |
| Check splitting logic | SQ-34 | Both platforms support multiple payments per order but no split UI/logic |
| Bar tab state management | SQ-33 | Use open order pattern — keep order open, add items, finalize on close |
| Contracts with e-signatures | SQ-54 | No reference from either platform |
| Visual loyalty rule builder | CA-43 | No reference from either platform |
| Team chat / messaging | SQ-23 | No reference from either platform |

---

## Key Architecture Patterns Learned

### From Shopify

1. **Omnichannel inventory**: Single source of truth — one shared inventory pool with per-location quantities (`InventoryLevel`). No separate "sync" mechanism. POS sale immediately updates online availability.

2. **BOPIS / Ship-from-Store / Endless Aisle**: All three built on the SAME core: `FulfillmentOrder` + order routing + multi-location inventory.

3. **Manager approvals**: 3-tier permission model — Allowed / Denied / Approval Required. "Approval Required" = another staff member enters PIN. Actions gated: discounts, ship-to-customer, edit taxes, custom sales, refunds.

4. **Smart collections**: Rule engine with column + relation + condition. Supports hierarchical category matching via `PRODUCT_CATEGORY_ID_WITH_DESCENDANTS`.

5. **Location-specific pricing**: Markets → Catalogs → PriceLists. Each PriceList has fixed prices or percentage adjustments per variant, scoped to a market/catalog.

6. **Draft orders (synced carts)**: Server-side saved carts completable from any device/location. Requires `draft_orders` access scope. GraphQL is the modern API (REST deprecated Oct 2024).

7. **Auto-apply discounts**: Only one automatic discount per customer at a time. Custom logic via Shopify Functions (edge-executed, Rust/JS).

8. **POS Smart Grid tiles**: `pos.home.tile.render` target. Tiles are dynamic (change based on cart/device state). System controls grid layout. 64KB bundle limit. Offline support since POS 11.0.

### From Square

1. **Shift scheduling**: Draft → published states. Managers prepare schedules privately, publish to make visible. Shifts have job IDs + location IDs + team member + start/end times. Bulk publish supported.

2. **Subscription lifecycle**: Plan (CatalogObject) → Variations (phases: trial → paid) → Subscription (customer enrollment). Square auto-handles invoicing, payment collection, lifecycle webhooks.

3. **Payment links**: `CreatePaymentLink` generates hosted checkout page with just a name and price (quick pay) or full order. Supports tipping, shipping, custom fields, Apple/Google Pay.

4. **Bookings**: Services = CatalogObjects. Team members have service assignments. `SearchAvailability` returns open slots. Custom attributes on bookings. Webhook-driven lifecycle.

5. **Invoices**: Each invoice linked to an Order (Orders API). Published invoices auto-generate public payment URL. Supports scheduled send dates.
