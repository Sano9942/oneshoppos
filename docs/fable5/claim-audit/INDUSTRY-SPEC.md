# Industry Surface Spec — the yardstick (all 23 presets)

**What this is.** An opinionated "should have / should NOT have" spec for every industry preset in
`backend/config/industry-config.js`. This is the measuring stick for the see-vs-should-see matrix
(`MATRIX.md`). "Should" here means *what a real business of that type expects on day one*, not what
the code currently does. Written 2026-07-08 against main @ v126.

**Surface vocabulary used below** (from the actual app structure):

- **Nav groups** — sidebar groups in `frontend/src/ui/nav-config.js`: Overview, Sell, Customers,
  Catalog, Inventory, Procurement, Fulfillment, Field Sales, Online Store, Restaurant, Appointments,
  Service Operations, Rentals, Rooms, Clinical, Finance, Insights, People, Compliance, Setup, Account.
- **POS** — layout (`grid` / `list` / `counter`), search fields (barcode / SKU / price / PLU / tare),
  and checkout affordances (tenders, folio charging, appointment link, credit).
- **Dashboard** — widget set per `dashboard_widgets` + mode/flag-gated cards.
- **Reports** — groups per `visible_report_groups` (null = all 10 groups).
- **Portal** — customer portal tabs per `PORTAL_ENABLED_TABS_BY_PRESET`.
- **Vocabulary** — `labels` + `public_booking_labels` + `PORTAL_LABEL_OVERRIDES`.

Baseline expectations shared by every preset (not repeated 23×): Overview, Sell (scoped), Customers,
Finance (cash), Insights, People, Compliance (PK), Setup, Account nav; sales history; receipts;
attendance; cash management. The entries below only call out what *distinguishes* the industry.

---

## Family: counter retail (buy/sell)

### 1. general_retail — "Retail Store"
- **SHOULD**: full Catalog + Inventory + Procurement nav; grid POS with barcode+SKU+price search;
  inventory dashboard widgets (alerts, top products); all report groups; portal
  invoices/orders/loyalty; storefront link. Vocabulary: stock defaults (Product/Customer/Sale).
- **Should NOT**: Restaurant, Appointments, Rentals, Rooms, Clinical, Service Operations nav;
  restaurant-only report tabs (KDS Analytics, Menu Engineering); wholesale credit/AR surfaces;
  tooth charting; folio anything.

### 2. grocery — "Grocery / Supermarket"
- **SHOULD**: everything general_retail has **plus** PLU rapid-entry pad on POS, weighted-unit
  (kg/g) decimal quantities for loose produce, batch/expiry tracking surfaces (Expiring Soon),
  reorder alerts front-and-center. High-velocity checkout is the whole game.
- **Should NOT**: KDS/Menu Engineering reports; appointment calendar; teeth; folios; rental
  timeline. A grocer shown "Menu Engineering" is a claim-breaking leak.

### 3. butcher — "Butcher / Meat Shop"
- **SHOULD**: weight-first POS — list layout, scale/tare capture, PLU, decimal qty in kg/g;
  vocabulary "Cut/Cuts", quantity label "Weight"; kit/BOM (carcass → cuts disassembly) in
  Inventory/Production; batch/expiry. Portal minimal (invoices/orders).
- **Should NOT**: dental charting, appointment calendar, KDS analytics, menu engineering,
  room/folio surfaces, SKU-centric search (preset correctly hides SKU). The marketing claim
  names this preset explicitly ("a butcher sells by weight") — tare/weight must actually work.

### 4. sweet_shop — "Sweet Shop / Mithai"
- **SHOULD**: like butcher (weight+tare+PLU, kit/BOM for assorted boxes) but grid layout,
  vocabulary "Sweet/Sweets"; dozen/pack units; loyalty on portal (gift-heavy trade).
- **Should NOT**: same exclusions as butcher.

### 5. textile — "Textile / Fabric"
- **SHOULD**: length-based selling — m/cm decimal quantities, quantity label "Length",
  vocabulary "Fabric/Fabrics"; batch tracking (thaan/roll); price lists (wholesale-ish trade).
  No tare (correctly off).
- **Should NOT**: PLU pad is debatable but harmless; KDS/menu reports, clinical, rooms, rentals.

### 6. wholesale — "Wholesale / Distribution"
- **SHOULD**: everything retail has **plus** the B2B layer: credit limits & AR (Customers),
  AR aging/statements reports, payment terms, On-Account POS tender, Field Sales nav (routes,
  visits, van), schemes/slab promotions, backorders, manufacturer partners (Setup), MOQ config.
  Vocabulary "Buyer/Invoice". Portal: "Account Invoices" / "Purchase Orders" reorder flow.
