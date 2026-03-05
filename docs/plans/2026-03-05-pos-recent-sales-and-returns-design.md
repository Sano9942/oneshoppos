# POS Recent Sales Panel + Return/Exchange Flow
**Date:** 2026-03-05
**Status:** Approved

---

## Feature 1: Recent Sales Panel (Duplicate Bill / Reprint)

### Purpose
Allow cashiers to access and reprint today's past bills directly from the POS screen without navigating away.

### Entry Point
A **"Recent Sales"** button added to `POSHeader.jsx` (right side, beside existing controls).

### Behavior
- Opens a slide-in overlay panel (right side, over the cart area, z-50)
- Shows today's completed sales for the current outlet, ordered newest first
- Displays: Invoice #, customer name (or "Walk-in"), total, time
- Search bar filters by invoice number or customer name (client-side)
- Each row has two action buttons:
  - **Reprint** — reconstructs a slip object from sale data and calls `printSlip()`
  - **Return/Exchange** — closes panel and opens the Return/Exchange modal pre-loaded with that sale

### Data
- Reuses existing `GET /api/sales?date_from=today&outlet_id=X&limit=50`
- No new backend endpoint required
- Reprint reconstructs slip from sale data returned by `GET /api/sales/:id`

### New File
`frontend/src/pages/redesign/pos/POSRecentSalesPanel.jsx`

---

## Feature 2: Return / Exchange Flow from POS

### Entry Point
A standalone **"Return / Exchange"** button in `POSHeader.jsx`.
Also accessible via the "Return/Exchange" button on any Recent Sales panel row.

### Two Starting Paths

**Path A — With original bill:**
- Cashier enters or scans an invoice number
- System fetches sale via `GET /api/sales/:id` (matched by invoice number search)
- Items from that sale are pre-loaded for selection

**Path B — Without original bill:**
- Cashier manually searches and adds products (mini product search, same as POS)
- Enters quantities and optional reason
- No sale lookup needed

### Flow Steps

1. **Select return items** — tick items and adjust quantities. Reason field (optional).

2. **Choose mode:**
   - **Full Refund** — proceed directly to settlement
   - **Exchange** — opens mini product search to add replacement items. Running balance shown: *"Customer owes PKRs X"* or *"Refund PKRs X to customer"*

3. **Settle balance:**
   - *Refund owed* (return only, or exchange item cheaper): cashier chooses settlement method — Cash / Card / Wallet / Store Credit
   - *Customer owes more* (exchange item more expensive): cashier collects difference via Cash / Card / Wallet (same tender UI as checkout)
   - *Zero balance* (exact exchange): complete with no payment needed

4. **Complete transaction:**
   - Always: `POST /api/returns` — restores stock, records return with `original_sale_id` (or null for no-bill returns)
   - If exchange items: `POST /api/sales` — new sale for exchange items, with a synthetic "Return Credit" payment covering the refund amount
   - If store credit chosen: customer wallet updated (handled by the sales endpoint when payment_method = "Wallet")

### No new backend endpoints needed
- Uses existing `/api/returns` and `/api/sales`
- Exchange = return POST + new sale POST with return value applied as a payment tender

### New File
`frontend/src/pages/redesign/pos/POSReturnExchangeModal.jsx`

---

## Summary of Changes

| File | Change |
|---|---|
| `pos/POSHeader.jsx` | Add "Recent Sales" button + "Return/Exchange" button |
| `pos/POSContext.jsx` | Add state + handlers for recent sales panel and return/exchange modal |
| `pos/POSRecentSalesPanel.jsx` | New — recent sales slide-in panel |
| `pos/POSReturnExchangeModal.jsx` | New — full return/exchange flow modal |

**Backend: no changes required.**
