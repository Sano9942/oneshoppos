# See-vs-Should-See Matrix — 23 industries × 6 surfaces

Method: three sources per industry — (1) CONFIG-RESOLVED from `backend/config/industry-config.js` +
`mode-registry.js` + seed bundles, (2) FRESH LOCAL: 23 real signups on local Postgres via the actual
`/api/auth/signup → /api/auth/verify-email → /api/setup/complete → /api/auth/mt-login` chain, with
`/api/context/bootstrap`, `/api/feature-flags`, `/api/portal/config`, and DB `feature_flags` +
`tenant_modes` captured per tenant, (3) PROD READ-ONLY: the 23 `golv_<industry>` tenants on Supabase.
Sidebar visibility computed by evaluating every `nav-config.js` gate against each tenant's real
merged flags + modes (mirrors `AppLayoutRedesign` filtering, admin employee). 2026-07-08, main @ v126.

**Seeding verdict first: CLEAN.** Config-resolved, fresh-local, and prod agree on modes and flags for
**all 23 industries with zero diffs** (`threeway.json` in the audit workpapers). Every deviation below
is therefore in the *rendering* layer — what the frontend does with a correctly-seeded preset — except
where marked. **DRIFT class: empty.**

Classification: **LEAK** = another industry's surface shows here · **MISSING** = should have, doesn't ·
**MISLABELED** = right feature, wrong words · **DRIFT** = prod differs from fresh baseline (none found).

---

## Table 1 — what each industry actually resolves to (fresh local, verified)

| Industry | Modes | POS layout | Portal tabs (served) | Report groups (effective) |
|---|---|---|---|---|
| general_retail | — | grid | invoices, orders, loyalty, profile | ALL 10 (null) |
| grocery | — | grid | invoices, orders, loyalty, profile | ALL 10 (null) |
| butcher | — | list | invoices, orders, profile | ALL 10 (null) |
| sweet_shop | — | grid | invoices, orders, loyalty, profile | ALL 10 (null) |
| textile | — | grid | invoices, orders, profile | ALL 10 (null) |
| wholesale | wholesale | grid | invoices, orders, profile | ALL 10 (null) |
| restaurant | restaurant | list | orders, loyalty, profile | 7 (no Restaurant/Procurement/Multi-Channel) |
| cafe | restaurant | counter | orders, loyalty, profile | 7 (same as restaurant) |
| salon | appointments, commissions | list | appointments, packages, invoices, loyalty, profile | 5 (S/C/F/HR/G) |
| gym | appointments, subscriptions | list | **subscriptions†**, packages, invoices, appointments, profile, forms | 5 |
| photography_studio | appointments, service_projects | list | invoices, orders, appointments, gallery, profile | 5 |
| clinic | appointments, treatment_plans | list | treatments, appointments, invoices, loyalty, profile, forms | 5 + **Clinical‡** |
| dental_clinic | appointments, treatment_plans | list | treatments, appointments, invoices, loyalty, profile, forms | 5 + **Clinical‡** |
| veterinary | appointments, treatment_plans | list | treatments, appointments, invoices, profile, forms | 5 + **Clinical‡** |
| physiotherapy | appointments, treatment_plans | list | treatments, appointments, packages, invoices, profile, forms | 5 + **Clinical‡** |
| repair_shop | workflow_tickets | list | **tickets†**, invoices, profile | 7 (S/C/I/O/F/HR/G) |
| car_rental | rentals | list | **contracts†**, invoices, profile | 5 |
| equipment_hire | rentals | list | **contracts†**, invoices, profile | 5 |
| furniture_rental | rentals | list | **contracts†**, invoices, profile | 5 |
| party_supplies | rentals | list | **contracts†**, invoices, profile | 5 |
| hotel | room_management | list | stays, invoices, profile | 5 |
| guesthouse | room_management | list | stays, invoices, profile | 5 |
| hostel | room_management | list | stays, invoices, profile | 5 |

† served by `/api/portal/config` but **dead in the portal UI** — no route/component (see D-4).
‡ listed by the preset but **orphaned in Reports.jsx** — group label doesn't exist (see D-1).

