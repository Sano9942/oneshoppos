# POS Module — Claude Guide

Entire POS terminal UI, driven by a single React Context (`POSContext`) composed from 8 domain hooks in `hooks/`. A `restaurant/` subdirectory holds table-service components (see `pages/redesign/CLAUDE.md` for that layer — this guide covers the top-level POS files only).

- **`POSContext.jsx`** — orchestrator (~1,170 lines). Composes 8 hooks, wires cross-hook state (e.g. modifier picker, restaurant seat/course stamping, cart checkpoint/resume, F-key shortcuts, barcode scanner buffer), and exposes a large `value` object via `usePOS()`. A comment block at the top of the file lists every key as a "wave-C snapshot" for diff verification when the file is touched — keep it in sync if you add/remove exports. `usePOS()` throws if used outside `POSProvider`.
- **`cartMath.js`** — pure utility, zero React. `calcGrossTotal(cart)`, `calcDiscountValue(grossTotal, type, input)` (percent/flat), `calcTaxTotal(cart, taxInclusive)` (inclusive backs tax out of price; exclusive adds on top — each line uses its own `effectiveTaxRate` for mixed-rate carts), `calcTotal(...)` (always clamped to ≥ 0).
- **`omniInputRouter.js`** — pure pattern classifier, zero React. `classifyOmniInput(raw)` → `{ kind, value?, format? }`. Kinds: `noop`, `barcode` (EAN-8/12/13/14 by digit length), `plu` (4-5 digit numeric), `customer` (`#`-prefixed), `text` (fallback).

---

## Context Hook Decomposition

`POSContext.jsx` composes hooks bottom-up (each receives outputs of earlier hooks) from `hooks/`:

| Hook | Owns |
|------|------|
| `useShiftGate` | outlets, selectedOutletId, activeShift, attendanceStatus/Code, gateLoading, canOpenShift/canSwitchOutlet perms, isReadyForCheckout, opening denominations, openShiftFromPOS |
| `useCart` | search (4 fields + unified), cart array, taxInclusive, price-list resolution, POS layout tiles, item suggestions, auto-applied promotions, discount/note state, computed totals via `cartMath.js` |
| `useReceipt` | slip, slipOpen, receiptTemplate, recentSales, printSlip, retryPrompt (hardware print failure) |
| `useCustomerDisplay` | debounced sync to second-screen customer display |
| `useLoyaltyWallet` | wallet balance, points earn/redeem, loyalty config (fetched, not hardcoded) |
| `useFolioCharging` | charge-to-room-folio / charge-to-treatment-plan-folio (M9/M10) |
| `useOfflineQueue` | IndexedDB-backed offline sale/return queue, sync on `window.online` |
| `useCheckout` | payments, completeSale, addPayment, tip/server capture, session-expiry recovery, wholesale credit-limit override |

`POSContext.jsx` itself also owns: lock state, customers list, parked sales, endless aisle, modifier picker wiring, restaurant shell state (draftOrderId/orderContext/seat/course), price override apply, cart checkpoint/resume, stale-shift detection, POS device registration, and the global F-key/barcode-scanner keydown listener.

---

## Critical Gotchas

