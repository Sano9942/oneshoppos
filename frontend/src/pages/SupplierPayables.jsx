import { useState, useEffect, useCallback } from "react";
import { Receipt, DollarSign, RefreshCw, X, ChevronDown, ChevronUp } from "lucide-react";

import { API } from '../config';
const fmt = (n) => `PKRs ${(n || 0).toFixed(2)}`;

const STATUS_COLORS = {
  unpaid: "bg-red-100 text-red-700",
  partial: "bg-yellow-100 text-yellow-800",
  paid: "bg-green-100 text-green-700",
};

export default function SupplierPayables() {
  const [tab, setTab] = useState("aging"); // 'aging' | 'invoices'
  const [aging, setAging] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [filterSupplier, setFilterSupplier] = useState("");
  const [filterStatus, setFilterStatus] = useState("unpaid");
  const [loading, setLoading] = useState(false);

  // Expanded aging row
  const [expandedSupplierId, setExpandedSupplierId] = useState(null);
  const [supplierInvoices, setSupplierInvoices] = useState({});

  // Payment modal
  const [payModal, setPayModal] = useState(null); // { invoice }
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [payRef, setPayRef] = useState("");
  const [payBy, setPayBy] = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paying, setPaying] = useState(false);

  const fetchAging = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/supplier-aging`);
      const data = await res.json();
      setAging(data.aging || []);
    } catch { setAging([]); }
    finally { setLoading(false); }
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      if (filterSupplier) params.set("supplier_id", filterSupplier);
      const res = await fetch(`${API}/supplier-invoices?${params}`);
      const data = await res.json();
      setInvoices(data.invoices || []);
    } catch { setInvoices([]); }
    finally { setLoading(false); }
  }, [filterStatus, filterSupplier]);

  useEffect(() => { if (tab === "aging") fetchAging(); else fetchInvoices(); }, [tab, fetchAging, fetchInvoices]);

  const toggleSupplier = async (supplierId) => {
    if (expandedSupplierId === supplierId) { setExpandedSupplierId(null); return; }
    setExpandedSupplierId(supplierId);
    if (!supplierInvoices[supplierId]) {
      try {
        const res = await fetch(`${API}/supplier-invoices?supplier_id=${supplierId}`);
        const data = await res.json();
        setSupplierInvoices((prev) => ({ ...prev, [supplierId]: data.invoices || [] }));
      } catch { setSupplierInvoices((prev) => ({ ...prev, [supplierId]: [] })); }
    }
  };

  const openPayModal = (inv) => {
    const due = inv.amount_due ?? inv.amount - (inv.amount_paid ?? 0);
    setPayModal(inv);
    setPayAmount(due.toFixed(2));
    setPayMethod("Cash");
    setPayRef("");
    setPayBy("");
    setPayNotes("");
  };

  const handlePay = async () => {
    if (!payModal || !payAmount) return;
    setPaying(true);
    try {
      const res = await fetch(`${API}/supplier-invoices/${payModal.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parseFloat(payAmount),
          payment_method: payMethod,
          reference: payRef,
          paid_by: payBy,
          notes: payNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || "Payment failed"); return; }
      setPayModal(null);
      // Refresh
      setSupplierInvoices({});
      fetchAging();
      if (tab === "invoices") fetchInvoices();
    } catch { alert("Connection error"); }
    finally { setPaying(false); }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Supplier Payables</h1>
          <p className="text-sm text-gray-500 mt-1">Track outstanding amounts owed to suppliers</p>
        </div>
        <button
          onClick={() => { if (tab === "aging") fetchAging(); else fetchInvoices(); }}
          className="flex items-center gap-2 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {[{ id: "aging", label: "Aging Summary" }, { id: "invoices", label: "All Invoices" }].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? "border-blue-600 text-blue-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : tab === "aging" ? (
        /* Aging Summary */
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Invoices</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Total Invoiced</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Paid</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">Outstanding</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {aging.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  <DollarSign size={36} className="mx-auto mb-2 opacity-30" />
                  No outstanding payables
                </td></tr>
              ) : aging.map((row) => (
                <>
                  <tr
                    key={row.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => toggleSupplier(row.id)}
                  >
                    <td className="px-4 py-3 font-semibold text-gray-900">{row.supplier_name}</td>
                    <td className="px-4 py-3 text-gray-500">{row.phone || "—"}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{row.invoice_count}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(row.total_invoiced)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{fmt(row.total_paid)}</td>
                    <td className={`px-4 py-3 text-right font-bold ${row.total_due > 0 ? "text-red-600" : "text-gray-400"}`}>
                      {fmt(row.total_due)}
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {expandedSupplierId === row.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </td>
                  </tr>
                  {expandedSupplierId === row.id && (
                    <tr key={`${row.id}-detail`}>
                      <td colSpan={7} className="bg-gray-50 px-8 py-3">
                        {(supplierInvoices[row.id] || []).length === 0 ? (
                          <p className="text-sm text-gray-400 py-2">No invoices found</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-gray-500">
                                <th className="text-left py-1 pr-4">Invoice #</th>
                                <th className="text-right py-1 pr-4">Amount</th>
                                <th className="text-right py-1 pr-4">Paid</th>
                                <th className="text-right py-1 pr-4">Due</th>
                                <th className="text-left py-1 pr-4">Status</th>
                                <th className="text-left py-1">Date</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {(supplierInvoices[row.id] || []).map((inv) => (
                                <tr key={inv.id} className="border-t border-gray-200">
                                  <td className="py-1.5 pr-4 font-mono">{inv.invoice_number || `#${inv.id}`}</td>
                                  <td className="py-1.5 pr-4 text-right">{fmt(inv.amount)}</td>
                                  <td className="py-1.5 pr-4 text-right text-green-600">{fmt(inv.amount_paid)}</td>
                                  <td className="py-1.5 pr-4 text-right text-red-600 font-semibold">{fmt(inv.amount_due)}</td>
                                  <td className="py-1.5 pr-4">
                                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || ""}`}>
                                      {inv.status}
                                    </span>
                                  </td>
                                  <td className="py-1.5 text-gray-400">{new Date(inv.created_at).toLocaleDateString()}</td>
                                  <td className="py-1.5">
                                    {inv.status !== "paid" && (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); openPayModal(inv); }}
                                        className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                                      >
                                        Pay
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        /* Invoices list */
        <div className="space-y-4">
          <div className="flex gap-3">
            {["unpaid", "partial", "paid", ""].map((s) => (
              <button
                key={s || "all"}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${filterStatus === s ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {s || "All"}
              </button>
            ))}
          </div>
          <div className="bg-white border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Invoice #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Supplier</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Amount</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Paid</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Due</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    <Receipt size={36} className="mx-auto mb-2 opacity-30" />
                    No invoices found
                  </td></tr>
                ) : invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-700">{inv.invoice_number || `#${inv.id}`}</td>
                    <td className="px-4 py-3 font-medium text-gray-800">{inv.supplier_name}</td>
                    <td className="px-4 py-3 text-right text-gray-700">{fmt(inv.amount)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{fmt(inv.amount_paid)}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(inv.amount_due)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[inv.status] || ""}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {inv.status !== "paid" && (
                        <button
                          onClick={() => openPayModal(inv)}
                          className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
                        >
                          Pay
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Record Payment</h2>
              <button onClick={() => setPayModal(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Invoice</span><span className="font-mono font-medium">{payModal.invoice_number || `#${payModal.id}`}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Supplier</span><span className="font-medium">{payModal.supplier_name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Outstanding</span><span className="font-bold text-red-600">{fmt(payModal.amount_due ?? payModal.amount - (payModal.amount_paid ?? 0))}</span></div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <input type="number" step="0.01" min="0.01" value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                <div className="flex gap-2">
                  {["Cash", "Bank Transfer", "Cheque"].map((m) => (
                    <button key={m} type="button" onClick={() => setPayMethod(m)}
                      className={`px-3 py-1.5 rounded-lg text-sm border font-medium ${payMethod === m ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Reference #</label>
                  <input type="text" value={payRef} onChange={(e) => setPayRef(e.target.value)}
                    placeholder="Cheque/transfer ref" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Paid By</label>
                  <input type="text" value={payBy} onChange={(e) => setPayBy(e.target.value)}
                    placeholder="Name" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <input type="text" value={payNotes} onChange={(e) => setPayNotes(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-3 justify-end pt-2">
              <button onClick={() => setPayModal(null)} className="px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">Cancel</button>
              <button
                onClick={handlePay}
                disabled={paying || !payAmount || parseFloat(payAmount) <= 0}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {paying ? "Recording..." : "Record Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
