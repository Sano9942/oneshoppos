import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_BASE as API } from "../../config";
import { Button, PageShell, Input, SectionCard, Select } from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import { sortCategories, indentLabel } from "../../utils/categoryTree";
import { X } from "lucide-react";

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
  attribute_set_id: "",
};

export default function ProductFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { authHeaders } = useAuth();

  const [form, setForm] = useState({ ...BLANK_FORM });
  const [variants, setVariants] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [attributeSets, setAttributeSets] = useState([]);
  const [outletStock, setOutletStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [imageUploading, setImageUploading] = useState(false);

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const updVariant = (key, field, value) =>
    setVariants((prev) => prev.map((v) => v._key === key ? { ...v, [field]: value } : v));

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
      subtitle={isEdit ? `Editing product #${id}` : "Fill in the details below to add a new product"}
      right={
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

          {/* Inventory — only for simple products; variant stock handled in Task 5 */}
          {!form.has_variants && (
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

              {/* Toggle — locked in edit mode */}
              <div
                className={`flex items-center gap-3 ${isEdit ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}
                onClick={() => {
                  if (isEdit) return;
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
    </PageShell>
  );
}
