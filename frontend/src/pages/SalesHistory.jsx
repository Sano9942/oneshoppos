import { useState, useEffect, useCallback } from "react";
import {
  Search,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  X,
  Printer,
  Ban,
  Building2,
  User,
  Package,
  CreditCard,
  ArrowLeftRight,
  FileText,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import InvoiceView from "./InvoiceView";

const API = "http://localhost:5000";

function formatCurrency(n) {
  return "$" + (n || 0).toFixed(2);
}

function formatDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ voided }) {
  return voided ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
      Voided
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
      Active
    </span>
  );
}

export default function SalesHistory() {
  const navigate = useNavigate();
  const [sales, setSales] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Detail Panel
  const [selectedSale, setSelectedSale] = useState(null);
  const [saleDetail, setSaleDetail] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  // Invoice view
  const [invoiceSaleId, setInvoiceSaleId] = useState(null);

  // Void Modal
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [isVoiding, setIsVoiding] = useState(false);
  const [voidError, setVoidError] = useState("");

  const LIMIT = 50;

  const fetchSales = useCallback(
    async (p = 1) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          page: p,
          limit: LIMIT,
          search,
          date_from: dateFrom,
          date_to: dateTo,
        });
        const res = await fetch(`${API}/api/sales?${params}`);
        const data = await res.json();
        setSales(data.sales || []);
        setTotal(data.total || 0);
        setPages(data.pages || 1);
        setPage(p);
      } catch {
        console.error("Failed to fetch sales");
      } finally {
        setIsLoading(false);
      }
    },
    [search, dateFrom, dateTo],
  );

  useEffect(() => {
    fetchSales(1);
  }, [fetchSales]);

  const openDetail = async (sale) => {
    setSelectedSale(sale);
    setSaleDetail(null);
    setIsDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/sales/${sale.id}`);
      const data = await res.json();
      setSaleDetail(data);
    } catch {
      console.error("Failed to fetch sale detail");
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleReprint = () => {
    if (!saleDetail) return;
    const { sale, items, payments } = saleDetail;
    const taxTotal = items.reduce(
      (sum, i) =>
        sum +
        i.price_at_sale * i.quantity -
        (i.price_at_sale * i.quantity) / (1 + 0.17),
      0,
    );
    const subtotal = sale.total_amount - taxTotal;

    const printWindow = window.open("", "_blank", "width=400,height=600");
    let html = `<html><head><title>Receipt #${sale.id}</title>
      <style>body{font-family:monospace;font-size:14px;width:300px;margin:0 auto;color:black}.center{text-align:center}.right{text-align:right}.bold{font-weight:bold}.divider{border-bottom:1px dashed black;margin:10px 0}table{width:100%;border-collapse:collapse}td{padding:4px 0}@media print{body{width:100%}}</style>
      </head><body>
      <div class="center"><h2 style="margin:0">OneShopPOS</h2>
      <p style="margin:5px 0">REPRINT — Receipt #${sale.id}</p>
      <p style="margin:5px 0">${formatDate(sale.timestamp)}</p></div>
      <div class="divider"></div><table>`;
    items.forEach((i) => {
      html += `<tr><td>${i.quantity}x ${i.product_name}</td><td class="right">${formatCurrency(i.price_at_sale * i.quantity)}</td></tr>`;
    });
    html += `</table><div class="divider"></div><table>
      <tr><td>Subtotal</td><td class="right">${formatCurrency(subtotal)}</td></tr>
      <tr><td>Tax</td><td class="right">${formatCurrency(taxTotal)}</td></tr>
      <tr class="bold"><td>TOTAL</td><td class="right">${formatCurrency(sale.total_amount)}</td></tr>`;
    payments.forEach((p) => {
      html += `<tr><td>Tendered ${p.payment_method}</td><td class="right">${formatCurrency(p.amount)}</td></tr>`;
    });
    html += `</table><div class="divider"></div><p class="center" style="font-size:12px">Powered by OneShopPOS</p></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.onload = () => printWindow.print();
  };

  const handleVoidSubmit = async (e) => {
    e.preventDefault();
    setVoidError("");
    setIsVoiding(true);
    try {
      const res = await fetch(`${API}/api/sales/${selectedSale.id}/void`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ void_reason: voidReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVoidError(data.error || "Void failed");
        return;
      }
      setIsVoidModalOpen(false);
      setVoidReason("");
      setSelectedSale(null);
      setSaleDetail(null);
      fetchSales(page);
    } catch {
      setVoidError("Connection failed.");
    } finally {
      setIsVoiding(false);
    }
  };

  // Invoice view overlay
  if (invoiceSaleId) {
    return <InvoiceView saleId={invoiceSaleId} onBack={() => setInvoiceSaleId(null)} />;
  }

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Sales History
          </h1>
          <p className="text-slate-500">
            {total.toLocaleString()} transaction{total !== 1 ? "s" : ""} found
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            size={16}
          />
          <input
            type="text"
            placeholder="Search by receipt #, cashier, or outlet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>
        {(search || dateFrom || dateTo) && (
          <button
            onClick={() => {
              setSearch("");
              setDateFrom("");
              setDateTo("");
            }}
            className="text-sm text-slate-500 hover:text-red-600 flex items-center gap-1 px-3 py-2 rounded-lg hover:bg-red-50 transition-colors"
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-6 overflow-hidden min-h-0">
        {/* Table */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                  <th className="p-4">Receipt #</th>
                  <th className="p-4">Date & Time</th>
                  <th className="p-4">Cashier</th>
                  <th className="p-4">Outlet</th>
                  <th className="p-4 text-center">Items</th>
                  <th className="p-4 text-right">Discount</th>
                  <th className="p-4 text-right">Total</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-slate-400">
                      Loading sales...
                    </td>
                  </tr>
                ) : sales.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-10 text-center">
                      <ClipboardList
                        size={48}
                        className="mx-auto text-slate-300 mb-3"
                      />
                      <p className="font-medium text-slate-600">
                        No sales found
                      </p>
                    </td>
                  </tr>
                ) : (
                  sales.map((s) => (
                    <tr
                      key={s.id}
                      onClick={() => openDetail(s)}
                      className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${selectedSale?.id === s.id ? "bg-blue-50 border-l-2 border-blue-500" : ""} ${s.voided ? "opacity-60" : ""}`}
                    >
                      <td className="p-4 font-mono font-bold text-slate-800">
                        #{s.id}
                      </td>
                      <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                        {formatDate(s.timestamp)}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {s.employee_name || (
                          <span className="italic text-slate-400">Unknown</span>
                        )}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {s.outlet_name || (
                          <span className="italic text-slate-400">Unknown</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                          {s.item_count}
                        </span>
                      </td>
                      <td className="p-4 text-right text-sm">
                        {s.discount_amount > 0 ? (
                          <span className="text-rose-600 font-semibold">
                            -{formatCurrency(s.discount_amount)}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-4 text-right font-bold text-slate-900">
                        {formatCurrency(s.total_amount)}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {s.payment_method}
                      </td>
                      <td className="p-4">
                        <StatusBadge voided={s.voided} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {pages > 1 && (
            <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-between bg-white">
              <p className="text-sm text-slate-500">
                Page {page} of {pages}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => fetchSales(page - 1)}
                  disabled={page === 1}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-600"
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => fetchSales(page + 1)}
                  disabled={page === pages}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 text-slate-600"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedSale && (
          <div className="w-96 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-slate-800">
                  Receipt #{selectedSale.id}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDate(selectedSale.timestamp)}
                </p>
              </div>
              <button
                onClick={() => {
                  setSelectedSale(null);
                  setSaleDetail(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-4">
              {isDetailLoading ? (
                <div className="text-center text-slate-400 py-8">
                  Loading detail...
                </div>
              ) : saleDetail ? (
                <>
                  {/* Meta info */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
                        <User size={12} /> Cashier
                      </div>
                      <p className="text-sm font-semibold text-slate-800">
                        {saleDetail.sale.employee_name || "—"}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
                        <Building2 size={12} /> Outlet
                      </div>
                      <p className="text-sm font-semibold text-slate-800">
                        {saleDetail.sale.outlet_name || "—"}
                      </p>
                    </div>
                  </div>
                  {saleDetail.sale.voided && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                      <strong>Voided:</strong> {saleDetail.sale.void_reason}
                    </div>
                  )}

                  {/* Line Items */}
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      <Package size={12} /> Items
                    </div>
                    <div className="space-y-1">
                      {saleDetail.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0"
                        >
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {item.product_name}
                            </p>
                            <p className="text-xs text-slate-400 font-mono">
                              {item.barcode}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-slate-800">
                              {formatCurrency(
                                item.price_at_sale * item.quantity,
                              )}
                            </p>
                            <p className="text-xs text-slate-400">
                              {item.quantity} ×{" "}
                              {formatCurrency(item.price_at_sale)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Payments */}
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                      <CreditCard size={12} /> Payments
                    </div>
                    <div className="space-y-1">
                      {saleDetail.payments.map((p, i) => (
                        <div key={i} className="flex justify-between text-sm">
                          <span className="text-slate-600">
                            {p.payment_method}
                          </span>
                          <span className="font-semibold text-slate-800">
                            {formatCurrency(p.amount)}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between text-base font-bold text-slate-900 pt-2 border-t border-slate-200">
                        <span>Total</span>
                        <span>
                          {formatCurrency(saleDetail.sale.total_amount)}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}
            </div>

            {/* Actions */}
            {saleDetail && (
              <div className="p-4 border-t border-slate-200 flex gap-2 flex-wrap">
                <button
                  onClick={handleReprint}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <Printer size={16} /> Reprint
                </button>
                <button
                  onClick={() => setInvoiceSaleId(selectedSale.id)}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-violet-200 rounded-lg text-sm font-medium text-violet-600 hover:bg-violet-50 transition-colors"
                >
                  <FileText size={16} /> Invoice
                </button>
                {!saleDetail.sale.voided && (
                  <button
                    onClick={() => {
                      setVoidReason("");
                      setVoidError("");
                      setIsVoidModalOpen(true);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-red-200 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Ban size={16} /> Void
                  </button>
                )}
                <button
                  onClick={() => {
                    navigate("/returns", {
                      state: {
                        sale_id: selectedSale.id,
                        outlet_id: saleDetail.sale.outlet_id,
                        employee_id: saleDetail.sale.employee_id,
                        customer_id: saleDetail.sale.customer_id,
                        items: saleDetail.items,
                      },
                    });
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border border-blue-200 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
                >
                  <ArrowLeftRight size={16} /> Return
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Void Confirmation Modal */}
      {isVoidModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-red-50">
              <h2 className="text-xl font-bold text-red-800 flex items-center gap-2">
                <Ban size={20} /> Void Sale #{selectedSale?.id}
              </h2>
              <p className="text-sm text-red-600 mt-1">
                This will restore all stock to the outlet. This cannot be
                undone.
              </p>
            </div>
            <form onSubmit={handleVoidSubmit} className="p-6 space-y-4">
              {voidError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {voidError}
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Reason for Void *
                </label>
                <textarea
                  required
                  rows="3"
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="e.g. Customer returned items, data entry error..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-400/20 resize-none"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsVoidModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isVoiding}
                  className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <Ban size={16} /> {isVoiding ? "Voiding..." : "Confirm Void"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