---

## Table 2 — deviations, classified (D-numbers ranked by severity in LEAKS.md)

### D-1 · MISSING · Clinical reports orphaned — clinic, dental_clinic, veterinary, physiotherapy
Preset lists `"Clinical"` (`industry-config.js:177,622,661,700`); `Reports.jsx` GROUPS has **no
"Clinical" label** (verified: zero grep matches) and `reports/ClinicalTab.jsx` is unimported dead
code. Clinical reports unreachable for all 4 clinical presets.

### D-2 · LEAK + MISSING · Restaurant analytics inverted — 6 retail presets vs restaurant/cafe
`Reports.jsx` groups "Restaurant" (:564 — KDS Analytics, Menu Engineering), "Multi-Channel" (:558),
"Procurement" (:510) are in **no preset's** `visible_report_groups` → they render only for null-group
presets. Net effect: **butcher/grocer/textile/sweet-shop/retail/wholesale see KDS Analytics and Menu
Engineering; restaurant and cafe never see their own analytics** — and restaurant/cafe/repair_shop
(businesses that buy stock) lose all Procurement reports. No per-tab mode gating exists (only 2 tabs
in the whole surface carry a flag).

### D-3 · MISSING (all industries) · FBR Invoices hidden despite flag ON
`GET /api/feature-flags` (`registerAllRoutes.js:385-406`) merges by iterating `DEFAULT_FEATURE_FLAGS`
keys only; `fbr_integration` (DB-seeded ON by the PK country pack, `country-packs.js:25`) is dropped
from the response — verified in fresh captures (DB row `enabled=true`, API response lacks the key).
Sidebar "FBR Invoices" (requiredFlag) never shows; `/fbr` dashboard unreachable from nav for every
tenant. Not industry leakage, but a per-industry MISSING on a flagship compliance surface.

### D-4 · MISSING (flagship) · Dead portal tabs — gym, repair_shop, 4 rental presets
`PORTAL_ENABLED_TABS_BY_PRESET` promises `subscriptions` (gym "My Memberships"), `tickets`
(repair_shop "Repair Tickets"), `contracts` (rentals "Rental Agreements"/"Equipment Rentals"/
"Rental Contracts"/"Event Bookings"). Portal nav renders them (`PortalLayout.jsx:150-167`,
`TAB_PATHS[tab] || tab`), flags are ON, but **no route exists** in `publicRoutes.jsx:236-254` and no
component exists → clicking lands on an empty outlet. For these 6 industries the portal's flagship
tab is a dead link. (Implemented tabs verified working: treatments, stays, packages, gallery, forms,
appointments, invoices, orders, loyalty, wallet, profile.)

### D-5 · LEAK (structural) · Retail spine never subtracted — all 8 service-family industries
Verified nav derivation across all 23 tenants: modes only ADD sidebar groups; nothing is removed.
A dental clinic, hotel, salon, or car-rental admin sees the full retail spine: Catalog (Products/
Categories/Brands/Attribute Sets/Promotions/Price Lists/Smart Collections/Scheduled Changes),
Inventory (Audit/Adjustments/Transfers/Reorder Alerts), Procurement (Suppliers/POs/Supplier
Returns/Payables), Fulfillment (+ Courier Settings), Online Store → View Storefront (zero gates,
`nav-config.js:152-157`; storefront itself is preset-blind — `routes/storefront.js:33-56` returns no
industry/labels), CRM/Quotations, full double-entry accounting, Barcode Templates, Import from
Shopify/Square. The reports surface hides Inventory for these presets while the sidebar shows it —
internally inconsistent. Softened (not cured) by vocabulary translation (see D-8).

