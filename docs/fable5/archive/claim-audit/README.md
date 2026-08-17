# Claim Audit — "the POS that speaks your industry's language"

**Date:** 2026-07-08 · **Against:** main @ v126 · **Method:** config reads + 23 fresh local signups
driven through the real signup→verify→setup→login wizard + 23 read-only prod `golv_*` reads + six
driven behavior flows + a fresh-context verifier on the five worst leaks. **Findings only — nothing
was changed.**

Companion docs: [`INDUSTRY-SPEC.md`](./INDUSTRY-SPEC.md) (the should/should-not yardstick),
[`MATRIX.md`](./MATRIX.md) (see-vs-should-see per industry), [`LEAKS.md`](./LEAKS.md) (ranked
deviations + fix locations).

---

## Verdict: the positioning is TRUE at its foundation, OVERSTATED at its edges.

The core promise — *pick your business type and the system reshapes* — is **real and correctly
seeded**. Every one of the 23 industries resolves to a distinct set of modes, feature flags, POS
layout, vocabulary, report groups, and portal tabs, and that seeding is **identical across the
source code, 23 fresh signups, and 23 production tenants** (zero drift). The vertical *behaviors*_
are genuine, not skins: a butcher rings a sale by weight with exact decimal money math and persisted
gross/tare; a dentist charts individual teeth that persist and supersede; a hotel runs a folio that
accumulates room + POS charges and settles at checkout; wholesale enforces a hard credit limit with a
real 403; a salon appointment flows to checkout and pays the right stylist a commission; a rental
runs checkout→late-return→inspection→invoice. Six for six, the marquee flows work.

**But the sentence "reshapes itself — the register, the words on every screen, the dashboard, the
reports, even your customers' portal" overstates three of those five surfaces:**

- **The register (POS): TRUE.** Layout, weight/tare/PLU, vocabulary, and mode-specific checkout
  (folio, credit, appointment, commission) all reshape and behave per industry.
- **The words: TRUE.** Vocabulary translation is the strongest part — sidebar, POS, receipts,
  dashboard headings, portal, and public booking all adapt (butcher "Cuts", hotel "Rooms", wholesale
  "Invoice History", clinic "Patient"). A few page bodies leak generic terms, but the claim holds.
- **The dashboard: PARTLY TRUE / mostly FALSE.** The preset *declares* per-industry dashboard widgets
  (appointments-today, active-treatment-plans, floor-plan) but the dashboard **honors only one of
  them** (`inventory_alerts`). The industry dashboards the config promises largely don't render.
- **The reports: PARTLY TRUE, with a backwards leak.** Report groups do filter by preset, but the
  **Clinical group is orphaned** (4 clinical industries get zero clinical reports) and **restaurant
  analytics are inverted** — butchers and grocers see KDS Analytics and Menu Engineering while
  restaurants and cafés never see their own.
- **The customer portal: PARTLY TRUE.** Tabs are genuinely preset-driven and most work, but **six
  industries' flagship portal tab is a dead link** (gym Memberships, repair Tickets, all four rental
  Contracts) — the tab renders and goes nowhere.

And the claim's own framing — *"same system, your system"* — cuts the other way for service
industries: modes **add** vertical surfaces but the retail spine (Catalog, Inventory, Procurement,
Fulfillment, Storefront, Barcode Templates) is **never removed**, so a dental clinic and a hotel still
carry a full retail back-office in the sidebar. It's "your system plus all of retail," not "your
system."

**Honesty grade: B−.** The headline is defensible and the behaviors are real, but "reshapes… the
dashboard, the reports, even your portal" is marketing ahead of the code on exactly those three
surfaces for specific industries. None of the gaps are seeding drift — they're all in the rendering
layer, which means they're fixable without touching the (sound) preset engine.

---

## The 5 worst leaks (industry → what it wrongly sees → fix location)

All five independently re-confirmed against live local logins.

1. **Veterinary & physiotherapy → a human DENTAL tooth chart.** `clinical_config.chart_preset` is
   ignored; `TreatmentPlansRedesign.jsx:373-374` hardcodes `dental_adult`. This is the literal
   "does a butcher get dental charting" failure, landing on vet/physio. (Bonus: `vet_body` has 0
   seeded areas and the `dental`↔`dental_adult` key names don't match — the fix needs both wiring and
   seeding.)
