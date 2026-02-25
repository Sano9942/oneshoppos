import { useState, useEffect, useCallback } from "react";
import { Tag, Plus, Edit2, Trash2, X, ToggleLeft, ToggleRight, RefreshCw } from "lucide-react";

import { API } from '../config';

const TYPE_LABELS = {
  percent: "% Off (all matched items)",
  fixed: "Fixed Amount Off",
  threshold_percent: "% Off if order ≥ min",
  threshold_fixed: "Fixed Off if order ≥ min",
  bxgy: "Buy X Get Y Free",
};

const APPLIES_LABELS = { all: "All Products", product: "Specific Product", category: "Category" };

const EMPTY = {
  name: "", type: "percent", value: "", min_order_amount: "", buy_qty: "", get_qty: "",
  applies_to: "all", product_id: "", category_id: "", starts_at: "", ends_at: "",
};

export default function Promotions() {
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null); // null | 'add' | promotion object
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/promotions`);
      const data = await res.json();
      setPromos(data.promotions || []);
    } catch { setPromos([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetchPromos();
    fetch(`${API}/products`).then((r) => r.json()).then((d) => setProducts(d.products || [])).catch(() => {});
    fetch(`${API}/categories`).then((r) => r.json()).then((d) => setCategories(d.categories || [])).catch(() => {});
  }, [fetchPromos]);

  const openAdd = () => { setForm(EMPTY); setFormError(""); setModal("add"); };
  const openEdit = (p) => {
    setForm({
      name: p.name, type: p.type, value: p.value, min_order_amount: p.min_order_amount || "",
      buy_qty: p.buy_qty || "", get_qty: p.get_qty || "", applies_to: p.applies_to || "all",
      product_id: p.product_id || "", category_id: p.category_id || "",
      starts_at: p.starts_at || "", ends_at: p.ends_at || "",
    });
    setFormError("");
    setModal(p);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.name || !form.type || form.value === "") { setFormError("Name, type and value are required"); return; }
    setSaving(true);
    try {
      const isEdit = modal && modal !== "add";
      const url = isEdit ? `${API}/promotions/${modal.id}` : `${API}/promotions`;
      const method = isEdit ? "PUT" : "POST";
      const body = {
        ...form,
        value: parseFloat(form.value),
        min_order_amount: parseFloat(form.min_order_amount || 0),
        buy_qty: parseInt(form.buy_qty || 0),
        get_qty: parseInt(form.get_qty || 0),
        product_id: form.product_id ? parseInt(form.product_id) : null,
        category_id: form.category_id ? parseInt(form.category_id) : null,
      };
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "Save failed"); return; }
      setModal(null);
      fetchPromos();
    } catch { setFormError("Connection failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this promotion?")) return;
    try {
      await fetch(`${API}/promotions/${id}`, { method: "DELETE" });
      fetchPromos();
    } catch { alert("Delete failed"); }
  };

  const toggleActive = async (p) => {
    try {
      await fetch(`${API}/promotions/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, active: p.active ? 0 : 1 }),
      });
      fetchPromos();
    } catch { alert("Toggle failed"); }
  };

  const f = form;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Promotions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage pricing rules and discount campaigns</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchPromos} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> Add Promotion
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Value</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Applies To</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Validity</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Active</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {promos.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                  <Tag size={36} className="mx-auto mb-2 opacity-30" />
                  No promotions yet. Add one to get started.
                </td></tr>
              ) : promos.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{TYPE_LABELS[p.type] || p.type}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">
                    {p.type === "bxgy"
                      ? `Buy ${p.buy_qty} Get ${p.get_qty}`
                      : p.type.includes("percent")
                      ? `${p.value}%`
                      : `PKRs ${p.value}`}
                    {(p.type === "threshold_percent" || p.type === "threshold_fixed") && p.min_order_amount > 0
                      ? ` (min PKRs ${p.min_order_amount})`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{APPLIES_LABELS[p.applies_to] || p.applies_to}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {p.starts_at ? p.starts_at : "—"} {p.ends_at ? `→ ${p.ends_at}` : ""}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => toggleActive(p)} className={p.active ? "text-green-600 hover:text-green-700" : "text-gray-400 hover:text-gray-600"}>
                      {p.active ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => openEdit(p)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 size={15} /></button>
                      <button onClick={() => handleDelete(p.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">{modal === "add" ? "New Promotion" : "Edit Promotion"}</h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Promotion Name *</label>
                <input value={f.name} onChange={(e) => setForm({ ...f, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="e.g. Eid Sale 10% Off" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                  <select value={f.type} onChange={(e) => setForm({ ...f, type: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {f.type === "bxgy" ? "Free Qty (Y)" : f.type.includes("percent") ? "Percent (%)" : "Amount (PKRs)"} *
                  </label>
                  <input type="number" min="0" step="0.01" value={f.value} onChange={(e) => setForm({ ...f, value: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" placeholder="0" />
                </div>
              </div>

              {f.type === "bxgy" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Buy Qty (X)</label>
                    <input type="number" min="1" value={f.buy_qty} onChange={(e) => setForm({ ...f, buy_qty: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 2" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Get Qty (Y)</label>
                    <input type="number" min="1" value={f.get_qty} onChange={(e) => setForm({ ...f, get_qty: e.target.value })}
                      className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 1" />
                  </div>
                </div>
              )}

              {(f.type === "threshold_percent" || f.type === "threshold_fixed") && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Order Amount (PKRs)</label>
                  <input type="number" min="0" step="0.01" value={f.min_order_amount} onChange={(e) => setForm({ ...f, min_order_amount: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g. 1000" />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Applies To</label>
                <select value={f.applies_to} onChange={(e) => setForm({ ...f, applies_to: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  {Object.entries(APPLIES_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {f.applies_to === "product" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                  <select value={f.product_id} onChange={(e) => setForm({ ...f, product_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">— Select product —</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}
              {f.applies_to === "category" && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                  <select value={f.category_id} onChange={(e) => setForm({ ...f, category_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value="">— Select category —</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" value={f.starts_at} onChange={(e) => setForm({ ...f, starts_at: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input type="date" value={f.ends_at} onChange={(e) => setForm({ ...f, ends_at: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving..." : modal === "add" ? "Create Promotion" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
