# POS Module — Claude Guide

- **62 files** — entire POS terminal, driven by a single React Context (`POSContext`) that is composed from 8 domain hooks
- **`POSContext.jsx`** — orchestrator only (~400 lines). Composes hooks, wires state between them, provides `POSContext` value. ~165 exports (wave-C snapshot list at top of file). `usePOS()` hook — throws if used outside `POSProvider`.
- **`cartMath.js`** — pure utility, zero React. `calcGrossTotal`, `calcDiscountValue` (percent/flat), `calcTaxTotal` (both inclusive and exclusive — inclusive backs tax out, exclusive adds on top), `calcTotal` (always ≥ 0)
- **`omniInputRouter.js`** — pure pattern classifier. `classifyOmniInput(raw)` returns `{ kind, value?, format? }`. Kinds: `noop`, `barcode` (EAN-8/12/13/14 by digit length), `plu` (4-5 digit numeric), `customer` (`#`-prefixed), `text` (everything else).

---

## Context Hook Decomposition

`POSContext.jsx` composes 8 hooks (bottom-up, each receives results of earlier hooks):

| Hook | File | Owns |
|------|------|------|
| `useShiftGate` | `hooks/useShiftGate.js` | outlets, selectedOutletId, activeShift, attendanceStatus, openShift, closeShift |
| `useCart` | `hooks/useCart.js` | cart, search, price lists, POS layout, suggestions, promotions, discount, note, tax toggle |
| `useReceipt` | `hooks/useReceipt.js` | slip, slipOpen, receiptTemplate, recentSales, printSlip |
| `useCustomerDisplay` | `hooks/useCustomerDisplay.js` | customer display sync (debounced POST to `/api/pos/customer-display`) |
| `useLoyaltyWallet` | `hooks/useLoyaltyWallet.js` | checkoutWalletBalance, loyalty points, earnRate, redeemRate |
| `useFolioCharging` | `hooks/useFolioCharging.js` | chargeToRoomFolioId, chargeToTreatmentFolioId, openBookings, openTreatmentPlans |
| `useOfflineQueue` | `hooks/useOfflineQueue.js` | offlineQueueCount, queuedSalesCount, queuedReturnsCount, syncQueue |
| `useCheckout` | `hooks/useCheckout.js` | completeSale, addPayment, payments, submitting, handleQuickCreateCustomer |

---

## Critical Gotchas

- **`completeSale` uses `api.raw` (not `api.post`)** — to detect 401 mid-checkout. On 401, stores payload in `pendingSaleRef.current`, sets `sessionExpired=true`. Do NOT refactor to `api.post`.
- **Park sale is feature-flagged** — when `posFlags.phase2_draft_orders` is true, parks to `POST /api/draft-orders` instead of `POST /api/parked-sales`.
- **F-key shortcuts use `ref` indirection** — `parkSaleRef`, `openCheckoutRef`, `removeFromCartRef` updated each render so the keyboard `useEffect` (stale closure) calls the current function.
- **Offline queue now IndexedDB-backed** (`utils/offlineQueue.js`). Also supports returns (`type: "return"`). Legacy `localStorage` migration runs on mount. Failed entries viewable in `POSStuckQueueModal`. Auto-sync fires on `window.online` event.
- **Offline idempotency** — `completeSale` generates `crypto.randomUUID()` as `idempotency_key`. Backend returns `{ duplicate: true }` on replay → dequeued without error.
- **Opening denominations** — hardcoded in `useShiftGate.js`: `OPENING_DENOMS = [5000, 1000, 500, 100, 50, 20, 10]`. Closing denominations come from `useCurrency().denominations`.
- **Loyalty rates** — NO LONGER HARDCODED. Fetched from `GET /api/loyalty/config` on mount. Falls back to defaults (earn=1pt per 100 spent, redeem=PKR10 per 100 pts) if endpoint errors or returns null.
- **Price list priority** — customer price list takes priority over outlet price list. Outlet price list only fetched when `posFlags.phase2_outlet_pricing` is on (skips on 503 to avoid Sentry noise).
- **Barcode scanner (global keydown)** — 100ms inter-key timeout buffer, fires `handleBarcodeScanned` on `Enter` with buffer ≥ 3 chars. Separate from `POSOmniInput` (which is the typed search box).
- **POS device registration** — `POST /api/pos-devices/register` called when `posFlags.phase2_pos_layouts` is on. Device UUID in `localStorage["pos_device_uuid"]`, surrogate ID in `localStorage["pos_device_id"]`. Silently fails when flag is off.
- **Cart checkpoint/resume** — debounced 1s write to `sessionStorage["pos_cart_checkpoint_${employeeId}"]`. On mount (empty cart), if checkpoint ≤ 8h old, `POSCartResumeModal` prompts restore. Scoped per employee ID.
- **Stale-shift recovery** — `POSShiftRecoveryModal` opens when active shift is >20h old. No before-noon filter (any time-of-day). Dismissed for rest of session via state (not persisted).
- **Tax mode** — default for `taxInclusive` toggle derived from `company.tax_mode` (from `useAuth()`). Re-syncs when mode loads async but only resets if cart is empty.
- **`isReadyForCheckout`** — `Boolean(selectedOutletId && activeShift && attendanceCode === "clocked_in")`. All three required.

