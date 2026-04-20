# Phase 2-G — Retail Competitive Audit
**Date:** 2026-04-20
**Purpose:** Competitive baseline for SanoPOS Phase 2-G General Retail Tier-1 Parity
**Competitors audited:** Square for Retail, Shopify POS Pro, Lightspeed Retail, Loyverse

---

## Executive Summary

Retail does **not** need a new POS shell the way restaurants did. Every mature retail POS (Square Retail, Shopify POS Pro, Lightspeed, Loyverse) uses essentially the same cart+search+sidebar layout SanoPOS already ships; there is no "table-first" equivalent gap. **The foundational gap is not layout — it is the *scan-first input primitive*.** Square Retail, Shopify POS Pro, and Lightspeed all open the POS with the barcode field auto-focused, treat keyboard/scanner input as default (tile grid is secondary), and collapse SKU search + scan + manual PLU into one unified omni-input.

The second structural insight: competitors bifurcate "POS" from "back office." Inventory forecasting, PO receiving, label printing, matrix variants, and cycle counts live in a dedicated back-office route, not on the POS screen. SanoPOS should keep `/pos` lean and invest in a `/retail` back-office hub (analogous to the restaurant floor plan being separate from POS).

---

## A — POS Shell / Foundational UX

**Verdict: No shell refactor needed. But the checkout input primitive must change.**

### Evidence per competitor

- **Square for Retail (Plus/Premium):** POS opens with cursor auto-focused in a unified field labeled "Search by item name, SKU, or scan barcode." Quick-action tile grid is a secondary/collapsible panel. Checkout differs from base Square POS in three ways: (1) barcode field is hero; (2) "Add custom amount" is demoted; (3) right rail shows customer + loyalty attach prominently. Square markets Retail as "built for scanning."
- **Shopify POS Pro:** Ships **Smart Grid** — tiles user-configurable per terminal (staff favorites, quick discounts, custom tiles). Top bar is always a cart + search combo where scanner input routes by pattern (UPC → SKU lookup; text → product search).
- **Lightspeed Retail (Standard+):** Most retail-specific UI. Adding a variant parent surfaces a **matrix grid modal** (size × color) inline. Serial # and custom-order fields appear in the cart row, not a secondary modal.
- **Loyverse:** Classic tile grid + search; no barcode-first focus, no matrix UI. The budget-tier baseline and closest to SanoPOS today.

### What this means for SanoPOS

- No `/pos/retail` separate route needed.
- `/pos` should add: **omni-input at the top** (replaces the current product search sidebar as primary input); **variant matrix modal** for apparel/footwear tenants; **inline serial entry** in the cart row; **configurable tile grid as a secondary panel** (matching Shopify Smart Grid — per-terminal favorites stored in `pos_quick_keys`).
- Fast SKU entry: all four competitors support scan + SKU type-ahead + tile tap in one field. Primary is the auto-focused scan field. SanoPOS already has a scan field; the gap is **primacy** (focus, keyboard routing, barcode-pattern detection) not existence.

---

## B — Tier-1 Table-Stakes Matrix

Legend: ✅ included · 💰 paid add-on · ❌ not available · ⚠️ partial/limited

