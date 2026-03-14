import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Percent, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import { indentLabel, leafCategories, sortCategories } from "../../utils/categoryTree";
import { downloadCsv } from "../../utils/csvExport";

const TYPE_LABELS = {
  percent: "% Off (matched items)",
  fixed: "Fixed Amount Off",
  threshold_percent: "% Off if order >= minimum",
  threshold_fixed: "Fixed Off if order >= minimum",
  bxgy: "Buy X Get Y Free",
};

const APPLIES_LABELS = {
  all: "All products",
  product: "Specific product",
  category: "Category",
};

const EMPTY = {
  name: "",
  type: "percent",
  value: "",
  min_order_amount: "",
  buy_qty: "",
  get_qty: "",
  applies_to: "all",
  product_id: "",
  category_id: "",
  starts_at: "",
  ends_at: "",
};

function normalizePromoPayload(src, override = {}) {
  const next = { ...src, ...override };
  return {
    name: next.name || "",
    type: next.type || "percent",
    value: Number(next.value || 0),
    min_order_amount: Number(next.min_order_amount || 0),
    buy_qty: Number(next.buy_qty || 0),
    get_qty: Number(next.get_qty || 0),
    applies_to: next.applies_to || "all",
    product_id: next.product_id ? Number(next.product_id) : null,
    category_id: next.category_id ? Number(next.category_id) : null,
    starts_at: next.starts_at || null,
    ends_at: next.ends_at || null,
    active: next.active !== undefined ? Number(next.active) : 1,
  };
}

function describeValue(row, fmt) {
  const value = Number(row.value || 0);
  if (row.type === "bxgy") return `Buy ${row.buy_qty || 0} / Get ${row.get_qty || 0}`;
  if (String(row.type || "").includes("percent")) return `${value}%`;
  return fmt(value);
}

