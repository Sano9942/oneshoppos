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
      <div className="bg-(--ui-surface) rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-(--ui-shadow-lg)">
        <div className="flex items-center justify-between p-5 border-b border-(--ui-border)">
          <div>
            <h3 className="text-xl font-black text-(--ui-text)">Pick Up Hold</h3>
            <p className="text-xs text-(--ui-text-muted) mt-0.5">
              Scan the hold slip barcode or enter the hold number (e.g. H-2026-00042).
            </p>
          </div>
          <button onClick={() => setHoldPickupOpen(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!hold && (
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-3 text-(--ui-text-muted)" />
                <input
                  autoFocus
                  className="w-full pl-9 pr-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                  placeholder="Hold number (e.g. H-2026-00042)"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && loadSearch()}
                />
              </div>
              <button
                onClick={loadSearch}
                disabled={loading}
                className="px-4 py-2 bg-(--ui-primary) text-white text-sm rounded-lg hover:bg-(--ui-primary-strong) disabled:opacity-50"
              >
                {loading ? "…" : "Find"}
              </button>
            </div>
          )}

          {hold && (
            <>
              <div className="bg-(--ui-muted-surface) rounded-lg p-4">
                <div className="flex justify-between mb-2">
                  <div>
                    <div className="text-lg font-black text-(--ui-text)">{hold.hold_number}</div>
                    <div className="text-xs text-(--ui-text-muted)">
                      {hold.customer_name_full || hold.customer_name || "Walk-in"}
                      {hold.customer_phone && <span> · {hold.customer_phone}</span>}
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold uppercase ${
                    hold.status === "paid" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" :
                    hold.status === "active" ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)" :
                    "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                  }`}>
                    {hold.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm mt-3">
                  <div>
                    <div className="text-xs text-(--ui-text-muted)">Total</div>
                    <div className="font-bold text-(--ui-text)">{money(hold.total_amount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-(--ui-text-muted)">Paid</div>
                    <div className="font-bold text-(--ui-success-fg)">{money(hold.deposit_paid)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-(--ui-text-muted)">Balance</div>
                    <div className="font-black text-(--ui-text)">{money(hold.balance_due)}</div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">Items</h4>
                <div className="border border-(--ui-border) rounded-lg divide-y">
                  {items.map((it) => (
                    <div key={it.id} className="flex justify-between px-3 py-2 text-sm">
                      <div>
                        <div className="font-semibold text-(--ui-text)">{it.product_name}</div>
                        <div className="text-xs text-(--ui-text-muted)">Qty {it.quantity}</div>
                      </div>
                      <div className="font-semibold">{money(Number(it.price_at_hold) * Number(it.quantity))}</div>
                    </div>
                  ))}
                </div>
              </div>

              {payments.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold uppercase text-(--ui-text-muted) mb-2">Payment history</h4>
                  <div className="border border-(--ui-border) rounded-lg divide-y">
                    {payments.map((p) => (
                      <div key={p.id} className="flex justify-between px-3 py-2 text-xs">
                        <span className="text-(--ui-text-muted)">{p.method}</span>
                        <span className="font-semibold">{money(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-end gap-2 pt-2">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-(--ui-text-muted) mb-1">Amount</label>
                  <input
                    type="number"
                    className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-(--ui-text-muted) mb-1">Method</label>
                  <select
                    className="border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
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
                  title="Record a partial payment toward this hold. The hold stays open with the remaining balance until fully paid."
                  className="px-4 py-2 border border-(--ui-border-strong) text-(--ui-text) text-sm font-semibold rounded-lg hover:bg-(--ui-muted-surface) disabled:opacity-50"
                >
                  Take Deposit
                </button>
              </div>
              {Number(hold?.balance_due || 0) > 0 && (
                <p className="mt-2 text-xs text-(--ui-text-muted)">
                  Tip: Use <span className="font-semibold">Take Deposit</span> to record a partial payment now and leave the hold open. Use <span className="font-semibold">Complete &amp; Print</span> to settle in full.
                </p>
              )}
            </>
          )}
        </div>

        {hold && (
          <div className="flex justify-end gap-2 p-5 border-t border-(--ui-border)">
            <button
              onClick={() => setHoldPickupOpen(false)}
              className="px-4 py-2 text-(--ui-text-muted) text-sm font-semibold hover:bg-(--ui-muted-surface) rounded-lg"
              disabled={submitting}
            >
              Close
            </button>
            <button
              onClick={completeHold}
              disabled={submitting}
              className="px-5 py-2 bg-(--ui-primary) text-white text-sm font-bold rounded-lg hover:bg-(--ui-primary-strong) disabled:opacity-40"
            >
              {submitting ? "…" : "Complete & Print"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
