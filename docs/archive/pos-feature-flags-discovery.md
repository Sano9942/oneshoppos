# POS Feature Flags — Discovery & Gap Analysis

**Date:** April 13, 2026  
**Tenant used for testing:** `packagesmall`  
**User role:** Administrator  
**POS URL tested:** `sanopos.com/pos`

---

## Context

This document captures a full discovery session where we audited which feature flags affect POS behavior, what's actually rendering in the UI for a fully-enabled tenant, and where gaps exist between backend capability and frontend implementation.

The `packagesmall` tenant had **all Phase 2, Phase 4, and Phase 5 flags enabled** (as visible in the admin panel screenshots taken April 13, 2026). Despite this, the POS UI looked minimal — no layout tiles, no restaurant mode, no visible commission or approval indicators.

---

## Feature Flags Relevant to POS (Full List)

### Flags That Directly Affect POS UI or Behavior

| Flag | Default | What It Controls |
|------|---------|-----------------|
| `phase2_pos_layouts` | true | Custom tile/button layouts in the POS cart area |
| `phase2_draft_orders` | false | Changes Park Sale to use `/api/draft-orders` instead of `/api/parked-sales` |
| `phase2_pos_approvals` | false | Spending limits + manager-approval gates on POS transactions |
| `phase2_item_suggestions` | false | AI cross-sell/upsell suggestions in cart (debounced 500ms after item added) |
| `phase2_outlet_pricing` | false | Outlet-specific price overrides fetched at POS startup |
| `phase2_outlet_tax` | true | Per-outlet tax profiles |
| `phase2_commissions` | false | Salesperson commission tracking on each sale |
| `phase2_returns_policy` | true | Structured return reasons and item restoration workflows |
| `phase2_smart_collections` | true | Auto-grouped product collections (affects product search filtering) |
| `phase4_restaurant` | true | Full restaurant module — floor plans, tables, checks, tabs |
| `phase4_restaurant_kds` | true | Kitchen Display System — ticket management for kitchen staff |
| `phase4_restaurant_preauth` | false | Pre-authorization for restaurant payment processing |
| `phase4_restaurant_qr` | false | QR-based ordering (orders flow into POS queue) |
| `phase2_draft_orders` | false | Draft order parking (changes park behavior) |

---

## How Feature Flags Work (Architecture)

### Backend Layer

- All flagged routes use `requireFeature("flag_name")` middleware at the top of the route file
- If the flag is disabled, the endpoint returns **503 Service Unavailable**
- Flags are stored in the `feature_flags` table per tenant schema
- Cached for **60 seconds** per tenant — flag toggles take effect within 1 minute, no restart needed

### Frontend Layer

- `POSContext.jsx` fetches `GET /api/feature-flags` on mount and stores result in `posFlags` state
- Individual features are supposed to check `posFlags.flag_name` before making API calls
- UI rendering is then conditionally shown based on the returned data

### The Two-Layer Pattern

```
User enables flag in admin panel
        ↓
Backend: requireFeature() allows the API call
        ↓
Frontend: posFlags.flag_name check should guard the fetch
        ↓
UI: conditionally renders based on returned data
```

**Problem:** The frontend does not always implement the second layer check.

---

## What's Actually Showing in the POS (packagesmall, All Flags ON)

### Top Navigation Bar
- POS logo, employee name ("hassan"), outlet dropdown ("Packages Mall")
- Links: Dashboard, Last Receipt, Recent Sales, Return, Close Shift, Help, Lock, Logout

### Main Area
- "Sell" heading with date, Tax Inclusive toggle
- Three search bars: Search by Barcode, Search by SKU, Search by Price
- Full-width search: "Search by Name, Barcode, SKU... (F2)"
- "Products List" section — shows empty cart state

### Right Panel (Cart)
- Customer search field
- "Walk-in Customer" default
- Add Discount, Add Note buttons
- Subtotal, Total, Pay button

### What's MISSING Despite Flags Being ON
- No POS layout tiles/buttons
- No restaurant mode (table picker, floor plan)
- No item suggestions area
- No commission indicator
- No approval gate UI
- No KDS integration visible

---

## Root Cause Analysis — Per Feature

