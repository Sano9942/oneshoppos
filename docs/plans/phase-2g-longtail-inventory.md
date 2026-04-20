# Phase 2-G — Longtail Inventory

> **Date:** 2026-04-20
> **Purpose:** Capture every retail-related improvement idea discussed during Phase 2-G planning that did NOT make the roadmap's Phase 2-G scope. Nothing is lost — each item has a bucket, source, rough effort, and proposed phase destination.
> **Status:** Reference doc. When Phase 2-G is shipping, use this menu to decide what lands in the next retail pass.

## How to use this doc

- **Bucket A items are already in the Phase 2-G roadmap** (Wave 6 proposal or earlier waves). Not listed again here.
- **Bucket B items are research follow-ups.** If you want these investigated, use the prompts at the bottom.
- **Bucket C / D / E / F items** below are the "parked for later" inventory. Each has:
  - One-line description
  - Why it's parked (effort/scope/dependency reason)
  - Source (which audit/conversation/question surfaced it)
  - Proposed phase destination

If something in here suddenly becomes urgent (a tenant asks, a competitor ships it, a gap blocks another feature), pull it from here into the active roadmap.

---

## Bucket C — Retail depth features, deferred to Phase 3

These are real retail features competitors ship. Deliberately scoped out of Phase 2-G because the phase is about **general retail parity**, not deep retail. Phase 3 is where vertical + deep retail features land.

### Inventory realities
| Item | One-line | Parked reason | Source | Phase |
|---|---|---|---|---|
| Consignment inventory | Products you hold but don't own until sold | Non-trivial accounting model; different vertical use case | Q#19 | Phase 3 |
| Kit / bundle assembly | Buy 3 components → assemble 1 kit → sell as SKU | New assembly workflow + variance tracking | Q#19 | Phase 3 |
| Goods-in-transit | Ordered from supplier, not arrived, already sold on backorder | Requires backorder management + partial fulfillment UI | Q#19 | Phase 3 |
| Breakage / wastage logging | Different from cycle-count variance — intentional scrap | Small schema + UI but overlaps with inventory intelligence hub; fold into A6 follow-up | Q#19 | Phase 3 or Phase 2-G polish |
| Proactive expiry alerts | "This batch expires in 30 days — promote or discount" | Requires batch/lot tracking (deferred Phase 3.4 fresh goods) | Q#19 | Phase 3.4 fresh goods |
| Cross-outlet stock visibility at POS | "Not here, but Store X has 4" | Needs real-time multi-outlet query + UI on scan/search | Q#19 | Phase 3 |
| Demand-spike detection | Unusual velocity → surface for reorder | Extends A6 velocity calc with outlier detection | Q#19 | Phase 3 (post-A6) |
| Bin locations | Where on the shelf / aisle is the product | Physical-store layout depth | Q#19 (implicit) | Phase 3 |

### Pricing strategy tools
| Item | One-line | Parked reason | Source | Phase |
|---|---|---|---|---|
| Markup calculator | Enter cost + target margin → price | 0.5d each; worth bundling as a "pricing tools" mini-phase | Q#20 | Phase 3 |
| Competitor price tracking | Manual entry or scrape of competitor prices | Scrape is complex; manual is a table + UI | Q#20 | Phase 3 |
| Price elasticity analysis | Did we sell more at the lower price? | Needs price-history tracking first | Q#20 | Phase 3 |
| Automatic markdown schedules | 10% off after 30 days unsold, 25% after 60 | Rule engine extension on existing promotions | Q#20 | Phase 3 |
| Bundle pricing engine | Buy A + B → get C free or discounted | Promotions system extension | Q#20 | Phase 3 |
| Promotional calendar view | What's running when, calendar-grid | UI-only on existing promotions | Q#20 | Phase 3 |

### Supplier relationship depth
| Item | One-line | Parked reason | Source | Phase |
|---|---|---|---|---|
| Supplier scorecard | On-time rate, fill rate, defect rate | Needs PO + GRN data aggregation; medium effort | Q#21 | Phase 3 |
| Supplier MOQ + lead times | Minimum order qty + days — feeds reorder suggestions | Small schema add; fold into A6 reorder logic later | Q#21 | Phase 3 (post-A6) |
| Supplier-specific SKU codes | Their code ≠ your code — cross-reference | New bridge table `product_supplier_codes` | Q#21 | Phase 3 |
| Drop-ship workflow | Customer orders → you order from supplier → supplier ships direct | New order-type flow | Q#21 | Phase 3 |
| RFQ / quote comparison | Compare quotes from N suppliers before PO | New multi-quote module | Q#21 | Phase 3 |