- **Should NOT**: restaurant/clinical/rooms/rentals surfaces; appointment booking. This is the
  ONE preset where Credit/AR belongs — its presence anywhere else is the canonical leak.

## Family: food service

### 7. restaurant — "Restaurant"
- **SHOULD**: Restaurant nav group complete (floor plan, checks, 86'd, modifiers, day-parting,
  reservations, waitlist, online inbox, void/comp, KDS, tip pools, order kiosks); list POS in
  the restaurant shell (tables/seats/courses, fire-to-kitchen, pay-at-table, tips); "Menu Item /
  Menu / Guest / Order" vocabulary everywhere; floor-plan dashboard presence; **Restaurant report
  group (KDS Analytics, Menu Engineering) — this is *their* analytics**; portal "My Orders";
  QR menu. Inventory group visible (food stock) but menu-first.
- **Should NOT**: barcode/SKU POS search (correctly hidden); appointment calendar; charting;
  rental/room nav; wholesale credit nav; PLU/tare.

### 8. cafe — "Cafe / Fast Food / Counter"
- **SHOULD**: counter-mode POS (fast tile grid, no seats/courses) — the preset's whole point;
  KDS; modifiers; drive-thru option; loyalty; "Menu Item" vocabulary; Restaurant report group
  (menu engineering matters just as much at a cafe); QR/kiosk ordering.
- **Should NOT**: table reservations/waitlist emphasis is optional-but-fine; same exclusions as
  restaurant. Counter layout MUST actually render as a counter grid, not fall back to retail grid.

## Family: appointment services

### 9. salon — "Salon / Services"
- **SHOULD**: Appointments nav (services, calendar, bookings); walk-in + booking→checkout POS
  path with "performed by" staff attribution; commissions (People nav + reports); packages/passes;
  waitlist; loyalty + gift cards; SMS campaigns; "Service/Client/Appointment" vocabulary; public
  booking page ("Book an appointment", Stylist); portal My Bookings + packages + loyalty;
  appointments-today dashboard widget. Inventory de-emphasized (retail shelf optional).
- **Should NOT**: Inventory group in reports is correctly absent; Procurement nav is acceptable
  but low-value; KDS/menu reports, charting, folios, credit/AR, rentals, PLU/tare/barcode search.

### 10. gym — "Gym / Fitness Studio"
- **SHOULD**: memberships (Subscriptions nav + renewals), class timetable, waitlists, member
  check-in (door), packages/class passes, liability waiver forms, "Plan/Member/Enrollment"
  vocabulary, portal My Memberships + Class Bookings + Class Passes, public booking
  ("Book a session", Trainer). Appointments-today dashboard widget.
- **Should NOT**: inventory/procurement emphasis (protein-shake retail is optional); KDS/menu;
  charting; folios; credit/AR; PLU/tare. A dead "My Memberships" portal tab is worse than none.

### 11. photography_studio — "Photography / Creative Studio"
- **SHOULD**: projects + contracts (Service Operations nav), session bookings (Appointments),
  deposits/milestone invoicing, gallery proofing portal tab, questionnaires/forms,
  "Package/Client/Session" vocabulary, public booking ("Book a session", Photographer).
- **Should NOT**: inventory/stock surfaces beyond minimal; KDS/menu; charting; rooms; credit/AR.

## Family: clinical

### 12. clinic — "Clinic / Practice"
- **SHOULD**: Clinical nav (treatment plans, calendar, labs, templates, recalls); body charting;
  intake forms/consents; appointments; "Patient/Visit" vocabulary; portal My Treatments +
  appointments; clinical dashboard signals (active plans, overdue sessions, appointments today);
  **Clinical report group**; charge-to-plan folio at POS.
- **Should NOT**: Inventory/Procurement groups (correctly excluded); KDS/menu; barcode/SKU/PLU;
  credit/AR; rentals/rooms. A clinic seeing wholesale credit nav would be a headline leak.

### 13. dental_clinic — "Dental Clinic"
- **SHOULD**: everything clinic has, with **tooth charting** (dental chart preset), extraction/
  implant consents, "Procedure/Patient/Treatment Plan" vocabulary, portal My Treatment Plans,
  public booking "Book a consultation" with Dentist. The marketing claim names this preset
  ("a dentist charts teeth") — the dental chart must actually render and persist.
- **Should NOT**: same as clinic. A butcher-style weight pad or retail barcode row on a dental
  POS is claim-breaking.