- **`completeSale` uses `api.raw` (not `api.post`)** — to inspect status codes mid-checkout: 401 → parks payload in `pendingSaleRef`, sets `sessionExpired=true`; `insufficient_stock` → fires `onInsufficientStock` (opens `POSInsufficientStockModal`); `CREDIT_LIMIT_EXCEEDED` (Tier 0.1 wholesale) → fires `onCreditLimitExceeded` (opens `POSCreditLimitModal`), payload parked for retry with a manager PIN. Do NOT refactor to `api.post`.
- **Offline-first checkout** — if `!navigator.onLine` (or the fetch throws `TypeError`), `completeSale` enqueues via `useOfflineQueue` and shows a `"PENDING"` slip immediately instead of blocking. Idempotency via `crypto.randomUUID()` stamped as `idempotency_key`; backend returns `{ duplicate: true }` on replay.
- **Park sale is feature-flagged** — `posFlags.phase2_draft_orders` → parks to `POST /api/draft-orders` instead of `POST /api/parked-sales`. `loadParked` reads and merges both sources (normalizing draft rows to the legacy shape) so tenants who flip the flag mid-life don't lose access to old parked sales.
- **F-key shortcuts use ref indirection** — `parkSaleRef`, `openCheckoutRef`, `removeFromCartRef` are updated every render so the keydown listener (registered once) always calls the current closures.
- **Barcode scanner buffer** — global keydown listener buffers rapid keystrokes (100ms inter-key timeout), fires `handleBarcodeScanned` on `Enter` when buffer ≥ 3 chars. Separate from `POSOmniInput`'s explicit typed input. `POSReturnExchangeModal` and `POSHoldPickupModal` register their own instances of the same buffering pattern for their scan contexts.
- **Cart checkpoint/resume** — debounced 1s write to `sessionStorage["pos_cart_checkpoint_${employeeId}"]`. On mount with an empty cart, if a checkpoint ≤ 8h old exists, `cartResumePrompt` is set (consumed by `POSCartResumeModal`, props-based). Scoped per employee so a second cashier on the same terminal never inherits the first cashier's cart.
- **Stale-shift recovery** — fires when the active shift is > 20h old (no time-of-day filter — overnight/extended shifts also qualify). Dismissed for the session only via state, not persisted.
- **Tax mode** — `taxInclusive` default derives from `company.tax_mode` (`useAuth()`); re-syncs when that loads asynchronously, but only while the cart is empty (never mutates an in-progress cart).
- **`isReadyForCheckout`** — `Boolean(selectedOutletId && activeShift && attendanceCode === "clocked_in")`. All three required.
- **Loyalty rates are NOT hardcoded** — fetched from `GET /api/loyalty/config` on mount; falls back to earn=1pt/100 spent, redeem=PKR10/100pts if the endpoint errors (e.g. pre-v63 tenant schema).
- **Price list priority** — customer price list overrides outlet price list; outlet list is only fetched at all when `posFlags.phase2_outlet_pricing` is on.
- **POS device identity** — a stable UUID is generated once and cached in `localStorage["pos_device_uuid"]`, registered via `POST /api/pos-devices/register` (gated `phase2_pos_layouts`) to obtain an integer id used for per-device POS layout scoping.
- **Modifier picker** — adding a product with linked modifier groups pauses the add flow (`addToCartWithModifiers` → `setModifierModalState`) until the cashier confirms selections; bundles and non-restaurant flows skip the tree lookup and add directly.
- **Restaurant seat/course stamping** — when `orderContext` is set (a restaurant check is open) and the tenant is not in `counter` layout mode, every cart line is stamped with `seat_number`/`course_name` from the active seat/course picker state. Counter-service tenants force these back to schema defaults so KDS/reports/FBR treat them as standard sales.

---

## Modal Components

**Convention**: most modals null-guard with `if (!x) return null` reading state directly from `usePOS()`. A subset instead receive all data via **props** and do not read visibility from context — this matters when wiring a new modal into `POSRedesign.jsx` (all POS modals mount there, not inside individual components).

Props-based modals (no internal `usePOS()` visibility check): `POSEmailReceiptModal`, `POSStuckQueueModal`, `POSCartCollisionModal`, `POSCartResumeModal`, `POSShiftRecoveryModal`, `POSRefundThresholdModal`, `POSCreditLimitModal`, `POSNoSaleReasonModal`, `POSReceiptRetryModal`, `POSApprovalModal`, `POSBarcodeMissModal`, `POSInsufficientStockModal`. Of these, `POSApprovalModal`, `POSNoSaleReasonModal`, `POSBarcodeMissModal`, and `POSInsufficientStockModal` don't call `usePOS()` at all — fully standalone/reusable outside POS.

### Checkout / payment
- **`POSCheckoutModal`** (context) — multi-tender payment (Cash/Card/Wallet/Gift Card/Credit). Gift card gated `phase2g_gift_cards`; on-account "Credit" tender gated `wholesale_credit_controls` and disabled until a customer is attached. Charge-to-room/treatment-plan-folio dropdowns are mode-gated via `usePreset().hasMode`. Restaurant mode adds tip % + server assignment + guest signature capture.
- **`POSCreditLimitModal`** (props) — Tier 0.1 wholesale. Shown on 403 `CREDIT_LIMIT_EXCEEDED`; collects a manager PIN, caller's `retryWithManagerPin(pin)` re-posts the parked sale. Displays outstanding/attempted/limit/deficit.
- **`POSReceiptModal`** (context) — post-sale view: returned items (exchange), gift cards issued, A/R invoice details for on-account sales, WhatsApp share link, embeds `POSEmailReceiptModal`, Print via `printSlip`.
- **`POSReturnExchangeModal`** (context) — the most complex modal. Invoice search, barcode scan, or no-bill manual return; refund vs exchange (exchange POSTs the new sale first, then the return, to avoid inventory inconsistency); per-line restock toggle + reason code (`phase2g_per_line_restock`); serial picker for serialized returns; 409 `duplicate_return` → opens `POSCartCollisionModal`; `manager_pin_required` → inline `POSRefundThresholdModal`; offline refund queueing gated `offline_returns` (refund-only).

