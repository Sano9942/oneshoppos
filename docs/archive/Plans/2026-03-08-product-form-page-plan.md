# Product Form Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the compact ProductModal in InventoryRedesign with a full-page route (`/products/new`, `/products/:id`) featuring a two-column Shopify-style layout and a variant management UI backed by the existing backend variant infrastructure.

**Architecture:** New `ProductFormPage.jsx` component handles both add/edit modes via `useParams`. `InventoryRedesign.jsx` drops the modal and wires "Add Product" + row clicks to `useNavigate`. `App.jsx` gets two new routes under the existing `manage_inventory` permission guard.

**Tech Stack:** React 19, React Router v6 (`useNavigate`, `useParams`), Tailwind CSS v4, existing `primitives.jsx` design system, existing backend APIs (no backend changes needed).

---

## Task 1: Add routes to App.jsx

**Files:**
- Modify: `frontend/src/App.jsx:1-35` (imports) and `frontend/src/App.jsx:170-177` (inventory route block)

**Step 1: Add the import for ProductFormPage**

At the top of `App.jsx`, alongside the other direct imports (not lazy), add:

```js
import ProductFormPage from "./pages/redesign/ProductFormPage";
```

**Step 2: Add the two routes**

Find the `/inventory` route block (around line 170-177):
```jsx
<Route
  path="/inventory"
  element={
    <RequirePerm perm="manage_inventory">
      <InventoryRoute />
    </RequirePerm>
  }
/>
```

Add immediately after it:
```jsx
<Route
  path="/products/new"
  element={
    <RequirePerm perm="manage_inventory">
      <ProductFormPage />
    </RequirePerm>
  }
/>
<Route
  path="/products/:id"
  element={
    <RequirePerm perm="manage_inventory">
      <ProductFormPage />
    </RequirePerm>
  }
/>
```

**Step 3: Verify dev server still starts (no import errors)**

Run: `cd frontend && npm run dev`
Expected: Vite starts without errors (ProductFormPage doesn't exist yet — React Router won't crash on import failure at route level, but the import at the top will fail). So create a stub file first.

**Step 4: Create stub ProductFormPage.jsx**

Create `frontend/src/pages/redesign/ProductFormPage.jsx`:
```jsx
export default function ProductFormPage() {
  return <div className="p-8 text-xl">Product Form (coming soon)</div>;
}
```

**Step 5: Verify `/products/new` renders the stub**

Open browser → navigate to `http://localhost:5173/products/new`
Expected: "Product Form (coming soon)" visible inside the app layout.

**Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/redesign/ProductFormPage.jsx
git commit -m "feat: add /products/new and /products/:id routes (stub)"
```

---

## Task 2: Wire InventoryRedesign to navigate instead of modal

**Files:**
- Modify: `frontend/src/pages/redesign/InventoryRedesign.jsx`

**Step 1: Add useNavigate import**

At line 1, change:
```js
import { useEffect, useMemo, useRef, useState } from "react";
```
to:
```js
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
```

**Step 2: Add navigate hook inside InventoryRedesign()**

Inside the `InventoryRedesign` function body, after `const { authHeaders, hasPerm } = useAuth();`, add:
```js
const navigate = useNavigate();
```

**Step 3: Remove modal state**

Remove this line (around line 313):
```js
const [modalProduct, setModalProduct] = useState(undefined);
```

**Step 4: Replace "Add Product" button handler**

Find (around line 512):
```jsx
<Button tone="primary" onClick={() => setModalProduct(null)}>
```
Replace with:
```jsx
<Button tone="primary" onClick={() => navigate("/products/new")}>
```

**Step 5: Replace row click handler**

Find (around line 725):
```jsx
onClick={() => setModalProduct(p)}
```
Replace with:
```jsx
onClick={() => navigate(`/products/${p.id}`)}
```

**Step 6: Remove ProductModal usage at bottom**

Find and remove this block (around lines 801-809):
```jsx
{modalProduct !== undefined && (
  <ProductModal
    product={modalProduct}
    categories={categories}
    brands={brands}
    authHeaders={authHeaders}
    onClose={() => setModalProduct(undefined)}
    onSaved={() => { setModalProduct(undefined); fetchProducts(); }}
  />
)}
```

**Step 7: Remove ProductModal component**

Remove the entire `function ProductModal(...)` component — lines 26–243.

**Step 8: Remove unused imports**

The `X` icon from lucide-react is only used in ProductModal. Remove it from the import line:
```js
import { Download, Plus, Search, Trash2, Upload } from "lucide-react";
```
(Remove `X`)

**Step 9: Verify inventory page still loads**

Open `http://localhost:5173/inventory`
Expected: Table renders, "Add Product" navigates to `/products/new`, row click navigates to `/products/123`.

