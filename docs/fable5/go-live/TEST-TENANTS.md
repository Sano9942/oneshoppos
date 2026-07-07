# Per-Industry Test Tenants (created 2026-07-07, post v122 deploy)

> One fresh tenant per industry preset, created AFTER the v122 deploy through the real
> provision → email-verify → setup-wizard path, so every one natively carries the latest
> migrations. They exist **twice with identical slugs and credentials**: once in LOCAL
> `sanopos_dev` and once in PRODUCTION (Supabase).

## Credentials (same for all 46 tenants)

| Field | Value |
|---|---|
| Slug pattern | `golv_<industry>` |
| Login user | `Owner` |
| PIN / password | `1234` (PIN fallback works as the dashboard password) |
| Kiosk / POS re-auth PIN | `1234` |
| Owner email | `sanomerchandise+golv_<industry>@gmail.com` |
| Currency / TZ / tax | PKR · Asia/Karachi · tax_mode `none` |
| Plan | free (45-day trial → warns ~mid-Aug 2026, read-only ~2026-08-21 unless extended/deleted in `/admin`) |

Login URLs: production `https://sanopos.com/login` (store code = slug) · local `http://localhost:5173/login`.
Note: `POST /api/auth/mt-login` takes `tenant_slug` in the **body**, not `?tenant=`.

## The 23 tenants

| Slug | Industry preset | Modes seeded |
|---|---|---|
| `golv_general_retail` | Retail Store | (none — core spine) |
| `golv_grocery` | Grocery / Supermarket | (none) + PLU pad, batch flags |
| `golv_butcher` | Butcher / Meat Shop | (none) + batch + kit/BOM flags |
| `golv_sweet_shop` | Sweet Shop / Mithai | (none) + batch + kit/BOM flags |
| `golv_textile` | Textile / Fabric | (none) + batch flags |
| `golv_wholesale` | Wholesale / Distribution | wholesale (+ backorders, van sales, credit, field, schemes, secondary-sales flags) |
| `golv_restaurant` | Restaurant | restaurant |
| `golv_cafe` | Cafe / Fast Food / Counter | restaurant (counter POS layout) |
| `golv_salon` | Salon / Services | appointments, commissions (+ packages, waitlist, loyalty, gift cards, SMS) |
| `golv_clinic` | Clinic / Practice | appointments, treatment_plans (+ recalls, forms) |
| `golv_dental_clinic` | Dental Clinic | appointments, treatment_plans (+ recalls, forms) |
| `golv_veterinary` | Veterinary Practice | appointments, treatment_plans (+ recalls, forms, vaccinations) |
| `golv_physiotherapy` | Physiotherapy Clinic | appointments, treatment_plans (+ recalls, forms, handouts) |
| `golv_repair_shop` | Repair / Service Shop | workflow_tickets |
| `golv_gym` | Gym / Fitness Studio | appointments, subscriptions (+ classes, waitlists, passes, forms, member check-in) |
| `golv_photography_studio` | Photography / Creative Studio | appointments, service_projects (+ questionnaires, gallery proofing) |
| `golv_car_rental` | Car Rental / Vehicle Hire | rentals (+ inspections) |
| `golv_equipment_hire` | Equipment Hire / Tool Rental | rentals (+ inspections) |
| `golv_furniture_rental` | Furniture / Events Rental | rentals (+ inspections) |
| `golv_party_supplies` | Party Supplies / Event Rental | rentals (+ inspections) |
| `golv_hotel` | Hotel | room_management (+ channel sync, guest register) |
| `golv_guesthouse` | Guesthouse | room_management (+ channel sync, guest register) |
| `golv_hostel` | Hostel | room_management (+ channel sync, guest register; beds via parent_room) |

All 46 verified on creation day: `schema_version = 122`, `setup_complete = true`, modes exactly
as above. Opt-in flags deliberately OFF everywhere: `rental_online_booking`, `room_online_booking`
(tenant opt-in), aggregator connections (none configured), FBR credentials (none configured).

## Older pre-existing test tenants (production, also @v122)

| Slug | Preset | Credentials memory file |
|---|---|---|
| `livetest1` | general_retail (pro) | production_state |
| `livetestauto` | general_retail (pro) | "Sweep Operator" / SweepRun123! / PIN 1234 |
| `sanoposlivetest1778021564659` | restaurant | TestPass564659! / PIN 1234 |
| `cafetestphase8` | cafe | TestPass1935! / PIN 1234 |
| `grocerywalktest1778451` | grocery | (walkthrough tenant) |
| `wholesalewalktest1778451` | wholesale | TestWholesale778! / PIN 4321 |

## Housekeeping

- Delete or extend the `golv_*` fleet from `/admin` before the trial expiry wave (~2026-08-21).
- These are TEST tenants — safe to create products, sales, bookings, contracts, plans, etc.
- Local copies live in `sanopos_dev`; recreate any time with the scripts pattern from the
  2026-07-07 go-live session (provision → verify-email → `POST /api/setup/complete`).
