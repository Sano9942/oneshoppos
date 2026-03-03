# Shopify Integration V2 Plan

## Purpose

Upgrade the current Shopify integration into a modular, modern, SaaS-ready integration layer without starting implementation yet.

This plan is based on the current code in:

- [backend/routes/shopify.js](/d:/newprojects/oneshoppos/backend/routes/shopify.js)
- [backend/shopify/client.js](/d:/newprojects/oneshoppos/backend/shopify/client.js)
- [backend/shopify/utils.js](/d:/newprojects/oneshoppos/backend/shopify/utils.js)
- [backend/routes/orders.js](/d:/newprojects/oneshoppos/backend/routes/orders.js)
- [backend/routes/reconciliation.js](/d:/newprojects/oneshoppos/backend/routes/reconciliation.js)
- [frontend/src/pages/ShopifyIntegration.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/ShopifyIntegration.jsx)
- [frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx)

This file is planning-only. Do not start implementation without explicit approval.

## Executive Summary

The current Shopify integration already supports a broad set of operational features:

- connection setup and verification
- live validation
- webhook setup guidance
- UAT checklist
- live Shopify location fetch
- outbound inventory sync queue
- failed-event retry flow
- order pull
- product import
- inventory import
- product/location/customer mappings
- reconciliation support
- sync event monitoring

The current weakness is not missing capability. It is architecture, taxonomy handling, maintainability, and UX.

Today the Shopify integration is concentrated in:

- one large backend route module
- one large frontend page
- a limited Shopify data model that does not preserve Shopify taxonomy as a first-class concept

V2 should keep the useful behavior, split the integration into clear modules, preserve Shopify-native classification cleanly, modernize the operator experience, and prepare the system for multi-tenant SaaS later.

## Current State Audit

## Backend Capabilities Already Present

The current route module in [backend/routes/shopify.js](/d:/newprojects/oneshoppos/backend/routes/shopify.js) exposes these main areas:

- connection config:
  - `GET /api/integrations/shopify/config`
  - `PUT /api/integrations/shopify/config`
  - `POST /api/integrations/shopify/disconnect`
- health and validation:
  - `GET /api/integrations/shopify/status`
  - `POST /api/integrations/shopify/verify`
  - `POST /api/integrations/shopify/live-validation`
  - `GET /api/integrations/shopify/webhooks/setup`
  - `GET /api/integrations/shopify/uat-checklist`
- live metadata:
  - `GET /api/integrations/shopify/locations/live`
- event monitoring and queue operations:
  - `GET /api/integrations/shopify/events`
  - `POST /api/integrations/shopify/sync/retry-event/:id`
  - `POST /api/integrations/shopify/sync/process-pending`
  - `POST /api/integrations/shopify/sync/retry-failed`
- sync actions:
  - `POST /api/integrations/shopify/sync/push-inventory`
  - `POST /api/integrations/shopify/sync/pull-orders`
- imports:
  - `POST /api/integrations/shopify/import/products`
  - `POST /api/integrations/shopify/import/inventory`
  - `DELETE /api/integrations/shopify/import/products`
- mappings:
  - `GET /api/integrations/mappings/products`
  - `PUT /api/integrations/mappings/products/:id`
  - `POST /api/integrations/mappings/products/auto`
  - `POST /api/integrations/mappings/products/auto-live`
  - `POST /api/integrations/mappings/products/apply-suggestions`
  - location/customer mapping endpoints
- inbound webhook intake:
  - `POST /api/integrations/shopify/webhooks/orders-create`

Supporting logic also exists in:

- [backend/routes/orders.js](/d:/newprojects/oneshoppos/backend/routes/orders.js) for outbound inventory queue processing and web-order ingestion support
- [backend/routes/reconciliation.js](/d:/newprojects/oneshoppos/backend/routes/reconciliation.js) for inventory reconciliation and corrective actions

## Backend Data Model Already Present

The current Shopify-related tables already give a good base:

- `shopify_connections`
- `shopify_sync_runs`
- `shopify_product_map`
- `shopify_location_map`
- `shopify_customer_map`
- `shopify_order_map`
- `external_sync_events`

This is a strong starting point. V2 should preserve these tables where possible instead of replacing them casually.

