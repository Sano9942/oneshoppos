import { useState, useEffect } from "react";
import { X, Unlock } from "lucide-react";
import { api } from "../../../api";

/**
 * POS No-Sale Reason Modal (2-G.17).
 *
 * Shown when the POS "Open Drawer" button is clicked while the
 * phase2g_risk_controls flag is ON. Records a no_sale_events row and
 * kicks the drawer server-side.
 *
 * Props (all optional):
 *  - open:     boolean — controls visibility
 *  - outletId: number  — attached to the event
 *  - onClose:  () => void
 *  - onDone:   (event) => void  — called after successful POST
 */
export default function POSNoSaleReasonModal({ open, outletId, onClose, onDone }) {
  const [reasons, setReasons] = useState([]);
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setSelected(null);
    setNote("");
    api.get("/api/risk/no-sale-reasons")
      .then((rows) => setReasons(Array.isArray(rows) ? rows : []))
      .catch(() => setReasons([]));
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/api/risk/no-sale", {
        reason_code: selected,
        note: note || null,
        outlet_id: outletId || null,
      });
      onDone?.(res.event);
      onClose?.();
    } catch (err) {
      setError(err.message || "Failed to record no-sale");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45">
      <div className="bg-(--ui-surface) rounded-xl shadow-(--ui-shadow-lg) w-full max-w-md p-6 text-(--ui-text)">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Unlock className="h-5 w-5 text-(--ui-text)" />
            <h3 className="text-lg font-semibold">Open Drawer (No-Sale)</h3>
          </div>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-(--ui-text-muted) mb-4">
          Pick a reason so this drawer open is logged for the day.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {reasons.map((r) => (
              <button
                type="button"
                key={r.code}
                onClick={() => setSelected(r.code)}
                className={`rounded-lg border px-3 py-3 text-sm font-medium transition ${
                  selected === r.code
                    ? "border-(--ui-text) bg-(--ui-muted-surface) text-(--ui-text)"
                    : "border-(--ui-border-strong) bg-(--ui-surface) text-(--ui-text) hover:border-(--ui-text)"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <label className="block text-sm text-(--ui-text-muted) mb-1">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. customer needs PKR 500 change"
            className="w-full rounded-lg bg-(--ui-surface) border border-(--ui-border-strong) px-3 py-2 text-sm placeholder:text-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
          />

          {error && (
            <div className="mt-2 text-sm text-(--ui-danger-fg)">{error}</div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-(--ui-border-strong) bg-(--ui-surface) hover:bg-(--ui-muted-surface) py-2.5 font-medium transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selected || loading}
              className="flex-1 rounded-lg bg-(--ui-primary) text-white hover:bg-(--ui-primary-strong) disabled:opacity-50 py-2.5 font-semibold transition"
            >
              {loading ? "Opening…" : "Open Drawer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
