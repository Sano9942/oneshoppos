import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Percent, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import ItemPickField from "../../ui/ItemPickField";
import { indentLabel, leafCategories, sortCategories } from "../../utils/categoryTree";
import { downloadCsv } from "../../utils/csvExport";

// v93 (Tier 1.3 wholesale schemes): slab_percent + brand scope conditionally
// surfaced when wholesale_schemes flag is on. Base promotion types stay
// available to all tenants.
const BASE_TYPE_LABELS = {
  percent: "% Off (matched items)",
  fixed: "Fixed Amount Off",
  threshold_percent: "% Off if order >= minimum",
  threshold_fixed: "Fixed Off if order >= minimum",
  bxgy: "Buy X Get Y Free",
};
const WHOLESALE_TYPE_LABELS = {
  slab_percent: "Volume Slab (qty tiers → %)",
};

const BASE_APPLIES_LABELS = {
  all: "All products",
  product: "Specific product",
  category: "Category",
};
const WHOLESALE_APPLIES_LABELS = {
  brand: "Brand",
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
  brand_id: "",
  starts_at: "",
  ends_at: "",
  priority: "0",
  tier_rules: [], // [{ qty_from, qty_to|null, value }]
};

function normalizePromoPayload(src, override = {}) {
  const next = { ...src, ...override };
  const tiers = Array.isArray(next.tier_rules)
    ? next.tier_rules
        .map((t) => ({
          qty_from: Number(t.qty_from || 0),
          qty_to: t.qty_to === "" || t.qty_to == null ? null : Number(t.qty_to),
          value: Number(t.value || 0),
        }))
        .filter((t) => !Number.isNaN(t.qty_from) && !Number.isNaN(t.value))
    : null;
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
    brand_id: next.brand_id ? Number(next.brand_id) : null,
    starts_at: next.starts_at || null,
    ends_at: next.ends_at || null,
    active: next.active !== undefined ? Number(next.active) : 1,
    priority: Number(next.priority || 0),
    tier_rules: next.type === "slab_percent" && tiers && tiers.length ? tiers : null,
  };
}

function describeValue(row, fmt) {
  const value = Number(row.value || 0);
  if (row.type === "bxgy") return `Buy ${row.buy_qty || 0} / Get ${row.get_qty || 0}`;
  if (row.type === "slab_percent") {
    const tiers = Array.isArray(row.tier_rules) ? row.tier_rules : [];
    if (!tiers.length) return "Slab (no tiers)";
    return tiers
      .map((t) => {
        const to = t.qty_to == null ? "+" : `-${t.qty_to}`;
        return `${t.qty_from}${to}: ${t.value}%`;
      })
      .join(", ");
  }
  if (String(row.type || "").includes("percent")) return `${value}%`;
  return fmt(value);
}

