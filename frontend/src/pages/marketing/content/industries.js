// Marketing-site industry-family content. Copy source of truth:
// docs/fable5/marketing-site/COPY-DECK.md — every claim traces to the
// feature→proof table in PLAN.md. No invented capabilities.
import retailPos from "../../../assets/marketing/retail-pos.webp";
import retailDashboard from "../../../assets/marketing/retail-dashboard.webp";
import restaurantFloor from "../../../assets/marketing/restaurant-floor.webp";
import salonCalendar from "../../../assets/marketing/salon-calendar.webp";
import clinicPlans from "../../../assets/marketing/clinic-plans.webp";
import gymTimetable from "../../../assets/marketing/gym-timetable.webp";
import wholesaleCustomers from "../../../assets/marketing/wholesale-customers.webp";
import rentalContracts from "../../../assets/marketing/rental-contracts.webp";
import hotelRooms from "../../../assets/marketing/hotel-rooms.webp";
import repairTickets from "../../../assets/marketing/repair-tickets.webp";
import photoProjects from "../../../assets/marketing/photo-projects.webp";

export { retailPos, retailDashboard };

export const INDUSTRIES = [
  {
    slug: "retail",
    name: "Retail & Grocery",
    chip: "Retail",
    presets: ["General retail", "Grocery", "Butcher", "Sweet shop", "Textile"],
    cardLine: "Barcode lanes, weight-based selling, batch & expiry, loyalty.",
    shot: retailPos,
    shotAlt: "SanoPOS retail point of sale with a cart of three items",
    metaTitle: "Retail & Grocery POS — SanoPOS",
    metaDescription:
      "Barcode checkout, weight-based selling, batch & expiry tracking, loyalty and multi-outlet stock — one POS for shops, marts, butchers, sweet shops and fabric stores.",
    h1: "Run the counter. Own the stock.",
    sub: "From a corner shop to a multi-branch mart — barcode lanes, weighted items, expiry-tracked batches and a loyalty program your customers actually join.",
    blocks: [
      {
        kicker: "Checkout",
        title: "Scan, weigh, sell.",
        body: "Barcode, SKU or price search, a PLU rapid-entry pad for loose produce, scale-embedded barcode decoding, and tare weights for anything sold by the kilo — meat, sweets, fabric by the meter.",
        bullets: ["Barcode / SKU / price search", "PLU pad for loose produce", "Weight & tare support", "Offline sale queue"],
      },
      {
        kicker: "Freshness",
        title: "Batches that expire before you notice? Not anymore.",
        body: "Per-batch expiry dates with first-expiry-first-out picking, expiring-soon alerts and batch reports for anything perishable.",
        bullets: ["FEFO batch picking", "Expiring-soon alerts", "Batch-level reports"],
      },
      {
        kicker: "Production",
        title: "From carcass to cuts, from trays to gift boxes.",
        body: "The recipe and kit engine handles disassembly — a carcass broken into priced cuts — and assembly, like an assorted sweets box, with stock that stays true on both sides.",
        bullets: ["Disassembly (carcass → cuts)", "Kits & assortment boxes", "Stock stays consistent"],
      },
      {
        kicker: "Retail intelligence",
        title: "Know what to reorder before you run out.",
        body: "ABC classification, sales velocity, dead-stock detection and reorder suggestions — plus cycle counts you can run without closing the shop.",
        bullets: ["ABC classification", "Reorder suggestions", "Cycle counts", "Dead-stock reports"],
      },
      {
        kicker: "Customers",
        title: "Loyalty, gift cards, holds.",
        body: "Points and tiers, gift cards, layaway and holds, and a weekly digest of the numbers in your inbox every Monday.",
        bullets: ["Loyalty points & tiers", "Gift cards", "Layaway / holds", "Weekly owner digest"],
      },
    ],
    portalLine:
      "Customers get a self-service portal with invoices, order history and loyalty — and an embedded storefront when you want to sell online.",
    faq: [
      { q: "Do you support selling by weight?", a: "Yes — kilograms, grams and pounds with tare weights, plus meters and centimeters for fabric. Weighted products take decimal quantities at the POS." },
      { q: "Can I run more than one branch?", a: "Yes — stock transfers, per-outlet stock and outlet-level pricing are built in. Additional outlets are paid add-ons on the Pro plan." },
      { q: "Does it work when the internet goes down?", a: "Yes. Sales queue locally on the device and sync automatically the moment the connection returns." },
    ],
  },
  {
    slug: "restaurants",
    name: "Restaurants & Cafes",
    chip: "Restaurant",
    presets: ["Restaurant", "Cafe / counter service"],
    cardLine: "Floor plans, kitchen display, QR ordering, tabs and tips.",
    shot: restaurantFloor,
    shotAlt: "SanoPOS restaurant floor plan with tables",
    metaTitle: "Restaurant & Cafe POS — SanoPOS",
    metaDescription:
      "Floor plans, kitchen display, QR ordering, tabs, split checks, tips and delivery order capture — a POS built for service, counter and delivery.",
    h1: "From table one to the kitchen pass.",
    sub: "Floor plan, kitchen display, QR menus and a counter mode for cafes — with tips, split checks and delivery orders landing in the same queue.",
    blocks: [
      {
        kicker: "Front of house",
        title: "Tables, tabs, courses.",
        body: "A visual floor plan, open tabs, seat-level ordering, splitting by item or by seat, course firing and fire chits — service stays in rhythm even on a full house.",
        bullets: ["Visual floor plan", "Tabs & seat-level orders", "Split by item or seat", "Course firing & fire chits"],
      },
      {
        kicker: "Kitchen",
        title: "A KDS your kitchen keeps up with.",
        body: "Kitchen display with station routing, bump and recall, prep-time analytics, and an 86 board so the floor always knows what's out.",
        bullets: ["Station routing", "Bump / recall", "Prep analytics", "86 board"],
      },
      {
        kicker: "Self-serve",
        title: "QR menus and a counter kiosk.",
        body: "Guests order from the table through a QR menu, pay at the table, or order themselves at a customer-facing kiosk in counter mode.",
        bullets: ["QR table ordering", "Pay-at-table links", "Customer kiosk (counter mode)"],
      },
      {
        kicker: "Delivery",
        title: "Every delivery order in one inbox.",
        body: "Connect foodpanda and Careem, capture web orders, dispatch with courier integrations and reconcile cash-on-delivery — one queue, not four tablets.",
        bullets: ["foodpanda & Careem capture", "Online-order inbox", "Courier dispatch", "COD reconciliation"],
      },
      {
        kicker: "The money",
        title: "Tips, comps and menu engineering.",
        body: "Tip capture and pooling, void and comp with manager override, day-parting menus, and menu-engineering reports that show what actually earns.",
        bullets: ["Tip capture & pooling", "Void / comp with manager PIN", "Day-parting menus", "Menu engineering"],
      },
    ],
    portalLine:
      "Guests get order history and loyalty in their own portal; your QR menu and pay-at-table pages need nothing installed.",
    faq: [
      { q: "How is cafe mode different?", a: "The cafe preset runs a counter-first POS layout — fast repeat orders, no table map required. You can still turn on any restaurant feature you need." },
      { q: "Can guests pay at the table?", a: "Yes — each check gets a QR pay link, so guests settle without flagging a server." },
    ],
  },
  {
    slug: "salons",
    name: "Salons & Spas",
    chip: "Salon",
    presets: ["Salon / services"],
    cardLine: "Appointment calendar, commissions, packages, waitlists.",
    shot: salonCalendar,
    shotAlt: "SanoPOS salon appointment calendar week view",
    metaTitle: "Salon & Spa Software — SanoPOS",
    metaDescription:
      "Appointment calendar, staff commissions, packages and passes, waitlists and online booking — salon software with a real POS underneath.",
    h1: "Booked solid, paid right.",
    sub: "A calendar your front desk lives in, commissions your stylists trust, and packages that keep clients coming back.",
    blocks: [
      {
        kicker: "Calendar",
        title: "Appointments without the phone tag.",
        body: "A staff-wise calendar, an online booking page your clients use themselves, waitlists when slots fill, and walk-ins assigned to whoever performed the service.",
        bullets: ["Staff-wise calendar", "Online booking page", "Waitlists on full slots", "Walk-in assignment"],
      },
      {
        kicker: "Commissions",
        title: "Every service, credited to the right stylist.",
        body: "Commission plans per employee or per service. Earnings are tracked at checkout and reported per staff member — no spreadsheet arguments on payday.",
        bullets: ["Per-employee / per-service plans", "Tracked at checkout", "Per-staff reports"],
      },
      {
        kicker: "Packages",
        title: "Sell six sessions, redeem six sessions.",
        body: "Facial packs, session bundles and passes — sold once, tracked to every visit, visible to the client in their portal.",
        bullets: ["Session packages", "Passes", "Redemption tracking"],
      },
      {
        kicker: "Retention",
        title: "Loyalty, gift cards and SMS.",
        body: "Points, gift cards for gifting season, and SMS campaigns for reminders and birthdays — the tools that fill quiet weekdays.",
        bullets: ["Loyalty points", "Gift cards", "SMS campaigns"],
      },
    ],
    portalLine:
      "Clients book online in your vocabulary — \"Book an appointment\", with your services and stylists — and see their bookings, packages, invoices and loyalty in their own portal.",
    faq: [
      { q: "Can clients book online?", a: "Yes — a public booking page lists your services and staff, with a minimum-notice guard so nobody books 5 minutes ahead." },
      { q: "Can clients see their history?", a: "Yes — the client portal shows bookings, packages, invoices and loyalty points." },
    ],
  },
  {
    slug: "clinics",
    name: "Clinics",
    chip: "Clinic",
    presets: ["Medical clinic", "Dental clinic", "Veterinary practice", "Physiotherapy clinic"],
    cardLine: "Treatment plans, charting, recalls, consent and intake forms.",
    shot: clinicPlans,
    shotAlt: "SanoPOS clinical treatment plans list",
    metaTitle: "Clinic Software — Medical, Dental, Veterinary, Physio — SanoPOS",
    metaDescription:
      "Treatment plans, clinical charting, recalls, consent and intake forms, deposits and patient portals — one system for clinics of every kind.",
    h1: "The clinical record and the cash register, finally in one place.",
    sub: "Multi-visit treatment plans, specialty charting and patient recalls — connected to billing, deposits and a patient portal. Presets for medical, dental, veterinary and physiotherapy practices.",
    blocks: [
      {
        kicker: "Treatment plans",
        title: "Plan the course, track every visit.",
        body: "Multi-session treatment plans with per-visit progress, overdue-session alerts on the dashboard, and plan-level billing folios that keep the money attached to the care.",
        bullets: ["Multi-session plans", "Overdue-session alerts", "Plan billing folios"],
      },
      {
        kicker: "Charting",
        title: "Charts that match your specialty.",
        body: "Body charts for general practice and physio, tooth charts for dental, animal charts for veterinary — with consent templates for your specialty, from anaesthesia to extraction to surgery.",
        bullets: ["Body / dental / veterinary charts", "Specialty consent templates", "Lab orders"],
      },
      {
        kicker: "Recalls & intake",
        title: "Patients come back because you asked.",
        body: "A recall engine for checkups that are due, and digital intake and consent forms your patients fill before the visit — not on a clipboard in the waiting room.",
        bullets: ["Recall engine", "Digital intake forms", "Consent capture"],
      },
      {
        kicker: "Specialty extras",
        title: "Vaccination records for vets. Exercise handouts for physios.",
        body: "Each clinical preset switches on what that practice needs — vaccination tracking for veterinary, an exercise handout library for physiotherapy.",
        bullets: ["Vet vaccination records", "Physio handout library", "Per-preset configuration"],
      },
      {
        kicker: "Money",
        title: "Deposits and settled folios.",
        body: "Plan deposits held up front, visit charges accumulated on the folio, settled cleanly at the end — with a Clinical report group for the practice owner.",
        bullets: ["Plan deposits", "Visit folios", "Clinical reports"],
      },
    ],
    portalLine:
      "Patients see their treatment plans, appointments and invoices in their own portal — \"My Treatments\", not a phone call to reception.",
    faq: [
      { q: "Is it one product for all four clinic types?", a: "One product, four presets. Each preset changes the charts, consent templates, vocabulary and portal tabs to match the practice." },
      { q: "Can patients see their plan?", a: "Yes — the patient portal has a My Treatments tab with plan progress and sessions." },
    ],
  },
  {
    slug: "gyms",
    name: "Gyms & Fitness",
    chip: "Gym",
    presets: ["Gym / fitness studio"],
    cardLine: "Memberships, class timetables, waivers, door check-in.",
    shot: gymTimetable,
    shotAlt: "SanoPOS gym class timetable",
    metaTitle: "Gym Management Software — SanoPOS",
    metaDescription:
      "Recurring memberships, class timetables with waitlists, PT passes, liability waivers and a member check-in kiosk — gym software with retail POS built in.",
    h1: "Memberships that renew. Classes that fill.",
    sub: "Recurring billing, a class timetable with waitlists, digital waivers and a door check-in kiosk — plus a real POS for the shake bar and merch.",
    blocks: [
      {
        kicker: "Memberships",
        title: "Recurring billing on autopilot.",
        body: "Plans, renewals, pause and resume — member status is derived from one source of truth, so the front desk never has to guess who's active.",
        bullets: ["Recurring plans & renewals", "Pause / resume", "One status source of truth"],
      },
      {
        kicker: "Classes",
        title: "A timetable members book themselves.",
        body: "Group classes with trainer schedules, waitlists when a class fills, and class passes or PT packs sold and redeemed per session.",
        bullets: ["Class timetable", "Waitlists on full classes", "Class passes & PT packs"],
      },
      {
        kicker: "The door",
        title: "Self check-in at the entrance.",
        body: "A member check-in kiosk that runs on any tablet at the door — members check themselves in, staff see who's inside.",
        bullets: ["Tablet check-in kiosk", "Member status at a glance"],
      },
      {
        kicker: "Paperwork",
        title: "Waivers signed before the first session.",
        body: "Digital liability waivers attached to the member record — filled on signup, stored forever, never lost in a filing cabinet.",
        bullets: ["Digital waivers", "Attached to member record"],
      },
    ],
    portalLine:
      "Members manage their own memberships, class bookings and passes in the portal — fewer front-desk questions, fuller classes.",
    faq: [
      { q: "Can members manage their own account?", a: "Yes — the member portal shows memberships, class bookings and passes, and lets them book classes directly." },
      { q: "Can I sell products too?", a: "Yes — the full retail POS is included, so supplements, apparel and the shake bar run through the same system." },
    ],
  },
  {
    slug: "wholesale",
    name: "Wholesale & Distribution",
    chip: "Wholesale",
    presets: ["Wholesale / distribution"],
    cardLine: "Credit limits, AR aging, field reps, trade schemes.",
    shot: wholesaleCustomers,
    shotAlt: "SanoPOS wholesale buyers list",
    metaTitle: "Wholesale & Distribution Software — SanoPOS",
    metaDescription:
      "Credit limits, AR aging, statements, field sales reps with GPS check-in, trade schemes, backorders and van sales — B2B distribution on one system.",
    h1: "Credit-side selling, under control.",
    sub: "On-account invoices with real credit limits, receivables you can age and chase, reps in the field, and trade schemes that apply themselves.",
    blocks: [
      {
        kicker: "Credit & AR",
        title: "Sell on account without losing sleep.",
        body: "Per-buyer credit limits and payment terms, block modes when a limit is breached, AR aging buckets and monthly statements — the credit book stops living in someone's head.",
        bullets: ["Credit limits & terms", "Block modes on breach", "AR aging buckets", "Customer statements"],
      },
      {
        kicker: "Field sales",
        title: "Your reps, on their phones, on the record.",
        body: "A mobile app for order bookers: GPS and selfie check-in at the shop, order capture on the spot, and every visit linked to the sale it produced. Works offline on the route.",
        bullets: ["GPS + selfie check-in", "On-the-spot order capture", "Offline queueing", "Visit → sale linkage"],
      },
      {
        kicker: "Schemes",
        title: "Slab and tier promotions that calculate themselves.",
        body: "Brand-scoped trade schemes with slab tiers, applied automatically at invoicing — and an audit snapshot frozen on every invoice so disputes end fast.",
        bullets: ["Slab / tier schemes", "Brand scoping", "Frozen audit snapshot"],
      },
      {
        kicker: "Fulfillment",
        title: "Backorders, van sales, MOQ.",
        body: "Partial fulfillment with backorders, van-based selling for route sales, and minimum order quantities with case-pack rules for the portal and reps — never in the way at the counter.",
        bullets: ["Backorders & partial fulfillment", "Van sales", "MOQ + case-pack rules"],
      },
      {
        kicker: "Manufacturers",
        title: "Give your principals a window, not your books.",
        body: "A separate manufacturer portal shows your principals the onward sales of their brands — city-level only. Your customer identities stay yours.",
        bullets: ["Manufacturer portal", "Brand-scoped visibility", "No customer identities exposed"],
      },
    ],
    portalLine:
      "Buyers reorder in their own portal — account invoices, purchase orders, and a catalog scoped to their customer group.",
    faq: [
      { q: "Can buyers reorder online?", a: "Yes — the buyer portal shows account invoices and purchase orders, with catalog visibility per customer group and MOQ rules enforced." },
      { q: "Do reps need mobile signal all day?", a: "No — check-ins and orders queue offline on the rep's phone and sync when coverage returns." },
    ],
  },
  {
    slug: "rentals",
    name: "Rentals",
    chip: "Rentals",
    presets: ["Car rental", "Equipment hire", "Furniture rental", "Party supplies"],
    cardLine: "Contracts, check-out/return, inspections, late fees, deposits.",
    shot: rentalContracts,
    shotAlt: "SanoPOS rental contracts",
    metaTitle: "Rental Business Software — SanoPOS",
    metaDescription:
      "Rental contracts, check-out and return, condition inspections, late fees, deposits and availability — for car hire, equipment, furniture and event rentals.",
    h1: "Everything out. Everything back.",
    sub: "Contracts from booking to return — with inspections, deposits, late fees and an availability view that stops double-booking. Presets for car hire, equipment, furniture and party supplies.",
    blocks: [
      {
        kicker: "Contracts",
        title: "One lifecycle, no gaps.",
        body: "Quote, confirm, check out, return, complete — one contract carries the whole rental, with the paperwork generated along the way.",
        bullets: ["Full contract lifecycle", "Agreements & signatures", "Contract invoicing"],
      },
      {
        kicker: "Condition",
        title: "Inspections on the way out and the way in.",
        body: "Condition checklists are on by default for every rental preset — so the damage argument ends before it starts.",
        bullets: ["Check-out inspections", "Return inspections", "On by default"],
      },
      {
        kicker: "Money",
        title: "Deposits and late fees, computed not argued.",
        body: "Deposits held and released on completion. Overdue detection runs in the background and late fees are calculated automatically.",
        bullets: ["Deposit hold & release", "Automatic overdue detection", "Computed late fees"],
      },
      {
        kicker: "Availability",
        title: "Know what's on the shelf next Friday.",
        body: "Asset-level availability across every contract, so the same vehicle, mixer or marquee is never promised twice.",
        bullets: ["Asset-level availability", "No double-booking"],
      },
    ],
    portalLine:
      "Customers see their rental agreements and invoices in the portal; online rental booking is available as an opt-in.",
    faq: [
      { q: "Are there vehicle-specific features?", a: "Yes — the car-hire preset adds vehicle and driver legal fields to contracts." },
      { q: "Can customers book online?", a: "Optionally — online rental booking is an opt-in per store, so you decide when to open the calendar." },
    ],
  },
  {
    slug: "hotels",
    name: "Hotels & Lodging",
    chip: "Hotel",
    presets: ["Hotel", "Guesthouse", "Hostel"],
    cardLine: "Rooms, rate calendars, folios, housekeeping, channel sync.",
    shot: hotelRooms,
    shotAlt: "SanoPOS hotel rooms board with room types and occupancy",
    metaTitle: "Hotel, Guesthouse & Hostel Software — SanoPOS",
    metaDescription:
      "Rooms and rate calendars, bookings, guest folios, deposits, housekeeping, channel sync and a public booking page — lodging management with POS built in.",
    h1: "Front desk to folio, one screen.",
    sub: "Rooms, rates, check-in and folios that collect every charge — with deposits pre-authorized and OTA calendars kept in sync. Presets for hotels, guesthouses and hostels.",
    blocks: [
      {
        kicker: "Rooms & rates",
        title: "Room inventory with a rate calendar.",
        body: "Room types with per-date rate overrides, housekeeping status per room, and tax-inclusive rates where your market expects them.",
        bullets: ["Room types & rate overrides", "Housekeeping status", "Tax-inclusive rates"],
      },
      {
        kicker: "Stays",
        title: "Book, confirm, check in, check out.",
        body: "The full booking lifecycle including no-shows and group bookings — and the hostel preset books per-bed, not per-room.",
        bullets: ["Full booking lifecycle", "No-show handling", "Per-bed hostel mode"],
      },
      {
        kicker: "Folios",
        title: "Every charge finds the room.",
        body: "Restaurant and shop charges post straight to the guest folio, and the whole stay settles at checkout — one bill, no sticky notes.",
        bullets: ["Charge-to-room from POS", "Folio lines & settlement", "Night audit"],
      },
      {
        kicker: "Deposits & channels",
        title: "Deposits pre-authorized, calendars in sync.",
        body: "Card deposits pre-authorized at booking and captured at checkout. iCal channel sync keeps your OTA availability honest, and a guest register is maintained where regulation requires it.",
        bullets: ["Deposit pre-auth", "iCal channel sync", "Guest register"],
      },
    ],
    portalLine:
      "Guests book on your public \"Book a stay\" page (opt-in) and see their stays and invoices in the guest portal.",
    faq: [
      { q: "Can guests book direct?", a: "Yes — a public booking page is available as an opt-in, so direct bookings skip the OTA commission." },
      { q: "Does it handle hostels?", a: "Yes — the hostel preset books per-bed with beds grouped under parent rooms." },
    ],
  },
  {
    slug: "repair-shops",
    name: "Repair Shops",
    chip: "Repair",
    presets: ["Repair / service shop"],
    cardLine: "Job tickets, estimates, deposits, warranty, invoice-from-ticket.",
    shot: repairTickets,
    shotAlt: "SanoPOS repair job tickets",
    metaTitle: "Repair Shop Software — SanoPOS",
    metaDescription:
      "Job tickets, estimates, deposits, status boards, warranty tracking and invoice-from-ticket — for phone, computer, appliance and workshop repair.",
    h1: "Every job on the board. Every dollar on the ticket.",
    sub: "Intake to invoice on one ticket — estimates, deposits, parts, status updates and warranty, visible to the customer the whole way.",
    blocks: [
      {
        kicker: "Tickets",
        title: "A workflow board the whole shop reads.",
        body: "Ticket intake with device details, statuses that move across the board, and an activity log on every job — nothing lives on a whiteboard anymore.",
        bullets: ["Device intake details", "Status workflow", "Per-job activity log"],
      },
      {
        kicker: "Estimates & deposits",
        title: "Approve first, repair second.",
        body: "Estimates sent from the ticket, deposits collected up front — so the awkward money conversation happens before the work, not after.",
        bullets: ["Estimates from the ticket", "Up-front deposits"],
      },
      {
        kicker: "Invoice from ticket",
        title: "The ticket becomes the bill.",
        body: "One click turns a resolved ticket into the final invoice — parts and labor included, nothing re-typed.",
        bullets: ["One-click invoicing", "Parts + labor on the ticket"],
      },
      {
        kicker: "Warranty",
        title: "Know what's covered before the customer asks.",
        body: "Warranty tracking on completed jobs, so a returning device gets an answer in seconds.",
        bullets: ["Warranty tracking", "Repair history per customer"],
      },
    ],
    portalLine:
      "Customers check their repair status themselves — a Repair Tickets tab in the customer portal instead of a phone call an hour.",
    faq: [
      { q: "Can customers check repair status?", a: "Yes — the customer portal has a Repair Tickets tab with live status." },
      { q: "Does it manage parts stock?", a: "Yes — the full inventory system is included: parts, suppliers, purchasing and receiving." },
    ],
  },
  {
    slug: "photographers",
    name: "Photography & Creative",
    chip: "Studio",
    presets: ["Photography / creative studio"],
    cardLine: "Inquiries, projects, contracts, milestone billing, galleries.",
    shot: photoProjects,
    shotAlt: "SanoPOS studio projects with milestones",
    metaTitle: "Photography Studio Software — SanoPOS",
    metaDescription:
      "Inquiry capture, quotes, projects, contracts, milestone invoicing, client questionnaires and gallery proofing — the business side of the studio.",
    h1: "You shoot. It runs the studio.",
    sub: "From the first inquiry to the final gallery — quotes, contracts, milestone billing and client proofing in one flow.",
    blocks: [
      {
        kicker: "Leads",
        title: "Inquiries become leads, not lost DMs.",
        body: "A public inquiry page feeds straight into your pipeline — every prospective shoot lands somewhere you'll actually see it.",
        bullets: ["Public inquiry page", "Lead pipeline"],
      },
      {
        kicker: "Projects",
        title: "Quote → project → contract → paid.",
        body: "Quotations convert to projects, contracts get signed, and milestone invoicing bills the work as it lands — deposits up front, balance on delivery.",
        bullets: ["Quotation → project conversion", "Contracts & signatures", "Milestone invoicing"],
      },
      {
        kicker: "Client prep",
        title: "Questionnaires answered before the shoot.",
        body: "Client questionnaires attach automatically to bookings — shot lists, preferences and details collected while you're still planning.",
        bullets: ["Auto-attached questionnaires", "Pre-shoot details"],
      },
      {
        kicker: "Delivery",
        title: "Proofing in the client's own portal.",
        body: "Gallery proofing lives in the client portal — clients review and respond without a third-party gallery subscription.",
        bullets: ["Gallery proofing", "Client feedback", "No extra subscription"],
      },
    ],
    portalLine:
      "Clients book sessions on your public page and review galleries in their own portal — one brand experience end to end.",
    faq: [
      { q: "Can clients book sessions online?", a: "Yes — the appointment engine includes a public \"Book a session\" page." },
      { q: "Can I sell packages?", a: "Yes — packages are your catalog; sell them at the counter, on invoices or through projects." },
    ],
  },
];

export const bySlug = (slug) => INDUSTRIES.find((i) => i.slug === slug) || null;
