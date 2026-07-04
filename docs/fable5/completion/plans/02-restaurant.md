# 02 — Restaurant mode

**Covers:** mode `restaurant` + presets `restaurant`, `cafe`
**Modes/flags in scope:** `phase4_restaurant`, `_kds`, `_qr`, `_86`, `_void_comp`, `_pay_at_table`, `_reservations`, `_kds_analytics`, `_day_parting`, `_fire_chits`, `_seats`, `_drive_thru`, `_menu_engineering` (all seeded by mode registry) + `phase2_draft_orders` (seeded by `RESTAURANT_SEED_FLAGS` — restaurant POS 403s without it, see `retail-flag-preset.js:16-19`)
**Surfaces touched:** POS (restaurant variant) · KDS · customer kiosk · public QR menu · public pay-at-table · public reservations · online-ordering inbox · admin · reports
**Branch strategy:** both P0s are one-line frontend contract fixes + zero backend — land on `main` (production bugfixes; trivially re-mergeable into `redesign/square`).

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Floor plan CRUD | `RestaurantFloorRedesign` | `/api/restaurant/floor-plans*` | `restaurant.js` → `services/restaurant-floor.js` | tables render w/ live session status; long-poll updates | ☐ |
| Open table → check | POS restaurant variant | `POST /api/restaurant/checks` (+ lazy `POST /api/draft-orders` via `POSContext.ensureDraftOrder`) | `services/restaurant-checks.js` | check backed by draft_orders row; `phase2_draft_orders` ON for restaurant/cafe wizard tenants | ☐ |
| Send to kitchen / fire course | POS → KDS | KDS ticket endpoints | `services/restaurant-kds.js` (`sendToKitchen`), `course-release-worker-boss.js` | ticket appears on right station; course timing honored | ☐ |
| KDS bump/recall | `KDSRedesign` | `/api/kds/*` | `kds.js` | bump→done, recall resets to `new` | ☐ |
| KDS station printer | `KdsStationSettingsModal` | `GET /api/printer-config` (**D1 — dead**) | — | printer dropdown populates (post-fix: `GET /api/print/config`) | ☐ |
| Modifiers | `ModifierGroupsRedesign` + POS picker | `/api/modifiers/*` | `services/modifiers.js` | min/max/required enforced; `price_delta` baked into line price | ☐ |
| Split check (item/seat) | `SplitCheckModal` | split endpoints | `restaurant-checks.js` (`splitCheckByItem/BySeat`) | split totals sum to original incl. tax | ☐ |
| Tabs open/close | POS | tab endpoints | `restaurant-checks.js` (`openTab`/`closeTab`) | tab persists across shifts until closed | ☐ |
| Void/comp w/ reason | `VoidCompModal` (POS) + `VoidReasonsAdminRedesign` | `GET /api/restaurant/void-reasons?adjustment_type=`; admin edit (**D2 — dead**) | `restaurant/void-comp.js` | manager-PIN gate (`services/manager-pin.js`); admin can toggle/rename reasons post-fix | ☐ |
| Tips capture + pooling | `TipPoolsRedesign`, POS | `/api/tips/*` | `services/tips.js` | pool distribute writes `commission_earnings(earning_type='tip')` | ☐ |
| 86 availability | `Restaurant86Redesign` | availability endpoints | `restaurant/availability.js` | 86'd item blocked on POS + QR menu + kiosk simultaneously (cross-surface) | ☐ |
| Menu schedules (dayparts) | `restaurant/menu-schedules` admin | `/api/restaurant/menu-schedules` | `services/menu-schedule-resolver.js` | product w/ schedule hidden outside window on QR menu (60s cache invalidation on write) | ☐ |
| QR public menu | `PublicRestaurantMenuPage` (`/menu/:token`) | `public-restaurant.js` (pre-tenant-middleware) | resolver above | loads unauthenticated w/ token only | ☐ |
| Customer kiosk order | `KioskOrderingRedesign` | `restaurant-kiosk.js` (`phase4_restaurant_qr` + `manage_restaurant` for token issue) | kiosk token flow | counter-mode tablet order lands in inbox/KDS | ☐ |
| Online ordering inbox | `RestaurantInboxRedesign` | `/api/restaurant-inbox` | `services/online-inbox.js` | accept/reject → check/KDS; stock behavior confirmed (see 01) | ☐ |
| Pay-at-table | `RestaurantPayPage` (public) | `restaurant/pay-at-table.js` | gateway (`isEnabled()` check) | QR link settles check; graceful msg when gateway off | ☐ |
| Reservations + waitlist | `restaurant/reservations`, `waitlist` admin + `ReservationBookingPage` (public) | `restaurant/reservations.js`, `waitlist.js`, `public-reservations.js` | `services/reservation.js` (booking) + reminder worker | public booking → admin list → seat | ☐ |
| KDS analytics / menu engineering | report tabs | `reports/kds-analytics.js`, `menu-engineering.js` (`from`/`to` params!) | — | tabs 200 for restaurant tenant; Boston matrix classifies | ☐ |

