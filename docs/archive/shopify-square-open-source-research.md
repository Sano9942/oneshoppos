# Shopify, Square, and Open-Source Research

**Date**: 2026-04-09
**Purpose**: Consolidate official Shopify and Square documentation, official GitHub repositories, and high-value open-source GitHub projects that can help OneShopPOS build the roadmap items in `competitive-analysis-2.md`.
**Companion docs**:
- `competitive-analysis-2.md`
- `feature-development-references.md`

---

## Executive Summary

Yes, Shopify and Square both have strong documentation and GitHub resources that can help us build many of the features listed in `competitive-analysis-2.md`.

- **Shopify** is the strongest reference for omnichannel commerce:
  storefronts, local pickup, BOPIS, ship-from-store, endless aisle, draft orders, automatic discounts, POS UI extensions, and fulfillment routing.
- **Square** is the strongest reference for operational workflows:
  orders, inventory, customers, gift cards, labor/scheduling, bookings, invoices, subscriptions, and terminal-driven payment flows.
- **Open source on GitHub** is essential for the parts the vendors do not fully expose:
  scheduling UI, booking UX, restaurant table management, KDS flows, reporting builders, unified inboxes, campaign builders, and broader product architecture.

The key rule is:

- Use **vendor docs** for APIs, object models, and lifecycle design.
- Use **open-source projects** for architecture, schemas, workflow patterns, UI ideas, and implementation strategy.
- Be careful with **licenses** before copying code directly.

---

## GitHub Access Status

GitHub access is available in this session.

Confirmed visible repositories under `Sano9942` include:

- `Sano9942/oneshoppos`
- `Sano9942/erpnext`
- `Sano9942/awesome`
- `Sano9942/self-hosted-ai-starter-kit`
- `Sano9942/walkmate`

For this research, the highest-value material came from **public open-source repositories** and **official vendor repositories**, not from private code.

---

## What Shopify Helps With Best

Shopify is the best external reference for these roadmap areas:

- Online storefront / online ordering
- BOPIS and local pickup
- Ship-from-store
- Endless aisle
- Draft orders synced across devices
- Auto-apply promotions
- Smart collections
- POS extension architecture
- Multi-location inventory and fulfillment routing

### Key Official Shopify Docs

| Area | Source | URL | Why It Matters |
|---|---|---|---|
| POS extensions | POS UI Extensions | https://shopify.dev/docs/api/pos-ui-extensions/latest | Best reference for POS customization architecture and embedded POS capabilities |
| Fulfillment routing | FulfillmentOrder | https://shopify.dev/docs/api/admin-graphql/latest/objects/FulfillmentOrder | Core order-routing object behind local pickup and ship-from-store |
| Local pickup on storefront | Storefront API Local Pickup | https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/local-pickup | Shows how pickup availability is represented on the customer-facing side |
| Hydrogen framework | Hydrogen fundamentals | https://shopify.dev/docs/storefronts/headless/hydrogen/fundamentals | Best official headless storefront reference |
| Discount engine | Functions Discount API | https://shopify.dev/docs/api/functions/latest/discount | Strong model for automatic discounts and custom discount logic |
| Draft orders | DraftOrder GraphQL object | https://shopify.dev/docs/api/admin-graphql/latest/objects/DraftOrder | Best reference for server-side parked carts / draft sales |
| Return rules | Return management docs | https://shopify.dev/docs/apps/build/orders-fulfillment/returns-apps/build-return-management | Good for return policy and eligibility design |
| Smart collections | SmartCollection REST docs | https://shopify.dev/docs/api/admin-rest/latest/resources/smartcollection | Useful for rule-based product grouping |

### Key Official Shopify GitHub Repositories

