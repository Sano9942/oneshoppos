import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE as API } from "../../config";
import { api } from "../../api";
import { Button, PageShell, Input, SectionCard, Select } from "../../ui/primitives";
import { sortCategories, indentLabel } from "../../utils/categoryTree";
import { X, Package, Plus, Trash2, Search, ShieldCheck } from "lucide-react";
import { StarDisplay, StarPicker } from "../../ui/StarRating";

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

const BLANK_FORM = {
  name: "", description: "", image_url: "",
  price: "", cost_price: "", compare_at_price: "", gst: "",
  stock: "",
  category_id: "", brand_id: "", product_type: "", vendor: "", tags: "",
  barcode: "", sku: "", unit: "pcs",
  status: "active",
  has_variants: false,
  is_bundle: false,
  attribute_set_id: "",
  supplier_id: "",
};

export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [variants, setVariants] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [attributeSets, setAttributeSets] = useState([]);
  const [outletStock, setOutletStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageUploading, setImageUploading] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [bundleComponents, setBundleComponents] = useState([]);
  const [componentSearch, setComponentSearch] = useState("");
  const [componentResults, setComponentResults] = useState([]);
  const [componentSearching, setComponentSearching] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewForm, setReviewForm] = useState({ rating: 0, title: "", body: "", customer_name: "" });
  const [reviewSubmitting, setReviewSubmitting] = useState(false);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const updVariant = (key, field, value) =>
    setVariants((prev) => prev.map((v) => v._key === key ? { ...v, [field]: value } : v));

  const searchComponents = async (q) => {
    setComponentSearch(q);
    if (!q || q.length < 2) { setComponentResults([]); return; }
    setComponentSearching(true);
    try {
      const data = await api.get(`/api/products/search?query=${encodeURIComponent(q)}`);
      // Exclude current product (in edit mode) and existing bundle components
      const existing = new Set(bundleComponents.map((c) => c.product_id));
      const filtered = (data.products || []).filter(
        (p) => String(p.id) !== String(id) && !existing.has(p.id) && !p.is_bundle
      );
      setComponentResults(filtered);
    } catch { setComponentResults([]); }
    setComponentSearching(false);
  };

  const addComponent = (product) => {
    setBundleComponents((prev) => [
      ...prev,
      { product_id: product.id, variant_id: null, quantity: 1, name: product.name, sku: product.sku, price: product.price },
    ]);
    setComponentSearch("");
    setComponentResults([]);
  };

  const removeComponent = (productId) => {
    setBundleComponents((prev) => prev.filter((c) => c.product_id !== productId));
  };

  const updComponent = (productId, field, value) => {
    setBundleComponents((prev) =>
      prev.map((c) => c.product_id === productId ? { ...c, [field]: value } : c)
    );
  };

  const save = async () => {
    if (!form.name.trim()) { setError("Product name is required."); return; }
    if (form.price === "" || isNaN(Number(form.price))) { setError("Valid price is required."); return; }
    if (form.has_variants && !form.attribute_set_id) { setError("Select an attribute set for variant products."); return; }
    if (form.has_variants && variants.length === 0) { setError("No variants generated. Select an attribute set."); return; }
    if (form.is_bundle && bundleComponents.length === 0) { setError("Bundle must have at least one component product."); return; }

    setSaving(true);
    setError("");
    try {
      // If user typed a new supplier name, create it first and get the ID back
      let resolvedSupplierId = form.supplier_id || null;
      if (form.supplier_id === "__new__" && newSupplierName.trim()) {
        const sData = await api.post("/api/suppliers", { name: newSupplierName.trim() });
        resolvedSupplierId = sData.id;
        // Add to local list so it shows immediately if user navigates back
        setSuppliers((prev) => [...prev, sData]);
      }

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
        supplier_id: resolvedSupplierId || null,
        has_variants: form.has_variants ? 1 : 0,
        attribute_set_id: form.has_variants ? (form.attribute_set_id || null) : null,
        is_bundle: form.is_bundle ? true : false,
      };

      if (form.is_bundle && bundleComponents.length > 0) {
        payload.bundle_components = bundleComponents.map((c) => ({
          product_id: c.product_id,
          variant_id: c.variant_id || null,
          quantity: Number(c.quantity) || 1,
        }));
      }

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
          .filter((v) => v.id)
          .map((v) => ({
            id: v.id,
            sku: v.sku || null,
            barcode: v.barcode || null,
            price: v.price !== "" ? Number(v.price) : Number(form.price),
            cost_price: v.cost_price !== "" ? Number(v.cost_price) : 0,
            stock: v.stock !== "" ? Number(v.stock) : 0,
          }));
      }

      if (isEdit) {
        await api.put(`/api/products/${id}`, payload);
      } else {
        await api.post("/api/products", payload);
      }
      navigate("/inventory");
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await api.upload("/api/uploads/product-image", fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      upd("image_url", data.url);
    } catch (err) {
      setError("Image upload failed: " + err.message);
    } finally {
      setImageUploading(false);
    }
  };

  useEffect(() => {
    const base = [
      api.get("/api/categories"),
      api.get("/api/brands"),
      api.get("/api/attribute-sets"),
      api.get("/api/suppliers"),
    ];
    const all = isEdit
      ? [...base,
          api.get(`/api/products/${id}`),
          api.get(`/api/products/${id}/variants`),
          api.get(`/api/products/${id}/stock`),
          api.get(`/api/products/${id}/reviews`),
        ]
      : base;

    Promise.all(all).then(([catD, brandD, attrD, suppD, ...editParts]) => {
      setCategories(sortCategories(catD.categories || []));
      setBrands(brandD.brands || []);
      setAttributeSets(attrD.attributeSets || []);
      setSuppliers(suppD.suppliers || []);
      if (isEdit) {
        const [prodD, varD, stockD, reviewsD] = editParts;
        if (Array.isArray(reviewsD)) setReviews(reviewsD);
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
            is_bundle: Boolean(p.is_bundle),
            attribute_set_id: p.attribute_set_id || "",
            supplier_id: p.supplier_id || "",
            avg_rating: p.avg_rating || 0,
            review_count: p.review_count || 0,
          });
          if (p.is_bundle && Array.isArray(p.bundle_components)) {
            setBundleComponents(p.bundle_components.map((c) => ({
              product_id: c.component_product_id,
              variant_id: c.component_variant_id || null,
              quantity: c.quantity,
              name: c.component_name,
              sku: c.component_sku,
              price: c.component_price,
            })));
          }
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
      subtitle={isEdit ? `Editing product #${id}` : "Fill in the details below to add a new product"}
      right={
        <div className="flex gap-2">
          <Button onClick={() => navigate("/inventory")} disabled={saving}>Cancel</Button>
          <Button tone="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Product"}
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mx-6 mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}
      <div className="p-6 grid grid-cols-3 gap-6 items-start">
        {/* LEFT MAIN (2/3) */}
        <div className="col-span-2 flex flex-col gap-6">

          {/* Basic Info */}
          <SectionCard>
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Basic Info</p>
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
          <SectionCard>
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Media</p>
              {form.image_url && (
                <div className="relative w-32 h-32">
                  <img src={form.image_url.startsWith("/uploads") ? `${API}${form.image_url}` : form.image_url} alt="Product" className="w-32 h-32 rounded-lg object-cover border border-(--ui-border)" />
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
          <SectionCard>
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Pricing</p>
              <div className="grid grid-cols-2 gap-3">
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
            </div>
          </SectionCard>

          {/* Bundle */}
          <SectionCard>
            <div className="p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Bundle / Kit</p>

              {/* Toggle — locked in edit mode, mutually exclusive with variants */}
              <div
                className={`flex items-center gap-3 ${isEdit ? "opacity-60 pointer-events-none" : form.has_variants ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
                onClick={() => {
                  if (isEdit || form.has_variants) return;
                  const next = !form.is_bundle;
                  upd("is_bundle", next);
                  if (!next) setBundleComponents([]);
                }}
              >
                <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${form.is_bundle ? "bg-violet-500" : "bg-slate-200"}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${form.is_bundle ? "translate-x-4" : ""}`} />
                </div>
                <span className="text-sm font-medium text-(--ui-text) flex items-center gap-1.5">
                  <Package size={14} /> This product is a bundle / kit
                </span>
              </div>
              {form.has_variants && !form.is_bundle && (
                <p className="text-xs text-(--ui-text-muted)">Bundles cannot have variants.</p>
              )}

              {form.is_bundle && (
                <div className="space-y-3">
                  {/* Component search */}
                  <div className="relative">
                    <div className="flex items-center gap-2">
                      <Search size={14} className="text-(--ui-text-muted)" />
                      <Input
                        value={componentSearch}
                        onChange={(e) => searchComponents(e.target.value)}
                        placeholder="Search products to add as components…"
                        className="flex-1"
                      />
                    </div>
                    {componentResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-(--ui-border) rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {componentResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addComponent(p)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between items-center"
                          >
                            <span className="font-medium text-(--ui-text)">{p.name}</span>
                            <span className="text-xs text-(--ui-text-muted)">{p.sku || "—"}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {componentSearching && (
                      <p className="text-xs text-(--ui-text-muted) mt-1">Searching…</p>
                    )}
                  </div>

                  {/* Component list */}
                  {bundleComponents.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs font-semibold uppercase text-(--ui-text-muted) border-b border-(--ui-border)">
                            <th className="pb-2 text-left pr-3">Component</th>
                            <th className="pb-2 text-left pr-3">SKU</th>
                            <th className="pb-2 text-right pr-3">Qty per bundle</th>
                            <th className="pb-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {bundleComponents.map((c) => (
                            <tr key={c.product_id} className="border-b border-(--ui-border) last:border-0">
                              <td className="py-2 pr-3 font-medium text-(--ui-text)">{c.name}</td>
                              <td className="py-2 pr-3 text-(--ui-text-muted) text-xs">{c.sku || "—"}</td>
                              <td className="py-2 pr-3">
                                <Input
                                  type="number" min="1" value={c.quantity}
                                  onChange={(e) => updComponent(c.product_id, "quantity", e.target.value)}
                                  className="w-20 text-right"
                                />
                              </td>
                              <td className="py-2 text-center">
                                <button type="button" onClick={() => removeComponent(c.product_id)}
                                  className="text-rose-400 hover:text-rose-600 p-1">
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {bundleComponents.length === 0 && (
                    <p className="text-sm text-(--ui-text-muted) py-2">No components added yet. Search above to add products to this bundle.</p>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          {/* Inventory — only for simple products; variant stock handled in Task 5 */}
          {!form.has_variants && !form.is_bundle && (
            <SectionCard>
              <div className="p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Inventory</p>
                {!isEdit ? (
                  <div className="flex flex-col gap-1 max-w-xs">
                    <label className="text-xs font-medium text-(--ui-text-muted)">Opening Stock</label>
                    <Input type="number" min="0" value={form.stock} onChange={(e) => upd("stock", e.target.value)} placeholder="0" />
                  </div>
                ) : outletStock.length > 0 ? (
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
                )}
              </div>
            </SectionCard>
          )}

          {/* Variants */}
          <SectionCard>
            <div className="p-4 space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Variants</p>

              {/* Toggle — locked in edit mode, mutually exclusive with bundles */}
              <div
                className={`flex items-center gap-3 ${isEdit ? "opacity-60 pointer-events-none" : form.is_bundle ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
                onClick={() => {
                  if (isEdit || form.is_bundle) return;
                  const next = !form.has_variants;
                  upd("has_variants", next);
                  if (!next) {
                    upd("attribute_set_id", "");
                    setVariants([]);
                  }
                }}
              >
                <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-0.5 ${form.has_variants ? "bg-(--ui-primary)" : "bg-slate-200"}`}>
                  <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform ${form.has_variants ? "translate-x-4" : ""}`} />
                </div>
                <span className="text-sm font-medium text-(--ui-text)">This product has variants</span>
              </div>

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

        </div>

        {/* RIGHT SIDEBAR (1/3) */}
        <div className="flex flex-col gap-6">

          {/* Status */}
          <SectionCard>
            <div className="p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Status</p>
              <Select value={form.status} onChange={(e) => upd("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </SectionCard>

          {/* Organization */}
          <SectionCard>
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Organization</p>
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

          {/* Supplier */}
          <SectionCard>
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Supplier</p>
              <div className="flex flex-col gap-1">
                <Select
                  value={form.supplier_id}
                  onChange={(e) => {
                    upd("supplier_id", e.target.value);
                    if (e.target.value !== "__new__") setNewSupplierName("");
                  }}
                >
                  <option value="">No supplier</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                  <option value="__new__">+ Create new supplier…</option>
                </Select>
                {form.supplier_id === "__new__" && (
                  <Input
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    placeholder="Supplier name"
                    autoFocus
                  />
                )}
              </div>
            </div>
          </SectionCard>

          {/* Identifiers */}
          <SectionCard>
            <div className="p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Identifiers</p>
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

      {/* Reviews section — edit mode only */}
      {isEdit && (
        <SectionCard className="mt-6">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                Reviews
              </p>
              {reviews.length > 0 && (
                <span className="text-sm text-(--ui-text-muted)">
                  <StarDisplay rating={form.avg_rating || 0} size={14} className="mr-1 align-middle" />
                  {Number(form.avg_rating || 0).toFixed(1)}/5 ({form.review_count || 0} reviews)
                </span>
              )}
            </div>

            {/* Review list */}
            {reviews.length === 0 && (
              <p className="text-sm text-(--ui-text-muted)">No reviews yet.</p>
            )}
            {reviews.map((r) => (
              <div key={r.id} className="border border-(--ui-border) rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <StarDisplay rating={r.rating} size={14} />
                  {r.title && <span className="font-medium text-sm">{r.title}</span>}
                </div>
                {r.body && <p className="text-sm text-(--ui-text-muted)">{r.body}</p>}
                <div className="flex items-center gap-2 text-xs text-(--ui-text-muted)">
                  <span>{r.customer_name}</span>
                  {r.sale_id && (
                    <span className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400">
                      <ShieldCheck size={12} /> Verified Purchase
                    </span>
                  )}
                  <span>·</span>
                  <span>{new Date(r.created_at).toLocaleDateString()}</span>
                  {r.status && r.status !== "approved" && (
                    <span className={`ml-auto px-1.5 py-0.5 rounded text-xs font-medium ${r.status === "pending" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"}`}>
                      {r.status}
                    </span>
                  )}
                </div>
              </div>
            ))}

            {/* Write a review form */}
            <div className="border-t border-(--ui-border) pt-4 space-y-3">
              <p className="text-sm font-medium">Write a Review</p>
              <div className="flex items-center gap-2">
                <span className="text-xs text-(--ui-text-muted)">Rating:</span>
                <StarPicker value={reviewForm.rating} onChange={(v) => setReviewForm((p) => ({ ...p, rating: v }))} size={20} />
              </div>
              <Input
                value={reviewForm.customer_name}
                onChange={(e) => setReviewForm((p) => ({ ...p, customer_name: e.target.value }))}
                placeholder="Customer name"
              />
              <Input
                value={reviewForm.title}
                onChange={(e) => setReviewForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Review title (optional)"
              />
              <textarea
                className="w-full border border-(--ui-border) rounded-lg p-2 text-sm bg-(--ui-bg) text-(--ui-text) resize-none"
                rows={3}
                value={reviewForm.body}
                onChange={(e) => setReviewForm((p) => ({ ...p, body: e.target.value }))}
                placeholder="Write your review..."
              />
              <Button
                size="sm"
                disabled={reviewForm.rating === 0 || reviewSubmitting}
                onClick={async () => {
                  setReviewSubmitting(true);
                  try {
                    const created = await api.post(`/api/products/${id}/reviews`, {
                      rating: reviewForm.rating,
                      title: reviewForm.title || undefined,
                      body: reviewForm.body || undefined,
                      customer_name: reviewForm.customer_name || undefined,
                    });
                    setReviews((prev) => [created, ...prev]);
                    setReviewForm({ rating: 0, title: "", body: "", customer_name: "" });
                  } catch (e) {
                    setError(e.message || "Failed to submit review");
                  }
                  setReviewSubmitting(false);
                }}
              >
                {reviewSubmitting ? "Submitting…" : "Submit Review"}
              </Button>
            </div>
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