### Cart / stock intervention
- **`POSBarcodeMissModal`** (props) — shown on barcode 404, only to cashiers with inventory perms. Quick-creates the product then adds to cart.
- **`POSInsufficientStockModal`** (props) — shown on `insufficient_stock` from `/api/sales`. Adjust (clamp qty) / Oversell (perm-gated) / Cancel.
- **`POSCartCollisionModal`** (props) — shown on 409 `duplicate_return`; displays the existing return's id/amount/employee/timestamp.
- **`POSCartResumeModal`** (props) — the cart-checkpoint resume prompt (see gotchas above).
- **`POSCreditLimitModal`** — see Checkout section.

### Shift / session
- **`POSLockScreen`** (context, full-page — not a modal overlay) — PIN unlock via context's `handleUnlock`; "Sign out completely" logs out and navigates to `/login`.
- **`POSSessionExpiredModal`** (context) — shown on mid-checkout 401. Re-auth is always PIN-based (`POST /api/employees/validate-pin`, never `/auth/login`). Success → `retryPendingSale()`. Cancel → parks the sale, navigates to `/login`.
- **`POSCloseShiftModal`** (context) — denomination-based cash count + variance reason/approver/notes; flips into a threshold-approval sub-mode (PIN + reason) on backend `manager_pin_required`/`variance_reason_required`.
- **`POSOpeningGateModal`** (context) — 3-state gate: needsOutlet → needsShift → needsClockIn. Cashiers without `canOpenShift` only see a Logout option.
- **`POSShiftRecoveryModal`** (props) — shown when the active shift is > 20h old; Close now / Quick-close / Keep open.

### Product entry
- **`POSModifierModal`** (context) — `single` (radio) or `multi` (checkbox, `max_select`-capped) modifier group selection; `is_default` pre-selects; validates `min_select`/`is_required` before confirming; sums `price_delta`.
- **`POSVariantMatrixModal`** (context) — opens on `pendingVariantProductId`; grid of up to 2 axes + a filterable 3rd axis; arrow-key nav, Enter to commit, stock-colored cells. Gated `phase2g_variant_picker`. Chains into the serial modal if the resolved variant is `serial_required`.
- **`POSSerialEntryModal`** (context) — opens on `pendingSerialContext`/`pendingSerialProductId`; one input slot per unit of quantity, matched against `GET /api/products/:id/serials?status=available`; Tab advances, Enter commits when full. Gated `phase2g_serialized_inventory`.
- **`POSPriceOverrideModal`** (context) — opens on `priceOverrideLineId`; requires a reason code + manager PIN, posts `POST /api/approvals/price-override`, then calls context's `applyPriceOverride(lineId, {...})`. Gated `phase2g_price_override`.
- **`POSHoldCreateModal`** (context) — layaway hold creation (`POST /api/holds`); deposit amount/method, hold days (default 14), customer name/phone or attached customer; clears cart on success.
- **`POSHoldPickupModal`** (context) — pickup flow with its own barcode-scanner buffer (`GET /api/holds/by-barcode/:code`) or manual search; "Take Deposit" (partial, hold stays open) vs "Complete & Print" (settles balance via `POST /api/holds/:id/complete`).

### Misc
- **`POSDiscountModal`** (context) — percent/fixed toggle → `discountInput`/`discountType`.
- **`POSNoteModal`** (context) — plain textarea → `orderNote`.
- **`POSApprovalModal`** (props, standalone) — generic manager-PIN authorization (`POST /api/approvals/pos-authorize`) usable for any `actionType`, not POS-specific.
- **`POSNoSaleReasonModal`** (props, standalone) — logs opening the cash drawer without a sale (`POST /api/risk/no-sale`); reasons from `GET /api/risk/no-sale-reasons`.
- **`POSReceiptRetryModal`** (props) — shown when hardware print fails; Print Again / Email (embeds `POSEmailReceiptModal`) / WhatsApp / Browser fallback / Skip, each logged via `logErrorState`.
- **`POSEmailReceiptModal`** (props: `{ saleId, customerEmail, onClose }`) — `POST /api/email/send-receipt-v2`; auto-closes 1.5s after success. Embedded by `POSRecentSalesPanel`, `POSReceiptModal`, and `POSReceiptRetryModal`.
- **`EndlessAisleModal`** (context) — out-of-stock order capture (`POST /api/orders/endless-aisle`); ship-to-customer or pickup delivery; pre-fills from `selectedCustomer`. Uses `dark:` Tailwind variants — an exception to POS's hardcoded-color convention.
- **`POSStuckQueueModal`** (props: `{ open, onClose }`) — reads failed offline-queue entries; retry = mark pending + re-sync.

