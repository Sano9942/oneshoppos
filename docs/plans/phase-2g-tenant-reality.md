# Phase 2-G — Tenant Reality Check

> **Date:** 2026-04-20
> **Purpose:** Track 3 of 3 — validate Phase 2-G scope against actual tenant demand, not competitor research. Answers 6 questions from the synthesis "Open questions" list.
> **Method:** Direct answers from user (owner, knows live tenant base). No SQL run; no external tenant outreach. Captures user's knowledge of `packagesmall` + live retail tenants as of 2026-04-20.
> **Status:** Complete. Feeds directly into Phase 2-G plan writing.

## Summary table

| # | Question | Answer | Scope impact |
|---|---|---|---|
| 1 | Variant picker usage | Yes — tenants use variants | **B1 stays in scope, Wave 3.** Build matrix grid. |
| 2 | Layaway / qist demand | Yes — tenants have asked | **C1 promotes Tier C → Tier B.** Add 8–10d to Phase 2-G. |
| 3 | Gift cards — physical or digital | Both | **A2 full scope** (digital + physical activation). ~6–7d, not 3d. |
| 4 | Label printer models + demand | All three: Zebra + TSC + Dymo. Customers asked for SKU + price + variant labels AND shelf labels | **B2 full multi-language build.** ~12–14d. Two template types (item labels + shelf labels). Can't defer. |
| 5 | Staff commissions demand | Yes — tenants pay commission; all 3 calc types in use (percentage, flat-per-item, tiered) | **C4 promotes Tier C → Tier B.** Finish all 3 calc types. 4–5d. |
| 6 | Shopify / Stocky migration leads | No Shopify leads, no Stocky mentions | **A6 no longer time-boxed.** Drop "Stocky wedge" framing. Normal Wave 4 priority. |

---

## Per-question detail

### Q1 — Variant picker usage

- **Answer:** Yes, current retail tenants use variants.
- **Scope decision:** **B1 matrix variant grid stays in Phase 2-G.**
- **Wave placement:** Wave 3 (POS UX), alongside A5 price override + B5 serials.
- **Dependencies to resolve during build:** variant-level stock shape (auditor flagged — `variant_stock` table vs per-product stock) and variant-level serials (B5 dependency — `product_serial_numbers` has `product_id` but no `variant_id`).
- **Effort:** 5 days per audit estimate.

### Q2 — Layaway / qist demand

- **Answer:** Yes, tenants have asked for hold-with-deposit + partial-payment workflows.
- **Scope decision:** **C1 layaway promotes from Tier C (MAYBE) to Tier B (SHOULD).** Added to Phase 2-G.
- **Wave placement:** Wave 5 (finishing / flow-shape). Depends on parked-sales code but extends it with deposits + schedule.
- **Scope note:** Distinct from `parked_sales` (cart-pause only). Needs new schema: `holds` table with `deposit_paid`, `balance_due`, `hold_until`, `status`. New routes, new UI. 8–10 days per audit.
- **Cultural context:** Pakistani "qist" is common. Could leverage existing wallet/SanoPay to accept deposits via Easypaisa/JazzCash — a meaningful differentiator vs Lightspeed's cash-only layaway.
- **Follow-up during build:** decide whether hold-pickup uses C3 receipt-barcode lookup to recall the hold quickly at pickup time.
- **Effort:** 8–10 days.

### Q3 — Gift cards: physical, digital, or both?

- **Answer:** Both.
- **Scope decision:** **A2 full scope — digital (SMS/email code) + physical (pre-printed, scan-to-activate).**
- **Wave placement:** Wave 2 (tender completion), alongside B3 loyalty + B4 group pricing.
- **Scope expansion vs audit:** audit estimated 3d assuming digital-only. Physical activation adds pre-printed card range management, card-number uniqueness, activation workflow. Revised estimate: **6–7 days**.
- **Data model consideration:** physical cards need card-number vs code distinction. One `gift_cards` row can still cover both; add `card_type` column (`digital` / `physical`) and `activation_status` (`pre-printed` / `issued` / `active`).
- **Shared ledger primitive (with A3 wallet, B3 loyalty):** `gift_card_transactions` ledger shaped like `customer_wallet_ledger` — still applies.
- **Effort:** 6–7 days (up from 3d).

### Q4 — Label printer models + demand

- **Answer:** All three printer families in use — Zebra, TSC, Dymo. Customer demand for (a) SKU + price + variant barcode labels, AND (b) shelf labels.
- **Scope decision:** **B2 label designer full build — ZPL + TSPL + Dymo + two template types.**
- **Wave placement:** Wave 5 (finishing). Biggest single item. Could be parallelized on a dedicated track.
- **Scope expansion vs audit:** audit estimated 8–10d assuming ZPL/TSPL/EPL. Adding Dymo protocol + a second template type (shelf labels alongside item labels) pushes to **12–14 days**.
- **Two template types — not one:**
  - **Item labels:** product barcode + SKU + price + variant code (what audit assumed)
  - **Shelf labels:** shelf talkers with product name + price + unit price + category — different layout, usually larger format, may not need barcode
