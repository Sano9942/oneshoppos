import { useEffect, useState } from "react";
import { X, Ban, Gift } from "lucide-react";
import { api } from "../../../../api";

// Phase 2-R.2 — Void + Comp modal with manager PIN override.
//
// Accepts a `saleItemId` (must refer to a real row in sale_items). On submit
// posts to /api/restaurant/sale-items/:id/adjust with the chosen reason and
// manager PIN. 401 → inline "Invalid PIN"; 403 → "Manager override not
// allowed in this mode". Auto-closes on success and calls onSuccess with
// the new adjustment row so the caller can refresh its list.
//
// If saleItemId is null the modal shows a helper message and the submit
// button is disabled — cart lines in an open draft check don't yet have a
// sale_item_id; the manager needs to open the completed check first.

export default function VoidCompModal({
  open,
  onClose,
  onSuccess,
  saleItemId = null,
  itemName = null,
  remainingAmount = 0,
  initialTab = "void",
}) {
  const [tab, setTab] = useState(initialTab);
  const [reasons, setReasons] = useState([]);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [amount, setAmount] = useState(remainingAmount || 0);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [impersonationBlocked, setImpersonationBlocked] = useState(false);

  useEffect(() => {
    if (!open) {
      setReasonCode("");
      setReasonNote("");
      setPin("");
      setError(null);
      setImpersonationBlocked(false);
      setBusy(false);
      setAmount(remainingAmount || 0);
      setTab(initialTab);
    } else {
      // Caller may open the modal with a fresh remainingAmount (e.g. tapping
      // a different sale_item from a list). Re-seed amount so the merchant
      // doesn't have to re-type the line total each time.
      setAmount(remainingAmount || 0);
      setTab(initialTab);
    }
  }, [open, remainingAmount, initialTab]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get(`/api/restaurant/void-reasons?adjustment_type=${tab}`);
        if (!cancelled) {
          setReasons(Array.isArray(data) ? data : []);
          // Default to first reason on tab switch
          if (Array.isArray(data) && data.length && !data.find((r) => r.code === reasonCode)) {
            setReasonCode(data[0].code);
          }
        }
      } catch {
        if (!cancelled) setReasons([]);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  if (!open) return null;

  const ready = saleItemId && reasonCode && pin.length >= 4 && Number(amount) > 0;
  const Icon = tab === "comp" ? Gift : Ban;
  const accent = tab === "comp" ? "#059669" : "#E11D48"; // emerald / rose
  const accentHover = tab === "comp" ? "#047857" : "#BE123C";

  const submit = async () => {
    setError(null);
    setImpersonationBlocked(false);
    setBusy(true);
    try {
      const res = await api.post(`/api/restaurant/sale-items/${saleItemId}/adjust`, {
        adjustment_type: tab,
        reason_code: reasonCode,
        reason_note: reasonNote.trim() || null,
        amount: Number(amount),
        manager_pin: pin,
      });
      onSuccess?.(res?.adjustment || null);
      onClose?.();
    } catch (e) {
      // api.js normalizes server { error } into err.message; detect the two
      // expected failure modes by status code.
      if (e?.status === 401) setError("Invalid PIN");
      else if (e?.status === 403 && /impersonation/i.test(e.message || "")) {
        setImpersonationBlocked(true);
      } else {
        setError(e?.message || "Failed to adjust item");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Icon size={18} style={{ color: accent }} />
            <h2 className="text-lg font-black text-slate-900">
              {tab === "comp" ? "Comp Item" : "Void Item"}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={20} /></button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-slate-200">
          {["void", "comp"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition ${
                tab === t
                  ? "text-slate-900 border-b-2 border-[#8066FF]"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!saleItemId && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-sm p-3 font-semibold">
              Select a completed sale item before voiding or comping. Cart items in an open
              check become adjustable once the check is closed.
            </div>
          )}

          {itemName && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-xs text-slate-500 font-semibold uppercase">Item</div>
              <div className="text-base font-black text-slate-900">{itemName}</div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Reason</label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#8066FF]"
            >
              <option value="">Pick a reason…</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Note <span className="normal-case font-medium text-slate-400">(optional)</span></label>
            <input
              type="text"
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              placeholder="Additional context…"
              maxLength={500}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#8066FF]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Amount</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#8066FF]"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase text-slate-500 mb-2">Manager PIN</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d*"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              placeholder="4–8 digits"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#8066FF] font-mono tracking-widest"
            />
          </div>

          {impersonationBlocked && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 text-rose-800 text-sm p-3 font-semibold">
              Manager override is not allowed while impersonating a tenant.
            </div>
          )}
          {error && (
            <div className="text-sm text-rose-600 font-semibold">{error}</div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!ready || busy}
            style={{ backgroundColor: !ready || busy ? undefined : accent }}
            onMouseEnter={(e) => { if (ready && !busy) e.currentTarget.style.backgroundColor = accentHover; }}
            onMouseLeave={(e) => { if (ready && !busy) e.currentTarget.style.backgroundColor = accent; }}
            className="px-4 py-2 rounded-xl text-sm font-bold text-white disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : tab === "comp" ? "Comp Item" : "Void Item"}
          </button>
        </div>
      </div>
    </div>
  );
}