### Customer intelligence (CRM depth)
| Item | One-line | Parked reason | Source | Phase |
|---|---|---|---|---|
| RFM segmentation | Recency / Frequency / Monetary scoring | Derived metric; nightly worker | Q#22 | Phase 3 |
| Customer lifetime value (CLV) | Calculated, surfaced, actionable | Same as RFM | Q#22 | Phase 3 |
| Win-back campaigns | Customer hasn't visited in 60 days — auto-trigger | Campaign engine extension | Q#22 | Phase 3 |
| Purchase prediction | "Likely to buy again in 2 weeks" | ML — re-committed as deferred | Q#22 + Q#32 | Phase 3+ (AI deferred) |
| Customer preferences | Peanut allergy, prefers delivery, etc. | Free-text notes column + UI | Q#22 | Phase 3 (small) |
| Household / family grouping | Multiple customers = one household loyalty | New `customer_households` table | Q#22 | Phase 3 |
| Customer feedback / NPS | Post-receipt NPS prompt | Integrates with CFD prompt pattern | Q#22 | Phase 3 or Phase 2-G polish |

### Multi-channel retail
| Item | One-line | Parked reason | Source | Phase |
|---|---|---|---|---|
| In-store pickup from online order (BOPIS) | Online order → pickup flow at POS | Requires BOPIS depth (Tier D deferred) | Q#23 | Phase 3 |
| Return online purchase in store | Online sale visible at POS return flow | Depends on WooCommerce/Shopify sync depth | Q#23 | Phase 3 |
| Channel-specific pricing | Same SKU, different price per channel | Extends B4 price books to include channel dimension | Q#23 | Phase 3 |
| Inventory reservation across channels | Lock stock when WooCommerce order placed | Real-time reservation system | Q#23 | Phase 3 |

### Retail-specific compliance beyond FBR
| Item | One-line | Parked reason | Source | Phase |
|---|---|---|---|---|
| Weights & Measures certification | Scale sales with certified calibration records | Regulatory; needs scale integration (Tier D) | Q#17 | Phase 3.4 fresh goods |
| Expiry-date labeling requirements | Mandatory for food retail | Depends on batch tracking | Q#17 | Phase 3.4 |
| Consumer protection (refund-window laws) | Pakistan-specific refund rules | Config + UI warning | Q#17 | Phase 5 (country pack) |
| Provincial shop act | Employment hours tracking for retail staff | HR depth | Q#17 | Phase 3 |

---

## Bucket D — Platform-level, cross-preset (affects all 23 presets)

Not Phase 2-G material because changes affect restaurant, clinical, rental, hotel, etc. — not just retail. Belongs in a Platform Pillars phase (Phase 4.x) or its own cross-cutting track.

### Localization & accessibility
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| Urdu interface | Full i18n + translations | 3-4 weeks (infrastructure + translations) | Q#24 | Phase 5 Pakistan pack |
| Regional languages (Sindhi, Punjabi) | After Urdu | 1-2 weeks each once i18n exists | Q#24 | Phase 5 |
| RTL text support for Arabic (GCC) | Full RTL CSS + bidi | 2-3 weeks | Q#24 | Phase 5 GCC pack |
| Screen reader support on /pos | ARIA labels + focus management | 1-2 weeks existing screens | Q#24 | Phase 4.x |
| Large-touch-target mode | Older/vision-impaired staff | 0.5 week (CSS variable) | Q#24 | Phase 4.x |
| Reduced-motion mode | For seizure-prone staff | 0.5 week | Q#24 | Phase 4.x |

### Security
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| 2FA for admin/owner accounts | TOTP or SMS | 1 week | Q#28 | Phase 4.x security pass |
| IP allowlist per outlet | POS only from store's network | 0.5 week | Q#28 | Phase 4.x |
| Session timeout per role | Cashier 15 min, manager 8 hrs | 0.5 week | Q#28 | Phase 4.x |
| Till-lock on idle | Lock POS after N minutes idle | 0.5 week | Q#28 | Phase 4.x |
| Suspicious login detection | Login from unusual location | 1-2 weeks | Q#28 | Phase 4.x |