| Repo | URL | Why It Helps |
|---|---|---|
| `Shopify/hydrogen` | https://github.com/Shopify/hydrogen | Best official storefront architecture reference |
| `Shopify/hydrogen-demo-store` | https://github.com/Shopify/hydrogen-demo-store | Working example of storefront flows and UI structure |
| `Shopify/function-examples` | https://github.com/Shopify/function-examples | Discount and fulfillment customization examples |
| `Shopify/ui-extensions` | https://github.com/Shopify/ui-extensions | Strong reference for POS extension APIs and embedded UI contracts |
| `Shopify/fulfillment-order-sample-app` | https://github.com/Shopify/fulfillment-order-sample-app | Useful for ship-from-store and fulfillment-order lifecycle patterns |
| `Shopify/discount-app-components` | https://github.com/Shopify/discount-app-components | Helpful if we later build a discount or promotion configuration UI |

### Shopify Architecture Takeaways

- Shopify's omnichannel strength comes from a shared model:
  one inventory pool, multi-location quantities, fulfillment routing, and draft/server-side order objects.
- BOPIS, ship-from-store, and endless aisle are not isolated features.
  They all depend on the same fulfillment and inventory architecture.
- Shopify is especially useful for features in `competitive-analysis-2.md` such as:
  `SQ-1`, `SP-1`, `SP-2`, `SP-10`, `SP-11`, `SP-12`, `SP-20`, `SP-21`, and `SP-23`.

---

## What Square Helps With Best

Square is the best external reference for these roadmap areas:

- Orders and checkout flows
- Catalog and inventory structure
- Customers and gift cards
- Labor and scheduling
- Bookings / appointments
- Invoices and subscriptions
- Payment links
- Terminal / device-driven checkout

### Key Official Square Docs

| Area | Source | URL | Why It Matters |
|---|---|---|---|
| Full platform reference | Square API Reference | https://developer.squareup.com/reference/square | Central source for object models and endpoint definitions |
| SDKs | Square SDK docs | https://developer.squareup.com/docs/sdks | Useful if we evaluate Square examples in Node or TypeScript |
| Labor and scheduling | Labor API overview | https://developer.squareup.com/docs/labor-api/what-it-does | Best reference for scheduling data model and labor workflows |
| Scheduled shifts | Labor API scheduling | https://developer.squareup.com/docs/labor-api/scheduling | Shows draft/published shift model and shift object structure |
| Bookings | Bookings API overview | https://developer.squareup.com/docs/bookings-api/what-it-is | Best official model for appointments and availability |
| Bookings concepts | Get ready to use Bookings API | https://developer.squareup.com/docs/bookings-api/get-ready-to-use-the-api | Explains services, staff assignments, and availability search |
| Terminal flows | Terminal API overview | https://developer.squareup.com/docs/terminal-api/overview/ | Strong reference for server-initiated terminal actions |
| Gift cards | Gift Cards API | https://developer.squareup.com/docs/gift-cards/using-gift-cards-api | Good for digital gift-card lifecycle ideas |
| Orders | Orders API overview | https://developer.squareup.com/docs/orders-api/what-it-does | Strong checkout and order-state reference |

### Key Official Square GitHub Repositories

| Repo | URL | Why It Helps |
|---|---|---|
| `Square-Developers/connect-api-examples` | https://github.com/square/connect-api-examples | Best practical examples for bookings, invoices, subscriptions, gift cards, and orders |
| `square/square-nodejs-sdk` | https://github.com/square/square-nodejs-sdk | Useful if we want to understand modern SDK patterns in Node |
| `square/connect-api-specification` | https://github.com/square/connect-api-specification | OpenAPI schema reference for data-model design |
| `Square-Developers` org | https://github.com/Square-Developers | Good entry point for official examples and sandbox apps |

### Square Architecture Takeaways

- Square is strongest when we want to understand **business operations workflows**, not just storefront commerce.
- The Labor API is the best documented reference for scheduling and shift objects among the two vendors.
- The Bookings API is the strongest official reference for appointment-system object design:
  services, team assignments, search availability, booking creation, updates, and cancellations.
- Square is useful for features in `competitive-analysis-2.md` such as:
  `SQ-7`, `SQ-8`, `SQ-9`, `SQ-16`, `SQ-20`, `SQ-22`, `SQ-25a`, `SQ-26`, `SQ-41`, `SQ-42`, `SQ-47`, `SQ-52`, and `SQ-61b`.