---

## `POSOmniInput.jsx`

Single search bar that replaces the old 4-field search. Uses `classifyOmniInput` to route:
- `barcode`/`plu` → `GET /api/products/scan/:barcode` via `api.raw`. If variants → sets `pendingVariantProductId` (opens variant modal). If `serial_required` → sets `pendingSerialContext` + `pendingSerialProductId`. Otherwise → `addToCart`.
- `customer` → `GET /api/customers?search=X`. If one match → sets `selectedCustomerId`. If multiple → opens customer dropdown.
- `text` → sets `search` state → triggers search results dropdown.

Auto-focus on mount. Re-focuses every 10 seconds if no input/textarea/select is focused. `/` key moves focus to omni-input (when no input is active).

---

## Modal Components

All modals null-guard with `if (!open) return null` at top, using `usePOS()` — **except those noted with props below**.

| Modal | Source | Key behavior |
|-------|--------|-------------|
| `POSCheckoutModal` | context | Multi-payment tenders; loyalty points toggle; wallet toggle adds `{ method: "Wallet" }` payment entry; quick-create customer inline |
| `POSDiscountModal` | context | Percent/flat toggle; value stored in `discountInput` + `discountType` |
| `POSReturnExchangeModal` | context | Most complex — refund + exchange mode; exchange: POST sale first, return second; fetches `/api/return-reasons` on mount; 409 `duplicate_return` → opens `POSCartCollisionModal`; supports `policyQuote`/`approvalEventId` |
| `POSReceiptModal` | context | Embeds `POSEmailReceiptModal` (props); shows returned items for exchange receipts; WhatsApp share via `wa.me/?text=` |
| `POSParkedModal` | context | Calls `api.del()` directly for delete — not purely context |
| `POSCloseShiftModal` | context | `POST /api/shifts/:id/close`; uses `useCurrency().denominations` (not hardcoded); shows variance after close |
| `POSOpeningGateModal` | context | 3-state gate: needsOutlet → needsShift → needsClockIn. Non-admin cashiers see read-only outlet name |
| `POSNoteModal` | context | Simple textarea → `orderNote` |
| `POSSessionExpiredModal` | context | PIN re-auth via `POST /api/employees/validate-pin`. On success: `retryPendingSale()`. On cancel: parks pending sale then navigates to `/login` |
| `POSLockScreen` | context | Full-page overlay (not fixed modal). Validates PIN via `POST /api/employees/validate-pin`; checks unlocked employee matches logged-in employee |
| `POSShortcutsOverlay` | context | Uses CSS variable tokens — NOT hardcoded POS colors |
| `POSModifierModal` | context | Product modifier groups — `single` (radio-style) / `multi` (checkbox-style) selection. Each option has `price_delta`. Context provides `modifierModalState`, `confirmModifiers`, `cancelModifiers`. Defaults pre-selected from `is_default` flag. |
| `POSVariantMatrixModal` | context | Opens when `pendingVariantProductId` is set. Matrix selection of variants. On confirm → `addToCart`. |
| `POSSerialEntryModal` | context | Opens when `pendingSerialContext` is set. Collects N serial number slots (one per quantity). Commits to cart line on success. |
| `POSPriceOverrideModal` | context | Opens when `priceOverrideLineId` is set. Manager can override price on a cart line. |
| `POSHoldCreateModal` | context | Create a layaway hold — `POST /api/holds`. Fields: deposit amount, deposit method, hold days (default 14), customer name/phone, notes. Clears cart on success. |
| `POSHoldPickupModal` | context | Pick up a held order. Fetches holds list, selects one, loads items to cart. |
| `POSBarcodeMissModal` | context | Only shown when cashier has inventory perms. `barcodeMissPrompt = { barcode }`. Quick-create product link. Others get a toast. |
| `POSInsufficientStockModal` | context | `insufficientStockPrompt = { product_id, product_name, requested, available }`. Shown when `/api/sales` returns `{ code: "insufficient_stock" }`. |
| `POSStuckQueueModal` | props: `{ open, onClose }` | Reads failed offline queue entries via `getQueueByState(employeeId, "failed")`. Retry = `markPending(key)` + `syncQueue()`. Shows total + formatted amount. |
| `POSCartCollisionModal` | context | `collisionModal = { existing: {...} }`. Opened when returns API returns 409 `duplicate_return`. Shows existing return info so cashier can see who/when. |
| `POSCartResumeModal` | context | `cartResumePrompt = { cart, selectedOutletId, customer, timestamp }`. Prompts after page load if checkpoint found. |
| `POSShiftRecoveryModal` | context | `shiftRecoveryOpen` set when shift >20h old. Dismiss = `setShiftRecoveryDismissed(true)`. |
| `POSRefundThresholdModal` | **props** | Props: `{ open, threshold, refundAmount, currency, error, loading, onSubmit(pin), onClose }`. Shown when `/api/returns` returns `{ code: "manager_pin_required" }`. Caller re-posts with `manager_pin`. |
| `POSNoSaleReasonModal` | context | Reason for opening cash drawer without a sale. |
| `POSReceiptRetryModal` | context | Shown when receipt email/print fails after sale. Retry options. |
| `POSApprovalModal` | **props** | Props: `{ actionType, referenceType, referenceId, outletId, metadata, onApproved, onDenied, onClose }`. `POST /api/approvals/pos-authorize`. Usable outside POS. |
| `EndlessAisleModal` | context | `POST /api/orders/endless-aisle`. Uses `dark:` Tailwind variants + gray classes — NOT POS styling. |
| `POSEmailReceiptModal` | **props** | Props: `{ saleId, customerEmail, onClose }`. `POST /api/email/send-receipt-v2`. Auto-closes 1.5s after success. |

