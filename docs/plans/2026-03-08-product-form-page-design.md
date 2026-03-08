# Product Form Page — Design Doc

**Date:** 2026-03-08
**Status:** Approved
**Scope:** Full-page product add/edit form with variant management UI

---

## Problem

The current `ProductModal` in `InventoryRedesign.jsx` is a `max-w-lg` overlay that cramped all product fields into a small scroll area. It:
- Has no room for a variant grid (wide table by nature)
- Missing `compare_at_price` and `description` fields present in the backend schema
- Cannot scale to show per-outlet stock nicely in edit mode

---

## Solution

Replace the modal with a full-page route using a two-column Shopify-style layout. Add variant management UI backed by the already-complete backend variant infrastructure.

---

## Routes

| Route | Component | Mode |
|---|---|---|
| `/products/new` | `ProductFormPage` | Add |
| `/products/:id` | `ProductFormPage` | Edit |

Added to `App.jsx` inside the `RequireAuth` + `RequireContext` guard block, alongside `/inventory`.

Navigation:
- "Add Product" button in `InventoryRedesign` → `navigate("/products/new")`
- Product row click in `InventoryRedesign` → `navigate("/products/${p.id}")`
- Save / Cancel in `ProductFormPage` → `navigate("/inventory")`

The `ProductModal` component and `modalProduct` state are removed from `InventoryRedesign.jsx`.

---

## Page Layout

Two-column layout (left 2/3 main, right 1/3 sidebar):

```
┌─────────────────────────────────────────────────────┐
│  ← Products                  [Draft] [Save Product] │
├──────────────────────────────┬──────────────────────┤
│  MAIN (left 2/3)             │  SIDEBAR (right 1/3) │
│                              │                      │
│  Basic Info card             │  Status card         │
│    name (required)           │    active/draft/inact│
│    description (textarea)    │                      │
│                              │  Organization card   │
│  Media card                  │    category          │
│    image upload/preview      │    brand             │
│                              │    product_type      │
│  Pricing card                │    vendor            │
│    selling price (required)  │    tags              │
│    cost price                │                      │
│    compare_at_price          │  Identifiers card    │
│    GST %                     │    barcode           │
│                              │    SKU               │
│  Inventory card              │    unit              │
│    (simple) opening stock    │                      │
│    (edit) stock by outlet    │                      │
│                              │                      │
│  Variants card               │                      │
│    "Has variants" toggle     │                      │
│    attribute set selector    │                      │
│    variant grid              │                      │
└──────────────────────────────┴──────────────────────┘
```

---

## Variant Flow

### Add mode (has_variants = true)

1. User toggles "This product has variants"
2. Attribute set dropdown appears (from `GET /api/attribute-sets`)
3. On attribute set selection: auto-generate variant rows from cartesian product of all attribute options
   - e.g. Size [S, M] × Color [Red, Blue] → 4 rows: S/Red, S/Blue, M/Red, M/Blue
4. Variant grid columns: **Combination** (read-only label) | **Price** | **Cost** | **Stock** | **SKU** | **Barcode**
5. Price + Cost pre-fill from the product-level Pricing card values
6. On save: `POST /api/products` with:
   ```json
   {
     "has_variants": true,
     "attribute_set_id": 3,
     "variants": [
       {
         "sku": "BTS-S-RED",
         "barcode": null,
         "price": 29.99,
         "cost_price": 15.00,
         "initial_stock": 10,
         "options": [
           { "attribute_id": 1, "attribute_option_id": 3 },
           { "attribute_id": 2, "attribute_option_id": 7 }
         ]
       }
     ]
   }
   ```

### Edit mode (has_variants = true)

- Variants fetched from `GET /api/products/:id/variants` on mount
- Existing variants are editable: price, cost, stock, SKU, barcode
- Variant combination label is read-only (options are fixed after creation)
- Adding new variants not supported in edit mode (backend `PUT` only updates existing by `id`)
- `has_variants` toggle and attribute set selector are locked (read-only) in edit mode

### Edit mode (has_variants = false)

- Opening Stock field replaced by read-only "Stock by Location" panel (from `GET /api/products/:id/stock`)
- Adjustments via the Inventory Adjustments page (existing flow)

---

## Cartesian Product Logic

Client-side utility function (pure, no side effects):

```js
function cartesian(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}
```

Input: `attributeSet.attributes` (array of `{ id, name, options: [{id, value}] }`)
Output: array of combinations, each combination is array of `{ attribute_id, attribute_option_id, attribute_name, option_value }`

---

## State Shape

```js
const BLANK_FORM = {
  name: "", description: "", image_url: "",
  price: "", cost_price: "", compare_at_price: "", gst: "",
  stock: "",
  category_id: "", brand_id: "", product_type: "", vendor: "", tags: "",
  barcode: "", sku: "", unit: "pcs",
  status: "active",
  has_variants: false,
  attribute_set_id: "",
};

// Variant rows (separate state, not inside form)
// [{ _key, label, price, cost_price, stock, sku, barcode, options[] }]
```

`_key` is a stable client-side key (combo string like `"S|Red"`) used for React list rendering. Not sent to backend.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/App.jsx` | Add `/products/new` and `/products/:id` routes |
| `frontend/src/pages/redesign/InventoryRedesign.jsx` | Remove `ProductModal`, replace modal trigger with `navigate()` |
| `frontend/src/pages/redesign/ProductFormPage.jsx` | **New file** — full-page form |

No backend changes required. All endpoints already exist:
- `POST /api/products` — create with optional variants
- `PUT /api/products/:id` — update (variants by id)
- `GET /api/products/:id/variants` — fetch existing variants
- `GET /api/products/:id/stock` — outlet stock for edit mode
- `GET /api/attribute-sets` — attribute sets with nested attributes+options
- `GET /api/categories`, `GET /api/brands` — selectors

---

## Out of Scope

- Per-variant images
- Rich text (HTML) description editor
- Adding new variants in edit mode
- Min/max qty fields (present in CSV import but low priority for UI)
