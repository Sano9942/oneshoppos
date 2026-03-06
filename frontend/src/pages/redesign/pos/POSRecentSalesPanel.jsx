import React, { useMemo } from "react";
import { X, Printer, RotateCcw, Search } from "lucide-react";
import { API_BASE as API } from "../../../config";
import { usePOS } from "./POSContext";
import { fmtDateTime, fmtTime } from "../../../utils/dates";

function money(n) {
  return `PKRs ${Number(n || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function POSRecentSalesPanel() {
  const {
    recentSalesOpen,
    setRecentSalesOpen,
    recentSales,
    recentSalesLoading,
    recentSalesSearch,
    setRecentSalesSearch,
    printSlip,
    openReturnFromSale,
    outlets,
    selectedOutletId,
    employee,
    authHeaders,
  } = usePOS();

  const filtered = useMemo(() => {
    const q = recentSalesSearch.trim().toLowerCase();
    if (!q) return recentSales;
    return recentSales.filter(
      (s) =>
        String(s.invoice_number || "").toLowerCase().includes(q) ||
        String(s.customer_name || "").toLowerCase().includes(q),
    );
  }, [recentSales, recentSalesSearch]);

  if (!recentSalesOpen) return null;

  const handleReprint = async (sale) => {
    try {
      const res = await fetch(`${API}/api/sales/${sale.id}`, { headers: authHeaders() });
      const data = await res.json();
      const s = data.sale;
      const slip = {
        saleId: s.id,
        invoiceNumber: s.invoice_number || String(s.id),
        cart: (data.items || []).map((i) => ({
          name: i.product_name || "Item",
          quantity: i.quantity,
          price: i.price_at_sale,
        })),
        payments: (data.payments || []).map((p) => ({
          method: p.payment_method,
          amount: p.amount,
        })),
        total: s.total_amount,
        change: 0,
        customer: s.customer_name ? { name: s.customer_name, mobile: "" } : null,
        outlet: outlets.find((o) => String(o.id) === String(selectedOutletId)) || null,
        employee: s.employee_name ? { name: s.employee_name } : (employee || null),
        discountAmount: s.discount_amount || 0,
        discountType: s.discount_type || "fixed",
        timestamp: fmtDateTime(s.timestamp),
      };
      printSlip(slip);
    } catch {
      // fallback silently
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => setRecentSalesOpen(false)}
      />
      <div className="relative flex flex-col bg-white w-full max-w-md shadow-2xl h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
          <h2 className="font-semibold text-slate-800 text-sm">Recent Sales — Today</h2>
          <button onClick={() => setRecentSalesOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-slate-100 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-300"
              placeholder="Search invoice # or customer"
              value={recentSalesSearch}
              onChange={(e) => setRecentSalesSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {recentSalesLoading && (
            <p className="p-6 text-center text-sm text-slate-400">Loading...</p>
          )}
          {!recentSalesLoading && filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-slate-400">No sales found for today.</p>
          )}
          {!recentSalesLoading && filtered.map((sale) => (
            <div
              key={sale.id}
              className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">
                  {sale.invoice_number || `#${sale.id}`}
                </p>
                <p className="text-xs text-slate-400">
                  {sale.customer_name || "Walk-in"} · {money(sale.total_amount)}
                </p>
                <p className="text-xs text-slate-400">
                  {fmtTime(sale.timestamp)}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => handleReprint(sale)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-100"
                >
                  <Printer size={12} /> Reprint
                </button>
                <button
                  onClick={() => openReturnFromSale(sale)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50"
                >
                  <RotateCcw size={12} /> Return
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
