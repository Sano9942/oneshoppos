import { useEffect, useState } from "react";
import { X, Ban, Search } from "lucide-react";
import { api } from "../../../../api";
import { usePOS } from "../POSContext";

// Phase 2-R.1 — "86 an item" modal opened from RestaurantOverflowMenu.
// Thin flow: type to search products → pick one → pick a reason → save.
// Posts to POST /api/restaurant/products/:id/sold-out. The reason is
// free text for Wave A; 2-R.2 swaps in reason codes.

const QUICK_REASONS = [
  "Out of stock",
  "Kitchen prep issue",
  "Quality concern",
  "Supplier delay",
  "End of day",
  "Other",
];

export default function RestaurantAvailabilityModal({ open, onClose }) {
  const { selectedOutletId, showNotice } = usePOS();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected(null);
      setReason("");
      setUntil("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !query || query.length < 2) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.get(
          `/api/products/search?query=${encodeURIComponent(query)}${selectedOutletId ? `&outlet_id=${selectedOutletId}` : ""}`,
        );
        if (!cancelled) setResults(Array.isArray(data) ? data : (data?.products || []));
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, open, selectedOutletId]);

  if (!open) return null;

  const handleSave = async () => {
    if (!selected || !reason.trim()) {
      setError("Pick a product and a reason");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/restaurant/products/${selected.id}/sold-out`, {
        reason: reason.trim(),
        until: until ? new Date(until).toISOString() : null,
      });
      showNotice?.(`${selected.name} marked 86'd`);
      onClose?.();
    } catch (e) {
      setError(e?.message || "Failed to mark sold-out");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
      <div className="bg-(--ui-surface) rounded-2xl shadow-(--ui-shadow-lg) w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--ui-border-strong)">
          <div className="flex items-center gap-2">
            <Ban size={18} className="text-(--ui-danger)" />
            <h2 className="text-lg font-black text-(--ui-text)">86 an Item</h2>
          </div>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {!selected ? (
            <div>
              <label className="block text-xs font-bold uppercase text-(--ui-text-muted) mb-2">Product</label>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search menu item…"
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-(--ui-border-strong) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                />
              </div>
              <div className="mt-3 max-h-64 overflow-y-auto rounded-xl border border-(--ui-border-strong) divide-y divide-(--ui-border)">
                {searching && <div className="p-3 text-sm text-(--ui-text-muted)">Searching…</div>}
                {!searching && results.length === 0 && query.length >= 2 && (
                  <div className="p-3 text-sm text-(--ui-text-muted)">No matches.</div>
                )}
                {results.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="w-full text-left px-3 py-2.5 hover:bg-(--ui-muted-surface) flex items-center justify-between"
                  >
                    <span className="font-semibold text-(--ui-text)">{p.name}</span>
                    {p.is_sold_out && (
                      <span className="text-xs font-bold uppercase text-(--ui-danger)">Already 86'd</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-(--ui-muted-surface) border border-(--ui-border-strong) p-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-(--ui-text-muted) font-semibold uppercase">Selected</div>
                  <div className="text-base font-black text-(--ui-text)">{selected.name}</div>
                </div>
                <button
                  onClick={() => setSelected(null)}
                  className="text-xs font-bold text-(--ui-link) hover:underline"
                >
                  Change
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-(--ui-text-muted) mb-2">Reason</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {QUICK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                        reason === r
                          ? "bg-(--ui-primary) text-white border-(--ui-primary)"
                          : "bg-(--ui-surface) text-(--ui-text) border-(--ui-border-strong) hover:bg-(--ui-muted-surface)"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Or type a custom reason…"
                  className="w-full px-3 py-2.5 rounded-xl border border-(--ui-border-strong) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                  maxLength={200}
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase text-(--ui-text-muted) mb-2">
                  Auto-clear at <span className="normal-case font-medium text-(--ui-text-muted)">(optional)</span>
                </label>
                <input
                  type="datetime-local"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-(--ui-border-strong) focus:outline-none focus:ring-2 focus:ring-(--ui-focus)"
                />
              </div>

              {error && <div className="text-sm text-(--ui-danger-fg) font-semibold">{error}</div>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-(--ui-border-strong) flex justify-end gap-2 bg-(--ui-muted-surface)">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold text-(--ui-text) hover:bg-(--ui-border-strong)"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={busy || !selected || !reason.trim()}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-(--ui-danger) text-white hover:opacity-90 disabled:bg-(--ui-muted-surface) disabled:cursor-not-allowed"
          >
            {busy ? "Saving…" : "Mark Sold Out"}
          </button>
        </div>
      </div>
    </div>
  );
}