2. **Butchers, grocers, textile shops → Restaurant KDS Analytics + Menu Engineering reports;
   restaurants & cafés → none of their own.** `Reports.jsx:558,564` groups are in no preset's list, so
   only null-group retailers see them. Fix: `industry-config.js:53,138` + per-tab gates in
   `Reports.jsx`.
3. **All four clinical industries → zero clinical reports.** The "Clinical" group they're configured
   for doesn't exist in `Reports.jsx` GROUPS; `ClinicalTab.jsx` is unimported dead code.
4. **Gym, repair shop, and all four rental industries → a dead flagship portal tab.** "My
   Memberships" / "Repair Tickets" / "Rental Agreements" render in the portal nav but have no route
   (`publicRoutes.jsx:236-254`) — click dead-ends on an empty screen.
5. **Every tenant → no FBR Invoices dashboard, despite the flag being ON.**
   `registerAllRoutes.js:385-406` drops any DB flag not in `DEFAULT_FEATURE_FLAGS`; `fbr_integration`
   (PK country-pack, ON in every PK tenant's DB) is dropped, hiding the nav item for all.

(Full ranked list incl. the structural retail-spine leak, mislabels, and the empty DRIFT class: see
[`LEAKS.md`](./LEAKS.md).)

---

## Clause-by-clause grade of the marketing paragraph

| Clause | Grade | Evidence |
|---|---|---|
| "The point of sale that speaks your industry's language." | **TRUE** | Vocabulary reshapes across POS, sidebar, receipts, portal, booking. |
| "Pick your business type and SanoPOS reshapes itself" | **TRUE** | 23 distinct presets; seeding identical across code / 23 fresh signups / 23 prod tenants (zero drift). |
| "…the register…" | **TRUE** | POS layout + weight/tare/PLU + folio/credit/appointment/commission checkout all reshape and behave per industry. |
| "…the words on every screen…" | **PARTLY TRUE** | Broad, correct translation; a few page bodies (PortalOrders, DashboardTopProducts "N sold", some POS strings) leak generic retail terms. "Every screen" is slightly overstated. |
| "…the dashboard…" | **FALSE (mostly)** | Only `inventory_alerts` of the declared per-industry widgets is honored; appointments-today / treatment-plans / floor-plan widgets have no consumer. A dead `hasMode("retail")` path flashes cards for everyone. |
| "…the reports…" | **PARTLY TRUE** | Groups filter by preset, but Clinical is orphaned (4 industries get none) and restaurant analytics are inverted (retailers see them, restaurants don't). |
| "…even your customers' portal." | **PARTLY TRUE** | Tabs are preset-driven and most work, but 6 industries' flagship tab is a dead link. |
| "A butcher sells by weight." | **TRUE** | Verified: 1.375 kg @ 2400 → 3300.00 exact, gross/tare persisted, decimal stock decrement. |
| "A dentist charts teeth." | **TRUE** | Verified: tooth 26 caries→restoration charted, persisted, superseded; dental Universal 1-32 seeded. |
| "A hotel runs folios." | **TRUE** | Verified: check-in opens folio, POS charge-to-room lands on it, checkout settles to exact total, no revenue double-count. |
| "Same system, your system." | **PARTLY TRUE** | Verticals are added but the full retail spine is never removed for service/clinical/lodging — "your system plus all of retail." |
| "Every preset changes the vocabulary, POS layout, dashboard, reports and customer portal — before you sell your first item." | **PARTLY TRUE / OVERSTATED** | Vocabulary + POS layout: yes, at signup. Dashboard: barely. Reports: partly + backwards for some. Portal: partly, with dead tabs. "Before you sell your first item" is accurate — it's all seeded at wizard completion (verified). |

**Overall: the load-bearing claims are true and demonstrable; the enumerated-surface claims
(dashboard, reports, portal) are where the copy runs ahead of the implementation for specific
industries.** Fix the five leaks and the paragraph becomes honest end-to-end.
