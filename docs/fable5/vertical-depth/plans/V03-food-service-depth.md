# V03 — Food-Service Depth (Aggregator Injection · Recipes · Combos)

**Covers:** findings [04-food-service](../findings/04-food-service.md) — foodpanda/Careem order injection (the PK QSR demo-killer), consumption of F01 for recipes/food-cost/combos, bar-tab pre-auth via F04.
**Presets/modes:** `cafe`, `restaurant` — mode `restaurant` (13 flags); new flag `delivery_aggregators` (default OFF; both presets seed ON at approval).
**Surfaces:** online-ordering inbox · KDS · POS · admin (integrations hub) · webhooks
**Closes findings rows:** [04] "foodpanda (+ Careem) order injection → KDS" (**P0 cafe/QSR**, P1 FSR) · "Recipe/BOM ingredient inventory + food cost" (**P0 restaurant** — engine in F01, wired here) · "Combo/meal-deal builder" (P1 — engine in F01, menu UX here) · "Card-preauth bar tabs" (P2 via F04) · "Drive-thru" flag depth (confirm live) · "Caller-ID phone ordering" (P2 — stays out unless asked).
**Depends on:** F01 (recipes/combos), F04 (bar tabs, P2 only), completion plan 02 executed (restaurant wiring proven first).
**Branch:** backend adapters off `main`; menu/recipe UI rides `redesign/square`.
**Model:** **Opus, effort high.** The aggregator adapter is an external-API integration following an existing in-repo pattern; recipe/combo surface consumes F01's finished engine. Webhook signature handling is pause-list (security) — propose, don't self-approve.

---

## Tasks