## Frontend Capabilities Already Present

[frontend/src/pages/ShopifyIntegration.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/ShopifyIntegration.jsx) already provides:

- connection settings
- verification and live validation actions
- webhook setup display
- UAT checklist loading
- location mapping UI
- manual sync controls
- product import / inventory import / imported product deletion
- mapping suggestion generation and apply flow
- reconciliation review and bulk actions
- event filtering and retry

[frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx) currently adds only shell chrome, not a true redesign.

## Current Problems

### 1. Oversized backend route module

[backend/routes/shopify.js](/d:/newprojects/oneshoppos/backend/routes/shopify.js) mixes:

- connection management
- diagnostics
- sync queue control
- product import
- inventory import
- mapping CRUD
- suggestion generation
- webhook handling

This makes it hard to test, reason about, and evolve safely.

### 2. Oversized frontend page

[frontend/src/pages/ShopifyIntegration.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/ShopifyIntegration.jsx) carries too much state and too many concerns in one component.

This creates:

- high maintenance cost
- harder debugging
- weak UX hierarchy
- limited reusability

### 3. Shopify taxonomy is not modeled properly

Current import behavior preserves `product_type`, `vendor`, and `tags`, and now safely avoids corrupt category auto-creation. But Shopify-native taxonomy is still not stored as a dedicated data model.

That means:

- exact Shopify category cannot be preserved
- internal category tree and Shopify classification remain blurred conceptually
- future sync accuracy is limited

### 4. Import logic is safe but still simplistic

The current importer:

- imports one POS product per barcode
- matches/upserts by barcode
- optionally assigns internal `category_id` only when `product_type` matches exactly one leaf category

That is safe enough short-term, but not a modern integration strategy.

### 5. Source-of-truth rules are not explicit enough

The app supports:

- inventory push
- inventory pull
- manual queue processing
- reconciliation correction

But the operator experience still feels tool-driven rather than policy-driven. V2 should make sync direction and conflict rules much more explicit.

### 6. Observability is good but fragmented

There is already useful status and event data, but it is not yet presented as a coherent monitoring and diagnostics experience.

### 7. SaaS readiness is incomplete

The current system assumes a single active Shopify connection in local app context. That works today, but the future SaaS direction requires a design that can later become tenant-scoped without major rework.

## V2 Goals

## Primary Goals

- modernize Shopify integration architecture without losing current capability
- preserve Shopify-native data more accurately
- separate Shopify classification from internal categories
- improve reliability and visibility of sync operations
- redesign the operator UI into a modern workspace
- make the integration easier to test and maintain
- prepare the design for future tenant-aware SaaS implementation

## Non-Goals For This Phase

- do not fully implement Shopify taxonomy synchronization yet
- do not redesign the whole multi-tenant backend in this phase
- do not replace all existing sync logic with a brand-new engine if current logic can be evolved safely
- do not change internal hierarchical categories into a Shopify clone
- do not implement Shopify billing/app-install OAuth flow yet unless explicitly approved later

## Guiding Principles

### Preserve behavior before expanding behavior

V2 should first make the current integration cleaner and safer before adding ambitious new functionality.

### Keep internal categories and Shopify categories separate

Internal categories are for OneShopPOS merchandising and reporting.
Shopify taxonomy is external source data and should be stored separately.

### Prefer explicit mapping over guessed mapping

If Shopify data cannot be safely mapped to internal product/category structure, preserve it and surface it for review instead of guessing.

### Design for operators

The UI should help users answer:

- Is the connection healthy?
- What synced recently?
- What failed?
- What is waiting for action?
- What was imported?
- What is mapped?
- What is unresolved?

### Design for later tenant scoping

Even though current implementation is single-instance, the module boundaries and data ownership should be chosen so future tenant-scoped storage is straightforward.

## Proposed V2 Architecture

## Backend Module Split

Refactor [backend/routes/shopify.js](/d:/newprojects/oneshoppos/backend/routes/shopify.js) into a route folder with focused modules.

Recommended structure:

```text
backend/routes/shopify/
  index.js
  config.js
  health.js
  locations.js
  imports.js
  mappings.js
  sync.js
  events.js
  webhooks.js
```

