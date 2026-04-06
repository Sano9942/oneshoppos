import { useCallback, useEffect, useState } from "react";
import { Plus, CheckCircle, XCircle, Edit2, Download } from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtLocalDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

const TABS = [
  { key: "credit", label: "Credit Notes", prefix: "credit-notes" },
  { key: "debit", label: "Debit Notes", prefix: "debit-notes" },
];

const STATUS_TONE = {
  draft: "neutral",
  approved: "success",
  applied: "info",
  cancelled: "danger",
};

const EMPTY_FORM = {
  type: "sales",
  customer_id: "",
  supplier_id: "",
  amount: "",
  reason: "",
  reference_type: "",
  reference_id: "",
  notes: "",
};

export default function CreditDebitNotesRedesign() {
  const { fmt: money } = useCurrency();
  const [tab, setTab] = useState("credit");
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Modal
  const [modal, setModal] = useState(null); // null | "create" | "edit"
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Confirm modal for approve/cancel
  const [confirm, setConfirm] = useState(null); // { action, note }
  const [confirming, setConfirming] = useState(false);

  // Pickers
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [pickerSearch, setPickerSearch] = useState("");

  const activeTab = TABS.find((t) => t.key === tab);

  const fetchNotes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const qs = params.toString();
      const data = await api.get(
        `/api/accounting/${activeTab.prefix}${qs ? `?${qs}` : ""}`
      );
      setNotes(data.notes || []);
    } catch (e) {
      setError(e.message || "Failed to load notes");
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab.prefix, statusFilter]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  // Load customers + suppliers once
  useEffect(() => {
    api
      .get("/api/customers?limit=500")
      .then((d) => setCustomers(d.customers || d || []))
      .catch(() => {});
    api
      .get("/api/suppliers")
      .then((d) => setSuppliers(d.suppliers || d || []))
      .catch(() => {});
  }, []);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setPickerSearch("");
    setModal("create");
  };

  const openEdit = (note) => {
    setForm({
      type: note.type,
      customer_id: note.customer_id || "",
      supplier_id: note.supplier_id || "",
      amount: note.amount,
      reason: note.reason,
      reference_type: note.reference_type || "",
      reference_id: note.reference_id || "",
      notes: note.notes || "",
    });
    setEditId(note.id);
    setPickerSearch("");
    setModal("edit");
  };

  const closeModal = () => {
    setModal(null);
    setEditId(null);
    setSaving(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        ...form,
        amount: Number(form.amount),
        customer_id: form.type === "sales" ? Number(form.customer_id) || null : null,
        supplier_id: form.type === "purchase" ? Number(form.supplier_id) || null : null,
        reference_id: form.reference_id ? Number(form.reference_id) : null,
      };
      if (modal === "create") {
        await api.post(`/api/accounting/${activeTab.prefix}`, body);
      } else {
        await api.put(`/api/accounting/${activeTab.prefix}/${editId}`, body);
      }
      closeModal();
      fetchNotes();
    } catch (e) {
      setError(e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!confirm) return;
    setConfirming(true);
    try {
      await api.put(
        `/api/accounting/${activeTab.prefix}/${confirm.note.id}/${confirm.action}`
      );
      setConfirm(null);
      fetchNotes();
    } catch (e) {
      setError(e.message || `${confirm.action} failed`);
    } finally {
      setConfirming(false);
    }
  };

  const handleExport = () => {
    const label = activeTab.label;
    downloadCsv(
      ["Note #", "Type", "Customer/Supplier", "Amount", "Reason", "Status", "Created"],
      filtered.map((n) => [
        n.note_number,
        n.type,
        n.customer_name || n.supplier_name || "-",
        Number(n.amount),
        n.reason,
        n.status,
        fmtLocalDateTime(n.created_at),
      ]),
      `${label.replace(/\s/g, "-").toLowerCase()}.csv`
    );
  };

  const filtered = notes.filter((n) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      n.note_number?.toLowerCase().includes(q) ||
      n.reason?.toLowerCase().includes(q) ||
      n.customer_name?.toLowerCase().includes(q) ||
      n.supplier_name?.toLowerCase().includes(q)
    );
  });

  // Picker lists filtered by search
  const filteredCustomers = customers.filter(
    (c) =>
      !pickerSearch ||
      c.name?.toLowerCase().includes(pickerSearch.toLowerCase()) ||
      c.mobile?.includes(pickerSearch)
  );
  const filteredSuppliers = suppliers.filter(
    (s) =>
      !pickerSearch ||
      s.name?.toLowerCase().includes(pickerSearch.toLowerCase()) ||
      s.contact_person?.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  return (
    <PageShell
      title="Credit & Debit Notes"
      subtitle="Manage purchase and sales adjustments"
      right={
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> New Note
          </Button>
        </div>
      }
    >
      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch(""); setStatusFilter(""); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Search notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="applied">Applied</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError("")}>dismiss</button>
        </div>
      )}

      <SectionCard>
        {loading ? (
          <p className="text-center py-8 text-gray-500">Loading…</p>
        ) : !filtered.length ? (
          <EmptyState
            title={`No ${activeTab.label.toLowerCase()}`}
            description="Create your first note to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 font-medium">Note #</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Customer / Supplier</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium">Reason</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Created</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => (
                  <tr key={n.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="py-2.5 font-mono text-xs">{n.note_number}</td>
                    <td className="py-2.5 capitalize">{n.type}</td>
                    <td className="py-2.5">{n.customer_name || n.supplier_name || "—"}</td>
                    <td className="py-2.5 text-right font-medium">{money(n.amount)}</td>
                    <td className="py-2.5 max-w-48 truncate">{n.reason}</td>
                    <td className="py-2.5">
                      <Badge tone={STATUS_TONE[n.status] || "neutral"}>{n.status}</Badge>
                    </td>
                    <td className="py-2.5 text-gray-500 text-xs">{fmtLocalDateTime(n.created_at)}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex gap-1 justify-end">
                        {n.status === "draft" && (
                          <>
                            <button
                              onClick={() => openEdit(n)}
                              className="p-1 text-gray-500 hover:text-blue-600"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setConfirm({ action: "approve", note: n })}
                              className="p-1 text-gray-500 hover:text-green-600"
                              title="Approve"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                          </>
                        )}
                        {n.status !== "cancelled" && (
                          <button
                            onClick={() => setConfirm({ action: "cancel", note: n })}
                            className="p-1 text-gray-500 hover:text-red-600"
                            title="Cancel"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <h2 className="text-lg font-semibold mb-4">
              {modal === "create" ? "New" : "Edit"} {activeTab.label.replace(/s$/, "")}
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value, customer_id: "", supplier_id: "" })}
                  disabled={modal === "edit"}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                >
                  <option value="sales">Sales</option>
                  <option value="purchase">Purchase</option>
                </select>
              </div>

              {/* Counterparty picker */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  {form.type === "sales" ? "Customer" : "Supplier"}
                </label>
                <Input
                  placeholder={`Search ${form.type === "sales" ? "customers" : "suppliers"}…`}
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="mb-1"
                />
                <select
                  value={form.type === "sales" ? form.customer_id : form.supplier_id}
                  onChange={(e) =>
                    form.type === "sales"
                      ? setForm({ ...form, customer_id: e.target.value })
                      : setForm({ ...form, supplier_id: e.target.value })
                  }
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
                  size={5}
                >
                  <option value="">— Select —</option>
                  {form.type === "sales"
                    ? filteredCustomers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} {c.mobile ? `(${c.mobile})` : ""}
                        </option>
                      ))
                    : filteredSuppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Amount</label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Reason</label>
                <Input
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder="e.g., Goods returned, overcharge adjustment"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Reference (optional)</label>
                <div className="flex gap-2">
                  <Input
                    value={form.reference_type}
                    onChange={(e) => setForm({ ...form, reference_type: e.target.value })}
                    placeholder="Type (e.g., invoice, PO)"
                    className="flex-1"
                  />
                  <Input
                    value={form.reference_id}
                    onChange={(e) => setForm({ ...form, reference_id: e.target.value })}
                    placeholder="ID"
                    className="w-24"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm resize-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <Button variant="ghost" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving || !form.amount || !form.reason}>
                {saving ? "Saving…" : modal === "create" ? "Create" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal (Approve / Cancel) */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 text-center">
            <h3 className="text-lg font-semibold mb-2 capitalize">{confirm.action} Note</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              {confirm.note.note_number} — {money(confirm.note.amount)}
            </p>
            {confirm.action === "approve" && (
              <p className="text-xs text-gray-500 mb-4">
                This will adjust the {confirm.note.type === "sales" ? "customer" : "supplier"} balance.
              </p>
            )}
            {confirm.action === "cancel" && confirm.note.status === "approved" && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mb-4">
                This will reverse the balance adjustment.
              </p>
            )}
            <div className="flex justify-center gap-2 mt-4">
              <Button variant="ghost" onClick={() => setConfirm(null)}>Back</Button>
              <Button
                onClick={handleConfirmAction}
                disabled={confirming}
                className={confirm.action === "cancel" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
              >
                {confirming ? "Processing…" : confirm.action === "approve" ? "Approve" : "Cancel Note"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