### Square Limitations for Our Research

Square is weaker as a direct implementation reference for:

- Full online storefront architecture
- Restaurant floor-plan internals
- KDS implementation internals
- Advanced POS UI customization internals

For restaurant and KDS specifically, Square product pages are useful for UX ideas, but public APIs do not expose the full internal model.

---

## Best Open-Source GitHub Projects

These are the best open-source projects to study for OneShopPOS.

### Tier 1: Highest-Value References

| Project | URL | Stars | Stack | Best Use |
|---|---|---:|---|---|
| `medusajs/medusa` | https://github.com/medusajs/medusa | 32.6k | TypeScript, Node.js, Postgres | Omnichannel commerce, fulfillment, returns, promotions, draft orders, payment links |
| `calcom/cal.com` | https://github.com/calcom/cal.com | 41.1k | TypeScript, Next.js, Prisma, Postgres | Appointments, scheduling, availability, waitlists, reminders, resource booking |
| `saleor/saleor` | https://github.com/saleor/saleor | 22.8k | Python, GraphQL, Postgres | Multi-channel inventory, pricing, warehouses, fulfillment, gift cards, returns |
| `chatwoot/chatwoot` | https://github.com/chatwoot/chatwoot | 28.3k | Ruby on Rails, Postgres | Unified inbox, conversation history, customer messaging, automation ideas |
| `knadh/listmonk` | https://github.com/knadh/listmonk | 19.5k | Go, Postgres | Email campaigns, segmentation, scheduling, audience management |
| `metabase/metabase` | https://github.com/metabase/metabase | 46.8k | Clojure, TypeScript | Saved reports, dashboards, embedded analytics, report-builder UX |

### Tier 2: Strong Supporting References

| Project | URL | Stars | Stack | Best Use |
|---|---|---:|---|---|
| `vendure-ecommerce/vendure` | https://github.com/vendure-ecommerce/vendure | 8.0k | TypeScript, NestJS, GraphQL | Plugin architecture, promotions, collections, extension patterns |
| `medusajs/nextjs-starter-medusa` | https://github.com/medusajs/nextjs-starter-medusa | 2.7k | TypeScript, Next.js | Storefront UI and flow patterns |
| `lightdash/lightdash` | https://github.com/lightdash/lightdash | 5.7k | TypeScript | Self-serve BI, dashboard UX, metrics model ideas |
| `invoiceninja/invoiceninja` | https://github.com/invoiceninja/invoiceninja | 9.6k | PHP, TypeScript | Estimates, recurring invoices, reminders, deposits, service-business workflows |
| `killbill/killbill` | https://github.com/killbill/killbill | 5.4k | Java | Subscription billing concepts and lifecycle design |
| `opensourcepos/opensourcepos` | https://github.com/opensourcepos/opensourcepos | 4.1k | PHP, MySQL | Classic POS patterns, receipts, gift cards, reports, returns |

### Tier 3: Focused UI and Component References

| Project | URL | Stars | Best Use |
|---|---|---:|---|
| `fullcalendar/fullcalendar` | https://github.com/fullcalendar/fullcalendar | 20.4k | Shift scheduling and booking calendar UI |
| `jquense/react-big-calendar` | https://github.com/jquense/react-big-calendar | 8.7k | Simpler React calendar implementation |
| `react-grid-layout/react-grid-layout` | https://github.com/react-grid-layout/react-grid-layout | 22.2k | Drag-and-drop report layouts and dashboard tiles |
| `xyflow/xyflow` | https://github.com/xyflow/xyflow | 36.0k | Visual workflow builder, loyalty rule builder, no-code flow UI |
| `qzind/tray` | https://github.com/qzind/tray | N/A | Browser printing, Zebra/ZPL, printer integration patterns |

### Restaurant and KDS References

Restaurant-specific OSS is much weaker than ecommerce and scheduling.
These repos are useful mainly for concepts and UI patterns, not as direct foundations.