Recommended service layer:

```text
backend/shopify/
  client.js
  utils.js
  connection-service.js
  import-service.js
  mapping-service.js
  sync-service.js
  webhook-service.js
  monitoring-service.js
  taxonomy-service.js
```

Recommended responsibilities:

- `client.js`
  - raw GraphQL access
  - pagination helpers
  - request error normalization
- `connection-service.js`
  - load active connection
  - verify connection
  - save/rotate credentials
- `import-service.js`
  - product import
  - inventory import
  - import summaries
  - import cleanup/delete flow
- `mapping-service.js`
  - product mapping CRUD
  - auto-suggestion generation
  - apply-suggestion logic
  - location/customer mapping helpers
- `sync-service.js`
  - inventory event enqueue
  - pending event processing
  - retry logic
  - sync run bookkeeping
- `webhook-service.js`
  - signature verification
  - replay protection
  - webhook dispatch
- `monitoring-service.js`
  - status snapshot
  - queue health
  - diagnostics payloads
- `taxonomy-service.js`
  - Shopify taxonomy extraction and persistence logic
  - internal category mapping support

## Product Data Model Upgrades

The current product model already stores:

- `product_type`
- `vendor`
- `tags`
- internal `category_id`

V2 should add explicit Shopify classification fields to `products` or a dedicated Shopify product metadata table.

Recommended minimum fields:

- `shopify_category_gid`
- `shopify_category_name`
- `shopify_category_path`
- `shopify_status`
- `shopify_product_handle` if available later

Possible additional metadata table:

```text
shopify_product_metadata
  product_id
  shopify_product_id
  shopify_variant_id
  shopify_inventory_item_id
  shopify_category_gid
  shopify_category_name
  shopify_category_path
  shopify_product_type
  shopify_vendor
  shopify_tags_json
  last_imported_at
```

Decision recommendation:

- short-term: add a few Shopify-specific fields directly on `products` if speed matters
- long-term: use a dedicated metadata table for cleaner sync semantics

## Taxonomy Strategy

### Internal category tree

Continue using the current hierarchical internal categories for:

- POS browsing
- internal merchandising
- internal reporting
- promotions and local workflows

### Shopify classification

Store Shopify-native classification separately for:

- accurate import fidelity
- sync diagnostics
- future channel reporting
- future category mapping workflows

### Mapping relationship

The relationship should be:

- one product has one internal `category_id`
- one product may also have one Shopify category
- mapping from Shopify classification to internal category is explicit or review-driven

### Import rule

During import:

- preserve Shopify category data exactly if available
- preserve `product_type`, `vendor`, and `tags`
- do not auto-create internal categories from Shopify custom text fields
- only assign internal `category_id` through:
  - explicit mapping rule
  - exact approved match
  - operator review

## Sync Model Upgrades

## Inventory Sync

V2 should make inventory sync policy explicit.

Recommended policy settings:

- `inventory_source_of_truth`
  - `local_pos`
  - `shopify`
  - `manual_reconciliation`
- `auto_process_outbound_inventory_queue`
- `allow_manual_push`
- `allow_manual_pull`
- `reconciliation_requires_approval`

These can start as config fields later, even if initially stored in `shopify_connections` or a related settings table.

## Orders Sync

Current inbound order handling exists via:

- webhook intake
- manual order pull

V2 should make order sync clearer:

- inbound order health
- last received webhook time
- last imported order time
- failed webhook count
- webhook signature status

## Product Import

V2 import should provide:

- preview capability
- import summary by run
- counts for created/updated/skipped/failed/unmapped
- explicit flagging of ambiguous category assignment
- optional scoped import later by product selection or query

## Mapping System Upgrades

The current mapping infrastructure is valuable and should be kept, but modernized.

## Product Mapping

Improve mapping with:

- mapping confidence score
- reason for suggestion
- conflict explanation
- batch review UX
- last verified timestamp surfaced more clearly

## Location Mapping

Improve location mapping with:

- one clear “default behavior” explanation
- mismatch warnings
- mapping health indicators
- store/location naming normalization

## Customer Mapping

Keep current mapping support, but move it into a clearer module and UI section.

## Monitoring and Diagnostics

