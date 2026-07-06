import { useState, useEffect, useCallback, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState } from "../../ui/primitives";
import { Plus, ArrowLeft, X, FileText, Clock, User, Wrench } from "lucide-react";
import { api } from "../../api";

const STATUS_TONES = {
  intake: "default", approved: "warning", in_progress: "success",
  on_hold: "warning", completed: "success", invoiced: "success", cancelled: "danger",
};

const STATUS_LABELS = {
  intake: "Intake", approved: "Approved", in_progress: "In Progress",
  on_hold: "On Hold", completed: "Completed", invoiced: "Invoiced", cancelled: "Cancelled",
};

const STATUSES = Object.keys(STATUS_LABELS);

// Which action buttons to show for each status
const STATUS_ACTIONS = {
  intake:      [{ label: "Approve", status: "approved", tone: "primary" }],
  approved:    [{ label: "Start Work", status: "in_progress", tone: "primary" }],
  in_progress: [
    { label: "Complete", status: "completed", tone: "primary" },
    { label: "On Hold", status: "on_hold", tone: "default" },
  ],
  on_hold:     [{ label: "Resume", status: "in_progress", tone: "primary" }],
  completed:   [], // "Generate Invoice" handled separately
  invoiced:    [],
  cancelled:   [],
};

const DEPOSIT_METHODS = ["cash", "card", "bank_transfer"];

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* ── Create Ticket Modal ─────────────────────────────────────────── */