| Project | URL | Notes |
|---|---|---|
| `ury-erp/ury` | https://github.com/ury-erp/ury | Restaurant management ideas: floor plans, kitchen order routing |
| `ury-erp/mosaic` | https://github.com/ury-erp/mosaic | KDS and ticket-routing concepts |
| `BenClementt/OpenKDS` | https://github.com/BenClementt/OpenKDS | Small KDS reference |
| `calvincchong/FoodStreams` | https://github.com/calvincchong/FoodStreams | Real-time kitchen display ideas |
| `BryanTheLai/RestaurantProject` | https://github.com/BryanTheLai/RestaurantProject | Restaurant POS and ordering UI patterns |

### Why These Projects Matter for OneShopPOS

- Our stack is already close to the ecosystems used by several of the best references:
  React 19, Vite, TypeScript on the frontend and Node/Express/Postgres on the backend.
- `Medusa`, `Vendure`, `Cal.com`, `Lightdash`, and many of the UI component libraries are especially relevant because they are close to our engineering style.
- `Saleor`, `Chatwoot`, `Metabase`, `Invoice Ninja`, and `Kill Bill` are still valuable, but more as architecture and workflow references than direct code donors.

---

## Best Open-Source Project by Feature Area

| Feature Area | Best Reference | Why |
|---|---|---|
| Online storefront / online ordering | `medusajs/medusa` + `Shopify/hydrogen` | Strong commerce architecture plus strong storefront UI |
| BOPIS / local pickup | Shopify docs + `medusajs/medusa` | Shopify explains the model, Medusa helps with fulfillment design |
| Ship-from-store | Shopify FulfillmentOrder docs + `medusajs/medusa` | Best mix of routing model and implementation ideas |
| Endless aisle | Shopify docs + `saleor/saleor` | Cross-location inventory and channel-aware order logic |
| Synced draft orders | Shopify DraftOrder docs + `medusajs/medusa` | Server-side saved-cart/draft-order patterns |
| Auto-apply promotions | `vendure-ecommerce/vendure` + Shopify Functions examples | Strong rule/action model and real discount examples |
| Smart collections | `saleor/saleor` + Shopify SmartCollection docs | Rule-driven product grouping |
| Shift scheduling | Square Labor API + `calcom/cal.com` + `fullcalendar/fullcalendar` | Best mix of data model, availability logic, and calendar UI |
| Time-off requests | `calcom/cal.com` + smaller shift-scheduler repos | Similar scheduling and employee-availability concepts |
| Appointment booking | Square Bookings docs + `calcom/cal.com` | Best combination of workflow model and product architecture |
| Email campaigns | `knadh/listmonk` | Strong campaign and segmentation reference |
| Unified inbox / 2-way messaging | `chatwoot/chatwoot` | Best open-source inbox reference |
| Estimates / recurring invoices / deposits | `invoiceninja/invoiceninja` | Practical service-business workflow reference |
| Custom report builder | `metabase/metabase` + `lightdash/lightdash` + `react-grid-layout/react-grid-layout` | Best reporting UX and dashboard composition references |
| Restaurant table management | Square product UX + restaurant OSS | Mostly needs custom implementation |
| KDS | Square product UX + `OpenKDS` / `FoodStreams` / `mosaic` | Mostly custom build with reference patterns only |
| Barcode / Zebra printing | `qzind/tray` | Good reference for printer bridging and label output |
| Visual loyalty rule builder | `xyflow/xyflow` | Strong no-code workflow and node-builder UI foundation |

---

## License Guidance

We should absolutely study open source.
We should not assume every repo is safe to copy from directly.

### Lower-Risk Licenses for Direct Reuse

These are generally easier to reuse directly, subject to normal attribution and compliance:

- MIT
- BSD
- Apache-2.0

Examples likely most comfortable for implementation reuse:

