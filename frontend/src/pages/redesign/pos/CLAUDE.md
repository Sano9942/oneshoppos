# POS Module — Claude Guide

The entire POS terminal UI, driven by a single React Context (`POSContext`) composed from 8 domain hooks in `hooks/`. A `restaurant/` subdirectory holds table-service components used by `POSRestaurantRedesign.jsx` (floor grid, seat/course picker, split check, table transfer, guest-mode handoff) — those are documented in `pages/redesign/CLAUDE.md`; this guide covers the top-level POS files only.

- **`POSContext.jsx`** — orchestrator (~1,250 lines). Composes 8 hooks bottom-up, wires cross-hook state (modifier picker, restaurant seat/course stamping, cart checkpoint/resume, F-key shortcuts, barcode scanner buffer, POS device registration), and exposes a large `value` object via `usePOS()`. A comment block at the top of the file lists every key as a "WAVE-C SNAPSHOT" for diff verification — keep it in sync if you add/remove exports. `usePOS()` throws if used outside `POSProvider`.
- **`cartMath.js`** — pure utility, zero React. `calcGrossTotal(cart)`, `calcDiscountValue(grossTotal, type, input)` (percent/flat), `calcTaxTotal(cart, taxInclusive)` (inclusive backs tax out of price; exclusive adds on top — each line uses its own `effectiveTaxRate` so mixed-rate carts compute correctly), `calcTotal(...)` (always clamped to ≥ 0).
- **`omniInputRouter.js`** — pure pattern classifier, zero React. `classifyOmniInput(raw)` → `{ kind, value?, format? }`. Kinds: `noop`, `barcode` (EAN-8/12/13/14 by digit length), `plu` (4-5 digit numeric), `customer` (`#`-prefixed), `text` (fallback).

Both `cartMath.js` and `omniInputRouter.js` are deliberately pure — no imports from React or `usePOS()` — so they're cheap to unit-test in isolation (see `frontend/tests/unit/`).

---

## Context Hook Decomposition

`POSContext.jsx` composes hooks bottom-up (each receives outputs of earlier hooks) from `hooks/`:

| Hook | Owns |
|------|------|
| `useShiftGate` | outlets, `selectedOutletId`, `activeShift`, attendance status/code, `gateLoading`, `canOpenShift`/`canSwitchOutlet` perms, `isReadyForCheckout`, opening denominations, `openShiftFromPOS` |
| `useCart` | search (4 fields + unified), cart array, `taxInclusive`, price-list resolution (customer list overrides outlet list), POS layout tiles, item suggestions, auto-applied promotions, discount/note state, computed totals via `cartMath.js` |
| `useReceipt` | slip, `slipOpen`, `receiptTemplate`, recent sales list/search, `printSlip` (hardware print + retry-prompt arming), `printBrowserFallback` |
| `useCustomerDisplay` | pure side-effect — debounced 500ms `POST /api/pos/customer-display` whenever cart/totals/shift change; no state returned |
| `useLoyaltyWallet` | wallet balance, points earn/redeem math, loyalty config (fetched from `/api/loyalty/config`, not hardcoded) |
| `useFolioCharging` | charge-to-room-folio (M9) / charge-to-treatment-plan-folio (M10) dropdown data, fetched only while checkout is open |
| `useOfflineQueue` | IndexedDB-backed offline sale/return queue (thin wrapper over `utils/offlineQueue.js`), auto-sync on `window.online` |
| `useCheckout` | payments, `completeSale`, `addPayment`, tip/server capture, session-expiry recovery, wholesale credit-limit override, backorder staging |

`POSContext.jsx` itself also owns: lock state, customers list, parked sales, endless aisle, appointments (F06), modifier picker wiring, restaurant shell state (`draftOrderId`/`orderContext`/seat/course), price override apply, cart checkpoint/resume, stale-shift detection, POS device registration, and the global F-key/barcode-scanner keydown listener.

---

## Critical Gotchas