function CreateTicketModal({ customers, employees, onClose, onCreated }) {
  const toast = useToast();
  const { fmt } = useCurrency();
  const [form, setForm] = useState({
    title: "", description: "", customer_id: "", outlet_id: "",
    assigned_to: "", expected_completion: "", deposit_amount: "",
    deposit_method: "cash", notes: "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    try {
      const body = {
        title: form.title,
        description: form.description || undefined,
        customer_id: form.customer_id ? Number(form.customer_id) : undefined,
        outlet_id: form.outlet_id ? Number(form.outlet_id) : undefined,
        assigned_to: form.assigned_to ? Number(form.assigned_to) : undefined,
        expected_completion: form.expected_completion || undefined,
        deposit_amount: form.deposit_amount ? Number(form.deposit_amount) : undefined,
        deposit_method: form.deposit_amount ? form.deposit_method : undefined,
        notes: form.notes || undefined,
      };
      await api.post("/api/service-tickets", body);
      toast.success("Ticket created");
      onCreated();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-(--ui-text)">New Service Ticket</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Title *</label>
            <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. iPhone screen repair" />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Description</label>
            <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)" rows={3} value={form.description} onChange={e => set("description", e.target.value)} placeholder="Details about the job..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Customer</label>
              <Select value={form.customer_id} onChange={e => set("customer_id", e.target.value)}>
                <option value="">-- Select --</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Assigned To</label>
              <Select value={form.assigned_to} onChange={e => set("assigned_to", e.target.value)}>
                <option value="">-- Select --</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Expected Completion</label>
            <Input type="date" value={form.expected_completion} onChange={e => set("expected_completion", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Deposit Amount</label>
              <Input type="number" min="0" step="0.01" value={form.deposit_amount} onChange={e => set("deposit_amount", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Deposit Method</label>
              <Select value={form.deposit_method} onChange={e => set("deposit_method", e.target.value)}>
                {DEPOSIT_METHODS.map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
              </Select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Notes</label>
            <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)" rows={2} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Internal notes..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button tone="default" onClick={onClose}>Cancel</Button>
            <Button tone="primary" disabled={saving} onClick={submit}>{saving ? "Creating..." : "Create Ticket"}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Ticket Detail View ──────────────────────────────────────────── */

function TicketDetail({ ticketId, onBack, onRefresh }) {
  const toast = useToast();
  const { fmt } = useCurrency();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [paymentEnabled, setPaymentEnabled] = useState(false);
  const [depositAmt, setDepositAmt] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/service-tickets/${ticketId}`);
      setTicket(data);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  // Gateway deposit button only shows when an online gateway is configured.
  useEffect(() => {
    let alive = true;
    api.get("/api/billing/status")
      .then((s) => { if (alive) setPaymentEnabled(!!s?.payment_enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const takeGatewayDeposit = async () => {
    const amt = Number(depositAmt);
    if (!amt || amt <= 0) { toast.error("Enter a deposit amount"); return; }
    try {
      const res = await api.post(`/api/service-tickets/${ticketId}/deposit/checkout`, { amount: amt });
      if (res?.checkout_url) window.open(res.checkout_url, "_blank", "noopener");
      toast.success("Deposit checkout opened — updates after payment");
      setDepositAmt("");
      load();
      onRefresh();
    } catch (err) { toast.error(err.message); }
  };

  const changeStatus = async (newStatus) => {
    setSubmitting(true);
    try {
      await api.put(`/api/service-tickets/${ticketId}`, { status: newStatus });
      toast.success(`Status changed to ${STATUS_LABELS[newStatus]}`);
      load();
      onRefresh();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const generateInvoice = async () => {
    setSubmitting(true);
    try {
      const result = await api.post(`/api/service-tickets/${ticketId}/generate-invoice`);
      toast.success(`Invoice ${result.invoice.invoice_number} generated`);
      load();
      onRefresh();
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  const addNote = async () => {
    if (!noteText.trim()) return;
    try {
      await api.post(`/api/service-tickets/${ticketId}/notes`, { description: noteText });
      setNoteText("");
      toast.success("Note added");
      load();
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-(--ui-text-muted)">Loading...</div>;
  if (!ticket) return <EmptyState title="Ticket not found" />;

  const actions = STATUS_ACTIONS[ticket.status] || [];
  const canCancel = !["invoiced", "cancelled"].includes(ticket.status);
  const canGenerateInvoice = ticket.status === "completed";

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-(--ui-text-muted) hover:text-(--ui-text) mb-2">
        <ArrowLeft className="w-4 h-4" /> Back to list
      </button>

      {/* Header */}
      <SectionCard>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-(--ui-text)">{ticket.ticket_number}</h2>
              <Badge tone={STATUS_TONES[ticket.status]}>{STATUS_LABELS[ticket.status]}</Badge>
            </div>
            <h3 className="text-lg text-(--ui-text)">{ticket.title}</h3>
            {ticket.customer_name && <p className="text-sm text-(--ui-text-muted) mt-1"><User className="w-3.5 h-3.5 inline mr-1" />{ticket.customer_name}</p>}
          </div>
          <div className="flex gap-2 flex-wrap">
            {actions.map(a => (
              <Button key={a.status} tone={a.tone} size="sm" disabled={submitting} onClick={() => changeStatus(a.status)}>
                {a.label}
              </Button>
            ))}
            {canGenerateInvoice && (
              <Button tone="primary" size="sm" disabled={submitting} onClick={generateInvoice}>
                <FileText className="w-3.5 h-3.5 mr-1" /> Generate Invoice
              </Button>
            )}
            {canCancel && (
              <Button tone="danger" size="sm" disabled={submitting} onClick={() => changeStatus("cancelled")}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Details */}
        <div className="md:col-span-2 space-y-4">
          {ticket.description && (
            <SectionCard>
              <h4 className="text-sm font-semibold text-(--ui-text) mb-2">Description</h4>
              <p className="text-sm text-(--ui-text-muted) whitespace-pre-wrap">{ticket.description}</p>
            </SectionCard>
          )}
          {ticket.notes && (
            <SectionCard>
              <h4 className="text-sm font-semibold text-(--ui-text) mb-2">Notes</h4>
              <p className="text-sm text-(--ui-text-muted) whitespace-pre-wrap">{ticket.notes}</p>
            </SectionCard>
          )}

          {/* Add Note */}
          <SectionCard>
            <h4 className="text-sm font-semibold text-(--ui-text) mb-2">Add Note</h4>
            <div className="flex gap-2">
              <textarea className="grow rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)" rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note..." />
              <Button tone="default" size="sm" onClick={addNote} disabled={!noteText.trim()}>Add</Button>
            </div>
          </SectionCard>

          {/* Activity Timeline */}
          <SectionCard>
            <h4 className="text-sm font-semibold text-(--ui-text) mb-3">Activity</h4>
            {(!ticket.activities || ticket.activities.length === 0) ? (
              <p className="text-sm text-(--ui-text-muted)">No activity yet</p>
            ) : (
              <div className="space-y-3">
                {ticket.activities.map(a => (
                  <div key={a.id} className="flex gap-3 text-sm">
                    <div className="w-2 h-2 mt-1.5 rounded-full bg-(--ui-primary) shrink-0" />
                    <div>
                      <p className="text-(--ui-text)">{a.description}</p>
                      <p className="text-xs text-(--ui-text-muted)">{a.actor_name || "System"} &middot; {fmtDateTime(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <SectionCard>
            <h4 className="text-sm font-semibold text-(--ui-text) mb-3">Details</h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Created</dt><dd className="text-(--ui-text)">{fmtDateTime(ticket.created_at)}</dd></div>
              <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Created By</dt><dd className="text-(--ui-text)">{ticket.created_by_name || "-"}</dd></div>
              <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Assigned To</dt><dd className="text-(--ui-text)">{ticket.assigned_to_name || "Unassigned"}</dd></div>
              <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Expected</dt><dd className="text-(--ui-text)">{fmtDate(ticket.expected_completion)}</dd></div>
              {ticket.actual_completion && <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Completed</dt><dd className="text-(--ui-text)">{fmtDateTime(ticket.actual_completion)}</dd></div>}
            </dl>
          </SectionCard>

          {/* Deposit Card */}
          <SectionCard>
            <h4 className="text-sm font-semibold text-(--ui-text) mb-3">Deposit</h4>
            {Number(ticket.deposit_amount) > 0 ? (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Amount</dt><dd className="text-(--ui-text) font-medium">{fmt(ticket.deposit_amount)}</dd></div>
                <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Method</dt><dd className="text-(--ui-text)">{(ticket.deposit_method || "cash").replace("_", " ")}</dd></div>
                {ticket.deposit_status && ticket.deposit_status !== "none" && (
                  <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Gateway</dt><dd className="text-(--ui-text)">{ticket.deposit_status.replace("_", " ")}</dd></div>
                )}
                <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Paid At</dt><dd className="text-(--ui-text)">{fmtDateTime(ticket.deposit_paid_at)}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">No deposit recorded</p>
            )}
            {/* F04: online gateway deposit (charge). Only when a gateway is configured. */}
            {paymentEnabled && !["invoiced", "cancelled"].includes(ticket.status) &&
              !["pending", "captured"].includes(ticket.deposit_status) && (
              <div className="mt-3 flex gap-2">
                <Input type="number" min="0" step="0.01" value={depositAmt}
                  onChange={e => setDepositAmt(e.target.value)} placeholder="Deposit amount" className="flex-1" />
                <Button size="sm" onClick={takeGatewayDeposit}>Take Online Deposit</Button>
              </div>
            )}
          </SectionCard>

          {/* Invoice Link */}
          {ticket.final_invoice_id && (
            <SectionCard>
              <h4 className="text-sm font-semibold text-(--ui-text) mb-2">Invoice</h4>
              <p className="text-sm text-(--ui-text)">
                <FileText className="w-3.5 h-3.5 inline mr-1" />
                Invoice #{ticket.final_invoice_id} linked
              </p>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main Page Component ─────────────────────────────────────────── */

export default function ServiceTicketsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [employees, setEmployees] = useState([]);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusFilter) params.status = statusFilter;
      if (search) params.search = search;
      const data = await api.get("/api/service-tickets", params);
      setTickets(data.tickets || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [statusFilter, search]);

  const loadDropdowns = useCallback(async () => {
    try {
      const [custData, empData] = await Promise.all([
        api.get("/api/customers", { limit: 200 }),
        api.get("/api/employees"),
      ]);
      setCustomers(custData.customers || custData || []);
      setEmployees(empData.employees || empData || []);
    } catch {}
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);
  useEffect(() => { loadDropdowns(); }, [loadDropdowns]);

  if (flagsLoading) return null;
  if (!flags.phase4_workflow_tickets) return <Navigate to="/" replace />;

  if (selectedId) {
    return (
      <PageShell title="Service Tickets">
        <TicketDetail ticketId={selectedId} onBack={() => setSelectedId(null)} onRefresh={loadTickets} />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Service Tickets"
      subtitle="Track repairs, alterations, and service jobs"
      right={<Button tone="primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> New Ticket</Button>}
    >
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-40">
          <option value="">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </Select>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by ticket # or title..."
          className="w-64"
        />
      </div>

      {/* Table */}
      <SectionCard>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-(--ui-text-muted)">Loading...</div>
        ) : tickets.length === 0 ? (
          <EmptyState title="No tickets found" body={statusFilter || search ? "Try adjusting your filters" : "Create your first service ticket to get started"} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="py-2 px-3 font-medium">Ticket #</th>
                  <th className="py-2 px-3 font-medium">Title</th>
                  <th className="py-2 px-3 font-medium">Customer</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Assigned To</th>
                  <th className="py-2 px-3 font-medium">Expected</th>
                  <th className="py-2 px-3 font-medium text-right">Deposit</th>
                  <th className="py-2 px-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map(t => (
                  <tr
                    key={t.id}
                    className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface) cursor-pointer transition-colors"
                    onClick={() => setSelectedId(t.id)}
                  >
                    <td className="py-2.5 px-3 font-mono text-xs text-(--ui-primary)">{t.ticket_number}</td>
                    <td className="py-2.5 px-3 text-(--ui-text) font-medium max-w-[200px] truncate">{t.title}</td>
                    <td className="py-2.5 px-3 text-(--ui-text-muted)">{t.customer_name || "-"}</td>
                    <td className="py-2.5 px-3"><Badge tone={STATUS_TONES[t.status]}>{STATUS_LABELS[t.status]}</Badge></td>
                    <td className="py-2.5 px-3 text-(--ui-text-muted)">{t.assigned_to_name || "-"}</td>
                    <td className="py-2.5 px-3 text-(--ui-text-muted)">{fmtDate(t.expected_completion)}</td>
                    <td className="py-2.5 px-3 text-right text-(--ui-text)">{Number(t.deposit_amount) > 0 ? fmt(t.deposit_amount) : "-"}</td>
                    <td className="py-2.5 px-3 text-(--ui-text-muted)">{fmtDate(t.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create Modal */}
      {showCreate && (
        <CreateTicketModal
          customers={customers}
          employees={employees}
          onClose={() => setShowCreate(false)}
          onCreated={loadTickets}
        />
      )}
    </PageShell>
  );
}
