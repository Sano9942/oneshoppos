import { useEffect, useState } from "react";
import { RefreshCcw, Search } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

export default function ActionHistoryRedesign() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const fetchLogs = async (q = "") => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/action-history?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load action history");
      setLogs(data.logs || []);
    } catch (e) {
      setError(e.message || "Failed to load action history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetchLogs(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <PageShell
      title="Action History"
      subtitle="Audit log of all system actions and events."
      right={
        <Button onClick={() => fetchLogs(search)}>
          <RefreshCcw size={14} className="mr-1 inline" /> Refresh
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
      ) : null}

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-65">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search actions, employees, entities..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{logs.length} entries</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Timestamp</th>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-left">Action</th>
                <th className="px-3 py-2 text-left">Entity</th>
                <th className="px-3 py-2 text-left">Details</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                logs.map((log, i) => (
                  <tr
                    key={log.id ?? i}
                    className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-(--ui-text-muted)">
                      {fmtDate(log.created_at || log.timestamp)}
                    </td>
                    <td className="px-3 py-2 font-medium text-(--ui-text)">
                      {log.employee_name || log.performed_by || "System"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-(--ui-accent)/10 px-1.5 py-0.5 text-xs font-medium text-(--ui-accent)">
                        {log.action || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {log.entity_type ? `${log.entity_type}${log.entity_id ? ` #${log.entity_id}` : ""}` : "—"}
                    </td>
                    <td className="max-w-xs truncate px-3 py-2 text-xs text-(--ui-text-muted)">
                      {log.details || log.description || "—"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading && (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading audit log...</div>
          )}
          {!loading && logs.length === 0 && (
            <EmptyState title="No action history" body="System events will appear here." />
          )}
        </div>
      </SectionCard>
    </PageShell>
  );
}