## Defects (P0) — confirmed broken wiring

- **KDS station printer dropdown always empty** — `KdsStationSettingsModal.jsx:34` calls `GET /api/printer-config`; no such route exists anywhere in `backend/routes/` (grep). The real route is `GET /api/print/config` (`printer.js:123`). The `catch { setPrinters([]) }` masks it, so station→printer routing silently can't be configured. · surfaces: KDS admin · fix sketch: change FE path to `/api/print/config` (and map the response shape — route returns a single `printer_config` row, not a list; check what the modal expects).
- **Void/comp reason admin edits always fail** — `VoidReasonsAdminRedesign.jsx:48` sends `api.put("/api/restaurant/void-reasons/${id}")` (PUT); backend registers only `app.patch("/api/restaurant/void-reasons/:id")` (`restaurant/void-comp.js:48-49`) plus the GET. PUT → 404 → toggling active / renaming a reason code from the admin page can never save. (The same page's raw-`fetch` calls at lines 56/75 use PATCH and work — the file is internally inconsistent.) · surfaces: restaurant admin · fix sketch: switch line 48 to the PATCH pattern already used in the same file.

## Feature-parity gaps (P1)
- **Preauthorized bar tabs** — 🟡 §4: tabs exist (`openTab`) but no card pre-auth hold · reuse: `payment-gateway.js` pre-auth pattern already built for `room-deposits.js`/`treatment-plan-deposits.js`.
- **Third-party delivery apps** — 🟡 §4: courier + marketplace dispatch exist; no FoodPanda-class integration (PK equivalent of DoorDash) · reuse: `services/couriers/` adapter pattern.
- Drive-Thru / Send & Stay — ❌ §4 but comparison marks it "niche Square-only" → **deliberately skip**. Note: the mode registry already seeds `phase4_restaurant_drive_thru` — verify what surface (if any) that flag gates and remove it if it gates nothing (see Confirm list).

## Polish & consistency (P2)
- `cafe` preset uses `pos_layout_mode: "counter"` — verify the counter layout actually differs from grid/list and vocab says Order/Menu Item throughout POS.
- Restaurant reports group visibility: preset `visible_report_groups` includes "Inventory" — confirm inventory tabs make sense for F&B or trim.
- KDS analytics + menu-engineering tabs use `from`/`to` while sibling tabs use `date_from` — align (shared with 00 P2).

## Confirm during execution
- `phase4_restaurant_fire_chits`, `_seats`, `_drive_thru` — mode registry seeds them (`mode-registry.js:16-18`); confirm each actually gates a live surface; delete from registry if dead flags.
- Restaurant order → stock decrement policy (recipes/ingredients aren't modeled — confirm menu-item stock semantics are intentional).
- Kiosk token flow end-to-end on a tablet-sized viewport.
- Pay-at-table behavior when `PAYMENT_GATEWAY` unset (manual adapter throws on `createCheckout`).

## Cross-surface lens (mandatory)
- **86/menu schedules** → POS, QR menu, kiosk, inbox — all four must resolve availability identically (`menu-schedule-resolver.js` cache).
- **Tax** → `restaurant-checks.js` totals recalc must use the v83 snapshot chain (01 owns the diff; verify here for split checks especially).
- **Tips → payroll** → `commission_earnings` is also read by HR payroll (`tier4/hr.js`) — pool distribution must not double-count.
- **Receipts** → check receipts (split, comp lines) render via the shared `utils/receipt.js` builders.

## Verification bar (execution)
- Test tenant: reuse [[restaurant_test_tenant]] (`sanoposlivetest1778021564659`) or [[cafe_test_tenant]] (`cafetestphase8`) for counter mode.
- Walkthrough: floor → open table → order w/ modifiers → send to kitchen → KDS bump → fire course → split by seat → void one line w/ reason → tip → pay → QR menu shows 86'd item gone → kiosk order → inbox accept → reservation from public page.
- Done = all rows ☑ live + D1/D2 fixed + verifier confirms.

## Preset-skin checklist
- `restaurant` — [ ] labels (Menu Item/Guest/Order) [ ] vocab [ ] dashboard (floor_plan widget on) [ ] onboarding (blocked on 01-D2) [ ] portal tabs (orders/loyalty/profile)
- `cafe` — [ ] labels (Menu Item/Customer/Order) [ ] counter POS layout [ ] dashboard (no floor_plan) [ ] onboarding (01-D2) [ ] portal tabs (orders/loyalty/profile)
