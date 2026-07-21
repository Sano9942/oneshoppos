# POS Module — Claude Guide

The POS terminal UI is driven by a single React Context (`POSContext`) composed from domain-specific hooks in `hooks/`. Every file covered below lives directly under `pos/`. A `restaurant/` subdirectory holds table-service components (floor grid, seat/course picker, split check, table transfer, guest-mode handoff) backing `POSRestaurantRedesign.jsx` — those are documented in `pages/redesign/CLAUDE.md`, not here.

## Core files

- **`POSContext.jsx`** — the orchestrator. Composes the domain hooks bottom-up (each hook receives outputs of earlier hooks as inputs), wires cross-hook state that doesn't belong to any single hook (modifier picker, restaurant seat/course stamping, cart checkpoint/resume, the global F-key + barcode-scanner keydown listener, POS device registration), and exposes one large `value` object via `usePOS()`. A comment block near the top of the file enumerates every key that must stay in the exported `value` object — keep it in sync when adding or removing exports. `usePOS()` throws if called outside `POSProvider`.
- **`cartMath.js`** — pure functions, zero React imports. `calcGrossTotal(cart)`; `calcDiscountValue(grossTotal, discountType, discountInput)` (percent or flat); `calcTaxTotal(cart, taxInclusive)` (inclusive backs tax out of the sticker price, exclusive adds tax on top — each line uses its own `effectiveTaxRate` so mixed-rate carts compute correctly); `calcTotal(grossTotal, discountValue, taxTotal, taxInclusive)` (always clamped to ≥ 0).
- **`omniInputRouter.js`** — pure pattern classifier, zero React. `classifyOmniInput(raw)` returns `{ kind, value?, format? }`. Kinds: `noop` (empty/too short input), `barcode` (all-digit, EAN-8/12/13/GTIN-14 by digit length), `plu` (4-5 digit numeric that doesn't match a recognized barcode length), `customer` (`#`-prefixed), `text` (fallback). Consumed only by `POSOmniInput.jsx`.

Both `cartMath.js` and `omniInputRouter.js` are deliberately pure — no React, no `usePOS()` — so they're cheap to unit-test in isolation.

## Hook decomposition

`POSContext.jsx` composes these hooks from `hooks/`, each receiving outputs of earlier hooks:

| Hook | Owns |
|---|---|
| `useShiftGate` | Outlets list, `selectedOutletId`, `activeShift`, attendance status/code, `gateLoading`, `canOpenShift`/`canSwitchOutlet` (keyed on `manage_orders`/`all_access`), `isReadyForCheckout`, opening-cash denominations + `openingFloat`, `openShiftFromPOS` |
| `useCart` | Search state (barcode/SKU/price/general fields), the cart array, `taxInclusive`, price-list price resolution (a customer's price list overrides the outlet's), POS layout tiles, item suggestions, auto-applied promotions, order-level discount/note state, computed totals (delegated to `cartMath.js`) |
| `useReceipt` | The last sale's slip object, `slipOpen`, the active receipt template, recent-sales list/search, `printSlip` (drives hardware print and arms a retry prompt on failure), `printBrowserFallback` |
| `useCustomerDisplay` | Pure side effect, no state returned — debounces 500ms then POSTs the current cart/totals to the customer-facing display endpoint whenever they change, keyed off the active shift id |
| `useLoyaltyWallet` | Wallet balance, points earn/redeem math (rates fetched from a loyalty-config endpoint, hardcoded fallbacks only if that call fails), zeroes every derived value when the loyalty feature is off |
| `useFolioCharging` | Charge-to-room-folio and charge-to-treatment-plan-folio dropdown data — room bookings fetched only while checkout is open, treatment plans fetched only once a checkout customer is set |
| `useOfflineQueue` | The IndexedDB-backed offline sale/return queue (thin wrapper over `utils/offlineQueue.js`), auto-syncs on the browser's `online` event, splits pending counts by type |
| `useCheckout` | Payments array, `completeSale`, `addPayment`, tip/server capture, session-expiry recovery, credit-limit override retry, backorder staging |

`POSContext.jsx` itself also owns: lock state, the customers list, parked sales, the endless-aisle out-of-stock order flow, the "today's appointments" checkout entry point, modifier-picker wiring, restaurant shell state (draft order id, order context, seat/course), price-override apply, cart checkpoint/resume, stale-shift detection, POS device registration, and the global F-key/barcode-scanner keydown listener.

## Critical gotchas

- **`completeSale` uses `api.raw`, not `api.post`** — it needs to branch on the response status/code before deciding what to do: a 401 parks the payload and opens the session-expired modal; a 400 with `code: "insufficient_stock"` opens the insufficient-stock modal; a 403 with `code: "CREDIT_LIMIT_EXCEEDED"` (on-account tender pushing a customer over their credit limit) opens the credit-limit modal with the payload parked for a manager-PIN retry. Don't refactor this call to `api.post`.
- **Offline-first checkout** — if `!navigator.onLine` (or the fetch throws `TypeError`), `completeSale` enqueues the sale via `useOfflineQueue` and immediately shows a `"PENDING"` slip instead of blocking. Idempotency is `crypto.randomUUID()` stamped as `idempotency_key`; the backend returns `{ duplicate: true }` on replay.
- **Park sale is feature-flagged** — with `posFlags.phase2_draft_orders` on, park writes to `POST /api/draft-orders` instead of `POST /api/parked-sales`. `loadParked` always reads and merges both sources (normalizing draft rows to the legacy shape with a `_source` tag) so a tenant that flips the flag mid-life doesn't lose access to previously parked sales.
- **F-key handlers use ref indirection** — `parkSaleRef`, `openCheckoutRef`, `removeFromCartRef` are refreshed every render via small effects so the single keydown listener (registered once on mount) always calls current closures instead of stale ones captured at mount time.
- **Barcode scanner buffer** — the global keydown listener buffers rapid keystrokes (a 100ms inter-key gap resets the buffer) and fires the scan handler on `Enter` once the buffer is at least 3 characters. This is separate from the omni-input's own typed field and the PLU pad. `POSReturnExchangeModal` and `POSHoldPickupModal` each register their own independent copy of the same buffering pattern for their own scan contexts (invoice barcode, hold barcode).
- **Barcode-not-found handling** — a 404 from the scan endpoint shows a quick-create modal to cashiers with `manage_inventory`; everyone else just gets a toast. Serialized products (`serial_required`) intercept the add-to-cart flow into the serial-entry modal instead of adding directly.
- **Cart checkpoint/resume** — the cart is debounce-written (1s) to a `sessionStorage` key scoped to the logged-in employee. On mount, if the cart is empty and a checkpoint younger than 8 hours exists, a resume prompt is offered. Per-employee scoping means a second cashier logging into the same terminal never inherits the first cashier's cart.
- **Stale-shift recovery** — fires whenever the active shift is older than 20 hours, with no time-of-day filter (overnight/extended shifts qualify too). Dismissing it is session-only, never persisted.
- **Tax-inclusive default** — derives from the tenant's `tax_mode` (via `useAuth()`, threaded through `POSContext` into `useCart`), and re-syncs whenever that value finishes loading asynchronously — but only while the cart is empty, so it never mutates an in-progress sale. The toggle is hidden entirely when `tax_mode === "none"` (an unregistered tenant can't legally charge GST).
- **`isReadyForCheckout`** — `Boolean(selectedOutletId && activeShift && attendanceCode === "clocked_in")`. All three are required.
- **Loyalty rates are not hardcoded** — fetched from a loyalty-config endpoint on mount; only falls back to a hardcoded earn/redeem rate if that call errors (e.g. an older tenant schema missing the config columns).
- **Price-list priority** — a customer's price list overrides the outlet's price list; the outlet price list is only fetched at all when a dedicated feature flag is on. Every cart line's price is re-resolved whenever the price-list source changes (e.g. attaching or removing a customer).
- **POS device identity** — a stable UUID is generated once and cached in `localStorage`, then registered with the backend (feature-gated, skipped entirely when the flag is off to avoid phantom failed requests) to obtain an integer device id used for per-device layout scoping and per-device bulk-scan-mode storage keys.
- **Modifier picker** — adding a product with linked modifier groups pauses the add flow until the cashier confirms selections in the modifier modal; bundles and products with no modifier groups skip the lookup and add directly.
- **Restaurant seat/course stamping** — when a restaurant check is open (order context set) and the tenant isn't in counter-service layout mode, every cart line is stamped with the active seat number and course name. Counter-service tenants that inherit the restaurant shell force these back to schema defaults so kitchen routing, reports, and tax exports treat the sales as standard.
- **Salon walk-in guard** — checkout blocks (rather than silently defaulting to the cashier) when the tenant's industry type is salon, there's no linked appointment, and any cart line lacks a `staff_id` with no server selected either — the checkout modal shows a blocking "Performed by" picker for walk-ins.
- **Scale/grocery decoded lines** — a line decoded from a scale price- or weight-embedded barcode always creates a new cart line, never merges with an existing line for the same product. Price-embedded lines carry a final, locked price (excluded from percentage promotions, bypasses the price-list cascade); weight-embedded lines carry the decoded net weight as quantity at the shelf unit price. Both lock the tare-weight field since the deli scale already netted it into the label.
- **Age-restricted attest** — the omni-input and PLU pad both gate `product.age_restricted` items behind a native `window.confirm()` before adding to cart (not a custom modal).
- **`navigate` IS exposed on the context value object** (fixed; it was missing for a long time, and both consumers threw on `undefined`). `POSContext.jsx` calls `useNavigate()` internally and exports it. `POSLockScreen.jsx` ("Sign out completely") and `POSSessionExpiredModal.jsx` (`handleCancel`) both destructure it. **Both must call `logout()` before `navigate("/login")`** — while `isAuthenticated` is still true, `LoginPage.jsx` redirects to `/context-select`, so navigating without logging out first strands the user on a dead token instead of showing login.
- **`parkSale()` returns an explicit success/failure boolean** — `true` when the cart is safely off the terminal (parked, or nothing to park), `false` when the park failed and the cart is still live. It still surfaces the error through `setError` either way, so fire-and-forget callers (F3, `POSSubHeader`, `RestaurantFloorGrid`'s table switch) can ignore the return. Any caller that *navigates away or discards the cart* on the strength of a park must check it: the park runs on the possibly-expired token and can fail, and dropping the cart on a failed park loses the sale. This is exactly the bug `POSSessionExpiredModal.handleCancel` had.

## Modal components

Most modals null-guard with `if (!x) return null`, reading their own visibility state directly from `usePOS()`. A subset instead take visibility via an `open` (or similarly named) prop rather than context — this matters when wiring a new modal into `POSRedesign.jsx`, since every POS modal mounts there rather than inside individual components.

Props-driven modals: `POSEmailReceiptModal`, `POSStuckQueueModal`, `POSCartCollisionModal`, `POSCartResumeModal`, `POSShiftRecoveryModal`, `POSRefundThresholdModal`, `POSCreditLimitModal`, `POSNoSaleReasonModal`, `POSReceiptRetryModal`, `POSApprovalModal`, `POSBarcodeMissModal`, `POSInsufficientStockModal`. Of these, `POSApprovalModal`, `POSNoSaleReasonModal`, `POSBarcodeMissModal`, and `POSInsufficientStockModal` never call `usePOS()` at all — fully standalone and reusable outside POS. (`POSStuckQueueModal` still calls `usePOS()` for `syncQueue`/`showNotice` even though visibility is prop-driven.)

### Checkout / payment

- **`POSCheckoutModal`** — multi-tender payment (Cash/Card/Wallet/Gift Card/on-account Credit). Gift card tender includes pre-printed-card auto-activation on first balance lookup; the on-account "Credit" tender is disabled until a customer is attached (the backend rejects it otherwise). Charge-to-room and charge-to-treatment-plan-folio dropdowns are gated by preset mode; a walk-in clinical customer with no active treatment plan gets an inline quick-create-plan form. Restaurant mode adds tip percentage/custom amount + tip method + server assignment + a "Hand to guest" button opening the guest-mode signature modal. Salon walk-ins get a blocking "Performed by" stylist picker.
- **`POSCreditLimitModal`** — shown on a 403 `CREDIT_LIMIT_EXCEEDED` from the sale POST. Collects a manager PIN; the caller's `retryWithManagerPin(pin)` re-posts the parked sale. Displays outstanding/attempted/limit/deficit.
- **`POSReceiptModal`** — the post-sale view: returned items (on an exchange receipt), gift cards issued, on-account invoice details for credit sales, a WhatsApp share link, an embedded `POSEmailReceiptModal`, and Print (via `printSlip`).
- **`POSReturnExchangeModal`** — the most complex modal in the module. Looks up the original invoice by number, via its own barcode-scanner buffer against a sale-by-barcode endpoint, or proceeds with a no-bill manual return. Supports refund or exchange — an exchange posts the new sale first, then the return, so a closed shift fails the sale before any return record is created, avoiding a restocked-but-unsold inconsistent state. Per-line restock toggle and reason code are feature-gated; scrapped (non-restocked) lines require a reason. A serial picker lets the cashier pick specific serialized units to return, matched against the sale's serial history. A 409 `duplicate_return` opens the cart-collision modal; `manager_pin_required` opens the refund-threshold modal inline, blocking via an awaited `Promise` until the PIN succeeds or is cancelled. Offline refund queueing is feature-gated and refund-only — exchanges always require the network since they mutate stock through a new sale.
- **`RestaurantGuestModeModal`** (in `restaurant/`) — writes tip and signature back through `POSContext` (`setTipAmount`, `setSignatureSvg`) and closes itself so the checkout modal completes the sale.

### Cart / stock intervention

- **`POSBarcodeMissModal`** — shown on a barcode 404, only to cashiers with inventory-management permission. Quick-creates the product and adds it to cart.
- **`POSInsufficientStockModal`** — shown on `insufficient_stock` from the sale POST. Options: adjust (clamp quantity to what's available), backorder the remainder (only offered when the backend flags it as possible and a customer is attached), oversell (permission-gated), or cancel.
- **`POSCartCollisionModal`** — shown on a 409 `duplicate_return`; displays the existing return's id, amount, employee, and timestamp.
- **`POSCartResumeModal`** — the cart-checkpoint resume prompt (see gotchas above).
- **`POSCreditLimitModal`** — see checkout section above.

### Shift / session

- **`POSLockScreen`** — a full-page terminal lock (not an overlay modal). PIN unlock through the context's `handleUnlock`; a "Sign out completely" option awaits `logout()` then `navigate("/login")` (the logout-before-navigate order is load-bearing — see the `navigate` note above).
- **`POSSessionExpiredModal`** — shown on a mid-checkout 401. Re-authentication is always PIN-based, never the dashboard password flow, even for an employee who also has a password set. Success retries the pending sale. Cancel ("Park sale & go to login") parks first and **branches on the result**: on failure it stays open and shows the error, leaving the cart live (never navigates — the sale isn't safe yet); on success it clears `sessionExpired`, awaits `logout()`, then navigates to `/login`.
- **`POSCloseShiftModal`** — denomination-based cash count with a variance reason/approver/notes; flips into a threshold-approval sub-mode requiring a manager PIN and a reason once the backend signals the variance crossed the tenant's threshold.
- **`POSOpeningGateModal`** — a three-state gate: needs outlet selected → needs an open shift → needs the employee clocked in. Cashiers without shift-opening permission only see a logout option when a shift needs opening; those who can open one see the denomination grid and opening float.
- **`POSShiftRecoveryModal`** — shown when the active shift is more than 20 hours old; offers close now / quick-close / keep open.
- **`POSStuckQueueModal`** — reads failed offline-queue entries. Retry marks the entry pending again and calls `syncQueue()`; discard marks it synced (effectively dropping it) after a confirmation prompt. Also opened directly from an admin-only "Stuck (N)" button in `POSHeader`.

### Product entry

- **`POSModifierModal`** — single (radio) or multi (checkbox, capped at a max-select count) modifier group selection; default options pre-select; validates min-select/required rules before confirming; sums the price delta across all picked options.
- **`POSVariantMatrixModal`** — opens when a scanned/searched product has more than one variant. Renders a grid of up to two attribute axes plus a filterable third axis; arrow-key navigation, Enter to commit, stock-colored cells (in-stock/low-stock/out-of-stock, out-of-stock disabled with strikethrough). Feature-gated. Chains into the serial-entry modal if the resolved variant's parent product requires serials — mutating the already-added cart line rather than adding a new one.
- **`POSSerialEntryModal`** — opens when a pending-serial context is set (from a scan, the variant matrix, or a direct serialized-product add). One input slot per unit of quantity, matched against the product's available-serials list (variant-scoped when applicable). Tab advances between slots; Enter commits once every slot resolves to a valid, non-duplicate serial. Feature-gated.
- **`POSPriceOverrideModal`** — opens when a cart line's override menu is used. Requires a reason code and a manager PIN, posts to a price-override approval endpoint, then calls the context's `applyPriceOverride(lineId, {...})`. Feature-gated.
- **`POSHoldCreateModal`** — creates a layaway hold from the current cart: deposit amount/method, hold expiry in days (default 14), attached customer or manual name/phone. Clears the cart on success and attempts a best-effort printable slip.
- **`POSHoldPickupModal`** — pickup flow with its own independent barcode-scanner buffer (or manual hold-number search). "Take Deposit" records a partial payment and leaves the hold open; "Complete & Print" settles the remaining balance and completes the hold.
- **`POSAppointmentsModal`** — the "today's appointments" checkout entry point. Tapping a row prefills the cart — one line per segment for a multi-service visit, each stamped with its own provider — and links the eventual sale back to the appointment so the backend marks it completed on commit.
- **`EndlessAisleModal`** — out-of-stock order-capture flow (ship-to-customer or pickup delivery); pre-fills from the currently selected customer.

### Misc

- **`POSDiscountModal`** — percent/fixed toggle feeding `discountInput`/`discountType`.
- **`POSNoteModal`** — plain textarea feeding `orderNote`.
- **`POSApprovalModal`** — generic manager-PIN authorization for any action type — not POS-specific.
- **`POSNoSaleReasonModal`** — logs opening the cash drawer without a sale; reasons come from a configurable list.
- **`POSReceiptRetryModal`** — shown when hardware print fails; offers Print Again / Email (embeds `POSEmailReceiptModal`) / WhatsApp / a plain browser-print fallback / Skip, each logged for audit.
- **`POSEmailReceiptModal`** — emails a receipt; auto-closes shortly after success. Embedded by `POSRecentSalesPanel`, `POSReceiptModal`, and `POSReceiptRetryModal`.
- **`POSParkedModal`** — lists parked sales and draft orders merged by `loadParked`; Restore or Delete routes to the correct endpoint via each row's `_source` tag.
- **`POSRefundThresholdModal`** — generic manager-PIN prompt reused by `POSReturnExchangeModal` for refund-threshold approval; `POSCreditLimitModal` follows the same prop pattern for the separate credit-limit-override flow.

## Layout / display components

- **`POSHeader`** — outlet switcher (admin-only), last-receipt access, recent sales, return entry point, a customer-display popout (opens a second-screen view in a new tab/window keyed to the active shift), an admin-only "Stuck (N)" button opening `POSStuckQueueModal`, close-shift, help (F1), lock, logout.
- **`POSSubHeader`** — the "Sell" heading and today's date, the tax-inclusive toggle (hidden entirely when tax mode is "none"), a bulk-scan-mode toggle stored per device, the appointments entry button (feature-gated), park sale + parked-sales count badge, hold/pickup buttons (feature-gated).
- **`POSSidebar`** — customer search/attach dropdown (its search input carries a `data-pos-customer-search` attribute — the F4 focus target), discount/note quick buttons, the totals breakdown (subtotal, discount, promo, tax line, total), the Pay button.
- **`POSCartTable`** — per-line badges for bundles, special pricing, and price overrides; an inline decimal quantity input for weighted-unit lines with a "Weigh" button when the browser supports the Web Serial API, plus an optional tare field that's read-only when the line's tare was already netted by a deli-scale label; a per-line override-price menu (feature-gated). The Unit column is hidden on mobile.
- **`POSSearchArea`** — conditionally shows barcode/SKU/price search fields per the tenant's search config; a grid/list view toggle persisted in `localStorage`. Renders the omni-input above the classic fields when its feature flag is on, and the PLU pad when the preset enables it — both are additive; the classic fields stay active underneath either.
- **`POSOmniInput`** — a single smart search bar built on `classifyOmniInput`. Barcode/PLU input hits the product scan endpoint, decodes scale price/weight-embedded barcodes client-side for instant feedback before confirming server-side, and chains into the variant/serial modals as needed. `#`-prefixed input searches customers (auto-selecting on exactly one match). Plain text sets the general search field. Auto-focuses on mount and re-focuses periodically if nothing else has focus; the `/` key focuses it globally.
- **`POSPluPad`** — collapsed to a small button by default; expands into a touch numeric keypad for ringing loose items by a short numeric code, reusing the same scan endpoint as a physical barcode scan (so a typed code resolves identically, including scale-embedded decoding).
- **`POSRecentSalesPanel`** — today's sales with a search filter; Reprint re-fetches the sale and rebuilds a slip object; Email opens the email-receipt modal; Return calls into the return/exchange flow.
- **`POSShortcutsOverlay`** — renders the shortcut table below, substituting the preset's customer label into the F4 row.

## Keyboard shortcuts

| Key | Action |
|---|---|
| F1 | Toggle the shortcuts overlay |
| F2 | Apply discount (only if the cart is non-empty) |
| F3 | Park sale (only if the cart is non-empty) |
| F4 | Focus the customer search field |
| F5 | Open parked sales |
| F8 | Remove the last cart item |
| F9 | Open checkout |
| F10 | Clear the cart (confirms first) |
| Esc | Close the discount modal / parked sales / shortcuts overlay |
| `/` | Focus the omni-input (only when no input/textarea/select currently has focus; handled inside the omni-input component itself, not the global listener) |

F-keys fire even when focus is inside an input — they're checked before the plain-character barcode-buffer branch in the global keydown handler.

## Styling convention

The module uses the same design-system CSS variable tokens as the rest of the app's `redesign/` pages — nearly every top-level component and every cart/checkout/shift/product-entry modal is built on tokens (surface/border/text-muted/etc.), not hardcoded Tailwind color classes or hex values. New work in this directory should follow the same convention.

Known remaining hardcoded-color exceptions (don't use these as a template): `POSAppointmentsModal` (`bg-white`, `text-slate-*`, a hardcoded accent hex) and the appointments-button branch inside `POSSubHeader` (hardcoded hex/emerald/indigo Tailwind classes). If touching either, consider migrating to tokens rather than extending the hardcoded style further.

## `completeSale` payload (`POST /api/sales`)

```js
{
  outlet_id, employee_id, customer_id?,
  cartItems: [{ id, variant_id?, price, quantity, staff_id?, modifiers?, serials?, seat_number?, course_name? }],
  payments: [{ method, amount, code? }],   // code: gift-card redemption code
  discount_amount, discount_type,          // includes any auto-applied promo discount folded in when no manual discount is set
  notes,                                   // JSON-stringified { text, signature_svg } when a guest signature was captured
  points_earned, points_redeemed,
  idempotency_key,          // crypto.randomUUID(), backend dedupes on replay
  folio_id?, treatment_folio_id?,          // charge-to-folio — no payment collected when set
  tip_amount?, tip_method?, server_id?,    // restaurant tip capture; tip_method lowercased at the wire
  draft_order_id?, order_context?, table_session_id?, seat_count?,  // restaurant shell context
  tax_inclusive,            // backend resolves against company_profile.tax_mode and snapshots per-line tax
  manager_pin?,             // credit-limit override retry only; read once then cleared
  appointment_id?,          // backend completes the appointment on commit
  backorder_items?,         // accepted shortfall remainder from an insufficient-stock offer; requires a customer
}
```
