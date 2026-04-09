import { useState } from "react";
import { X, ShieldCheck, ShieldAlert } from "lucide-react";
import { api } from "../../../api";

/**
 * POS Approval Modal — requires manager PIN authorization.
 * Triggered when an approval policy returns 'approval_required'.
 *
 * Props:
 * - actionType: string (e.g. "manual_discount", "return", "void")
 * - referenceType: string
 * - referenceId: number|null
 * - outletId: number|null
 * - metadata: object|null
 * - onApproved: (approvalEvent) => void
 * - onDenied: () => void
 * - onClose: () => void
 */
export default function POSApprovalModal({
  actionType,
  referenceType = "sale",
  referenceId,
  outletId,
  metadata,
  onApproved,
  onDenied,
  onClose,
}) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { authorized, approver }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!pin.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/approvals/pos-authorize", {
        action_type: actionType,
        reference_type: referenceType,
        reference_id: referenceId || null,
        manager_pin: pin,
        outlet_id: outletId || null,
        metadata: metadata || null,
      });
      if (res.authorized) {
        setResult(res);
        onApproved?.(res.approval_event);
      }
    } catch (err) {
      const msg = err.message || "Authorization failed";
      setError(msg);
      if (msg.includes("Insufficient permissions")) {
        onDenied?.();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 rounded-xl shadow-2xl w-full max-w-sm p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-400" />
            <h3 className="text-lg font-semibold">Manager Authorization</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-slate-300 mb-4">
          This action requires manager approval: <span className="font-medium text-amber-300">{actionType.replace(/_/g, " ")}</span>
        </p>

        {result ? (
          <div className="text-center py-4">
            <ShieldCheck className="h-10 w-10 text-green-400 mx-auto mb-2" />
            <p className="text-green-300 font-medium">Approved by {result.approver?.name}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label className="block text-sm text-slate-300 mb-1">Manager PIN</label>
            <input
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter manager PIN"
              autoFocus
              className="w-full rounded-lg bg-slate-700 border border-slate-600 px-4 py-3 text-lg text-center tracking-widest placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            {error && (
              <div className="mt-2 flex items-center gap-1 text-sm text-red-400">
                <ShieldAlert className="h-4 w-4" />
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !pin.trim()}
              className="mt-4 w-full rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 py-2.5 font-semibold text-slate-900 transition-colors"
            >
              {loading ? "Verifying…" : "Authorize"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