V2 should unify status, events, queue health, validation, and UAT into a single monitoring model.

Recommended overview metrics:

- connection status
- last verified at
- last successful inventory push
- last successful inventory pull
- last successful order ingest
- pending queue count
- retry due count
- dead-letter count
- active mapped products
- unmapped imported products
- reconciliation mismatch count

Recommended diagnostics panels:

- connection diagnostics
- webhook diagnostics
- queue diagnostics
- mapping health
- import exceptions
- reconciliation exceptions

## Frontend V2 UX Plan

## Current UX Problem

[frontend/src/pages/ShopifyIntegration.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/ShopifyIntegration.jsx) is a large operator console with many unrelated actions visible at once.

It works, but it does not feel modern, guided, or easy to scan.

## Proposed Workspace Structure

Replace the one-page experience with a modern workspace layout.

Recommended navigation sections:

- `Overview`
- `Connection`
- `Catalog Import`
- `Product Mappings`
- `Locations`
- `Inventory Sync`
- `Orders`
- `Reconciliation`
- `Events`
- `Diagnostics`

## Recommended Frontend Component Structure

```text
frontend/src/pages/redesign/shopify/
  ShopifyWorkspace.jsx
  ShopifyOverviewPanel.jsx
  ShopifyConnectionPanel.jsx
  ShopifyCatalogImportPanel.jsx
  ShopifyMappingsPanel.jsx
  ShopifyLocationsPanel.jsx
  ShopifyInventorySyncPanel.jsx
  ShopifyOrdersPanel.jsx
  ShopifyReconciliationPanel.jsx
  ShopifyEventsPanel.jsx
  ShopifyDiagnosticsPanel.jsx
  hooks/
    useShopifyConfig.js
    useShopifyStatus.js
    useShopifyEvents.js
    useShopifyMappings.js
    useShopifyReconciliation.js
```

Keep [frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx) only as an entry shell or replace it with the new workspace root.

## Visual Direction

The V2 Shopify UI should feel:

- operational
- clean
- modern
- less form-dump
- more status-led

Recommended look:

- overview cards with health status
- task-oriented sections
- clearer primary actions
- better danger-zone separation
- compact but readable tables
- empty-state guidance
- timeline-like event panels
- stronger hierarchy for warnings and failures

## UX Behavior Improvements

### Overview

First screen should answer:

- Are we connected?
- Is anything failing?
- What needs action?
- What synced recently?

### Connection

Connection screen should include:

- shop domain
- API version
- token rotation
- webhook secret state
- verify action
- validation action
- webhook setup instructions

### Catalog Import

Catalog import screen should show:

- latest import result
- imported product counts
- unmapped products
- category mapping warnings
- import/delete actions
- future preview mode placeholder

### Product Mappings

This should become a dedicated workflow:

- existing mappings
- suggested mappings
- conflicts
- apply/reject actions
- confidence/reason text

### Events

Event screen should focus on:

- backlog
- failed events
- retry due
- filters
- per-event retry
- dead-letter visibility

### Diagnostics

This should consolidate:

- live validation
- UAT checklist
- webhook setup status
- connection health snapshot

## SaaS Readiness Plan

Even if implementation stays single-instance today, design V2 so tenant scoping can be added with minimum rework.

## SaaS Design Requirements

- avoid hidden singleton assumptions in service boundaries
- keep connection loading isolated behind a connection service
- avoid route logic directly assuming one global store forever
- prefer “integration settings provider” patterns over raw table reads spread everywhere

## Future Tenant-Safe Evolution

Later, this should become:

- one Shopify connection per tenant, or per tenant store
- tenant-scoped mappings
- tenant-scoped sync runs
- tenant-scoped external sync events

This plan does not implement tenant support now, but V2 code boundaries should support that future.

## Phased Implementation Plan

## Phase 1: Full Contract Audit — ✅ COMPLETE

Before refactoring, document:

- all Shopify endpoints
- all Shopify-related tables
- every route dependency
- which actions are dry-run vs real
- which actions mutate stock/products/orders
- existing permissions and feature flags

Deliverables:

- endpoint map
- data flow map
- mutation-risk map
- open issue list

