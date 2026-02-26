import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, RefreshCw, X } from "lucide-react";
import { API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const STATUS_TONE = {
  paid: "success",
  partial: "warning",
  unpaid: "danger",
};

function money(n) {
  return `PKRs ${Number(n || 0).toFixed(2)}`;
}

function calcDue(inv) {
  return Number(inv.amount_due ?? Number(inv.amount || 0) - Number(inv.amount_paid || 0));
}

export default function SupplierPayablesRedesign() {
  const { authHeaders } = useAuth();
  const [tab, setTab] = useState("aging");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [aging, setAging] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [filterStatus, setFilterStatus] = useState("unpaid");

  const [expandedSupplierId, setExpandedSupplierId] = useState(null);
  const [supplierInvoices, setSupplierInvoices] = useState({});

  const [payModal, setPayModal] = useState(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [payBy, setPayBy] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paying, setPaying] = useState(false);

  const fetchAging = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/supplier-aging`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load supplier aging");
      setAging(data.aging || []);
    } catch (e) {
      setAging([]);
      setError(e.message || "Failed to load supplier aging");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetch(`${API}/supplier-invoices?${params.toString()}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load supplier invoices");
      setInvoices(data.invoices || []);
    } catch (e) {
      setInvoices([]);
      setError(e.message || "Failed to load supplier invoices");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, filterStatus]);

  const refreshCurrent = useCallback(async () => {
    if (tab === "aging") await fetchAging();
    else await fetchInvoices();
  }, [tab, fetchAging, fetchInvoices]);

  useEffect(() => {
    refreshCurrent();
  }, [refreshCurrent]);

  const toggleSupplier = async (supplierId) => {
    if (expandedSupplierId === supplierId) {
      setExpandedSupplierId(null);
      return;
    }
    setExpandedSupplierId(supplierId);
    if (supplierInvoices[supplierId]) return;
    try {
      const res = await fetch(`${API}/supplier-invoices?supplier_id=${supplierId}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      setSupplierInvoices((prev) => ({ ...prev, [supplierId]: data.invoices || [] }));
    } catch {
      setSupplierInvoices((prev) => ({ ...prev, [supplierId]: [] }));
    }
  };

  const openPayModal = (inv) => {
    const due = calcDue(inv);
    setPayModal(inv);
    setPayAmount(due.toFixed(2));
    setPayMethod("Cash");
    setPayRef("");
    setPayBy("");
    setPayNotes("");
  };

  const closePayModal = () => {
    setPayModal(null);
    setPayAmount("");
    setPayMethod("Cash");
    setPayRef("");
    setPayBy("");
    setPayNotes("");
  };

  const handlePay = async () => {
    if (!payModal) return;
    const amount = Number(payAmount || 0);
    if (amount <= 0) {
      setError("Payment amount must be greater than zero.");
      return;
    }
    setPaying(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/supplier-invoices/${payModal.id}/pay`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          payment_method: payMethod,
          reference: payRef,
          paid_by: payBy,
          notes: payNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setNotice("Payment recorded successfully.");
      closePayModal();
      setSupplierInvoices({});
      await fetchAging();
      if (tab === "invoices") await fetchInvoices();
    } catch (e) {
      setError(e.message || "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  const totalOutstanding = aging.reduce((sum, row) => sum + Number(row.total_due || 0), 0);

  return (
    <PageShell
      title="Supplier Payables"
      subtitle="Wave B redesign: monitor supplier outstanding balances and record invoice payments."
      right={
        <Button onClick={refreshCurrent}>
          <RefreshCw size={13} className="mr-1 inline" />
          Refresh
        </Button>
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

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Suppliers With Due</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">{aging.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Open Invoices</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">
            {invoices.filter((inv) => inv.status !== "paid").length}
          </p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-[var(--ui-text-muted)]">Total Outstanding</p>
          <p className="text-2xl font-semibold text-[var(--ui-text)]">{money(totalOutstanding)}</p>
        </SectionCard>
      </div>

      <SectionCard className="mb-3">
        <TableToolbar
          left={
            <div className="inline-flex gap-2">
              {[
                { id: "aging", label: "Aging Summary" },
                { id: "invoices", label: "All Invoices" },
              ].map((t) => (
                <Button
                  key={t.id}
                  tone={tab === t.id ? "primary" : "default"}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </Button>
              ))}
            </div>
          }
          right={
            tab === "invoices" ? (
              <div className="inline-flex gap-2">
                {["unpaid", "partial", "paid", ""].map((status) => (
                  <Button
                    key={status || "all"}
                    size="sm"
                    tone={filterStatus === status ? "primary" : "default"}
                    onClick={() => setFilterStatus(status)}
                  >
                    {status || "all"}
                  </Button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[var(--ui-text-muted)]">Click a supplier row to expand invoices</span>
            )
          }
        />
      </SectionCard>

      {loading ? (
        <SectionCard className="p-8 text-center text-sm text-[var(--ui-text-muted)]">Loading...</SectionCard>
      ) : null}

      {!loading && tab === "aging" ? (
        <SectionCard>
          <div className="overflow-auto">
            <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
              <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-left">Phone</th>
                  <th className="px-3 py-2 text-right">Invoices</th>
                  <th className="px-3 py-2 text-right">Invoiced</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Details</th>
                </tr>
              </thead>
              <tbody>
                {aging.map((row) => (
                  <Fragment key={row.id}>
                    <tr
                      className="cursor-pointer border-t border-[var(--ui-border)] hover:bg-[var(--ui-muted-surface)]"
                      onClick={() => toggleSupplier(row.id)}
                    >
                      <td className="px-3 py-2 font-medium text-[var(--ui-text)]">{row.supplier_name}</td>
                      <td className="px-3 py-2 text-[var(--ui-text-muted)]">{row.phone || "-"}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text)]">{row.invoice_count}</td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text)]">{money(row.total_invoiced)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{money(row.total_paid)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-700">
                        {money(row.total_due)}
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--ui-text-muted)]">
                        {expandedSupplierId === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {expandedSupplierId === row.id ? (
                      <tr className="border-t border-[var(--ui-border)] bg-[var(--ui-muted-surface)]/70">
                        <td colSpan={7} className="px-4 py-3">
                          {(supplierInvoices[row.id] || []).length === 0 ? (
                            <p className="text-xs text-[var(--ui-text-muted)]">No invoices found</p>
                          ) : (
                            <table className="min-w-full text-xs">
                              <thead className="text-[var(--ui-text-muted)]">
                                <tr>
                                  <th className="py-1 text-left">Invoice</th>
                                  <th className="py-1 text-right">Amount</th>
                                  <th className="py-1 text-right">Paid</th>
                                  <th className="py-1 text-right">Due</th>
                                  <th className="py-1 text-left">Status</th>
                                  <th className="py-1 text-left">Date</th>
                                  <th className="py-1 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(supplierInvoices[row.id] || []).map((inv) => (
                                  <tr key={inv.id} className="border-t border-[var(--ui-border)]">
                                    <td className="py-1.5 font-mono text-[var(--ui-text)]">
                                      {inv.invoice_number || `#${inv.id}`}
                                    </td>
                                    <td className="py-1.5 text-right text-[var(--ui-text)]">{money(inv.amount)}</td>
                                    <td className="py-1.5 text-right text-emerald-700">{money(inv.amount_paid)}</td>
                                    <td className="py-1.5 text-right font-semibold text-rose-700">
                                      {money(calcDue(inv))}
                                    </td>
                                    <td className="py-1.5">
                                      <Badge tone={STATUS_TONE[inv.status] || "default"}>{inv.status}</Badge>
                                    </td>
                                    <td className="py-1.5 text-[var(--ui-text-muted)]">
                                      {new Date(inv.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="py-1.5 text-right">
                                      {inv.status !== "paid" ? (
                                        <Button
                                          size="sm"
                                          tone="primary"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openPayModal(inv);
                                          }}
                                        >
                                          Pay
                                        </Button>
                                      ) : null}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {!aging.length ? (
            <EmptyState
              title="No outstanding payables"
              body="Supplier aging will appear here when invoices are generated."
            />
          ) : null}
        </SectionCard>
      ) : null}

      {!loading && tab === "invoices" ? (
        <SectionCard>
          <div className="overflow-auto">
            <table className="min-w-full border-t border-[var(--ui-border)] text-sm">
              <thead className="bg-[var(--ui-muted-surface)] text-xs uppercase text-[var(--ui-text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Supplier</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Due</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className="border-t border-[var(--ui-border)]">
                    <td className="px-3 py-2 font-mono text-[var(--ui-text)]">
                      {inv.invoice_number || `#${inv.id}`}
                    </td>
                    <td className="px-3 py-2 text-[var(--ui-text)]">{inv.supplier_name}</td>
                    <td className="px-3 py-2 text-right text-[var(--ui-text)]">{money(inv.amount)}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">{money(inv.amount_paid)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-rose-700">{money(calcDue(inv))}</td>
                    <td className="px-3 py-2">
                      <Badge tone={STATUS_TONE[inv.status] || "default"}>{inv.status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-[var(--ui-text-muted)]">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {inv.status !== "paid" ? (
                        <Button size="sm" tone="primary" onClick={() => openPayModal(inv)}>
                          Pay
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!invoices.length ? (
            <EmptyState
              title="No invoices found"
              body="Adjust filters or receive purchase orders to generate supplier invoices."
            />
          ) : null}
        </SectionCard>
      ) : null}

      {payModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-[var(--ui-text)]">Record Payment</h3>
              <button className="text-[var(--ui-text-muted)] hover:text-[var(--ui-text)]" onClick={closePayModal}>
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 rounded border border-[var(--ui-border)] bg-[var(--ui-muted-surface)] p-3 text-sm">
              <p className="text-[var(--ui-text-muted)]">
                Invoice: <span className="font-mono text-[var(--ui-text)]">{payModal.invoice_number || `#${payModal.id}`}</span>
              </p>
              <p className="text-[var(--ui-text-muted)]">
                Supplier: <span className="text-[var(--ui-text)]">{payModal.supplier_name}</span>
              </p>
              <p className="text-[var(--ui-text-muted)]">
                Outstanding: <span className="font-semibold text-rose-700">{money(calcDue(payModal))}</span>
              </p>
            </div>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs text-[var(--ui-text-muted)]">Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--ui-text-muted)]">Payment Method</label>
                <div className="flex gap-2">
                  {["Cash", "Bank Transfer", "Cheque"].map((m) => (
                    <Button
                      key={m}
                      size="sm"
                      tone={payMethod === m ? "primary" : "default"}
                      onClick={() => setPayMethod(m)}
                    >
                      {m}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-[var(--ui-text-muted)]">Reference</label>
                  <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Cheque/transfer ref" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-[var(--ui-text-muted)]">Paid By</label>
                  <Input value={payBy} onChange={(e) => setPayBy(e.target.value)} placeholder="Name" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--ui-text-muted)]">Notes</label>
                <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} />
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={closePayModal}>Cancel</Button>
              <Button
                tone="primary"
                onClick={handlePay}
                disabled={paying || !payAmount || Number(payAmount) <= 0}
              >
                {paying ? "Recording..." : "Record Payment"}
              </Button>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
