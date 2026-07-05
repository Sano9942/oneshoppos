import React, { useState } from "react";
import { Mail, X, Loader2 } from "lucide-react";
import { api } from "../../../api";
/**
 * POSEmailReceiptModal — sends an HTML receipt to a customer email.
 *
 * Props:
 *   saleId        {number}  — ID of the sale to email
 *   customerEmail {string}  — Pre-filled email (editable)
 *   onClose       {fn}      — Called on dismiss or after success
 */
export default function POSEmailReceiptModal({ saleId, customerEmail, onClose }) {
  const [email, setEmail] = useState(customerEmail || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    setError(null);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/email/send-receipt-v2", { saleId, toEmail: email });
      setSent(true);
      setTimeout(onClose, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-sm mx-4 p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-(--ui-text-muted) hover:text-(--ui-text)"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Mail size={20} className="text-(--ui-text)" />
          <h3 className="font-semibold text-(--ui-text)">Email Receipt</h3>
        </div>

        {sent ? (
          <p className="text-(--ui-success-fg) font-medium text-sm text-center py-4">
            Receipt sent successfully!
          </p>
        ) : (
          <>
            <label className="block text-sm text-(--ui-text-muted) mb-1">
              Send to
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full border border-(--ui-border-strong) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-(--ui-focus) mb-3"
              disabled={loading}
              autoFocus
            />
            {error && (
              <p className="text-(--ui-danger) text-xs mb-3">{error}</p>
            )}
            <button
              onClick={handleSend}
              disabled={loading}
              className="w-full bg-(--ui-primary) hover:bg-(--ui-primary-strong) disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
              {loading ? "Sending…" : "Send Receipt"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
