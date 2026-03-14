import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, RefreshCw, X, BookOpen, Ban } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtLocalDate as fmtDate } from "../../utils/dates";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";

const STATUS_TONE = {
  paid: "success",
  partial: "warning",
  unpaid: "danger",
};

function calcDue(inv) {
  return Number(inv.amount_due ?? Number(inv.amount || 0) - Number(inv.amount_paid || 0));
}

export default function SupplierPayablesRedesign() {
  const { authHeaders, hasPerm } = useAuth();
  const { fmt: money } = useCurrency();
  const isAdmin = hasPerm("all_access");
  const [tab, setTab] = useState("aging");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [voidModal, setVoidModal] = useState(null); // { payment }
  const [voidReason, setVoidReason] = useState("");
  const [voiding, setVoiding] = useState(false);

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

  // Invoice payment expansion (for Void)
  const [expandedInvoiceId, setExpandedInvoiceId] = useState(null);
  const [invoicePayments, setInvoicePayments] = useState({});

  // Ledger state
  const [suppliers, setSuppliers] = useState([]);
  const [ledgerSupplierId, setLedgerSupplierId] = useState("");
  const [ledgerFrom, setLedgerFrom] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [ledgerTo, setLedgerTo] = useState(new Date().toISOString().slice(0, 10));
  const [ledger, setLedger] = useState(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  const fetchAging = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/supplier-aging`, { headers: authHeaders() });
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
      const res = await fetch(`${API}/api/supplier-invoices?${params.toString()}`, {
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

  // Load supplier list for ledger dropdown
  useEffect(() => {
    fetch(`${API}/api/suppliers`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setSuppliers(d.suppliers || []))
      .catch(() => {});
  }, [authHeaders]);

  const fetchLedger = useCallback(async () => {
    if (!ledgerSupplierId) return;
    setLedgerLoading(true);
    try {
      const q = new URLSearchParams({ from: ledgerFrom, to: ledgerTo });
      const res = await fetch(`${API}/api/supplier-ledger/${ledgerSupplierId}?${q}`, { headers: authHeaders() });
      const data = await res.json();
      setLedger(res.ok ? data : null);
    } catch { setLedger(null); } finally { setLedgerLoading(false); }
  }, [ledgerSupplierId, ledgerFrom, ledgerTo, authHeaders]);

  const toggleSupplier = async (supplierId) => {
    if (expandedSupplierId === supplierId) {
      setExpandedSupplierId(null);
      return;
    }
    setExpandedSupplierId(supplierId);
    if (supplierInvoices[supplierId]) return;
    try {
      const res = await fetch(`${API}/api/supplier-invoices?supplier_id=${supplierId}`, {
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
      const res = await fetch(`${API}/api/supplier-invoices/${payModal.id}/pay`, {
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

  const toggleInvoicePayments = async (invId) => {
    if (expandedInvoiceId === invId) { setExpandedInvoiceId(null); return; }
    setExpandedInvoiceId(invId);
    if (invoicePayments[invId]) return;
    try {
      const res = await fetch(`${API}/api/supplier-invoices/${invId}`, { headers: authHeaders() });
      const data = await res.json();
      setInvoicePayments((prev) => ({ ...prev, [invId]: data.payments || [] }));
    } catch { setInvoicePayments((prev) => ({ ...prev, [invId]: [] })); }
  };

  const openVoidModal = (payment) => {
    setVoidModal(payment);
    setVoidReason("");
  };

  const handleVoid = async () => {
    if (!voidModal) return;
    setVoiding(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`${API}/api/supplier-payments/${voidModal.id}/void`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ reason: voidReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to void payment");
      setNotice("Payment voided successfully.");
      setVoidModal(null);
      setVoidReason("");
      setSupplierInvoices({});
      setInvoicePayments({});
      await fetchAging();
      if (tab === "invoices") await fetchInvoices();
    } catch (e) {
      setError(e.message || "Failed to void payment");
    } finally {
      setVoiding(false);
    }
  };

  const totalOutstanding = aging.reduce((sum, row) => sum + Number(row.total_due || 0), 0);

  return (
    <PageShell
      title="Supplier Payables"
      subtitle="monitor supplier outstanding balances and record invoice payments."
      right={
        <div className="flex gap-2">
          <Button onClick={() => {
            if (tab === "aging") downloadCsv(["supplier","0_30","31_60","61_90","over_90","total"], aging.map(a => [a.supplier_name||"", a.days_0_30||0, a.days_31_60||0, a.days_61_90||0, a.over_90||0, a.total_outstanding||0]), "supplier_aging");
            else if (tab === "invoices") downloadCsv(["invoice","supplier","date","reference","amount","paid","balance","status"], invoices.map(i => [i.invoice_number||i.id, i.supplier_name||"", i.invoice_date||"", i.reference_number||"", i.amount||0, i.amount_paid||0, calcDue(i), i.status||""]), "supplier_invoices");
            else downloadCsv(["date","invoice","supplier","description","debit","credit","balance"], (ledger?.entries||[]).map(l => [l.date||"", l.invoice_number||"", l.supplier_name||"", l.description||"", l.debit||0, l.credit||0, l.balance||0]), "supplier_ledger");
          }}><Download size={13} className="mr-1 inline" />Export CSV</Button>
          <Button onClick={refreshCurrent}>
            <RefreshCw size={13} className="mr-1 inline" />
            Refresh
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

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Suppliers With Due</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{aging.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Open Invoices</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {invoices.filter((inv) => inv.status !== "paid").length}
          </p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Outstanding</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{money(totalOutstanding)}</p>
        </SectionCard>
      </div>

      <SectionCard className="mb-3">
        <TableToolbar
          left={
            <div className="inline-flex gap-2">
              {[
                { id: "aging", label: "Aging Summary" },
                { id: "invoices", label: "All Invoices" },
                { id: "ledger", label: "Supplier Ledger" },
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
              <span className="text-xs text-(--ui-text-muted)">Click a supplier row to expand invoices</span>
            )
          }
        />
      </SectionCard>

      {loading ? (
        <SectionCard className="p-8 text-center text-sm text-(--ui-text-muted)">Loading...</SectionCard>
      ) : null}

      {!loading && tab === "aging" ? (
        <SectionCard>
          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
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
                      className="cursor-pointer border-t border-(--ui-border) hover:bg-(--ui-muted-surface)"
                      onClick={() => toggleSupplier(row.id)}
                    >
                      <td className="px-3 py-2 font-medium text-(--ui-text)">{row.supplier_name}</td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">{row.phone || "-"}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{row.invoice_count}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{money(row.total_invoiced)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{money(row.total_paid)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-700">
                        {money(row.total_due)}
                      </td>
                      <td className="px-3 py-2 text-right text-(--ui-text-muted)">
                        {expandedSupplierId === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </td>
                    </tr>
                    {expandedSupplierId === row.id ? (
                      <tr className="border-t border-(--ui-border) bg-(--ui-muted-surface)/70">
                        <td colSpan={7} className="px-4 py-3">
                          {(supplierInvoices[row.id] || []).length === 0 ? (
                            <p className="text-xs text-(--ui-text-muted)">No invoices found</p>
                          ) : (
                            <table className="min-w-full text-xs">
                              <thead className="text-(--ui-text-muted)">
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
                                  <tr key={inv.id} className="border-t border-(--ui-border)">
                                    <td className="py-1.5 font-mono text-(--ui-text)">
                                      {inv.invoice_number || `#${inv.id}`}
                                    </td>
                                    <td className="py-1.5 text-right text-(--ui-text)">{money(inv.amount)}</td>
                                    <td className="py-1.5 text-right text-emerald-700">{money(inv.amount_paid)}</td>
                                    <td className="py-1.5 text-right font-semibold text-rose-700">
                                      {money(calcDue(inv))}
                                    </td>
                                    <td className="py-1.5">
                                      <Badge tone={STATUS_TONE[inv.status] || "default"}>{inv.status}</Badge>
                                    </td>
                                    <td className="py-1.5 text-(--ui-text-muted)">
                                      {fmtDate(inv.created_at)}
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
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
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
                  <Fragment key={inv.id}>
                    <tr className="border-t border-(--ui-border)">
                      <td className="px-3 py-2 font-mono text-(--ui-text)">
                        {inv.invoice_number || `#${inv.id}`}
                      </td>
                      <td className="px-3 py-2 text-(--ui-text)">{inv.supplier_name}</td>
                      <td className="px-3 py-2 text-right text-(--ui-text)">{money(inv.amount)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{money(inv.amount_paid)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-rose-700">{money(calcDue(inv))}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[inv.status] || "default"}>{inv.status}</Badge>
                      </td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">
                        {fmtDate(inv.created_at)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="inline-flex gap-2">
                          {inv.status !== "paid" ? (
                            <Button size="sm" tone="primary" onClick={() => openPayModal(inv)}>Pay</Button>
                          ) : null}
                          {isAdmin ? (
                            <Button size="sm" onClick={() => toggleInvoicePayments(inv.id)}>
                              {expandedInvoiceId === inv.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                    {isAdmin && expandedInvoiceId === inv.id ? (
                      <tr className="border-t border-(--ui-border) bg-(--ui-muted-surface)/70">
                        <td colSpan={8} className="px-4 py-3">
                          {(invoicePayments[inv.id] || []).length === 0 ? (
                            <p className="text-xs text-(--ui-text-muted)">No payments recorded</p>
                          ) : (
                            <table className="min-w-full text-xs">
                              <thead className="text-(--ui-text-muted)">
                                <tr>
                                  <th className="py-1 text-left">Date</th>
                                  <th className="py-1 text-right">Amount</th>
                                  <th className="py-1 text-left">Method</th>
                                  <th className="py-1 text-left">Reference</th>
                                  <th className="py-1 text-left">Status</th>
                                  {isAdmin ? <th className="py-1 text-right">Action</th> : null}
                                </tr>
                              </thead>
                              <tbody>
                                {(invoicePayments[inv.id] || []).map((pmt) => (
                                  <tr key={pmt.id} className={`border-t border-(--ui-border) ${pmt.voided ? "opacity-50" : ""}`}>
                                    <td className="py-1.5 text-(--ui-text-muted)">{pmt.paid_at?.slice(0, 10) || "-"}</td>
                                    <td className="py-1.5 text-right text-emerald-700 font-medium">{money(pmt.amount)}</td>
                                    <td className="py-1.5 text-(--ui-text)">{pmt.payment_method || "-"}</td>
                                    <td className="py-1.5 font-mono text-(--ui-text-muted)">{pmt.reference || "-"}</td>
                                    <td className="py-1.5">
                                      {pmt.voided ? (
                                        <Badge tone="danger">Voided{pmt.void_reason ? `: ${pmt.void_reason}` : ""}</Badge>
                                      ) : (
                                        <Badge tone="success">Active</Badge>
                                      )}
                                    </td>
                                    {isAdmin ? (
                                      <td className="py-1.5 text-right">
                                        {!pmt.voided ? (
                                          <Button size="sm" tone="danger" onClick={() => openVoidModal(pmt)}>
                                            <Ban size={10} className="mr-1 inline" />Void
                                          </Button>
                                        ) : null}
                                      </td>
                                    ) : null}
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
          {!invoices.length ? (
            <EmptyState
              title="No invoices found"
              body="Adjust filters or receive purchase orders to generate supplier invoices."
            />
          ) : null}
        </SectionCard>
      ) : null}

      {/* ── Supplier Ledger ── */}
      {!loading && tab === "ledger" ? (
        <div className="space-y-3">
          <SectionCard className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-(--ui-text-muted) block mb-1">Supplier</label>
                <select
                  value={ledgerSupplierId}
                  onChange={(e) => setLedgerSupplierId(e.target.value)}
                  className="block border border-(--ui-border) rounded-(--ui-radius-sm) px-3 py-2 text-sm bg-white min-w-48"
                >
                  <option value="">Select supplier...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-(--ui-text-muted) block mb-1">From</label>
                <input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)}
                  className="block border border-(--ui-border) rounded-(--ui-radius-sm) px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-(--ui-text-muted) block mb-1">To</label>
                <input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)}
                  className="block border border-(--ui-border) rounded-(--ui-radius-sm) px-3 py-2 text-sm" />
              </div>
              <Button tone="primary" onClick={fetchLedger} disabled={!ledgerSupplierId || ledgerLoading}>
                <BookOpen size={13} className="mr-1 inline" />
                {ledgerLoading ? "Loading..." : "View Ledger"}
              </Button>
            </div>
          </SectionCard>

          {ledger && (
            <SectionCard>
              <div className="px-4 py-3 border-b border-(--ui-border) flex items-center justify-between">
                <div>
                  <p className="font-semibold text-(--ui-text)">{ledger.supplier?.name}</p>
                  <p className="text-xs text-(--ui-text-muted)">
                    {ledger.supplier?.phone || ""}{ledger.supplier?.payment_terms === "credit" ? ` · ${ledger.supplier.credit_days}d credit` : " · Cash"}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-(--ui-text-muted)">Closing Balance</p>
                  <p className={`text-lg font-bold ${ledger.closing_balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {money(ledger.closing_balance)}
                  </p>
                </div>
              </div>
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted) sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Date</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-left">Reference</th>
                      <th className="px-3 py-2 text-left">Notes</th>
                      <th className="px-3 py-2 text-right">Purchase</th>
                      <th className="px-3 py-2 text-right">Payment</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ledger.entries || []).map((row, i) => (
                      <tr key={i} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                        <td className="px-3 py-2 text-(--ui-text-muted)">{row.date?.slice(0, 10) || "-"}</td>
                        <td className="px-3 py-2">
                          <Badge tone={row.type === "purchase" ? "warning" : "success"}>
                            {row.type === "purchase" ? "Purchase" : "Payment"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-(--ui-text)">{row.reference || "-"}</td>
                        <td className="px-3 py-2 text-(--ui-text-muted)">{row.notes || "-"}</td>
                        <td className="px-3 py-2 text-right text-rose-700 font-medium">
                          {row.amount > 0 ? money(row.amount) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-700 font-medium">
                          {row.payment > 0 ? money(row.payment) : "—"}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${row.running_balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                          {money(row.running_balance)}
                        </td>
                      </tr>
                    ))}
                    {(ledger.entries || []).length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-8 text-center text-(--ui-text-muted)">No transactions in this period</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}

          {!ledger && !ledgerLoading && ledgerSupplierId && (
            <SectionCard className="p-8 text-center text-(--ui-text-muted) text-sm">
              Click "View Ledger" to load the statement
            </SectionCard>
          )}

          {!ledgerSupplierId && (
            <EmptyState title="Select a supplier" body="Choose a supplier above to view their full account statement." />
          )}
        </div>
      ) : null}

      {payModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">Record Payment</h3>
              <button className="text-(--ui-text-muted) hover:text-(--ui-text)" onClick={closePayModal}>
                <X size={16} />
              </button>
            </div>
            <div className="mb-3 rounded border border-(--ui-border) bg-(--ui-muted-surface) p-3 text-sm">
              <p className="text-(--ui-text-muted)">
                Invoice: <span className="font-mono text-(--ui-text)">{payModal.invoice_number || `#${payModal.id}`}</span>
              </p>
              <p className="text-(--ui-text-muted)">
                Supplier: <span className="text-(--ui-text)">{payModal.supplier_name}</span>
              </p>
              <p className="text-(--ui-text-muted)">
                Outstanding: <span className="font-semibold text-rose-700">{money(calcDue(payModal))}</span>
              </p>
            </div>
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Payment Method</label>
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
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Reference</label>
                  <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Cheque/transfer ref" />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Paid By</label>
                  <Input value={payBy} onChange={(e) => setPayBy(e.target.value)} placeholder="Name" />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Notes</label>
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
      {voidModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">Void Payment</h3>
              <button className="text-(--ui-text-muted) hover:text-(--ui-text)" onClick={() => setVoidModal(null)}><X size={16} /></button>
            </div>
            <div className="mb-3 rounded border border-(--ui-border) bg-(--ui-muted-surface) p-3 text-sm">
              <p className="text-(--ui-text-muted)">Amount: <span className="font-semibold text-rose-700">{money(voidModal.amount)}</span></p>
              <p className="text-(--ui-text-muted)">Method: <span className="text-(--ui-text)">{voidModal.payment_method}</span></p>
              <p className="text-xs text-rose-600 mt-1">This will reverse the payment and recalculate the invoice status.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs text-(--ui-text-muted)">Void Reason (optional)</label>
              <Input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Enter reason..." />
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button onClick={() => setVoidModal(null)}>Cancel</Button>
              <Button tone="danger" onClick={handleVoid} disabled={voiding}>
                {voiding ? "Voiding..." : "Confirm Void"}
              </Button>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
