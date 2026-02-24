import { useState, useEffect, useCallback } from "react";
import { Receipt, Plus, Edit2, Trash2, X, RefreshCw, Tag, Filter } from "lucide-react";

const API = "http://localhost:5000/api";

const EMPTY = {
  category_id: "", outlet_id: "", employee_id: "",
  amount: "", description: "", reference: "", expense_date: "",
};

function fmt(n) { return "PKRs " + (n || 0).toFixed(2); }
function today() { return new Date().toISOString().slice(0, 10); }

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [filterFrom, setFilterFrom] = useState(today().slice(0, 7) + "-01"); // first of month
  const [filterTo, setFilterTo] = useState(today());
  const [filterCat, setFilterCat] = useState("");
  const [filterOutlet, setFilterOutlet] = useState("");

  // Summary
  const [summary, setSummary] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);

  // Modals
  const [modal, setModal] = useState(null); // null | 'add' | expense obj
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Category management panel
  const [catPanel, setCatPanel] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  const [activeTab, setActiveTab] = useState("expenses"); // 'expenses' | 'summary'

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);
      if (filterCat) params.set("category_id", filterCat);
      if (filterOutlet) params.set("outlet_id", filterOutlet);

      const [expRes, sumRes] = await Promise.all([
        fetch(`${API}/expenses?${params}`).then((r) => r.json()),
        fetch(`${API}/expenses/summary?${params}`).then((r) => r.json()),
      ]);
      setExpenses(expRes.expenses || []);
      setSummary(sumRes.summary || []);
      setGrandTotal(sumRes.grand_total || 0);
    } catch { setExpenses([]); }
    finally { setLoading(false); }
  }, [filterFrom, filterTo, filterCat, filterOutlet]);

  const fetchDropdowns = useCallback(async () => {
    try {
      const [catRes, outRes, empRes] = await Promise.all([
        fetch(`${API}/expense-categories`).then((r) => r.json()),
        fetch(`${API}/outlets`).then((r) => r.json()),
        fetch(`${API}/employees`).then((r) => r.json()),
      ]);
      setCategories(catRes.categories || []);
      setOutlets(outRes.outlets || []);
      setEmployees(empRes.employees || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchDropdowns(); }, [fetchDropdowns]);
  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAdd = () => {
    setForm({ ...EMPTY, expense_date: today() });
    setFormError(""); setModal("add");
  };
  const openEdit = (e) => {
    setForm({
      category_id: e.category_id || "", outlet_id: e.outlet_id || "",
      employee_id: e.employee_id || "", amount: e.amount,
      description: e.description || "", reference: e.reference || "",
      expense_date: e.expense_date || today(),
    });
    setFormError(""); setModal(e);
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setFormError("");
    if (!form.amount || parseFloat(form.amount) <= 0) { setFormError("Amount must be greater than zero"); return; }
    setSaving(true);
    try {
      const isEdit = modal && modal !== "add";
      const url = isEdit ? `${API}/expenses/${modal.id}` : `${API}/expenses`;
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setFormError(data.error || "Save failed"); return; }
      setModal(null); fetchAll();
    } catch { setFormError("Connection failed"); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this expense?")) return;
    await fetch(`${API}/expenses/${id}`, { method: "DELETE" });
    fetchAll();
  };

  const handleAddCategory = async (ev) => {
    ev.preventDefault();
    if (!newCatName.trim()) return;
    setCatSaving(true);
    try {
      await fetch(`${API}/expense-categories`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      setNewCatName("");
      fetchDropdowns();
    } catch { /* ignore */ }
    finally { setCatSaving(false); }
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm("Delete this category? Expenses using it will become uncategorized.")) return;
    await fetch(`${API}/expense-categories/${id}`, { method: "DELETE" });
    fetchDropdowns();
  };

  const f = form;
  const totalFiltered = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-1">Track operating costs linked to outlets, shifts, and employees</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setCatPanel(true)} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
            <Tag size={14} /> Categories
          </button>
          <button onClick={fetchAll} className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus size={16} /> Add Expense
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border rounded-xl p-4 flex flex-wrap items-end gap-4">
        <Filter size={16} className="text-gray-400 mt-auto mb-2" />
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Category</label>
          <select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Outlet</label>
          <select value={filterOutlet} onChange={(e) => setFilterOutlet(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm">
            <option value="">All Outlets</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {[["expenses", "Expense List"], ["summary", "Summary by Category"]].map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Expense List Tab */}
      {activeTab === "expenses" && (
        <>
          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading...</div>
          ) : (
            <div className="bg-white border rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <span className="text-sm text-gray-600">{expenses.length} records</span>
                <span className="text-sm font-semibold text-red-700">Total: {fmt(totalFiltered)}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Description</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Outlet</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Employee</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {expenses.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">
                      <Receipt size={36} className="mx-auto mb-2 opacity-30" />
                      No expenses found for this period.
                    </td></tr>
                  ) : expenses.map((e) => (
                    <tr key={e.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{e.expense_date}</td>
                      <td className="px-4 py-3">
                        <span className="bg-orange-50 text-orange-700 text-xs px-2 py-0.5 rounded">
                          {e.category_name || "Uncategorized"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{e.description || "—"}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{e.outlet_name || "—"}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{e.employee_name || "—"}</td>
                      <td className="px-4 py-3 text-right font-bold text-red-700">{fmt(e.amount)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => openEdit(e)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 size={15} /></button>
                          <button onClick={() => handleDelete(e.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {expenses.length > 0 && (
                  <tfoot className="bg-gray-50 border-t">
                    <tr>
                      <td colSpan={5} className="px-4 py-3 text-sm font-semibold text-gray-700 text-right">Total Expenses:</td>
                      <td className="px-4 py-3 text-right font-bold text-red-700 text-base">{fmt(totalFiltered)}</td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </>
      )}

      {/* Summary Tab */}
      {activeTab === "summary" && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700">Expenses by Category</span>
            <span className="text-sm font-bold text-red-700">Grand Total: {fmt(grandTotal)}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Transactions</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Total</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">% of Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {summary.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">No expenses in this period.</td></tr>
              ) : summary.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-800">{row.category || "Uncategorized"}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{row.count}</td>
                  <td className="px-4 py-3 text-right font-bold text-red-700">{fmt(row.total)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {grandTotal > 0 ? ((row.total / grandTotal) * 100).toFixed(1) + "%" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Expense Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">{modal === "add" ? "Add Expense" : "Edit Expense"}</h2>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            {formError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formError}</p>}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount (PKRs) *</label>
                  <input type="number" min="0.01" step="0.01" value={f.amount}
                    onChange={(e) => setForm({ ...f, amount: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="0.00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                  <input type="date" value={f.expense_date}
                    onChange={(e) => setForm({ ...f, expense_date: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select value={f.category_id} onChange={(e) => setForm({ ...f, category_id: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="">— Uncategorized —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <input value={f.description} onChange={(e) => setForm({ ...f, description: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="What was this expense for?" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference / Receipt #</label>
                <input value={f.reference} onChange={(e) => setForm({ ...f, reference: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Optional invoice/receipt number" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Outlet</label>
                  <select value={f.outlet_id} onChange={(e) => setForm({ ...f, outlet_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">— None —</option>
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
                  <select value={f.employee_id} onChange={(e) => setForm({ ...f, employee_id: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2 text-sm">
                    <option value="">— None —</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" onClick={() => setModal(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? "Saving..." : modal === "add" ? "Add Expense" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category Management Panel */}
      {catPanel && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 max-h-[80vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold flex items-center gap-2"><Tag size={16} /> Expense Categories</h2>
              <button onClick={() => setCatPanel(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <form onSubmit={handleAddCategory} className="flex gap-2">
              <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="New category name…" />
              <button type="submit" disabled={catSaving || !newCatName.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                <Plus size={14} />
              </button>
            </form>
            <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
              {categories.length === 0 ? (
                <div className="px-3 py-6 text-center text-gray-400 text-sm">No categories yet</div>
              ) : categories.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-3 py-2.5">
                  <span className="text-sm font-medium text-gray-800">{c.name}</span>
                  <button onClick={() => handleDeleteCategory(c.id)}
                    className="text-gray-300 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
