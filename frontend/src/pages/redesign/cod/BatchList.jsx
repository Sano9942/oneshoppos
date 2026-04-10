import { useEffect, useState } from "react";
import { Plus, Eye } from "lucide-react";
import { api } from "../../../api";
import { Button } from "../../../ui/primitives";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import { fmtLocalDateTime } from "../../../utils/dates";

const STATUS_META = {
  imported: { label: "Imported", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  matching: { label: "Matching…", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  review: { label: "Review", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
  approved: { label: "Approved", color: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
};

export default function BatchList({ onOpenImport, onOpenBatch }) {
  const { fmt } = useCurrency();
  const toast = useToast();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ courier_id: "", status: "" });
  const [couriers, setCouriers] = useState([]);

  useEffect(() => {
    api.get("/api/couriers")
      .then((d) => setCouriers(d.couriers || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchBatches() {
      setLoading(true);
      try {
        const query = {};
        if (filter.courier_id) query.courier_id = filter.courier_id;
        if (filter.status) query.status = filter.status;
        const data = await api.get(
          "/api/fulfillment/cod/settlements",
          Object.keys(query).length ? query : undefined,
        );
        if (!cancelled) setBatches(data.batches || []);
      } catch (err) {
        if (!cancelled) toast.error(err.message || "Failed to load batches");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchBatches();
    return () => { cancelled = true; };
  }, [filter.courier_id, filter.status]);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-(--border)">
        <select
          value={filter.courier_id}
          onChange={(e) => setFilter((f) => ({ ...f, courier_id: e.target.value }))}
          className="rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
        >
          <option value="">All couriers</option>
          {couriers.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filter.status}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          className="rounded-lg border border-(--border) bg-(--bg-input) text-(--text-primary) px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_META).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <div className="grow" />
        <Button onClick={onOpenImport}>
          <Plus size={15} />
          Import new batch
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-(--text-muted) text-sm">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="py-16 text-center text-(--text-muted) text-sm">
          No settlement batches yet. Click "Import new batch" to get started.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-(--bg-subtle) text-(--text-muted) text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2 font-medium">Batch Ref</th>
              <th className="text-left px-4 py-2 font-medium">Courier</th>
              <th className="text-right px-4 py-2 font-medium">Lines</th>
              <th className="text-right px-4 py-2 font-medium">Total Remitted</th>
              <th className="text-right px-4 py-2 font-medium">Matched</th>
              <th className="text-right px-4 py-2 font-medium">Unmatched</th>
              <th className="text-left px-4 py-2 font-medium">Status</th>
              <th className="text-left px-4 py-2 font-medium">Imported</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-(--border)">
            {batches.map((b) => {
              const meta = STATUS_META[b.status] || { label: b.status, color: "bg-gray-100 text-gray-700" };
              return (
                <tr
                  key={b.id}
                  className="hover:bg-(--bg-subtle)/50 cursor-pointer"
                  onClick={() => onOpenBatch(b.id)}
                >
                  <td className="px-4 py-2 font-medium text-(--text-primary)">{b.batch_ref || `#${b.id}`}</td>
                  <td className="px-4 py-2 text-(--text-secondary)">{b.courier_name || "—"}</td>
                  <td className="px-4 py-2 text-right text-(--text-secondary)">{b.total_lines || 0}</td>
                  <td className="px-4 py-2 text-right font-medium text-(--text-primary)">{fmt(Number(b.total_amount || 0))}</td>
                  <td className="px-4 py-2 text-right text-green-600 dark:text-green-400">{b.matched_count || 0}</td>
                  <td className="px-4 py-2 text-right text-amber-600 dark:text-amber-400">{b.unmatched_count || 0}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-(--text-muted) text-xs">
                    {b.imported_at ? fmtLocalDateTime(b.imported_at) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Eye size={14} className="text-(--text-muted)" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
