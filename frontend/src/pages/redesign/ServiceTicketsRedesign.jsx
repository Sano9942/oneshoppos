import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState } from "../../ui/primitives";
import { Plus, ArrowLeft, X, FileText, User, Smartphone, Eye, EyeOff, Trash2, History, Camera } from "lucide-react";
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

const EMPTY_DEVICE = {
  device_type: "", brand: "", model: "", serial_number: "", imei: "",
  passcode: "", condition_notes: "", accessories: "",
};

function accessoriesToArray(str) {
  return (str || "").split(",").map(s => s.trim()).filter(Boolean);
}

/* ── Prior-device history banner ─────────────────────────────────── */

function DeviceHistoryBanner({ matches }) {
  if (!matches || matches.length === 0) return null;
  return (
    <div className="rounded-lg border border-(--ui-warning) bg-(--ui-warning-bg) px-3 py-2 text-xs text-(--ui-warning-fg)">
      <div className="flex items-center gap-1.5 font-medium mb-1">
        <History className="w-3.5 h-3.5" /> Seen before — {matches.length} prior ticket{matches.length > 1 ? "s" : ""}
      </div>
      <ul className="space-y-0.5 text-(--ui-text-muted)">
        {matches.slice(0, 3).map(m => (
          <li key={m.ticket_id}>
            {m.ticket_number} · {m.title} · {fmtDate(m.created_at)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Device intake fields (shared by create modal + add-device) ──── */

function DeviceIntakeFields({ device, set, historyMatches, onLookup }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Device Type</label>
          <Input value={device.device_type} onChange={e => set("device_type", e.target.value)} placeholder="Phone" />
        </div>
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Brand</label>
          <Input value={device.brand} onChange={e => set("brand", e.target.value)} placeholder="Apple" />
        </div>
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Model</label>
          <Input value={device.model} onChange={e => set("model", e.target.value)} placeholder="iPhone 12" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">IMEI</label>
          <Input
            value={device.imei}
            onChange={e => set("imei", e.target.value)}
            onBlur={() => onLookup && device.imei && onLookup({ imei: device.imei })}
            placeholder="15-digit IMEI"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Serial Number</label>
          <Input
            value={device.serial_number}
            onChange={e => set("serial_number", e.target.value)}
            onBlur={() => onLookup && device.serial_number && onLookup({ serial: device.serial_number })}
            placeholder="Serial"
          />
        </div>
      </div>
      <DeviceHistoryBanner matches={historyMatches} />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Passcode</label>
          <Input value={device.passcode} onChange={e => set("passcode", e.target.value)} placeholder="Stored encrypted" />
        </div>
        <div>
          <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Accessories</label>
          <Input value={device.accessories} onChange={e => set("accessories", e.target.value)} placeholder="charger, case" />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Condition Notes</label>
        <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)" rows={2} value={device.condition_notes} onChange={e => set("condition_notes", e.target.value)} placeholder="Front glass shattered, LCD intact..." />
      </div>
    </div>
  );
}

/* ── Create Ticket Modal (one-page intake) ───────────────────────── */

function CreateTicketModal({ customers, employees, onClose, onCreated }) {
  const toast = useToast();
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({
    title: "", description: "", customer_id: "", outlet_id: "",
    assigned_to: "", ticket_type_id: "", expected_completion: "", deposit_amount: "",
    deposit_method: "cash", notes: "",
  });
  const [device, setDevice] = useState({ ...EMPTY_DEVICE });
  const [historyMatches, setHistoryMatches] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/service-tickets/types").then(d => setTypes(d.types || [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const setDev = (k, v) => setDevice(prev => ({ ...prev, [k]: v }));

  const lookup = useCallback(async ({ imei, serial }) => {
    try {
      const q = imei ? { imei } : { serial };
      const d = await api.get("/api/service-tickets/device-history", q);
      setHistoryMatches(d.history || []);
    } catch { /* non-fatal */ }
  }, []);

  const deviceHasData = Object.values(device).some(v => String(v).trim());

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
        ticket_type_id: form.ticket_type_id ? Number(form.ticket_type_id) : undefined,
        expected_completion: form.expected_completion || undefined,
        deposit_amount: form.deposit_amount ? Number(form.deposit_amount) : undefined,
        deposit_method: form.deposit_amount ? form.deposit_method : undefined,
        notes: form.notes || undefined,
      };
      if (deviceHasData) {
        body.devices = [{
          device_type: device.device_type || undefined,
          brand: device.brand || undefined,
          model: device.model || undefined,
          serial_number: device.serial_number || undefined,
          imei: device.imei || undefined,
          passcode: device.passcode || undefined,
          condition_notes: device.condition_notes || undefined,
          accessories: accessoriesToArray(device.accessories),
        }];
      }
      await api.post("/api/service-tickets", body);
      toast.success("Ticket created");
      onCreated();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-6 w-full max-w-2xl mx-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-(--ui-text)">New Service Ticket</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Title *</label>
              <Input value={form.title} onChange={e => set("title", e.target.value)} placeholder="e.g. iPhone screen repair" />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Repair Type</label>
              <Select value={form.ticket_type_id} onChange={e => set("ticket_type_id", e.target.value)}>
                <option value="">-- Select --</option>
                {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
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

          {/* Device intake */}
          <div className="rounded-lg border border-(--ui-border) p-3">
            <div className="flex items-center gap-1.5 text-sm font-semibold text-(--ui-text) mb-3">
              <Smartphone className="w-4 h-4" /> Device
              <span className="text-xs font-normal text-(--ui-text-muted)">(optional — leave blank for a plain service job)</span>
            </div>
            <DeviceIntakeFields device={device} set={setDev} historyMatches={historyMatches} onLookup={lookup} />
          </div>

          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Problem Description</label>
            <textarea className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)" rows={2} value={form.description} onChange={e => set("description", e.target.value)} placeholder="What's wrong / what the customer reported..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Expected Completion</label>
              <Input type="date" value={form.expected_completion} onChange={e => set("expected_completion", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Deposit</label>
              <Input type="number" min="0" step="0.01" value={form.deposit_amount} onChange={e => set("deposit_amount", e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Deposit Method</label>
              <Select value={form.deposit_method} onChange={e => set("deposit_method", e.target.value)}>
                {DEPOSIT_METHODS.map(m => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
              </Select>
            </div>
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

/* ── Checklist tri-state control ─────────────────────────────────── */

function ChecklistRow({ label, value, onChange }) {
  const opts = [
    { v: true, txt: "Pass", tone: "success" },
    { v: false, txt: "Fail", tone: "danger" },
    { v: null, txt: "—", tone: "default" },
  ];
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-sm text-(--ui-text)">{label}</span>
      <div className="flex gap-1">
        {opts.map(o => (
          <button
            key={String(o.v)}
            onClick={() => onChange(o.v)}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              value === o.v
                ? o.tone === "success" ? "bg-(--ui-success-bg) text-(--ui-success-fg) border-transparent"
                : o.tone === "danger" ? "bg-(--ui-danger-bg) text-(--ui-danger-fg) border-transparent"
                : "bg-(--ui-muted-surface) text-(--ui-text) border-(--ui-border)"
                : "border-(--ui-border) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
            }`}
          >
            {o.txt}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Device card (detail view) ───────────────────────────────────── */

function DeviceCard({ ticketId, device, onChanged }) {
  const toast = useToast();
  const [revealed, setRevealed] = useState(null);
  const [checklist, setChecklist] = useState(device.checklist || {});
  const [savingCk, setSavingCk] = useState(false);
  const [uploading, setUploading] = useState(false);

  const reveal = async () => {
    if (revealed !== null) { setRevealed(null); return; }
    try {
      const r = await api.post(`/api/service-tickets/${ticketId}/devices/${device.id}/reveal-passcode`);
      setRevealed(r.passcode || "(none)");
    } catch (err) { toast.error(err.message); }
  };

  const setCheck = async (label, val) => {
    const next = { ...checklist, [label]: val };
    setChecklist(next);
    setSavingCk(true);
    try {
      await api.put(`/api/service-tickets/${ticketId}/devices/${device.id}`, { checklist: next });
    } catch (err) { toast.error(err.message); }
    finally { setSavingCk(false); }
  };

  const uploadPhoto = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await api.upload(`/api/service-tickets/${ticketId}/devices/${device.id}/photos`, fd);
      const photos = [...(device.photos || []), url];
      await api.put(`/api/service-tickets/${ticketId}/devices/${device.id}`, { photos });
      toast.success("Photo added");
      onChanged();
    } catch (err) { toast.error(err.message); }
    finally { setUploading(false); }
  };

  const remove = async () => {
    if (!confirm("Remove this device from the ticket?")) return;
    try {
      await api.del(`/api/service-tickets/${ticketId}/devices/${device.id}`);
      toast.success("Device removed");
      onChanged();
    } catch (err) { toast.error(err.message); }
  };

  const title = [device.brand, device.model].filter(Boolean).join(" ") || device.device_type || "Device";
  const checklistKeys = Object.keys(checklist);

  return (
    <div className="rounded-lg border border-(--ui-border) p-3 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-(--ui-text)">
            <Smartphone className="w-4 h-4" /> {title}
          </div>
          <div className="text-xs text-(--ui-text-muted) mt-0.5 space-x-2">
            {device.imei && <span>IMEI: {device.imei}</span>}
            {device.serial_number && <span>SN: {device.serial_number}</span>}
          </div>
        </div>
        <button onClick={remove} className="text-(--ui-text-muted) hover:text-(--ui-danger)" title="Remove device">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {device.condition_notes && <p className="text-sm text-(--ui-text-muted)">{device.condition_notes}</p>}

      {device.accessories?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {device.accessories.map((a, i) => <Badge key={i} tone="default">{a}</Badge>)}
        </div>
      )}

      {/* Passcode reveal */}
      {device.has_passcode && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-(--ui-text-muted)">Passcode:</span>
          {revealed !== null
            ? <span className="font-mono text-(--ui-text)">{revealed}</span>
            : <span className="font-mono text-(--ui-text-muted)">••••</span>}
          <button onClick={reveal} className="text-(--ui-primary) hover:opacity-80" title={revealed !== null ? "Hide" : "Reveal"}>
            {revealed !== null ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {/* Checklist */}
      {checklistKeys.length > 0 && (
        <div className="border-t border-(--ui-border) pt-2">
          <div className="text-xs font-medium text-(--ui-text-muted) mb-1">Pre-repair checklist {savingCk && "· saving…"}</div>
          {checklistKeys.map(k => (
            <ChecklistRow key={k} label={k} value={checklist[k]} onChange={v => setCheck(k, v)} />
          ))}
        </div>
      )}

      {/* Photos */}
      <div className="border-t border-(--ui-border) pt-2">
        <div className="flex items-center gap-2 mb-2">
          {(device.photos || []).map((p, i) => (
            <a key={i} href={p} target="_blank" rel="noreferrer">
              <img src={p} alt="condition" className="w-12 h-12 object-cover rounded border border-(--ui-border)" />
            </a>
          ))}
          <label className="w-12 h-12 rounded border border-dashed border-(--ui-border) flex items-center justify-center cursor-pointer text-(--ui-text-muted) hover:bg-(--ui-muted-surface)">
            <Camera className="w-4 h-4" />
            <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={e => uploadPhoto(e.target.files?.[0])} />
          </label>
        </div>
      </div>
    </div>
  );
}

/* ── Add-device form (detail view) ───────────────────────────────── */

function AddDeviceForm({ ticketId, onAdded, onCancel }) {
  const toast = useToast();
  const [device, setDevice] = useState({ ...EMPTY_DEVICE });
  const [historyMatches, setHistoryMatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const setDev = (k, v) => setDevice(prev => ({ ...prev, [k]: v }));

  const lookup = useCallback(async ({ imei, serial }) => {
    try {
      const q = imei ? { imei } : { serial };
      const d = await api.get("/api/service-tickets/device-history", { ...q, exclude: ticketId });
      setHistoryMatches(d.history || []);
    } catch { /* non-fatal */ }
  }, [ticketId]);

  const submit = async () => {
    setSaving(true);
    try {
      await api.post(`/api/service-tickets/${ticketId}/devices`, {
        device_type: device.device_type || undefined,
        brand: device.brand || undefined,
        model: device.model || undefined,
        serial_number: device.serial_number || undefined,
        imei: device.imei || undefined,
        passcode: device.passcode || undefined,
        condition_notes: device.condition_notes || undefined,
        accessories: accessoriesToArray(device.accessories),
      });
      toast.success("Device added");
      onAdded();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-lg border border-(--ui-border) p-3 space-y-3">
      <DeviceIntakeFields device={device} set={setDev} historyMatches={historyMatches} onLookup={lookup} />
      <div className="flex justify-end gap-2">
        <Button tone="default" size="sm" onClick={onCancel}>Cancel</Button>
        <Button tone="primary" size="sm" disabled={saving} onClick={submit}>{saving ? "Adding…" : "Add Device"}</Button>
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
  const [addingDevice, setAddingDevice] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/api/service-tickets/${ticketId}`);
      setTicket(data);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

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
              {ticket.ticket_type_name && <Badge tone="default">{ticket.ticket_type_name}</Badge>}
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
          {/* Devices */}
          <SectionCard>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-(--ui-text)">Devices</h4>
              {!addingDevice && (
                <Button tone="default" size="sm" onClick={() => setAddingDevice(true)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Device
                </Button>
              )}
            </div>
            <div className="space-y-3">
              {(ticket.devices || []).map(d => (
                <DeviceCard key={d.id} ticketId={ticketId} device={d} onChanged={load} />
              ))}
              {addingDevice && (
                <AddDeviceForm ticketId={ticketId} onAdded={() => { setAddingDevice(false); load(); }} onCancel={() => setAddingDevice(false)} />
              )}
              {(!ticket.devices || ticket.devices.length === 0) && !addingDevice && (
                <p className="text-sm text-(--ui-text-muted)">No devices attached — add one for repair jobs, or leave empty for a plain service.</p>
              )}
            </div>
          </SectionCard>

          {ticket.description && (
            <SectionCard>
              <h4 className="text-sm font-semibold text-(--ui-text) mb-2">Problem Description</h4>
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
                <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Paid At</dt><dd className="text-(--ui-text)">{fmtDateTime(ticket.deposit_paid_at)}</dd></div>
              </dl>
            ) : (
              <p className="text-sm text-(--ui-text-muted)">No deposit recorded</p>
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
          placeholder="Search by ticket #, IMEI, serial, or phone..."
          className="w-72"
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
                  <th className="py-2 px-3 font-medium">Type</th>
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
                    <td className="py-2.5 px-3 text-(--ui-text-muted)">{t.ticket_type_name || "-"}</td>
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
