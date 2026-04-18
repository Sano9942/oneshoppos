import { useState } from "react";
import { X, Split as SplitIcon } from "lucide-react";
import { api } from "../../../../api";
import { usePOS } from "../POSContext";

// Phase 2-R.0 Day 6 — Split the current check.
// 3 modes:
//   - equal → backend "evenly" with N parts
//   - by_seat → backend "by_seat" (one check per seat)
//   - by_item → assign each line to a target check index (0..parts-1)
// POST /api/restaurant/checks/:id/split. On success, closes modal and
// tells the shell to exit back to floor view. Reimplemented here rather
// than ported verbatim from RestaurantChecksRedesign because that UI is
// list-oriented (one row per check) and the POS needs a focused modal
// tied to the currently-open check.

export default function SplitCheckModal({ open, onClose, onSplitComplete }) {
  const {
    cart,
    draftOrderId,
    ensureDraftOrder,
    money,
    total,
    showNotice,
    setError,
  } = usePOS();

  const [mode, setMode] = useState("equal");
  const [parts, setParts] = useState(2);
  const [assignments, setAssignments] = useState({}); // itemId -> targetIndex
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const lineKey = (item, idx) =>
    item.id ? String(item.id) + "_" + idx : "line_" + idx;

  const assignTo = (id, target) => {
    setAssignments((prev) => ({ ...prev, [id]: target }));
  };

  const submit = async () => {
    if (!cart.length) {
      setError?.("Nothing to split — cart is empty.");
      return;
    }
    setBusy(true);
    try {
      const checkId = draftOrderId || (await ensureDraftOrder());
      if (!checkId) throw new Error("Could not resolve draft order");
      const body = { split_type: mode === "equal" ? "evenly" : mode };
      if (mode === "equal") body.parts = Number(parts) || 2;
      if (mode === "by_item") {
        // Backend item_assignments[] expects { item_id, target_check_index }.
        // For cart lines without a persisted id yet (fresh adds pre-send),
        // we can only split by_item after the check has items on the server.
        // For 2-R.0 the user would typically Send to Kitchen first, then
        // split — but we still make the call with whatever ids we have.
        const list = [];
        cart.forEach((item, idx) => {
          const id = item.sale_item_id || item.draft_item_id || item.id;
          if (id !== undefined && id !== null) {
            list.push({
              item_id: Number(id),
              target_check_index: Number(assignments[lineKey(item, idx)] ?? 0),
            });
          }
        });
        body.item_assignments = list;
      }
      await api.post(`/api/restaurant/checks/${checkId}/split`, body);
      showNotice?.("Check split.");
      onClose?.();
      onSplitComplete?.();
    } catch (e) {
      setError?.(e.message || "Failed to split check");
    } finally {
      setBusy(false);
    }
  };

  const previewPerPart = mode === "equal" && parts > 0 ? total / parts : null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col border border-slate-100/20 max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50 rounded-t-3xl shrink-0">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <SplitIcon className="text-[#8066FF]" size={20} /> Split Check
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Mode picker */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Split Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: "equal", label: "Equal" },
                { id: "by_seat", label: "By Seat" },
                { id: "by_item", label: "By Item" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={`py-2.5 px-3 rounded-xl font-bold text-sm transition border-2 ${
                    mode === id
                      ? "border-[#8066FF] bg-[#8066FF]/5 text-[#8066FF]"
                      : "border-slate-100 bg-white text-slate-600 hover:border-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Equal — number of parts */}
          {mode === "equal" && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                Number of Splits
              </label>
              <input
                type="number"
                min="2"
                max="20"
                value={parts}
                onChange={(e) => setParts(Math.max(2, Number(e.target.value) || 2))}
                className="w-full px-4 py-3 bg-white border-2 border-slate-200 rounded-xl focus:border-[#8066FF] focus:ring-0 outline-none text-lg font-bold"
              />
              {previewPerPart !== null && (
                <p className="text-xs text-slate-500 mt-1.5">
                  {money(previewPerPart)} per split (approx.)
                </p>
              )}
            </div>
          )}

          {/* By seat — informational only */}
          {mode === "by_seat" && (
            <div className="rounded-2xl border border-slate-100 bg-slate-50/50 p-4 text-sm text-slate-600">
              One new check will be created for each seat that has items
              attached. Items with no seat assignment stay on the source check.
            </div>
          )}

          {/* By item — per-line target picker */}
          {mode === "by_item" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  Assign Items
                </label>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-500">Parts:</span>
                  <input
                    type="number"
                    min="2"
                    max="8"
                    value={parts}
                    onChange={(e) => setParts(Math.max(2, Number(e.target.value) || 2))}
                    className="w-14 px-2 py-1 border border-slate-200 rounded-lg text-sm font-semibold text-center"
                  />
                </div>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {cart.length === 0 && (
                  <p className="text-sm text-slate-400 italic">Cart is empty.</p>
                )}
                {cart.map((item, idx) => {
                  const key = lineKey(item, idx);
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {item.quantity} × {money(item.price)}
                        </p>
                      </div>
                      <select
                        value={assignments[key] ?? 0}
                        onChange={(e) => assignTo(key, Number(e.target.value))}
                        className="h-8 px-2 border border-slate-200 rounded-lg text-sm font-semibold bg-white"
                      >
                        {Array.from({ length: Math.max(2, parts) }, (_, i) => (
                          <option key={i} value={i}>
                            Check {i + 1}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 bg-slate-50 rounded-b-3xl shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl font-bold text-sm text-slate-600 hover:bg-slate-200 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || cart.length === 0}
            className="px-6 py-2.5 rounded-xl font-black text-sm text-white bg-[#8066FF] hover:bg-[#7055E6] disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {busy ? "Splitting…" : "Split"}
          </button>
        </div>
      </div>
    </div>
  );
}
