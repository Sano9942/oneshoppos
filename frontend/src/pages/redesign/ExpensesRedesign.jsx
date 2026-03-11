import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Tag, Trash2, X } from "lucide-react";
import { API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";

const EMPTY_FORM = {
  category_id: "",
  outlet_id: "",
  employee_id: "",
  amount: "",
  description: "",
  reference: "",
  expense_date: "",
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth() {
  return `${today().slice(0, 7)}-01`;
}

export default function ExpensesRedesign() {
  const { authHeaders } = useAuth();
  const { fmt: money } = useCurrency();

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState([]);
  const [grandTotal, setGrandTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [activeTab, setActiveTab] = useState("expenses");
  const [filterFrom, setFilterFrom] = useState(firstOfMonth());
  const [filterTo, setFilterTo] = useState(today());
  const [filterCat, setFilterCat] = useState("");
  const [filterOutlet, setFilterOutlet] = useState("");

  const [modal, setModal] = useState(null); // null | "add" | expense object
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");

  const [catPanelOpen, setCatPanelOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [catSaving, setCatSaving] = useState(false);

  const loadDropdowns = useCallback(async () => {
    try {
      const [catRes, outRes, empRes] = await Promise.all([
        fetch(`${API}/expense-categories`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/outlets`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/employees`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setCategories(catRes.categories || []);
      setOutlets(outRes.outlets || []);
      setEmployees(empRes.employees || []);
    } catch {
      // Non-blocking for page use.
    }
  }, [authHeaders]);

  const loadRowsAndSummary = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);
      if (filterCat) params.set("category_id", filterCat);
      if (filterOutlet) params.set("outlet_id", filterOutlet);

      const [expRes, sumRes] = await Promise.all([
        fetch(`${API}/expenses?${params.toString()}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/expenses/summary?${params.toString()}`, { headers: authHeaders() }).then((r) =>
          r.json(),
        ),
      ]);
      setRows(expRes.expenses || []);
      setSummary(sumRes.summary || []);
      setGrandTotal(Number(sumRes.grand_total || 0));
    } catch {
      setRows([]);
      setSummary([]);
      setGrandTotal(0);
      setError("Failed to load expenses.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, filterFrom, filterTo, filterCat, filterOutlet]);

  useEffect(() => {
    loadDropdowns();
  }, [loadDropdowns]);

  useEffect(() => {
    loadRowsAndSummary();
  }, [loadRowsAndSummary]);

  const filteredTotal = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
    [rows],
  );

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, expense_date: today() });
    setFormError("");
    setModal("add");
  };

  const openEdit = (row) => {
    setForm({
      category_id: row.category_id || "",
      outlet_id: row.outlet_id || "",
      employee_id: row.employee_id || "",
      amount: String(row.amount ?? ""),
      description: row.description || "",
      reference: row.reference || "",
      expense_date: row.expense_date || today(),
    });
    setFormError("");
    setModal(row);
  };

  const closeModal = () => {
    setModal(null);
    setForm(EMPTY_FORM);
    setFormError("");
  };

  const saveExpense = async (e) => {
    e.preventDefault();
    setFormError("");
    setError("");
    setNotice("");

    if (!form.amount || Number(form.amount) <= 0) {
      setFormError("Amount must be greater than zero.");
      return;
    }

    setSaving(true);
    try {
      const isEdit = modal && modal !== "add";
      const url = isEdit ? `${API}/expenses/${modal.id}` : `${API}/expenses`;
      const method = isEdit ? "PUT" : "POST";
      const payload = {
        category_id: form.category_id || null,
        outlet_id: form.outlet_id || null,
        employee_id: form.employee_id || null,
        amount: Number(form.amount),
        description: form.description || null,
        reference: form.reference || null,
        expense_date: form.expense_date || today(),
      };

      const res = await fetch(url, {
        method,
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Save failed.");
        return;
      }

      setNotice(isEdit ? "Expense updated." : "Expense created.");
      closeModal();
      await loadRowsAndSummary();
    } catch {
      setFormError("Connection failed.");
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (id) => {
    if (!window.confirm("Delete this expense?")) return;
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/expenses/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setNotice("Expense deleted.");
      await loadRowsAndSummary();
    } catch (e) {
      setError(e.message || "Delete failed.");
    }
  };

  const addCategory = async (e) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    setCatSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/expense-categories`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Category create failed");
      setNewCategoryName("");
      await loadDropdowns();
      setNotice("Category created.");
    } catch (e2) {
      setError(e2.message || "Category create failed.");
    } finally {
      setCatSaving(false);
    }
  };

  const deleteCategory = async (id) => {
    if (!window.confirm("Delete this category? Expenses using it become uncategorized.")) return;
    setError("");
    try {
      const res = await fetch(`${API}/expense-categories/${id}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Category delete failed");
      await loadDropdowns();
      await loadRowsAndSummary();
      setNotice("Category deleted.");
    } catch (e) {
      setError(e.message || "Category delete failed.");
    }
  };

  return (
    <PageShell
      title="Expenses"
      subtitle="operating expense tracking with filterable list, category summary, and maintenance tools."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => setCatPanelOpen(true)}>
            <Tag size={13} className="mr-1 inline" />
            Categories
          </Button>
          <Button onClick={loadRowsAndSummary}>
            <RefreshCw size={13} className="mr-1 inline" />
            Refresh
          </Button>
          <Button tone="primary" onClick={openAdd}>
            <Plus size={13} className="mr-1 inline" />
            Add Expense
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

      <SectionCard className="mb-3">
        <TableToolbar
          left={
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">From</label>
                <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">To</label>
                <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Category</label>
                <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Outlet</label>
                <Select value={filterOutlet} onChange={(e) => setFilterOutlet(e.target.value)}>
                  <option value="">All Outlets</option>
                  {outlets.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          }
          right={
            <div className="inline-flex gap-2">
              <Button
                tone={activeTab === "expenses" ? "primary" : "default"}
                onClick={() => setActiveTab("expenses")}
              >
                Expense List
              </Button>
              <Button
                tone={activeTab === "summary" ? "primary" : "default"}
                onClick={() => setActiveTab("summary")}
              >
                Summary
              </Button>
            </div>
          }
        />
      </SectionCard>

      {loading ? (
        <SectionCard className="p-8 text-center text-sm text-(--ui-text-muted)">Loading...</SectionCard>
      ) : null}

      {!loading && activeTab === "expenses" ? (
        <SectionCard>
          <TableToolbar
            left={<span className="text-sm text-(--ui-text-muted)">{rows.length} records</span>}
            right={
              <span className="text-sm font-semibold text-(--ui-text)">
                Filtered Total: {money(filteredTotal)}
              </span>
            }
          />
          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-left">Outlet</th>
                  <th className="px-3 py-2 text-left">Employee</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.expense_date}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{row.category_name || "Uncategorized"}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{row.description || "-"}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.outlet_name || "-"}</td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{row.employee_name || "-"}</td>
                    <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">
                      {money(row.amount)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button size="sm" tone="danger" onClick={() => deleteExpense(row.id)}>
                          <Trash2 size={12} className="mr-1 inline" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {rows.length ? (
                <tfoot>
                  <tr className="border-t border-(--ui-border) bg-(--ui-muted-surface)">
                    <td colSpan={5} className="px-3 py-2 text-right text-sm font-semibold text-(--ui-text)">
                      Total Expenses
                    </td>
                    <td className="px-3 py-2 text-right text-sm font-semibold text-(--ui-text)">
                      {money(filteredTotal)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          {!rows.length ? (
            <EmptyState title="No expenses found" body="Adjust filters or add a new expense." />
          ) : null}
        </SectionCard>
      ) : null}

      {!loading && activeTab === "summary" ? (
        <SectionCard>
          <TableToolbar
            left={<span className="text-sm font-medium text-(--ui-text)">Expenses by Category</span>}
            right={
              <span className="text-sm font-semibold text-(--ui-text)">
                Grand Total: {money(grandTotal)}
              </span>
            }
          />
          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-right">Transactions</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((row, idx) => (
                  <tr key={`${row.category || "uncategorized"}-${idx}`} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">
                      {row.category || "Uncategorized"}
                    </td>
                    <td className="px-3 py-2 text-right text-(--ui-text-muted)">{row.count}</td>
                    <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">
                      {money(row.total)}
                    </td>
                    <td className="px-3 py-2 text-right text-(--ui-text-muted)">
                      {grandTotal > 0 ? `${((Number(row.total || 0) / grandTotal) * 100).toFixed(1)}%` : "0.0%"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!summary.length ? (
            <EmptyState title="No summary data" body="No expenses exist for the selected filters." />
          ) : null}
        </SectionCard>
      ) : null}

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">
                {modal === "add" ? "Add Expense" : "Edit Expense"}
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
            <form className="space-y-3" onSubmit={saveExpense}>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Amount</label>
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Date</label>
                  <Input
                    type="date"
                    value={form.expense_date}
                    onChange={(e) => setForm((prev) => ({ ...prev, expense_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Category</label>
                <Select
                  value={form.category_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, category_id: e.target.value }))}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Description</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="What was this expense for?"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Reference</label>
                <Input
                  value={form.reference}
                  onChange={(e) => setForm((prev) => ({ ...prev, reference: e.target.value }))}
                  placeholder="Optional invoice or receipt number"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Outlet</label>
                  <Select
                    value={form.outlet_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, outlet_id: e.target.value }))}
                  >
                    <option value="">None</option>
                    {outlets.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Employee</label>
                  <Select
                    value={form.employee_id}
                    onChange={(e) => setForm((prev) => ({ ...prev, employee_id: e.target.value }))}
                  >
                    <option value="">None</option>
                    {employees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" onClick={closeModal}>
                  Cancel
                </Button>
                <Button tone="primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : modal === "add" ? "Add Expense" : "Save Changes"}
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}

      {catPanelOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">Expense Categories</h3>
              <button
                className="text-(--ui-text-muted) hover:text-(--ui-text)"
                onClick={() => setCatPanelOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <form className="mb-3 flex gap-2" onSubmit={addCategory}>
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
              />
              <Button tone="primary" type="submit" disabled={catSaving || !newCategoryName.trim()}>
                {catSaving ? "Adding..." : "Add"}
              </Button>
            </form>
            <div className="max-h-64 overflow-auto rounded border border-(--ui-border)">
              {!categories.length ? (
                <p className="p-4 text-center text-sm text-(--ui-text-muted)">No categories yet.</p>
              ) : (
                <table className="min-w-full text-sm">
                  <tbody>
                    {categories.map((c) => (
                      <tr key={c.id} className="border-t border-(--ui-border) first:border-t-0">
                        <td className="px-3 py-2 text-(--ui-text)">{c.name}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" tone="danger" onClick={() => deleteCategory(c.id)}>
                            <Trash2 size={12} className="mr-1 inline" />
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