---

## Layout Components

| Component | Notes |
|-----------|-------|
| `POSHeader` | Outlet switcher (all_access only). Last Receipt, Recent Sales, Return, Close Shift, Help (F1), Lock, Logout |
| `POSSubHeader` | Tax Inclusive toggle + Park Sale + Parked Sales badge |
| `POSSidebar` | Dark `#0A0A0A` background. `data-pos-customer-search` attr on input for F4 focus. Shows promo discount + name |
| `POSCartTable` | Bundle badge + "Special Price" badge when price list price differs. Mobile hides Unit column |
| `POSSearchArea` | 4 inputs (barcode, SKU, price, general search) — inputs clear each other |
| `POSOmniInput` | Single smart search bar (replaces POSSearchArea in wave-C layout). `classifyOmniInput` routing |

---

## Restaurant Subdirectory (`restaurant/`)

12 files — full restaurant/table-service mode. Gated by `phase4_restaurant` flag. Integrated with POS checkout hook via `draftOrderId`, `orderContext`, `tableSessionId`, `seatCount`.

| File | Role |
|------|------|
| `cartGrouping.js` | Pure helper. `groupCartBySeatAndCourse(cart)` → `[{ seat, course, items, subtotal, itemCount }]`. Seat 0 = un-seated. Course parsed from `"course_N"` string (DB column is `course_name`). |
| `RestaurantCartGrouped.jsx` | Cart view grouped by seat + course |
| `RestaurantHeader.jsx` | Table/check header strip |
| `SeatCoursePicker.jsx` | Picker for assigning seat number and course to a cart item |
| `RestaurantGuestModeModal.jsx` | Guest count + optional signature capture modal |
| `SplitCheckModal.jsx` | Split bill across guests/seats |
| `TransferTableModal.jsx` | Move check to another table |
| `RestaurantAvailabilityModal.jsx` | Table availability view |
| `RestaurantOverflowMenu.jsx` | Extra restaurant actions (void, comp, etc.) |
| `VoidCompModal.jsx` | Void or comp an item |
| `PayAtTableQRModal.jsx` | QR code for pay-at-table flow |
| `ReservationBadge.jsx` | Shows reservation status on table |
| `RestaurantActionBar.jsx` | Action buttons bar for restaurant mode |
| `RestaurantCheckView.jsx` | Full check detail view |
| `RestaurantFloorGrid.jsx` | Floor plan grid of tables |

---

## Hooks Summary

### `useShiftGate`
Returns: `outlets`, `selectedOutletId`, `setSelectedOutletId`, `activeShift`, `attendanceStatus`, `attendanceCode`, `gateLoading`, `canOpenShift` (`manage_orders` perm), `canSwitchOutlet` (`all_access` perm), `isReadyForCheckout`, `openingDenoms`, `setOpeningDenoms`, `openingFloat`, `openingShiftBusy`, `openShiftFromPOS`, `closeShiftOpen`, `setCloseShiftOpen`, `refreshGateStatus`.