### 1. POS Layout Tiles (`phase2_pos_layouts`)

**Where the fetch lives:** `POSContext.jsx` ~line 487–492

```javascript
useEffect(() => {
  const params = new URLSearchParams();
  if (selectedOutletId) params.set("outlet_id", selectedOutletId);
  api.get(`/api/pos-layouts?${params}`).then(d => setPosLayout(d.layout)).catch(() => {});
}, [selectedOutletId]);
```

**Where it renders:** `POSRedesign.jsx` ~lines 85–98

```javascript
{posLayout?.layout_json?.length > 0 && (
  <div className="grid grid-cols-4 gap-2 mb-3">
    {posLayout.layout_json.map((tile, i) => (
      <button ... onClick={() => addToCart({...})}>
        {tile.label || tile.type}
      </button>
    ))}
  </div>
)}
```

**Why it's not showing:**

The flag is ON and the API call happens, but the UI only renders if `posLayout?.layout_json?.length > 0`. **No layout tiles have been configured** for the `packagesmall` outlet. Layout data must be created via Settings → POS Layouts before any tiles appear.

**Action required:** Go to `/settings/pos-layouts` and create tile configurations for the outlet.

---

### 2. Item Suggestions (`phase2_item_suggestions`)

**Where the fetch lives:** `POSContext.jsx` ~lines 494–503

```javascript
useEffect(() => {
  if (!cart.length) { setSuggestions([]); return; }
  const timer = setTimeout(() => {
    const ids = cart.map(c => c.id).filter(Boolean).join(",");
    api.get(`/api/pos/suggestions?product_ids=${ids}`)
      .then(d => setSuggestions(d.suggestions || []))
      .catch(() => {});
  }, 500);
  return () => clearTimeout(timer);
}, [cart.map(c => c.id).join(",")]);
```

**Where it renders:** `POSRedesign.jsx` ~lines 101–112

```javascript
{suggestions.length > 0 && (
  <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
    {suggestions.slice(0, 4).map(s => (...))}
  </div>
)}
```

**Why it's not showing:**

This is **working as designed**. Suggestions only trigger when there are items in the cart (debounced 500ms). The cart was empty during testing — add a product and suggestions will appear if the algorithm finds related products.

**Status:** No bug. Expected behavior.

---

### 3. Draft Orders / Park Sale (`phase2_draft_orders`)

**Where the logic lives:** `POSContext.jsx` ~lines 658–673

```javascript
if (posFlags.phase2_draft_orders) {
  await api.post("/api/draft-orders", {
    outlet_id: Number(selectedOutletId),
    customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
    notes: orderNote || null,
    items: itemPayload,
  });
} else {
  await api.post("/api/parked-sales", {
    outlet_id: Number(selectedOutletId),
    customer_id: selectedCustomerId ? Number(selectedCustomerId) : null,
    notes: orderNote || null,
    items: itemPayload,
  });
}
```

**Status:** Properly implemented. When `phase2_draft_orders` is ON, the "Park Sale" button routes to `/api/draft-orders` which supports claiming, approval workflows, and synced state. The `parked` button in the top right now recalls from the draft-orders API instead of legacy parked-sales.

**Behavioral change for packagesmall:** Since this flag is ON, parked sales now use draft-orders — if any legacy parked sales existed before the flag was enabled, they won't appear in the new recalled list.

---

### 4. Restaurant Mode (`phase4_restaurant`, `phase4_restaurant_kds`, `phase4_restaurant_qr`)

**Backend status:** Fully implemented.
- Routes in `backend/routes/restaurant.js`: floor plans, tables, sessions, checks, tabs, split checks
- Routes in `backend/routes/kds.js`: KDS stations, tickets, bump, recall
- All gated: `requireFeature("phase4_restaurant") + requirePerm("manage_restaurant")`

**Frontend status:** **NOT IMPLEMENTED.**

There is zero restaurant UI in `POSRedesign.jsx` or `POSContext.jsx`. No:
- Table selection screen
- Floor plan view
- Check/tab management panel
- KDS order routing toggle
- Course management

**This is a known gap.** The backend was built in Phase 4 but the POS frontend was not updated to include the restaurant workflow.

