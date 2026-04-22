import React, { useState, useEffect, useCallback, useRef } from "react";
import { X, Search } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function POSHoldPickupModal() {
  const { fmt: money } = useCurrency();
  const {
    holdPickupOpen,
    setHoldPickupOpen,
    setError,
    showNotice,
    printSlip,
  } = usePOS();

  const [search, setSearch] = useState("");
  const [hold, setHold] = useState(null);
  const [items, setItems] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cash");
  const [submitting, setSubmitting] = useState(false);

  // Scanner buffer — same pattern as POSReturnExchangeModal.
  const scanBufferRef = useRef("");
  const scanLastKeyRef = useRef(0);

  useEffect(() => {
    if (!holdPickupOpen) {
      setSearch("");
      setHold(null);
      setItems([]);
      setPayments([]);
      setPayAmount("");
      setPayMethod("Cash");
    }
  }, [holdPickupOpen]);

  const loadByCode = useCallback(async (code) => {
    if (!code) return;
    setSearch(code);
    setLoading(true);
    try {
      const data = await api.get(`/api/holds/by-barcode/${encodeURIComponent(code)}`);
      setHold(data.hold);
      setItems(data.items || []);
      setPayments(data.payments || []);
      setPayAmount(String(data.hold?.balance_due || ""));
    } catch (e) {
      setError?.(e.message || "Hold not found");
    } finally {
      setLoading(false);
    }
  }, [setError]);

  const loadSearch = useCallback(async () => {
    if (!search.trim()) return;
    // Try exact hold_number first, fall back to a list by phone.
    try {
      setLoading(true);
      const data = await api.get(`/api/holds/by-barcode/${encodeURIComponent(search.trim())}`);
      setHold(data.hold);
      setItems(data.items || []);
      setPayments(data.payments || []);
      setPayAmount(String(data.hold?.balance_due || ""));
    } catch {
      setError?.("Hold not found for this number");
    } finally {
      setLoading(false);
    }
  }, [search, setError]);

  // Scanner listener — only active while modal is open and no hold loaded.
  useEffect(() => {
    if (!holdPickupOpen || hold) return;
    const handler = (ev) => {
      const target = ev.target;
      const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const now = Date.now();
      if (now - scanLastKeyRef.current > 100) scanBufferRef.current = "";
      scanLastKeyRef.current = now;
      if (ev.key === "Enter") {
        const code = scanBufferRef.current;
        scanBufferRef.current = "";
        if (!isTyping && code.length >= 3) {
          ev.preventDefault();
          loadByCode(code);
        }
        return;
      }
      if (ev.key.length === 1) scanBufferRef.current += ev.key;
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [holdPickupOpen, hold, loadByCode]);

  const addPayment = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/api/holds/${hold.id}/payments`, {
        amount: amt,
        method: payMethod,
      });
      setHold(res.hold);
      setPayAmount(String(res.hold.balance_due || ""));
      showNotice?.("Payment recorded");
      // Refresh payments
      const fresh = await api.get(`/api/holds/${hold.id}`);
      setPayments(fresh.payments || []);
    } catch (e) {
      setError?.(e.message || "Failed to record payment");
    } finally {
      setSubmitting(false);
    }
  };

  const completeHold = async () => {
    const amt = Number(payAmount);
    const balance = Number(hold?.balance_due || 0);
    if (balance > 0 && amt < balance - 0.005) {
      setError?.("Payment does not cover the remaining balance");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {};
      if (balance > 0) {
        payload.payments = [{ method: payMethod, amount: balance }];
      }
      const res = await api.post(`/api/holds/${hold.id}/complete`, payload);
      showNotice?.(`Hold ${hold.hold_number} completed · Sale #${res.sale.id}`);
      try {
        printSlip?.({
          invoiceNumber: res.sale.invoice_number || `#${res.sale.id}`,
          cart: items.map((it) => ({
            name: it.product_name,
            price: Number(it.price_at_hold),
            quantity: Number(it.quantity),
          })),
          total: Number(hold.total_amount),
          payments: [{ method: payMethod, amount: balance }],
        });
      } catch { /* noop */ }
      setHoldPickupOpen(false);
    } catch (e) {
      setError?.(e.message || "Failed to complete hold");
    } finally {
      setSubmitting(false);
    }
  };

  if (!holdPickupOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div>
            <h3 className="text-xl font-black text-slate-900">Pick Up Hold</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Scan the hold slip barcode or enter the hold number (e.g. H-2026-00042).
            </p>
          </div>
          <button onClick={() => setHoldPickupOpen(false)} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!hold && (
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-3 text-slate-400" />
                <input
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-300"
                  placeholder="Hold number (e.g. H-2026-00042)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadSearch()}
                />
              </div>
              <button
                onClick={loadSearch}
                disabled={loading}
                className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700 disabled:opacity-50"
              >
                {loading ? "…" : "Find"}
              </button>
            </div>
          )}

          {hold && (
            <>
              <div className="bg-slate-50 rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <div>
                    <div className="text-lg font-black text-slate-900">{hold.hold_number}</div>
                    <div className="text-xs text-slate-500">
                      {hold.customer_name_full || hold.customer_name || "Walk-in"}
                      {hold.customer_phone && <span> · {hold.customer_phone}</span>}
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${
                    hold.status === "paid" ? "bg-emerald-100 text-emerald-700" :
                    hold.status === "active" ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {hold.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                  <div>
                    <div className="text-xs text-slate-500">Total</div>
                    <div className="font-bold text-slate-900">{money(hold.total_amount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Paid</div>
                    <div className="font-bold text-emerald-600">{money(hold.deposit_paid)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Balance</div>
                    <div className="font-black text-[#8066FF]">{money(hold.balance_due)}</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">Items</h4>
                <div className="border border-slate-100 rounded-lg divide-y">
                  {items.map((it) => (
                    <div key={it.id} className="flex justify-between px-3 py-2 text-sm">
                      <div>
                        <div className="font-semibold text-slate-900">{it.product_name}</div>
                        <div className="text-xs text-slate-500">Qty {it.quantity}</div>
                      </div>
                      <div className="font-semibold">{money(Number(it.price_at_hold) * Number(it.quantity))}</div>
                    </div>
                  ))}
                </div>
              </div>

              {payments.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">Payment history</h4>
                  <div className="border border-slate-100 rounded-lg divide-y">
                    {payments.map((p) => (
                      <div key={p.id} className="flex justify-between px-3 py-2 text-xs">
                        <span className="text-slate-600">{p.method}</span>
                        <span className="font-semibold">{money(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2 pt-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Amount</label>
                  <input
                    type="number"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Method</label>
                  <select
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}
                  >
                    <option>Cash</option>
                    <option>Card</option>
                    <option>JazzCash</option>
                    <option>EasyPaisa</option>
                    <option>BankTransfer</option>
                  </select>
                </div>
                <button
                  onClick={addPayment}
                  disabled={submitting}
                  className="px-4 py-2 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  Part-pay
                </button>
              </div>
            </>
          )}
        </div>

        {hold && (
          <div className="flex justify-end gap-2 p-5 border-t border-slate-100">
            <button
              onClick={() => setHoldPickupOpen(false)}
              className="px-4 py-2 text-slate-600 text-sm font-semibold hover:bg-slate-100 rounded-lg"
              disabled={submitting}
            >
              Close
            </button>
            <button
              onClick={completeHold}
              disabled={submitting}
              className="px-5 py-2 bg-[#8066FF] text-white text-sm font-bold rounded-lg hover:bg-[#7056ef] disabled:opacity-40"
            >
              {submitting ? "…" : "Complete & Print"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
