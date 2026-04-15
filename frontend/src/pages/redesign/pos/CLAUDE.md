# POS Module — Claude Guide

- **22 files** — entire POS terminal, driven by a single React Context (`POSContext`)
- **`POSContext.jsx`** — central state machine (~1394 lines). `POSProvider` wraps the page, `usePOS()` hook for all children. **~165 exports** (state values + setters + computed values + functions). Lock state in `sessionStorage` (`posLocked=1`, clears on tab close). Offline queue uses `localStorage` keyed per employee ID (`pos_offline_queue_<employeeId>`). M9 exports: `chargeToRoomFolioId`, `setChargeToRoomFolioId`, `openBookings`, `openBookingsLoading`. M10 exports: `chargeToTreatmentFolioId`, `setChargeToTreatmentFolioId`, `openTreatmentPlans`, `setOpenTreatmentPlans`. Also exports `presetLabels` (from `usePreset()`) used by `printSlip`.
- **`cartMath.js`** — pure utility, zero React. `calcGrossTotal`, `calcDiscountValue` (percent/flat), `calcTaxTotal` (inclusive only — exclusive adds tax in calling code), `calcTotal` (always ≥ 0)

## Context Bootstrap Behavior

On mount, `POSProvider`:
1. Parallel-fetches `/api/outlets` + `/api/customers` — auto-selects outlet from `readContext().active_outlet_id` if set; falls back to auto-select if only one outlet exists
2. Fetches `/api/receipt-templates/active` — silently falls back to defaults if none
3. Fetches `/api/feature-flags` into `posFlags` map — controls `phase2_draft_orders` behavior
4. After outlet selected: fetches active shift (`/api/shifts/active?outlet_id=X`) + attendance status (`/api/attendance/my-status`)

## Critical Gotchas

- **`completeSale` uses `api.raw` (not `api.post`)** — to detect 401 mid-checkout (session expiry). On 401, stores payload in `pendingSaleRef.current`, sets `sessionExpired=true`. Do NOT refactor to `api.post`.
- **Park sale is feature-flagged** — when `posFlags.phase2_draft_orders` is true, parks to `POST /api/draft-orders` instead of `POST /api/parked-sales`. Both paths then call `loadParked()`.
- **F-key shortcuts use `ref` indirection** — `parkSaleRef`, `openCheckoutRef`, `removeFromCartRef` are updated each render so the keyboard `useEffect` (which captures a stale closure) still calls the current function. Pattern: declare the ref, assign in the function body, call `ref.current?.()` in the keyboard handler.
- **Offline idempotency** — `completeSale` generates `crypto.randomUUID()` as `idempotency_key`. On sync, if backend returns `{ duplicate: true }`, the sale is dequeued without error. Auto-sync fires on `window.online` event.
- **Opening denominations are hardcoded** in `POSContext.jsx` — `OPENING_DENOMS = [5000, 1000, 500, 100, 50, 20, 10]`. Closing denominations come from `useCurrency().denominations` (tenant-configurable).
- **Loyalty rates are hardcoded** — `LOYALTY_EARN_RATE = 1` (1pt per PKR 100 spent), `LOYALTY_REDEEM_RATE = 10` (100pts = PKR 10 off). A TODO comment marks these for future configurability.
- **Price list resolution priority** — customer price list takes priority over outlet price list. Customer list fetched on `selectedCustomerId` change; outlet list fetched on `selectedOutletId` change using highest-priority assignment from `/api/price-list-assignments?scope_type=outlet&scope_id=X`.
- **Customer display sync** — debounced 500ms, POSTs to `/api/pos/customer-display` on every cart change while `activeShift.id` is set. Silent fail (`catch(() => {})`).
- **Barcode scanner** — global `keydown` listener buffers rapid keystrokes (100ms inter-key timeout). On `Enter` with buffer ≥ 3 chars, calls `handleBarcodeScanned` via `api.raw GET /api/products/scan/:barcode`. Ignores 404.
- **`isReadyForCheckout`** — computed boolean: `selectedOutletId && activeShift && attendanceCode === "clocked_in"`. All three must be true before checkout is allowed.
- **Auto-apply promotions** — debounced 400ms POST to `/api/promotions/quote` on cart changes. Result sets `appliedPromotions` + `promoDiscount` (included in `completeSale` payload alongside manual discount).
- **POS layout + item suggestions** — `posLayout` fetched from `/api/pos-layouts` on outlet change; `suggestions` fetched from `/api/pos/suggestions?product_ids=...` with 500ms debounce on cart changes.