## Phase 2: Backend Modularization Without Behavior Change — ✅ COMPLETE (Mar 2026)

**What was implemented:**

- `backend/routes/shopify.js` (1,929 lines) deleted
- Replaced by `backend/routes/shopify/` with 8 focused modules:
  - `index.js` — entry point, shared dep wiring
  - `config.js` — 3 routes: GET/PUT config, POST disconnect
  - `health.js` — 6 routes: status, verify, locations/live, live-validation, webhooks/setup, uat-checklist
  - `sync.js` — 5 routes: events, retry-event, process-pending, retry-failed, push-inventory
  - `orders.js` — 1 route: pull-orders
  - `webhooks.js` — 1 route: orders-create (HMAC sig verify, replay window, idempotency)
  - `import.js` — 3 routes: POST/DELETE products, POST inventory
  - `mappings.js` — 9 routes: products CRUD + auto + live + apply-suggestions, locations, customers
- Critical bug fixed: `upsertWebOrderFromShopifyPayload` extracted to `backend/shopify/order-service.js`, properly threaded through `registerAllRoutes.js` → `shopifyDeps`
- All 28 routes verified present and loading correctly (static audit + Node require test)

## Phase 3: Shopify Data Model Hardening — ✅ COMPLETE (Mar 2026)

**What was implemented:**

- `backend/migrate60.js` — creates `shopify_product_metadata` table:
  - `product_id` (FK → products, ON DELETE CASCADE)
  - `shopify_product_id`, `shopify_handle`, `shopify_status`
  - `shopify_product_type`, `shopify_vendor`, `shopify_tags`
  - `shopify_published_at`, `shopify_updated_at`, `last_imported_at`, `created_at`
  - UNIQUE constraints on `product_id` and `shopify_product_id`
  - Index `idx_spm_shopify_product_id` for fast lookups
- `backend/run_migrations.js` updated to include `migrate60.js`
- `backend/shopify/client.js` — `handle` field added to `fetchShopifyProductsFull` GraphQL product query; returned as `shopify_handle` in product objects
- `backend/routes/shopify/import.js` — fire-and-forget upsert into `shopify_product_metadata` after every product import (`ON CONFLICT(product_id)` keeps data fresh on re-import)
- DELETE `/import/products` automatically cascades deletes to `shopify_product_metadata` via FK
- Existing product fields (`product_type`, `vendor`, `tags`, `description_html`) remain on `products` table unchanged

## Phase 4: Import and Mapping Modernization

Upgrade product import and mapping workflows.

Requirements:

- import summaries by run
- unmapped/ambiguous result tracking
- better suggestion reasons
- explicit review paths

Success criteria:

- operators can understand what imported
- operators can understand what mapped and what did not

**Completed in Mar 2026:**

- **SKU-based Import:** `backend/routes/shopify/import.js` updated to support products with only SKUs via 3-stage lookup (Map -> Barcode -> SKU) and explicit UPDATE/INSERT strategy.
- **Leading Zero Fix:** Corrected numeric coercion bug in `client.js` and `import.js` to preserve leading zeros in identifiers.

## Phase 5: Frontend Shopify Workspace Redesign

Replace the legacy one-page panel with a modular workspace.

Requirements:

- overview-first UX
- sectioned workflows
- clearer actions
- better tables and diagnostics presentation

Success criteria:

- improved usability
- better scanning of health and next actions
- reduced page complexity

## Phase 6: Observability and Diagnostics Upgrade

Improve monitoring:

- queue summaries
- recurring error reasons
- import run summaries
- mapping health
- webhook health

Success criteria:

- faster operator troubleshooting
- lower support burden

## Phase 7: Hardening and Regression Coverage

Add or expand:

- backend integration tests
- importer tests
- mapping tests
- queue retry tests
- Playwright smoke coverage

Success criteria:

- stable behavior through refactor
- safer future iteration

## Backend File Impact Map

Likely files touched during implementation:

