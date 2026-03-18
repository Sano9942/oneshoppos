import React, { useState } from "react";
import { Mail, X, Loader2 } from "lucide-react";
import { API_BASE as API } from "../../../config";
import { usePOS } from "./POSContext";

/**
 * POSEmailReceiptModal — sends an HTML receipt to a customer email.
 *
 * Props:
 *   saleId        {number}  — ID of the sale to email
 *   customerEmail {string}  — Pre-filled email (editable)
 *   onClose       {fn}      — Called on dismiss or after success
 */
export default function POSEmailReceiptModal({ saleId, customerEmail, onClose }) {
  const { authHeaders } = usePOS();
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
      const res = await fetch(`${API}/api/email/send-receipt-v2`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ saleId, toEmail: email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send email.");
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
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-700"
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <Mail size={20} className="text-blue-600" />
          <h3 className="font-semibold text-slate-800">Email Receipt</h3>
        </div>

        {sent ? (
          <p className="text-green-600 font-medium text-sm text-center py-4">
            Receipt sent successfully!
          </p>
        ) : (
          <>
            <label className="block text-sm text-slate-600 mb-1">
              Send to
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              disabled={loading}
              autoFocus
            />
            {error && (
              <p className="text-red-500 text-xs mb-3">{error}</p>
            )}
            <button
              onClick={handleSend}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg py-2 text-sm font-medium flex items-center justify-center gap-2"
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