## Modal Components

All modals read from `usePOS()` context and null-guard at top (`if (!open) return null`) — **except `POSApprovalModal` and `POSEmailReceiptModal` which use props instead of context**.

| Modal | Context vs Props | Key behavior |
|-------|-----------------|--------------|
| `POSCheckoutModal` | context | Multi-payment tenders; loyalty points toggle (disabled offline); wallet toggle adds/removes `{ method: "Wallet" }` payment entry; quick-create customer inline |
| `POSDiscountModal` | context | Percent/flat toggle; value stored in `discountInput` + `discountType` |
| `POSReturnExchangeModal` | context | Most complex modal — refund mode + exchange mode; exchange: POST sale first, return second (prevents inconsistent state); fetches `/api/return-reasons` on mount; supports Phase 2 `policyQuote` + `approvalEventId` fields; calls `api.get/post` directly |
| `POSReceiptModal` | context | Embeds `POSEmailReceiptModal` (props-driven); shows returned items section for exchange receipts; WhatsApp share uses `wa.me/?text=` link |
| `POSParkedModal` | context | Calls `api.del()` directly for delete action — not purely context-driven |
| `POSCloseShiftModal` | context | POSTs to `/api/shifts/:id/close`; uses `useCurrency().denominations` (not hardcoded); shows variance result after close |
| `POSOpeningGateModal` | context | 3-state gate: needsOutlet → needsShift → needsClockIn. Only shown when one of these conditions is true. Non-admin cashiers see read-only outlet name (no switcher). Manager opens shift with float + denominations. |
| `POSNoteModal` | context | Simple textarea → `orderNote` |
| `POSSessionExpiredModal` | context | PIN re-auth via `POST /api/employees/validate-pin` (always PIN, even if employee has password). On success: calls `retryPendingSale()`. On cancel: parks the pending sale then navigates to `/login`. |
| `POSLockScreen` | context | Full-page overlay (not fixed modal). `handleUnlock` validates PIN via `POST /api/employees/validate-pin`; checks that unlocked employee matches logged-in employee. |
| `POSShortcutsOverlay` | context | Uses **CSS variable tokens** (`--ui-surface`, `--ui-text`, `--ui-border`) — **NOT** standard POS `#8066FF`/slate styling |
| `POSApprovalModal` | **props** | Props: `actionType`, `referenceType`, `referenceId`, `outletId`, `metadata`, `onApproved`, `onDenied`, `onClose`. POSTs to `/api/approvals/pos-authorize`. Usable outside POS. |
| `EndlessAisleModal` | context | POSTs to `POST /api/orders/endless-aisle`. Pre-fills from `selectedCustomer`. Supports ship-to-customer or in-store pickup. Uses **`dark:` Tailwind variants + generic gray classes** — **NOT** standard POS styling. |
| `POSEmailReceiptModal` | **props** | Props: `{ saleId, customerEmail, onClose }`. POSTs to `POST /api/email/send-receipt-v2`. Auto-closes 1.5s after success. |

## Layout Components

| Component | Context reads | Notes |
|-----------|--------------|-------|
| `POSHeader` | outlets, selectedOutletId, employee, slip, activeShift, canOpenShift | Outlet switcher only for `canSwitchOutlet` (all_access) users. Shows Last Receipt, Recent Sales, Return, Close Shift, Help (F1), Lock, Logout buttons. |
| `POSSubHeader` | taxInclusive, cart, parkedSales, selectedOutletId | Tax Inclusive toggle + Park Sale + Parked Sales badge |
| `POSSearchArea` | search, barcodeSearch, skuSearch, priceSearch, results, showResults | 4 inputs: barcode, SKU, price, general. Enter on focused general search adds first result to cart. Inputs clear each other (only one active at a time). |
| `POSCartTable` | cart, updateQty, removeFromCart, money | Shows Bundle badge + "Special Price" badge when price list price differs from original. Mobile hides Unit column + delete button (inline trash per row instead). |
| `POSSidebar` | customer search, totals, discount, promoDiscount, appliedPromotions | Dark `#0A0A0A` background. `data-pos-customer-search` attribute on input for F4 focus. Shows promotion discount + promo name if applied. |
| `POSRecentSalesPanel` | recentSales, openReturnFromSale, printSlip | Slide-in from right. Fetches today's sales (`/api/sales?date_from=today&limit=50`). Reprint fetches `/api/sales/:id` for full detail. Uses `fmtDateTime` + `fmtTime` (not `fmtUtcDateTime`) for timestamps. |