`OPENING_DENOMS = [5000, 1000, 500, 100, 50, 20, 10]` hardcoded here.

### `useCart`
Returns all cart state including: `cart`, `setCart`, `taxInclusive`, `setTaxInclusive`, `search`, `setSearch`, `barcodeSearch`, `setBarcodeSearch`, `skuSearch`, `setSkuSearch`, `priceSearch`, `setPriceSearch`, `results`, `setResults`, `showResults`, `setShowResults`, `searchRef`, `discountType`, `discountInput`, `orderNote`, `showDiscountModal`, `showNoteModal`, `priceListItems`, `posLayout`, `suggestions`, `appliedPromotions`, `promoDiscount`, and computed totals: `grossTotal`, `discountValue`, `taxTotal`, `total`, plus `addToCart`, `updateQty`, `setQty`, `removeFromCart`, `triggerSearch`, `handleSearchChange`, `loadParked`.

`taxInclusive` default syncs from `taxMode` (passed in). Re-syncs when `taxMode` loads if cart is empty.

### `useLoyaltyWallet`
Reads loyalty config from `GET /api/loyalty/config` (in POSContext). Receives `loyaltyConfig` as prop. Falls back to `earnRate=1`, `redeemRate=10` if null.

Returns: `checkoutWalletBalance`, `checkoutWalletLoading`, `redeemPointsOn`, `setRedeemPointsOn`, `payWithWalletOn`, `setPayWithWalletOn`, `checkoutCustomerPoints`, `checkoutCustomerTier`, `pointsEarned`, `pointsDiscount`, `pointsRedeemed`, `LOYALTY_EARN_RATE`, `LOYALTY_REDEEM_RATE`.

### `useOfflineQueue`
IndexedDB-backed via `utils/offlineQueue.js`. Migrates old `localStorage` format on mount.

Returns: `offlineQueueCount` (total), `queuedSalesCount`, `queuedReturnsCount`, `offlineSyncing`, `offlineSyncResult`, `syncQueue`, `enqueueSale`, `enqueueReturn`.

Routes sync by `row.type` (`"return"` → `POST /api/returns`, else → `POST /api/sales`).

### `useReceipt`
Returns: `slip`, `setSlip`, `slipOpen`, `setSlipOpen`, `receiptTemplate`, `recentSalesOpen`, `setRecentSalesOpen`, `recentSales`, `recentSalesLoading`, `recentSalesSearch`, `setRecentSalesSearch`, `loadRecentSales`, `printSlip`.

`printSlip` calls `printToHardware` (from `utils/receipt.js`), falls back to browser popup.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| F1 | Help overlay |
| F2 | Discount modal |
| F3 | Park sale |
| F4 | Focus customer search (via `data-pos-customer-search` attribute) |
| F5 | Parked sales |
| F8 | Remove last cart item |
| F9 | Open checkout |
| F10 | Clear cart |
| Esc | Close modal |
| `/` | Focus omni-input (when no input active) |

F-keys work even when focus is in an input field.

---

## Styling Convention

POS does NOT use design system tokens for most components. Uses:
- Hardcoded **`#8066FF`** for accent color
- **`slate-*`** Tailwind classes throughout
- **`#0A0A0A`** / `#111` for sidebar dark background

**Exceptions** (use CSS variable tokens):
- `POSShortcutsOverlay` — `--ui-surface`, `--ui-text`, `--ui-text-muted`, `--ui-border`, `--ui-muted-surface`
- `EndlessAisleModal` — `dark:` Tailwind variants + generic `gray-*`
- `POSApprovalModal` — `slate-800` dark background

When adding new POS components, follow the majority convention.

---

## `completeSale` Payload

```js
POST /api/sales:
{
  outlet_id, shift_id, employee_id, customer_id?,
  cartItems: [{ id, variant_id?, price, quantity, modifier_ids?, serial_numbers?, seat_number?, course_name?, staff_id? }],
  payments: [{ method, amount }],
  discount_type, discount_value,
  tax_inclusive, tax_total,
  order_note?,
  redeem_points?, points_redeemed?,
  wallet_payment_amount?,
  charge_to_room_folio_id?, charge_to_treatment_folio_id?,
  promo_discount?, applied_promotions?,
  idempotency_key,
  // restaurant fields:
  draft_order_id?, order_context?, table_session_id?, seat_count?, signature_svg?
}
```
