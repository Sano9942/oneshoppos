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
      <div className="p-6 text-(--ui-text-muted) text-sm">
        <button
          onClick={() => navigate("/inventory")}
          className="mb-4 flex items-center gap-1 text-sm text-(--ui-text-muted) hover:text-(--ui-text)"
        >
          ← Products
        </button>
        Form sections coming in next tasks. Loaded {categories.length} categories, {brands.length} brands, {attributeSets.length} attribute sets.
        {isEdit && ` Edit mode — ${variants.length} variants, ${outletStock.length} outlet stock rows.`}
      </div>
    </PageShell>
  );
}
