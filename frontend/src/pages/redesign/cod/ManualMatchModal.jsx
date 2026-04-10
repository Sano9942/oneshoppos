import { useEffect, useState } from "react";
import { Search, X, AlertTriangle } from "lucide-react";
import { api } from "../../../api";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import { fmtLocalDate } from "../../../utils/dates";

export default function ManualMatchModal({ open, line, onClose, onMatched }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  // Pre-fill query with remitted amount when the modal opens
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setBusy(false);
      return;
    }
    if (line?.remitted_amount != null) {
      setQuery(String(Number(line.remitted_amount)));
    }
  }, [open, line]);

  // Debounced search
  useEffect(() => {
    if (!open) return undefined;
    if (!query) {
      setResults([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get(
          `/api/web-orders/search?q=${encodeURIComponent(query)}`,
        );
        setResults(data.orders || []);
      } catch (err) {
        toast.error(err.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open, toast]);

  async function pick(order) {
    setBusy(true);
    try {
      await onMatched(line.id, order.id);
      onClose();
    } catch (err) {
      toast.error(err.message || "Match failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open || !line) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-(--bg-card) border border-(--border) rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-(--border)">
          <div>
            <h2 className="text-base font-semibold text-(--text-primary)">Match to web order</h2>
            <p className="text-xs text-(--text-muted) mt-0.5">
              Tracking: <span className="font-mono">{line.courier_tracking_number}</span> · Remitted:{" "}
              {fmt(Number(line.remitted_amount || 0))}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-(--text-muted) hover:text-(--text-primary)"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 border-b border-(--border)">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)"
            />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Order number, customer name, phone, or exact amount"
              className="w-full rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grow overflow-y-auto">
          {loading ? (
            <div className="py-8 text-center text-(--text-muted) text-sm">Searching…</div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-(--text-muted) text-sm">
              {query ? "No matching orders" : "Start typing to search"}
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-(--bg-subtle) text-(--text-muted) uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Order</th>
                  <th className="text-left px-4 py-2 font-medium">Customer</th>
                  <th className="text-right px-4 py-2 font-medium">Total</th>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--border)">
                {results.map((o) => (
                  <tr key={o.id} className="hover:bg-(--bg-subtle)/40">
                    <td className="px-4 py-2 text-(--text-primary) font-medium">
                      {o.external_order_number || `#${o.id}`}
                    </td>
                    <td className="px-4 py-2 text-(--text-secondary)">
                      {o.customer_name_snapshot || "—"}
                      {o.customer_phone_snapshot && (
                        <span className="text-(--text-muted) ml-1">
                          · {o.customer_phone_snapshot}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-(--text-primary)">
                      {fmt(Number(o.grand_total || 0))}
                    </td>
                    <td className="px-4 py-2 text-(--text-muted)">
                      {o.ordered_at ? fmtLocalDate(o.ordered_at) : "—"}
                    </td>
                    <td className="px-4 py-2 text-(--text-muted)">{o.payment_status || "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        {o.is_already_matched && (
                          <span
                            className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-[11px]"
                            title="This order is already matched to another settlement line"
                          >
                            <AlertTriangle size={11} /> matched
                          </span>
                        )}
                        <Button size="sm" disabled={busy} onClick={() => pick(o)}>
                          Pick
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