- ~~[backend/routes/shopify.js]~~ → **replaced by `backend/routes/shopify/` (8 modules)**
- [backend/routes/orders.js](/d:/newprojects/oneshoppos/backend/routes/orders.js)
- [backend/routes/reconciliation.js](/d:/newprojects/oneshoppos/backend/routes/reconciliation.js)
- [backend/shopify/client.js](/d:/newprojects/oneshoppos/backend/shopify/client.js) ✅ updated
- [backend/shopify/utils.js](/d:/newprojects/oneshoppos/backend/shopify/utils.js)
- [backend/shopify/order-service.js](/d:/newprojects/oneshoppos/backend/shopify/order-service.js) ✅ new
- [backend/index.js](/d:/newprojects/oneshoppos/backend/index.js)
- `backend/migrate60.js` ✅ new — `shopify_product_metadata`
- test helpers in [backend/tests/helpers/seedSchema.js](/d:/newprojects/oneshoppos/backend/tests/helpers/seedSchema.js)

## Frontend File Impact Map

Likely files to touch during implementation:

- [frontend/src/pages/ShopifyIntegration.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/ShopifyIntegration.jsx)
- [frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx](/d:/newprojects/oneshoppos/frontend/src/pages/redesign/ShopifyIntegrationRedesign.jsx)
- new Shopify workspace components under a redesign subfolder
- shared hooks/utilities for Shopify state management

## Key Risks

### Risk: Refactor breaks live sync behavior

Mitigation:

- keep endpoint contracts stable during module split
- refactor backend in behavior-preserving phases
- expand test coverage before aggressive logic changes

### Risk: Shopify taxonomy work leaks into internal categories

Mitigation:

- preserve separate fields for Shopify classification
- keep internal category mapping explicit

### Risk: Import logic becomes too clever and corrupts data

Mitigation:

- prefer null/unmapped states over guessed assignment
- add import summaries and conflict reasons

### Risk: Frontend redesign changes operator workflow too abruptly

Mitigation:

- keep familiar sections and wording where helpful
- redesign around workflow clarity, not novelty

### Risk: SaaS future is blocked by current single-store assumptions

Mitigation:

- isolate connection and settings loading
- centralize integration services
- keep future tenant scoping in mind during module boundaries

## Testing Plan

## Backend Tests

Add or expand tests for:

- connection save/load/verify
- live validation
- webhook signature verification and replay handling
- product import success/failure/unmapped cases (including SKU-only and barcode mix)
- multi-stage lookup accuracy (no duplicates created)
- inventory import
- queue processing
- retry single event
- retry failed events
- mapping suggestion generation
- mapping suggestion apply
- location mapping
- customer mapping
- status payload accuracy

## Frontend Tests

Add or expand tests for:

- connection flow
- import action flow
- mapping suggestion review/apply
- event filtering and retry
- reconciliation action flow
- diagnostics panels

## E2E / Playwright

Recommended permanent smoke specs:

- Shopify connection status and diagnostics load
- product import summary flow
- mapping suggestion review/apply flow
- queue retry/event monitoring flow
- reconciliation action flow

Use the shared auth helper already present in:

- [frontend/tests/e2e/helpers/auth.js](/d:/newprojects/oneshoppos/frontend/tests/e2e/helpers/auth.js)

## Acceptance Criteria

Shopify Integration V2 is ready to implement when:

- current integration contract is fully documented
- backend refactor boundaries are agreed
- taxonomy separation approach is agreed
- frontend workspace structure is agreed
- rollout phases are agreed

Shopify Integration V2 implementation is complete when:

- Shopify code is modular by concern
- current critical behaviors still work
- Shopify-native classification is preserved separately
- internal categories remain independent
- frontend Shopify workspace is modern and easier to operate
- queue, diagnostics, mapping, and import workflows are clearer
- regression tests and smoke tests cover the critical paths

## Recommended Next Step

**Phases 1–3 are complete (Mar 2026).**

- **Phase 4** — Import and Mapping Modernization
  - ✅ Added SKU-based filtering (importable items = barcode OR SKU)
  - ✅ Implemented 3-stage lookup (Map > Barcode > SKU)
  - ✅ Explicit UPDATE/INSERT to bypass barcode-only constraints
  - [ ] Import run summaries & conflict reasons (upcoming)
- **Phase 5** — Frontend Shopify Workspace Redesign
- **Phase 6** — Observability and Diagnostics Upgrade
- **Phase 7** — Hardening and Regression Coverage