**Step 10: Commit**

```bash
git add frontend/src/pages/redesign/InventoryRedesign.jsx
git commit -m "feat: replace ProductModal with navigate() in InventoryRedesign"
```

---

## Task 3: Build ProductFormPage — scaffolding and data loading

**Files:**
- Modify: `frontend/src/pages/redesign/ProductFormPage.jsx`

**Step 1: Write the full file with data loading only (no form UI yet)**

Replace the stub with:

```jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE as API } from "../../config";
import { Button, PageShell } from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import { sortCategories } from "../../utils/categoryTree";

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

export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { authHeaders } = useAuth();

  const [form, setForm] = useState({ ...BLANK_FORM });
  const [variants, setVariants] = useState([]); // [{_key, label, price, cost_price, stock, sku, barcode, options[]}]
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [attributeSets, setAttributeSets] = useState([]);
  const [outletStock, setOutletStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageUploading, setImageUploading] = useState(false);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const h = authHeaders();
    const base = [
      fetch(`${API}/api/categories`, { headers: h }).then(r => r.json()),
      fetch(`${API}/api/brands`, { headers: h }).then(r => r.json()),
      fetch(`${API}/api/attribute-sets`, { headers: h }).then(r => r.json()),
    ];
    const all = isEdit
      ? [...base,
          fetch(`${API}/api/products/${id}`, { headers: h }).then(r => r.json()),
          fetch(`${API}/api/products/${id}/variants`, { headers: h }).then(r => r.json()),
          fetch(`${API}/api/products/${id}/stock`, { headers: h }).then(r => r.json()),
        ]
      : base;

    Promise.all(all).then(([catD, brandD, attrD, ...editParts]) => {
      setCategories(sortCategories(catD.categories || []));
      setBrands(brandD.brands || []);
      setAttributeSets(attrD.attributeSets || []);
      if (isEdit) {
        const [prodD, varD, stockD] = editParts;
        const p = prodD.product || prodD;
        if (p?.id) {
          setForm({
            name: p.name || "",
            description: p.description || p.description_html || "",
            image_url: p.image_url || "",
            price: p.price ?? "",
            cost_price: p.cost_price ?? "",
            compare_at_price: p.compare_at_price ?? "",
            gst: p.gst ?? "",
            stock: p.total_stock ?? "",
            category_id: p.category_id || "",
            brand_id: p.brand_id || "",
            product_type: p.product_type || "",
            vendor: p.vendor || "",
            tags: p.tags || "",
            barcode: p.barcode || "",
            sku: p.sku || "",
            unit: p.unit || "pcs",
            status: p.status || "active",
            has_variants: Boolean(p.has_variants),
            attribute_set_id: p.attribute_set_id || "",
          });
        }
        if (varD?.variants?.length) {
          setVariants(varD.variants.map(v => ({
            id: v.id,
            _key: v.options?.map(o => o.option_value).join("|") || String(v.id),
            label: v.options?.map(o => o.option_value).join(" / ") || `Variant ${v.id}`,
            price: v.price ?? "",
            cost_price: v.cost_price ?? "",
            stock: v.stock ?? 0,
            sku: v.sku || "",
            barcode: v.barcode || "",
            options: v.options || [],
          })));
        }
        setOutletStock(stockD?.stock || []);
      }
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <PageShell title={isEdit ? "Edit Product" : "Add Product"}>
        <div className="p-8 text-(--ui-text-muted)">Loading…</div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={isEdit ? "Edit Product" : "Add Product"}
      subtitle={
        <button
          onClick={() => navigate("/inventory")}
          className="text-sm text-(--ui-text-muted) hover:text-(--ui-text) flex items-center gap-1"
        >
          ← Products
        </button>
      }
      actions={
        <div className="flex gap-2">
          <Button onClick={() => navigate("/inventory")} disabled={saving}>Cancel</Button>
          <Button tone="primary" onClick={() => {}} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Product"}
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      <div className="p-6 text-(--ui-text-muted) text-sm">
        Form sections coming in next tasks. Loaded {categories.length} categories, {brands.length} brands, {attributeSets.length} attribute sets.
        {isEdit && ` Edit mode — ${variants.length} variants, ${outletStock.length} outlet stock rows.`}
      </div>
    </PageShell>
  );
}
```