- `medusajs/medusa`
- `chatwoot/chatwoot`
- `knadh/listmonk`
- `fullcalendar/fullcalendar`
- `react-grid-layout/react-grid-layout`
- `xyflow/xyflow`

### Higher-Caution Licenses

These are still valuable to study, but direct code reuse needs more care:

- GPL
- AGPL
- source-available or commercial dual-license models

Examples to treat primarily as **architecture references first**:

- `calcom/cal.com`
- `vendure-ecommerce/vendure`
- possibly some restaurant/KDS repos depending on their license details

### Safe Practical Rule

- Copy **ideas, schemas, workflows, and UX patterns** freely.
- Reuse **actual code** only after checking the license in that specific repository.
- Prefer building our own implementation when a project is GPL/AGPL or license status is unclear.

---

## Recommended Research Strategy for OneShopPOS

### 1. Use Official Vendor Docs for Product Modeling

When we need to define data models, lifecycle states, or API contracts, use:

- Shopify for omnichannel, fulfillment, draft orders, discounts, POS extensions
- Square for bookings, labor/scheduling, subscriptions, invoices, terminal flows

### 2. Use Open Source for Architecture and UX

When we need to decide how to structure major subsystems, use:

- `medusajs/medusa` for omnichannel commerce
- `calcom/cal.com` for booking and scheduling
- `chatwoot/chatwoot` for messaging inboxes
- `knadh/listmonk` for campaigns
- `metabase/metabase` and `lightdash/lightdash` for reporting UX

### 3. Avoid Searching Randomly

Do not use GitHub as a giant idea dump.
Prefer a curated shortlist and study a few strong repos deeply.

The strongest shortlist for us right now is:

- `medusajs/medusa`
- `Shopify/hydrogen`
- `Shopify/function-examples`
- `saleor/saleor`
- `calcom/cal.com`
- `Square-Developers/connect-api-examples`
- `chatwoot/chatwoot`
- `knadh/listmonk`
- `metabase/metabase`
- `invoiceninja/invoiceninja`

---

## Recommended Priority Mapping to Our Roadmap

### Phase 1: Omnichannel Foundation

Best references:

- Shopify Hydrogen
- Shopify FulfillmentOrder docs
- Shopify local pickup docs
- `medusajs/medusa`
- `saleor/saleor`

Features covered:

- `SQ-1` online storefront
- `SQ-2` online ordering page
- `SP-1` ship-from-store
- `SP-2` endless aisle
- `SP-10` synced draft orders
- `SP-11` auto-apply promotions

### Phase 2: Operational Depth

Best references:

- Square Labor API
- `calcom/cal.com`
- `fullcalendar/fullcalendar`
- Shopify discount docs
- `vendure-ecommerce/vendure`

Features covered:

- `SQ-16` shift scheduling
- `SQ-25a` time-off requests
- `SP-14` manager approval pattern
- `SP-12` return rules
- `SP-20` smart collections

### Phase 3: Marketing and Customer Operations

Best references:

- `knadh/listmonk`
- `chatwoot/chatwoot`
- Square docs for invoices, payment links, and customer flows

Features covered:

- `SQ-26` email campaigns
- `SQ-28` 2-way customer messaging
- `SQ-9` payment links
- `SQ-8` batch invoicing

### Phase 4: New Verticals

Best references:

- Square Bookings API
- `calcom/cal.com`
- restaurant/KDS OSS repos
- Square restaurant UX/product pages

Features covered:

- `SQ-31` table management
- `SQ-35` KDS
- `SQ-41` booking website
- `SQ-42` multi-staff calendars
- `SQ-47` appointment reminders
- `SQ-52` recurring invoices

---

## Final Recommendation

Yes, we should search GitHub open source to help this project.

But we should do it selectively:

- Use **Shopify** as the primary external reference for omnichannel commerce.
- Use **Square** as the primary external reference for operations, labor, bookings, and terminal flows.
- Use **open source** to fill in the missing product architecture and UX implementation details.

If we keep our research disciplined, these sources can accelerate design decisions significantly without pushing us into copy-paste architecture or licensing trouble.