### D-6 · MISSING · Dashboard widget config is largely decorative — worst for clinical + booking presets
Of the `dashboard_widgets` keys, only `inventory_alerts` is honored (`DashboardRedesign.jsx:252`).
`appointments_today` (salon/gym/clinic/dental/vet/physio/photography), `active_treatment_plans` and
`overdue_sessions` (clinical), `floor_plan` (restaurant) have **no consumer** — the industry
dashboards the presets promise don't exist. `top_products`/`trends`/`attendance` render for everyone
regardless of config. Bonus dead path: `hasMode("retail")` gates StaffOfDay/CashPosition
(`DashboardRedesign.jsx:65,208-213`) but no preset declares a "retail" mode → those cards flash
during load then vanish, for everyone. Real mode-gated widgets that DO work: wholesale A/R cards
(`:68,201-205`), field summary (flag+perm+reps `:173`).

### D-7 · POS reshaping — real but uneven
- **Weight/tare/PLU (butcher/grocery/sweet_shop): REAL** — `show_plu` renders a full PLU pad
  (`POSSearchArea.jsx:41`), `show_tare` a gross/tare/net weighted cell with 0.001 steps + Web Serial
  scale (`POSCartTable.jsx:22,109,218-291`). Behavior verified — see Behavior section.
- **`counter` layout (cafe): real only inside the restaurant shell** (`RestaurantCheckView.jsx:24-49`).
  For any non-restaurant preset `counter` silently falls back to grid (`POSSearchArea.jsx:100` binary
  ternary). Cafe is safe today only because it carries restaurant mode.
- **grid-vs-list is shallow in retail POS** — it only seeds the search-dropdown style and is
  user-overridable via localStorage; not a register reshape.
- **Rentals: zero POS integration** (no rental hits in `pos/`) — a rental "register" is the plain
  retail register; contracts live on a separate page.
- **Appointments POS entry gated by flag, salon walk-in by `industry_type === "salon"` literal,
  folios by mode** — three different gating systems on one screen (`POSSubHeader.jsx:40`,
  `POSCheckoutModal.jsx:93-99,157-158`).
- `unit_vocabulary` is consumed by the product form only — never by POS runtime (weighted behavior
  keys off `product.unit`).

### D-8 · MISLABELED · vocabulary — mostly real, with leaks at the edges
Working: POS cart/search/customer labels, receipt labels, sidebar nav translation
(`AppLayoutRedesign.jsx:87-107` swaps Customer(s)/Product(s)/Sales History/Parked Sales → hotel
"Rooms", butcher "Cuts", wholesale "Invoice History"), dashboard "Top X"/"Recent X" headings,
portal tab labels, public booking labels.
Leaks: DashboardTopProducts rows say "N **sold**" (`:31`) under a translated heading (odd for
clinics); PortalOrders page body is hardcoded "Order history"/"Order #" while its tab is renamed;
portal "forms" tab shows the raw key as its label; portal "Dashboard" tab not translatable;
breadcrumbs translate only Customer/Product; POS hardcodes "Sell", "Complete Payment", "Search by
Barcode/SKU/Price" placeholders. Lodging quirk: two different sidebar items both named "Rooms"
(translated Catalog→Products item vs the real Rooms group).

### D-9 · notes
- Public QR menu endpoint is not mode-gated (`public-restaurant.js:94`); protection is only at token
  issuance. Public booking page reachable for every preset (empty service list when none).
- Portal `wallet` is fully built but listed by no preset (URL-only). `addresses` is documented as a
  tab key in `industry-config.js:745` but is not a screen.
- `fbr_integration` ON for every PK tenant is country-pack behavior, not preset leakage.

---

## Behavior verification (flows driven on fresh local tenants)

See `LEAKS.md` § Behavior for full evidence; summary:

| Flow | Verdict |
|---|---|
| Butcher weight sale (decimal qty, gross/tare persisted, money math) | see LEAKS.md |
| Wholesale credit/AR (on-account sale, limit enforcement, aging) | see LEAKS.md |
| Dental tooth charting (dental chart preset end-to-end) | see LEAKS.md |
| Salon appointment → checkout → commission | see LEAKS.md |
| Hotel folio run (check-in → charges → POS charge-to-room → settle) | see LEAKS.md |
| Car rental checkout → return (availability, late fee, inspections) | see LEAKS.md |