| # | Feature | Square Retail Plus ($89) | Shopify POS Pro ($89) | Lightspeed Standard (~$119) | Loyverse (Free + add-ons) |
|---|---|---|---|---|---|
| 1 | Manager price override w/ PIN | ✅ | ✅ | ✅ | ⚠️ PIN exists, override audit only in paid Employee Mgmt ($5/emp/mo) |
| 2 | Gift cards (issue/redeem/balance/split) | ✅ (eGift + plastic) | ✅ | ✅ | ❌ 3rd-party only |
| 3 | Store credit tender | ✅ | ⚠️ via Shopify customer accounts; not POS-native until POS Pro 2025 update | ✅ | ❌ |
| 4 | Exchange flow (even swap, delta charge) | ✅ Premium only ($165); Plus = return+new sale | ✅ | ✅ best-in-class, one screen | ❌ |
| 5 | Barcode label printing w/ templates | ✅ Dymo, Zebra ZD410/420 certified + designer | 💰 Retail Barcode Labels app (free, Pro only) | ✅ Zebra, Dymo, UPC/SKU/custom designer | 💰 Advanced Inventory add-on ($25/loc/mo) |
| 6 | Layaway / hold / special order | ⚠️ "Save sale" = hold; no payment schedule | ⚠️ Draft orders; no deposit schedule | ✅ full layaway + special order w/ deposit | ⚠️ open tickets only |
| 7 | Serialized inventory (IMEI, warranty, RMA) | ❌ SKU-level only | 💰 3rd-party apps (QuickSerials etc.) | ✅ native serial + warranty dates | ❌ |
| 8 | Cycle counts (scheduled, zone-based) | ⚠️ Plus = basic; zone/scheduled = Premium | 💰 Stocky app (free w/ Pro) — partial/zone counts | ✅ full scheduled cycle counts | 💰 Advanced Inventory |
| 9 | Quick keys / PLU tiles per terminal | ✅ | ✅ Smart Grid per-device | ✅ | ✅ |
| 10 | Loyalty earn+redeem at POS | 💰 Square Loyalty $45/loc/mo | ✅ via Shopify (POS Pro required) | 💰 Lightspeed Loyalty $39/loc/mo | ✅ basic + 💰 Loyverse Loyalty app |
| 11 | Multi-location real-time stock + transfer suggest | ✅ real-time; suggestion = Premium | ✅ transfers native; suggestions via Stocky | ✅ | ⚠️ stock visible; suggestions = Advanced Inv |
| 12 | PO partial receiving + landed cost | ✅ partial; landed cost = Premium | 💰 Stocky (free w/ Pro) does both | ✅ both native | 💰 Advanced Inventory |
| 13 | Negative-stock prevent + auto-reorder | ✅ | ✅ via Stocky | ✅ | 💰 Advanced Inventory |
| 14 | Customer-group auto-discount | ⚠️ customer-specific only; groups = Premium | ✅ via customer tags + Shopify automatic discounts | ✅ price books per customer type | ❌ |
| 15 | Returns w/ receipt lookup (scan → auto-load) | ✅ | ✅ | ✅ | ⚠️ manual lookup only |

**Key insight for Phase 2-G:** SanoPOS is at parity on #1, #9, #12 (partial), #15. Must-close gaps: **#2 gift cards, #3 store credit, #4 exchange, #5 label templates, #7 serials, #10 loyalty at POS, #14 customer-group pricing.**

---

## C — Tier-2 Differentiators Matrix

| # | Feature | Square Retail | Shopify POS Pro | Lightspeed Retail | Loyverse |
|---|---|---|---|---|---|
| 1 | Smart forecasting / reorder from history | Premium only | ✅ Stocky (free w/ Pro) | ✅ Advanced tier | ❌ |
| 2 | Matrix variant grid UI (size × color) | ⚠️ variants exist, no grid UI | ✅ grid in admin; POS = pill selector | ✅ **best in class** — matrix on POS | ❌ flat variants |
| 3 | Staff commissions (per product/category/tiered) | 💰 Team Plus ($35/loc/mo) | 💰 apps (Commissionly $19–49/mo) | ✅ native Standard+ per employee/line | 💰 Employee Mgmt (basic only) |
| 4 | B2B / wholesale pricing tiers | Premium: customer groups | 💰 Shopify B2B (Plus $2300/mo) or app | ✅ Advanced tier (price books, NET terms, tax exempt) | ❌ |
| 5 | Endless aisle (order from another location) | ✅ Premium | ✅ any-location inventory | ✅ Advanced | ❌ |
| 6 | BOPIS | ✅ (Square Online + Retail) | ✅ best-in-class (native Shopify) | ✅ via eCom bundle | ❌ |
| 7 | Ship-from-store | ✅ Premium | ✅ | ✅ Advanced | ❌ |
| 8 | Scale integration (USB HID, CAS/Mettler) | ⚠️ select certified; tied to Square Stand | ⚠️ limited; USB HID | ✅ CAS PD-II, Mettler Ariva, Bizerba | ⚠️ USB HID only |
| 9 | Customer-facing display (2nd screen) | ✅ Square Register built-in 2nd screen | ✅ iPad customer view | ✅ | ✅ basic mobile CFD |
| 10 | EMV/chip+tap certified reader | ✅ Square Terminal (owned) | ✅ Shopify POS Go + Tap & Chip | ✅ Lightspeed Payments (Ingenico, Verifone) | ⚠️ via SumUp/Zettle partnerships |