- **Printer language coverage:**
  - ZPL — Zebra ZD410/ZD420/ZD421 etc.
  - TSPL — TSC TE244/TDP-244 (Pakistan common)
  - Dymo — Dymo Label protocol via USB (different stack; consider using Dymo's SDK or CUPS driver path)
- **Deferral note:** cannot defer — real customer demand, concrete use cases.
- **Effort:** 12–14 days.

### Q5 — Staff commissions

- **Answer:** Yes, tenants pay retail staff commission. All three patterns in use: flat percentage, fixed amount per item, tiered (target-based).
- **Scope decision:** **C4 promotes from Tier C (MAYBE) to Tier B (SHOULD).** Finish all 3 calc types + per-item attribution.
- **Wave placement:** Wave 5 (finishing touches on sunk infrastructure).
- **Audit note:** v20 shipped the schema + routes + UI. Only missing work: `fixed_per_item` calc + `tiered` calc + wiring `sale_items.staff_id` (v49) as the per-item attribution source instead of sale-level `authenticatedEmployeeId`.
- **Collision risk:** `commission_earnings.earning_type` is shared with Phase 2-R tips. Changes must preserve tip code paths.
- **Effort:** 4–5 days.

### Q6 — Shopify / Stocky migration leads

- **Answer:** No Shopify leads, no Stocky mentions in tenant base.
- **Scope decision:** **A6 inventory-intelligence hub stays in Wave 4, normal priority. Drop "Stocky time-boxed wedge" framing.**
- **Implications:**
  - No sales-urgency accelerator on A6. Ship when sequencing allows.
  - Don't use "Stocky replacement" as a landing-page message — no evidence it resonates with target tenants.
  - A6 is still valuable for native SanoPOS retail (ABC, cycle counts, GMROI are universal retail KPIs), just not market-timing-critical.
- **Effort unchanged:** 5–7 days per audit.

---

## Net Phase 2-G scope after Tracks 1+2+3

**Promoted into scope (from Tier C → Tier B):**
- C1 layaway (Q2) → +8–10d
- C4 commissions finish (Q5) → +4–5d

**Scope expanded (bigger than audit estimated):**
- A2 gift cards (Q3) → 3d → **6–7d**
- B2 label designer (Q4) → 8–10d → **12–14d**

**Dropped framing (no GTM pressure):**
- A6 Stocky wedge framing (Q6) — feature stays, urgency drops.

**Final Phase 2-G item count: 18** (16 from Track 2 + C1 + C4 promoted).

**Revised effort estimate (sum of lower bounds, pre-shared-primitive dedup):**
- Track 2 estimate: 65–80 days for 16 items
- +C1 layaway: +8–10 days
- +C4 commissions: +4–5 days
- +A2 gift cards extra: +3–4 days
- +B2 label designer extra: +4 days
- **Revised total: ~84–103 days raw**

Shared primitives (ledger, PIN verify, reason codes, feature flags) should compress this by ~15–20%. **Working Phase 2-G sizing: 11–13 working weeks (55–65 days after dedup)**, assuming no parallelization.

B2 label designer is a strong candidate to run on a parallel track since it has almost no shared dependencies with other Phase 2-G items.

---

## Waves — final sequencing (after all 3 tracks)

**Wave 1 — Foundations (unblock everything):**
- Ledger primitive migration (shared A2 + B3)
- Feature flags for all Phase 2-G items
- A1 omni-input pattern detection

**Wave 2 — Tender completion:**
- A2 gift cards (digital + physical) — 6–7d
- B3 loyalty tier-discount auto-apply + ledger — 2–3d
- B4 customer-group discount auto-apply — 1–2d

**Wave 3 — POS UX:**
- A5 manager price override — 5d
- B1 matrix variant grid — 5d
- B5 serialized inventory E2E — 5d
- B7 per-line restock + reason — 2d

**Wave 4 — Inventory intelligence (A6 absorbs C2 + C6):**
- A6 hub + ABC — 5–7d
- C6 GMROI + sell-through endpoints — 3–4d
- C2 scheduled cycle counts — 4–5d

**Wave 5 — Finishing touches + flow-shape:**
- C4 commissions finish — 4–5d
- C3 receipt-barcode return lookup — 3–4d
- **C1 layaway (promoted from Q2) — 8–10d**

**Parallel track (separate):**
- B2 label designer multi-language + two template types — 12–14d

**Explicitly deferred to Phase 3:**
- C5 training role
- All Tier D items (endless aisle, native scale, CFD, ML forecasting, vertical presets)

---

## Next step

All 3 research tracks complete. Ready to write the Phase 2-G section in [docs/plans/sanopos-maturity-roadmap-2026-04-17.md](sanopos-maturity-roadmap-2026-04-17.md), mirroring Phase 2-R structure (numbered items 2-G.0 through 2-G.N, verification demo, critical files, explicit "what this does NOT do").

Source inputs for the plan writer:
- [phase-2g-research-synthesis.md](phase-2g-research-synthesis.md) — strategic read + pattern inventory + ranked scope
- [phase-2g-code-audit.md](phase-2g-code-audit.md) — per-item schema/route/UI status + shared primitives + sequencing recommendations
- [phase-2g-tenant-reality.md](phase-2g-tenant-reality.md) — this file — tenant demand validation + final scope + final waves
