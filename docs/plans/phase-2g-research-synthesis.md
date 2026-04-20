# Phase 2-G — Research Synthesis & Scope Candidates

> **Date:** 2026-04-20
> **Purpose:** One-doc index and actionable ranked list pulling across all four Phase 2-G research docs. This is the doc to come back to — the others are raw intel.
> **Status:** Research Track 1 complete. Track 2 (code audit) and Track 3 (live tenant reality check) pending.

## How to use this doc

This is the **decision doc** for Phase 2-G scope. When you return to retail work in weeks or months, read this first. It has:

- What each source doc contains and when to open it
- The 10-point strategic read that cuts across all four
- A ranked list of Phase 2-G scope candidates (must / should / maybe / defer)
- The open questions that Track 2 and Track 3 must answer before writing the plan

If anything here contradicts a raw doc, the raw doc wins — update this one.

---

## Source docs (what lives where)

| Doc | Purpose | Open when you need… |
|---|---|---|
| [phase-2g-retail-competitive-audit.md](phase-2g-retail-competitive-audit.md) | First-pass 4-competitor matrix. Tier-1 / Tier-2 feature tables, hardware baseline, pricing table. | Quick answer to "does competitor X ship feature Y, at which tier." |
| [phase-2g-shopify-deep-dive.md](phase-2g-shopify-deep-dive.md) | Shopify POS Lite + Pro, screen-by-screen. Stocky shutdown, POS Go sunset, modifier gap, Android lag. | UX detail for Shopify screens. Stocky-replacement positioning. |
| [phase-2g-square-retail-deep-dive.md](phase-2g-square-retail-deep-dive.md) | Square Free / Plus / Premium incl. Oct 2025 unified-plans restructure. Omni-input, bulk-scan, gift card fee. | Square screen detail. Legacy vs unified pricing math. Loyalty $45 upsell. |
| [phase-2g-lightspeed-clover-deep-dive.md](phase-2g-lightspeed-clover-deep-dive.md) | Lightspeed X-Series (Core / Standard / Advanced), Clover Retail, Toast Retail (N/A). | Matrix variant grid reference. B2B price books. Clover hardware-lock-in counter-positioning. |

---

## The 10-point strategic read (what the research tells us)

1. **No retail POS shell gap.** Unlike restaurant (which needed a table-first `/pos/restaurant`), every mature retail POS uses the same cart+search+sidebar layout SanoPOS already ships. **Verdict: no new route. Enhance `/pos` in place.**

2. **But the *input primitive* is wrong.** Square, Shopify, Lightspeed all ship a single auto-focused omni-input at the top of checkout that pattern-routes (barcode → scan lookup, text → product search, PLU prefix → direct add). SanoPOS has a scan field but lacks primacy. This is the retail equivalent of the 2-R.0 shell insight — smaller scope, same category of "you didn't realize you were missing the foundation."

3. **Stocky shutdown = 4-month time-boxed wedge.** Shopify is killing Stocky Aug 31, 2026 (already delisted Feb 2). Merchants are actively shopping for inventory-planning replacements right now. If SanoPOS ships a Stocky-equivalent back-office hub in Phase 2-G, "Stocky replacement" becomes a concrete sales angle. Miss the window, and third parties fill it.

4. **Square's pricing math changed in Oct 2025.** Retail Plus/Premium as standalone SKUs is effectively dead for new sellers — unified plans now. Legacy merchants at $89/$165 are grandfathered. Any SanoPOS "beats Square" claim must target the **~$144/loc/mo unified-plan loaded cost**, not the old $89 headline.

5. **Lightspeed's real moat = two things.** Matrix variant grid + retail-depth ops (PO/GRN/transfers + GMROI/sell-through). Neutralize those two and Lightspeed's pricing premium ($119–$187 all-in) has no cover.

6. **Clover is distribution, not product.** Hardware-locked + bank-contract-locked + hidden fees. Heavy negative reviews. Churned-Clover merchants are a gettable segment. SanoPOS positioning counter: BYOH + transparent pricing. Not a scope input — a **landing-page message**.

7. **Toast Retail = N/A.** 2024 beta disappeared. Don't spend cycles. If a cafe-plus-merch preset is wanted, cover it via the preset engine.

8. **Competitors miss five whole verticals natively:** pharmacy, auto parts, jewelry with serial tracking, grocery with weight, and rentals at POS level. Every one is a SanoPOS preset opportunity **later** (Phase 3+), not Phase 2-G. Phase 2-G is about making *general retail* feel mature enough that these verticals can be built on top without reworking foundations.