**Step 2: Check GET /api/products/:id endpoint exists**

```bash
grep -n "app.get.*products/:id" backend/routes/products.js | head -5
```
Expected: at least one match (the single-product endpoint). If the endpoint only returns products in list form, note what shape `prodD` will be — check actual field names returned.

**Step 3: Verify loading states work**

- Navigate to `/products/new` → should show "Add Product" page with "Form sections coming" text and correct counts
- Navigate to `/products/1` (or any real product id) → should show "Edit Product" with counts

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/ProductFormPage.jsx
git commit -m "feat: ProductFormPage scaffolding + data loading"
```

---

## Task 4: Build the form sections (Basic Info, Media, Pricing, Inventory)

**Files:**
- Modify: `frontend/src/pages/redesign/ProductFormPage.jsx`

**Step 1: Add missing imports at the top**

Add to the import block:
```js
import { indentLabel } from "../../utils/categoryTree";
import { Input, Select, SectionCard } from "../../ui/primitives";
import { X } from "lucide-react";
```

**Step 2: Add the handleImageUpload function**

Inside `ProductFormPage`, after `const upd = ...`, add:
```js
const handleImageUpload = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  setImageUploading(true);
  try {
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch(`${API}/api/uploads/product-image`, {
      method: "POST",
      headers: authHeaders(),
      body: fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    upd("image_url", data.url);
  } catch (err) {
    setError("Image upload failed: " + err.message);
  } finally {
    setImageUploading(false);
  }
};
```

**Step 3: Replace the placeholder div with two-column layout**

Replace the `<div className="p-6 text-...">Form sections coming...</div>` with:

```jsx
<div className="p-6 grid grid-cols-3 gap-6 items-start">
  {/* LEFT MAIN (2/3) */}
  <div className="col-span-2 flex flex-col gap-6">

    {/* Basic Info */}
    <SectionCard title="Basic Info">
      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Product Name *</label>
          <Input value={form.name} onChange={(e) => upd("name", e.target.value)} placeholder="e.g. Blue T-Shirt" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => upd("description", e.target.value)}
            rows={4}
            placeholder="Optional product description"
            className="w-full rounded-lg border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-primary)/30"
          />
        </div>
      </div>
    </SectionCard>

    {/* Media */}
    <SectionCard title="Media">
      <div className="p-4 space-y-3">
        {form.image_url && (
          <div className="relative w-32 h-32">
            <img src={form.image_url} alt="Product" className="w-32 h-32 rounded-lg object-cover border border-(--ui-border)" />
            <button type="button" onClick={() => upd("image_url", "")}
              className="absolute -top-1.5 -right-1.5 rounded-full bg-rose-500 text-white p-0.5 hover:bg-rose-600">
              <X size={14} />
            </button>
          </div>
        )}
        <label className={`flex items-center gap-2 cursor-pointer rounded-lg border border-dashed border-(--ui-border) px-4 py-3 text-sm text-(--ui-text-muted) hover:border-(--ui-text-muted) transition-colors w-fit ${imageUploading ? "opacity-50 pointer-events-none" : ""}`}>
          <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={imageUploading} />
          {imageUploading ? "Uploading…" : form.image_url ? "Replace image" : "Upload image"}
        </label>
      </div>
    </SectionCard>

    {/* Pricing */}
    <SectionCard title="Pricing">
      <div className="p-4 grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Selling Price *</label>
          <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => upd("price", e.target.value)} placeholder="0.00" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Cost Price</label>
          <Input type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => upd("cost_price", e.target.value)} placeholder="0.00" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Compare-at Price</label>
          <Input type="number" min="0" step="0.01" value={form.compare_at_price} onChange={(e) => upd("compare_at_price", e.target.value)} placeholder="0.00" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">GST %</label>
          <Input type="number" min="0" step="0.01" value={form.gst} onChange={(e) => upd("gst", e.target.value)} placeholder="0" />
        </div>
      </div>
    </SectionCard>

    {/* Inventory (simple product only — variants handled in Task 5) */}
    {!form.has_variants && (
      <SectionCard title="Inventory">
        <div className="p-4">
          {!isEdit ? (
            <div className="flex flex-col gap-1 max-w-xs">
              <label className="text-xs font-medium text-(--ui-text-muted)">Opening Stock</label>
              <Input type="number" min="0" value={form.stock} onChange={(e) => upd("stock", e.target.value)} placeholder="0" />
            </div>
          ) : (
            outletStock.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">Stock by Location</p>
                {outletStock.map((os) => (
                  <div key={os.outlet_id} className="flex items-center justify-between text-sm py-1 border-b border-(--ui-border) last:border-0">
                    <span className="text-(--ui-text)">{os.outlet_name}</span>
                    <span className="font-semibold text-(--ui-text)">{os.quantity} {form.unit || "pcs"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">No stock data. Use Inventory Adjustments to set stock.</p>
            )
          )}
        </div>
      </SectionCard>
    )}

  </div>

  {/* RIGHT SIDEBAR (1/3) */}
  <div className="flex flex-col gap-6">

    {/* Status */}
    <SectionCard title="Status">
      <div className="p-4">
        <Select value={form.status} onChange={(e) => upd("status", e.target.value)}>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="inactive">Inactive</option>
        </Select>
      </div>
    </SectionCard>

    {/* Organization */}
    <SectionCard title="Organization">
      <div className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Category</label>
          <Select value={form.category_id} onChange={(e) => upd("category_id", e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.is_leaf}>
                {indentLabel(c)}{c.is_leaf ? "" : " (parent)"}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Brand</label>
          <Select value={form.brand_id} onChange={(e) => upd("brand_id", e.target.value)}>
            <option value="">No brand</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Product Type</label>
          <Input value={form.product_type} onChange={(e) => upd("product_type", e.target.value)} placeholder="e.g. STEM Robotics Kit" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Vendor</label>
          <Input value={form.vendor} onChange={(e) => upd("vendor", e.target.value)} placeholder="e.g. LEGO" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Tags</label>
          <Input value={form.tags} onChange={(e) => upd("tags", e.target.value)} placeholder="Comma-separated, e.g. Age 5+,STEM" />
        </div>
      </div>
    </SectionCard>

    {/* Identifiers */}
    <SectionCard title="Identifiers">
      <div className="p-4 space-y-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Barcode</label>
          <Input value={form.barcode} onChange={(e) => upd("barcode", e.target.value)} placeholder="Scan or type" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">SKU</label>
          <Input value={form.sku} onChange={(e) => upd("sku", e.target.value)} placeholder="e.g. BTS-001" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-(--ui-text-muted)">Unit</label>
          <Input value={form.unit} onChange={(e) => upd("unit", e.target.value)} placeholder="pcs" />
        </div>
      </div>
    </SectionCard>

  </div>
</div>
```

**Step 4: Check SectionCard accepts a title prop**

```bash
grep -n "SectionCard" frontend/src/ui/primitives.jsx | head -10
```
If `SectionCard` doesn't accept a `title` prop and renders it, adapt accordingly — use a `<div>` with a heading inside instead, or check the actual API.

**Step 5: Verify form renders in browser**

Navigate to `/products/new` and `/products/:id` — confirm all sections visible, inputs editable.

**Step 6: Commit**

```bash
git add frontend/src/pages/redesign/ProductFormPage.jsx
git commit -m "feat: ProductFormPage - Basic Info, Media, Pricing, Inventory, Sidebar sections"
```

---

## Task 5: Build Variants card with cartesian product generation

**Files:**
- Modify: `frontend/src/pages/redesign/ProductFormPage.jsx`

**Step 1: Add the cartesian product utility inside the file**

Add this pure function just above the `BLANK_FORM` constant:

```js
function cartesian(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

function buildVariantRows(attributeSet, basePrice, baseCost) {
  if (!attributeSet?.attributes?.length) return [];
  const attrArrays = attributeSet.attributes.map((attr) =>
    attr.options.map((opt) => ({
      attribute_id: attr.id,
      attribute_name: attr.name,
      attribute_option_id: opt.id,
      option_value: opt.value,
    }))
  );
  return cartesian(attrArrays).map((combo) => ({
    _key: combo.map((c) => c.option_value).join("|"),
    label: combo.map((c) => c.option_value).join(" / "),
    price: basePrice,
    cost_price: baseCost,
    stock: 0,
    sku: "",
    barcode: "",
    options: combo,
  }));
}
```

**Step 2: Add variant update helper inside ProductFormPage**

After `const upd = ...`:
```js
const updVariant = (key, field, value) =>
  setVariants((prev) => prev.map((v) => v._key === key ? { ...v, [field]: value } : v));
```

**Step 3: Add the Variants card to the MAIN column**

After the Inventory `SectionCard` closing tag (still inside `{/* LEFT MAIN */}`), add:

```jsx
{/* Variants */}
<SectionCard title="Variants">
  <div className="p-4 space-y-4">
    {/* Toggle — locked in edit mode if already has variants */}
    <label className={`flex items-center gap-3 cursor-pointer ${isEdit ? "opacity-60 pointer-events-none" : ""}`}>
      <div
        onClick={() => {
          if (isEdit) return;
          const next = !form.has_variants;
          upd("has_variants", next);
          if (!next) {
            upd("attribute_set_id", "");
            setVariants([]);
          }
        }}
        className={`w-10 h-6 rounded-full transition-colors ${form.has_variants ? "bg-(--ui-primary)" : "bg-slate-200"} flex items-center px-0.5`}
      >
        <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${form.has_variants ? "translate-x-4" : ""}`} />
      </div>
      <span className="text-sm font-medium text-(--ui-text)">This product has variants</span>
    </label>

    {form.has_variants && (
      <>
        {/* Attribute Set Selector — locked in edit mode */}
        <div className="flex flex-col gap-1 max-w-xs">
          <label className="text-xs font-medium text-(--ui-text-muted)">Attribute Set</label>
          <Select
            value={form.attribute_set_id}
            disabled={isEdit}
            onChange={(e) => {
              const setId = e.target.value;
              upd("attribute_set_id", setId);
              if (!setId) { setVariants([]); return; }
              const attrSet = attributeSets.find((s) => String(s.id) === String(setId));
              setVariants(buildVariantRows(attrSet, form.price, form.cost_price));
            }}
          >
            <option value="">Select attribute set…</option>
            {attributeSets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </div>

        {/* Variant Grid */}
        {variants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase text-(--ui-text-muted) border-b border-(--ui-border)">
                  <th className="pb-2 text-left pr-3">Combination</th>
                  <th className="pb-2 text-right pr-3">Price</th>
                  <th className="pb-2 text-right pr-3">Cost</th>
                  <th className="pb-2 text-right pr-3">Stock</th>
                  <th className="pb-2 text-left pr-3">SKU</th>
                  <th className="pb-2 text-left">Barcode</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr key={v._key} className="border-b border-(--ui-border) last:border-0">
                    <td className="py-2 pr-3 font-medium text-(--ui-text) whitespace-nowrap">{v.label}</td>
                    <td className="py-2 pr-3">
                      <Input type="number" min="0" step="0.01" value={v.price}
                        onChange={(e) => updVariant(v._key, "price", e.target.value)}
                        className="w-24 text-right" />
                    </td>
                    <td className="py-2 pr-3">
                      <Input type="number" min="0" step="0.01" value={v.cost_price}
                        onChange={(e) => updVariant(v._key, "cost_price", e.target.value)}
                        className="w-24 text-right" />
                    </td>
                    <td className="py-2 pr-3">
                      <Input type="number" min="0" value={v.stock}
                        onChange={(e) => updVariant(v._key, "stock", e.target.value)}
                        className="w-20 text-right" />
                    </td>
                    <td className="py-2 pr-3">
                      <Input value={v.sku}
                        onChange={(e) => updVariant(v._key, "sku", e.target.value)}
                        className="w-28" placeholder="SKU" />
                    </td>
                    <td className="py-2">
                      <Input value={v.barcode}
                        onChange={(e) => updVariant(v._key, "barcode", e.target.value)}
                        className="w-32" placeholder="Barcode" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}
  </div>
</SectionCard>
```

**Step 4: Verify variant grid in browser**

- Add Product → toggle "Has variants" → select an attribute set → grid appears with auto-generated combinations
- Verify price/cost pre-fill from pricing card values

**Step 5: Commit**

```bash
git add frontend/src/pages/redesign/ProductFormPage.jsx
git commit -m "feat: ProductFormPage - Variants card with cartesian product generation"
```

---

## Task 6: Implement save logic

**Files:**
- Modify: `frontend/src/pages/redesign/ProductFormPage.jsx`

**Step 1: Add the save function inside ProductFormPage**

After `updVariant`, add:

```js
const save = async () => {
  if (!form.name.trim()) { setError("Product name is required."); return; }
  if (form.price === "" || isNaN(Number(form.price))) { setError("Valid price is required."); return; }
  if (form.has_variants && !form.attribute_set_id) { setError("Select an attribute set for variant products."); return; }
  if (form.has_variants && variants.length === 0) { setError("No variants generated. Select an attribute set."); return; }

  setSaving(true);
  setError("");
  try {
    const payload = {
      name: form.name.trim(),
      description_html: form.description,
      image_url: form.image_url || null,
      price: Number(form.price),
      cost_price: form.cost_price !== "" ? Number(form.cost_price) : 0,
      compare_at_price: form.compare_at_price !== "" ? Number(form.compare_at_price) : 0,
      gst: form.gst !== "" ? Number(form.gst) : null,
      stock: form.stock !== "" ? Number(form.stock) : 0,
      category_id: form.category_id || null,
      brand_id: form.brand_id || null,
      product_type: form.product_type || null,
      vendor: form.vendor || null,
      tags: form.tags || null,
      barcode: form.barcode || null,
      sku: form.sku || null,
      unit: form.unit || "pcs",
      status: form.status,
      has_variants: form.has_variants ? 1 : 0,
      attribute_set_id: form.has_variants ? (form.attribute_set_id || null) : null,
    };

    if (!isEdit && form.has_variants && variants.length > 0) {
      payload.variants = variants.map((v) => ({
        sku: v.sku || null,
        barcode: v.barcode || null,
        price: v.price !== "" ? Number(v.price) : Number(form.price),
        cost_price: v.cost_price !== "" ? Number(v.cost_price) : 0,
        initial_stock: v.stock !== "" ? Number(v.stock) : 0,
        options: v.options.map((o) => ({
          attribute_id: o.attribute_id,
          attribute_option_id: o.attribute_option_id,
        })),
      }));
    }

    if (isEdit && form.has_variants && variants.length > 0) {
      payload.variants = variants
        .filter((v) => v.id) // only existing variants (has id)
        .map((v) => ({
          id: v.id,
          sku: v.sku || null,
          barcode: v.barcode || null,
          price: v.price !== "" ? Number(v.price) : Number(form.price),
          cost_price: v.cost_price !== "" ? Number(v.cost_price) : 0,
          stock: v.stock !== "" ? Number(v.stock) : 0,
        }));
    }

    const url = isEdit ? `${API}/api/products/${id}` : `${API}/api/products`;
    const method = isEdit ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    navigate("/inventory");
  } catch (err) {
    setError(err.message);
    setSaving(false);
  }
};
```

**Step 2: Wire the Save button to the save function**

Find the Save button in the `actions` prop (currently `onClick={() => {}}`), change to:
```jsx
<Button tone="primary" onClick={save} disabled={saving}>
```

**Step 3: Test add simple product**

- Navigate to `/products/new`
- Fill: Name, Price
- Click "Add Product"
- Expected: navigates back to `/inventory`, new product visible in table

**Step 4: Test add variant product**

- Navigate to `/products/new`
- Fill: Name="Test Shirt", Price=500
- Toggle "Has variants", select an attribute set
- Fill in a few SKUs in the grid
- Click "Add Product"
- Expected: navigates to `/inventory`, new product shows in table with stock from first variant

**Step 5: Test edit product**

- Click a product row in inventory table
- Verify form pre-filled correctly
- Change the price, click "Save Changes"
- Expected: navigates to `/inventory`, price updated

**Step 6: Commit**

```bash
git add frontend/src/pages/redesign/ProductFormPage.jsx
git commit -m "feat: ProductFormPage - save logic for add/edit simple and variant products"
```

---

## Task 7: Check GET /api/products/:id response shape

> This is a verification task to catch any mismatch before QA.

**Step 1: Check if single-product GET exists**

```bash
grep -n "app.get.*products/:id[^/]" backend/routes/products.js
```

If the endpoint returns the product nested under a `product` key (e.g. `{ product: {...} }`) vs. directly as the root object — the data loading in Task 3 uses `prodD.product || prodD`. Verify this matches.

**Step 2: Check `has_variants` and `attribute_set_id` are returned**

```bash
grep -n "has_variants\|attribute_set_id" backend/routes/products.js | head -20
```

If the list endpoint (`GET /api/products`) doesn't return these fields, also fetch `GET /api/products/:id` separately in edit mode — the Task 3 scaffolding already does this via the `isEdit` branch.

**Step 3: Fix any mismatches found**

If the single-product endpoint doesn't exist at all (only the list endpoint), add a minimal endpoint to `backend/routes/products.js`:

```js
app.get("/api/products/:id", (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT p.*, COALESCE(SUM(os.quantity), 0) as total_stock
     FROM products p
     LEFT JOIN outlet_stock os ON p.id = os.product_id
     WHERE p.id = ?
     GROUP BY p.id`,
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Not found" });
      res.json({ product: row });
    }
  );
});
```

**Step 4: Commit if backend changed**

```bash
git add backend/routes/products.js
git commit -m "fix: add GET /api/products/:id single-product endpoint"
```

---

## Task 8: Final QA pass

**Step 1: Test validation errors**

- Submit empty form → "Product name is required"
- Submit name only, no price → "Valid price is required"
- Toggle variants, don't select attribute set, submit → "Select an attribute set"

**Step 2: Test image upload**

- Add product → upload an image → image preview shows → save → reload edit page → image still shows

**Step 3: Test navigation**

- "← Products" link works from both add and edit mode
- Cancel button works
- After save, lands on `/inventory`

**Step 4: Test variant edit locks**

- Edit a variant product → "Has variants" toggle is non-interactive → attribute set selector is disabled

**Step 5: Run integration tests to confirm no regressions**

```bash
cd backend && npx jest tests/integration/sales.test.js tests/integration/purchase-orders.test.js -t "" --passWithNoTests 2>&1 | tail -5
```
Expected: all pass.

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: ProductFormPage complete - full-page product add/edit with variant management"
```
