import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation, Link, Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState, Modal, ModalFooter } from "../../ui/primitives";
import { Plus, X, Calendar as CalendarIcon, Package, FileSignature, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../../api";
import { fmtUtcDateTime } from "../../utils/dates";

// ── Shared constants ──────────────────────────────────────────────

const STATUS_TONES = {
  reserved: "default",
  confirmed: "warning",
  checked_out: "warning",
  returned: "success",
  completed: "success",
  invoiced: "success",
  cancelled: "danger",
};

const STATUS_LABELS = {
  reserved: "Reserved",
  confirmed: "Confirmed",
  checked_out: "Checked Out",
  returned: "Returned",
  completed: "Completed",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

const STATUS_COLORS = {
  reserved: "#94a3b8",
  confirmed: "#3b82f6",
  checked_out: "#f59e0b",
  returned: "#8b5cf6",
  completed: "#10b981",
  invoiced: "#0d9488",
  cancelled: "#ef4444",
};

const STATUS_ACTIONS = {
  reserved: [{ label: "Confirm", action: "confirm", tone: "primary" }],
  confirmed: [{ label: "Check Out", action: "checkout", tone: "primary" }],
  checked_out: [{ label: "Return", action: "return", tone: "primary" }],
  returned: [{ label: "Complete", action: "complete", tone: "primary" }],
  completed: [{ label: "Generate Invoice", action: "invoice", tone: "primary" }],
};

// ── Root page — tab router ────────────────────────────────────────

export default function RentalsRedesign() {
  const { isAuthenticated, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const location = useLocation();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPerm("manage_rentals")) return <Navigate to="/access-denied" replace />;
  if (flagsLoading) return null;
  if (!flags.phase4_rentals) return <Navigate to="/dashboard" replace />;

  const tab =
    location.pathname.endsWith("/contracts") ? "contracts" :
    location.pathname.endsWith("/timeline") ? "timeline" : "items";

  return (
    <PageShell
      title="Rentals"
      subtitle="Manage rental items, contracts, and bookings timeline"
      right={<TabNav tab={tab} />}
    >
      {tab === "items" && <RentalItemsTab />}
      {tab === "contracts" && <ContractsTab />}
      {tab === "timeline" && <TimelineTab />}
    </PageShell>
  );
}

function TabNav({ tab }) {
  const tabs = [
    { key: "items", label: "Rental Items", path: "/rentals/items", icon: Package },
    { key: "contracts", label: "Contracts", path: "/rentals/contracts", icon: FileSignature },
    { key: "timeline", label: "Timeline", path: "/rentals/timeline", icon: CalendarIcon },
  ];
  return (
    <div className="flex gap-2">
      {tabs.map(t => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <Link
            key={t.key}
            to={t.path}
            className={`px-3 py-1.5 text-sm rounded-md flex items-center gap-1.5 transition ${
              active
                ? "bg-(--ui-primary) text-white"
                : "bg-(--ui-surface) border border-(--ui-border) text-(--ui-text) hover:bg-(--ui-muted-surface)"
            }`}
          >
            <Icon size={14} />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

// ── Rental Items tab ──────────────────────────────────────────────

function RentalItemsTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = search ? { search } : {};
      const res = await api.get("/api/rental-items", q);
      setItems(res.items || []);
    } catch (err) {
      toast.error(err.message || "Failed to load rental items");
    } finally {
      setLoading(false);
    }
  }, [search, toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => items, [items]);

  return (
    <SectionCard className="p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex-1">
          <Input
            placeholder="Search by name or SKU"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Button tone="primary" onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus size={16} /> New Rental Item
        </Button>
      </div>

      {loading ? (
        <p className="text-(--ui-text-muted) text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <EmptyState title="No rental items yet" body="Create your first rental item to start booking contracts." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
              <tr>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">SKU</th>
                <th className="py-2 pr-3">Daily</th>
                <th className="py-2 pr-3">Hourly</th>
                <th className="py-2 pr-3">Weekly</th>
                <th className="py-2 pr-3">Deposit</th>
                <th className="py-2 pr-3">Qty</th>
                <th className="py-2 pr-3">Payment</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <tr key={it.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="py-2 pr-3 font-medium">{it.name}</td>
                  <td className="py-2 pr-3 text-(--ui-text-muted)">{it.sku || "—"}</td>
                  <td className="py-2 pr-3">{fmt(Number(it.daily_rate || 0))}</td>
                  <td className="py-2 pr-3">{it.hourly_rate != null ? fmt(Number(it.hourly_rate)) : "—"}</td>
                  <td className="py-2 pr-3">{it.weekly_rate != null ? fmt(Number(it.weekly_rate)) : "—"}</td>
                  <td className="py-2 pr-3">{fmt(Number(it.deposit_amount || 0))}</td>
                  <td className="py-2 pr-3">{it.total_quantity}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={it.payment_policy === "upfront" ? "default" : "warning"}>
                      {it.payment_policy === "upfront" ? "Upfront" : "On Return"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={it.is_active ? "success" : "default"}>
                      {it.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">
                    <Button size="sm" onClick={() => { setEditing(it); setFormOpen(true); }}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <RentalItemFormModal
          item={editing}
          onClose={() => { setFormOpen(false); setEditing(null); }}
          onSaved={() => { setFormOpen(false); setEditing(null); load(); }}
        />
      )}
    </SectionCard>
  );
}

function RentalItemFormModal({ item, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    name: item?.name || "",
    sku: item?.sku || "",
    description: item?.description || "",
    total_quantity: item?.total_quantity || 1,
    daily_rate: item?.daily_rate || 0,
    hourly_rate: item?.hourly_rate ?? "",
    weekly_rate: item?.weekly_rate ?? "",
    deposit_amount: item?.deposit_amount || 0,
    payment_policy: item?.payment_policy || "upfront",
    is_active: item?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        sku: form.sku || undefined,
        description: form.description || undefined,
        total_quantity: Number(form.total_quantity),
        daily_rate: Number(form.daily_rate),
        hourly_rate: form.hourly_rate === "" ? null : Number(form.hourly_rate),
        weekly_rate: form.weekly_rate === "" ? null : Number(form.weekly_rate),
        deposit_amount: Number(form.deposit_amount),
        payment_policy: form.payment_policy,
        is_active: form.is_active,
      };
      if (item) {
        await api.put(`/api/rental-items/${item.id}`, payload);
        toast.success("Rental item updated");
      } else {
        await api.post("/api/rental-items", payload);
        toast.success("Rental item created");
      }
      onSaved();
    } catch (err) {
      toast.error(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={item ? "Edit Rental Item" : "New Rental Item"} onClose={onClose} size="md" open>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *"><Input value={form.name} onChange={e => set("name", e.target.value)} /></Field>
        <Field label="SKU"><Input value={form.sku} onChange={e => set("sku", e.target.value)} /></Field>
        <Field label="Total Quantity"><Input type="number" value={form.total_quantity} onChange={e => set("total_quantity", e.target.value)} /></Field>
        <Field label="Payment Policy">
          <Select value={form.payment_policy} onChange={e => set("payment_policy", e.target.value)}>
            <option value="upfront">Upfront</option>
            <option value="on_return">On Return</option>
          </Select>
        </Field>
        <Field label="Daily Rate *"><Input type="number" step="0.01" value={form.daily_rate} onChange={e => set("daily_rate", e.target.value)} /></Field>
        <Field label="Hourly Rate (optional)"><Input type="number" step="0.01" value={form.hourly_rate} onChange={e => set("hourly_rate", e.target.value)} /></Field>
        <Field label="Weekly Rate (optional)"><Input type="number" step="0.01" value={form.weekly_rate} onChange={e => set("weekly_rate", e.target.value)} /></Field>
        <Field label="Deposit Amount"><Input type="number" step="0.01" value={form.deposit_amount} onChange={e => set("deposit_amount", e.target.value)} /></Field>
        <Field label="Description" full>
          <Input value={form.description} onChange={e => set("description", e.target.value)} />
        </Field>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active} onChange={e => set("is_active", e.target.checked)} />
          Active (visible when creating contracts)
        </label>
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Contracts tab ─────────────────────────────────────────────────

function ContractsTab() {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = {};
      if (status) q.status = status;
      if (search) q.search = search;
      const res = await api.get("/api/rental-contracts", q);
      setContracts(res.contracts || []);
    } catch (err) {
      toast.error(err.message || "Failed to load contracts");
    } finally {
      setLoading(false);
    }
  }, [status, search, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <SectionCard className="p-5">
        <div className="flex items-center gap-3 mb-4">
          <Select value={status} onChange={e => setStatus(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="overdue">Overdue</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
          <Input
            placeholder="Search by contract # or customer"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1"
          />
          <Button tone="primary" onClick={() => setNewOpen(true)}>
            <Plus size={16} /> New Contract
          </Button>
        </div>

        {loading ? (
          <p className="text-(--ui-text-muted) text-sm">Loading...</p>
        ) : contracts.length === 0 ? (
          <EmptyState title="No contracts yet" body="Create a rental contract to begin tracking." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
                <tr>
                  <th className="py-2 pr-3">Contract #</th>
                  <th className="py-2 pr-3">Customer</th>
                  <th className="py-2 pr-3">Items</th>
                  <th className="py-2 pr-3">Rental Start</th>
                  <th className="py-2 pr-3">Expected Return</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => {
                  const isOverdue = c.status === "checked_out" && c.expected_return && new Date(c.expected_return) < new Date();
                  return (
                    <tr key={c.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                      <td className="py-2 pr-3 font-mono">{c.contract_number}</td>
                      <td className="py-2 pr-3">{c.customer_name || "—"}</td>
                      <td className="py-2 pr-3 text-(--ui-text-muted)">{c.item_summary || "—"}</td>
                      <td className="py-2 pr-3">{fmtUtcDateTime(c.rental_start)}</td>
                      <td className={`py-2 pr-3 ${isOverdue ? "text-red-600 font-semibold" : ""}`}>
                        {fmtUtcDateTime(c.expected_return)}
                        {isOverdue && " (overdue)"}
                      </td>
                      <td className="py-2 pr-3">{fmt(Number(c.final_total || c.rental_fee_total || 0))}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={STATUS_TONES[c.status]}>{STATUS_LABELS[c.status] || c.status}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        <Button size="sm" onClick={() => setSelectedId(c.id)}>View</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {newOpen && (
        <NewContractModal
          onClose={() => setNewOpen(false)}
          onSaved={() => { setNewOpen(false); load(); }}
        />
      )}

      {selectedId && (
        <ContractDetailModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => { load(); }}
        />
      )}
    </>
  );
}

function NewContractModal({ onClose, onSaved }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({
    customer_id: "",
    rental_start: "",
    expected_return: "",
    payment_policy: "upfront",
    deposit_collected: 0,
    deposit_method: "",
    discount_amount: 0,
    notes: "",
  });
  const [lines, setLines] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/api/rental-items").then(r => setItems(r.items || [])).catch(() => {});
    api.get("/api/customers").then(r => {
      // customers endpoint shape varies — support both {customers:[]} and flat array
      setCustomers(r.customers || r || []);
    }).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addLine = () => {
    if (!items.length) return;
    setLines(ls => [...ls, {
      rental_item_id: items[0].id,
      quantity: 1,
      rate_type: "daily",
      duration_value: 1,
    }]);
  };

  const updateLine = (idx, key, val) => {
    setLines(ls => ls.map((l, i) => i === idx ? { ...l, [key]: val } : l));
  };

  const removeLine = (idx) => {
    setLines(ls => ls.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    if (!form.rental_start || !form.expected_return) {
      toast.error("Rental start and expected return are required");
      return;
    }
    if (!lines.length) {
      toast.error("Add at least one rental item line");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        customer_id: form.customer_id ? Number(form.customer_id) : null,
        rental_start: form.rental_start,
        expected_return: form.expected_return,
        payment_policy: form.payment_policy,
        deposit_collected: Number(form.deposit_collected) || 0,
        deposit_method: form.deposit_method || undefined,
        discount_amount: Number(form.discount_amount) || 0,
        notes: form.notes || undefined,
        lines: lines.map(l => ({
          rental_item_id: Number(l.rental_item_id),
          quantity: Number(l.quantity),
          rate_type: l.rate_type,
          duration_value: Number(l.duration_value),
        })),
      };
      await api.post("/api/rental-contracts", payload);
      toast.success("Contract created");
      onSaved();
    } catch (err) {
      toast.error(err.message || "Create failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="New Rental Contract" onClose={onClose} size="lg" open>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer">
          <Select value={form.customer_id} onChange={e => set("customer_id", e.target.value)}>
            <option value="">— Walk-in —</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Payment Policy">
          <Select value={form.payment_policy} onChange={e => set("payment_policy", e.target.value)}>
            <option value="upfront">Upfront</option>
            <option value="on_return">On Return</option>
          </Select>
        </Field>
        <Field label="Rental Start *">
          <Input type="datetime-local" value={form.rental_start} onChange={e => set("rental_start", e.target.value)} />
        </Field>
        <Field label="Expected Return *">
          <Input type="datetime-local" value={form.expected_return} onChange={e => set("expected_return", e.target.value)} />
        </Field>
        <Field label="Deposit Collected">
          <Input type="number" step="0.01" value={form.deposit_collected} onChange={e => set("deposit_collected", e.target.value)} />
        </Field>
        <Field label="Deposit Method">
          <Input value={form.deposit_method} onChange={e => set("deposit_method", e.target.value)} placeholder="cash, card, bank" />
        </Field>
        <Field label="Discount Amount">
          <Input type="number" step="0.01" value={form.discount_amount} onChange={e => set("discount_amount", e.target.value)} />
        </Field>
        <Field label="Notes" full>
          <Input value={form.notes} onChange={e => set("notes", e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 pt-4 border-t border-(--ui-border)">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-semibold">Items</h4>
          <Button size="sm" onClick={addLine}><Plus size={14} /> Add Item</Button>
        </div>
        {lines.length === 0 ? (
          <p className="text-(--ui-text-muted) text-sm">No items added yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
              <tr>
                <th className="py-2 pr-2">Item</th>
                <th className="py-2 pr-2">Qty</th>
                <th className="py-2 pr-2">Rate Type</th>
                <th className="py-2 pr-2">Duration</th>
                <th className="py-2 pr-2"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx} className="border-b border-(--ui-border)">
                  <td className="py-2 pr-2">
                    <Select value={l.rental_item_id} onChange={e => updateLine(idx, "rental_item_id", e.target.value)}>
                      {items.map(it => (
                        <option key={it.id} value={it.id}>{it.name}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <Input type="number" value={l.quantity} onChange={e => updateLine(idx, "quantity", e.target.value)} className="w-20" />
                  </td>
                  <td className="py-2 pr-2">
                    <Select value={l.rate_type} onChange={e => updateLine(idx, "rate_type", e.target.value)}>
                      <option value="hourly">Hourly</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                    </Select>
                  </td>
                  <td className="py-2 pr-2">
                    <Input type="number" step="0.01" value={l.duration_value} onChange={e => updateLine(idx, "duration_value", e.target.value)} className="w-24" />
                  </td>
                  <td className="py-2 pr-2">
                    <Button size="sm" onClick={() => removeLine(idx)}><X size={14} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={submit} disabled={saving}>{saving ? "Creating..." : "Create Contract"}</Button>
      </ModalFooter>
    </Modal>
  );
}

const GATEWAY_DEPOSIT_TONES = {
  none: "default", pending: "warning", authorized: "primary",
  captured: "success", partially_captured: "success", released: "default", failed: "danger",
};

function ContractDetailModal({ id, onClose, onChanged }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [contract, setContract] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionOpen, setActionOpen] = useState(null);
  const [paymentEnabled, setPaymentEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/rental-contracts/${id}`);
      setContract(res);
    } catch (err) {
      toast.error(err.message || "Failed to load contract");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => { load(); }, [load]);

  // Gateway deposit buttons only render when the tenant has an online payment
  // gateway configured (billing status payment_enabled). Non-fatal.
  useEffect(() => {
    let alive = true;
    api.get("/api/billing/status")
      .then((s) => { if (alive) setPaymentEnabled(!!s?.payment_enabled); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const takeGatewayDeposit = async () => {
    try {
      const res = await api.post(`/api/rental-contracts/${id}/deposit/preauth`, {});
      if (res?.checkout_url) window.open(res.checkout_url, "_blank", "noopener");
      toast.success("Deposit checkout opened — status updates after payment");
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message || "Failed to start deposit");
    }
  };

  const runAction = async (action, body = {}) => {
    try {
      if (action === "confirm") await api.post(`/api/rental-contracts/${id}/confirm`, {});
      else if (action === "checkout") await api.post(`/api/rental-contracts/${id}/checkout`, body);
      else if (action === "return") await api.post(`/api/rental-contracts/${id}/return`, body);
      else if (action === "complete") await api.post(`/api/rental-contracts/${id}/complete`, {});
      else if (action === "invoice") await api.post(`/api/rental-contracts/${id}/invoice`, {});
      else if (action === "cancel") await api.post(`/api/rental-contracts/${id}/cancel`, body);
      toast.success("Action completed");
      await load();
      onChanged();
    } catch (err) {
      toast.error(err.message || "Action failed");
    }
  };

  if (loading || !contract) {
    return (
      <Modal title="Contract" onClose={onClose} size="md" open>
        <p className="text-(--ui-text-muted) text-sm">Loading...</p>
      </Modal>
    );
  }

  const actions = STATUS_ACTIONS[contract.status] || [];

  return (
    <Modal title={`Contract ${contract.contract_number}`} onClose={onClose} size="lg" open>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <InfoRow label="Customer" value={contract.customer_name || "Walk-in"} />
        <InfoRow label="Status" value={<Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status] || contract.status}</Badge>} />
        <InfoRow label="Created By" value={contract.created_by_name || "—"} />
        <InfoRow label="Rental Start" value={fmtUtcDateTime(contract.rental_start)} />
        <InfoRow label="Expected Return" value={fmtUtcDateTime(contract.expected_return)} />
        <InfoRow label="Actual Return" value={contract.actual_return ? fmtUtcDateTime(contract.actual_return) : "—"} />
        <InfoRow label="Rental Fee" value={fmt(Number(contract.rental_fee_total || 0))} />
        <InfoRow label="Late Fee" value={fmt(Number(contract.late_fee || 0))} />
        <InfoRow label="Final Total" value={<strong>{fmt(Number(contract.final_total || 0))}</strong>} />
        <InfoRow label="Deposit" value={`${fmt(Number(contract.deposit_collected || 0))} (${contract.deposit_method || "n/a"})`} />
        <InfoRow label="Discount" value={fmt(Number(contract.discount_amount || 0))} />
        <InfoRow label="Payment Policy" value={contract.payment_policy === "upfront" ? "Upfront" : "On Return"} />
      </div>

      {/* F04: gateway security-deposit hold (separate from the manual deposit
          above). Only shown when an online payment gateway is configured. */}
      {paymentEnabled && (
        <div className="mt-3 p-3 bg-(--ui-muted-surface) rounded text-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <strong>Security Deposit (Gateway):</strong>
              <Badge tone={GATEWAY_DEPOSIT_TONES[contract.deposit_status] || "default"}>
                {(contract.deposit_status || "none").replace("_", " ")}
              </Badge>
              {Number(contract.deposit_authorized_amount || 0) > 0 && (
                <span className="text-(--ui-text-muted)">
                  held {fmt(Number(contract.deposit_authorized_amount))}
                  {Number(contract.deposit_captured_amount || 0) > 0 &&
                    ` · captured ${fmt(Number(contract.deposit_captured_amount))}`}
                </span>
              )}
            </div>
            {["none", "failed", null, undefined].includes(contract.deposit_status) &&
              !["invoiced", "cancelled", "completed"].includes(contract.status) && (
              <Button size="sm" onClick={takeGatewayDeposit}>Take Deposit</Button>
            )}
          </div>
        </div>
      )}

      {contract.notes && (
        <div className="mt-3 p-3 bg-(--ui-muted-surface) rounded text-sm">
          <strong>Notes:</strong> {contract.notes}
        </div>
      )}

      {contract.cancellation_reason && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded text-sm">
          <strong>Cancelled:</strong> {contract.cancellation_reason}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-(--ui-border)">
        <h4 className="font-semibold mb-2">Line Items</h4>
        <table className="w-full text-sm">
          <thead className="text-left text-(--ui-text-muted) border-b border-(--ui-border)">
            <tr>
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Qty</th>
              <th className="py-2 pr-2">Rate</th>
              <th className="py-2 pr-2">Duration</th>
              <th className="py-2 pr-2">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {(contract.lines || []).map(l => (
              <tr key={l.id} className="border-b border-(--ui-border)">
                <td className="py-2 pr-2">{l.item_name}{l.asset_serial ? ` (#${l.asset_serial})` : ""}</td>
                <td className="py-2 pr-2">{l.quantity}</td>
                <td className="py-2 pr-2">{fmt(Number(l.rate_snapshot))} / {l.rate_type}</td>
                <td className="py-2 pr-2">{l.duration_value}</td>
                <td className="py-2 pr-2">{fmt(Number(l.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 pt-4 border-t border-(--ui-border)">
        <h4 className="font-semibold mb-2">Activity</h4>
        <ul className="space-y-1 text-sm max-h-48 overflow-y-auto">
          {(contract.activities || []).map(a => (
            <li key={a.id} className="flex gap-2">
              <span className="text-(--ui-text-muted) shrink-0">{fmtUtcDateTime(a.created_at)}</span>
              <span className="font-medium shrink-0">{a.activity_type}:</span>
              <span>{a.description}</span>
              {a.actor_name && <span className="text-(--ui-text-muted)">— {a.actor_name}</span>}
            </li>
          ))}
        </ul>
      </div>

      <ModalFooter>
        {actions.map(a => (
          <Button key={a.action} tone={a.tone} onClick={() => {
            if (a.action === "checkout" || a.action === "return") setActionOpen(a.action);
            else runAction(a.action);
          }}>
            {a.label}
          </Button>
        ))}
        {!["invoiced", "cancelled", "completed"].includes(contract.status) && (
          <Button tone="danger" onClick={() => setActionOpen("cancel")}>Cancel Contract</Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </ModalFooter>

      {actionOpen === "checkout" && (
        <CheckoutActionModal
          onClose={() => setActionOpen(null)}
          onConfirm={(body) => { setActionOpen(null); runAction("checkout", body); }}
        />
      )}
      {actionOpen === "return" && (
        <ReturnActionModal
          hasGatewayHold={contract.deposit_status === "authorized"}
          onClose={() => setActionOpen(null)}
          onConfirm={(body) => { setActionOpen(null); runAction("return", body); }}
        />
      )}
      {actionOpen === "cancel" && (
        <CancelActionModal
          onClose={() => setActionOpen(null)}
          onConfirm={(body) => { setActionOpen(null); runAction("cancel", body); }}
        />
      )}
    </Modal>
  );
}

function CheckoutActionModal({ onClose, onConfirm }) {
  const [depositMethod, setDepositMethod] = useState("cash");
  return (
    <Modal title="Check Out" onClose={onClose} size="md" open>
      <Field label="Deposit Method">
        <Input value={depositMethod} onChange={e => setDepositMethod(e.target.value)} />
      </Field>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={() => onConfirm({ deposit_method: depositMethod })}>Confirm Checkout</Button>
      </ModalFooter>
    </Modal>
  );
}

function ReturnActionModal({ onClose, onConfirm, hasGatewayHold }) {
  const [conditionNotes, setConditionNotes] = useState("");
  const [overrideLateFee, setOverrideLateFee] = useState("");
  const [captureAmount, setCaptureAmount] = useState("");
  return (
    <Modal title="Return" onClose={onClose} size="md" open>
      <Field label="Condition Notes">
        <Input value={conditionNotes} onChange={e => setConditionNotes(e.target.value)} />
      </Field>
      <Field label="Override Late Fee (leave blank for auto-calc)">
        <Input type="number" step="0.01" value={overrideLateFee} onChange={e => setOverrideLateFee(e.target.value)} />
      </Field>
      {hasGatewayHold && (
        <Field label="Capture from security deposit (damage/late fee — blank/0 releases the hold)">
          <Input type="number" step="0.01" value={captureAmount} onChange={e => setCaptureAmount(e.target.value)} />
        </Field>
      )}
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={() => onConfirm({
          condition_notes: conditionNotes || undefined,
          late_fee: overrideLateFee === "" ? undefined : Number(overrideLateFee),
          deposit_capture_amount: captureAmount === "" ? undefined : Number(captureAmount),
        })}>Confirm Return</Button>
      </ModalFooter>
    </Modal>
  );
}

function CancelActionModal({ onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Cancel Contract" onClose={onClose} size="md" open>
      <Field label="Reason (optional)">
        <Input value={reason} onChange={e => setReason(e.target.value)} />
      </Field>
      <ModalFooter>
        <Button onClick={onClose}>Back</Button>
        <Button tone="danger" onClick={() => onConfirm({ cancellation_reason: reason || undefined })}>Cancel Contract</Button>
      </ModalFooter>
    </Modal>
  );
}

// ── Timeline tab ──────────────────────────────────────────────────

function TimelineTab() {
  const [view, setView] = useState("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [data, setData] = useState({ items: [], bookings: [] });
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const range = useMemo(() => {
    const start = new Date(anchor);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    if (view === "week") {
      const day = start.getDay();
      start.setDate(start.getDate() - day);
      end.setTime(start.getTime());
      end.setDate(end.getDate() + 7);
    } else {
      start.setDate(1);
      end.setTime(start.getTime());
      end.setMonth(end.getMonth() + 1);
    }
    return { start, end };
  }, [anchor, view]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/rental-contracts/timeline", {
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      });
      setData(res || { items: [], bookings: [] });
    } catch (err) {
      toast.error(err.message || "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, toast]);

  useEffect(() => { load(); }, [load]);

  const columns = useMemo(() => {
    const cols = [];
    const msPerDay = 24 * 60 * 60 * 1000;
    const total = Math.round((range.end - range.start) / msPerDay);
    for (let i = 0; i < total; i++) {
      const d = new Date(range.start);
      d.setDate(d.getDate() + i);
      cols.push(d);
    }
    return cols;
  }, [range.start, range.end]);

  const shift = (delta) => {
    const d = new Date(anchor);
    if (view === "week") d.setDate(d.getDate() + delta * 7);
    else d.setMonth(d.getMonth() + delta);
    setAnchor(d);
  };

  const bookingsByItem = useMemo(() => {
    const map = new Map();
    for (const b of (data.bookings || [])) {
      const arr = map.get(b.rental_item_id) || [];
      arr.push(b);
      map.set(b.rental_item_id, arr);
    }
    return map;
  }, [data.bookings]);

  const blockStyle = (booking) => {
    const start = new Date(booking.rental_start);
    const end = new Date(booking.expected_return);
    const msPerDay = 24 * 60 * 60 * 1000;
    const totalDays = columns.length;
    let startCol = Math.max(0, Math.floor((start - range.start) / msPerDay));
    let endCol = Math.min(totalDays, Math.ceil((end - range.start) / msPerDay));
    if (endCol <= startCol) endCol = startCol + 1;
    return {
      gridColumnStart: startCol + 1,
      gridColumnEnd: endCol + 1,
      backgroundColor: STATUS_COLORS[booking.status] || "#64748b",
    };
  };

  return (
    <SectionCard className="p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-(--ui-border) overflow-hidden">
            <button
              onClick={() => setView("week")}
              className={`px-3 py-1.5 text-sm ${view === "week" ? "bg-(--ui-primary) text-white" : "bg-(--ui-surface)"}`}
            >Week</button>
            <button
              onClick={() => setView("month")}
              className={`px-3 py-1.5 text-sm ${view === "month" ? "bg-(--ui-primary) text-white" : "bg-(--ui-surface)"}`}
            >Month</button>
          </div>
          <Button size="sm" onClick={() => shift(-1)}><ChevronLeft size={14} /></Button>
          <Button size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
          <Button size="sm" onClick={() => shift(1)}><ChevronRight size={14} /></Button>
          <span className="text-sm text-(--ui-text-muted) ml-2">
            {range.start.toLocaleDateString()} – {new Date(range.end.getTime() - 1).toLocaleDateString()}
          </span>
        </div>
      </div>

      {loading ? (
        <p className="text-(--ui-text-muted) text-sm">Loading timeline...</p>
      ) : (data.items || []).length === 0 ? (
        <EmptyState title="No rental items" body="Add rental items to see a booking timeline." />
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* Header row — date columns */}
            <div
              className="grid border-b border-(--ui-border) text-xs text-(--ui-text-muted) sticky top-0 bg-(--ui-surface)"
              style={{ gridTemplateColumns: `200px repeat(${columns.length}, minmax(48px, 1fr))` }}
            >
              <div className="p-2 font-semibold">Item</div>
              {columns.map((d, i) => (
                <div key={i} className="p-2 text-center border-l border-(--ui-border)">
                  {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              ))}
            </div>
            {/* Rows — one per rental item */}
            {(data.items || []).map(item => {
              const bookings = bookingsByItem.get(item.id) || [];
              return (
                <div
                  key={item.id}
                  className="grid border-b border-(--ui-border) min-h-12 relative"
                  style={{ gridTemplateColumns: `200px repeat(${columns.length}, minmax(48px, 1fr))` }}
                >
                  <div className="p-2 text-sm font-medium flex items-center">
                    {item.name}
                    <span className="ml-2 text-(--ui-text-muted) text-xs">({item.total_quantity})</span>
                  </div>
                  {/* Date cells for background grid */}
                  {columns.map((d, i) => (
                    <div key={i} className="border-l border-(--ui-border) min-h-12" />
                  ))}
                  {/* Booking blocks overlaid via grid spans */}
                  <div
                    className="col-start-2 absolute inset-y-0 left-[200px] right-0 grid pointer-events-none"
                    style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(48px, 1fr))` }}
                  >
                    {bookings.map((b, i) => (
                      <div
                        key={i}
                        className="m-1 rounded text-xs text-white px-2 py-1 overflow-hidden pointer-events-auto cursor-default shadow-sm"
                        style={blockStyle(b)}
                        title={`${b.contract_number} — ${b.customer_name || "Walk-in"} (${STATUS_LABELS[b.status] || b.status})`}
                      >
                        {b.contract_number} · {b.customer_name || "Walk-in"}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Small helpers ─────────────────────────────────────────────────


function Field({ label, children, full }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${full ? "col-span-2" : ""}`}>
      <span className="text-(--ui-text-muted)">{label}</span>
      {children}
    </label>
  );
}

function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-xs text-(--ui-text-muted)">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