9. **UX patterns to steal (confirmed across ≥2 competitors):**
    - Omni-input as hero (Square + Shopify + Lightspeed)
    - Bulk-scan toggle (Square)
    - Phone-first customer attach (Square)
    - Per-line "Restock" toggle on returns (Square)
    - Manager-PIN inline approval (Shopify + Square)
    - Receipt-barcode → one-scan return lookup (Shopify + Lightspeed)
    - Exchange as distinct flow from return+new-sale (all three)
    - Smart Grid / Quick Actions configurable per-device (Shopify + Square)
    - CFD-side prompts for loyalty opt-in + email receipt (Square)
    - Tender hotkeys 1–5 on Charge screen (Square)
    - Training role (Shopify) — staff can practice without touching real data

10. **UX patterns to reject (confirmed anti-patterns):**
    - Flat variant list for apparel (all three) → build matrix grid
    - Store credit = gift card conflation (Square) → ledger-backed separate tenders
    - 72-hour offline card-risk window (Square) → local-authoritative capture, no pre-auth risk
    - Loyalty as $45/mo upsell (Square) → basic earn+redeem in base, monetize advanced
    - 2.5% gift-card load fee (Square) → 0% across all tiers
    - Lite-to-Pro $89 cliff (Shopify) → granular middle tier
    - No modifiers engine (Shopify) → SanoPOS already has it from Phase 2-R, surprise advantage
    - Label printing desktop-only (Shopify) → mobile-native
    - No native scale integration (Shopify) → native
    - Android parity lag (Shopify) → ship simultaneously
    - 40-checkbox role UI (Shopify) → keep structured role templates

---

## Full pattern inventory (~50 items)

The 10-point read above is the entry point. This section is the **complete inventory** of decision-shaping items across all 4 raw docs — grouped by category. Use it as a checklist when finalizing Phase 2-G scope, when writing positioning / landing-page copy, or when someone asks "did we consider X from competitor Y?"

Each item carries a source pointer. Raw doc sections override this list if they disagree.

### UX patterns worth stealing (confirmed across ≥1 competitor)

