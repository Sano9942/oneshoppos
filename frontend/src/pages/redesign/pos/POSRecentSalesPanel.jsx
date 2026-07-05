import React, { useMemo, useState } from "react";
import { X, Printer, RotateCcw, Search, Mail } from "lucide-react";
import POSEmailReceiptModal from "./POSEmailReceiptModal";
import { api } from "../../../api";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { fmtDateTime, fmtTime } from "../../../utils/dates";

export default function POSRecentSalesPanel() {
  const { fmt: money } = useCurrency();
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

  const [emailTarget, setEmailTarget] = useState(null);

  if (!recentSalesOpen) return null;

  const handleReprint = async (sale) => {
    try {
      const data = await api.get(`/api/sales/${sale.id}`);
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
      <div className="relative flex flex-col bg-(--ui-surface) w-full max-w-md shadow-(--ui-shadow-lg) h-full overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-(--ui-border-strong) shrink-0">
          <h2 className="font-semibold text-(--ui-text) text-sm">Recent Sales — Today</h2>
          <button onClick={() => setRecentSalesOpen(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={16} />
          </button>
        </div>

        <div className="px-3 py-2 border-b border-(--ui-border) shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-(--ui-text-muted) pointer-events-none" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-sm border border-(--ui-border-strong) rounded-md focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
              placeholder="Search invoice # or customer"
              value={recentSalesSearch}
              onChange={(e) => setRecentSalesSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {recentSalesLoading && (
            <p className="p-6 text-center text-sm text-(--ui-text-muted)">Loading...</p>
          )}
          {!recentSalesLoading && filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-(--ui-text-muted)">No sales found for today.</p>
          )}
          {!recentSalesLoading && filtered.map((sale) => (
            <div
              key={sale.id}
              className="flex items-center justify-between gap-2 px-4 py-3 border-b border-(--ui-border) hover:bg-(--ui-muted-surface)"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-(--ui-text) truncate">
                  {sale.invoice_number || `#${sale.id}`}
                </p>
                <p className="text-xs text-(--ui-text-muted)">
                  {sale.customer_name || "Walk-in"} · {money(sale.total_amount)}
                </p>
                <p className="text-xs text-(--ui-text-muted)">
                  {fmtTime(sale.timestamp)}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => handleReprint(sale)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-(--ui-border-strong) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                >
                  <Printer size={12} /> Reprint
                </button>
                <button
                  onClick={() =>
                    setEmailTarget({ saleId: sale.id, customerEmail: sale.customer_email || "" })
                  }
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-(--ui-muted-surface) hover:bg-(--ui-border-strong) text-(--ui-text) font-medium"
                >
                  <Mail size={12} /> Email
                </button>
                <button
                  onClick={() => openReturnFromSale(sale)}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-(--ui-danger-bg) text-(--ui-danger-fg) hover:bg-(--ui-danger-bg)"
                >
                  <RotateCcw size={12} /> Return
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {emailTarget && (
        <POSEmailReceiptModal
          saleId={emailTarget.saleId}
          customerEmail={emailTarget.customerEmail}
          onClose={() => setEmailTarget(null)}
        />
      )}
    </div>
  );
}
