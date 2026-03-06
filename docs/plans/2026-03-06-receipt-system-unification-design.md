# Receipt System Unification Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

The POS receipt system has two disconnected renderers:
1. `printSlip()` in `POSContext.jsx` — the actual browser print popup, hardcoded HTML
2. `POSReceiptModal.jsx` — the on-screen receipt modal, JSX

Every new receipt feature (GST, exchange items, order note, payment method) must be manually added to both renderers AND the slip-building call site. The existing Receipt Templates system (`/api/receipt-templates`, `ReceiptTemplates.jsx`) is completely disconnected from `printSlip` — template `header_text`, `footer_text`, `show_barcode` are never used in actual printing.

## Approach: Shared `renderReceipt` Utility (Option A)

Single source of truth in `frontend/src/utils/receipt.js`. Both print popup and modal consume it. Template fetched once on POS mount.

## Architecture

```
frontend/src/utils/receipt.js          ← NEW: single source of truth
frontend/src/pages/redesign/pos/
  POSContext.jsx                        ← fetch template on mount, pass to printSlip
  POSReceiptModal.jsx                   ← use buildReceiptSections from receipt.js
```

## Files Changed

### `frontend/src/utils/receipt.js` (NEW)

Two exports:

**`buildReceiptSections(slip, template)`**
Returns a plain JS object with all receipt sections as data:
```js
{
  storeName,      // template.header_text || slip.outlet?.name || 'OneShopPOS'
  footerText,     // template.footer_text || 'Thank you for your purchase!'
  showBarcode,    // template.show_barcode
  timestamp,      // slip.timestamp
  invoiceNumber,  // slip.invoiceNumber
  returnedFrom,   // slip.returnedFrom (exchange receipts)
  employee,       // slip.employee
  customer,       // slip.customer
  returnedItems,  // slip.returnedItems (exchange receipts)
  cartItems,      // slip.cart
  subtotal,       // computed
  taxAmount,      // slip.taxAmount
  exchangeCredit, // slip.exchangeCredit
  discountAmount, // slip.discountAmount
  discountType,   // slip.discountType
  totalLabel,     // 'Balance Due' or 'Total'
  totalValue,     // computed from balanceDue or total
  payments,       // slip.payments filtered (no 'Return Credit' line)
  refundToCustomer, // slip.refundNote ? Math.abs(slip.balanceDue) : null
  change,         // slip.change
  orderNote,      // slip.orderNote
}
```

**`buildReceiptHtml(slip, template)`**
Calls `buildReceiptSections`, serializes to a full HTML document string using the same monospace/dashed-line print layout. Opens a popup window, writes the HTML, calls `window.print()`.

### `POSContext.jsx`

- Add `receiptTemplate` state (default: `null`)
- Fetch `/api/receipt-templates/active` on mount (alongside existing data loads)
- `printSlip(slip)` calls `buildReceiptHtml(slip, receiptTemplate)` instead of its current inline HTML generation — all current inline HTML code is deleted

### `POSReceiptModal.jsx`

- Import `buildReceiptSections` from `receipt.js`
- Compute `sections = buildReceiptSections(slip, receiptTemplate)` at top of render
- Use `sections.storeName` instead of hardcoded `slip.outlet?.name || 'OneShopPOS'`
- Use `sections.footerText` instead of hardcoded `'Thank you for your purchase!'`
- All conditional rendering logic (exchange, GST, note, barcode) stays in JSX but reads from `sections` values — no logic lives in the modal

## What Doesn't Change

- `POSReturnExchangeModal.jsx` — calls `printSlip(slip)` as-is, no changes
- `POSRecentSalesPanel.jsx` — calls `printSlip(slip)` as-is, no changes
- All backend files — no changes
- Receipt Templates CRUD page — no changes

## Slip Object Contract

All callers must pass the same slip shape. Current fields (all already implemented):

| Field | Source | Description |
|---|---|---|
| `invoiceNumber` | API response | Invoice # |
| `cart` | Cart state / API | `[{name, quantity, price}]` |
| `payments` | Payments state / API | `[{method, amount}]` |
| `total` | Computed | Total after discount |
| `change` | Computed | Change due |
| `customer` | State / API | `{name, mobile}` or null |
| `outlet` | State | `{name}` |
| `employee` | State / API | `{name}` |
| `discountAmount` | State / API | Numeric amount |
| `discountType` | State | `'fixed'` or `'percentage'` |
| `taxAmount` | Computed | GST inclusive amount (0 if no tax) |
| `orderNote` | State | Free text note or null |
| `timestamp` | `new Date().toLocaleString()` | Local time string |
| `returnedItems` | Exchange flow | `[{name, quantity, price}]` or undefined |
| `returnedFrom` | Exchange flow | Original invoice # or null |
| `exchangeCredit` | Exchange flow | Return credit value |
| `balanceDue` | Exchange flow | Net balance (can be negative) |
| `refundNote` | Exchange flow | Non-null when customer gets refund |

## Future Additions

Any new receipt field: add to slip object at the call site, add to `buildReceiptSections`, add rendering to `buildReceiptHtml`. The modal automatically picks it up via `sections`. Zero divergence possible.
