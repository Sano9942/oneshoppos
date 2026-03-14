import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Plus, Search, Trash2 } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";

const STATUS_LIST = ["draft", "sent", "accepted", "rejected", "expired", "converted"];
const STATUS_TONE = {
  draft: "default", sent: "info", accepted: "success",
  rejected: "danger", expired: "warning", converted: "success",
};

import { fmtLocalDate } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
const fmtDate = fmtLocalDate;
import { downloadCsv } from "../../utils/csvExport";

const EMPTY_FORM = {
  customer_id: "", outlet_id: "", employee_id: "",
  valid_until: "", discount_type: "fixed", discount_amount: 0, notes: "",
};
const EMPTY_ITEM = { product_id: "", quantity: 1, unit_price: 0, tax_rate: 0 };

export default function QuotationsRedesign() {
  const { authHeaders } = useAuth();
  const { fmt: money } = useCurrency();
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sendMsg, setSendMsg] = useState({ id: null, msg: "", ok: true });

  // Editor state
  const [editing, setEditing] = useState(null); // null = list view, else quotation obj
  const [form, setForm] = useState(EMPTY_FORM);
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [qRes, cRes, pRes, oRes, eRes] = await Promise.all([
        fetch(`${API}/api/quotations${statusFilter ? `?status=${statusFilter}` : ""}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/customers`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/products`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/outlets`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setRows(qRes.quotations || []);
      setCustomers(cRes.customers || []);
      setProducts(pRes.products || []);
      setOutlets(oRes.outlets || []);
      setEmployees(eRes.employees || []);
    } catch (e) {
      setError(e.message || "Failed to load quotations");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const subtotal = useMemo(
    () => items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0),
    [items],
  );
  const taxTotal = useMemo(
    () => items.reduce((s, it) => s + (Number(it.quantity || 0) * Number(it.unit_price || 0) * Number(it.tax_rate || 0)) / 100, 0),
    [items],
  );
  const discountValue = useMemo(
    () => form.discount_type === "percent"
      ? (subtotal * Number(form.discount_amount || 0)) / 100
      : Number(form.discount_amount || 0),
    [form.discount_type, form.discount_amount, subtotal],
  );
  const total = subtotal + taxTotal - discountValue;

  const resetEditor = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setItems([{ ...EMPTY_ITEM }]);
  };

  const openNew = () => { resetEditor(); setEditing("new"); };

  const openEdit = async (id) => {
    setError("");
    try {
      const res = await fetch(`${API}/api/quotations/${id}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load quotation");
      setEditing(data.quotation);
      setForm({
        customer_id: data.quotation.customer_id || "",
        outlet_id: data.quotation.outlet_id || "",
        employee_id: data.quotation.employee_id || "",
        valid_until: data.quotation.valid_until || "",
        discount_type: data.quotation.discount_type || "fixed",
        discount_amount: data.quotation.discount_amount || 0,
        notes: data.quotation.notes || "",
      });
      setItems(
        (data.items || []).map((it) => ({
          product_id: it.product_id,
          quantity: it.quantity,
          unit_price: it.unit_price,
          tax_rate: it.tax_rate || 0,
        })),
      );
    } catch (e) {
      setError(e.message || "Failed to load quotation");
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = { ...form, items };
      const isNew = editing === "new";
      const method = isNew ? "POST" : "PUT";
      const url = isNew ? `${API}/api/quotations` : `${API}/api/quotations/${editing.id}`;
      const res = await fetch(url, {
        method,
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save quotation");
      resetEditor();
      await load();
    } catch (e) {
      setError(e.message || "Failed to save quotation");
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (id, status) => {
    try {
      await fetch(`${API}/api/quotations/${id}/status`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ status }),
      });
      await load();
    } catch { /* silent */ }
  };

  const convert = async (id) => {
    try {
      await fetch(`${API}/api/quotations/${id}/convert`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ payment_method: "Cash" }),
      });
      await load();
    } catch { /* silent */ }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this quotation?")) return;
    try {
      await fetch(`${API}/api/quotations/${id}`, {
        method: "DELETE",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      await load();
    } catch { /* silent */ }
  };

  const sendEmail = async (id) => {
    setSendMsg({ id, msg: "Sending...", ok: true });
    try {
      const res = await fetch(`${API}/api/quotations/${id}/send`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email");
      setSendMsg({ id, msg: data.message || "Email sent", ok: true });
      await load();
    } catch (e) {
      setSendMsg({ id, msg: e.message || "Failed to send email", ok: false });
    }
    setTimeout(() => setSendMsg({ id: null, msg: "", ok: true }), 4000);
  };

  const updateItem = (idx, key, value) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [key]: value } : it)));

  const visible = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.id).includes(q) ||
        String(r.customer_name || "").toLowerCase().includes(q) ||
        String(r.status || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  // ── Editor view ──────────────────────────────────────────────────────────────
  if (editing !== null) {
    const isNew = editing === "new";
    return (
      <PageShell
        title={isNew ? "New Quotation" : `Edit Quotation #${editing?.id}`}
        subtitle={isNew ? "Create a new price quotation for a customer." : `Last updated: ${fmtDate(editing?.updated_at)}`}
        right={
          <Button onClick={resetEditor}>
            <ArrowLeft size={13} className="mr-1 inline" /> Back to list
          </Button>
        }
      >
        {error && (
          <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
        )}

        <SectionCard className="mb-4 p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-(--ui-text-muted)">Header</p>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
              <option value="">Customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <Select value={form.outlet_id} onChange={(e) => setForm((f) => ({ ...f, outlet_id: e.target.value }))}>
              <option value="">Outlet</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            <Select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}>
              <option value="">Employee</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
            <Input
              type="date"
              value={form.valid_until}
              onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
              placeholder="Valid until"
            />
          </div>
        </SectionCard>

        <SectionCard className="mb-4 p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-(--ui-text-muted)">Line Items</p>
          <div className="space-y-2">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-2 gap-2 md:grid-cols-5">
                <Select
                  value={it.product_id}
                  onChange={(e) => {
                    const prod = products.find((p) => String(p.id) === String(e.target.value));
                    updateItem(idx, "product_id", e.target.value);
                    if (prod) updateItem(idx, "unit_price", Number(prod.price || 0));
                  }}
                >
                  <option value="">Product</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={it.quantity}
                  onChange={(e) => updateItem(idx, "quantity", Number(e.target.value))}
                  placeholder="Qty"
                />
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={it.unit_price}
                  onChange={(e) => updateItem(idx, "unit_price", Number(e.target.value))}
                  placeholder="Unit Price"
                />
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={it.tax_rate}
                  onChange={(e) => updateItem(idx, "tax_rate", Number(e.target.value))}
                  placeholder="Tax %"
                />
                <div className="flex items-center justify-between rounded-lg border border-(--ui-border) px-3 py-2 text-sm">
                  <span className="font-medium text-(--ui-text)">
                    {money(Number(it.quantity || 0) * Number(it.unit_price || 0))}
                  </span>
                  <button
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-rose-600 hover:text-rose-700"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => setItems((prev) => [...prev, { ...EMPTY_ITEM }])}
          >
            <Plus size={12} className="mr-1 inline" /> Add Item
          </Button>
        </SectionCard>

        <SectionCard className="mb-4 p-4">
          <p className="mb-2 text-xs font-semibold uppercase text-(--ui-text-muted)">Discount &amp; Notes</p>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Select value={form.discount_type} onChange={(e) => setForm((f) => ({ ...f, discount_type: e.target.value }))}>
              <option value="fixed">Fixed Discount</option>
              <option value="percent">Percent Discount</option>
            </Select>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={form.discount_amount}
              onChange={(e) => setForm((f) => ({ ...f, discount_amount: e.target.value }))}
              placeholder="Discount value"
            />
            <Input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Notes"
            />
          </div>
        </SectionCard>

        {/* Totals */}
        <SectionCard className="mb-4 p-4">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-(--ui-text-muted)">
              <span>Subtotal</span><span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between text-(--ui-text-muted)">
              <span>Tax</span><span>{money(taxTotal)}</span>
            </div>
            <div className="flex justify-between text-(--ui-text-muted)">
              <span>Discount</span><span>-{money(discountValue)}</span>
            </div>
            <div className="flex justify-between border-t border-(--ui-border) pt-1 font-bold text-(--ui-text)">
              <span>Total</span><span>{money(total)}</span>
            </div>
          </div>
        </SectionCard>

        <div className="flex gap-2">
          <Button onClick={resetEditor}>Cancel</Button>
          <Button tone="primary" onClick={save} disabled={saving}>
            {saving ? "Saving..." : isNew ? "Create Quotation" : "Save Changes"}
          </Button>
        </div>
      </PageShell>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────────
  return (
    <PageShell
      title="Quotations"
      subtitle="Create and manage price quotations for customers."
      right={
        <div className="flex gap-2">
          <Button onClick={() => downloadCsv(["id","customer","status","valid_until","total"], visible.map(q => [q.id, q.customer_name||"", q.status||"", q.valid_until||"", q.grand_total||q.total||0]), "quotations")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openNew}>
            <Plus size={14} className="mr-1 inline" /> New Quotation
          </Button>
        </div>
      }
    >
      {error && (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
      )}

      <SectionCard>
        <TableToolbar
          left={
            <div className="flex flex-wrap gap-2">
              <div className="relative min-w-55">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                <Input
                  className="pl-8"
                  placeholder="Search quotations"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-36">
                <option value="">All statuses</option>
                {STATUS_LIST.map((s) => (
                  <option key={s} value={s} className="capitalize">{s}</option>
                ))}
              </Select>
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visible.length} quotations</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Valid Until</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visible.map((q) => (
                  <tr key={q.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2 font-medium text-(--ui-text)">#{q.id}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{q.customer_name || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[q.status] || "default"} className="capitalize">{q.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">{fmtDate(q.valid_until)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">{money(q.total_amount)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex flex-col items-end gap-1">
                        <div className="inline-flex flex-wrap justify-end gap-1">
                          <Button size="sm" onClick={() => openEdit(q.id)}>Edit</Button>
                          {q.status === "draft" && (
                            <Button size="sm" onClick={() => setStatus(q.id, "sent")}>Mark Sent</Button>
                          )}
                          {(q.status === "draft" || q.status === "sent") && (
                            <Button size="sm" tone="info" onClick={() => sendEmail(q.id)}
                              disabled={sendMsg.id === q.id && sendMsg.msg === "Sending..."}>
                              Send Email
                            </Button>
                          )}
                          {q.status === "accepted" && (
                            <Button size="sm" tone="primary" onClick={() => convert(q.id)}>Convert</Button>
                          )}
                          <Button size="sm" tone="danger" onClick={() => remove(q.id)}>
                            <Trash2 size={11} />
                          </Button>
                        </div>
                        {sendMsg.id === q.id && sendMsg.msg && (
                          <span className={`text-xs ${sendMsg.ok ? "text-emerald-600" : "text-rose-600"}`}>
                            {sendMsg.msg}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading quotations...</div>}
          {!loading && visible.length === 0 && (
            <EmptyState title="No quotations" body="Create your first quotation to get started." />
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}
