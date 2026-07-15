# Screen Gaps & Field-PWA Portability — 2026-07-15

Companion to `REPORT.md`. Answers three follow-on questions: which industries have no screen, what
screens could be built from endpoints that already exist, and whether the wholesale field-rep PWA
transfers to other verticals.

Same method/caveats as `REPORT.md`: source reads against `8ea54848`, nothing browser-verified.

---

## 1. Which presets have no vertical screen

All 23 presets, bucketed:

| Bucket | Count | Presets |
|---|---|---|
| **Has a vertical screen** | 4 | restaurant, cafe (KDS + `/menu/:token` + `/pay/:token` + restaurant POS + customer display = 5 surfaces); gym (member check-in kiosk); wholesale (field PWA — staff-facing, not customer) |
| **Generic customer display only** | 5 | general_retail, grocery, sweet_shop, butcher, textile |
| **No vertical screen at all** | **14** | salon; clinic, dental_clinic, veterinary, physiotherapy; car_rental, equipment_hire, furniture_rental, party_supplies; hotel, guesthouse, hostel; repair_shop; photography_studio |

The retail family's position is arguably correct — retail doesn't need more than a dual screen.
The 14 are the real gap.

---

## 2. What could be built from what already exists

**Start with the list that already exists.** `docs/fable5/frontend-coverage-audit/REPORT.md`
already answers "what can we build with what we have": **78 endpoints with no UI, in 10 clusters**,
its own conclusion being that each cluster is roughly "one page's worth of UI work consuming
already-tested endpoints." Don't re-derive it.

But most of those 78 are **pages and buttons, not screens**. On the screen question specifically:

### Two reusable screen archetypes exist, each used once

**The KDS archetype** — poll a ticket queue, render big, auto-refresh, wall-mount. Maps onto:
- **Repair-shop status board** — `ServiceTicketsRedesign` is already a board; a read-only
  customer-facing mirror is the cheapest screen on this list.
- **Clinic/salon waiting-room "now serving" display**
- **Lodging arrivals board**

**The customer-display archetype** — a second screen paired to a POS session. Already generic
across all industries, so **not** a gap.

### Screen-shaped clusters from the coverage audit

- **Lodging guest self-check-in** (cluster #3) — guest *document upload* (`rooms.js:421`) and guest
  removal (`:403`) endpoints exist with **no UI at all**. A guest kiosk capturing ID documents has
  backend support sitting there already.
- **Rental delivery/pickup proof** (cluster #2) — the entire per-asset tracking + maintenance layer
  from V09 has no UI, and `/rentals/deliveries` already exists as a route.

### Grounding caveats — do not treat as costed

- **The waiting-room screen is NOT zero-backend.** Appointment status values found in source:
  `confirmed`, `in_progress`, `cancelled`. There is **no `arrived` / `called` state**. A "now
  serving" queue needs a status addition first. Cheap, not free.
- **The repair board is "probably cheapest", not confirmed** — I could not pin down the
  service-ticket status enum (`backend/schemas/service-tickets.js` grep found only
  `z.enum(["part","labor","fee"])`, which is a line-type enum, not a ticket-status enum). Verify
  the status model before scoping.

---

## 3. Field-rep PWA portability — the blocker is one CHECK constraint

### The schema is generic

`field_visits` (`backend/migrate-pg.js:6560`, migration v90):

```sql
CREATE TABLE IF NOT EXISTS field_visits (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  outlet_id INTEGER REFERENCES outlets(id),
  planned_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  gps_lat NUMERIC(9,6), gps_lng NUMERIC(9,6),
  gps_accuracy_m INTEGER, gps_distance_m INTEGER, gps_flagged BOOLEAN DEFAULT false,
  selfie_url TEXT,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','checked_in','ordered','no_stock_needed','shop_closed','owner_away')),
  client_uuid TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Nothing in those columns is wholesale.** The model is "a staff member went to a customer's
location, at this time, with GPS proof and a selfie." Industry-agnostic. The geofence
(`company_profile.field_geofence_meters` vs customer lat/lng), selfie compression
(`utils/imageCompress.js`), and the offline queue (`check_in` / `field_order` types) are all
generic too.

### The three wholesale couplings

1. **The status CHECK constraint — the real schema-level blocker.**
   `'shop_closed'`, `'owner_away'`, `'no_stock_needed'` are FMCG beat-plan outcomes — a distributor
   visiting a kiryana store. A home-salon visit needs "customer not home"; a physio visit needs
   "patient cancelled". Extending the CHECK is a migration.
2. **`field_rep_routes`** — a planned beat of N customers/day. A distribution concept.
   Appointment-driven verticals don't have a beat, they have a calendar. Visits would need to be
   sourced from an **appointment** (F06 scheduling already exists) rather than a route.
3. **Order capture** — price lists, MOQ, case-pack (`services/moq.js`). Wholesale-priced. A
   home-salon visit wants the service/appointment checkout flow instead.

Plus a non-code blocker: the flag is `wholesale_field_sales` (`routes/field.js:68`), so a salon
tenant would have to switch on a module called "wholesale". That's a **Business Modules catalog
classification problem**, not a code one.

### The clean split

> **The check-in half transfers almost free. The route + order-capture half does not.**

Reusable as-is: GPS + selfie check-in/out, geofence, visit log, offline queue.
Wholesale-shaped: route planning, order capture.
Missing: a `visit` abstraction sourceable from **either** a route (wholesale) **or** an appointment
(services).

### Where it would fit

- **Salon home service** — appointment → travel → check-in at customer address → perform → checkout
- **Physio home visits / home nursing** — same shape
- **Veterinary farm/livestock or home visits** — GPS proof matters more here than in wholesale
- **On-site repair** (AC/appliance) — ticket → travel → check-in → parts → invoice
- **Rental delivery/pickup** — contract → deliver → GPS proof + condition photos.
  `/rentals/deliveries` is a **latent second consumer already in the route table**.
- **Photography on-location shoots** — project → shoot at venue

### Work shape

Extended status vocabulary (migration) + a visit abstraction with two sources (route | appointment)
+ flag rename/reclassification. **This is design thinking on top of a verified schema read, not a
plan** — the field pages' assumptions about routes were not audited, and may be deeper than this
implies.

### Incidental

`field_visits` appears in `migrate-pg.js` but a grep of `schema-pg.sql` did not find it — would be
consistent with the known non-restaurant schema drift ([[followup_b15_schema_drift]]). Worth
confirming separately if `schema-pg.sql` is meant to be the source of truth.