- **`completeSale` uses `api.raw` (not `api.post`)** — to inspect status codes mid-checkout: 401 → parks payload in `pendingSaleRef`, sets `sessionExpired=true`; `insufficient_stock` → fires `onInsufficientStock` (opens `POSInsufficientStockModal`); `CREDIT_LIMIT_EXCEEDED` (Tier 0.1 wholesale) → fires `onCreditLimitExceeded` (opens `POSCreditLimitModal`), payload parked for retry with a manager PIN. Do NOT refactor to `api.post`.
- **Offline-first checkout** — if `!navigator.onLine` (or the fetch throws `TypeError`), `completeSale` enqueues via `useOfflineQueue` and shows a `"PENDING"` slip immediately instead of blocking. Idempotency via `crypto.randomUUID()` stamped as `idempotency_key`; backend returns `{ duplicate: true }` on replay. `useOfflineQueue` splits counts by type (`queuedSalesCount`/`queuedReturnsCount`) so the UI can show e.g. "3 sales + 1 refund queued offline".
- **Park sale is feature-flagged** — `posFlags.phase2_draft_orders` → parks to `POST /api/draft-orders` instead of `POST /api/parked-sales`. `loadParked` reads and merges both sources (normalizing draft rows to the legacy shape) so tenants who flip the flag mid-life don't lose access to old parked sales.
- **F-key shortcuts use ref indirection** — `parkSaleRef`, `openCheckoutRef`, `removeFromCartRef` are updated every render (via small `useEffect`s) so the keydown listener (registered once, in `POSContext`) always calls the current closures.
- **Barcode scanner buffer** — the global keydown listener in `POSContext` buffers rapid keystrokes (100ms inter-key timeout), fires `handleBarcodeScanned` on `Enter` when buffer ≥ 3 chars. Separate from `POSOmniInput`'s explicit typed input and PLU pad. `POSReturnExchangeModal` and `POSHoldPickupModal` register their own independent instances of the same buffering pattern for their own scan contexts (invoice barcode, hold barcode).
- **Barcode 404 handling** — cashiers with `manage_inventory` see `POSBarcodeMissModal` (quick-create); everyone else gets a toast. Serialized products (`serial_required`) intercept the add-to-cart flow into `POSSerialEntryModal` instead of adding directly.
- **Cart checkpoint/resume** — debounced 1s write to `sessionStorage["pos_cart_checkpoint_${employeeId}"]`. On mount with an empty cart, if a checkpoint ≤ 8h old exists, `cartResumePrompt` is set (consumed by `POSCartResumeModal`, props-based). Scoped per employee so a second cashier on the same terminal never inherits the first cashier's cart.
- **Stale-shift recovery** — fires when the active shift is > 20h old (no time-of-day filter — overnight/extended shifts also qualify). Dismissed for the session only via state, not persisted.
- **Tax mode** — `taxInclusive` default derives from `company.tax_mode` (via `useAuth()`, threaded through `POSContext` → `useCart`); re-syncs when that loads asynchronously, but only while the cart is empty (never mutates an in-progress cart). `POSSubHeader` hides the Tax Inclusive toggle entirely when `taxMode === "none"` (unregistered tenants can't legally charge GST).
- **`isReadyForCheckout`** — `Boolean(selectedOutletId && activeShift && attendanceCode === "clocked_in")`. All three required.
- **Loyalty rates are NOT hardcoded** — fetched from `GET /api/loyalty/config` on mount; falls back to earn=1pt/100 spent, redeem=PKR10/100pts if the endpoint errors (e.g. pre-v63 tenant schema) or on a tenant that predates the config columns.
- **Price list priority** — customer price list overrides outlet price list; outlet list is only fetched at all when `posFlags.phase2_outlet_pricing` is on. Re-resolves every cart line's price whenever the price-list source changes (e.g. attaching/removing a customer).
- **POS device identity** — a stable UUID is generated once and cached in `localStorage["pos_device_uuid"]`, registered via `POST /api/pos-devices/register` (gated `phase2_pos_layouts`, skipped entirely when the flag is off to avoid phantom 503s) to obtain an integer id used for per-device POS layout scoping (`pos_layouts.scope_id` with `scope_type='device'`) and per-device bulk-scan-mode `localStorage` keys.
- **Modifier picker** — adding a product with linked modifier groups pauses the add flow (`addToCartWithModifiers` → `setModifierModalState`) until the cashier confirms selections in `POSModifierModal`; bundles and non-restaurant flows skip the tree lookup and add directly.
- **Restaurant seat/course stamping** — when `orderContext` is set (a restaurant check is open) and the tenant is not in `counter` layout mode, every cart line is stamped with `seat_number`/`course_name` from the active seat/course picker state (`buildSeatCourseOverlay`). Counter-service tenants (cafe/quick-service inheriting the restaurant shell) force these back to schema defaults so KDS/reports/FBR treat them as standard sales.
- **V04 salon walk-in guard** — `completeSale` blocks (does not silently default to the cashier) if `industryType === "salon"`, there's no linked appointment, and any cart line lacks a `staff_id` and no server is selected — the UI surfaces a blocking "Performed by" picker in `POSCheckoutModal` for walk-ins.
- **V01 grocery decoded lines** — `addDecodedLine` (in `useCart`) always creates a NEW cart line (never merges) for scale price/weight-embedded barcodes: price-embedded lines are FINAL price + `price_locked: true` (excluded from % promos, bypasses the price-list cascade); weight-embedded lines carry the decoded net weight as quantity at the shelf unit price. Both lock `tare_weight` since the deli scale already netted it.
- **Age-restricted attest** — `POSOmniInput` and `POSPluPad` both gate `product.age_restricted` items behind a native `window.confirm()` before adding to cart (not a custom modal).

---

## Modal Components

**Convention**: most modals null-guard with `if (!x) return null`, reading visibility state directly from `usePOS()`. A subset instead receive all data via **props** and do not read visibility from context — this matters when wiring a new modal into `POSRedesign.jsx` (all POS modals mount there, not inside individual components).

Props-based modals (no internal `usePOS()` visibility check): `POSEmailReceiptModal`, `POSStuckQueueModal`, `POSCartCollisionModal`, `POSCartResumeModal`, `POSShiftRecoveryModal`, `POSRefundThresholdModal`, `POSCreditLimitModal`, `POSNoSaleReasonModal`, `POSReceiptRetryModal`, `POSApprovalModal`, `POSBarcodeMissModal`, `POSInsufficientStockModal`. Of these, `POSApprovalModal`, `POSNoSaleReasonModal`, `POSBarcodeMissModal`, and `POSInsufficientStockModal` don't call `usePOS()` at all — fully standalone/reusable outside POS.

### Checkout / payment
- **`POSCheckoutModal`** (context) — multi-tender payment (Cash/Card/Wallet/Gift Card/Credit). Gift card gated `phase2g_gift_cards` (includes pre-printed-card auto-activation on first balance lookup); on-account "Credit" tender gated `wholesale_credit_controls` and disabled until a customer is attached. Charge-to-room/treatment-plan-folio dropdowns are mode-gated via `usePreset().hasMode`; a walk-in clinical customer with no active plan gets an inline quick-create-plan form (B4). Restaurant mode (`hasMode("restaurant")`) adds tip %/custom + tip method + server assignment + "Hand to guest" (opens `RestaurantGuestModeModal` for signature capture). V04 salon walk-ins get a blocking "Performed by" stylist picker.
- **`POSCreditLimitModal`** (props) — Tier 0.1 wholesale. Shown on 403 `CREDIT_LIMIT_EXCEEDED`; collects a manager PIN, caller's `retryWithManagerPin(pin)` re-posts the parked sale. Displays outstanding/attempted/limit/deficit.
- **`POSReceiptModal`** (context) — post-sale view: returned items (exchange), gift cards issued, A/R invoice details for on-account sales, WhatsApp share link (via `utils/publicReceipt.js`), embeds `POSEmailReceiptModal`, Print via `printSlip`.
- **`POSReturnExchangeModal`** (context) — the most complex modal. Invoice search (by number or its own barcode-scanner buffer via `GET /api/sales/by-barcode/:code`), or no-bill manual return; refund vs exchange (exchange POSTs the new sale first, then the return, to avoid inventory inconsistency — if the shift is closed the sale POST fails before any return is recorded); per-line restock toggle + reason code (`phase2g_per_line_restock`, scrapped lines require a reason); serial picker for serialized returns (matched against `GET /api/sales/:id/serials`); 409 `duplicate_return` → opens `POSCartCollisionModal`; `manager_pin_required` → inline `POSRefundThresholdModal` (blocks via an awaited `Promise` until PIN succeeds or is cancelled); offline refund queueing gated `offline_returns` (refund-only — exchanges always require the network since they mutate stock via a new sale).
- **`RestaurantGuestModeModal`** (in `restaurant/`) — writes tip + signature back through `POSContext` (`setTipAmount`, `setSignatureSvg`), then closes so the operator completes the sale from `POSCheckoutModal`.

### Cart / stock intervention
- **`POSBarcodeMissModal`** (props) — shown on barcode 404, only to cashiers with inventory perms. Quick-creates the product then adds to cart.
- **`POSInsufficientStockModal`** (props) — shown on `insufficient_stock` from `/api/sales`. Adjust (clamp qty) / Backorder remainder (V02 wholesale, only when `backorder_available` and a customer is attached) / Oversell (perm-gated) / Cancel.
- **`POSCartCollisionModal`** (props) — shown on 409 `duplicate_return`; displays the existing return's id/amount/employee/timestamp.
- **`POSCartResumeModal`** (props) — the cart-checkpoint resume prompt (see gotchas above).
- **`POSCreditLimitModal`** — see Checkout section.

### Shift / session
- **`POSLockScreen`** (context, full-page — not a modal overlay) — PIN unlock via context's `handleUnlock`; "Sign out completely" logs out and navigates to `/login`.
- **`POSSessionExpiredModal`** (context) — shown on mid-checkout 401. Re-auth is always PIN-based (`POST /api/employees/validate-pin`, never `/auth/login`, even if the employee also has a dashboard password). Success → `retryPendingSale()`. Cancel → parks the sale, navigates to `/login`.
- **`POSCloseShiftModal`** (context) — denomination-based cash count + variance reason/approver/notes; flips into a threshold-approval sub-mode (PIN + reason) on backend `manager_pin_required`/`variance_reason_required`.
- **`POSOpeningGateModal`** (context) — 3-state gate: needsOutlet → needsShift → needsClockIn. Cashiers without `canOpenShift` only see a Logout option; managers who can open a shift see the denomination grid + opening float.
- **`POSShiftRecoveryModal`** (props) — shown when the active shift is > 20h old; Close now / Quick-close / Keep open.
- **`POSStuckQueueModal`** (props: `{ open, onClose }`, also opened directly from `POSHeader`'s admin-only "Stuck (N)" button) — reads failed offline-queue entries via `getQueueByState`; Retry marks pending + calls `syncQueue()`; Discard marks synced (drops it) after a `confirm()`.

### Product entry
- **`POSModifierModal`** (context) — `single` (radio) or `multi` (checkbox, `max_select`-capped) modifier group selection; `is_default` pre-selects; validates `min_select`/`is_required` before confirming; sums `price_delta`.
- **`POSVariantMatrixModal`** (context) — opens on `pendingVariantProductId`; grid of up to 2 axes + a filterable 3rd axis; arrow-key nav, Enter to commit, stock-colored cells (green/amber/grey with strikethrough for out-of-stock). Gated `phase2g_variant_picker`. Chains into `POSSerialEntryModal` if the resolved variant's parent product is `serial_required` (mutates the already-added cart line rather than adding a new one).
- **`POSSerialEntryModal`** (context) — opens on `pendingSerialContext`/`pendingSerialProductId`; one input slot per unit of quantity, matched against `GET /api/products/:id/serials?status=available` (variant-scoped when applicable). Tab advances, Enter commits when all slots resolve to a valid, non-duplicate serial. Gated `phase2g_serialized_inventory`.
- **`POSPriceOverrideModal`** (context) — opens on `priceOverrideLineId`; requires a reason code + manager PIN, posts `POST /api/approvals/price-override`, then calls context's `applyPriceOverride(lineId, {...})`. Gated `phase2g_price_override`.
- **`POSHoldCreateModal`** (context) — layaway hold creation (`POST /api/holds`); deposit amount/method, hold days (default 14), customer name/phone or attached customer; clears cart on success; best-effort printable slip.
- **`POSHoldPickupModal`** (context) — pickup flow with its own independent barcode-scanner buffer (`GET /api/holds/by-barcode/:code`) or manual search; "Take Deposit" (partial payment, hold stays open) vs "Complete & Print" (settles remaining balance via `POST /api/holds/:id/complete`).
- **`POSAppointmentsModal`** (context, F06) — "Today's appointments" checkout entry point (`GET /api/appointments/pos-today`). Tapping a row prefills the cart (one line per segment for multi-service visits, each stamped with its own `staff_id`) and links the eventual sale back to the appointment via `loadAppointmentToCart` → `activeAppointment`.
- **`EndlessAisleModal`** (context) — out-of-stock order capture (`POST /api/orders/endless-aisle`); ship-to-customer or pickup delivery; pre-fills from `selectedCustomer`.

### Misc
- **`POSDiscountModal`** (context) — percent/fixed toggle → `discountInput`/`discountType`.
- **`POSNoteModal`** (context) — plain textarea → `orderNote`.
- **`POSApprovalModal`** (props, standalone) — generic manager-PIN authorization (`POST /api/approvals/pos-authorize`) usable for any `actionType`, not POS-specific.
- **`POSNoSaleReasonModal`** (props, standalone) — logs opening the cash drawer without a sale (`POST /api/risk/no-sale`); reasons from `GET /api/risk/no-sale-reasons`.
- **`POSReceiptRetryModal`** (props) — shown when hardware print fails; Print Again / Email (embeds `POSEmailReceiptModal`) / WhatsApp / Browser fallback / Skip, each logged via `logErrorState`.
- **`POSEmailReceiptModal`** (props: `{ saleId, customerEmail, onClose }`) — `POST /api/email/send-receipt-v2`; auto-closes 1.5s after success. Embedded by `POSRecentSalesPanel`, `POSReceiptModal`, and `POSReceiptRetryModal`.
- **`POSParkedModal`** (context) — lists parked sales / draft orders merged by `loadParked`; Restore or Delete, routed to the correct endpoint via each row's `_source` tag.
- **`POSRefundThresholdModal`** (props) — generic manager-PIN prompt reused by both `POSReturnExchangeModal` (refund threshold) and structurally mirrored by `POSCreditLimitModal` (credit-limit override).

---

## Layout / Display Components

- **`POSHeader`** — outlet switcher (`all_access` only), Last Receipt, Recent Sales, Return, customer-display popout (opens `/customer-display?shift_id=...` in a new tab/window), admin-only "Stuck (N)" button opening `POSStuckQueueModal`, Close Shift, Help (F1), Lock, Logout.
- **`POSSubHeader`** — "Sell" heading + today's date, Tax Inclusive toggle (hidden entirely when `taxMode === "none"`), bulk-scan mode toggle (per-device `localStorage`), Appointments button (F06, gated `phase4_appointments`), Park Sale + Parked Sales badge, Hold/Pick Up buttons gated `phase2g_holds`.
- **`POSSidebar`** — customer search/attach dropdown (`data-pos-customer-search` attribute is the F4 focus target), discount/note quick buttons, totals breakdown (subtotal, discount, promo, tax-inclusive line, total), Pay button.
- **`POSCartTable`** — bundle/special-price/price-override badges per line; weighted-unit inline decimal qty input (`WeightedQtyCell`, gated by `isWeightedUnit(item.unit)`) with a "Weigh" button when the browser supports Web Serial (`utils/scale.js`) and an optional tare field (`preset.pos_search_config.show_tare`) that's read-only when the line's `tare_locked` (already netted by a deli scale label); per-line override-price menu gated `phase2g_price_override`. Mobile hides the Unit column.
- **`POSSearchArea`** — conditionally shows barcode/SKU/price fields per tenant's `pos_search_config`; grid/list view toggle persisted in `localStorage["pos_view_mode"]`. Renders `POSOmniInput` above the classic fields when `phase2g_omni_input` is on, and `POSPluPad` when `pos_search_config.show_plu` is on — both are additive, the classic fields remain active below.
- **`POSOmniInput`** — single smart search bar using `classifyOmniInput`. Barcode/PLU → `GET /api/products/scan/:barcode` via `api.raw`, decodes scale price/weight-embedded barcodes client-side for instant feedback then confirms server-side, chains into variant/serial modals as needed; `#`-prefixed → customer search (auto-selects on exactly one match); plain text → sets `search`. Auto-focuses on mount and re-focuses every 10s if no input is active; `/` key focuses it globally.
- **`POSPluPad`** — collapsed to a small "PLU pad" button by default; expands into a touch numeric keypad for ringing loose produce/deli items by 4-8 digit code, reusing the same `GET /api/products/scan/:code` endpoint (so a typed PLU resolves identically to a scanned barcode, including scale-embedded decoding).
- **`POSRecentSalesPanel`** — today's sales with search filter; Reprint re-fetches `GET /api/sales/:id` and rebuilds a slip object; Email opens `POSEmailReceiptModal`; Return calls `openReturnFromSale`.
- **`POSShortcutsOverlay`** — renders the `SHORTCUTS` table below, substituting `presetLabels.customer` for the F4 label.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| F1 | Toggle shortcuts overlay |
| F2 | Apply discount (only if cart non-empty) |
| F3 | Park sale (only if cart non-empty) |
| F4 | Focus customer search (`[data-pos-customer-search]`) |
| F5 | Open parked sales |
| F8 | Remove last cart item |
| F9 | Open checkout |
| F10 | Clear cart (confirms via `window.confirm`) |
| Esc | Close discount modal / parked sales / shortcuts overlay |
| `/` | Focus omni-input (only when no input/textarea/select is focused; handled inside `POSOmniInput`, not the global listener) |

F-keys fire even when focus is inside an input — checked before the plain-character barcode-buffer branch in the global keydown handler.

---

## Styling Convention

The module has migrated to the app-wide **Square design system** — nearly every top-level component (`POSContext`-driven layout components, all cart/checkout/shift/product-entry modals, `POSHeader`/`POSSubHeader`/`POSSidebar`/`POSCartTable`/`POSSearchArea`/`POSOmniInput`/`POSPluPad`) now uses `--ui-*` CSS variable tokens (`bg-(--ui-surface)`, `text-(--ui-text-muted)`, `border-(--ui-border-strong)`, etc.) from `ui/tokens.css` — the same tokens the rest of the app's `redesign/` pages use. Treat this directory the same as any other `redesign/` page for new work: build from tokens, don't hardcode Tailwind color classes or hex values.

**Known remaining hardcoded-color exceptions** (do not use as a template for new components): `POSAppointmentsModal` (`bg-white`, `text-slate-*`, `#8066FF` accent), and the appointments-button branch inside `POSSubHeader` (`text-[#8066FF]`, `emerald-*`, `indigo-*`). If touching either, consider migrating them to tokens to close the gap rather than extending the hardcoded style further.

---

## `completeSale` Payload (`POST /api/sales`)

```js
{
  outlet_id, employee_id, customer_id?,
  cartItems: [{ id, variant_id?, price, quantity, staff_id?, modifiers?, serials?, seat_number?, course_name? }],
  payments: [{ method, amount, code? }],   // code: gift-card redemption code
  discount_amount, discount_type,          // includes promo_discount folded in when no manual discount set
  notes,                                   // JSON-stringified { text, signature_svg } when a guest signature was captured
  points_earned, points_redeemed,
  idempotency_key,          // crypto.randomUUID(), backend dedupes on replay
  folio_id?, treatment_folio_id?,          // M9/M10 charge-to-folio (no payment collected when set)
  tip_amount?, tip_method?, server_id?,    // Phase 2.1 restaurant tip capture; tip_method lowercased at the wire
  draft_order_id?, order_context?, table_session_id?, seat_count?,  // restaurant shell context
  tax_inclusive,            // backend resolves against company_profile.tax_mode + snapshots per-line tax
  manager_pin?,             // wholesale credit-limit override retry only; read once then cleared
  appointment_id?,          // F06 — backend completes the appointment on commit
  backorder_items?,         // V02 wholesale — accepted shortfall remainder; requires a customer
}
```