### P0 — aggregator order injection
1. **foodpanda adapter** — `services/marketplace/foodpanda-client.js` extending `base-marketplace.js` (testConnection / pullOrders; syncProducts = menu push if the tenant's integration tier allows, else no-op like whatsapp-client). foodpanda's POS-integration API is order-push (webhook) + menu-pull — model the adapter around **inbound webhook first**, polling fallback second. Credentials via integrations hub (`integration_settings`, AES-encrypted — `services/crypto.js`).
2. **Webhook →  inbox → KDS** — `POST /api/webhooks/foodpanda` in `routes/webhooks.js` (mounted pre-tenant like the others; tenant resolution by store-id→tenant mapping in integration config): payload → normalized order → `web_orders` (raw_payload JSONB) → **existing** `services/online-inbox.js:acceptOnlineOrder` path (:56 — already converts inbox orders into checks/KDS tickets). Auto-accept toggle per tenant (QSRs want zero-touch to KDS; findings: "manual tablet re-entry is the dealbreaker"). Rider-status callbacks → order status updates.
   **PAUSE:** webhook signature verification design (foodpanda signs callbacks) — security-adjacent per completion-spec §5; propose the verification + replay-window scheme for approval. Do NOT ship unverified like the Meta/Daraz handlers (backend/CLAUDE.md documents that hole — don't extend it).
3. **Menu availability sync out** — 86'd items (`phase4_restaurant_86`) push availability to foodpanda (adapter `pushInventory` semantic = item availability). One-way, best-effort, logged.
4. **Careem Now** — same normalized pipeline, second adapter; ship behind the same flag, stub-honest if API access isn't obtainable in the sandbox (label "manual" in hub — the lesson from completion plan 11's decorative-worker P0: never show a green integration that does nothing).
5. **Inbox surface** — `restaurant-inbox.js` UI gains channel badges (own-web / foodpanda / careem), auto-accept indicator, failure queue (orders that failed conversion land visibly, never dropped silently → dead-letter row + admin notification).

### P1 — kitchen economics (consume F01)
6. **Recipes on menu items** — ProductForm recipe tab (F01) with restaurant vocabulary ("Ingredients", per-portion qty); ingredient products flagged non-sellable where appropriate (`products.visibility` or a `is_ingredient` display filter — prefer existing visibility machinery).
7. **Plate cost in menu engineering** — `reports/menu-engineering.js` extension (F01 task 7) verified against restaurant data; food-cost % column; theoretical-vs-actual report walked with real prep.
8. **Combos** — F01 combo (kit + modifier-group choice slots) exposed in menu management with meal-deal vocabulary; KDS ticket shows resolved components (KDS routing rules apply per component's station — verify `sendToKitchen` handles multi-station kit lines; if not, route the whole combo to its primary station and log the limitation).

### P2
9. Bar-tab pre-auth — F04 adapter slot wired to `restaurant-checks.js:openTab` (gateway-gated).
10. Drive-thru depth — confirm what `phase4_restaurant_drive_thru` actually gates (findings: comparison doc rates ❌); if dead, delete the flag (mode-registry.js:18) per completion 02's confirm item — coordinate, don't double-do.

## Reuse map (grep-confirmed)
| Need | Reuse | Evidence |
|---|---|---|
| Adapter base + hub + crypto | `services/marketplace/base-marketplace.js`, `routes/integrations/` hub, `services/crypto.js` | services/CLAUDE.md marketplace section |
| Order → check/KDS conversion | `services/online-inbox.js:acceptOnlineOrder` | :56-163 |
| Raw payload storage | `web_orders.raw_payload` JSONB | CLAUDE.md storage map |
| Webhook mount + rate limit | `routes/webhooks.js` + `webhookLimiter` | backend/CLAUDE.md |
| Dead-letter visibility | admin dead-letters page (`/admin/dead-letters`) | CLAUDE.md monitoring |
| 86/availability source | `phase4_restaurant_86` machinery + `menu-schedule-resolver.js` | findings [04] built rows |

## Harden what's built
- **P0 — aggregator orders must decrement stock like every other sale.** `acceptOnlineOrder` converts to a check; pay-at-table historically didn't decrement (completion-01 documented). Failure: 200 foodpanda orders/day never touch inventory → recipe/theoretical reports (the P1 being built!) are garbage. Gate: verify the accepted-order → settle path decrements (post-completion-01 state), and that F01 recipe decrement fires for aggregator-sourced sales identically.
- **P1 — duplicate webhook delivery.** Aggregators redeliver on timeout. Failure: one foodpanda order becomes two KDS tickets, kitchen cooks twice. Idempotency key = platform order id unique index on `web_orders` (verify column exists; add in this plan's migration if not — pause-list).
- **P1 — menu-schedule cache vs aggregator hours** — `menu-schedule-resolver.js` 60s cache is fine for QR, but availability pushes (task 3) must read post-invalidation state (`invalidateMenuScheduleCache` on writes exists — call order matters).
- **P2 — price divergence.** Aggregator menus often carry +15% pricing. Injected order lines must snapshot the aggregator price from the payload, not re-resolve local price. Failure: foodpanda order for Rs 575 booked as Rs 500 → daily reconciliation never matches payouts. State rule in the normalizer.

## Cross-surface lens
- **Stock:** aggregator sale = one more sales writer — add to the [[cross_surface_traps_plan01]] trap-5 census (tax snapshot + decrement + recipe consumption all verified on this path).
- **Tax:** aggregator lines through `tax-snapshot.js` with payload prices; FBR: decide whether aggregator sales enqueue FBR invoices like POS sales (they're sales — default yes; confirm with user at approval since FBR is pause-list).
- **86/availability:** POS · QR menu · kiosk · inbox · NOW aggregator push — five surfaces, one resolver.
- **Notifications:** order-status callbacks update customer-facing status on the aggregator side (their rider app owns customer comms — do NOT double-notify via F05).

## Verification bar
- Test tenant: [[cafe_test_tenant]] (counter/QSR) + [[restaurant_test_tenant]] (recipes).
- Walkthrough: simulated foodpanda webhook (recorded payload fixture) → order lands in inbox → auto-accept → KDS ticket correct (items/modifiers/notes) → settle → stock + recipe ingredients decremented → tax snapshot present → replayed duplicate webhook creates nothing; 86 an item → availability push logged; combo sold at POS and via aggregator payload → components resolved both times; menu engineering shows plate cost + food-cost %; failure-queue: malformed payload lands in dead-letter, admin notified.
- Empty states: inbox with aggregator connected but zero orders; recipe tab on item with no recipe (report shows "no recipe" not 0-cost-profit).