## API Calls Made by This Module

| Component | Endpoint | Notes |
|-----------|---------|-------|
| `POSContext` | `GET /api/outlets` | Bootstrap |
| `POSContext` | `GET /api/customers` | Bootstrap — all customers loaded at once |
| `POSContext` | `GET /api/receipt-templates/active` | Silent fail if none |
| `POSContext` | `GET /api/feature-flags` | One-shot, into `posFlags` map |
| `POSContext` | `GET /api/shifts/active?outlet_id=X` | Gate status |
| `POSContext` | `GET /api/attendance/my-status?outlet_id=X` | Gate status |
| `POSContext` | `GET /api/parked-sales?outlet_id=X` | On outlet select + after park/restore |
| `POSContext` | `GET /api/sales?date_from=today&outlet_id=X&limit=50` | Recent sales panel |
| `POSContext` | `GET /api/products/search?query=X&outlet_id=X&field=X` | 250ms debounce |
| `POSContext` | `api.raw GET /api/products/scan/:barcode` | Barcode scanner |
| `POSContext` | `GET /api/customers/:id/wallet` | On checkout customer select |
| `POSContext` | `GET /api/price-lists/:id/items` | Customer or outlet price list |
| `POSContext` | `GET /api/price-list-assignments?scope_type=outlet&scope_id=X` | Outlet price list assignment |
| `POSContext` | `GET /api/pos-layouts?outlet_id=X` | Phase 2B |
| `POSContext` | `GET /api/pos/suggestions?product_ids=X` | Phase 2B, 500ms debounce |
| `POSContext` | `POST /api/promotions/quote` | Auto-apply promos, 400ms debounce |
| `POSContext` | `POST /api/parked-sales` or `POST /api/draft-orders` | Park sale (flag-gated) |
| `POSContext` | `GET /api/parked-sales/:id` + `DELETE /api/parked-sales/:id` | Restore |
| `POSContext` | `POST /api/shifts/open` | Open shift |
| `POSContext` | `POST /api/customers` | Quick-create at checkout |
| `POSContext` | `api.raw POST /api/sales` | Complete sale (uses raw for 401 detection) |
| `POSContext` | `POST /api/pos/customer-display` | Customer display sync, 500ms debounce |
| `POSContext` | `POST /api/employees/validate-pin` | Lock unlock + session re-auth |
| `POSCheckoutModal` | (all via context) | — |
| `POSCloseShiftModal` | `POST /api/shifts/:id/close` | Direct `api.post` call |
| `POSReturnExchangeModal` | `GET /api/return-reasons` | On mount |
| `POSReturnExchangeModal` | `GET /api/sales/:id` | Load sale by ID |
| `POSReturnExchangeModal` | `GET /api/sales?search=X&limit=5` | Invoice search |
| `POSReturnExchangeModal` | `GET /api/products/search` | No-bill return + exchange item search |
| `POSReturnExchangeModal` | `POST /api/sales` | Exchange sale (direct) |
| `POSReturnExchangeModal` | `POST /api/returns` | Return (direct) |
| `POSRecentSalesPanel` | `GET /api/sales/:id` | Reprint detail |
| `POSParkedModal` | `DELETE /api/parked-sales/:id` | Direct delete (not via context) |
| `POSApprovalModal` | `POST /api/approvals/pos-authorize` | Direct |
| `POSEmailReceiptModal` | `POST /api/email/send-receipt-v2` | Direct |
| `EndlessAisleModal` | `POST /api/orders/endless-aisle` | Direct |
| `POSSessionExpiredModal` | `POST /api/employees/validate-pin` | Direct |

## Styling Exception

POS does NOT use design system tokens or CSS variables for most components. Uses:
- Hardcoded **`#8066FF`** for accent color (brand violet)
- **`slate-*`** Tailwind classes throughout
- **`#0A0A0A`** / `#111` for the sidebar dark background

Three exceptions:
- `POSShortcutsOverlay` — uses CSS variable tokens (`--ui-surface`, `--ui-text`, `--ui-text-muted`, `--ui-border`, `--ui-muted-surface`)
- `EndlessAisleModal` — uses `dark:` Tailwind variants + generic `gray-*` classes (added later, does not follow POS conventions)
- `POSApprovalModal` — uses `slate-800` dark background (manager PIN UI intentionally styled differently)

When adding new POS components, follow the majority convention (`#8066FF` + `slate-*`).
