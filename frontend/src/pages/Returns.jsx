import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  X,
  Printer,
  Building2,
  User,
  Package,
  CreditCard,
  ArrowLeftRight,
  CheckCircle2,
  Store,
} from "lucide-react";
import { useLocation } from "react-router-dom";

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

export default function Returns() {
  const location = useLocation();
  const [returns, setReturns] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create Return Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [outlets, setOutlets] = useState([]);
  const [selectedOutletId, setSelectedOutletId] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState("");
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("Cash");
  const [returnItems, setReturnItems] = useState([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [barcodeError, setBarcodeError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Detail Modal State
  const [selectedReturn, setSelectedReturn] = useState(null);
  const [returnDetail, setReturnDetail] = useState(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);

  const barcodeInputRef = useRef(null);

  const fetchReturns = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API}/api/returns`);
      const data = await res.json();
      setReturns(data.returns || []);
    } catch {
      console.error("Failed to fetch returns");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReturns();
    // Load setup data for new returns
    fetch(`${API}/api/outlets`)
      .then((r) => r.json())
      .then((d) => setOutlets(d.outlets || []));
    fetch(`${API}/api/employees`)
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []));

    // Check if we were passed a sale to return from SalesHistory
    if (location.state && location.state.sale_id) {
      const state = location.state;
      setSelectedOutletId(state.outlet_id?.toString() || "");
      setSelectedEmployee(state.employee_id?.toString() || "");
      if (state.items) {
        setReturnItems(
          state.items.map((i) => ({
            product_id: i.product_id,
            name: i.product_name,
            barcode: i.barcode,
            quantity: i.quantity,
            refund_price: i.price_at_sale || 0,
          })),
        );
      }
      setIsModalOpen(true);
      // clear state so it doesn't trigger again on refresh
      window.history.replaceState({}, document.title);
    }
  }, [fetchReturns, location.state]);

  const openDetail = async (ret) => {
    setSelectedReturn(ret);
    setReturnDetail(null);
    setIsDetailLoading(true);
    try {
      const res = await fetch(`${API}/api/returns/${ret.id}`);
      const data = await res.json();
      setReturnDetail(data);
    } catch {
      console.error("Failed to fetch return detail");
    } finally {
      setIsDetailLoading(false);
    }
  };

  const handleScan = async (e) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    setBarcodeError("");

    try {
      const outletParam = selectedOutletId
        ? `?outlet_id=${selectedOutletId}`
        : "";
      const res = await fetch(
        `${API}/api/products/scan/${barcodeInput}${outletParam}`,
      );
      const data = await res.json();

      if (!res.ok) {
        setBarcodeError(data.error || "Product not found");
        setBarcodeInput("");
        return;
      }

      const product = data.product;
      setReturnItems((prev) => {
        const existing = prev.find((i) => i.product_id === product.id);
        if (existing) {
          return prev.map((i) =>
            i.product_id === product.id
              ? { ...i, quantity: i.quantity + 1 }
              : i,
          );
        } else {
          // Default refund price to current product price
          return [
            {
              product_id: product.id,
              name: product.name,
              barcode: product.barcode,
              quantity: 1,
              refund_price: product.price,
            },
            ...prev,
          ];
        }
      });
      setBarcodeInput("");
    } catch (err) {
      console.error("Failed to connect to server", err);
    }
  };

  const totalRefund = returnItems.reduce(
    (acc, item) => acc + item.quantity * item.refund_price,
    0,
  );

  const handleSubmitReturn = async (e) => {
    e.preventDefault();
    if (returnItems.length === 0) return alert("Add items to return");
    setIsSubmitting(true);

    try {
      const res = await fetch(`${API}/api/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: parseInt(selectedOutletId),
          employee_id: selectedEmployee ? parseInt(selectedEmployee) : null,
          total_refund: totalRefund,
          refund_method: refundMethod,
          reason,
          items: returnItems,
          // Since Returns doesn't know original_sale_id unless we track it during manual entry, we'll keep it simple
        }),
      });

      if (!res.ok) {
        const d = await res.json();
        alert(d.error || "Failed to process return");
        return;
      }

      setIsModalOpen(false);
      setReturnItems([]);
      setReason("");
      fetchReturns();
    } catch (err) {
      console.error("Return failed. Is the server running?", err);
      alert("Return failed. Is the server running?");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Customer Returns
          </h1>
          <p className="text-slate-500">
            {returns.length} return{returns.length !== 1 ? "s" : ""} recorded
          </p>
        </div>
        <button
          onClick={() => {
            setReturnItems([]);
            setIsModalOpen(true);
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          <ArrowLeftRight size={16} /> Process Return
        </button>
      </div>

      {/* Main content */}
      <div className="flex flex-1 gap-6 overflow-hidden min-h-0">
        {/* Table */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                  <th className="p-4">Return #</th>
                  <th className="p-4">Date & Time</th>
                  <th className="p-4">Outlet</th>
                  <th className="p-4">Employee</th>
                  <th className="p-4">Reason</th>
                  <th className="p-4 text-center">Items</th>
                  <th className="p-4 text-right">Total Refund</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="7" className="p-8 text-center text-slate-400">
                      Loading returns...
                    </td>
                  </tr>
                ) : returns.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="p-10 text-center">
                      <ClipboardList
                        size={48}
                        className="mx-auto text-slate-300 mb-3"
                      />
                      <p className="font-medium text-slate-600">
                        No returns recorded yet.
                      </p>
                    </td>
                  </tr>
                ) : (
                  returns.map((r) => (
                    <tr
                      key={r.id}
                      onClick={() => openDetail(r)}
                      className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${selectedReturn?.id === r.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
                    >
                      <td className="p-4 font-mono font-bold text-slate-800">
                        RTN-{r.id}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {formatDate(r.timestamp)}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {r.outlet_name || "—"}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {r.employee_name || "—"}
                      </td>
                      <td className="p-4 text-sm text-slate-600 truncate max-w-37.5">
                        {r.reason || "—"}
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                          {r.item_count}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-rose-600">
                        {formatCurrency(r.total_refund)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedReturn && (
          <div className="w-96 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <div>
                <h2 className="font-bold text-slate-800">
                  Return RTN-{selectedReturn.id}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDate(selectedReturn.timestamp)}
                </p>
              </div>
              <button
                onClick={() => setSelectedReturn(null)}
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
              ) : returnDetail ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <span className="text-xs text-slate-500">Method</span>
                      <p className="text-sm font-semibold">
                        {returnDetail.returnData.refund_method}
                      </p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <span className="text-xs text-slate-500">
                        Total Refund
                      </span>
                      <p className="text-sm font-bold text-rose-600">
                        {formatCurrency(returnDetail.returnData.total_refund)}
                      </p>
                    </div>
                  </div>
                  {returnDetail.returnData.reason && (
                    <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-700">
                      <strong>Reason:</strong> {returnDetail.returnData.reason}
                    </div>
                  )}

                  <div>
                    <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">
                      Restocked Items
                    </h3>
                    <div className="space-y-1 block">
                      {returnDetail.items.map((item) => (
                        <div
                          key={item.id}
                          className="flex justify-between items-center py-2 border-b border-slate-100"
                        >
                          <div>
                            <p className="text-sm font-medium">
                              {item.product_name}
                            </p>
                            <p className="text-xs text-slate-400 font-mono">
                              {item.barcode}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-rose-600">
                              {formatCurrency(
                                item.refund_price * item.quantity,
                              )}
                            </p>
                            <p className="text-xs text-slate-500">
                              {item.quantity} ×{" "}
                              {formatCurrency(item.refund_price)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* New Return Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <ArrowLeftRight className="text-blue-600" /> New Customer Return
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto flex">
              {/* Left side: Items */}
              <div className="w-3/5 p-6 border-r border-slate-100 flex flex-col">
                <form onSubmit={handleScan} className="relative mb-4">
                  <Search
                    className="absolute left-3 top-3 text-slate-400"
                    size={18}
                  />
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="Scan returned item barcode..."
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                  />
                  {barcodeError && (
                    <p className="text-xs text-red-500 mt-1">{barcodeError}</p>
                  )}
                </form>

                <div className="flex-1 overflow-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="p-3 font-semibold text-slate-600">
                          Product
                        </th>
                        <th className="p-3 font-semibold text-slate-600 text-center">
                          Qty
                        </th>
                        <th className="p-3 font-semibold text-slate-600 text-right">
                          Refund/ea
                        </th>
                        <th className="p-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {returnItems.length === 0 ? (
                        <tr>
                          <td
                            colSpan="4"
                            className="p-8 text-center text-slate-400"
                          >
                            No items added to return.
                          </td>
                        </tr>
                      ) : (
                        returnItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="p-3">
                              <p className="font-medium text-slate-900">
                                {item.name}
                              </p>
                              <p className="text-xs text-slate-500 font-mono">
                                {item.barcode}
                              </p>
                            </td>
                            <td className="p-3 text-center">
                              <input
                                type="number"
                                min="1"
                                className="w-16 border border-slate-200 rounded p-1 text-center"
                                value={item.quantity}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value) || 1;
                                  setReturnItems((prev) =>
                                    prev.map((i, ix) =>
                                      ix === idx ? { ...i, quantity: val } : i,
                                    ),
                                  );
                                }}
                              />
                            </td>
                            <td className="p-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-slate-400">$</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  className="w-20 border border-slate-200 rounded p-1 text-right"
                                  value={item.refund_price}
                                  onChange={(e) => {
                                    const val = parseFloat(e.target.value) || 0;
                                    setReturnItems((prev) =>
                                      prev.map((i, ix) =>
                                        ix === idx
                                          ? { ...i, refund_price: val }
                                          : i,
                                      ),
                                    );
                                  }}
                                />
                              </div>
                            </td>
                            <td className="p-3 text-right">
                              <button
                                onClick={() =>
                                  setReturnItems((prev) =>
                                    prev.filter((_, ix) => ix !== idx),
                                  )
                                }
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <X size={16} />
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right side: Form */}
              <form
                onSubmit={handleSubmitReturn}
                className="w-2/5 p-6 bg-slate-50 flex flex-col"
              >
                <div className="space-y-4 flex-1">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                      Return to Outlet *
                    </label>
                    <select
                      required
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                      value={selectedOutletId || ""}
                      onChange={(e) => {
                        setSelectedOutletId(e.target.value);
                        setBarcodeInput("");
                      }}
                    >
                      <option value="">Select an outlet...</option>
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                      Processed By
                    </label>
                    <select
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                      value={selectedEmployee}
                      onChange={(e) => setSelectedEmployee(e.target.value)}
                    >
                      <option value="">Select employee...</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                      Reason for Return
                    </label>
                    <textarea
                      rows="2"
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm resize-none"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Defective, wrong size..."
                    ></textarea>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                      Refund Method
                    </label>
                    <select
                      className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white"
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value)}
                    >
                      <option value="Cash">Cash</option>
                      <option value="Card">Card</option>
                      <option value="Store Credit">Store Credit</option>
                    </select>
                  </div>

                  <div className="bg-white p-4 rounded-xl border border-slate-200 mt-4">
                    <div className="flex justify-between items-center text-lg font-bold">
                      <span className="text-slate-700">Total Refund</span>
                      <span className="text-rose-600">
                        {formatCurrency(totalRefund)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200 mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 px-4 py-2 border border-slate-300 bg-white rounded-lg text-sm font-semibold hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={
                      isSubmitting ||
                      returnItems.length === 0 ||
                      !selectedOutletId
                    }
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={16} /> Complete
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
