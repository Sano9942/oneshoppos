# Vertical-Depth ROADMAP — Plans Register + Program Sequencing

> Written 2026-07-04 from the approved findings in [README.md](README.md). Status: **awaiting approval** — nothing below is executed. Companion register for wiring plans lives in [../completion/README.md](../completion/README.md); this file sequences BOTH efforts end-to-end.

---

## 1. Plans register (this effort — depth + hardening)

| # | Plan file | What it delivers | Model | Effort | Size | Hard deps | Closes P0s for |
|---|---|---|---|---|---|---|---|
| F01 | [F01-kit-bom-engine](plans/F01-kit-bom-engine.md) | Kits/bundles, recipes + food costing, assembly/disassembly with yield | **Fable** | xhigh | L | completion 01 committed | restaurant (recipe P0); P1s in 4 verticals |
| F02 | [F02-packages-passes-membership-billing](plans/F02-packages-passes-membership-billing.md) | Session packs w/ credit ledger; dunning; calendar-month billing | Opus | high | M | F06 (redemption wiring only) | — (P1s in gym/salon/physio; 2 P0-grade billing hardening fixes) |
| F03 | [F03-form-builder](plans/F03-form-builder.md) | Tenant-defined forms: intake, waivers, questionnaires, signatures | Opus | high | M | — | — (P1s in 4 verticals) |
| F04 | [F04-deposits-preauth-noshow](plans/F04-deposits-preauth-noshow.md) | One deposit/pre-auth engine; rentals + no-show + ticket consumers | **Fable** | high | M | — | — (P1s in 4 verticals; orphaned-hold hardening) |
| F05 ✅ | [F05-customer-notification-engine](plans/F05-customer-notification-engine.md) | Event→SMS/email/WhatsApp engine; fixes the lying SMS reminders | Opus (Sonnet viable) | high | S/M | — | **repair (notifications P0)** — **DONE 2026-07-05** (branch `feat/f05-notifications`, v99): engine + repair P0 + SMS-reminder truth fix + settings UI; 24 F05 tests green, verifier-confirmed |
| F06 ✅ | [F06-scheduling-engine-activation](plans/F06-scheduling-engine-activation.md) | Activates 7 dead tables: classes, waitlist, resources, segments; appointment↔sale link; overlap-race fix | **Fable** | high | L | completion 03 | **gym (classes P0), salon (checkout-link P0)** — **DONE 2026-07-05** (branch `feat/f06-scheduling`, v100, head `1a244e1`): classes/waitlist/resources/segments live, checkout link + per-line commission attribution fixed, races test-proven (25 tests green), verifier-confirmed; ICS feed shipped + dead Google-sync flag deleted per approval |
| F07 | [F07-batch-expiry-lot-engine](plans/F07-batch-expiry-lot-engine.md) | Batch/expiry FEFO, near-expiry alerts, textile rolls | **Fable** | xhigh | L | F01 first (same code), completion 00/01 | **grocery/butcher/sweet (expiry P0)** |
| V01 | [V01-retail-depth](plans/V01-retail-depth.md) | Scale, price-embedded barcodes, PLU; preset activation of F01/F07 | Opus | high | M/L | F01, F07 | **grocery (scale + barcode P0s)** |
| V02 | [V02-wholesale-depth](plans/V02-wholesale-depth.md) | Backorders/partial fulfillment; van sales; POD; credit-race fix | **Fable** | high | M/L | completion 04; F05 soft | **wholesale (backorders P0)** |
| V03 | [V03-food-service-depth](plans/V03-food-service-depth.md) | foodpanda/Careem injection → KDS; recipes/combos surface | Opus | high | M/L | F01; completion 02 | **cafe/QSR (aggregator P0)** |
| V04 | [V04-salon-depth](plans/V04-salon-depth.md) | Client service history/formulas; retention loop consuming F02/04/05/06 | Opus | high | M | F06 hard; F02/F04/F05 | **salon (history P0; checkout P0 via F06)** |
| V05 | [V05-clinical-depth](plans/V05-clinical-depth.md) | Clinic preset enablement; recall engine; vaccinations; allergies | Opus | high | M/L | F03, F05; completion 03+08 | **clinic, dental (recall), vet (vaccination) P0s** |
| V06 | [V06-repair-shop-depth](plans/V06-repair-shop-depth.md) | Device intake; parts→ticket→invoice; estimates; warranty | Opus | high | M/L | F05 hard; F03 soft; completion 01+05 | **repair (device + parts P0s)** |
| V07 | [V07-gym-depth](plans/V07-gym-depth.md) | Member check-in kiosk; timetable/dunning/packs/waivers consumption | Opus | high | M | F06+F02 hard; F03 | **gym (check-in P0; classes P0 via F06)** |
| V08 | [V08-photography-depth](plans/V08-photography-depth.md) | Public inquiry form; questionnaires; gallery/proofing v1 | Sonnet | medium | S | F03; completion 09 | — (no P0s; closes the P1 trio) |
| V09 | [V09-rentals-depth](plans/V09-rentals-depth.md) | Car legal agreement + e-sign; inspections; maintenance; online booking | Opus | high | M/L | F04 hard; F05; completion 06 | **car_rental (agreement + inspection P0s)** |
| V10 | [V10-lodging-depth](plans/V10-lodging-depth.md) | Booking-race fix; direct booking engine; iCal channel sync; hostel beds; night audit | **Fable** | high | L | F05 soft; completion 07 | **hotel/hostel (channel + booking-engine + beds P0s)** |