1. **Omni-input hero field** — auto-focus, pattern-routed scan/SKU/text/PLU. All three Tier-1. [square §1](phase-2g-square-retail-deep-dive.md) [shopify §1.2](phase-2g-shopify-deep-dive.md)
2. **Bulk-scan toggle** — repeated scans increment qty on existing row. Square; Shopify lacks it. [square §10#2](phase-2g-square-retail-deep-dive.md)
3. **Phone-first customer attach** — last-4 fuzzy match + inline "Create new" = <4s. Drives Square Loyalty adoption. [square §10#3](phase-2g-square-retail-deep-dive.md)
4. **Reason-coded returns as mandatory dropdown** — not free-text. Feeds defective-rate analytics. [square §10#4](phase-2g-square-retail-deep-dive.md)
5. **Per-line Restock toggle on returns** — staff controls whether item re-enters sellable. [square §10#5](phase-2g-square-retail-deep-dive.md)
6. **Manager-PIN inline approval** — any gated action pops PIN prompt with both users logged. [shopify §8#4](phase-2g-shopify-deep-dive.md) [square §1](phase-2g-square-retail-deep-dive.md)
7. **Receipt-barcode → one-scan return lookup** — receipt IS the lookup key. [shopify §10#5](phase-2g-shopify-deep-dive.md)
8. **Exchange as distinct first-class flow** — net-positive/negative computed, store credit flows either way. All three. [shopify §10#6](phase-2g-shopify-deep-dive.md)
9. **Unverified returns with role-gated approval** — structured "no receipt" path with auto store-credit refund. [shopify §10#7](phase-2g-shopify-deep-dive.md)
10. **Per-device Quick Grids / Smart Grid** — one register "Returns desk", another "Floor". Per-device is enough; per-employee over-engineers. [shopify §10#2](phase-2g-shopify-deep-dive.md) [square §10#9](phase-2g-square-retail-deep-dive.md)
11. **Smart Grid templates pushed from admin** — chain configures once, deploys to N locations. Multi-tenant infrastructure. [shopify §10#2](phase-2g-shopify-deep-dive.md)
12. **Training role** — blocks real transactions. Elegantly solves "let new hire practice" without a sandbox. [shopify §10#3](phase-2g-shopify-deep-dive.md)
13. **CFD-side prompts** — star rating + loyalty opt-in + email receipt happen on customer screen. Seller keeps momentum. [square §10#6](phase-2g-square-retail-deep-dive.md)
14. **Tender hotkeys 1–5** on Charge screen. 10-key cashier never touches the screen. [square §10#10](phase-2g-square-retail-deep-dive.md)
15. **Save sale for holds** — any active cart saves with a name, resumes on any register. Simpler than full parked-sales. [square §10#8](phase-2g-square-retail-deep-dive.md)
16. **Multi-select → Print labels as catalog action** — no separate label queue app. [square §10#7](phase-2g-square-retail-deep-dive.md)
17. **POS UI Extensions: one tile per extension** — prevents Smart Grid tile sprawl from third parties. [shopify §10#8](phase-2g-shopify-deep-dive.md)
18. **Role-level "actions requiring manager approval" flat checklist** — not nested permissions. Easier for non-technical owners. [shopify §10#10](phase-2g-shopify-deep-dive.md)
19. **Unified store credit wallet visible at cart-attach** — usable in exchanges either direction. [shopify §10#9](phase-2g-shopify-deep-dive.md)
20. **Auto-focus return to scan field after every ticket close** — micro-detail, big cumulative time save. [square §1](phase-2g-square-retail-deep-dive.md)
21. **Inline serial entry in cart row** (not modal) — Lightspeed's apparel/electronics pattern. [lightspeed §1.4](phase-2g-lightspeed-clover-deep-dive.md)
22. **Matrix variant grid modal** (size × color × width) — Lightspeed's defensible moat for apparel/footwear. [lightspeed §1.3](phase-2g-lightspeed-clover-deep-dive.md)

### Anti-patterns to reject (confirmed mistakes in competitors)

23. **Flat variant list for apparel** (all three) → matrix grid
24. **Store credit conflated with gift cards** (Square) → ledger-backed distinct tenders
25. **72-hour offline card-risk window** (Square, $100 default cap) → local-authoritative capture, no pre-auth risk [square §1.8](phase-2g-square-retail-deep-dive.md)
26. **Rigid label templates — 6 presets forced** (Square) → minimal visual designer (drag-drop → ZPL/TSPL) [square §11#4](phase-2g-square-retail-deep-dive.md)
27. **Role UI as 40-checkbox dump** (Shopify) → structured role templates as forkable defaults [square §11#5](phase-2g-square-retail-deep-dive.md)
28. **Loyalty as $45/mo upsell** (Square) → basic earn+redeem in base, monetize advanced [square §11#6](phase-2g-square-retail-deep-dive.md)
29. **No serial numbers at all** (Square) → end-to-end is a verticals wedge [square §11#7](phase-2g-square-retail-deep-dive.md)
30. **2.5% gift-card load fee** (Square) → 0% across all tiers; penalizes own ecosystem [square §11#8](phase-2g-square-retail-deep-dive.md)
31. **Web-only catalog bulk ops** (Square) → on-device back-office is a selling point for store managers without a PC [square §11#9](phase-2g-square-retail-deep-dive.md)
32. **Automated account freezes** (Square risk-scoring) → SanoPay positioning opportunity; don't replicate [square §11#10](phase-2g-square-retail-deep-dive.md)
33. **Lite-to-Pro $89 cliff** (Shopify) → granular middle tier, feature-by-feature toggles [shopify §9#1](phase-2g-shopify-deep-dive.md)
34. **No modifiers engine** (Shopify, for a decade) → SanoPOS has it from 2-R, surprise advantage for configurable retail products [shopify §9#2](phase-2g-shopify-deep-dive.md)
35. **Label printing desktop-only** (Shopify) → mobile-native printing [shopify §9#3](phase-2g-shopify-deep-dive.md)
36. **No native scale integration** (Shopify) → native CAS/Mettler/generic-HID [shopify §9#4](phase-2g-shopify-deep-dive.md)
37. **Android feature parity lag** (Shopify) → ship simultaneous — matters for Pakistan/LATAM [shopify §9#5](phase-2g-shopify-deep-dive.md)
38. **Informed-only cash close** (Shopify) → real blind-close mode where staff can't see expected total [shopify §9#6](phase-2g-shopify-deep-dive.md)
39. **Attach-rate report gated at Advanced $299/mo** (Shopify) → include in base retail reports [shopify §9#7](phase-2g-shopify-deep-dive.md)
40. **Vertical exclusion by default** (Shopify punts pharmacy/auto/grocery to apps) → preset engine owns verticals, doesn't outsource [shopify §9#8](phase-2g-shopify-deep-dive.md)
41. **Hardware lock-in to payments** (Shopify Payments required for POS Go) → keep payment rails open [shopify §9#9](phase-2g-shopify-deep-dive.md)
42. **Sunsetting Stocky without full native replacement** → absorb natively (velocity reorder + safety stock + lead times) [shopify §9#10](phase-2g-shopify-deep-dive.md)
43. **No sample-data / demo tenant mode on signup** (Shopify) → one-click "fill with demo data" [shopify §9#11](phase-2g-shopify-deep-dive.md)
44. **Smart Grid per-location not per-role** (Shopify) → per-role tile filtering to hide sensitive actions [shopify §9#12](phase-2g-shopify-deep-dive.md)
45. **Partial refunds cannot happen offline** (Shopify) → queue locally, sync on reconnect [shopify §9#13](phase-2g-shopify-deep-dive.md)
46. **Custom sale as generic free-text** (Shopify) → attach to default tax class + category for clean FBR/VAT [shopify §9#14](phase-2g-shopify-deep-dive.md)
47. **Clover app-market fragmentation** → bundle core retail features, no nickel-and-diming [lightspeed §4.3](phase-2g-lightspeed-clover-deep-dive.md)
48. **Clover hardware + contract lock-in** → explicit BYOH pitch on landing page [lightspeed §4.3](phase-2g-lightspeed-clover-deep-dive.md)

### Pricing & packaging intel (sharpens positioning)

49. **Square unified plans restructure (Oct 2025)** — Plus/Premium standalone dead for new sellers; legacy grandfathered at $89/$165. SanoPOS comparisons target unified loaded cost ~$144/loc/mo. [square §7](phase-2g-square-retail-deep-dive.md)
50. **Stocky shutdown Aug 31, 2026** (delisted Feb 2 already) — 4-month wedge for "Stocky replacement" messaging. [shopify §2.2](phase-2g-shopify-deep-dive.md)
51. **POS Go sunset post-Sep 2026** to customer-display-only — Shopify's retail hardware story in flux. [shopify §4.1](phase-2g-shopify-deep-dive.md)
52. **Shopify B2B requires Shopify Plus at $2,300/mo** — price books in SanoPOS base plan is a massive wedge. [competitive-audit §C#4](phase-2g-retail-competitive-audit.md)
53. **Square Premium-only features** (exchange, customer groups, smart forecasting, ship-from-store, basket analysis) — "SanoPOS includes in base what Square charges $165/mo for" positioning. [square §3](phase-2g-square-retail-deep-dive.md)
54. **Full-featured competitor costs:** Loyverse ~$49, Shopify POS Pro ~$128, Square Plus ~$170 / Premium ~$245, Lightspeed ~$187. SanoPOS sweet spot = $49–$128. [competitive-audit §F](phase-2g-retail-competitive-audit.md)
55. **Square Loyalty $45/loc/mo separate SKU** — phone-first enrollment, 3 tiers on Plus+, Apple Wallet pass. SanoPOS should bundle basic tier. [square §9](phase-2g-square-retail-deep-dive.md)
56. **Lightspeed à la carte pattern** — Loyalty $39, Accounting $29, Analytics+ $39 all separate. Modular but expensive full stack. [lightspeed §1.1](phase-2g-lightspeed-clover-deep-dive.md)
57. **Attach rate not native anywhere** — basic retail KPI behind $299/mo Shopify Advanced. [shopify §3.6](phase-2g-shopify-deep-dive.md)

### Hardware realities

58. **Pakistan label printers = Zebra + TSC**, Dymo uncommon. TSPL language support matters, not just ZPL/EPL. [competitive-audit §open Q5](phase-2g-retail-competitive-audit.md)
59. **Square's only certified scale = Brecknell 6710U** — weak for grocery/butcher. SanoPOS native CAS PD-II / Mettler Ariva support is a wedge. [square §5](phase-2g-square-retail-deep-dive.md)
60. **Shopify POS on Android lags iOS** for partial payments + some hardware. Matters for EM deployments. [shopify §3.10](phase-2g-shopify-deep-dive.md)
61. **Square Handheld launched May 2025** ($399) — new retail-floor story replacing aging Register. Thin field data yet. [square §5](phase-2g-square-retail-deep-dive.md)
62. **Clover forces Fiserv processor** — merchants penalized for leaving. SanoPOS open-rails positioning counter. [lightspeed §2.5](phase-2g-lightspeed-clover-deep-dive.md)
63. **Shopify Hardware Store 2026 pricing flagged for verification** — prices shift. [shopify §4](phase-2g-shopify-deep-dive.md)
64. **Certified scanner overlap:** Socket S700, Zebra DS2208, Honeywell Voyager 1450g appear across all three Tier-1. Target these for SanoPOS certification docs. [competitive-audit §E](phase-2g-retail-competitive-audit.md)

### Strategic framing & GTM (not scope but affects positioning)

65. **Churned-Clover merchants as distinct target segment** — distribution-locked, hidden-fee-burnt, actively leaving. Different GTM than Shopify refugees. [lightspeed §4.2](phase-2g-lightspeed-clover-deep-dive.md)
66. **Shopify Stocky refugees as time-boxed segment** — 4-month window Apr–Aug 2026. Direct-outbound opportunity. [shopify §2.2](phase-2g-shopify-deep-dive.md)
67. **Verticals no Tier-1 competitor serves natively** — pharmacy, auto parts, jewelry-with-serials, grocery-with-weight, rentals-at-POS. Each is a SanoPOS Phase 3 preset opportunity. **Not Phase 2-G.** [all docs]
68. **Lightspeed's dedicated vertical products** (Bike, Jewelry, Golf) — each defensible. Argues SanoPOS should deepen per-vertical presets rather than stay at `general_retail`. [lightspeed §1.11](phase-2g-lightspeed-clover-deep-dive.md)
69. **Clover moat = distribution not product.** Can't out-distribute a 5000-branch bank footprint. Target the actively-evaluating, not the bank-walked-in. [lightspeed §4.2](phase-2g-lightspeed-clover-deep-dive.md)
70. **Lightspeed moat = 2 things only** (matrix grid + retail-ops depth). Neutralize both, pricing premium has no cover. [lightspeed §4.1](phase-2g-lightspeed-clover-deep-dive.md)
71. **Toast Retail = N/A.** 2024 beta disappeared; only retail-items-in-restaurant-mode for cafes. Skip entirely. [lightspeed §3](phase-2g-lightspeed-clover-deep-dive.md)

### Reports shipped (baseline competitors)

72. **Sell-through rate** — Square Premium, Stocky, Lightspeed Standard. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
73. **GMROI** — Square Premium, Stocky, Lightspeed Advanced. Merchandise planner's key metric. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
74. **Inventory aging ($ by age)** — Square Premium, Stocky, Lightspeed Standard. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
75. **Dead stock (no sales >N days)** — Square Plus, Stocky, Lightspeed. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
76. **Basket analysis / affinity** — Square Premium, Lightspeed Advanced; not in Shopify base. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
77. **Sales per hour (SPH) per employee** — Square Plus, Shopify with Team, Lightspeed. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
78. **Shrinkage variance (count vs system)** — Square Plus, Stocky, Lightspeed. [competitive-audit §D](phase-2g-retail-competitive-audit.md)
79. **ABC analysis (80/20 Pareto)** — Stocky + Lightspeed Advanced; Square has export-only workaround. [competitive-audit §D](phase-2g-retail-competitive-audit.md)

### Onboarding / first-run patterns

80. **Shopify time-to-first-sale** via guided onboarding — [shopify §7.1](phase-2g-shopify-deep-dive.md) (flagged for verify)
81. **Square in-app tutorials + tooltips** — [square §8](phase-2g-square-retail-deep-dive.md)
82. **Shopify data import from CSV** — [shopify §7.3](phase-2g-shopify-deep-dive.md)
83. **Square demo mode** — limited; opportunity for SanoPOS to ship richer sandbox.

---

**Total: ~80 decision-shaping items across 4 raw docs.** The 10-point strategic read compresses these into the most-likely-to-reshape-scope takeaways. Treat the inventory above as the complete checklist.

---

## Phase 2-G scope candidates — ranked

Each item carries: **name**, **why**, **source evidence**, **rough data-model impact**, **unknowns that Track 2/3 must resolve**.

### TIER A — MUST include (foundational or time-boxed)

**A1. Omni-input primitive on `/pos`**
- Why: Retail's foundational UX gap. All three Tier-1 competitors ship it. Scan/SKU/text/PLU in one auto-focused field, pattern-routed.
- Source: [competitive-audit §A](phase-2g-retail-competitive-audit.md) · [square §1 "Checkout screen"](phase-2g-square-retail-deep-dive.md) · [shopify §1.2](phase-2g-shopify-deep-dive.md)
- Data-model impact: none. Frontend component + pattern router only.
- Track 2/3 must answer: does current `/pos` search field already have auto-focus? What's the barcode-pattern detection in use today?

**A2. Gift cards as first-class tender**
- Why: Table-stakes at Square, Shopify, Lightspeed. SanoPOS endpoints exist in `barcode-expenses.js` but are **orphaned** — not wired to `sales.js` checkout.
- Source: [competitive-audit §B#2](phase-2g-retail-competitive-audit.md) · [square §10 "Unified wallet"](phase-2g-square-retail-deep-dive.md)
- Data-model impact: `gift_cards` table exists. Wire into `sale_payments` as tender type. Split-tender + balance check UI.
- Track 2 must answer: what fields/columns exist vs need adding? Is there already a `sale_payments.gift_card_id` FK?

**A3. Store credit as first-class tender (distinct from gift cards)**
- Why: Ledger-backed tender — not a balance field on customer, not conflated with gift cards (Square's mistake). Used as return destination and as checkout tender.
- Source: [square §11 "Patterns to reject"](phase-2g-square-retail-deep-dive.md) · [lightspeed §1.6 store credit](phase-2g-lightspeed-clover-deep-dive.md)
- Data-model impact: new `store_credit_ledger` table (customer_id, delta, reason, ref_sale_id, balance_after). Tender code in `sale_payments`. Refund-to-store-credit option on returns.
- Track 2 must answer: is there a `customer_wallet` already? If so, should store credit ride on wallet or be separate? (Accounting implications.)

**A4. Exchange as distinct flow from return**
- Why: Every competitor separates it. One screen, even-swap or delta charge, keeps customer + loyalty intact.
- Source: [competitive-audit §B#4](phase-2g-retail-competitive-audit.md) · [shopify §1.6](phase-2g-shopify-deep-dive.md) · [square §1 "Returns"](phase-2g-square-retail-deep-dive.md)
- Data-model impact: sale flag `is_exchange` + `original_sale_id` + `delta_payment`. Not a compound transaction.
- Track 2 must answer: does `returns.js` already support "exchange" semantic or only refund? How does existing parked-sale flow handle partial items?

**A5. Manager price override with PIN at POS**
- Why: Column exists, no UI. Blocks any retailer doing price-match or customer negotiation.
- Source: [competitive-audit §B#1](phase-2g-retail-competitive-audit.md) · [shopify §2.1 staff roles](phase-2g-shopify-deep-dive.md)
- Data-model impact: none (column exists). UI + permission check.
- Track 2 must answer: which column holds the override value? Is there an audit trail field for who approved?

**A6. Inventory-intelligence hub (Stocky-equivalent)** — time-boxed wedge
- Why: Stocky shuts Aug 31, 2026. 4-month window to pitch "Stocky replacement." Demand forecasting, reorder-point suggestions, cycle counts, ABC analysis — grouped at `/retail/inventory-intelligence`, not scattered.
- Source: [shopify §2.2 Stocky sunsetting](phase-2g-shopify-deep-dive.md) · [lightspeed §1.8 reports](phase-2g-lightspeed-clover-deep-dive.md) · [competitive-audit §D](phase-2g-retail-competitive-audit.md)
- Data-model impact: several. `reorder_suggestions` (derived), `cycle_count_sessions`, `abc_classification` (derived). Some can be materialized views.
- Track 2 must answer: which pieces already exist in reports/? Is there inventory_reconciliation that already covers cycle counts (one-shot, not scheduled)?
- Track 3 must answer: are any current SanoPOS tenants Shopify-Stocky-refugees? This is the sharpest test of time-boxed wedge value.

### TIER B — SHOULD include (table-stakes with clear evidence)

**B1. Matrix variant grid modal (size × color)**
- Why: Lightspeed's moat. Apparel/footwear tenants can't operate without it. Tier-2 differentiator but required for any clothing retailer.
- Source: [lightspeed §1.3](phase-2g-lightspeed-clover-deep-dive.md) · [competitive-audit §C#2](phase-2g-retail-competitive-audit.md)
- Data-model impact: none (variants exist). New UI component only.
- Track 3 must answer: **Do current retail tenants actually use the variant picker?** If near-zero, this is build-for-future not fix-for-now — de-prioritize.

**B2. Label printing template designer**
- Why: Square, Shopify, Lightspeed all ship visual designers. SanoPOS has batch-driven barcode print, not template-driven.
- Source: [competitive-audit §B#5](phase-2g-retail-competitive-audit.md) · [shopify §3.5 label gap](phase-2g-shopify-deep-dive.md) · [square §11 rigid labels](phase-2g-square-retail-deep-dive.md)
- Data-model impact: `label_templates` table (name, fields, size, printer_language).
- Track 3 must answer: **Dymo or Zebra or TSC?** Pakistan uses Zebra + TSC (TSPL language) typically. Dymo is uncommon. Affects printer language support scope.

**B3. Loyalty earn + redeem at POS**
- Why: Tiers exist in schema. No operational earn/redeem. Square charges $45/mo for this — SanoPOS should include basic tier in base.
- Source: [competitive-audit §B#10](phase-2g-retail-competitive-audit.md) · [square §9 loyalty](phase-2g-square-retail-deep-dive.md)
- Data-model impact: `loyalty_points_ledger` (earn events from sales, redemption events against sales). Integration with customer attach at checkout.
- Track 2 must answer: does any current schema already capture points on sale completion? Are tiers purely schema or partially wired?

**B4. Customer-group price books**
- Why: Lightspeed's "price books" is cleanest reference. Customer groups exist with discount%; group → price-tier mapping doesn't. B2B/staff/member pricing is broken today.
- Source: [lightspeed §1.6 B2B](phase-2g-lightspeed-clover-deep-dive.md) · [competitive-audit §B#14](phase-2g-retail-competitive-audit.md)
- Data-model impact: `price_books` (group_id, product_id, price). Price resolution in POS: product price → group override → promotion.
- Track 2 must answer: does `customer_groups.discount_percent` auto-apply at checkout today? (If yes, price-books is an upgrade; if no, even the basic group discount isn't wired.)

**B5. Serialized inventory end-to-end**
- Why: Electronics/appliance/watch/firearm verticals make POS decisions on this single feature. SanoPOS has `product_serial_numbers` but it's not stamped on `sale_items` at checkout.
- Source: [lightspeed §1.4](phase-2g-lightspeed-clover-deep-dive.md) · [square §11 no serials](phase-2g-square-retail-deep-dive.md)
- Data-model impact: `sale_item_serials` bridge. Warranty dates on products. Return-by-serial lookup.
- Track 2 must answer: what's in `product_serial_numbers` already? How does receive-with-serial work today in GRN?

**B6. Bulk-scan toggle on receiving + sales**
- Why: Square's killer time-saver. Repeated scan = increment qty on same line. Huge for high-velocity retail + PO receiving.
- Source: [square §10#2 bulk-scan](phase-2g-square-retail-deep-dive.md)
- Data-model impact: none. UI toggle only.

**B7. Per-line Restock toggle on returns + reason codes**
- Why: Square pattern. Staff controls whether item re-enters sellable. Reason codes feed defective-rate analytics.
- Source: [square §10 "Reason-coded returns"](phase-2g-square-retail-deep-dive.md)
- Data-model impact: `return_items.restock_flag` + `return_items.reason_code`. Reason code lookup table.

### TIER C — MAYBE include (high value, but fits better in Phase 3 or needs Track 3)

**C1. Layaway / hold / special-order with deposit schedule**
- Why: Lightspeed moat. But in Pakistan "qist" is Easypaisa/JazzCash wallet-driven, not formal layaway.
- Decision rule: **Track 3 must answer whether Pakistan tenants need this.** If the qist-via-wallet pattern is the reality, a simple "wallet deposit + partial sale flag" covers 95%. Skip full layaway module.
- Source: [competitive-audit §B#6](phase-2g-retail-competitive-audit.md) · [lightspeed §1.5](phase-2g-lightspeed-clover-deep-dive.md)

**C2. Cycle counts (scheduled, zone-based)**
- Why: Included in Square Premium and Lightspeed Standard. SanoPOS has one-shot inventory_reconciliation.
- Could roll into A6 (inventory-intelligence hub) or defer.
- Source: [competitive-audit §B#8](phase-2g-retail-competitive-audit.md)

**C3. Receipt-barcode → one-scan return lookup**
- Why: Shopify + Square both ship. Receipt prints barcode, scan → auto-load items.
- Data-model impact: receipt already has invoice number; barcode encoding + scan parser on return screen.
- Source: [shopify §10#5](phase-2g-shopify-deep-dive.md)

**C4. Staff commissions (per product / per category / tiered)**
- Why: Lightspeed native. Square Team Plus $35/mo. Jewelry/apparel/electronics retailers pay commission.
- SanoPOS already has commissions from Phase 2-R tips module — may extend rather than build fresh.
- Track 3 must answer: do any current retail tenants pay commission? If no, defer.

**C5. Training role**
- Why: Shopify's elegant solve for "let a new hire practice." Role that blocks real transactions.
- Data-model impact: permission flag. Small build, high UX value.
- Source: [shopify §8#3](phase-2g-shopify-deep-dive.md)

**C6. GMROI / sell-through / inventory aging reports**
- Why: Lightspeed moat. Stocky-equivalent to Shopify merchants.
- Could roll into A6 (inventory-intelligence hub) — don't double-count.

### TIER D — DEFER to later phases

- **Endless aisle / BOPIS / ship-from-store** — requires eCom integration depth. Phase 3+.
- **Native scale integration with CAS/Mettler** — belongs with fresh-goods vertical work (Phase 3.4 butcher/sweet/ice). Generic retail doesn't need it.
- **Customer-facing display** — nice-to-have, not parity-breaker.
- **Smart reorder forecasting with ML** — can start with simple velocity-based (A6) and defer ML.
- **ABC analysis report** — same; include in A6 as simple Pareto, no ML.
- **Vertical-specific presets** (pharmacy, jewelry, eyewear, auto parts, furniture) — explicit Phase 3 territory. **Do not try to solve in Phase 2-G.**

---

## What Track 2 (code audit) must resolve

For each Tier A and Tier B item, answer:

1. What schema exists (columns, tables, constraints)?
2. What endpoints exist (mounted route, permission, tenant-scoped)?
3. What UI exists (page/component, feature-flag gate)?
4. What's the gap type: **fully missing** / **schema-ready no UI** / **orphaned endpoints** / **partial working**?
5. Rough effort estimate per item (days of implementation).

Focus Track 2 on:
- A2 gift cards (orphaned endpoints — need full wire-in scope)
- A3 store credit (separate from wallet or ride on it?)
- A4 exchange (does returns.js already support it?)
- A5 price override (which column? audit trail?)
- A6 inventory-intelligence (what's already in reports/ vs missing?)
- B3 loyalty (how much is already wired?)
- B4 price books (does group discount auto-apply today?)
- B5 serials (what's in product_serial_numbers, how does GRN use it?)

## What Track 3 (live tenant reality) must resolve

- **Variant picker usage** — if near-zero, de-prioritize B1 matrix grid.
- **Layaway demand in Pakistan** — if qist-via-wallet is the pattern, skip C1.
- **Gift cards physical or digital?** — affects A2 scope. Digital-only = 70% of build for 95% of value.
- **Label printer models installed** — Zebra/TSC dominate Pakistan, not Dymo. TSPL language support scope for B2.
- **Stocky refugees** — any current tenants coming off Shopify Stocky? Validates A6 time-boxed wedge.
- **Commission retailers** — any current tenants pay retail commission? If no, C4 defers.

---

## Ballpark scope & sequencing (for later planning, not committed)

If Tier A + Tier B all ship, rough sequencing:

- **Foundation pass (wk 1-2):** A1 omni-input, A5 price override, A2 gift cards wire-in, A3 store credit
- **Returns overhaul (wk 3):** A4 exchange flow, B7 restock/reason codes, C3 receipt-scan lookup
- **Inventory intelligence (wk 4-6):** A6 hub incl. cycle counts, velocity-based reorder, ABC
- **Retail ops (wk 7-8):** B3 loyalty at POS, B4 price books, B5 serials, B6 bulk-scan
- **Polish (wk 9):** B2 label template designer, Tier C items picked based on Track 3

≈ 9 working weeks if all Tier A+B ship. Final scope and sequence after Tracks 2 and 3.

---

## Next steps

1. **Track 2** — code audit against this ranked list. Deliver as [phase-2g-code-audit.md](phase-2g-code-audit.md).
2. **Track 3** — live tenant reality check. Deliver as [phase-2g-tenant-reality.md](phase-2g-tenant-reality.md).
3. **Write Phase 2-G** in the maturity roadmap, using this doc + Track 2 + Track 3 as inputs. Structure mirrors Phase 2-R (numbered items, critical files, verification demo, explicit "what this does NOT do").