### Data portability & trust
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| Tenant self-serve data export | GDPR-style right-to-export, full DB dump | 1 week | Q#27 | Phase 4.x |
| Scheduled backup to tenant's S3/Drive | Paranoid retailers want own backup copy | 1 week | Q#27 | Phase 4.x |
| Data retention policy per tenant | Auto-purge old data per policy | 0.5 week | Q#27 | Phase 4.x |
| Account deletion flow | What happens to customer data on cancellation | 0.5 week | Q#27 | Phase 4.x |

### Support & success layer
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| In-app "how do I" help | Contextual help tooltips/guides on retail flows | 1-2 weeks | Q#29 | Phase 4.x |
| Video walkthroughs embedded | For common tasks | Asset creation — ongoing | Q#29 | Phase 4.x |
| Release notes surfaced in-app | Shopify pattern | 0.5 week | Q#29 | Phase 4.x |
| Admin impersonate employee | Remote training tool | 0.5 week | Q#29 | Phase 4.x |
| Setup health-check | "Have you configured receipts? tax? drawer?" | 1 week | Q#29 | Phase 4.x |
| In-app onboarding tour | First-login walkthrough (beyond CLAUDE.md hints) | 1 week | Q#12 + Q#29 | Phase 4.x |
| "Fill with demo data" on signup | Shopify's conversion tool | 0.5 week | Q#12 | Phase 2-G polish or Phase 4.x |

### Hardware & form-factor realities
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| 58mm + 80mm receipt roll support | Both widths must work cleanly | 0.5 week if not already | Q#30 | Phase 2-G polish |
| Power-failure graceful handling | Common in Pakistan — UPS cutover behavior | 0.5 week defensive code | Q#30 | Phase 2-G polish |
| Intermittent internet (partial sync) | Reconnect-with-partial-sync robustness | 1-2 weeks | Q#30 | Phase 4.x reliability |
| Shared router realities | Bazaar tenants sharing one ISP | Architecture / stress testing | Q#30 | Phase 4.x |
| Thermal printer Chinese clone testing | Test matrix vs name brands (questionable ESC/POS) | 0.5 week testing | Q#30 | Phase 2-G polish |
| Mobile / tablet form-factor audit | iPad portrait behavior on /pos | 0.5 week audit + fix | Q#4 "what Phase 2-G won't fix" | Phase 2-G polish |

### Finance integration depth
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| Daily bank deposit reconciliation | POS cash total = bank deposit? | 1 week | Q#25 | Phase 4.4 accounting |
| Payment processor reconciliation | SanoPay settlement = recorded card txns? | 1 week | Q#25 | Phase 4.4 |
| Sales tax remittance automation | Monthly filing package | 1-2 weeks | Q#25 | Phase 4.4 |
| Petty cash management | Track small-cash outflows | 0.5 week | Q#25 | Phase 4.x |
| Auto expense categorization | Not just logging — auto-classify | 1 week (or ML deferred) | Q#25 | Phase 4.4 |

### Performance & observability
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| Product search at 10K+ SKU | Measure + optimize | 1 week audit | Q#5 "what Phase 2-G won't fix" | Phase 4.x or Phase 2-G polish |
| POS cold-boot time | Lighthouse-style measurement on `/pos` | 0.5 week | Q#5 | Phase 4.x |
| Receipt print latency | Timing from pay → print | 0.5 week | Q#5 | Phase 4.x |
| Report generation on 12-month data | Query plan + indexing pass | 1 week | Q#5 | Phase 4.x |
| Offline mode depth audit | What actually works offline, how long, reconcile UX | 1 week audit + 1-2 weeks fixes | Q#6 "what Phase 2-G won't fix" | Phase 4.x reliability |

### Growth / merchant success metrics
| Item | One-line | Effort hint | Source | Phase |
|---|---|---|---|---|
| Benchmarking ("your margin 32% vs industry 28%") | Requires industry data set | Data acquisition — long-term | Q#16 | Phase 4+ |
| End-of-month summary email to owner | Auto-digest per tenant | 1 week | Q#16 | Phase 2-G polish |
| Retail-specific staff leaderboard | Per-employee sales leaderboard | 0.5 week | Q#16 | Phase 2-G polish (covered by C4 commission statement?) |

---

## Bucket E — Strategic flags (not scope — philosophy)

These aren't features. They're reminders to carry forward.

### Re-commit: AI BYOK still deferred
- **Date re-surfaced:** 2026-04-20
- **Original deferral:** 2026-03-27 — no customer demand
- **Temptation vectors seen during Phase 2-G planning:**
  - Q#22: purchase prediction
  - Q#32: photo-to-product, voice ordering, anomaly explanation, auto-categorization
