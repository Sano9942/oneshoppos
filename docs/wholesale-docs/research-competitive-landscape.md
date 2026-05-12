# Wholesale Platform Research — May 2026

> Competitive-landscape research for scoping a wholesale/B2B module for SanoPOS. All claims cited to URLs at the bottom. Treat anything not cited as analysis, not fact.

## TL;DR (top of file)

1. **Our internal list is mostly correct on AR/credit/UOM/pricing/portal**, but is **missing six categories** the market treats as table-stakes: (1) **company hierarchies with buyer roles + per-buyer spend limits**, (2) **quote → sales order → pick → pack → ship → invoice as distinct stages with separate documents**, (3) **RFQ / quote workflow with rep modification + approval**, (4) **EDI 850/856/810** for chain-store buyers, (5) **deposits and partial-payment capture on B2B orders**, and (6) **vaulted payment methods + Net-terms-with-auto-charge-on-due-date**. These are not nice-to-haves — every Tier-A platform ships them.
2. Shopify's **April 2026 move** made B2B available on all paid plans (Basic/Grow/Advanced), no longer Plus-only. The bar has just been raised for any new POS entering the wholesale space — buyers will compare a Pakistan-built tool against a free-tier Shopify B2B feature set. ([shopify.com](https://www.shopify.com/news/b2b-for-all))
3. **NetSuite is the gold standard** but costs $2,499–$4,999/mo for SuiteCommerce alone. Its differentiators are real-time pricing matrix reads, native ERP integration, advanced UOM (Each → Inner Pack → Case → Pallet with conversion factors), grid ordering, punchout catalog support, and multi-warehouse fulfillment routing. ([anchorgroup](https://www.anchorgroup.tech/blog/netsuite-suitecommerce-wholesale-distributors), [folio3](https://netsuite.folio3.com/blog/netsuite-suitecommerce-pricing/))
4. **Square has no native wholesale offering.** The Square community has open feature requests dating multiple years. ([Square Community](https://community.squareup.com/t5/Feature-Requests/B2B-Wholesale-Ordering-Portal/idi-p/825780))
5. **QuickBooks Commerce / TradeGecko is dead.** Shut down August 31, 2023. Inflow / Unleashed / Cin7 picked up the abandoned base. This is a real opportunity vector — there are still migrated-from-TradeGecko businesses looking for a permanent home. ([Unleashed](https://www.unleashedsoftware.com/blog/quickbooks-commerce-sunset/))
6. **BigCommerce B2B Edition is Enterprise-tier only** (~$1,000–$1,500/mo+). Includes RFQ, Net-5/15/30/45/60 terms, junior/senior buyer roles, and a self-serve company-management portal. ([wizcommerce](https://wizcommerce.com/blog/bigcommerce-pricing/), [bettercommerce](https://www.bettercommerce.io/blog/bigcommerce-b2b-edition-review))
7. **Cin7 bundles a B2B portal in every plan ($349/mo+)** — this is the closest comp to where SanoPOS should aim feature-wise for the mid-market. Includes credit cards / ACH / BNPL / authorize-as-order-vs-invoice. ([Cin7](https://www.cin7.com/features/sales/b2b-online-stores/))
8. **Pakistan-specific stack is mature but fragmented**: SAMS Online (1,500+ distributors), Smart Distribution, SalesFlo, Moneypex, DigitalManager, OptiPOS — all FBR-integrated, all heavy on **van sales / PJP (Permanent Journey Plan) / order booker apps with GPS + selfie attendance**. These are the actual incumbents. ([SAMS](https://www.sams.solutions/), [SalesFlo](https://www.salesflo.com/), [Smart Distribution](https://smartdistribution.pk/))
9. **PJP / beat planning / van-sales workflows are a PK-specific must-have** that none of the global platforms ship natively. This is where SanoPOS could differentiate against Shopify B2B (which has no field-rep app at all) — but the local incumbents already do it well.
10. **What's surprisingly underserved across all platforms**: layered/stacked promo logic for B2B (e.g., "Pepsi case + Lays carton + cooler placement = 3% rebate"), retrospective rebates / accruals to scheme payouts, and FBR Digital Invoicing native handling at the wholesale invoice level. SanoPOS already has the FBR plumbing — wholesalers genuinely need this and most local DMS bolt it on.

---

## Per-platform deep dive

### Tier A

#### 1. Shopify B2B (formerly Plus-only Wholesale Channel)

- **Pricing tier required**: As of **April 2, 2026**, core B2B is on **Basic, Grow, Advanced, and Plus** — no longer Plus-exclusive. ([shopify.com/news](https://www.shopify.com/news/b2b-for-all), [novadata](https://novadata.io/resources/news/shopify-b2b-all-plans-april-2026))
- **Non-Plus plans get**: Company profiles, **up to 3 custom catalogs** with tailored pricing, volume discounts, quantity rules, vaulted credit cards, and payment terms.
- **Plus-only differentiators**: **Unlimited catalogs**, direct catalog-to-company/location assignment, **partial payments and deposits**, **sales rep permission scoping**.
- **Core B2B feature set** (vendor's own categorization):
  - **Company accounts** — wholesale buyers manage multiple shipping locations under one login; each location has own pricing/terms/catalog ([shero](https://sherocommerce.com/blogs/insights/shopify-b2b-guide))
  - **Catalogs and pricing** — fixed prices OR percentage adjustments per product/variant; assigned to companies ([Shopify Help — Catalogs](https://help.shopify.com/en/manual/b2b/catalogs))
  - **Quantity rules + volume pricing** — up to **10 price breaks per product/variant**, applied at variant level ([Shopify Help — Quantity Pricing](https://help.shopify.com/en/manual/b2b/catalogs/quantity-pricing))
  - **Payment terms** — Net terms attached to companies; vaulted cards for auto-charge
  - **Markets B2B catalogs** — per-country B2B pricing ([Shopify Help — Markets B2B](https://help.shopify.com/en/manual/b2b/markets/catalogs))
- **Things we hadn't considered**:
  - **Vaulted credit cards** attached to a company — pay-on-due-date without re-entering card.
  - **Buyer location** as a first-class object distinct from the company itself (parent company → multiple ship-to locations, each with own pricing).
  - Per-variant volume breaks (not per-product) — important for SKU-level pricing precision.
- **What it explicitly DOESN'T cover** that wholesalers complain about:
  - **No native EDI** (must use 3rd party like Crstl, Orderful, SPS Commerce) ([crstl.ai](https://www.crstl.ai/blog/shopify-edi-integration))
  - **No field-sales-rep app** with offline order capture / GPS / route planning
  - **No PJP / beat planning** (irrelevant in US/EU markets, critical in PK/India)
  - **No quote/RFQ workflow** out-of-box (apps fill this)
  - **No AR aging report** — must use accounting integration
- **Customer story**: Vendor and ecosystem case studies are abundant on shopify.com/enterprise (referenced via [coderapper guide](https://coderapper.com/article/shopify/the-complete-guide-to-b2b-commerce-on-shopify-plus-in-2026/) and [revize playbook](https://www.revize.app/blog/shopify-b2b-2026-complete-guide)) — typical wins are DTC brands like apparel/cosmetics/CPG opening a wholesale channel to retailers without a separate site.

#### 2. Square

- **Pricing tier required**: **No native B2B/wholesale tier exists.** ([Square Community feature request](https://community.squareup.com/t5/Feature-Requests/B2B-Wholesale-Ordering-Portal/idi-p/825780))
- **Core wholesale feature set advertised**: None. Workarounds include creating a second password-protected Square Online location for wholesale buyers.
- **What's missing**: Customer-specific catalogs, net terms, credit limits, AR aging, sales orders distinct from completed sales, MOQ enforcement, customer-specific catalogs.
- **Verdict**: Square is retail-only. Wholesalers on Square actively churn out to Shopify B2B / Cin7 / NetSuite as they grow.
- **Implication for SanoPOS**: Square has explicitly chosen NOT to compete here. That's a meaningful gap in the retail-POS-evolves-to-wholesale-POS positioning.

#### 3. NetSuite SuiteCommerce B2B

- **Pricing tier required**: **SuiteCommerce Standard $2,499/mo, SuiteCommerce Advanced $4,999/mo**, plus per-user NetSuite ERP licenses ($999+/mo base). Real total: $5K–$15K+/mo for mid-market wholesale distributors. ([folio3](https://netsuite.folio3.com/blog/netsuite-suitecommerce-pricing/), [brokenrubik](https://www.brokenrubik.com/blog/netsuite-pricing-the-definitive-guide))
- **Core wholesale feature set** (vendor + partner categorization):
  - **Customer-specific pricing** reading directly from NetSuite's pricing matrix — buyers see their entitled price automatically.
  - **Grid ordering** — buyer orders many SKU/size/color variants in a single grid (e.g., apparel size runs).
  - **Quote workflows**, **credit terms**, **gated catalog access**, **B2B + B2C from one storefront**. ([anchorgroup](https://www.anchorgroup.tech/blog/netsuite-suitecommerce-wholesale-distributors))
  - **Punchout catalog support** — for Coupa/Ariba/SAP procurement systems.
  - **EDI 850/810/856/855/846/214** via partner connectors (SPS Commerce, Orderful, MindCloud). ([orderful](https://www.orderful.com/blog/edi-integration-with-netsuite-guide))
  - **Multi-warehouse fulfillment routing** — nearest warehouse, vendor-specific, lowest-cost routing.
  - **Native ERP integration** — no middleware sync; orders are sales orders immediately, inventory updates real-time.
- **Things we hadn't considered**:
  - **Punchout catalogs** — corporate-procurement integration (irrelevant for kiryana but critical when SanoPOS targets institutional buyers / govt / hospitals).
  - **Grid ordering** — single-screen multi-variant entry, huge UX win for apparel/footwear wholesalers.
  - **Real-time pricing matrix reads** vs. cached catalog pricing — significant for B2B accuracy.
- **What it doesn't cover well**:
  - High implementation cost / time (~3–9 months) keeps SMB wholesalers out.
  - No native field-rep mobile app — third party SuiteApps fill the gap.
- **Customer story**: **West Coast Differentials** — 25-year-old automotive differential distributor across Western US, nationwide shipping. Migrated to NetSuite for real-time inventory across warehouses, B2B + B2C unified. **Bailey Hydraulics** uses Financials + Inventory + Order Mgmt + CRM + Manufacturing + SCM, B2B/B2C storefront tied directly into NetSuite. ([protelo case study](https://www.proteloinc.com/industries/wholesale-distribution/customer-success-story-west-coast-differentials))

#### 4. QuickBooks Commerce (formerly TradeGecko)

- **Status**: **Sunset August 31, 2023** as a standalone product. Intuit folded basic inventory into QuickBooks Online but dropped the standalone B2B portal, advanced inventory rules, and Zoho integration. As of 2026 the wholesale-specific module is **not available**. ([Unleashed](https://www.unleashedsoftware.com/blog/quickbooks-commerce-sunset/), [Inflow](https://www.inflowinventory.com/blog/quickbooks-commerce-sunset/), [MRPeasy](https://www.mrpeasy.com/blog/tradegecko-sunset/))
- **What TradeGecko shipped that's now gone**:
  - Branded B2B sales portal (customer-specific pricing, login-gated catalog)
  - Multi-warehouse stock + automatic stock reservations
  - Quote → Sales Order → Pick → Invoice pipeline
  - Customer-specific price lists with currency conversion
- **Replacement landscape**: Migrated users mostly went to **Cin7 Core** (similar feature set, $349/mo) or **Unleashed** ($410/mo+). Some chose **MRPeasy**, **Inflow**, **Brightpearl**, **Uphance** (apparel-specific).
- **Implication for SanoPOS**: There's a documented base of TradeGecko refugees still looking for a home — under-served especially on the apparel and FMCG side.

### Tier B

#### 5. Zoho Inventory / Zoho Books

- **Pricing**: Zoho Commerce Standard $15/mo → Premium $109/mo (annual billing). Premium tier is built for B2B with complex needs. ([getapp](https://www.getapp.com/website-ecommerce-software/a/zoho-commerce/), [swell](https://www.swell.is/content/zoho-commerce-pricing))
- **Wholesale features**: Customer-specific pricing, credit limits, RFQ, account-based experience, price lists for B2B tiers. Available on Professional+ plans.
- **Strengths**: Tight integration with Zoho Books (accounting), Zoho CRM, Zoho One bundle pricing. Pakistan-friendly multi-currency.
- **Gaps**: No native field-rep / van-sales app. EDI requires Zoho Flow + custom connectors.
- **Implication**: Zoho is the price-pressure floor — a 5-user PK wholesaler can run Zoho Inventory + Books for under $100/mo.

#### 6. Odoo

- **Pricing**: Community edition **free** (self-host). Standard $24.90/user/mo annual, Custom ~$46.80/user/mo. Implementation $20K–$50K+. ([erpresearch](https://www.erpresearch.com/en-us/odoo-erp-overview), [odoo](https://www.odoo.com/pricing))
- **Wholesale features**: Pricelists (multi-tier, customer-specific, quantity-break), credit limits with hard-block/warn config, sales order workflow (quote → SO → delivery → invoice), portal access, multi-warehouse with routing rules, MOQ enforcement, UOM categories with conversion factors, **e-commerce B2B portal with assortments + individual discount rules per dealer**. ([ventor.tech](https://ventor.tech/industries/distribution/odoo-for-wholesale-and-retail-distribution/))
- **Things we hadn't considered**:
  - **Procurement rules** linking sales orders to auto-PO creation (drop-ship + reorder).
  - **Bill of Materials / kit pricing** at the wholesale tier (relevant if SanoPOS targets manufacturers-selling-to-retailers).
  - **Mobile barcode workflows** for high-SKU picking.
- **Gaps**: Heavy implementation; self-host adds infra burden.

#### 7. BigCommerce B2B Edition

- **Pricing**: **Enterprise plan only**, BigCommerce doesn't publish prices but partner-reported is **$1,000–$1,500/mo+**. Standard ($29/mo) caps at $50K annual sales, Plus $79 caps at $180K, Pro $299 caps at $400K — none have native B2B. ([wizcommerce](https://wizcommerce.com/blog/bigcommerce-pricing/), [bettercommerce](https://www.bettercommerce.io/blog/bigcommerce-b2b-edition-review))
- **Wholesale feature set** (vendor categorization): Buyer portal with custom catalogs, price lists, **RFQ (Request for Quote) with seller modify/approve**, **Net 5/15/30/45/60 terms**, **multi-role permission tree (Junior Buyer / Senior Approver)**, reordering tools, quote-to-order conversion. ([BigCommerce B2B Edition](https://www.bigcommerce.com/solutions/b2b-ecommerce-platform/))
- **Things we hadn't considered**:
  - **Net 5 / Net 15** as standard terms options (we'd assumed Net-30/45/COD).
  - **Junior Buyer vs Senior Approver role split** as a first-class concept.
  - **RFQ → quote → order** workflow as separate from "place order" — buyers can request pricing before committing.
- **Gaps**: Tied to BigCommerce storefront; no field-rep app; no EDI native.

#### 8. Cin7 Core (formerly DEAR Systems)

- **Pricing**: 3 editions, **$349/mo to $999/mo**. B2B portal **included in every plan**, not an add-on. Cin7 Omni jumps to $799+/mo. ([cin7](https://www.cin7.com/pricing/), [g2](https://www.g2.com/products/cin7-core/pricing))
- **Wholesale feature set**: Branded B2B portal, real-time stock visibility, customer-specific pricing, **orders can be configured as authorized sales OR orders OR invoices**, payment via credit card / ACH / digital wallets / **BNPL**, **invite-only or guest-browse modes**, price tiers + quantity breaks sync automatically. ([Cin7 B2B](https://www.cin7.com/features/sales/b2b-online-stores/))
- **Things we hadn't considered**:
  - **Authorize-as-order-vs-invoice** at the portal level — a buyer's submission can flow as "approved sale", "order needing manual review", or "invoice immediately" depending on rules. This is the **order-vs-invoice distinction** we glossed over.
  - **BNPL on B2B** — not just Net-30 but actual Buy Now Pay Later from finance partners.
  - **Guest browse** — let unknown buyers see catalog (with or without pricing) to drive lead capture.
- **Customer story**: Strong on apparel/CPG mid-market. Bundled with SparkLayer for Shopify storefronts. ([sparklayer](https://www.sparklayer.io/partners-dear-systems/))

#### 9. Katana Cloud Inventory

- **Pricing**: Essential $179/mo, Advanced $359/mo, Enterprise $799+/mo. ([brahmin-solutions](https://www.brahmin-solutions.com/blog/katana-pricing))
- **Wholesale features**: Centralized B2B + B2C + Shopify + Amazon order routing on shared inventory, lot/serial tracking, PO management, production planning (it's an MRP first). No dedicated B2B portal — relies on Shopify B2B or SparkLayer for buyer-facing.
- **Verdict**: Manufacturer-first, weak as a standalone wholesaler tool. Not a primary SanoPOS competitor.

#### 10. Unleashed Software

- **Pricing**: **Essentials $410/mo (3 users)**, scales by user count to Large Plus (20 users). **B2B eCommerce module $129/mo add-on** for 250 customers / 500 products, $199/mo unlimited. Other add-ons: WMS $149/mo, CRM $429/mo, Production $69/mo. ([G2 reviews](https://www.g2.com/products/unleashed/reviews), [getapp](https://www.getapp.com/operations-management-software/a/unleashed/))
- **Wholesale features**: Customer pricing, quantity price breaks, sell-price tiers auto-sync to B2B store, reorder previous orders, real-time stock visibility, favorites lists per customer. Sales order → quote → pick → ship → backorder allocations integrated to purchasing.
- **Things we hadn't considered**:
  - **Customer favorites list** — per-buyer saved SKUs as a UX feature.
  - **Reorder-previous-order** as a one-click action (huge for repeat wholesale buyers).

### Tier C — Pakistan / regional

#### 11. SAMS Online (Pakistan, FMCG-first)

- **Positioning**: "Pakistan's #1 cloud distribution software", **1,500+ distributors**. ([sams.solutions](https://www.sams.solutions/))
- **Core modules**: Real-time sales tracking, **PJP-based order booking** (Permanent Journey Plan = scheduled retailer-visit routes for field reps), automated inventory & accounting, secondary sales tracking, deliveries, dispatches, returns, claims, **schemes/discounts auto-applied at order entry**.
- **Mobile app**: Android Order Booker app — selfie attendance, GPS location, beat plan navigation.
- **Pricing**: Not published publicly; targeted at FMCG manufacturers / importers / distributors.

#### 12. SalesFlo (Karachi, founded 2015)

- **Positioning**: Sales & distribution SaaS, connects retailers ↔ manufacturers/wholesalers/distributors. Used by Fortune 500 in PK. ([salesflo.com](https://www.salesflo.com/), [crunchbase](https://www.crunchbase.com/organization/salesflo))
- **Strengths**: B2B marketplace + DMS hybrid. Order placement from retailer end, fulfillment from distributor end.

#### 13. Smart Distribution (smartdistribution.pk)

- FMCG / pharma / beverage distributors. Order management, inventory, accounting, **schemes/discounts**, **GST + withholding tax**, Android order-booking app with live location. ([smartdistribution.pk](https://smartdistribution.pk/))

#### 14. Moneypex Distribution ERP

- **Positioning**: 100% FBR-compliant. Automates **secondary sales**, optimizes **beat routes**, distributor + wholesale + retail combined. ([moneypex.com](https://moneypex.com/pk/distribution))

#### 15. DigitalManager

- Offices in Lahore, Islamabad, Karachi, Faisalabad. Modules for wholesale, retail, manufacturing. FBR Digital Invoicing built-in. ([digitalmanager.pk](https://www.digitalmanager.pk/fbr-pos-integration-software/))

#### 16. OptiPOS

- "Free Starter plan" — micro-business angle. Kiryana / dukaan / restaurant / pharmacy / **wholesale**. FBR integration included. ([optiwebopz.com](https://optiwebopz.com/optipos/))

#### 17. Marg ERP (India, big in PK pharma)

- Pharma, FMCG, footwear, mobile, electronics, textile, import/export distribution.
- **Notable features**: **MargPay** for digital collection with bill-by-bill reconciliation & same-day settlement, **ERP-to-ERP ordering** (retailer's ERP places order directly into distributor's ERP). ([margcompusoft.com](https://margcompusoft.com/marg-price-list.html))
- **Things we hadn't considered**:
  - **ERP-to-ERP ordering** — eliminates manual rekeying when both sides are on Marg. EDI for the SMB segment.

#### 18. BUSY / TallyPrime

- Heavy in PK for accounting + retail/wholesale billing. Tally dominant. Less feature-rich on portal / mobile rep apps; chosen mostly for tax-compliance + accounting reliability. ([techjockey](https://www.techjockey.com/compare/busy-accounting-software-vs-margerp-9-vs-tally-erp-9))

---

## Cross-cutting feature analysis

| Feature | Shopify B2B | Square | NetSuite | Zoho | Odoo | BigCom B2B | Cin7 | Unleashed | SAMS/PK | SanoPOS today |
|---|---|---|---|---|---|---|---|---|---|---|
| Customer-specific catalogs | ✓ (3 non-Plus / ∞ Plus) | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✗ |
| Quantity / volume price breaks | ✓ (10 per variant) | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Customer credit limit enforcement | partial (terms) | ✗ | ✓ | ✓ | ✓ (hard/soft) | ✓ | ✓ | ✓ | ✓ | ✗ |
| AR aging report (0-30/30-60/60-90/90+) | ✗ native | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Customer statements (PDF/auto-email) | ✗ | ✗ | ✓ | ✓ | ✓ | partial | ✓ | ✓ | ✓ | ✗ |
| Net-30 / Net-45 / COD payment terms | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ (Net 5/15/30/45/60) | ✓ | ✓ | ✓ | ✗ |
| Multi-UOM (case/carton/each) | partial | ✗ | ✓ (4 levels + factors) | ✓ | ✓ (categorized) | ✓ | ✓ | ✓ | ✓ | partial |
| MOQ / case-pack enforcement | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Sales order distinct from sale (commit stock, ship later) | partial | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Backorder / partial fulfillment | partial | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Quote / RFQ workflow | via apps | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✗ |
| Tiered / contract pricing | ✓ | ✗ | ✓ (matrix) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial |
| Self-service customer portal | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✓ |
| Dunning sequences | ✗ native | ✗ | ✓ | ✓ | ✓ | partial | partial | ✓ | partial | ✗ |
| Tax exemption per customer | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial |
| Drop-ship / consignment | partial | ✗ | ✓ | ✓ | ✓ | partial | ✓ | ✓ | partial | ✗ |
| Field sales rep mobile app (offline + GPS) | ✗ | ✗ | via SuiteApps | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ (PJP) | ✗ |
| **Company hierarchy + buyer roles + spend limits** | ✓ | ✗ | ✓ | partial | ✓ | ✓ (junior/senior) | partial | partial | ✗ | ✗ |
| **Approval workflow (over threshold)** | partial | ✗ | ✓ | partial | ✓ | ✓ | partial | partial | ✗ | ✗ |
| **EDI 850/856/810 native or partner** | partner | ✗ | ✓ partner | partial | partial | partner | partial | partial | ✗ | ✗ |
| **Deposits / partial payment on order** | Plus only | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | partial | ✗ |
| **Vaulted card auto-charge on due date** | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| **Multi-warehouse fulfillment routing rules** | partial | ✗ | ✓ | ✓ | ✓ | partial | ✓ | ✓ | ✓ | partial |
| **Grid ordering (multi-variant single screen)** | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | partial | partial | ✗ | ✗ |
| **Punchout catalogs (Coupa/Ariba)** | ✗ | ✗ | ✓ | ✗ | partial | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Reorder previous order (1-click)** | ✓ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| **Favorites list per buyer** | ✗ | ✗ | ✓ | partial | partial | ✓ | partial | ✓ | partial | ✗ |
| **Schemes (slab/free-goods) auto-applied at order entry** | partial | ✗ | partial | partial | ✓ | partial | partial | partial | ✓ | partial |
| **Secondary sales tracking** (manufacturer view of distributor's onward sales) | ✗ | ✗ | ✓ | ✗ | partial | ✗ | ✗ | ✗ | ✓ | ✗ |
| **PJP / beat plan / van sales routing** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ |
| **FBR Digital Invoicing on B2B invoices** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

Legend: ✓ native, partial = via add-on / app / requires config, ✗ = not available.

---

## What we MISSED in our internal scoping

Ranked by importance. Each item below was in our original list as either absent or under-specified.

### Critical gaps (every Tier-A platform has this)

1. **Company hierarchy with multi-role buyer accounts + per-buyer spend limits**
   - A wholesale "customer" is rarely one person. It's a company with: Org Admin (manages users/billing), Buyer (places orders), Approver (signs off above threshold), Accountant (sees invoices), Read-only Analyst. ([spreecommerce](https://spreecommerce.org/b2b-ecommerce-buyer-organizations-permissions/), [commercetools](https://commercetools.com/blog/b2b-product-spotlight-a-beginners-guide-to-buyer-approval-flows))
   - **Spending limits per buyer**: per order, per week, per quarter, per year.
   - **Multi-level parent → regional office → local site** structures (matters for chain retailers with 50 outlets ordering centrally).
   - **Approval flows tied to order value**: <$1K auto, $1–5K manager, >$5K director, >$10K all + CFO.
   - We had "credit limits at customer level" but not buyer-level / role-based.

2. **Quote → Sales Order → Pick → Pack → Ship → Invoice as DISTINCT stages with separate documents**
   - We listed "sales order workflow" generically. The market treats these as five separate documents with their own status, audit trail, and reversal paths.
   - **Stock reservation happens at SO confirmation**, not invoice. Stock decrement happens at **pick** (or in stricter setups, at **ship**).
   - **Invoice creation happens at ship-confirm** — not before. ([NetSuite docs](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1230081.html))
   - We need to decide: do we model these as five tables/states or collapse some?

3. **Quote / RFQ workflow with seller modify + approve**
   - Buyer requests pricing on a basket → seller reviews → adjusts price/qty/terms → sends back → buyer accepts → converts to order. ([BigCommerce](https://www.bigcommerce.com/solutions/b2b-ecommerce-platform/))
   - Critical for high-ticket / project-based / negotiated wholesale.
   - We had nothing on this.

4. **EDI 850/856/810** for chain-store buyers
   - 850 = PO from buyer, 855 = PO ack, 856 = Advance Ship Notice, 810 = Invoice, 846 = Inventory advice, 214 = Shipping status. ([orderful](https://www.orderful.com/blog/edi-integration-with-netsuite-guide))
   - Doesn't matter for kiryana but the day SanoPOS gets one wholesaler selling to Metro / Imtiaz / Carrefour / Hyperstar, they'll be asked for EDI. Architect with partner-integration hooks now.

5. **Vaulted payment methods + auto-charge on Net-term due date**
   - Buyer saves a card; system charges automatically on Day 30. Eliminates 80% of the dunning workflow. ([Shopify](https://www.shopify.com/news/b2b-for-all))
   - We had "Net-30/45/COD" but nothing about how the charge actually happens.

6. **Deposits and partial payment capture at order time**
   - Custom-order wholesale (apparel preorders, made-to-order furniture) requires 30%/50% deposit at order confirmation. Plus-tier Shopify feature.
   - We had nothing on this.

### High-value gaps (Tier-B and Pakistan-incumbents have this)

7. **PJP / Beat Plan / Van Sales / Order Booker workflow**
   - This is the **#1 PK distinction**. Every PK FMCG/pharma distributor's reps run a daily PJP — visit retailer A at 9am, retailer B at 10am, etc. The order booker app needs: route preload, GPS check-in with selfie attendance, last-order recall per retailer, scheme display, instant order capture with offline-resilience, end-of-day reconciliation.
   - Global platforms have none of this. PK incumbents (SAMS, SalesFlo, FieldAssist, BeatRoute) all do.

8. **Schemes / slab discounts / free-goods auto-applied at order entry**
   - PK FMCG runs on schemes: "Buy 10 cartons of Tapal Danedar, get 1 carton free" or "≥50 cases this month → 3% rebate".
   - This is not the same as our existing "promotions" — wholesale schemes are slab-based, time-bound, frequently retrospective (rebate accrued, paid quarterly).
   - **Retrospective rebate accrual** is a category we missed entirely.

9. **Secondary sales tracking** (manufacturer's view into distributor's onward sales to retailers)
   - Manufacturer sells to distributor (primary). Distributor sells to retailer (secondary). The manufacturer wants real-time visibility into secondary numbers — that's how schemes get earned.
   - SAMS, SalesFlo, FieldAssist all do this. Global platforms do not. Big PK differentiator.

10. **Order booker schemes vs. invoice schemes**
    - Schemes can be at quote/order time (rep shows buyer at point of order) vs at invoice time (retrospectively applied). Both have to be modeled.

11. **Grid ordering (apparel size run / variant matrix)**
    - One screen showing 5 sizes × 4 colors with qty boxes — submit one order. Massive UX win for apparel/footwear/textile wholesale (which is huge in PK).

12. **Reorder-previous-order + per-buyer favorites list**
    - Two simple UX features that every B2B portal has. We didn't list them.

13. **Authorize-as-order-vs-invoice rules at portal**
    - Cin7 lets a portal submission flow as "authorized sale" or "order needing review" or "invoice immediately" based on rules. We modeled "place order" as one thing.

14. **Punchout catalogs**
    - Only matters for enterprise / institutional buyers (govt, hospital chains, NGOs). Defer but acknowledge.

15. **Customer-specific currency** + **ERP-to-ERP ordering** (Marg's feature)
    - PK distributors selling regionally / to AKU hospital / to govt may need PKR vs USD pricing per customer.

### Smaller gaps

16. **Net 5 / Net 15 as standard terms** (not just 30/45/COD).
17. **Soft vs hard credit-limit override** with manager approval audit trail.
18. **Drop-ship-from-supplier-to-customer** flow (supplier ships directly, distributor never touches stock, but invoices customer).
19. **Consignment stock** (stock at customer location, billed on sell-through).
20. **Customer-specific catalog visibility** — some SKUs hidden from some buyers entirely (not just priced differently — completely invisible).
21. **Bulk CSV order upload** at the portal (buyer pastes 200-row order from their own ERP).
22. **Real-time stock visibility per warehouse** to the buyer ("36 in Karachi, 12 in Lahore, 0 in Multan").
23. **BNPL on B2B** — third-party finance partners (Cin7 ships this; not core but a 2027 idea).
24. **Customer aging buckets configurable** — 0-30/31-60/61-90/90+ is convention, but some PK distributors run 0-15/16-30/31-45/46+ (weekly cycles).

---

## Pakistan / local market notes

### Who's actually in market

| Tool | Focus | Mobile order booker | FBR DI | PJP / Beat |
|---|---|---|---|---|
| SAMS Online | FMCG (1,500+ distributors) | ✓ Android | ✓ | ✓ |
| Smart Distribution | FMCG / pharma / beverage | ✓ Android, GPS | ✓ | ✓ |
| SalesFlo | Marketplace + DMS hybrid | ✓ | ✓ | ✓ |
| Moneypex Distribution | General wholesale + retail | ✓ | ✓ | ✓ |
| DigitalManager | Multi-industry (Lhr/Khi/Isb/Fsd) | ✓ | ✓ | partial |
| OptiPOS | Micro biz, free starter | ✓ | ✓ | ✗ |
| Marg ERP (India) | Pharma + multi-industry | ✓ | partial (GST-first) | ✓ |
| TallyPrime | Accounting + billing (PK general) | partial | ✗ | ✗ |
| BUSY | Accounting + retail/wholesale | ✗ | ✗ | ✗ |

### What PK wholesalers complain about (from secondary research + community signals)

- **FBR Digital Invoicing flakiness** at scale (queue retries, IRN mismatches) — most local DMS only bolt on FBR, they don't manage the queue well. **SanoPOS already has FBR queue + retry + dashboard** (per CLAUDE.md, migration v9, `routes/fbr.js`) — this is a moat in PK that global tools cannot match.
- **Sync between order booker app and back-office** breaks frequently (offline order capture not properly reconciled, duplicate orders).
- **Scheme engine inflexibility** — every brand wants its own scheme structure, generic tools can't keep up.
- **Reconciliation between primary (factory→distributor) and secondary (distributor→retailer) sales** is manual / Excel-driven for many wholesalers.
- **No good B2B portal in Urdu** for retailer-facing self-service (most order bookers are sales-rep-only).
- **Mobile data costs and patchy 3G/4G coverage** in upcountry beats — offline-first is non-negotiable. ([Pakistan distribution context, trade.gov](https://www.trade.gov/country-commercial-guides/pakistan-distribution-and-sales-channels))

### What PK gets that the global stack ignores

- **Beat / PJP scheduling at the rep level**, with attendance + selfie + GPS.
- **Schemes engine** with slab, free-goods, multi-condition (brand + SKU + qty + period).
- **Secondary sales rollups** by territory / brand / SKU.
- **FBR Digital Invoicing** end-to-end (not just a bolt-on report).
- **Cash-on-delivery + cash collection from retailers** with rep-level reconciliation (most retailers in PK still pay rep in cash at the door).

---

## Sources

### Shopify B2B
- [Shopify — B2B for All (April 2026)](https://www.shopify.com/news/b2b-for-all)
- [Shopify Opens Native B2B to Every Paid Plan in April 2026 (novadata)](https://novadata.io/resources/news/shopify-b2b-all-plans-april-2026)
- [The Definitive Guide to Shopify B2B & Wholesale 2026 (Shero)](https://sherocommerce.com/blogs/insights/shopify-b2b-guide)
- [Shopify Plus B2B 2026 Architecture Playbook (revize)](https://www.revize.app/blog/shopify-b2b-2026-complete-guide)
- [Complete Guide to B2B Commerce on Shopify Plus 2026 (coderapper)](https://coderapper.com/article/shopify/the-complete-guide-to-b2b-commerce-on-shopify-plus-in-2026/)
- [Shopify Help — Catalogs and Pricing in B2B](https://help.shopify.com/en/manual/b2b/catalogs)
- [Shopify Help — Quantity Rules + Volume Pricing](https://help.shopify.com/en/manual/b2b/catalogs/quantity-pricing)
- [Shopify Help — Markets B2B Catalogs](https://help.shopify.com/en/manual/b2b/markets/catalogs)
- [Shopify B2B Pricing Guide (Kensium)](https://www.kensium.com/blog/shopify-b2b-pricing-guide)

### Square
- [Square Community — B2B Wholesale Portal feature request](https://community.squareup.com/t5/Feature-Requests/B2B-Wholesale-Ordering-Portal/idi-p/825780)

### NetSuite
- [NetSuite SuiteCommerce for Wholesale Distributors 2026 (anchorgroup)](https://www.anchorgroup.tech/blog/netsuite-suitecommerce-wholesale-distributors)
- [NetSuite SuiteCommerce Pricing 2026 (folio3)](https://netsuite.folio3.com/blog/netsuite-suitecommerce-pricing/)
- [NetSuite B2B Portal Options 2026 (brokenrubik)](https://www.brokenrubik.com/blog/netsuite-b2b-portal-options-guide)
- [NetSuite Pricing 2026 (brokenrubik)](https://www.brokenrubik.com/blog/netsuite-pricing-the-definitive-guide)
- [Set Up B2B Functionality on SuiteCommerce (developers.suitecommerce.com)](https://developers.suitecommerce.com/b2b-functionality.html)
- [Pick, Pack, and Ship Workflow Charts (Oracle docs)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1230081.html)
- [West Coast Differentials case study (Protelo)](https://www.proteloinc.com/industries/wholesale-distribution/customer-success-story-west-coast-differentials)
- [NetSuite Wholesale Distribution ERP (folio3)](https://netsuite.folio3.com/services/netsuite-wholesale-distribution-erp/)

### QuickBooks Commerce / TradeGecko
- [QuickBooks Commerce Sunset (Unleashed)](https://www.unleashedsoftware.com/blog/quickbooks-commerce-sunset/)
- [What the QuickBooks Commerce Sunset Means (Inflow)](https://www.inflowinventory.com/blog/quickbooks-commerce-sunset/)
- [QB Commerce Sunset and What You Can Do (MRPeasy)](https://www.mrpeasy.com/blog/tradegecko-sunset/)
- [Best TradeGecko Alternatives 2026 (Growmax)](https://www.growmax.io/comparisons/tradegecko-alternatives)
- [Software4Business — TradeGecko is dead](https://software4business.com.au/migrate-your-tradegecko-data-for-free/)

### Zoho
- [Zoho Commerce Pricing 2026 (GetApp)](https://www.getapp.com/website-ecommerce-software/a/zoho-commerce/)
- [Zoho Commerce Pricing 2026 (Swell)](https://www.swell.is/content/zoho-commerce-pricing)
- [Zoho Inventory Pricing Comparison (Zoho)](https://www.zoho.com/us/inventory/pricing-comparison/)

### Odoo
- [Odoo ERP Review 2026 (ERP Research)](https://www.erpresearch.com/en-us/odoo-erp-overview)
- [Odoo Pricing](https://www.odoo.com/pricing)
- [Odoo for Wholesale & Retail Distribution (Ventor Tech)](https://ventor.tech/industries/distribution/odoo-for-wholesale-and-retail-distribution/)

### BigCommerce
- [BigCommerce B2B Edition](https://www.bigcommerce.com/solutions/b2b-ecommerce-platform/)
- [BigCommerce B2B Edition Deep Dive (Tavano)](https://tavanoteam.com/bigcommerce/bigcommerce-b2b-edition-features-and-benefits-deep-dive/)
- [BigCommerce B2B Edition Review (BetterCommerce)](https://www.bettercommerce.io/blog/bigcommerce-b2b-edition-review)
- [BigCommerce Pricing 2026 (WizCommerce)](https://wizcommerce.com/blog/bigcommerce-pricing/)
- [BigCommerce Pricing 2026 (Elogic)](https://elogic.co/blog/bigcommerce-pricing/)

### Cin7
- [Cin7 B2B Online Stores](https://www.cin7.com/features/sales/b2b-online-stores/)
- [Cin7 Pricing](https://www.cin7.com/pricing/)
- [Cin7 Core B2B Portal Help](https://help.core.cin7.com/hc/en-us/articles/9034604614543-Using-the-B2B-Portal)
- [Cin7 Core B2B Portal Settings](https://help.core.cin7.com/hc/en-us/articles/10553627040655-B2B-portal-settings)
- [SparkLayer + Cin7 partnership](https://www.sparklayer.io/partners-dear-systems/)

### Katana
- [Katana Cloud Inventory (GetApp)](https://www.getapp.com/industries-software/a/katana-mrp/)
- [Katana Pricing 2026 (Brahmin Solutions)](https://www.brahmin-solutions.com/blog/katana-pricing)

### Unleashed
- [Unleashed Pricing & Features (GetApp)](https://www.getapp.com/operations-management-software/a/unleashed/)
- [Unleashed Reviews (G2)](https://www.g2.com/products/unleashed/reviews)
- [Unleashed B2B Pricing Tiers Sync (support)](https://support.unleashedsoftware.com/hc/en-us/articles/40452064514969-Are-Customer-Pricing-and-Quantity-Price-Breaks-applied-to-B2B-Stores)

### EDI
- [Integrating EDI with Shopify/BigCommerce/D2C (BOLD VAN)](https://www.boldvan.com/blog/integrating-edi-with-shopify-bigcommerce-and-d2c-channels-a-practical-guide-for-manufacturers)
- [EDI Integration with NetSuite for Wholesale (StackSync)](https://www.stacksync.com/blog/edi-integration-netsuite-wholesale-distributors)
- [NetSuite EDI Integration Guide (Orderful)](https://www.orderful.com/blog/edi-integration-with-netsuite-guide)
- [Shopify EDI Integration 2026 (Crstl)](https://www.crstl.ai/blog/shopify-edi-integration)

### UOM
- [Multi-UoM ERP for Cash & Carry (Ximple)](https://www.ximplesolution.com/industries/cash-and-carry-distribution-software/multi-unit-of-measure-erp/)
- [How UOMs Work in ERP (SYSPRO)](https://eu.syspro.com/blog/owning-or-running-erp/how-do-units-of-measure-uom-work-within-an-erp-system/)

### Multi-warehouse + OMS
- [Order Management System Routing Logic Guide (winsbs)](https://wiki.winsbs.com/oms/)
- [Distributed Order Management at Scale (Logiwa)](https://www.logiwa.com/blog/distributed-order-management)
- [How a Distribution ERP Supports Multi-warehouse (Bizowie)](https://bizowie.com/how-a-distribution-erp-supports-multi-warehouse-multi-location-operations)

### Company hierarchy + approvals
- [B2B Buyer Organizations & Permissions (Spree)](https://spreecommerce.org/b2b-ecommerce-buyer-organizations-permissions/)
- [B2B Approval Flows Beginner Guide (commercetools)](https://commercetools.com/blog/b2b-product-spotlight-a-beginners-guide-to-buyer-approval-flows)
- [Company Accounts & Approval Workflows (i95dev)](https://www.i95dev.com/b2b-company-accounts-workflows-approval/)

### Credit & AR
- [Best Credit Management Software for B2B 2026 (CreditPulse)](https://www.creditpulse.com/credit-management-software)
- [B2B Credit Check Automation (Resolve)](https://resolvepay.com/blog/post/credit-check-automation/)
- [Online Credit Management Software (Esker)](https://www.esker.com/business-process-solutions/order-to-cash/accounts-receivable-management-software/credit-management/)

### Field sales / van sales / PJP
- [Delta Sales Field Sales Mgmt App](https://play.google.com/store/apps/details?id=com.deltatechnepal.delta_sales_app&hl=en_US)
- [inSitu Mobile Field Sales App](https://www.insitusales.com/en/solutions/field-sales-app/)
- [SPOTIO Best Apps for Field Sales Reps](https://spotio.com/blog/best-apps-for-sales-reps/)
- [Onsight B2B ordering app for distributors](https://www.onsightapp.com/)
- [Cloudfy B2B Sales Rep App](https://cloudfy.com/platform/products/b2b-sales-rep-app/)
- [PepUpSales Field Sales App](https://www.pepupsales.com/field-sales-app.php)
- [FieldAssist AI-led DMS](https://www.fieldassist.com/)
- [BeatRoute DMS](https://beatroute.io/distributor-management-system/)

### Pakistan
- [SAMS Online — FMCG Distribution Software Pakistan](https://www.sams.solutions/)
- [SAMS Online — DMS for FMCG](https://www.sams.solutions/distributor-management-system-fmcg)
- [SalesFlo](https://www.salesflo.com/)
- [SalesFlo on Crunchbase](https://www.crunchbase.com/organization/salesflo)
- [Smart Distribution PK](https://smartdistribution.pk/)
- [Moneypex Distribution ERP Pakistan](https://moneypex.com/pk/distribution)
- [DigitalManager FBR POS](https://www.digitalmanager.pk/fbr-pos-integration-software/)
- [OptiPOS Pakistan](https://optiwebopz.com/optipos/)
- [Eyecon FBR Integrated POS](https://eyeconconsultant.com/fbr-integrated-pos-software/)
- [PointOfSale.pk — Retail POS Software](https://www.pointofsale.pk/solutions/retail-pos-software/)
- [OneClick POS Pakistan](https://oneclickpos.pk/fbr-integrated-systems/top-fbr-approved-pos-software/)
- [Bazaar — Endeavor Pakistan profile](https://pakistan.endeavor.org/profiles/profile-one/)
- [Markaz wholesale marketplace PK](https://www.markaz.app/blog-post/5-pakistani-tech-startups-that-will-change-the-ecommerce-landscape)
- [Pakistan Distribution & Sales Channels (trade.gov)](https://www.trade.gov/country-commercial-guides/pakistan-distribution-and-sales-channels)
- [Profit by Pakistan Today — retail supply chain](https://profit.pakistantoday.com.pk/2020/06/28/the-retail-supply-chain-has-to-change-can-tech-pull-it-off/)

### Marg / Tally / BUSY
- [Marg ERP Price List](https://margcompusoft.com/marg-price-list.html)
- [Marg ERP Wholesale Distribution](https://margngp.com/wholesales.html)
- [Marg ERP 9 Guide (Bsoft)](https://bsoft.co.in/marg-erp-9-software-guide-pricing-features-benefits-explained/)
- [Compare BUSY vs Marg vs Tally (Techjockey)](https://www.techjockey.com/compare/busy-accounting-software-vs-margerp-9-vs-tally-erp-9)
- [Tally vs Marg (PenielTech)](https://www.penieltech.com/blog/tally-vs-marg-2023-latest-update/)

### Backorder / fulfillment / commission
- [Brightpearl Shipping & Fulfillment](https://www.brightpearl.com/shipping-fulfillment-software)
- [SimplyDepo B2B Order Management for Distributors](https://simplydepo.com/b2b-order-management-software/)
- [Wholesale Distribution Software Drives Efficiency (ADS Solutions)](https://www.adssolutions.com/blog/wholesale-distribution-software-streamlines-inventory-orders-sales/)
- [Logistics Sales Commission Structures 2026 (Everstage)](https://www.everstage.com/sales-commission/logistics-sales-commission-structure)
- [B2B Sales Commission Structures (Fullcast)](https://www.fullcast.com/content/b2b-sales-commission-structure/)
