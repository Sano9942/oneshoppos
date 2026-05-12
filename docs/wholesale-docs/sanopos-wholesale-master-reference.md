# SanoPOS Wholesale Master Reference — 2026-05-13

**This is the single day-to-day wholesale/distribution reference for the repo.**

If you want one file that answers "what have I built, what's missing, and what do I build next?", start here.

Companion file: [research-competitive-landscape.md](research-competitive-landscape.md) — fresh competitive research (May 2026) covering Shopify B2B, NetSuite, Cin7, Odoo, BigCommerce, QuickBooks Commerce, plus Pakistan incumbents (SAMS, SalesFlo, Smart Distribution, Moneypex, DigitalManager). Every gap claim in this document is grounded in that file.

> **How this file should be used:** Read the "Where we are" section to understand state. Read the "Roadmap" section to know what to build next. Don't add features outside the roadmap without revisiting Tier sequencing.

---

## Headline (read this first)

**Wholesale is currently "general_retail with renamed labels."** The preset has no dedicated mode, no exclusive feature flags, and shares the retail flag bundle on signup ([backend/routes/setup.js:272](../../backend/routes/setup.js#L272)).

**That's fine as a v1.** It means a wholesale signup gets a working POS with FBR, multi-outlet, and customer invoices from day 1. But a real wholesale distributor will hit walls fast on credit limits, statements, UOM, and field-rep workflow.

**The strategic position:** Pakistan-built distribution software (SAMS, SalesFlo) has van-sales DNA but weak portals and bolt-on FBR. Global platforms (Shopify B2B, Cin7, NetSuite) have portals and pricing engines but zero PJP/beat-plan/order-booker capability. **SanoPOS sits exactly between them** — we already have FBR queue infrastructure that local DMS struggle with, plus a global-grade core (multi-tenant, multi-outlet, RBAC, portal). The wedge is to add the PK-native field-rep layer that no global player will copy.

---

## Where we are (live state — verified 2026-05-13)

### The wholesale preset

| Field | Value | Source |
|---|---|---|
| `industry_type` | `wholesale` | [industry-config.js:231](../../backend/config/industry-config.js#L231) |
| `business_model` | `b2b_distribution` | [industry-config.js:232](../../backend/config/industry-config.js#L232) |
| `display_name` | `Wholesale / Distribution` | [industry-config.js:233](../../backend/config/industry-config.js#L233) |
| `modes` | `[]` (none) | [industry-config.js:234](../../backend/config/industry-config.js#L234) |
| Labels | `customer→Buyer`, `customers→Buyers`, `sale→Invoice`, `order→Order` | [industry-config.js:235-242](../../backend/config/industry-config.js#L235-L242) |
| POS layout | `grid` | [industry-config.js:252](../../backend/config/industry-config.js#L252) |
| Onboarding steps | `store → product → employees → shift → sale` (same as retail) | [industry-config.js:251](../../backend/config/industry-config.js#L251) |
| Seed products | 3 bulk items (Bulk A 10K, Bulk B 15K, Clearance 2K) | [preset-seed-data.js:33-40](../../backend/seeds/preset-seed-data.js#L33-L40) |
| Flag bundle on signup | Same as `general_retail` and `grocery` | [setup.js:272](../../backend/routes/setup.js#L272) |
| Portal tabs | `invoices`, `orders`, `profile` | [industry-config.js:761](../../backend/config/industry-config.js#L761) |
| Portal tab labels | `Account Invoices`, `Purchase Orders` | [industry-config.js:784](../../backend/config/industry-config.js#L784) |

### What a wholesale tenant CAN do today

Real capability — not vaporware, not bolt-on. Every item here is wired up and works:

| Capability | Where | Notes |
|---|---|---|
| **Customer groups with flat % discount** | `customer_groups.discount_percent` ([schema-pg.sql:303-310](../../backend/schema-pg.sql#L303-L310)) | E.g. "Distributors group" gets 10% off list. Manual assignment per customer. |
| **Per-customer price list** | `customers.price_list_id → price_lists` ([schema-pg.sql:265-274](../../backend/schema-pg.sql#L265-L274), [routes/price-lists.js](../../backend/routes/price-lists.js)) | Override price per SKU per customer. |
| **Price books with rules** | [routes/price-books.js](../../backend/routes/price-books.js), `phase2g_price_books` flag | Rule-based override engine on top of price lists. |
| **Customer running balance** | `customers.balance NUMERIC` ([schema-pg.sql:354](../../backend/schema-pg.sql#L354)) | Tracked, not enforced as a cap. |
| **Customer invoices with terms** | `customer_invoices` ([schema-pg.sql:2745+](../../backend/schema-pg.sql#L2745)), `customer_invoicing` flag | `balance_due`, `due_date`, `amount_paid`, `status`. |
| **Quotations** | `quotations` table, [routes/quotations.js](../../backend/routes/quotations.js), `crm_quotations` flag | Quote → must PUT status to `accepted` → `convert` to sale. |
| **CRM module** | [routes/tier4/crm.js](../../backend/routes/tier4/crm.js), `crm_quotations` flag | Notes per buyer, quotation pipeline. |
| **Multi-outlet stock + transfers** | `outlet_stock`, `variant_outlet_stock`, `inventory_transfers` | Multiple warehouses with their own stock. |
| **Buyer-facing portal** | [routes/customer-portal/](../../backend/routes/customer-portal/), [pages/portal/](../../frontend/src/pages/portal/) | Buyer logs in, sees invoices and orders. |
| **FBR Digital Invoicing** | [routes/fbr.js](../../backend/routes/fbr.js), [services/fbr.js](../../backend/services/fbr.js), `workers/fbr-worker-boss.js`, `fbr_integration` flag | **Real-time queue with exponential backoff retry, IRN + QR code stamping. This is a moat.** |
| **Marketplace channels** | Daraz, Meta, WhatsApp, Google Merchant; `marketplace_integrations` flag | Wholesale tenants with a B2C side. |
| **Bulk import** | [routes/import.js](../../backend/routes/import.js), `/import` page | CSV/XLSX for products, customers, suppliers. Critical for onboarding a real wholesaler. |
| **Report Builder** | [routes/tier4/report-builder.js](../../backend/routes/tier4/report-builder.js), `phase2_report_builder` flag | Custom reports if pre-built ones don't cover. |
| **Accounting core** | [routes/tier4/accounting.js](../../backend/routes/tier4/accounting.js), `accounting_core` flag | Chart of accounts, journal entries, limited. |
| **Sidebar label remap** | [AppLayoutRedesign.jsx:92-108](../../frontend/src/components/AppLayoutRedesign.jsx#L92-L108) | Customers → Buyers, Sales History → Invoice History (after 891994d). |

### What a wholesale tenant CANNOT do today

The "show me the wall." These are real day-1 blockers from the research, sequenced by impact:

| Gap | What real wholesalers need | What we have |
|---|---|---|
| **Credit limit enforcement** | Cap "Buyer X cannot owe more than Rs 500K." Hard or soft block at sale time. | `credit_limit` only on suppliers ([schema-pg.sql:49](../../backend/schema-pg.sql#L49)), not customers. |
| **A/R aging report** | "Show me every buyer's outstanding bucketed 0-30/31-60/61-90/90+." Standard everywhere. | Supplier-payables aging exists, customer version does not. |
| **Customer statements** | "Email Buyer X a PDF of every unpaid invoice this month." | Nothing — operator filters `customer_invoices` manually. |
| **Per-buyer payment terms field** | Net-30/45/COD on the customer record, surfaced at sale + invoice. | `customers` has no `payment_terms_days` column (supplier table does). |
| **PJP / beat plan / order booker app** | Field rep visits 8 retailers/day, takes orders on phone, syncs back. Offline-first, GPS check-in, selfie attendance. | Nothing. **No PK wholesale tenant will be serious about us until this exists.** |
| **Schemes engine** | "Buy 10 cases Tapal, get 1 free." "≥50 cases this quarter → 3% rebate." Slab, free-goods, retrospective. | Generic promotions, not B2B schemes. |
| **Secondary sales tracking** | Manufacturer wants real-time view of distributor's onward sales to retailers. | Nothing. |
| **Unit-of-measure conversion** | Stock in cartons of 24, sell by carton or by unit. Reorder threshold in cartons. | Zero schema hits for `uom`, `case_pack`, `carton`. |
| **MOQ enforcement** | "Min order Rs 50K" or "multiples of 12 only." | `min_order_amount` exists on suppliers (PO-side), nothing on customer-side. |
| **Sales order with stock commit** | SO reserves stock without depleting. Decrement at dispatch. | Sales deplete immediately; quotations don't reserve. |
| **Backorders / partial fulfillment** | Ship 60 of ordered 100, mark 40 backordered, fulfill later from same SO. | No "remaining qty" concept. |
| **Company hierarchy + buyer roles** | Buyer Company → multiple ship-to locations → Org Admin / Buyer / Approver / Accountant users with spend caps. | Customers are flat — one customer, one user, no hierarchy. |
| **Quote → SO → Pick → Pack → Ship → Invoice as distinct documents** | Each stage has its own state, audit trail, reversal path. Reservation at SO, decrement at Pick, invoice at Ship. | Quotation → sale is one step. |
| **RFQ workflow** | Buyer requests pricing → seller reviews/adjusts → sends back → buyer accepts → converts. | Quotations exist but no buyer-initiated RFQ from the portal. |
| **Vaulted card auto-charge on Net due** | Buyer saves card; system charges on Day 30. Eliminates 80% of dunning. | Manual payment recording only. |
| **Deposits / partial payment at order** | 30%/50% upfront on custom orders. | Sales are paid in full at checkout. |
| **Margin reports by buyer / SKU / rep** | "What did I make on Buyer X last quarter?" | Report Builder probably can express this, no pre-built. |
| **Grid ordering (apparel size-run)** | One screen: 5 sizes × 4 colors with qty boxes, submit one order. Critical for PK textile. | Nothing — one row per SKU at POS. |
| **EDI 850/856/810** | Required when wholesaler ships to chain stores (Metro/Imtiaz/Carrefour/Hyperstar). | Nothing. Defer until first ask. |

---

## Roadmap (the actual plan)

Four tiers, opinionated about sequence. Pick from one tier at a time. Do **not** cherry-pick across tiers — the dependencies are real.

> **Why this order?** Tier 0 makes wholesale not-embarrassing for the next real signup. Tier 1 is the moat — the thing no global player will copy. Tier 2 is parity with Shopify B2B / Cin7 so we don't lose competitive deals. Tier 3 is enterprise nice-to-haves that we should not start without a customer asking.

### Tier 0 — Make wholesale not embarrassing (target: 1-2 weeks of focused work)

**Goal:** When the next real wholesale tenant signs up, they have something materially different from a retail tenant — credit controls, AR aging, statements, terms.

| # | Item | Schema delta | New endpoints | New surface | Estimate |
|---|---|---|---|---|---|
| 0.1 | **Customer credit limit + enforcement** | `customers.credit_limit NUMERIC DEFAULT 0`, `customers.credit_block_mode TEXT DEFAULT 'warn' CHECK IN ('warn','hard','off')` | Sales create endpoint checks `(balance + sale_total) > credit_limit` — returns 403 `CREDIT_LIMIT_EXCEEDED` with override perm. New perm `override_credit_limit` (manager). | POS modal: "Credit limit reached. Manager override required." Customer page: credit limit field + current utilization bar. | 3-4 days |
| 0.2 | **Per-customer payment terms** | `customers.payment_terms_days INTEGER DEFAULT 0` | Used when creating customer invoice — auto-sets `due_date = invoice_date + payment_terms_days`. | Customer form: "Default payment terms" select (COD / Net-7 / Net-15 / Net-30 / Net-45 / Custom). | 1 day |
| 0.3 | **A/R aging report** | None (computed from `customer_invoices`). | `GET /api/reports/ar-aging?as_of=&outlet_id=` returns rows of `{customer_id, name, 0-30, 31-60, 61-90, 90+, total}`. Configurable buckets via `company_profile.ar_aging_buckets JSONB` (default `[30,60,90]`). | New report tab "A/R Aging" — table + CSV export. | 2-3 days |
| 0.4 | **Customer statements** | None. | `GET /api/customers/:id/statement?from=&to=` returns HTML/JSON. `POST /api/customers/:id/send-statement` sends via Resend. | Customer page: "Send Statement" button. Statement template in `services/email-templates.js`. | 2 days |
| 0.5 | **Wholesale-specific dashboard widgets** | None. | `GET /api/dashboard/wholesale` — total outstanding, overdue >30 days, top 5 buyers by balance. | Dashboard cards visible when `industry_type='wholesale'`. | 1-2 days |
| 0.6 | **Add `wholesale` mode + feature flag** | `tenant_modes` row: `wholesale`. New flag `wholesale_credit_controls` (default ON for wholesale preset). | None new — gates the surfaces above. | All Tier-0 sidebar/page additions use `requiredMode: 'wholesale'` or `requiredFlag: 'wholesale_credit_controls'`. | 0.5 day |

**Tier 0 exit criteria:**
- A wholesale tenant can set a credit limit, attempt to oversell, get blocked.
- A wholesale tenant can run AR aging and see who owes them what.
- A wholesale tenant can email a statement to a buyer.
- Migration v85 is the marker.

### Tier 1 — The Pakistan wedge (target: 4-6 weeks)

**Goal:** Ship the thing no global player will copy. This is the differentiator — PJP/beat-plan + schemes + secondary sales — combined with our existing FBR queue.

| # | Item | Notes | Estimate |
|---|---|---|---|
| 1.1 | **Field rep mobile app foundation** | Add `employee_type` column to `employees` (`'in_store'` / `'field_rep'`). Add `field_rep_routes` table (rep_id, day_of_week, outlet_visit_order, customer_id). New routes `POST /api/field/check-in` (lat/lng + selfie), `GET /api/field/route/today`. | 1 week |
| 1.2 | **PJP / beat plan** | `field_visits` table (rep_id, customer_id, planned_at, checked_in_at, gps_lat, gps_lng, selfie_url, status). Daily route builder UI. Order capture form (offline-first via IndexedDB, sync on reconnect). | 1.5 weeks |
| 1.3 | **Schemes engine** | New tables: `schemes` (name, brand_id, sku_filter, start/end, type='slab'/'free_goods'/'rebate'), `scheme_rules` (qty_from, qty_to, action_type, action_value), `scheme_applications` (sale_id, scheme_id, calculated_value). Apply at sale create + at scheme period end (retrospective). | 1.5 weeks |
| 1.4 | **Secondary sales tracking** | A "manufacturer view" — wholesale tenants can mark certain customers as "manufacturer" partners and a manufacturer's portal shows real-time onward sales of their brand SKUs through this distributor. This is the killer feature for FMCG. **Complex — may need its own scoping.** | 1.5-2 weeks |
| 1.5 | **Wholesale tenant mode flag bundle** | New flags: `wholesale_field_sales`, `wholesale_schemes`, `wholesale_secondary_sales`. Default OFF, opt-in per tenant (avoids forcing complexity on small wholesale signups). | 0.5 day |

**Tier 1 exit criteria:**
- A field rep can log in to a mobile-optimized view, see their route for today, drive to retailer A, check in (GPS + selfie), take an order, sync it back.
- A scheme like "Buy 10 cartons, get 1 free" can be defined and auto-applies at order entry.
- A manufacturer-tenant or manufacturer-partner can see secondary sales reports.

### Tier 2 — Parity with Shopify B2B / Cin7 (target: 8-12 weeks)

**Goal:** Don't lose competitive deals against Shopify B2B (now on all paid plans as of April 2026) or Cin7 ($349/mo with B2B portal included).

| # | Item | Notes | Estimate |
|---|---|---|---|
| 2.1 | **Multi-UOM** | `product_uoms` table (product_id, code, name, conversion_factor_to_base). Or simpler: `products.case_pack INTEGER` + `products.case_price NUMERIC` for the 80% case. Stock in base units, sell-by toggle at POS. | 2 weeks |
| 2.2 | **MOQ / case-pack enforcement** | `products.min_order_qty INTEGER`, `products.order_increment INTEGER`. Frontend block + backend reject. | 3 days |
| 2.3 | **Quote → SO → Pick → Pack → Ship → Invoice as distinct documents** | `sales_orders` table (separate from `sales`), with stages. Stock reservation at SO confirm via `inventory_reservations` (exists for restaurant). Decrement at pick. Invoice creation at ship. | 3 weeks — this is big and touches the whole order pipeline. |
| 2.4 | **Backorders / partial fulfillment** | `sale_items.qty_remaining`, multiple shipment records per SO. | 1 week (after 2.3) |
| 2.5 | **Vaulted card auto-charge on Net due** | Integrate with xPay sandbox to vault. Add `customer_payment_methods` table. Background worker checks due invoices and auto-charges. | 1 week |
| 2.6 | **Company hierarchy + buyer roles** | New tables: `buyer_companies` (replaces or extends `customers`), `buyer_locations`, `buyer_users` (with role: org_admin/buyer/approver/accountant/readonly). Per-user spend cap. Approval workflow: orders >threshold need approver sign-off. | 3-4 weeks — this is the biggest single item. |
| 2.7 | **RFQ workflow at portal** | Buyer adds items to basket, clicks "Request Quote" instead of "Buy". Seller sees pending RFQ, adjusts price/qty, sends back. Buyer accepts → converts to SO. | 1 week (after 2.6) |
| 2.8 | **Deposits / partial payment on order** | `sales_orders.deposit_amount`, capture deposit at order confirm via existing payment gateway adapter. | 4 days |
| 2.9 | **Grid ordering** | New POS layout `grid_matrix` — for products with variants on 2 axes (size × color), one screen with qty boxes per cell. Wholesale-textile specific. | 1.5 weeks |
| 2.10 | **Reorder previous + favorites at portal** | One-click "reorder last order" button. Per-buyer favorites list. | 4 days |
| 2.11 | **Customer-specific catalog visibility** | `price_lists.allowed_product_ids` or new `customer_visible_products` table. Some SKUs invisible to some buyers. | 1 week |

**Tier 2 exit criteria:**
- A wholesale tenant can run a real quote → order → invoice flow with stock reserved at the right moment.
- Their buyers self-serve via portal with company-level user management.
- A textile wholesaler can take size-run orders in one screen.
- We can credibly say "we match Shopify B2B / Cin7 on B2B core."

### Tier 3 — Defer until asked

Don't start any of these without a real customer asking. Listed here so we don't forget they exist.

- **EDI 850/856/810** — partner integration (Crstl/Orderful/SPS) when first wholesaler hits a chain-store contract.
- **Punchout catalogs** (Coupa/Ariba) — only matters for govt/hospital/NGO institutional buyers.
- **BNPL on B2B** — finance partner integration. Cool but not core.
- **Drop-ship from supplier to customer** — niche flow.
- **Consignment stock** — stock at customer's location, billed on sell-through.
- **Bulk CSV order upload at portal** — buyer pastes 200-row order from their ERP.
- **Per-warehouse stock visibility to buyer** — "36 Karachi, 12 Lahore, 0 Multan."
- **Multi-currency per customer** — only matters when first regional/export wholesaler signs up.
- **Dunning sequences** (auto-email at +7/+14/+30 overdue) — once vaulted cards (2.5) ships, dunning matters less.
- **Sales target by rep / region** — once field-rep app (Tier 1) is live, this becomes the obvious next step.

---

## Decision rules

**When tempted to add a feature outside this roadmap:**
1. Is it on Tier 0/1/2? Then do it in tier order.
2. Is it on Tier 3? Then we need a real customer asking before we start.
3. Is it not on this list? Then either (a) revisit the roadmap and add it with reasoning, or (b) don't.

**When tempted to skip Tier 0 and jump to Tier 1:**
Don't. A real wholesale signup with no credit controls will churn before they ever use a field rep. Tier 0 is small (1-2 weeks). Just do it.

**When tempted to skip Tier 1 and jump to Tier 2:**
This is the trap. Tier 2 makes us "good enough vs Shopify B2B." Tier 1 makes us "the only choice in Pakistan for distribution." If we never build Tier 1, we're competing on Shopify's terms, on Shopify's pricing, on Shopify's home turf. Resist.

**When a real wholesale customer signs up:**
Their actual pain (collected within the first 2 weeks of their signup) overrides this roadmap. The roadmap is the default; the customer is the truth.

---

## Open questions to resolve before starting Tier 0

1. **Hard block vs soft block on credit limit by default?**
   - Hard = sale refuses. Soft = warn + allow with manager override.
   - Recommendation: soft (`credit_block_mode='warn'`), with per-tenant config to harden.
2. **Statement template — minimal or full?**
   - Minimal: list of unpaid invoices + total.
   - Full: opening balance, every transaction, closing balance (like a bank statement).
   - Recommendation: minimal for v1, full later.
3. **AR aging buckets — fixed or configurable?**
   - Convention: 0-30/31-60/61-90/90+.
   - Some PK distributors run weekly (0-15/16-30/31-45/46+).
   - Recommendation: configurable via `company_profile.ar_aging_buckets JSONB` (default `[30,60,90]`).
4. **Where does the wholesale-specific dashboard live?**
   - New `/wholesale/dashboard` route, or extra cards on the existing `/dashboard` when `industry_type='wholesale'`?
   - Recommendation: extra cards on existing dashboard, gated by mode.

---

## Test tenant for verification

Use this tenant for all wholesale walk-throughs. Do not delete.

| Field | Value |
|---|---|
| Login URL | https://sanopos.com/login |
| Store Code | `wholesalewalktest1778451` |
| Username | `Wholesale Test Owner` |
| Password | `TestWholesale778!` |
| Admin PIN | `4321` |
| Tenant ID | 103 |
| Owner Email | `wholesalewalk-1778451+test@gmail.com` |
| Preset | wholesale / b2b_distribution / Pakistan / PKR |
| Sample products | Bulk A (Rs 10K), Bulk B (Rs 15K), Clearance (Rs 2K) — all stock=0 |

Before testing flows, run a stock adjustment via `/adjustments` to give samples non-zero stock.

---

## Reference: cited paths

- Wholesale preset config: [backend/config/industry-config.js:230-255](../../backend/config/industry-config.js#L230-L255)
- Wholesale seed products: [backend/seeds/preset-seed-data.js:33-40](../../backend/seeds/preset-seed-data.js#L33-L40)
- Onboarding flag bundle decision: [backend/routes/setup.js:269-273](../../backend/routes/setup.js#L269-L273)
- Portal tabs: [backend/config/industry-config.js:761](../../backend/config/industry-config.js#L761)
- Portal labels: [backend/config/industry-config.js:784](../../backend/config/industry-config.js#L784)
- Customer schema: [backend/schema-pg.sql:344-379](../../backend/schema-pg.sql#L344-L379)
- Supplier credit (not customer): [backend/schema-pg.sql:40-50](../../backend/schema-pg.sql#L40-L50)
- Customer invoices: [backend/schema-pg.sql:2745](../../backend/schema-pg.sql#L2745)
- Customer groups: [backend/schema-pg.sql:303-310](../../backend/schema-pg.sql#L303-L310)
- Price lists: [backend/schema-pg.sql:265-274](../../backend/schema-pg.sql#L265-L274)
- Sidebar label translation: [frontend/src/components/AppLayoutRedesign.jsx:92-108](../../frontend/src/components/AppLayoutRedesign.jsx#L92-L108)
- Competitive research: [docs/wholesale-docs/research-competitive-landscape.md](research-competitive-landscape.md)
- Yesterday's handoff: [docs/retail-docs/next-session-2026-05-12.md](../retail-docs/next-session-2026-05-12.md)
