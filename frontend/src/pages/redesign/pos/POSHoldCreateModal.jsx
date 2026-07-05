import React, { useState, useMemo } from "react";
import { X } from "lucide-react";
import { api } from "../../../api";
import { usePOS } from "./POSContext";
import { useCurrency } from "../../../contexts/CurrencyContext";

export default function POSHoldCreateModal() {
  const { fmt: money } = useCurrency();
  const {
    holdCreateOpen,
    setHoldCreateOpen,
    cart,
    selectedOutletId,
    selectedCustomerId,
    customers,
    setCart,
    setError,
    showNotice,
    printSlip,
  } = usePOS();

  const [deposit, setDeposit] = useState("");
  const [depositMethod, setDepositMethod] = useState("Cash");
  const [holdDays, setHoldDays] = useState(14);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(selectedCustomerId)) || null,
    [customers, selectedCustomerId],
  );

  const total = useMemo(
    () => cart.reduce((s, i) => s + Number(i.price) * Number(i.quantity || 0), 0),
    [cart],
  );

  if (!holdCreateOpen) return null;

  const resetAndClose = () => {
    setDeposit("");
    setDepositMethod("Cash");
    setHoldDays(14);
    setPhone("");
    setName("");
    setNotes("");
    setHoldCreateOpen(false);
  };

  const handleSubmit = async () => {
    if (!cart.length) {
      setError?.("Cart is empty");
      return;
    }
    if (!selectedCustomer && !phone.trim()) {
      setError?.("Attach a customer or enter a phone number for the hold");
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        outlet_id: selectedOutletId,
        customer_id: selectedCustomer?.id || null,
        customer_phone: phone.trim() || selectedCustomer?.mobile || null,
        customer_name: name.trim() || selectedCustomer?.name || null,
        items: cart.map((c) => ({
          product_id: c.id,
          variant_id: c.variant_id || null,
          quantity: Number(c.quantity),
          price_at_hold: Number(c.price),
        })),
        total_amount: total,
        deposit_amount: Number(deposit) || 0,
        deposit_method: depositMethod,
        hold_days: Number(holdDays) || 14,
        notes: notes.trim() || null,
      };
      const res = await api.post("/api/holds", body);
      const holdNumber = res?.hold?.hold_number || "(unknown)";
      showNotice?.(`Hold ${holdNumber} created`);
      setCart([]);
      resetAndClose();
      // Optional printable slip — silently skip if printer not wired
      try {
        printSlip?.({
          isHoldSlip: true,
          invoiceNumber: holdNumber,
          cart: body.items.map((it, idx) => ({
            name: cart[idx]?.name || `Item ${it.product_id}`,
            price: it.price_at_hold,
            quantity: it.quantity,
          })),
          total,
          depositPaid: body.deposit_amount,
          balanceDue: Math.max(0, total - body.deposit_amount),
        });
      } catch { /* receipt best-effort */ }
    } catch (e) {
      setError?.(e.message || "Failed to create hold");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-(--ui-surface) rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-(--ui-shadow-lg)">
        <div className="flex items-center justify-between p-5 border-b border-(--ui-border)">
          <div>
            <h3 className="text-xl font-black text-(--ui-text)">Place on Hold</h3>
            <p className="text-xs text-(--ui-text-muted) mt-0.5">
              Reserve stock, take a deposit, customer picks up later.
            </p>
          </div>
          <button onClick={resetAndClose} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-(--ui-muted-surface) rounded-lg p-3 text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-(--ui-text-muted)">Items</span>
              <span className="font-semibold text-(--ui-text)">
                {cart.reduce((s, i) => s + Number(i.quantity || 0), 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-(--ui-text-muted)">Total</span>
              <span className="font-black text-(--ui-text)">{money(total)}</span>
            </div>
          </div>

          {!selectedCustomer && (
            <div className="grid grid-cols-2 gap-2">
              <input
                className="border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
                placeholder="Customer name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
                placeholder="Phone *"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          )}
          {selectedCustomer && (
            <div className="text-sm text-(--ui-text-muted) bg-(--ui-muted-surface) rounded-lg p-2">
              For: <span className="font-semibold text-(--ui-text)">{selectedCustomer.name}</span>
              {selectedCustomer.mobile && <span className="text-(--ui-text-muted)"> · {selectedCustomer.mobile}</span>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-(--ui-text-muted) mb-1">Deposit amount</label>
              <input
                type="number"
                className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
                placeholder="0.00"
                value={deposit}
                onChange={(e) => setDeposit(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-(--ui-text-muted) mb-1">Deposit method</label>
              <select
                className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value)}
              >
                <option>Cash</option>
                <option>Card</option>
                <option>JazzCash</option>
                <option>EasyPaisa</option>
                <option>BankTransfer</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-(--ui-text-muted) mb-1">Hold for (days)</label>
            <input
              type="number"
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
              value={holdDays}
              onChange={(e) => setHoldDays(e.target.value)}
              min={1}
              max={365}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-(--ui-text-muted) mb-1">Notes</label>
            <textarea
              rows={2}
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. customer size, color, pickup day"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-(--ui-border)">
          <button
            onClick={resetAndClose}
            className="px-4 py-2 text-(--ui-text-muted) text-sm font-semibold hover:bg-(--ui-muted-surface) rounded-lg"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !cart.length}
            className="px-5 py-2 bg-(--ui-primary) text-white text-sm font-bold rounded-lg hover:bg-(--ui-primary-strong) disabled:opacity-40"
          >
            {submitting ? "Creating…" : "Create Hold"}
          </button>
        </div>
      </div>
    </div>
  );
}
