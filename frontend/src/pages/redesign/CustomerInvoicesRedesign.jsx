import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Plus, Send, CreditCard, Ban, FileText, Link2, Download, X, Trash2 } from "lucide-react";
import { fmtUtcDateTime, fmtUtcDate } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import api from "../../api";

const STATUS_TONES = { draft: "default", sent: "warning", partial: "warning", paid: "success", overdue: "danger", void: "default" };

export default function CustomerInvoicesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [customers, setCustomers] = useState([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ customer_id: "", due_date: "", notes: "", discount_amount: 0, items: [{ description: "", quantity: 1, unit_price: 0, tax_rate: 0 }] });
  const [saving, setSaving] = useState(false);

  // Detail modal
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [payments, setPayments] = useState([]);

  // Payment modal
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", payment_method: "cash", payment_type: "payment", reference: "", notes: "" });

  // Batch modal
  const [showBatch, setShowBatch] = useState(false);
  const [batchForm, setBatchForm] = useState({ customer_ids: [], items: [{ description: "", quantity: 1, unit_price: 0, tax_rate: 0 }], due_date: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const params = statusFilter ? `?status=${statusFilter}` : "";
    const [inv, cust] = await Promise.all([
      api.get(`/customer-invoices${params}`).catch(() => ({ invoices: [], total: 0 })),
      api.get("/customers?limit=500").catch(() => ({ customers: [] })),
    ]);
    setInvoices(inv.invoices || []);
    setTotal(inv.total || 0);
    setCustomers(cust.customers || cust.rows || []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  if (!flagsLoading && !flags.customer_invoicing) return <Navigate to="/dashboard" replace />;

  const addItem = (formSetter, currentForm) => {
    formSetter({ ...currentForm, items: [...currentForm.items, { description: "", quantity: 1, unit_price: 0, tax_rate: 0 }] });
  };
  const removeItem = (formSetter, currentForm, idx) => {
    if (currentForm.items.length <= 1) return;
    formSetter({ ...currentForm, items: currentForm.items.filter((_, i) => i !== idx) });
  };
  const updateItem = (formSetter, currentForm, idx, field, value) => {
    formSetter({ ...currentForm, items: currentForm.items.map((item, i) => i === idx ? { ...item, [field]: value } : item) });
  };

  const computeTotal = (items, discount = 0) => {
    const sub = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
    const tax = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price) * (Number(i.tax_rate) / 100), 0);
    return Math.max(sub + tax - Number(discount), 0);
  };

  const createInvoice = async () => {
    setSaving(true);
    try {
      await api.post("/customer-invoices", {
        customer_id: Number(form.customer_id),
        items: form.items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), tax_rate: Number(i.tax_rate) })),
        due_date: form.due_date || undefined,
        notes: form.notes || undefined,
        discount_amount: Number(form.discount_amount) || 0,
      });
      toast.success("Invoice created");
      setShowCreate(false);
      load();
    } catch (err) { toast.error(err.message); }
    setSaving(false);
  };

  const openDetail = async (inv) => {
    setSelectedInvoice(inv);
    try {
      const [items, pmts] = await Promise.all([
        api.get(`/customer-invoices?customer_id=${inv.customer_id}&limit=1`).then(() =>
          // Fetch items by getting the invoice detail (items embedded in list response isn't available, so we handle separately)
          api.get(`/customer-invoices?status=&limit=1`).catch(() => ({ invoices: [] }))
        ).catch(() => []),
        Promise.resolve([]), // payments are loaded separately
      ]);
    } catch {}
  };

  const sendInvoice = async (id) => {
    try {
      await api.post(`/customer-invoices/${id}/send`);
      toast.success("Invoice sent");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const voidInvoice = async (id) => {
    try {
      await api.put(`/customer-invoices/${id}/void`);
      toast.success("Invoice voided");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const recordPayment = async (invoiceId) => {
    try {
      await api.post(`/customer-invoices/${invoiceId}/payments`, {
        amount: Number(paymentForm.amount),
        payment_method: paymentForm.payment_method,
        payment_type: paymentForm.payment_type,
        reference: paymentForm.reference || undefined,
        notes: paymentForm.notes || undefined,
      });
      toast.success("Payment recorded");
      setShowPayment(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const generatePaymentLink = async (id) => {
    try {
      const result = await api.post(`/customer-invoices/${id}/payment-link`);
      toast.success("Payment link generated");
      navigator.clipboard?.writeText(result.link_url);
    } catch (err) { toast.error(err.message); }
  };

  const sendReminder = async (id) => {
    try {
      await api.post(`/customer-invoices/${id}/reminders/run`);
      toast.success("Reminder sent");
    } catch (err) { toast.error(err.message); }
  };

  const createBatch = async () => {
    try {
      const result = await api.post("/customer-invoices/batch", {
        customer_ids: batchForm.customer_ids.map(Number),
        items: batchForm.items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), tax_rate: Number(i.tax_rate) })),
        due_date: batchForm.due_date || undefined,
      });
      toast.success(`${result.created} invoice(s) created`);
      setShowBatch(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const exportCsv = () => {
    downloadCsv(
      ["Invoice #", "Customer", "Status", "Total", "Paid", "Balance", "Due Date", "Created"],
      invoices.map((i) => [i.invoice_number, i.customer_name, i.status, i.total_amount, i.amount_paid, i.balance_due, i.due_date || "", fmtUtcDateTime(i.created_at)]),
      "customer-invoices.csv"
    );
  };

  const ItemsEditor = ({ items, onAdd, onRemove, onUpdate }) => (
    <div>
      <div className="flex justify-between items-center mb-2">
        <label className="text-sm font-medium">Line Items</label>
        <Button size="sm" tone="plain" onClick={onAdd}><Plus className="w-3 h-3 mr-1" />Add</Button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 mb-2 items-start">
          <input className="grow border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg)" placeholder="Description" value={item.description} onChange={(e) => onUpdate(i, "description", e.target.value)} />
          <input className="w-16 border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg)" type="number" placeholder="Qty" value={item.quantity} onChange={(e) => onUpdate(i, "quantity", e.target.value)} />
          <input className="w-24 border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg)" type="number" placeholder="Price" value={item.unit_price} onChange={(e) => onUpdate(i, "unit_price", e.target.value)} />
          <input className="w-16 border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg)" type="number" placeholder="Tax %" value={item.tax_rate} onChange={(e) => onUpdate(i, "tax_rate", e.target.value)} />
          <button onClick={() => onRemove(i)} className="text-red-500 p-1"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );

  return (
    <PageShell title="Customer Invoices" right={
      <div className="flex gap-2">
        <Button tone="plain" onClick={exportCsv}><Download className="w-4 h-4 mr-1" />CSV</Button>
        <Button tone="plain" onClick={() => setShowBatch(true)}>Batch</Button>
        <Button onClick={() => { setForm({ customer_id: "", due_date: "", notes: "", discount_amount: 0, items: [{ description: "", quantity: 1, unit_price: 0, tax_rate: 0 }] }); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-1" />New Invoice
        </Button>
      </div>
    }>
      <SectionCard>
        <div className="flex gap-2 mb-4">
          {["", "draft", "sent", "partial", "paid", "overdue", "void"].map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-full text-sm ${statusFilter === s ? "bg-(--ui-primary) text-white" : "bg-(--ui-bg-hover) text-(--ui-text)"}`}>
              {s || "All"}
            </button>
          ))}
        </div>

        {loading ? <p className="text-(--ui-text-muted) text-center py-8">Loading...</p> :
          invoices.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No invoices found</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-(--ui-border)">
                <th className="text-left py-2 px-3 font-medium">Invoice #</th>
                <th className="text-left py-2 px-3 font-medium">Customer</th>
                <th className="text-left py-2 px-3 font-medium">Status</th>
                <th className="text-right py-2 px-3 font-medium">Total</th>
                <th className="text-right py-2 px-3 font-medium">Balance</th>
                <th className="text-left py-2 px-3 font-medium">Due</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr></thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover)">
                    <td className="py-2 px-3 font-mono">{inv.invoice_number}</td>
                    <td className="py-2 px-3">{inv.customer_name}</td>
                    <td className="py-2 px-3"><Badge tone={STATUS_TONES[inv.is_overdue ? "overdue" : inv.status]}>{inv.is_overdue ? "overdue" : inv.status}</Badge></td>
                    <td className="py-2 px-3 text-right">{fmt(inv.total_amount)}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmt(inv.balance_due)}</td>
                    <td className="py-2 px-3 text-(--ui-text-muted)">{inv.due_date ? fmtUtcDate(inv.due_date) : "—"}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        {inv.status !== "void" && inv.status !== "paid" && <>
                          <button onClick={() => sendInvoice(inv.id)} title="Send" className="p-1 rounded hover:bg-(--ui-bg-hover)"><Send className="w-4 h-4" /></button>
                          <button onClick={() => { setSelectedInvoice(inv); setPaymentForm({ amount: "", payment_method: "cash", payment_type: "payment", reference: "", notes: "" }); setShowPayment(true); }} title="Record payment" className="p-1 rounded hover:bg-(--ui-bg-hover)"><CreditCard className="w-4 h-4" /></button>
                          <button onClick={() => sendReminder(inv.id)} title="Send reminder" className="p-1 rounded hover:bg-(--ui-bg-hover)"><FileText className="w-4 h-4" /></button>
                          {flags.payment_links && <button onClick={() => generatePaymentLink(inv.id)} title="Payment link" className="p-1 rounded hover:bg-(--ui-bg-hover)"><Link2 className="w-4 h-4" /></button>}
                        </>}
                        {inv.status === "draft" && <button onClick={() => voidInvoice(inv.id)} title="Void" className="p-1 rounded hover:bg-(--ui-bg-hover) text-red-500"><Ban className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* Create Invoice Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">New Invoice</h2>
              <button onClick={() => setShowCreate(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Customer</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
                  <option value="">Select customer...</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <ItemsEditor items={form.items}
                onAdd={() => addItem(setForm, form)}
                onRemove={(i) => removeItem(setForm, form, i)}
                onUpdate={(i, f, v) => updateItem(setForm, form, i, f, v)} />
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Due Date</label>
                  <input type="date" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
                <div><label className="block text-sm font-medium mb-1">Discount</label>
                  <input type="number" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.discount_amount} onChange={(e) => setForm({ ...form, discount_amount: e.target.value })} /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Notes</label>
                <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              <p className="text-right font-bold">Total: {fmt(computeTotal(form.items, form.discount_amount))}</p>
              <div className="flex gap-2 justify-end">
                <Button tone="plain" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button onClick={createInvoice} disabled={saving || !form.customer_id || !form.items[0]?.description}>{saving ? "Creating..." : "Create Invoice"}</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {showPayment && selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Record Payment — {selectedInvoice.invoice_number}</h2>
              <button onClick={() => setShowPayment(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Amount</label>
                <input type="number" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder={`Balance: ${fmt(selectedInvoice.balance_due)}`} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium mb-1">Method</label>
                  <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })}>
                    <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option><option value="cheque">Cheque</option><option value="online">Online</option>
                  </select></div>
                <div><label className="block text-sm font-medium mb-1">Type</label>
                  <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={paymentForm.payment_type} onChange={(e) => setPaymentForm({ ...paymentForm, payment_type: e.target.value })}>
                    <option value="payment">Payment</option><option value="deposit">Deposit</option><option value="refund">Refund</option>
                  </select></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Reference</label>
                <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} /></div>
              <div className="flex gap-2 justify-end">
                <Button tone="plain" onClick={() => setShowPayment(false)}>Cancel</Button>
                <Button onClick={() => recordPayment(selectedInvoice.id)} disabled={!paymentForm.amount || Number(paymentForm.amount) <= 0}>Record</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Create Modal */}
      {showBatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">Batch Create Invoices</h2>
              <button onClick={() => setShowBatch(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Select Customers</label>
                <select multiple className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) min-h-[100px]"
                  value={batchForm.customer_ids} onChange={(e) => setBatchForm({ ...batchForm, customer_ids: Array.from(e.target.selectedOptions, (o) => o.value) })}>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <p className="text-xs text-(--ui-text-muted) mt-1">{batchForm.customer_ids.length} selected (hold Ctrl to multi-select)</p>
              </div>
              <ItemsEditor items={batchForm.items}
                onAdd={() => addItem(setBatchForm, batchForm)}
                onRemove={(i) => removeItem(setBatchForm, batchForm, i)}
                onUpdate={(i, f, v) => updateItem(setBatchForm, batchForm, i, f, v)} />
              <div><label className="block text-sm font-medium mb-1">Due Date</label>
                <input type="date" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={batchForm.due_date} onChange={(e) => setBatchForm({ ...batchForm, due_date: e.target.value })} /></div>
              <div className="flex gap-2 justify-end">
                <Button tone="plain" onClick={() => setShowBatch(false)}>Cancel</Button>
                <Button onClick={createBatch} disabled={batchForm.customer_ids.length === 0}>Create {batchForm.customer_ids.length} Invoice(s)</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