### 14. veterinary — "Veterinary Practice"
- **SHOULD**: clinic base + pet subjects (owner ≠ patient), vet body chart, vaccinations
  register, euthanasia consent, "Owner" customer vocabulary, portal Pet Treatment Plans,
  public booking "Book your pet".
- **Should NOT**: same as clinic.

### 15. physiotherapy — "Physiotherapy Clinic"
- **SHOULD**: clinic base + session-based plans (multi-visit), handout library, session passes
  (packages), "Session" sale vocabulary, portal Sessions + Session Passes.
- **Should NOT**: same as clinic.

## Family: ticket service

### 16. repair_shop — "Repair / Service Shop"
- **SHOULD**: Service Operations nav (Tickets board), ticket lifecycle → invoice, deposits,
  estimates, warranty, parts inventory (Inventory nav IS relevant — parts), "Repair/Job Ticket"
  vocabulary, portal Repair Tickets tab (status tracking is the #1 customer ask).
- **Should NOT**: KDS/menu; charting; rooms; appointment calendar (tickets ≠ bookings);
  credit/AR; weight/PLU.

## Family: rentals

### 17. car_rental — "Car Rental / Vehicle Hire"
- **SHOULD**: Rentals nav (items/fleet, contracts, timeline); checkout→return lifecycle with
  condition inspections, deposits, late fees; car-legal fields; "Vehicle/Fleet/Renter/Contract"
  vocabulary; portal Rental Agreements tab with live contract status; availability calendar.
- **Should NOT**: KDS/menu reports; charting; barcode POS emphasis (SKU ok for fleet codes);
  PLU/tare; folios (rooms); credit/AR nav.

### 18. equipment_hire — "Equipment Hire / Tool Rental"
- **SHOULD**: same rental spine as car_rental (inspections, deposits, late fees, timeline);
  barcode ok (asset tags); "Equipment/Hire Contract" vocabulary; portal Equipment Rentals tab.
- **Should NOT**: same as car_rental.

### 19. furniture_rental — "Furniture / Events Rental"
- **SHOULD**: rental spine + multi-item event orders, delivery/pickup logistics; "Item/Client/
  Rental Order" vocabulary; portal Rental Contracts.
- **Should NOT**: same as car_rental.

### 20. party_supplies — "Party Supplies / Event Rental"
- **SHOULD**: rental spine + event-date centric booking; "Event Bookings" portal tab.
- **Should NOT**: same as car_rental.

## Family: lodging

### 21. hotel — "Hotel"
- **SHOULD**: Rooms nav (rooms, rates, bookings, calendar, arrivals/departures); **folio run** —
  check-in → charges accumulate on folio (incl. POS charge-to-room) → checkout settles; deposits;
  channel sync; guest registration (PK register); "Room/Guest/Charge/Booking" vocabulary; portal
  Guest Portal with My Stays; public "Book a stay". The marketing claim names this preset
  ("a hotel runs folios").
- **Should NOT**: Inventory/Procurement report groups (correctly excluded); barcode/SKU search;
  KDS/menu; charting; rental contracts nav; credit/AR.

### 22. guesthouse — "Guesthouse"
- **SHOULD**: hotel spine, smaller: rooms, rates, folio, arrivals; portal My Stays; "Book a room".
- **Should NOT**: same as hotel.

### 23. hostel — "Hostel"
- **SHOULD**: hotel spine with **bed-level inventory** (beds within rooms, parent_room_id),
  "Bed/Beds" vocabulary, "Book a bed" public flow; long-stay friendly rates.
- **Should NOT**: same as hotel.

---

## Cross-cutting "wrong to show anyone" rules

1. **Credit/AR & Field Sales** belong to wholesale only. Any other preset seeing wholesale
   surfaces (On-Account tender, AR aging nav, field routes) = LEAK, highest severity.
2. **KDS Analytics / Menu Engineering** belong to restaurant+cafe only. Their appearance for any
   null-group retail preset = LEAK; their absence for restaurant/cafe = MISSING.
3. **Clinical charting/plans** belong to the 4 clinical presets (+ generic clinic) only.
4. **Folio surfaces** belong to lodging (room folios) and clinical (plan folios) only.
5. **Weight/tare/PLU** belong to grocery/butcher/sweet_shop (+ textile length) only.
6. **A promised portal tab that renders a dead/empty screen is worse than not promising it** —
   grade as MISSING with LEAK-level severity when it's the industry's flagship tab.
7. **Generic retail vocabulary on a specialized preset's screen** (e.g. "N sold" on a clinic's
   top-services card, "Order #" on a salon portal) = MISLABELED.