export default function PromotionsRedesign() {
  const { fmt } = useCurrency();
  const { authHeaders } = useAuth();
  const authHeadersMemo = useMemo(() => authHeaders, [authHeaders]);
  const { flags } = useFeatureFlags(authHeadersMemo);
  const schemesEnabled = Boolean(flags?.wholesale_schemes);

  const TYPE_LABELS = useMemo(
    () => (schemesEnabled ? { ...BASE_TYPE_LABELS, ...WHOLESALE_TYPE_LABELS } : BASE_TYPE_LABELS),
    [schemesEnabled],
  );
  const APPLIES_LABELS = useMemo(
    () =>
      schemesEnabled
        ? { ...BASE_APPLIES_LABELS, ...WHOLESALE_APPLIES_LABELS }
        : BASE_APPLIES_LABELS,
    [schemesEnabled],
  );

  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
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
  // F5: toys are picked through the till's search box, not a list of every item.
  const [quoteProduct, setQuoteProduct] = useState(null);
  const [formToy, setFormToy] = useState(null);
  const [quoteQty, setQuoteQty] = useState("1");
  const [quoteResult, setQuoteResult] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const loadPromotions = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/promotions");
      setRows(data.promotions || []);
    } catch (e) {
      setRows([]);
      setError(e.message || "Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDependencies = useCallback(async () => {
    // allSettled so a 403 on /api/brands (or any other fetch) doesn't blank
    // products + categories. /api/brands is harmless when wholesale_schemes
    // is off — just an unused list.
    const [productsRes, categoriesRes, brandsRes] = await Promise.allSettled([
      api.get("/api/products"),
      api.get("/api/categories"),
      api.get("/api/brands"),
    ]);
    if (productsRes.status === "fulfilled") {
      setProducts(productsRes.value?.products || []);
    }
    if (categoriesRes.status === "fulfilled") {
      setCategories(sortCategories(categoriesRes.value?.categories || []));
    }
    if (brandsRes.status === "fulfilled") {
      setBrands(brandsRes.value?.brands || brandsRes.value || []);
    }
  }, []);

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
    setFormToy(null);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setFormToy(row.product_id
      ? products.find((p) => String(p.id) === String(row.product_id)) || { id: row.product_id, name: row.product_name || `Item #${row.product_id}` }
      : null);
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
      brand_id: row.brand_id ? String(row.brand_id) : "",
      starts_at: row.starts_at || "",
      ends_at: row.ends_at || "",
      priority: String(row.priority ?? "0"),
      tier_rules: Array.isArray(row.tier_rules)
        ? row.tier_rules.map((t) => ({
            qty_from: String(t.qty_from ?? ""),
            qty_to: t.qty_to == null ? "" : String(t.qty_to),
            value: String(t.value ?? ""),
          }))
        : [],
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
    if (form.applies_to === "brand" && !form.brand_id) {
      setFormError("Select a brand for brand-scoped promotions.");
      return;
    }
    if (form.type === "slab_percent") {
      if (!form.tier_rules.length) {
        setFormError("Add at least one slab tier (qty_from + value).");
        return;
      }
      let prevTo = -Infinity;
      for (let i = 0; i < form.tier_rules.length; i++) {
        const t = form.tier_rules[i];
        const from = Number(t.qty_from);
        const to = t.qty_to === "" ? Infinity : Number(t.qty_to);
        const value = Number(t.value);
        if (!Number.isFinite(from) || from < 0) {
          setFormError(`Tier ${i + 1}: qty_from must be non-negative.`);
          return;
        }
        if (t.qty_to !== "" && to < from) {
          setFormError(`Tier ${i + 1}: qty_to must be >= qty_from.`);
          return;
        }
        if (!Number.isFinite(value) || value < 0 || value > 100) {
          setFormError(`Tier ${i + 1}: value must be 0-100 (percent).`);
          return;
        }
        if (from <= prevTo) {
          setFormError(`Tier ${i + 1}: bands must be non-overlapping and ascending.`);
          return;
        }
        prevTo = to;
      }
    }
    setSaving(true);
    try {
      const isEdit = Boolean(editing?.id);
      const payload = normalizePromoPayload(
        form,
        isEdit ? { active: Number(editing.active || 0) } : { active: 1 },
      );
      if (isEdit) {
        await api.put(`/api/promotions/${editing.id}`, payload);
      } else {
        await api.post("/api/promotions", payload);
      }
      setNotice(isEdit ? "Promotion updated." : "Promotion created.");
      closeModal();
      await loadPromotions();
    } catch (e) {
      setFormError(e.message || "Connection failed");
    } finally {
      setSaving(false);
    }
  };

  const deletePromotion = async (id) => {
    if (!window.confirm("Delete this promotion?")) return;
    setError("");
    setNotice("");
    try {
      await api.del(`/api/promotions/${id}`);
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
      await api.put(`/api/promotions/${row.id}`, payload);
      setNotice(`Promotion ${payload.active ? "enabled" : "disabled"}.`);
      await loadPromotions();
    } catch (e) {
      setError(e.message || "Toggle failed");
    }
  };

  const addQuoteItem = () => {
    const product = quoteProduct;
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
    setQuoteProduct(null);
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
      const data = await api.post("/api/promotions/quote", {
        items: quoteItems.map((i) => ({
          product_id: Number(i.product_id),
          category_id: i.category_id ? Number(i.category_id) : null,
          quantity: Number(i.quantity || 0),
          price: Number(i.price || 0),
        })),
        order_total: quoteOrderTotal,
      });
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
        <SectionCard className="mb-3 bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">
          {error}
        </SectionCard>
      ) : null}
      {notice ? (
        <SectionCard className="mb-3 bg-(--ui-success-bg) p-3 text-sm text-(--ui-success-fg)">
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
              <ItemPickField value={quoteProduct} onChange={setQuoteProduct} />
              <Input
                type="number"
                min="1"
                value={quoteQty}
                onChange={(e) => setQuoteQty(e.target.value)}
              />
              <Button tone="primary" onClick={addQuoteItem} disabled={!quoteProduct}>
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
                <div className="rounded-(--ui-radius-sm) bg-(--ui-success-bg) p-2">
                  <p className="text-xs text-(--ui-success-fg)">Total Promotion Discount</p>
                  <p className="text-base font-semibold text-(--ui-success-fg)">
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

      <Modal
        open={modalOpen}
        onClose={saving ? undefined : closeModal}
        title={editing ? "Edit Promotion" : "New Promotion"}
        size="xl"
      >
        {formError ? (
          <div className="mb-3 rounded-(--ui-radius-sm) bg-(--ui-danger-bg) p-2 text-sm text-(--ui-danger-fg)">
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

              {form.type === "slab_percent" ? (
                <div className="rounded border border-(--ui-border) p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-xs font-semibold text-(--ui-text-muted) uppercase">
                      Slab Tiers (qty → discount %)
                    </label>
                    <Button
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          tier_rules: [
                            ...prev.tier_rules,
                            { qty_from: "", qty_to: "", value: "" },
                          ],
                        }))
                      }
                    >
                      <Plus size={12} className="mr-1 inline" /> Add Tier
                    </Button>
                  </div>
                  <p className="mb-2 text-xs text-(--ui-text-muted)">
                    Quantity bands must be ascending and non-overlapping. Leave the last tier's
                    "Qty To" blank for "and above". Percent value 0-100.
                  </p>
                  {!form.tier_rules.length ? (
                    <p className="py-2 text-center text-xs text-(--ui-text-muted)">
                      No tiers yet. Add at least one.
                    </p>
                  ) : null}
                  {form.tier_rules.map((t, idx) => (
                    <div key={idx} className="mb-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                      <div>
                        <label className="text-xs text-(--ui-text-muted)">Qty From</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={t.qty_from}
                          onChange={(e) =>
                            setForm((prev) => {
                              const next = [...prev.tier_rules];
                              next[idx] = { ...next[idx], qty_from: e.target.value };
                              return { ...prev, tier_rules: next };
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-(--ui-text-muted)">Qty To (blank = ∞)</label>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          value={t.qty_to}
                          onChange={(e) =>
                            setForm((prev) => {
                              const next = [...prev.tier_rules];
                              next[idx] = { ...next[idx], qty_to: e.target.value };
                              return { ...prev, tier_rules: next };
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-(--ui-text-muted)">Discount %</label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={t.value}
                          onChange={(e) =>
                            setForm((prev) => {
                              const next = [...prev.tier_rules];
                              next[idx] = { ...next[idx], value: e.target.value };
                              return { ...prev, tier_rules: next };
                            })
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        tone="danger"
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            tier_rules: prev.tier_rules.filter((_, i) => i !== idx),
                          }))
                        }
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
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
                  <ItemPickField
                    value={formToy}
                    onChange={(p) => {
                      setFormToy(p);
                      setForm((prev) => ({ ...prev, product_id: p ? String(p.id) : "" }));
                    }}
                  />
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

              {form.applies_to === "brand" ? (
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Brand</label>
                  <Select
                    value={form.brand_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, brand_id: e.target.value }))}
                  >
                    <option value="">Select brand</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
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
                {schemesEnabled ? (
                  <div>
                    <label className="mb-1 block text-xs text-(--ui-text-muted)">
                      Priority
                      <span className="ml-1 text-(--ui-text-muted)">(higher wins)</span>
                    </label>
                    <Input
                      type="number"
                      min="0"
                      value={form.priority}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, priority: e.target.value }))
                      }
                    />
                  </div>
                ) : null}
              </div>

              <ModalFooter>
                <Button type="button" onClick={closeModal} disabled={saving}>
                  Cancel
                </Button>
                <Button tone="primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : editing ? "Save Changes" : "Create Promotion"}
                </Button>
              </ModalFooter>
            </form>
      </Modal>
    </PageShell>
  );
}
