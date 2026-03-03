import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, Trash2, X } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Badge,
  BulkActionBar,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { useAuth } from "../../auth/AuthProvider";
import { indentLabel, leafCategories, sortCategories } from "../../utils/categoryTree";

const PAGE_SIZE = 50;

const BLANK_FORM = {
  name: "", barcode: "", sku: "", price: "", cost_price: "",
  stock: "", category_id: "", brand_id: "", status: "active", unit: "pcs",
  product_type: "", vendor: "", tags: "",
};

function ProductModal({ product, categories, brands, authHeaders, onClose, onSaved }) {
  const isEdit = Boolean(product);
  const [form, setForm] = useState(
    isEdit
      ? {
          name: product.name || "",
          barcode: product.barcode || "",
          sku: product.sku || "",
          price: product.price ?? "",
          cost_price: product.cost_price ?? "",
          stock: product.total_stock ?? "",
          category_id: product.category_id || "",
          brand_id: product.brand_id || "",
          status: product.status || "active",
          unit: product.unit || "pcs",
          product_type: product.product_type || "",
          vendor: product.vendor || "",
          tags: product.tags || "",
        }
      : { ...BLANK_FORM },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [outletStock, setOutletStock] = useState([]);

  useEffect(() => {
    if (!isEdit || !product?.id) return;
    fetch(`${API}/api/products/${product.id}/outlet-stock`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setOutletStock(d.outletStock || []))
      .catch(() => setOutletStock([]));
  }, [isEdit, product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const upd = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError("Product name is required."); return; }
    if (form.price === "" || isNaN(Number(form.price))) { setError("Valid price is required."); return; }
    setSaving(true);
    setError("");
    try {
      const url = isEdit
        ? `${API}/api/products/${product.id}`
        : `${API}/api/products`;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price: Number(form.price),
          cost_price: form.cost_price !== "" ? Number(form.cost_price) : 0,
          stock: form.stock !== "" ? Number(form.stock) : 0,
          category_id: form.category_id || null,
          brand_id: form.brand_id || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg rounded-xl border border-(--ui-border) bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-(--ui-border) px-5 py-4">
          <h2 className="font-semibold text-(--ui-text)">
            {isEdit ? "Edit Product" : "Add Product"}
          </h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={save} className="space-y-3 p-5">
          {error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Product Name *</label>
              <Input value={form.name} onChange={(e) => upd("name", e.target.value)} placeholder="e.g. Blue T-Shirt" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Barcode</label>
              <Input value={form.barcode} onChange={(e) => upd("barcode", e.target.value)} placeholder="Scan or type" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">SKU</label>
              <Input value={form.sku} onChange={(e) => upd("sku", e.target.value)} placeholder="e.g. BTS-001" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Selling Price *</label>
              <Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => upd("price", e.target.value)} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Cost Price</label>
              <Input type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => upd("cost_price", e.target.value)} placeholder="0.00" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Opening Stock</label>
              <Input type="number" min="0" value={form.stock} onChange={(e) => upd("stock", e.target.value)} placeholder="0" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Unit</label>
              <Input value={form.unit} onChange={(e) => upd("unit", e.target.value)} placeholder="pcs" />
            </div>
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
            <div className="col-span-2 flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Tags</label>
              <Input value={form.tags} onChange={(e) => upd("tags", e.target.value)} placeholder="Comma-separated tags, e.g. Age 5+,STEM,Indoor,Gift" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-(--ui-text-muted)">Status</label>
              <Select value={form.status} onChange={(e) => upd("status", e.target.value)}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>
          </div>
          {isEdit && outletStock.length > 0 && (
            <div className="rounded-lg border border-(--ui-border) p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-(--ui-text-muted)">Stock by Location</p>
              <div className="space-y-1">
                {outletStock.map((os) => (
                  <div key={os.outlet_id} className="flex items-center justify-between text-sm">
                    <span className="text-(--ui-text)">{os.outlet_name}</span>
                    <span className="font-semibold text-(--ui-text)">{os.quantity} pcs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-(--ui-border) pt-3">
            <Button type="button" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Product"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]).join(",");
  const body = rows.map((r) =>
    Object.values(r)
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers, ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function InventoryRedesign() {
  const { authHeaders } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState("name");
  const [sortOrder, setSortOrder] = useState("asc");
  const [status, setStatus] = useState("");
  const [outletFilter, setOutletFilter] = useState("");
  const [modalProduct, setModalProduct] = useState(undefined); // undefined=closed, null=new, object=edit
  const [categoryId, setCategoryId] = useState("");
  const [bulkCategoryTarget, setBulkCategoryTarget] = useState("");
  const [page, setPage] = useState(1);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (search) qs.set("search", search);
      if (status) qs.set("status", status);
      if (categoryId) qs.set("category_id", categoryId);
      if (outletFilter) qs.set("outlet_id", outletFilter);
      qs.set("sort", sortField);
      qs.set("order", sortOrder);
      const res = await fetch(`${API}/api/products?${qs}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setProducts(data.products || []);
      setSelectedIds(new Set());
      setPage(1);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const [catRes, brandRes, outletRes] = await Promise.all([
        fetch(`${API}/api/categories`, { headers: authHeaders() }),
        fetch(`${API}/api/brands`, { headers: authHeaders() }),
        fetch(`${API}/api/outlets`, { headers: authHeaders() }),
      ]);
      const catData = await catRes.json();
      const brandData = await brandRes.json();
      const outletData = await outletRes.json();
      setCategories(sortCategories(catData.categories || []));
      setBrands(brandData.brands || []);
      setOutlets(outletData.outlets || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(fetchProducts, search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search, sortField, sortOrder, status, categoryId, outletFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const paged = useMemo(
    () => products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, products],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const toggleSort = (field) => {
    if (sortField === field) setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const allSelected = paged.length > 0 && paged.every((p) => selectedIds.has(p.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((p) => {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      });
      return next;
    });
  };

  const runBulk = async (path, payload, successMessage = null) => {
    setBulkWorking(true);
    try {
      const res = await fetch(`${API}/api/products/${path}`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk action failed");
      if (successMessage) alert(successMessage(data));
      setSelectedIds(new Set());
      await fetchProducts();
    } catch (err) {
      alert(err.message);
    } finally {
      setBulkWorking(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <>
    <PageShell
      title="Products"
      subtitle="Shopify-style product listing with server filtering, sorting, and bulk operations."
      right={
        <div className="flex items-center gap-2">
          <Button
            onClick={() =>
              exportCSV(
                products.map((p) => ({
                  id: p.id,
                  barcode: p.barcode,
                  sku: p.sku || "",
                  name: p.name,
                  status: p.status || "active",
                  category: p.category_name || "",
                  category_path: p.category_path_label || p.category_name || "",
                  product_type: p.product_type || "",
                  vendor: p.vendor || "",
                  tags: p.tags || "",
                  price: p.price,
                  stock: p.total_stock,
                })),
                "inventory-export.csv",
              )
            }
          >
            <Download size={14} className="mr-1 inline" />
            Export all
          </Button>
          <Button tone="primary" onClick={() => setModalProduct(null)}>
            <Plus size={14} className="mr-1 inline" />
            Add Product
          </Button>
        </div>
      }
    >
      <SectionCard>
        <TableToolbar
          left={
            <>
              <div className="relative min-w-65">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                />
                <Input
                  className="pl-8"
                  placeholder="Search name, barcode, SKU"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {indentLabel(c)}
                  </option>
                ))}
              </Select>
              <Select value={outletFilter} onChange={(e) => setOutletFilter(e.target.value)}>
                <option value="">All locations</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
              <Select
                value={`${sortField}:${sortOrder}`}
                onChange={(e) => {
                  const [field, order] = e.target.value.split(":");
                  setSortField(field);
                  setSortOrder(order);
                }}
              >
                <option value="name:asc">Name (A-Z)</option>
                <option value="name:desc">Name (Z-A)</option>
                <option value="price:asc">Price (Low-High)</option>
                <option value="price:desc">Price (High-Low)</option>
                <option value="stock:desc">Stock (High-Low)</option>
                <option value="stock:asc">Stock (Low-High)</option>
                <option value="min_qty:asc">Min Qty (Low-High)</option>
                <option value="min_qty:desc">Min Qty (High-Low)</option>
                <option value="created_at:desc">Newest</option>
              </Select>
            </>
          }
          right={<p className="text-sm text-(--ui-text-muted)">{products.length} items</p>}
        />

        <div className="p-3">
          {selectedCount > 0 ? (
            <BulkActionBar>
              <span className="text-sm font-semibold text-emerald-800">
                {selectedCount} selected
              </span>
              <Button
                tone="danger"
                size="sm"
                disabled={bulkWorking}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selectedCount} products? This cannot be undone.`,
                    )
                  ) {
                    runBulk(
                      "bulk-delete",
                      { ids: [...selectedIds] },
                      (d) => `Deleted ${d.deleted} products`,
                    );
                  }
                }}
              >
                <Trash2 size={13} className="mr-1 inline" />
                Delete
              </Button>
              <Button
                size="sm"
                disabled={bulkWorking}
                onClick={() =>
                  runBulk("bulk-status", {
                    ids: [...selectedIds],
                    status: "active",
                  })
                }
              >
                Set Active
              </Button>
              <Button
                size="sm"
                disabled={bulkWorking}
                onClick={() =>
                  runBulk("bulk-status", {
                    ids: [...selectedIds],
                    status: "inactive",
                  })
                }
              >
                Set Inactive
              </Button>
              <Select
                value={bulkCategoryTarget}
                onChange={(e) => setBulkCategoryTarget(e.target.value)}
              >
                <option value="">Assign category...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id} disabled={!c.is_leaf}>
                    {indentLabel(c)}{c.is_leaf ? "" : " (parent)"}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                disabled={!bulkCategoryTarget || bulkWorking}
                onClick={() =>
                  runBulk("bulk-category", {
                    ids: [...selectedIds],
                    category_id: Number(bulkCategoryTarget),
                  })
                }
              >
                Apply category
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  exportCSV(
                    products
                      .filter((p) => selectedIds.has(p.id))
                      .map((p) => ({
                        id: p.id,
                        barcode: p.barcode,
                        name: p.name,
                        status: p.status || "active",
                        category_path: p.category_path_label || p.category_name || "",
                        product_type: p.product_type || "",
                        vendor: p.vendor || "",
                        tags: p.tags || "",
                        price: p.price,
                        stock: p.total_stock,
                      })),
                    "inventory-selected.csv",
                  )
                }
              >
                <Download size={13} className="mr-1 inline" />
                Export selected
              </Button>
              <Button size="sm" tone="plain" onClick={() => setSelectedIds(new Set())}>
                Clear
              </Button>
            </BulkActionBar>
          ) : null}
        </div>

        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface)">
              <tr className="text-left text-xs uppercase tracking-wide text-(--ui-text-muted)">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={
                      paged.length > 0 && paged.every((p) => selectedIds.has(p.id))
                    }
                    onChange={toggleSelectPage}
                  />
                </th>
                <th className="cursor-pointer px-3 py-2" onClick={() => toggleSort("name")}>
                  Product
                </th>
                <th className="px-3 py-2">Barcode</th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("price")}>
                  Price
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("stock")}>
                  Stock
                </th>
                <th className="cursor-pointer px-3 py-2 text-right" onClick={() => toggleSort("min_qty")}>
                  Min Qty
                </th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-(--ui-border) cursor-pointer ${
                    selectedIds.has(p.id) ? "bg-emerald-50" : "hover:bg-slate-50 bg-white"
                  }`}
                  onClick={() => setModalProduct(p)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-(--ui-text)">{p.name}</div>
                    <div className="text-xs text-(--ui-text-muted)">
                      {p.vendor || "-"} {p.product_type ? `| ${p.product_type}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--ui-text-muted)">
                    {p.barcode || "-"}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    PKRs {(Number(p.price || 0)).toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    {p.total_stock ?? 0}
                  </td>
                  <td className="px-3 py-2 text-right text-(--ui-text)">
                    {p.min_qty ?? 0}
                  </td>
                  <td className="px-3 py-2 text-(--ui-text-muted)">
                    {p.category_path_label || p.category_name || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      tone={
                        String(p.status || "active") === "active"
                          ? "success"
                          : String(p.status) === "draft"
                            ? "warning"
                            : "danger"
                      }
                    >
                      {p.status || "active"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && products.length === 0 ? (
            <EmptyState
              title="No products found"
              body="Try changing filters, or import products from Shopify."
            />
          ) : null}
        </div>
        <div className="flex items-center justify-between border-t border-(--ui-border) p-3">
          <span className="text-xs text-(--ui-text-muted)">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </SectionCard>
    </PageShell>
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
    </>
  );
}