Fable runs: **F01, F04, F06, F07, V02, V10** (net-new engine design, payments/webhooks, or concurrency-critical). Everything else is Opus/Sonnet consuming a fully-specified design — mirroring the completion effort's model logic.

**Why this cut** (rule: split a shared engine out only where ≥2 verticals genuinely share it):
- Each F-plan maps 1:1 to a cross-cutting observation in the findings README (#1 dead schema → F06, #2 kit/BOM → F01, #3 packages → F02, #4 forms → F03, #5 deposits → F04, notifications → F05) plus F07 for the retail-subtype family's shared perishables/lot gap.
- Vertical-only P0s stayed vertical: repair device-intake (V06), car-rental vehicle-legal (V09), hostel beds (V10), grocery scale/barcode (V01), backorders (V02), foodpanda (V03), salon history (V04), clinical recall/vaccination (V05), gym check-in (V07).
- Findings files 01+02 merged into one plan (V01) — general retail's remaining rows are all consumed by F01/F07; a standalone plan would be two paragraphs.
- Every plan carries a mandatory **Harden-what's-built** section with code-cited failure scenarios — the improve-what-exists lens is inside each plan, not a separate track.

---

## 2. The whole program, in order

Completion (wiring) plans from [../completion/README.md](../completion/README.md) are interleaved below. Plan 01 is **executed but uncommitted** — its fixes sit in the `redesign/square` working tree right now.

| Order | Plan | Delivers | Model | Size | Deps | Why here |
|---|---|---|---|---|---|---|
| **Wave 0 — land what's done** | | | | | | |
| 0.1 | completion 01 close-out | **Commit the working-tree fixes** (tax-snapshot.js + P0 fixes) to a branch off `main`, PR, merge; then finish its two OPEN items: pricing/promo fork + rentals/room/treatment **folio-tax schema decision** | Fable (it has the context) | S | user approval on folio-tax | Everything downstream (F01 kit tax, V09/V10 invoices, F07 wiring) builds on tax-snapshot.js and the folio-tax resolution; uncommitted work is one `git checkout` away from loss |
| **Wave 1 — stabilize the spine (wiring, cheap, makes demos honest)** | | | | | | |
| 1.1 | completion 00 core-spine | 2 P0 fixes + full spine verification | Opus | M | — | The base every depth plan assumes; parallel with 0.1 |
| 1.2 | completion 02 restaurant | 2 one-line P0s + restaurant walkthrough | Opus | S/M | — | Live-revenue vertical; V03 builds on a proven floor |
| 1.3 | completion 03 appointments+commissions | Verify booking↔commission↔payroll; triage SMS | Opus | M | — | F06/F02 and four verticals sit on this engine; its confirm-items (overlap race, SMS lie) feed F06/F05 directly |
| 1.4 | completion 04 wholesale | Prove Tiers 0–2 live | Opus | S | — | V02 rewrites allocation invariants — verify before rewiring |
| 1.5 | completion 11 growth (P0-only run) | Marketplace-sync honesty fix + growth-surface verification | Opus | S | — | Kills the decorative-integration pattern before V03/V10 add real integrations; 8 P1 builds stay deferred post-reskin |
| — | completion 05/06/07/09/10 | **Fold into V06/V09/V10/V08/V07 as execution pre-flight** (see recommendation §3) | — | — | — | Zero-defect verification plans for verticals about to be rebuilt; running them standalone then rebuilding doubles the walkthrough cost |
| — | completion 08 treatment-plans | Run standalone before V05 (schema-drift confirm is a real risk — [[followup_b15_schema_drift]]) | Opus | S | after 1.3 | V05 needs the drift resolved, not just verified |
| **Wave 2 — foundational engines (build once)** | | | | | | |
| 2.1 | **F05 notifications** | Engine + repair P0 wiring + SMS-reminder truth fix | Opus | S/M | 1.3's SMS triage | Cheapest foundation, unblocks V06 immediately, every later plan consumes it |
| 2.2 ✅ | **F06 scheduling activation** — **DONE 2026-07-05** (`feat/f06-scheduling`, unmerged) | Classes/waitlist/resources/segments + checkout link + race fix | **Fable** | L | 1.3 | Closes 2 vertical P0s by itself; F02 redemption and three verticals wait on it |
| 2.3 | **F02 packages + billing hardening** | Packs, dunning, calendar billing | Opus | M | 2.2 (partial) | Dunning is a silent-revenue-leak fix for every subscriptions tenant |
| 2.4 | **F04 deposit engine** | Unified pre-auth + no-show + rental/ticket deposits | **Fable** | M | — | Parallel-safe with 2.2/2.3 (different files); webhook change needs approval |
| 2.5 | **F03 form builder** | Forms/waivers/questionnaires | Opus | M | — | Parallel-safe; V05/V06/V07/V08 consume |
| 2.6 | **F01 kit/BOM engine** | Kits, recipes, production runs | **Fable** | L | 0.1 committed | The big inventory engine; sequenced before F07 because both rewire the sales decrement block |
| 2.7 | **F07 batch/expiry/lot** | FEFO, expiry alerts, rolls | **Fable** | L | 2.6 | Most dangerous cross-surface change — goes last in the wave, onto a proven decrement census |
| **Wave 3 — vertical depth + hardening (consume the engines; order = worst-verdict-first)** | | | | | | |
| 3.1 | **V06 repair** (+ completion 05 pre-flight) | Not-viable → demo-able vs RepairDesk | Opus | M/L | 2.1 (2.5 soft) | Worst verdict + hometown competitor; only needs the cheap foundations — can start right after 2.1 |
| 3.2 | **V07 gym** (+ completion 10 pre-flight) | Studio Not-viable → viable (classes + door) | Opus | M | 2.2, 2.3 | Two P0s close the moment F06/F02 land |
| 3.3 | **V10 lodging** (+ completion 07 pre-flight) | Hotel/hostel Not-viable → viable (channel, engine, beds) | **Fable** | L | 2.1 soft | No heavy F-deps — can run parallel to 3.1/3.2 if capacity allows |
| 3.4 | **V09 rentals** (+ completion 06 pre-flight) | car_rental Not-viable → viable (legal agreement) | Opus | M/L | 2.4 | Deposit engine is the hard dep |
| 3.5 | **V05 clinical** (+ completion 08 done in wave 1) | clinic/vet P0s + dental recall | Opus | M/L | 2.5, 2.1 | Highest-leverage single decision (clinic enablement) rides here |
| 3.6 | **V04 salon** | Daily loop + retention stack | Opus | M | 2.2, 2.3, 2.4, 2.1 | Consumes the most foundations — naturally late |
| 3.7 | **V01 retail subtypes** | Grocery lane loop + preset activation | Opus | M/L | 2.6, 2.7 | Waits for both inventory engines |
| 3.8 | **V03 food service** | foodpanda + kitchen economics | Opus | M/L | 2.6, 1.2 | Aggregator P0 could jump earlier if a customer demands it — the adapter itself only needs wave 1 |
| 3.9 | **V02 wholesale** | Backorders + van sales | **Fable** | M/L | 1.4 | Independent of F-engines; placed here for Fable-capacity spacing, can float earlier |
| 3.10 | **V08 photography** | Inquiry/questionnaires/gallery | Sonnet | S | 2.5 | Smallest, no P0s |
| **Wave 4 — growth builds (post-reskin)** | | | | | | |
| 4.1 | completion 11 P1 builds | Website builder, marketing automations, payment links, reviews collection, wallet passes… | Fable (automations) / Opus | L | redesign/square merged | Consumer UI collides with the reskin by design (its own plan says defer); V08's automation P2 rides this |

---

## 3. The sequencing verdict: wiring first — but only one short wave of it, then engines, then verticals

**Recommendation: interleave, weighted wiring-early — Wave 0/1 (wiring) → Wave 2 (foundations) → Wave 3 (vertical depth) → Wave 4 (growth). Do NOT run all eleven completion plans to completion before starting depth.**

Reasoning:

1. **Wiring first where depth builds on top.** The depth plans extend exactly the machinery the wiring plans verify: F06 extends the appointments engine (completion 03 verifies it), F01/F07 rewire the stock paths (00/01 prove them), V02 rewrites allocation (04 proves it). Building depth on unverified wiring reproduces the P8→P13 pattern at 10× scale ([[feedback_parallel_paths]]). The wiring wave is also cheap — mostly verification walkthroughs with a handful of one-line fixes — and it makes every vertical honestly demo-able *now*, which has immediate sales value.
2. **But full wiring-first is waste.** Completion 05/06/07/09/10 are zero-defect verification passes over verticals that Wave 3 substantially rebuilds (repair gets new intake+parts+invoicing; rentals gets new agreement+inspections). Walking those checklists standalone, then re-walking after the rebuild, doubles the most expensive part (live verification). Fold each one into its depth plan's execution as the pre-flight: verify the old spine, then extend it, then verify the whole — one tenant, one session. The exception is completion 08 (standalone, before V05) because its schema-drift confirm can surface a migration that V05's own migrations must sequence after.
3. **Foundations before verticals is non-negotiable.** Six of the ten vertical plans have a hard F-dependency, and the alternative — building packages inside V07, then again inside V04 — is precisely the parallel-machinery failure mode the findings called out (the storefront promo-engine fork is the cautionary tale, still open). The F-wave is ordered cheap-to-dangerous: F05 (small, unblocks the worst vertical) → F06/F02/F04/F03 (parallel-safe trio+) → F01 → F07 (the two stock-path rewires, sequential, last, onto a proven base).
4. **Wave 3 ordering is worst-verdict-first, dependency-permitting:** repair, gym, lodging, rentals are the four "name-promise" Not-viable verticals (findings cross-cutting observation #6) — they convert from demo-killers to sellable the fastest per unit of work because their engines are already solid underneath. Salon/clinical/retail/food-service follow as their foundations land. V02/V10 float — they're foundation-light and can fill any Fable-capacity gap.
5. **Wave 0 is urgent and tiny:** completion 01's fixes (including the shared tax-snapshot module that F01/F07/V03 all build on) exist only as uncommitted changes in the `redesign/square` working tree. Committing them to a proper branch off `main` is the single highest-risk-reduction action in this document.

**redesign/square as a scheduling constraint:** all backend/schema work lands off `main` and is reskin-neutral. Net-new UI (V06 intake, V07 kiosk+timetable, V10 booking engine + front desk, V04 history panels, F06 calendar) should be built **on `redesign/square`** — the affected pages are already tokenized there (git log: catalog/inventory/customers/finance clusters done) and building them off `main` guarantees a second skinning pass. Practical rule: **merge or checkpoint redesign/square before Wave 3 starts** (Wave 0–2 are ~90% backend and don't need to wait); if the reskin is still mid-flight at Wave 3, ride the branch per-plan as each plan's branch note already states. Wave 4 (completion 11's consumer builds) stays post-reskin per its own plan.

**Approval gates preserved throughout:** every schema block in every plan is pause-list at execution (completion-spec §5) — the plans contain the DDL so approval is a review, not a design session. F04's webhook change, V03's webhook signature scheme, V05's clinic backfill, F06's calendar-sync decision, and V06's passcode-storage choice are the named per-plan decision points.