---

## Layout / Display Components

- **`POSHeader`** — outlet switcher (`all_access` only), Last Receipt, Recent Sales, Return, customer-display popout, admin-only "Stuck (N)" button opening `POSStuckQueueModal`, Close Shift, Help (F1), Lock, Logout.
- **`POSSubHeader`** — Tax Inclusive toggle (hidden entirely when `taxMode === "none"`), bulk-scan mode toggle (per-device `localStorage`), Park Sale + Parked Sales badge, Hold/Pick Up buttons gated `phase2g_holds`.
- **`POSSidebar`** — dark `#0A0A0A` background. Customer search/attach dropdown (`data-pos-customer-search` attribute is the F4 focus target), discount/note quick buttons, totals breakdown, Pay button.
- **`POSCartTable`** — bundle/special-price/price-override badges per line; weighted-unit inline decimal qty input with optional tare field; per-line override-price menu gated `phase2g_price_override`. Mobile hides the Unit column.
- **`POSSearchArea`** — conditionally shows barcode/SKU/price fields per tenant's `pos_search_config`; grid/list view toggle persisted in `localStorage["pos_view_mode"]`. Renders `POSOmniInput` above the classic fields when `phase2g_omni_input` is on — the classic fields remain active below, they are not replaced.
- **`POSOmniInput`** — single smart search bar using `classifyOmniInput`. Barcode/PLU → `GET /api/products/scan/:barcode` via `api.raw`, chaining into variant/serial modals as needed; `#`-prefixed → customer search (auto-selects on exactly one match); plain text → sets `search`. Auto-focuses on mount and re-focuses every 10s if no input is active; `/` key focuses it globally.
- **`POSRecentSalesPanel`** — today's sales with search filter; Reprint re-fetches `GET /api/sales/:id` and rebuilds a slip object; Email opens `POSEmailReceiptModal`; Return calls `openReturnFromSale`.
- **`POSShortcutsOverlay`** — renders `SHORTCUTS` (see table below) using `presetLabels.customer` for the F4 label. Uses CSS variable tokens (`--ui-surface`, `--ui-text`, etc.) — an exception to POS's hardcoded-color convention.

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
| `/` | Focus omni-input (only when no input/textarea/select is focused) |

F-keys fire even when focus is inside an input (checked before the plain-character barcode-buffer branch).

---

## Styling Convention

POS does **not** use the app-wide design-system tokens (`ui/primitives.jsx`, CSS custom properties). It uses hardcoded `#8066FF` accent, `slate-*` Tailwind classes, and `#0A0A0A`/`#111` dark sidebar backgrounds.

**Exceptions** (use CSS variable tokens or `dark:` variants instead): `POSShortcutsOverlay`, `EndlessAisleModal`. Follow the majority hardcoded-color convention for any new POS component unless there's a specific reason to diverge.

---

## `completeSale` Payload (`POST /api/sales`)

```js
{
  outlet_id, shift_id, employee_id, customer_id?,
  cartItems: [{ id, variant_id?, price, quantity, modifier_ids?, serial_numbers?, seat_number?, course_name?, staff_id? }],
  payments: [{ method, amount }],
  discount_type, discount_value,
  tax_inclusive, tax_total, tax_breakdown, // per-rate breakdown alongside legacy single tax total
  order_note?,
  redeem_points?, points_redeemed?,
  wallet_payment_amount?,
  charge_to_room_folio_id?, charge_to_treatment_folio_id?,
  promo_discount?, applied_promotions?,
  idempotency_key,           // crypto.randomUUID(), backend dedupes on replay
  manager_pin?,              // wholesale credit-limit override retry only; cleared after read
  // restaurant fields:
  draft_order_id?, order_context?, table_session_id?, seat_count?, signature_svg?
}
```