**Action required (future work):** Build restaurant mode UI in the POS — table picker on sale start, floor plan overlay, check assignment, KDS ticket routing.

---

### 5. POS Approvals (`phase2_pos_approvals`)

**Backend status:** Implemented.
- `POST /api/approvals/pos-authorize` — evaluates if a transaction needs approval
- `POST /api/approvals/evaluate` — checks spending limits
- `GET/POST/PUT/DELETE /api/approval-policies` — configure thresholds

**Frontend status:** Partially implemented — the approval modal exists but approval policies must be **configured first**. If no policies are set, the approval flow never triggers.

**Action required:** Set up approval policies at `/settings/approvals` to define spending limits and which roles need to authorize.

---

### 6. Commissions (`phase2_commissions`)

**Backend status:** Tracks commissions on each sale when enabled.

**Frontend status:** No visible indicator in the POS. Commission data is recorded server-side on sale completion, but there's no UI in the POS showing the cashier their commission rate or current total.

**Action required (future work):** Add a commission indicator in the POS header or cart summary (e.g., "Your commission on this sale: Rs X.XX").

---

### 7. Outlet Pricing (`phase2_outlet_pricing`)

**Where the fetch lives:** `POSContext.jsx` — fetches `outletPriceListItems` on outlet selection.

**Status:** Flag is ON and the fetch runs. If price list assignments exist for the outlet, they override the standard product price in the cart. If no assignments are configured, no visible change occurs.

**Action required:** Configure price lists and assign them to outlets at `/settings/price-lists`.

---

## The "Products List is Empty" Non-Issue

The section labeled "Products List" in the POS is the **shopping cart**, not a product catalog browser. It correctly shows:

```
[Shopping cart icon]
Cart is empty
Search items above to start a new sale.
```

This is the empty state of `POSCartTable.jsx`. To add products, use the search bars at the top. There is no "browse all products" view in the POS by design — products are found via search or layout tiles.

---

## Summary: What Needs Action

### Immediate (Data Configuration — No Code Needed)

| Item | Where to Configure |
|------|--------------------|
| POS Layout tiles not showing | Create layouts at `/settings/pos-layouts` for the outlet |
| Approval gates not triggering | Configure policies at `/settings/approvals` |
| Outlet pricing not overriding | Assign price lists at `/settings/price-lists` |

### Future Development (Code Required)

| Feature | Effort | Description |
|---------|--------|-------------|
| Restaurant mode POS UI | Large | Table picker, floor plan overlay, check management, KDS routing in POS |
| Commission indicator in POS | Small | Show cashier their commission rate/total in cart or header |
| KDS integration in POS | Medium | Route items to KDS stations at order placement, show KDS status |
| QR ordering flow | Medium | QR scan → storefront cart → appears in POS queue |

### Known Frontend Gaps (Silent Failures)

Both `phase2_pos_layouts` and `phase2_item_suggestions` fetch data without checking `posFlags` first. The backend rejects the call (503) if the flag is off, and the `.catch(() => {})` swallows the error silently. This is acceptable when flags are ON (data just isn't configured yet) but means no useful error appears when flags are OFF.

---

## Files Referenced

| File | Role |
|------|------|
| `frontend/src/pages/redesign/pos/POSContext.jsx` | All POS state, flag fetching, feature-gated API calls |
| `frontend/src/pages/redesign/POSRedesign.jsx` | POS page layout, conditional feature rendering |
| `backend/middleware/feature-flags.js` | `requireFeature()` middleware, 60s cache |
| `backend/routes/pos-layouts.js` | POS tile layout CRUD, gated by `phase2_pos_layouts` |
| `backend/routes/item-suggestions.js` | Cross-sell suggestions, gated by `phase2_item_suggestions` |
| `backend/routes/draft-orders.js` | Draft order parking, gated by `phase2_draft_orders` |
| `backend/routes/restaurant.js` | Full restaurant backend — no frontend POS integration yet |
| `backend/routes/kds.js` | KDS backend — no frontend POS integration yet |
| `backend/routes/approval-policies.js` | POS approval thresholds — frontend modal exists but needs policy data |