- **Carry-forward rule:** AI features stay deferred until 100+ tenants or explicit paying customer demand. This rule doesn't expire with Phase 2-G.
- **Action:** add one line to the roadmap "What this plan does NOT recommend" section reaffirming this.

### Framing: parity vs differentiation
- **Phase 2-G delivers parity, not differentiation.** After Phase 2-G ships, SanoPOS retail matches Square/Shopify/Lightspeed on Tier-1 features. It does NOT make SanoPOS better at things competitors don't do.
- **Differentiation vectors (not Phase 2-G):**
  - Pakistan-specific: udhar ledgers, qist variations, FBR nuances (Phase 5)
  - Vertical presets: pharmacy, jewelry, eyewear, auto parts, furniture (Phase 3)
  - Local hardware: thermal Chinese clones, 58/80mm, TSC labels (Phase 2-G polish)
  - Country packs: GCC, GST, OSS VAT (Phase 5)
- **Don't confuse parity progress with winning.** Parity is the floor. Differentiation is the lead.

### No new verticals in Phase 2-G scope
- **Explicit scope rule:** Phase 2-G deepens `general_retail`. It does NOT add pharmacy, jewelry, eyewear, auto parts, or furniture presets.
- **Rule:** if a tenant request surfaces mid-Phase 2-G for one of these verticals, route the request to the Phase 3 planning inventory, don't expand 2-G.
- **Reason:** scope creep broke restaurant before Phase 2-R discipline tightened it. Same discipline applies here.

---

## Bucket F — Small items that refine existing Phase 2-G scope

These don't add new waves — they sharpen items already in the roadmap. Note them here so they aren't lost.

| Refinement | Refines which 2-G item | One-line |
|---|---|---|
| Receipt designer with logo + branding + FBR | 2-G.11 (receipt barcode) | Tenants care deeply; visual receipt designer may belong here or parallel to B2 label designer |
| 58mm + 80mm receipt roll support | 2-G.11 and B2 | Both widths common in Pakistan |
| Mobile receipt rendering | 2-G.11 | WhatsApp-shareable receipt image quality |
| Import-from-Shopify CSV format | Wave 6 (new) | Specific file format spec |
| Import-from-Square export format | Wave 6 (new) | Specific file format spec |
| Import-from-Lightspeed export format | Wave 6 (new) | Specific file format spec |
| Error-state inventory per screen | Wave 6 (new) | Network down, scan fails, PIN wrong, insufficient stock, print fails post-payment |
| Shift left open overnight handling | Error states + Wave 6 | Cashier forgets to close |
| Two-cashier simultaneous refund | Error states | Race condition handling |
| Receipt-fail-post-payment retry | Error states | Critical UX recovery flow |
| POS crash held-cart recovery | Error states | What happens to in-progress cart |
| Cash discrepancy flagging at shift close | Wave 6 anti-theft | Variance > threshold → manager notified |
| No-sale button tracking | Wave 6 anti-theft | Cash drawer opened without a transaction |
| Employee anomaly detection | Wave 6 anti-theft | One cashier has 3× the voids of peers |
| "Gift note / gift wrap" flag at checkout | B1 variant modal context | Gift purchases need recipient field |
| "Event / occasion" tagging on sales | CRM future | Birthday, Eid, wedding — feeds customer intelligence |
| Referral program | CRM future | Customer refers customer, both get loyalty points |
| Group purchasing | CRM future | N friends split one big order |
| CCTV integration hooks | Wave 6 anti-theft | Timestamp correlation with video |
| Offline partial-refund queue | Offline depth audit (Bucket D) | Shopify gap — SanoPOS can close |

---

## Bucket G — Things worth fixing because docs lied (CLAUDE.md drift)

These are the 6 drift items Track 2 audit flagged. Not features — doc fixes. Belongs in the next `/update-docs` run.

| # | CLAUDE.md claim | Actual source | Fix action |
|---|---|---|---|
| 1 | "Loyalty: tiers exist" | Tier `discount_percent` never applied to sale totals | Clarify loyalty is earn-only, tier discount not wired (fixed in 2-G.3) |
| 2 | Parked sales implies layaway | Parked sales = cart-pause only | Distinguish clearly from holds (2-G.9) |
| 3 | Serials table exists | Table exists but not wired GRN→sell→return→warranty | Call out end-to-end gap (fixed in 2-G.6) |
| 4 | v20 shipped commissions | Only percentage calc shipped; tiered + fixed_per_item missing | Note completeness gaps (fixed in 2-G.10) |
| 5 | Label printing exists | `barcode_templates` stores metadata only, no ZPL/TSPL body | Distinguish from designer (fixed in B2 parallel track) |
| 6 | `/reports` tab list | ReplenishmentTab / StockoutRiskTab / ForecastDemandTab present; GMROI/sell-through absent | List actual tabs + absent ones (fixed in 2-G.8) |

