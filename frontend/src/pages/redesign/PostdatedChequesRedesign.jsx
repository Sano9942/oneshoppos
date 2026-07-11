import { useCallback, useEffect, useState } from "react";
import { Plus, Edit2, ArrowDown, CheckCircle, XCircle, AlertTriangle, Download } from "lucide-react";
import { Navigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtLocalDate, fmtLocalDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
} from "../../ui/primitives";

const STATUS_TONE = {
  pending: "warning",
  deposited: "info",
  cleared: "success",
  bounced: "danger",
  cancelled: "neutral",
};

const EMPTY_FORM = {
  cheque_number: "",
  type: "receivable",
  party_type: "customer",
  party_id: "",
  bank_name: "",
  amount: "",
  issue_date: "",
  maturity_date: "",
  notes: "",
};

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((d - now) / 86400000);
}

export default function PostdatedChequesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { fmt: money } = useCurrency();
  const [cheques, setCheques] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // Modal
  const [modal, setModal] = useState(null); // null | "create" | "edit"
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Confirm modal for status transitions
  const [confirm, setConfirm] = useState(null); // { action, cheque }
  const [confirming, setConfirming] = useState(false);

  // Pickers
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [pickerSearch, setPickerSearch] = useState("");

  const fetchCheques = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (typeFilter) params.set("type", typeFilter);
      const qs = params.toString();
      const data = await api.get(`/api/accounting/cheques${qs ? `?${qs}` : ""}`);
      setCheques(data.cheques || []);
    } catch (e) {
      setError(e.message || "Failed to load cheques");
      setCheques([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter]);

  const fetchUpcoming = useCallback(async () => {
    try {
      const data = await api.get("/api/accounting/cheques/upcoming");
      setUpcoming(data.cheques || []);
    } catch {
      setUpcoming([]);
    }
  }, []);

  useEffect(() => { fetchCheques(); }, [fetchCheques]);
  useEffect(() => { fetchUpcoming(); }, [fetchUpcoming]);

  // Load customers + suppliers once
  useEffect(() => {
    api.get("/api/customers?limit=500").then((d) => setCustomers(d.customers || d || [])).catch(() => {});
    api.get("/api/suppliers").then((d) => setSuppliers(d.suppliers || d || [])).catch(() => {});
  }, []);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setPickerSearch("");
    setModal("create");
  };

  const openEdit = (cheque) => {
    setForm({
      cheque_number: cheque.cheque_number,
      type: cheque.type,
      party_type: cheque.party_type,
      party_id: String(cheque.party_id),
      bank_name: cheque.bank_name || "",
      amount: cheque.amount,
      issue_date: cheque.issue_date?.slice(0, 10) || "",
      maturity_date: cheque.maturity_date?.slice(0, 10) || "",
      notes: cheque.notes || "",
    });
    setEditId(cheque.id);
    setPickerSearch("");
    setModal("edit");
  };

  const closeModal = () => { setModal(null); setEditId(null); setSaving(false); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        ...form,
        amount: Number(form.amount),
        party_id: Number(form.party_id) || null,
      };
      if (modal === "create") {
        await api.post("/api/accounting/cheques", body);
      } else {
        await api.put(`/api/accounting/cheques/${editId}`, body);
      }
      closeModal();
      fetchCheques();
      fetchUpcoming();
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
      await api.put(`/api/accounting/cheques/${confirm.cheque.id}/${confirm.action}`);
      setConfirm(null);
      fetchCheques();
      fetchUpcoming();
    } catch (e) {
      setError(e.message || `${confirm.action} failed`);
    } finally {
      setConfirming(false);
    }
  };

  const handleExport = () => {
    downloadCsv(
      ["Cheque #", "Type", "Party Type", "Party", "Bank", "Amount", "Issue Date", "Maturity Date", "Status", "Created"],
      filtered.map((c) => [
        c.cheque_number,
        c.type,
        c.party_type,
        c.party_name || "-",
        c.bank_name || "-",
        Number(c.amount),
        c.issue_date?.slice(0, 10) || "",
        c.maturity_date?.slice(0, 10) || "",
        c.status,
        fmtLocalDateTime(c.created_at),
      ]),
      "postdated-cheques.csv"
    );
  };

  const filtered = cheques.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.cheque_number?.toLowerCase().includes(q) ||
      c.party_name?.toLowerCase().includes(q) ||
      c.bank_name?.toLowerCase().includes(q)
    );
  });

  // Party picker filtered by search
  const partyType = form.party_type;
  const filteredParties =
    partyType === "customer"
      ? customers.filter(
          (c) =>
            !pickerSearch ||
            c.name?.toLowerCase().includes(pickerSearch.toLowerCase()) ||
            c.mobile?.includes(pickerSearch)
        )
      : suppliers.filter(
          (s) =>
            !pickerSearch ||
            s.name?.toLowerCase().includes(pickerSearch.toLowerCase()) ||
            s.contact_person?.toLowerCase().includes(pickerSearch.toLowerCase())
        );

  const actionLabel = { deposit: "Deposit", clear: "Clear", bounce: "Bounce", cancel: "Cancel" };

  // Inline self-guard (Business Modules): backend already 403s without
  // accounting_core; this stops the page rendering via deep link too.
  if (flagsLoading) return null;
  if (!flags.accounting_core) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Post-Dated Cheques"
      subtitle="Track receivable and payable post-dated cheques"
      right={
        <div className="flex gap-2">
          <Button size="sm" tone="plain" onClick={handleExport}>
            <Download className="w-4 h-4 mr-1" /> Export
          </Button>
          <Button size="sm" onClick={openCreate}>
            <Plus className="w-4 h-4 mr-1" /> New Cheque
          </Button>
        </div>
      }
    >
      {/* Upcoming Alert */}
      {upcoming.length > 0 && (
        <div className="mb-4 p-4 rounded-lg bg-(--ui-warning-bg)">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-5 h-5 text-(--ui-warning-fg)" />
            <h3 className="font-semibold text-(--ui-warning-fg)">
              Upcoming Cheques ({upcoming.length})
            </h3>
          </div>
          <p className="text-sm text-(--ui-warning-fg) mb-2">
            These cheques mature within the next 7 days
          </p>
          <div className="space-y-1">
            {upcoming.map((c) => {
              const days = daysUntil(c.maturity_date?.slice(0, 10));
              return (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-mono text-xs">{c.cheque_number}</span>
                    <span className="mx-2 text-(--ui-text-muted)">—</span>
                    {c.party_name}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-medium">{money(c.amount)}</span>
                    <Badge tone="warning">
                      {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days} days`}
                    </Badge>
                    <button
                      onClick={() => setConfirm({ action: "deposit", cheque: c })}
                      className="text-xs text-(--ui-link) hover:underline"
                    >
                      Deposit
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Search cheques..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-(--ui-border-strong) bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="deposited">Deposited</option>
          <option value="cleared">Cleared</option>
          <option value="bounced">Bounced</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-(--ui-border-strong) bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All Types</option>
          <option value="receivable">Receivable</option>
          <option value="payable">Payable</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-(--ui-danger-bg) text-(--ui-danger-fg) rounded-lg text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError("")}>dismiss</button>
        </div>
      )}

      <SectionCard>
        {loading ? (
          <p className="text-center py-8 text-(--ui-text-muted)">Loading...</p>
        ) : !filtered.length ? (
          <EmptyState
            title="No cheques found"
            body="Create your first post-dated cheque to get started."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="pb-2 font-medium">Cheque #</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Party</th>
                  <th className="pb-2 font-medium">Bank</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium">Maturity</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const days = c.status === "pending" ? daysUntil(c.maturity_date?.slice(0, 10)) : null;
                  return (
                    <tr key={c.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                      <td className="py-2.5 font-mono text-xs">{c.cheque_number}</td>
                      <td className="py-2.5 capitalize">{c.type}</td>
                      <td className="py-2.5">
                        <span>{c.party_name || "—"}</span>
                        <span className="text-xs text-(--ui-text-muted) ml-1">({c.party_type})</span>
                      </td>
                      <td className="py-2.5 text-(--ui-text-muted)">{c.bank_name || "—"}</td>
                      <td className="py-2.5 text-right font-medium">{money(c.amount)}</td>
                      <td className="py-2.5">
                        <span>{fmtLocalDate(c.maturity_date)}</span>
                        {days !== null && (
                          <span className={`ml-1 text-xs ${days < 0 ? "text-(--ui-danger-fg)" : days <= 3 ? "text-(--ui-warning-fg)" : "text-(--ui-text-muted)"}`}>
                            {days === 0 ? "(today)" : days < 0 ? `(${Math.abs(days)}d overdue)` : `(in ${days}d)`}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5">
                        <Badge tone={STATUS_TONE[c.status] || "neutral"}>{c.status}</Badge>
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="flex gap-1 justify-end">
                          {c.status === "pending" && (
                            <>
                              <button onClick={() => openEdit(c)} className="p-1 text-(--ui-text-muted) hover:text-(--ui-link)" title="Edit">
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirm({ action: "deposit", cheque: c })} className="p-1 text-(--ui-text-muted) hover:text-(--ui-link)" title="Deposit">
                                <ArrowDown className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirm({ action: "cancel", cheque: c })} className="p-1 text-(--ui-text-muted) hover:text-(--ui-danger-fg)" title="Cancel">
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {c.status === "deposited" && (
                            <>
                              <button onClick={() => setConfirm({ action: "clear", cheque: c })} className="p-1 text-(--ui-text-muted) hover:text-(--ui-success-fg)" title="Clear">
                                <CheckCircle className="w-4 h-4" />
                              </button>
                              <button onClick={() => setConfirm({ action: "bounce", cheque: c })} className="p-1 text-(--ui-text-muted) hover:text-(--ui-danger-fg)" title="Bounce">
                                <XCircle className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create / Edit Modal */}
      <Modal
        open={!!modal}
        onClose={saving ? undefined : closeModal}
        title={`${modal === "create" ? "New" : "Edit"} Post-Dated Cheque`}
        size="lg"
      >
        <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Cheque Number</label>
                <Input
                  value={form.cheque_number}
                  onChange={(e) => setForm({ ...form, cheque_number: e.target.value })}
                  placeholder="e.g., 000123"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => {
                      const t = e.target.value;
                      setForm({
                        ...form,
                        type: t,
                        party_type: t === "receivable" ? "customer" : "supplier",
                        party_id: "",
                      });
                    }}
                    disabled={modal === "edit"}
                    className="w-full rounded-md border border-(--ui-border-strong) bg-white px-3 py-2 text-sm"
                  >
                    <option value="receivable">Receivable</option>
                    <option value="payable">Payable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Party Type</label>
                  <select
                    value={form.party_type}
                    onChange={(e) => setForm({ ...form, party_type: e.target.value, party_id: "" })}
                    disabled={modal === "edit"}
                    className="w-full rounded-md border border-(--ui-border-strong) bg-white px-3 py-2 text-sm"
                  >
                    <option value="customer">Customer</option>
                    <option value="supplier">Supplier</option>
                  </select>
                </div>
              </div>

              {/* Party picker */}
              <div>
                <label className="block text-sm font-medium mb-1">
                  {partyType === "customer" ? "Customer" : "Supplier"}
                </label>
                <Input
                  placeholder={`Search ${partyType === "customer" ? "customers" : "suppliers"}...`}
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="mb-1"
                />
                <select
                  value={form.party_id}
                  onChange={(e) => setForm({ ...form, party_id: e.target.value })}
                  className="w-full rounded-md border border-(--ui-border-strong) bg-white px-3 py-2 text-sm"
                  size={4}
                >
                  <option value="">— Select —</option>
                  {filteredParties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.mobile ? `(${p.mobile})` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Bank Name</label>
                <Input
                  value={form.bank_name}
                  onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                  placeholder="e.g., HBL, MCB, Meezan"
                />
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

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Issue Date</label>
                  <Input
                    type="date"
                    value={form.issue_date}
                    onChange={(e) => setForm({ ...form, issue_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Maturity Date</label>
                  <Input
                    type="date"
                    value={form.maturity_date}
                    onChange={(e) => setForm({ ...form, maturity_date: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes (optional)</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-(--ui-border-strong) bg-white px-3 py-2 text-sm resize-none"
                />
              </div>
        </div>
        <ModalFooter>
          <Button onClick={closeModal} disabled={saving}>Cancel</Button>
          <Button
            tone="primary"
            onClick={handleSave}
            disabled={saving || !form.cheque_number || !form.party_id || !form.amount || !form.issue_date || !form.maturity_date}
          >
            {saving ? "Saving..." : modal === "create" ? "Create" : "Save"}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Confirm Modal (Deposit / Clear / Bounce / Cancel) */}
      <Modal
        open={!!confirm}
        onClose={confirming ? undefined : () => setConfirm(null)}
        title={confirm ? `${actionLabel[confirm.action]} Cheque` : ""}
        size="sm"
      >
        {confirm ? (
          <>
            <p className="text-sm text-(--ui-text-muted) mb-1">
              {confirm.cheque.cheque_number} — {money(confirm.cheque.amount)}
            </p>
            {confirm.action === "clear" && (
              <p className="text-xs text-(--ui-text-muted) mb-4">
                This will adjust the {confirm.cheque.party_type === "customer" ? "customer" : "supplier"} balance.
              </p>
            )}
            {confirm.action === "bounce" && (
              <p className="text-xs text-(--ui-warning-fg) mb-4">
                The cheque will be marked as bounced. No balance changes.
              </p>
            )}
            {confirm.action === "cancel" && (
              <p className="text-xs text-(--ui-text-muted) mb-4">
                This cheque will be permanently cancelled.
              </p>
            )}
            <ModalFooter>
              <Button onClick={() => setConfirm(null)} disabled={confirming}>Back</Button>
              <Button
                tone={confirm.action === "bounce" || confirm.action === "cancel" ? "danger" : "primary"}
                onClick={handleConfirmAction}
                disabled={confirming}
              >
                {confirming ? "Processing..." : actionLabel[confirm.action]}
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
