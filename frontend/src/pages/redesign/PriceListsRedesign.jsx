import { useEffect, useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
import {
  Button,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

// ── helpers ──────────────────────────────────────────────────────────────────

const TYPE_META = {
  customer_group: { label: "Customer Group", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  volume: { label: "Volume", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  promotional: { label: "Promotional", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
};

function TypeBadge({ type }) {
  const meta = TYPE_META[type] ?? { label: type, color: "bg-(--ui-muted-surface) text-(--ui-text-muted)" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
      <Tag size={11} />
      {meta.label}
    </span>
  );
}

function savingsPct(defaultPrice, specialPrice) {
  const base = parseFloat(defaultPrice);
  const sp = parseFloat(specialPrice);
  if (!base || isNaN(base) || isNaN(sp)) return null;
  return (((base - sp) / base) * 100).toFixed(0);
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

const EMPTY_FORM = { name: "", description: "", type: "customer_group", is_active: true };

function PriceListModal({ open, editing, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const { error: toastError, success } = useToast();

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? { name: editing.name, description: editing.description ?? "", type: editing.type, is_active: editing.is_active }
          : EMPTY_FORM
      );
    }
  }, [open, editing]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return toastError("Name is required.");
    setBusy(true);
    try {
      if (editing) {
        await api.put(`/api/price-lists/${editing.id}`, form);
        success("Price list updated.");
      } else {
        await api.post("/api/price-lists", form);
        success("Price list created.");
      }
      onSaved();
      onClose();
    } catch (err) {
      toastError(err.message ?? "Failed to save price list.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={editing ? "Edit Price List" : "New Price List"}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-(--text-secondary) mb-1">Name *</label>
          <Input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Wholesale Tier A"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-(--text-secondary) mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Optional notes about this price list"
            rows={2}
            className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm placeholder:text-(--text-muted) focus:outline-none focus:ring-2 focus:ring-(--accent) resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-(--text-secondary) mb-1">Type</label>
          <select
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--accent)"
          >
            <option value="customer_group">Customer Group</option>
            <option value="volume">Volume</option>
            <option value="promotional">Promotional</option>
          </select>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
            className="w-4 h-4 rounded border-(--border) accent-(--accent)"
          />
          <span className="text-sm text-(--text-secondary)">Active</span>
        </label>
        <ModalFooter>
          <Button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button tone="primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save Changes" : "Create"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}

// ── Items Sub-table ───────────────────────────────────────────────────────────

function ItemsPanel({ listId, products }) {
  const { fmt } = useCurrency();
  const { success, error: toastError } = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editingCell, setEditingCell] = useState(null); // { itemId, field }
  const [cellValue, setCellValue] = useState("");

  // Add-product row state
  const [addProductId, setAddProductId] = useState("");
  const [addPrice, setAddPrice] = useState("");
  const [addMinQty, setAddMinQty] = useState("1");
  const [addBusy, setAddBusy] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/price-lists/${listId}/items`);
      setItems(data.items ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [listId]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  function startEdit(itemId, field, currentVal) {
    setEditingCell({ itemId, field });
    setCellValue(String(currentVal ?? ""));
  }

  async function commitEdit(item) {
    if (!editingCell) return;
    const { itemId, field } = editingCell;
    setEditingCell(null);
    const patch = field === "price"
      ? { price: parseFloat(cellValue), min_qty: item.min_qty ?? 1 }
      : { price: item.price, min_qty: parseInt(cellValue, 10) || 1 };
    try {
      await api.put(`/api/price-list-items/${itemId}`, patch);
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, [field]: field === "price" ? parseFloat(cellValue) : parseInt(cellValue, 10) || 1 } : i))
      );
    } catch (err) {
      toastError(err.message ?? "Failed to update item.");
      fetchItems();
    }
  }

  async function removeItem(itemId) {
    try {
      await api.del(`/api/price-list-items/${itemId}`);
      setItems((prev) => prev.filter((i) => i.id !== itemId));
      success("Item removed.");
    } catch (err) {
      toastError(err.message ?? "Failed to remove item.");
    }
  }

  async function addItem() {
    if (!addProductId) return toastError("Select a product first.");
    if (!addPrice || isNaN(parseFloat(addPrice))) return toastError("Enter a valid price.");
    setAddBusy(true);
    try {
      await api.post(`/api/price-lists/${listId}/items`, {
        product_id: parseInt(addProductId, 10),
        variant_id: null,
        price: parseFloat(addPrice),
        min_qty: parseInt(addMinQty, 10) || 1,
      });
      success("Product added.");
      setAddProductId("");
      setAddPrice("");
      setAddMinQty("1");
      setProductSearch("");
      fetchItems();
    } catch (err) {
      toastError(err.message ?? "Failed to add product.");
    } finally {
      setAddBusy(false);
    }
  }

  const filteredProducts = products.filter(
    (p) =>
      !productSearch ||
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.sku ?? "").toLowerCase().includes(productSearch.toLowerCase())
  );

  const selectedProduct = products.find((p) => String(p.id) === String(addProductId));

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="rounded-lg border border-(--border) overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-(--bg-subtle) text-(--text-muted) text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Product</th>
              <th className="text-left px-4 py-2 font-medium">Variant</th>
              <th className="text-right px-4 py-2 font-medium">Default Price</th>
              <th className="text-right px-4 py-2 font-medium">Special Price</th>
              <th className="text-right px-4 py-2 font-medium">Min Qty</th>
              <th className="text-right px-4 py-2 font-medium">Savings</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {loading && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-(--text-muted) text-sm">Loading items…</td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-(--text-muted) text-sm">No items yet. Add a product below.</td>
              </tr>
            )}
            {items.map((item) => {
              const basePrice = item.variant_id ? item.variant_price : item.default_price;
              const pct = savingsPct(basePrice, item.price);
              const isEditingPrice = editingCell?.itemId === item.id && editingCell?.field === "price";
              const isEditingQty = editingCell?.itemId === item.id && editingCell?.field === "min_qty";
              return (
                <tr key={item.id} className="hover:bg-(--bg-subtle)/50 transition-colors">
                  <td className="px-4 py-2">
                    <div className="font-medium text-(--text-primary)">{item.product_name}</div>
                    <div className="text-xs text-(--text-muted)">{item.sku ?? item.variant_sku ?? ""}</div>
                  </td>
                  <td className="px-4 py-2 text-(--text-secondary)">
                    {item.variant_name ?? <span className="text-(--text-muted) italic">—</span>}
                  </td>
                  <td className="px-4 py-2 text-right text-(--text-secondary)">
                    {fmt(basePrice ?? 0)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isEditingPrice ? (
                      <input
                        autoFocus
                        type="number"
                        step="0.01"
                        className="w-24 rounded border border-(--accent) bg-(--bg-input) text-(--text-primary) px-2 py-1 text-sm text-right focus:outline-none"
                        value={cellValue}
                        onChange={(e) => setCellValue(e.target.value)}
                        onBlur={() => commitEdit(item)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEdit(item); if (e.key === "Escape") setEditingCell(null); }}
                      />
                    ) : (
                      /* Inline editable cell — dashed-underline styling, a Button would add background. */
                      <button
                        onClick={() => startEdit(item.id, "price", item.price)}
                        className="font-medium text-(--text-primary) hover:text-(--accent) transition-colors cursor-pointer underline decoration-dashed underline-offset-2"
                      >
                        {fmt(item.price)}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isEditingQty ? (
                      <input
                        autoFocus
                        type="number"
                        min="1"
                        className="w-16 rounded border border-(--accent) bg-(--bg-input) text-(--text-primary) px-2 py-1 text-sm text-right focus:outline-none"
                        value={cellValue}
                        onChange={(e) => setCellValue(e.target.value)}
                        onBlur={() => commitEdit(item)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEdit(item); if (e.key === "Escape") setEditingCell(null); }}
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(item.id, "min_qty", item.min_qty ?? 1)}
                        className="text-(--text-primary) hover:text-(--accent) transition-colors cursor-pointer underline decoration-dashed underline-offset-2"
                      >
                        {item.min_qty ?? 1}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {pct !== null ? (
                      <span className={`text-xs font-semibold ${parseFloat(pct) >= 0 ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                        {parseFloat(pct) >= 0 ? `-${pct}%` : `+${Math.abs(pct)}%`}
                      </span>
                    ) : (
                      <span className="text-(--text-muted)">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button tone="plain" size="sm" iconOnly onClick={() => removeItem(item.id)} title="Remove" aria-label="Remove" className="hover:text-red-500">
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add-product row */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="relative min-w-48 grow">
          <label className="block text-xs font-medium text-(--text-muted) mb-1">Search product</label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--text-muted) pointer-events-none" />
            <input
              type="text"
              placeholder="Name or SKU…"
              value={productSearch}
              onChange={(e) => { setProductSearch(e.target.value); setAddProductId(""); }}
              className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) pl-8 pr-3 py-2 text-sm placeholder:text-(--text-muted) focus:outline-none focus:ring-2 focus:ring-(--accent)"
            />
          </div>
          {productSearch && !addProductId && filteredProducts.length > 0 && (
            <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-(--bg-card) border border-(--border) rounded-lg shadow-lg max-h-48 overflow-y-auto">
              {filteredProducts.slice(0, 20).map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-2 hover:bg-(--bg-subtle) text-sm"
                  onMouseDown={() => { setAddProductId(String(p.id)); setProductSearch(p.name); if (!addPrice) setAddPrice(String(p.price ?? "")); }}
                >
                  <span className="font-medium text-(--text-primary)">{p.name}</span>
                  {p.sku && <span className="text-(--text-muted) ml-2 text-xs">{p.sku}</span>}
                  <span className="float-right text-(--text-muted) text-xs">{p.price}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedProduct && (
          <div className="text-xs text-(--text-muted) self-end pb-2">
            Default: <span className="font-medium text-(--text-secondary)">{fmt(selectedProduct.price)}</span>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-(--text-muted) mb-1">Special Price</label>
          <input
            type="number"
            step="0.01"
            placeholder="0.00"
            value={addPrice}
            onChange={(e) => setAddPrice(e.target.value)}
            className="w-28 rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--accent)"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-(--text-muted) mb-1">Min Qty</label>
          <input
            type="number"
            min="1"
            placeholder="1"
            value={addMinQty}
            onChange={(e) => setAddMinQty(e.target.value)}
            className="w-20 rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--accent)"
          />
        </div>
        <Button onClick={addItem} disabled={addBusy || !addProductId} className="shrink-0">
          <Plus size={14} />
          {addBusy ? "Adding…" : "Add"}
        </Button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PriceListsRedesign() {
  const { success, error: toastError } = useToast();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  async function fetchLists() {
    setLoading(true);
    try {
      const data = await api.get("/api/price-lists");
      setRows(data.priceLists ?? []);
    } catch (err) {
      toastError(err.message ?? "Failed to load price lists.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchLists();
    api.get("/api/products").then((d) => setProducts(d.products ?? [])).catch(() => {});
  }, []);

  async function toggleActive(list) {
    setTogglingId(list.id);
    try {
      await api.put(`/api/price-lists/${list.id}`, { ...list, is_active: !list.is_active });
      setRows((prev) => prev.map((r) => r.id === list.id ? { ...r, is_active: !r.is_active } : r));
    } catch (err) {
      toastError(err.message ?? "Failed to update status.");
    } finally {
      setTogglingId(null);
    }
  }

  async function deleteList(list) {
    if (!window.confirm(`Delete "${list.name}"? This will remove all its price overrides.`)) return;
    try {
      await api.del(`/api/price-lists/${list.id}`);
      setRows((prev) => prev.filter((r) => r.id !== list.id));
      if (selectedId === list.id) setSelectedId(null);
      success("Price list deleted.");
    } catch (err) {
      toastError(err.message ?? "Failed to delete price list.");
    }
  }

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(list) {
    setEditing(list);
    setModalOpen(true);
  }

  const filtered = rows.filter((r) =>
    !search || r.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <PageShell
        title="Price Lists"
        subtitle="Manage custom pricing for customer groups, volume tiers, and promotions."
        right={
          <Button onClick={openCreate}>
            <Plus size={15} />
            New Price List
          </Button>
        }
      >
        <SectionCard>
          {/* Search */}
          <div className="px-4 pt-4 pb-3 border-b border-(--border)">
            <div className="relative max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted) pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Search price lists…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Tag size={32} className="mx-auto text-(--text-muted) mb-3" />
              <p className="text-(--text-muted) text-sm">
                {search ? "No price lists match your search." : "No price lists yet. Create one to get started."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-(--border)">
              {filtered.map((list) => {
                const expanded = selectedId === list.id;
                return (
                  <div key={list.id}>
                    {/* Row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 hover:bg-(--bg-subtle)/60 cursor-pointer transition-colors group"
                      onClick={() => setSelectedId(expanded ? null : list.id)}
                    >
                      {/* Expand icon */}
                      <span className="text-(--text-muted) shrink-0">
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </span>

                      {/* Name + description */}
                      <div className="grow min-w-0">
                        <div className="font-medium text-(--text-primary) truncate">{list.name}</div>
                        {list.description && (
                          <div className="text-xs text-(--text-muted) truncate">{list.description}</div>
                        )}
                      </div>

                      {/* Type */}
                      <div className="shrink-0 hidden sm:block">
                        <TypeBadge type={list.type} />
                      </div>

                      {/* Items count */}
                      <div className="shrink-0 w-20 text-right text-sm text-(--text-secondary)">
                        {list.item_count ?? 0} item{list.item_count !== 1 ? "s" : ""}
                      </div>

                      {/* Active toggle — custom switch control, needs a Toggle/Switch primitive to converge. */}
                      <div
                        className="shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          disabled={togglingId === list.id}
                          onClick={() => toggleActive(list)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${list.is_active ? "bg-green-500" : "bg-(--border)"} ${togglingId === list.id ? "opacity-50" : ""}`}
                          title={list.is_active ? "Active — click to deactivate" : "Inactive — click to activate"}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${list.is_active ? "translate-x-4" : "translate-x-0.5"}`}
                          />
                        </button>
                      </div>

                      {/* Actions */}
                      <div
                        className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button tone="plain" size="sm" iconOnly onClick={() => openEdit(list)} title="Edit" aria-label="Edit"><Pencil size={14} /></Button>
                        <Button tone="plain" size="sm" iconOnly onClick={() => deleteList(list)} title="Delete" aria-label="Delete" className="hover:text-red-500"><Trash2 size={14} /></Button>
                      </div>
                    </div>

                    {/* Expanded items panel + assignments */}
                    {expanded && (
                      <div className="bg-(--bg-subtle)/40 border-t border-(--border)">
                        <ItemsPanel listId={list.id} products={products} />
                        <AssignmentsPanel listId={list.id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </PageShell>

      <PriceListModal
        open={modalOpen}
        editing={editing}
        onClose={() => setModalOpen(false)}
        onSaved={fetchLists}
      />
    </>
  );
}

// ── Assignments Panel (Phase 2 — outlet pricing) ───────────────────────────

const SCOPE_LABELS = { outlet: "Outlet", channel: "Channel", customer: "Customer", customer_group: "Customer Group" };

function AssignmentsPanel({ listId }) {
  const toast = useToast();
  const [assignments, setAssignments] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ scope_type: "outlet", scope_id: "", priority: 0 });

  useEffect(() => {
    Promise.all([
      api.get(`/api/price-list-assignments?price_list_id=${listId}`).catch(() => ({ assignments: [] })),
      api.get("/api/outlets").catch(() => ({ outlets: [] })),
    ]).then(([a, o]) => {
      setAssignments(a.assignments ?? []);
      setOutlets(o.outlets ?? o ?? []);
      setLoading(false);
    });
  }, [listId]);

  async function addAssignment() {
    if (!form.scope_id) return toast.error("Select a scope entity");
    try {
      const res = await api.post("/api/price-list-assignments", {
        price_list_id: listId,
        scope_type: form.scope_type,
        scope_id: Number(form.scope_id),
        priority: Number(form.priority) || 0,
      });
      setAssignments(prev => [...prev, res.assignment]);
      setShowAdd(false);
      setForm({ scope_type: "outlet", scope_id: "", priority: 0 });
      toast.success("Assignment added");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function removeAssignment(id) {
    try {
      await api.del(`/api/price-list-assignments/${id}`);
      setAssignments(prev => prev.filter(a => a.id !== id));
      toast.success("Assignment removed");
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (loading) return <div className="px-6 py-3 text-xs text-(--text-muted)">Loading assignments…</div>;

  return (
    <div className="px-6 py-3 border-t border-(--border)">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-(--text-muted)">Assignments</h4>
        <button onClick={() => setShowAdd(!showAdd)} className="text-xs text-(--accent) hover:underline">
          {showAdd ? "Cancel" : "+ Assign"}
        </button>
      </div>

      {showAdd && (
        <div className="flex items-end gap-2 mb-3">
          <select value={form.scope_type} onChange={e => setForm(f => ({ ...f, scope_type: e.target.value, scope_id: "" }))}
            className="rounded border border-(--border) bg-(--bg) px-2 py-1 text-xs">
            {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {form.scope_type === "outlet" ? (
            <select value={form.scope_id} onChange={e => setForm(f => ({ ...f, scope_id: e.target.value }))}
              className="rounded border border-(--border) bg-(--bg) px-2 py-1 text-xs grow">
              <option value="">Select outlet…</option>
              {outlets.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <input type="number" placeholder="Entity ID" value={form.scope_id}
              onChange={e => setForm(f => ({ ...f, scope_id: e.target.value }))}
              className="rounded border border-(--border) bg-(--bg) px-2 py-1 text-xs w-24" />
          )}
          <input type="number" placeholder="Priority" value={form.priority}
            onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
            className="rounded border border-(--border) bg-(--bg) px-2 py-1 text-xs w-20" />
          <Button size="sm" tone="primary" onClick={addAssignment}>Add</Button>
        </div>
      )}

      {assignments.length === 0 ? (
        <p className="text-xs text-(--text-muted)">No assignments yet. Assign this price list to outlets or customer groups.</p>
      ) : (
        <div className="space-y-1">
          {assignments.map(a => (
            <div key={a.id} className="flex items-center justify-between py-1 text-xs">
              <span>
                <span className="font-medium">{SCOPE_LABELS[a.scope_type] || a.scope_type}</span>
                {" → "}
                {a.outlet_name || `#${a.scope_id}`}
                {a.priority > 0 && <span className="ml-1 text-(--text-muted)">(priority {a.priority})</span>}
              </span>
              <button onClick={() => removeAssignment(a.id)} className="text-red-500 hover:underline">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