---

## D — Retail-Specific Reports

| Report | Square Retail | Shopify POS Pro | Lightspeed Retail | Loyverse |
|---|---|---|---|---|
| Sell-through rate | Premium | ✅ Stocky | ✅ Standard+ | ❌ |
| GMROI | Premium | ✅ Stocky | ✅ Advanced | ❌ |
| Inventory aging ($ by age) | Premium | ✅ Stocky | ✅ Standard+ | 💰 Adv Inv |
| Dead stock (no sales >N days) | Plus | ✅ Stocky | ✅ | 💰 Adv Inv |
| Category performance | ✅ Plus | ✅ | ✅ | ✅ |
| Basket analysis / affinity | Premium | 💰 3rd-party | ✅ Advanced | ❌ |
| Hour-of-day heat map | ✅ Plus | ✅ | ✅ | ✅ |
| Sales per hour (SPH) per employee | ✅ Plus | ✅ with Team | ✅ | 💰 Employee Mgmt |
| Shrinkage variance (count vs system) | ✅ Plus | ✅ Stocky | ✅ | 💰 Adv Inv |
| Gross margin by product/category | ✅ Plus | ✅ | ✅ | ✅ |
| ABC analysis (80/20 Pareto) | ❌ (export workaround) | ✅ Stocky | ✅ Advanced | ❌ |

---

## E — Certified Hardware Baseline

| Category | Square Retail | Shopify POS Pro | Lightspeed Retail | Loyverse |
|---|---|---|---|---|
| **Scanners** | Socket S700/S740, Zebra DS2278, DS8178 | Socket S700/S720/S740/D750, Zebra DS2208 | Honeywell Voyager 1450g/1452g, Zebra DS2208/DS4308, Symbol LS2208 | Socket S700, any USB HID |
| **Label printers** | Dymo 550, Zebra ZD410/ZD420, Brother QL-1110NWB | Dymo 550, Zebra ZD410/ZD420/ZD421 (via Retail Barcode Labels) | Zebra ZD410/ZD420/ZD621, Dymo 450/550 | 💰 Zebra/Dymo via Adv Inv only |
| **Scales** | Brecknell 6710U, CAS PD-II (limited) | Limited — USB HID generic | CAS PD-II, Mettler Ariva S/B, Bizerba | Any USB HID |
| **Card readers** | Square Terminal, Reader (Chip+Tap), Register | Shopify POS Go, Tap & Chip, WisePOS E | Lightspeed Payments (Verifone P400 / Ingenico Lane 3000) | SumUp Air, Zettle Reader 2 |
| **Cash drawers** | APG Vasario 1616/1616A, Star CB-2002, MMF Val-U | APG Vasario, Star mPOP, any RJ11/RJ12 | APG Vasario/Series 100, Star CB-2002 | Any RJ11/RJ12 |
| **Receipt printers** | Star TSP100, Epson TM-m30 (Register built-in) | Star TSP100III, TSP143III, Epson TM-m30II | Star TSP143, Epson TM-T88, Bixolon SRP-350 | Star TSP143, Epson TM-T20/T82 |

*Verify: Lightspeed X-Series (ex-Vend) hardware cert list was harmonized with Lightspeed Retail in 2025; some older Vend-era SKUs may still appear in docs. Square Premium tier may have been restructured late 2025.*

---

## F — Pricing & Packaging Intelligence

### What's behind paywalls (the upsell pattern)

- **Square for Retail:** Free → Plus $89 → Premium $165/loc/mo. Plus unlocks team perms, CoGS, vendor mgmt, barcode labels, unlimited items. Premium unlocks customer groups, exchange flow, smart stock forecasting, advanced reports, basket analysis, ship-from-store. Loyalty is separate $45/loc/mo add-on. *Verify: Square restructured Retail tiers late 2024.*
- **Shopify POS Pro:** $89/loc/mo on top of any Shopify plan ($39 Basic → $399 Advanced → $2300 Plus). POS Pro unlocks unlimited registers, staff roles, Smart Grid, Stocky app (free w/ Pro — the big inventory add-on), BOPIS, ship-from-store, exchanges, store credit. B2B requires Shopify Plus ($2300/mo).
- **Lightspeed Retail:** Lean ~$69, Standard ~$119, Advanced ~$199, Enterprise custom. Loyalty, Accounting, eCom, B2B, Analytics+ are all $39–$59/loc/mo add-ons. Full setup typically $200–$350/loc/mo.
- **Loyverse:** Core POS free forever. Employee Mgmt $5/emp/mo, Advanced Inventory $25/loc/mo, Integrations $9/loc/mo. Full setup $40–$80/loc/mo — the budget option.

