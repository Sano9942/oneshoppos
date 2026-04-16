import { useEffect, useState } from "react";
import { Search, AlertTriangle } from "lucide-react";
import { api } from "../../../api";
import { Button, Modal } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import { fmtUtcDate } from "../../../utils/dates";

export default function ManualMatchModal({ open, line, onClose, onMatched }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

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

  return (
    <Modal open={open} onClose={onClose} title="Match to web order" size="xl">
      {line ? (
        <>
          <p className="mb-3 text-xs text-(--ui-text-muted)">
            Tracking: <span className="font-mono">{line.courier_tracking_number}</span> · Remitted:{" "}
            {fmt(Number(line.remitted_amount || 0))}
          </p>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--ui-text-muted)" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Order number, customer name, phone, or exact amount"
              className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) text-(--ui-text) pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <div className="max-h-[50vh] overflow-y-auto rounded border border-(--ui-border)">
            {loading ? (
              <div className="py-8 text-center text-sm text-(--ui-text-muted)">Searching…</div>
            ) : results.length === 0 ? (
              <div className="py-8 text-center text-sm text-(--ui-text-muted)">
                {query ? "No matching orders" : "Start typing to search"}
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-(--ui-muted-surface) text-(--ui-text-muted) uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Order</th>
                    <th className="px-4 py-2 text-left font-medium">Customer</th>
                    <th className="px-4 py-2 text-right font-medium">Total</th>
                    <th className="px-4 py-2 text-left font-medium">Date</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--ui-border)">
                  {results.map((o) => (
                    <tr key={o.id} className="hover:bg-(--ui-muted-surface)/40">
                      <td className="px-4 py-2 font-medium text-(--ui-text)">
                        {o.external_order_number || `#${o.id}`}
                      </td>
                      <td className="px-4 py-2 text-(--ui-text-muted)">
                        {o.customer_name_snapshot || "—"}
                        {o.customer_phone_snapshot && (
                          <span className="ml-1 text-(--ui-text-muted)">
                            · {o.customer_phone_snapshot}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-(--ui-text)">
                        {fmt(Number(o.grand_total || 0))}
                      </td>
                      <td className="px-4 py-2 text-(--ui-text-muted)">
                        {o.ordered_at ? fmtUtcDate(o.ordered_at) : "—"}
                      </td>
                      <td className="px-4 py-2 text-(--ui-text-muted)">{o.payment_status || "—"}</td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {o.is_already_matched && (
                            <span
                              className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400"
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
        </>
      ) : null}
    </Modal>
  );
}