Source: [phase-2g-code-audit.md §CLAUDE.md drift detected](phase-2g-code-audit.md)

---

## Bucket H — Research follow-up tracks (optional, before or after Phase 2-G)

Not captured anywhere else. Runnable in parallel sessions.

### Track 4 — Existing retail screen UI/UX audit

**Prompt to use in parallel session:**

```
Execute Phase 2-G Track 4 — Existing retail screen UI/UX audit.

Source-grounded only (do NOT rely on CLAUDE.md — stale).
Working directory: d:/newprojects/oneshoppos

Read every retail-relevant *Redesign.jsx under frontend/src/pages/redesign/ (exclude POS, exclude restaurant, exclude clinical, exclude rentals, exclude rooms, exclude treatment-plans). Focus on general-retail back-office: products, categories, variants, inventory, transfers, adjustments, stock-counts, purchase-orders, GRN, supplier-payables, supplier-returns, customers, customer-groups, returns, promotions, price-lists, barcode-expenses, reports (non-POS tabs).

For each screen, flag:
- Dead controls (button that does nothing)
- Broken layouts (overflow, misaligned)
- Unclear empty states
- Missing loading indicators
- Raw HTML buttons/inputs (should use primitives)
- Inconsistent patterns vs other redesign pages
- Accessibility gaps (no labels, no focus states)
- Missing dark-mode tokens
- Missing error-state UX
- Missing keyboard navigation

Output: docs/plans/phase-2g-existing-ui-audit.md with table per screen + prioritized fix list.
```

### Track 5 — Retail back-office depth audit

**Prompt to use in parallel session:**

```
Execute Phase 2-G Track 5 — Retail back-office depth audit.

Source-grounded only (do NOT rely on CLAUDE.md — stale).
Working directory: d:/newprojects/oneshoppos

For each of these retail back-office workflows, audit schema/routes/UI depth and classify as MATURE / PARTIAL / ROUGH / HALF-BUILT:

1. Supplier returns (backend/routes/supplier-returns.js)
2. Credit/debit notes (search for these in routes/)
3. Postdated cheques (Pakistan-specific — common)
4. Customer statements / customer ledgers (udhar / account-based buying)
5. Multi-outlet transfers (depth vs simple move)
6. Cash reconciliation (till counts, float, deposits)
7. Expense recording at POS
8. CSV exports across all retail screens
9. Receipt design (how customizable, how professional)
10. Offline mode depth — what actually queues, how reconcile
11. Demo data quality for general_retail preset
12. Bulk edit / CSV import (products, customers, suppliers)
13. Barcode print queue workflow
14. Price list editor UX
15. Promotions builder UX

For each, grep/read actual source files. Report:
- What exists (file:line quotes)
- What's missing vs a real retailer's expectation
- Rough effort to bring to MATURE
- Recommendation: add to Phase 2-G / Phase 2-G polish / Phase 3 / defer

Output: docs/plans/phase-2g-back-office-audit.md.
```

---

## Summary of destinations

| Bucket | Items | Destination |
|---|---|---|
| A — Wave 6 scope additions | 4 | ✅ Added to [roadmap Phase 2-G Wave 6 as 2-G.14 → 2-G.17](sanopos-maturity-roadmap-2026-04-17.md) |
| B — Track 4 + 5 research | 2 prompts | Optional parallel session runs (prompts above) |
| C — Retail depth | ~30 items | Phase 3 inventory (this doc) |
| D — Platform cross-preset | ~25 items | Phase 4.x inventory (this doc) |
| E — Strategic flags | 3 reminders | Philosophical reminders (this doc + roadmap "does NOT recommend") |
| F — Phase 2-G refinements | ~20 micro-items | Roll into existing 2-G items + Wave 6 (this doc) |
| G — Docs drift | 6 items | Next `/update-docs` run (this doc) |
| H — Research prompts | 2 prompts | Optional parallel runs (this doc) |

**Nothing discussed during Phase 2-G planning is lost.** This doc is the menu for Phase 3 planning, Phase 4.x planning, and any retail polish sprints that follow Phase 2-G shipping.