### Average "full-featured" cost per location/month

| Competitor | Core | Required add-ons | All-in |
|---|---|---|---|
| Square for Retail | $89 Plus or $165 Premium | +$45 Loyalty, +$35 Team Plus | **~$170 Plus / $245 Premium** |
| Shopify POS Pro | $89 + $39 Basic | $0 (Stocky free) | **~$128** (+ transaction fees) |
| Lightspeed Retail | $119 Standard | +$39 Loyalty, +$29 Accounting | **~$187** |
| Loyverse | $0 | $25 Adv Inv + $5×3 emps + $9 Integrations | **~$49** |

### Free vs paid integration patterns

- **Shopify:** Stocky bundled free with POS Pro — makes POS Pro the best value in mid-tier.
- **Square:** Every advanced feature is either a tier upgrade OR a $35–$45/mo add-on — high per-location total.
- **Lightspeed:** Modular à la carte — cheap entry, expensive full stack.
- **Loyverse:** Budget à la carte — most SanoPOS-competitive on price.

---

## Implications for SanoPOS Phase 2-G

Insights surfaced beyond the initial top-10 gap list:

1. **Omni-input primitive on `/pos`** — single auto-focused field that routes by pattern (UPC/EAN → barcode; text → product search; number prefix → PLU). Not a new page, just a component — the retail equivalent of the 2-R.0 shell insight, smaller scope.
2. **Matrix variant grid modal** — apparel, footwear, and hardware tenants cannot operate without size×color (or size×width) grids. Lightspeed's POS-level matrix is the gold standard; Shopify does it only in admin. SanoPOS's current flat variant picker will feel amateur to apparel tenants on day one.
3. **Gift cards + store credit as first-class tenders** — not reports or CRM features; they are *tender types* that must appear alongside cash/card/wallet in the checkout and split-tender flow. Data model: treat both as ledger-backed tender codes, not balance fields on customer.
4. **Stocky-equivalent back-office hub** — Shopify's biggest value-add in POS Pro is the Stocky bundle (demand forecast, PO suggestions, cycle counts, ABC reports). SanoPOS should group these behind a single `/retail/inventory-intelligence` route rather than sprinkling them across separate pages.
5. **Customer-group pricing tiers (price books)** — SanoPOS has promotions but not per-group base-price tiers. Table-stakes for any tenant doing B2B, staff discounts, or member pricing. Lightspeed's "price books" is the cleanest reference.
6. **Label printing template designer** — Square, Shopify (via Retail Barcode Labels), and Lightspeed all ship a visual template designer for Zebra/Dymo stock. SanoPOS's current barcode-print-job feature is batch-driven, not template-driven. A template designer is Tier-1, not a stretch.
7. **Exchange as a distinct flow from returns** — every competitor separates `exchange` (even swap or delta charge, keeps customer/loyalty intact) from `return + new sale`. SanoPOS should model this as a sale flag with linked original-sale-id + delta payment, not a compound transaction.

---

## Open questions / validation with live tenants

1. **Do existing retail tenants actually use the current variant picker?** If usage is near-zero, the matrix grid may be build-for-future rather than fix-for-now — prioritize accordingly.
2. **Barcode scanner models in the field (Pakistan)** — we assume Zebra DS2208 / Honeywell 1450g are standard; need confirmation. Affects certification/docs.
3. **Is layaway a real demand in Pakistan retail?** Installment ("qist") is culturally common but usually via Easypaisa/JazzCash — may not need full layaway if wallet deposit + partial sale flag covers it.
4. **Gift cards — physical or digital-only?** Physical activation is a full hardware workflow; digital-only is 70% of the build for 95% of the value.
5. **Label printer installed base** — Dymo LabelWriter is uncommon in Pakistan; Zebra and TSC are typical. If tenants already own TSC TE244/TDP-244, we need TSPL language support, not just ZPL/EPL.