export default function PromotionsRedesign() {
  const { authHeaders } = useAuth();
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");

  const [quoteItems, setQuoteItems] = useState([]);
  const [quoteProductId, setQuoteProductId] = useState("");
  const [quoteQty, setQuoteQty] = useState("1");
  const [quoteResult, setQuoteResult] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const loadPromotions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/promotions`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load promotions");
      setRows(data.promotions || []);
    } catch (e) {
      setRows([]);
      setError(e.message || "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const loadDependencies = useCallback(async () => {
    try {
      const [productsRes, categoriesRes] = await Promise.all([
        fetch(`${API}/products`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/categories`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setProducts(productsRes.products || []);
      setCategories(sortCategories(categoriesRes.categories || []));
    } catch {
      // Non-blocking for list load.
    }
  }, [authHeaders]);

  useEffect(() => {
    loadPromotions();
    loadDependencies();
  }, [loadPromotions, loadDependencies]);

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.type || "").toLowerCase().includes(q) ||
        String(r.applies_to || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((r) => Number(r.active || 0) === 1).length,
      inactive: rows.filter((r) => Number(r.active || 0) !== 1).length,
    }),
    [rows],
  );

  const quoteOrderTotal = useMemo(
    () =>
      quoteItems.reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 0), 0),
    [quoteItems],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      type: row.type || "percent",
      value: String(row.value ?? ""),
      min_order_amount: String(row.min_order_amount ?? ""),
      buy_qty: String(row.buy_qty ?? ""),
      get_qty: String(row.get_qty ?? ""),
      applies_to: row.applies_to || "all",
      product_id: row.product_id ? String(row.product_id) : "",
      category_id: row.category_id ? String(row.category_id) : "",
      starts_at: row.starts_at || "",
      ends_at: row.ends_at || "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY);
    setFormError("");
  };

  const savePromotion = async (e) => {
    e.preventDefault();
    setFormError("");
    setError("");
    setNotice("");
    if (!form.name || !form.type || form.value === "") {
      setFormError("Name, type, and value are required.");
      return;
    }
    if (form.applies_to === "product" && !form.product_id) {
      setFormError("Select a product for product-scoped promotions.");
      return;
    }
    if (form.applies_to === "category" && !form.category_id) {
      setFormError("Select a category for category-scoped promotions.");
      return;
    }
    setSaving(true);
    try {
      const isEdit = Boolean(editing?.id);
      const url = isEdit ? `${API}/promotions/${editing.id}` : `${API}/promotions`;
      const method = isEdit ? "PUT" : "POST";
      const payload = normalizePromoPayload(
        form,
        isEdit ? { active: Number(editing.active || 0) } : { active: 1 },
      );
      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to save promotion");
        return;
      }
      setNotice(isEdit ? "Promotion updated." : "Promotion created.");
      closeModal();
      await loadPromotions();
    } catch {
      setFormError("Connection failed");
    } finally {
      setSaving(false);
    }
  };

  const deletePromotion = async (id) => {
    if (!window.confirm("Delete this promotion?")) return;
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/promotions/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setNotice("Promotion deleted.");
      await loadPromotions();
    } catch (e) {
      setError(e.message || "Delete failed");
    }
  };

  const togglePromotion = async (row) => {
    setError("");
    setNotice("");
    try {
      const payload = normalizePromoPayload(row, {
        active: Number(row.active || 0) === 1 ? 0 : 1,
      });
      const res = await fetch(`${API}/promotions/${row.id}`, {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Toggle failed");
      setNotice(`Promotion ${payload.active ? "enabled" : "disabled"}.`);
      await loadPromotions();
    } catch (e) {
      setError(e.message || "Toggle failed");
    }
  };

  const addQuoteItem = () => {
    const product = products.find((p) => String(p.id) === String(quoteProductId));
    const qty = Math.max(1, Number(quoteQty || 1));
    if (!product) return;
    setQuoteItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.product_id === product.id ? { ...i, quantity: Number(i.quantity) + qty } : i,
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          category_id: product.category_id || null,
          name: product.name,
          quantity: qty,
          price: Number(product.price || 0),
        },
      ];
    });
    setQuoteQty("1");
  };

  const removeQuoteItem = (productId) => {
    setQuoteItems((prev) => prev.filter((i) => i.product_id !== productId));
  };

  const runQuote = async () => {
    if (!quoteItems.length) {
      setError("Add quote items before testing promotions.");
      return;
    }
    setQuoteLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/promotions/quote`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          items: quoteItems.map((i) => ({
            product_id: Number(i.product_id),
            category_id: i.category_id ? Number(i.category_id) : null,
            quantity: Number(i.quantity || 0),
            price: Number(i.price || 0),
          })),
          order_total: quoteOrderTotal,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Quote failed");
      setQuoteResult(data);
    } catch (e) {
      setError(e.message || "Quote failed");
      setQuoteResult(null);
    } finally {
      setQuoteLoading(false);
    }
  };

  return (
    <PageShell
      title="Promotions"
      subtitle="manage discount rules and test promotion outcomes on sample carts."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(["id","name","type","value","start_date","end_date","active"], visibleRows.map(r => [r.id, r.name||"", r.type||"", r.discount_value||0, r.start_date||"", r.end_date||"", r.active?"Yes":"No"]), "promotions")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button onClick={loadPromotions}>
            <RefreshCw size={13} className="mr-1 inline" />
            Refresh
          </Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={13} className="mr-1 inline" />
            Add Promotion
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}
      {notice ? (
        <SectionCard className="mb-3 border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          {notice}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Promotions</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{stats.total}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Active</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{stats.active}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Inactive</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{stats.inactive}</p>
        </SectionCard>
      </div>

      <SectionCard className="mb-3">
        <TableToolbar
          left={
            <div className="relative min-w-65">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
              />
              <Input
                className="pl-8"
                placeholder="Search by name, type, applies-to"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Value</th>
                <th className="px-3 py-2 text-left">Applies To</th>
                <th className="px-3 py-2 text-left">Validity</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((row) => (
                  <tr key={row.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">{row.name}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{TYPE_LABELS[row.type] || row.type}</td>
                    <td className="px-3 py-2 text-(--ui-text)">
                      {describeValue(row, fmt)}
                      {(row.type === "threshold_percent" || row.type === "threshold_fixed") &&
                      Number(row.min_order_amount || 0) > 0
                        ? ` (min ${fmt(row.min_order_amount)})`
                        : ""}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {APPLIES_LABELS[row.applies_to] || row.applies_to}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {row.starts_at || "-"} {row.ends_at ? `to ${row.ends_at}` : ""}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge tone={Number(row.active || 0) === 1 ? "success" : "default"}>
                        {Number(row.active || 0) === 1 ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          tone={Number(row.active || 0) === 1 ? "default" : "primary"}
                          onClick={() => togglePromotion(row)}
                        >
                          {Number(row.active || 0) === 1 ? "Disable" : "Enable"}
                        </Button>
                        <Button size="sm" tone="danger" onClick={() => deletePromotion(row.id)}>
                          <Trash2 size={12} className="mr-1 inline" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading promotions...</div>
          ) : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState title="No promotions" body="Create your first promotion rule to start discount campaigns." />
          ) : null}
        </div>
      </SectionCard>

      <SectionCard>
        <TableToolbar
          left={
            <span className="inline-flex items-center gap-1 text-sm font-medium text-(--ui-text)">
              <Percent size={14} />
              Quote Test
            </span>
          }
          right={
            <span className="text-xs text-(--ui-text-muted)">
              Cart Total: {fmt(quoteOrderTotal)}
            </span>
          }
        />
        <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_360px]">
          <div>
            <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_110px_110px]">
              <Select value={quoteProductId} onChange={(e) => setQuoteProductId(e.target.value)}>
                <option value="">Select product</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Input
                type="number"
                min="1"
                value={quoteQty}
                onChange={(e) => setQuoteQty(e.target.value)}
              />
              <Button tone="primary" onClick={addQuoteItem} disabled={!quoteProductId}>
                Add
              </Button>
            </div>
            <div className="overflow-auto">
              <table className="min-w-full border border-(--ui-border) text-sm">
                <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                  <tr>
                    <th className="px-3 py-2 text-left">Item</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {quoteItems.map((item) => (
                    <tr key={item.product_id} className="border-t border-(--ui-border)">
                      <td className="px-3 py-2 text-(--ui-text)">{item.name}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{item.quantity}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">
                        {fmt(item.price)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-(--ui-text)">
                        {fmt(Number(item.price || 0) * Number(item.quantity || 0))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" tone="danger" onClick={() => removeQuoteItem(item.product_id)}>
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!quoteItems.length ? (
                <p className="py-3 text-center text-xs text-(--ui-text-muted)">
                  Add items to evaluate promotion effects.
                </p>
              ) : null}
            </div>
          </div>
          <div className="rounded border border-(--ui-border) p-3">
            <h3 className="text-sm font-semibold text-(--ui-text)">Evaluation Result</h3>
            <p className="mt-1 text-xs text-(--ui-text-muted)">
              Runs active promotions for the sample cart using backend quote logic.
            </p>
            <div className="mt-3 flex gap-2">
              <Button tone="primary" onClick={runQuote} disabled={quoteLoading || !quoteItems.length}>
                {quoteLoading ? "Evaluating..." : "Run Quote"}
              </Button>
              <Button
                onClick={() => {
                  setQuoteItems([]);
                  setQuoteResult(null);
                }}
              >
                Clear
              </Button>
            </div>
            {quoteResult ? (
              <div className="mt-3 space-y-2 text-sm">
                <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                  <p className="text-xs text-emerald-700">Total Promotion Discount</p>
                  <p className="text-base font-semibold text-emerald-800">
                    {fmt(quoteResult.total_promotion_discount)}
                  </p>
                </div>
                <div className="max-h-56 overflow-auto rounded border border-(--ui-border)">
                  <table className="min-w-full text-xs">
                    <thead className="bg-(--ui-muted-surface) text-(--ui-text-muted)">
                      <tr>
                        <th className="px-2 py-1 text-left">Promotion</th>
                        <th className="px-2 py-1 text-left">Type</th>
                        <th className="px-2 py-1 text-right">Discount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(quoteResult.applied_promotions || []).map((ap) => (
                        <tr key={ap.promotion_id} className="border-t border-(--ui-border)">
                          <td className="px-2 py-1 text-(--ui-text)">{ap.name}</td>
                          <td className="px-2 py-1 text-(--ui-text-muted)">{ap.type}</td>
                          <td className="px-2 py-1 text-right text-(--ui-text)">
                            {fmt(ap.discount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!quoteResult.applied_promotions?.length ? (
                    <p className="p-2 text-center text-xs text-(--ui-text-muted)">
                      No promotions applied for this cart.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-2xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">
                {editing ? "Edit Promotion" : "New Promotion"}
              </h3>
              <button className="text-(--ui-text-muted) hover:text-(--ui-text)" onClick={closeModal}>
                <X size={16} />
              </button>
            </div>
            {formError ? (
              <div className="mb-3 rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-700">
                {formError}
              </div>
            ) : null}
            <form className="space-y-3" onSubmit={savePromotion}>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Promotion Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Eid Sale 10% Off"
                  required
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Type</label>
                  <Select
                    value={form.type}
                    onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Value</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.value}
                    onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
                    required
                  />
                </div>
              </div>

              {form.type === "bxgy" ? (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-(--ui-text-muted)">Buy Qty (X)</label>
                    <Input
                      type="number"
                      min="1"
                      value={form.buy_qty}
                      onChange={(e) => setForm((prev) => ({ ...prev, buy_qty: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-(--ui-text-muted)">Get Qty (Y)</label>
                    <Input
                      type="number"
                      min="1"
                      value={form.get_qty}
                      onChange={(e) => setForm((prev) => ({ ...prev, get_qty: e.target.value }))}
                    />
                  </div>
                </div>
              ) : null}

              {form.type === "threshold_percent" || form.type === "threshold_fixed" ? (
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">
                    Minimum Order Amount
                  </label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.min_order_amount}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, min_order_amount: e.target.value }))
                    }
                  />
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Applies To</label>
                <Select
                  value={form.applies_to}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      applies_to: e.target.value,
                      product_id: "",
                      category_id: "",
                    }))
                  }
                >
                  {Object.entries(APPLIES_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </div>

              {form.applies_to === "product" ? (
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Product</label>
                  <Select
                    value={form.product_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, product_id: e.target.value }))}
                  >
                    <option value="">Select product</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              {form.applies_to === "category" ? (
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Category</label>
                  <Select
                    value={form.category_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value }))}
                  >
                    <option value="">Select category</option>
                    {leafCategories(categories).map((c) => (
                      <option key={c.id} value={c.id}>
                        {indentLabel(c)}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Start Date</label>
                  <Input
                    type="date"
                    value={form.starts_at}
                    onChange={(e) => setForm((prev) => ({ ...prev, starts_at: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">End Date</label>
                  <Input
                    type="date"
                    value={form.ends_at}
                    onChange={(e) => setForm((prev) => ({ ...prev, ends_at: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" onClick={closeModal}>
                  Cancel
                </Button>
                <Button tone="primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : editing ? "Save Changes" : "Create Promotion"}
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
