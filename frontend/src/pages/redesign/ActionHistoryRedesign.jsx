import { useEffect, useState } from "react";
import { Download, RefreshCcw, Search } from "lucide-react";
import { api } from "../../api";
import {
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

import { fmtUtcDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";

const fmtDate = fmtUtcDateTime;

const ACTION_TYPES = [
  "All",
  "Sale",
  "Return",
  "Void",
  "Adjustment",
  "Transfer",
  "Purchase Order",
  "Login",
];

export default function ActionHistoryRedesign() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [actionType, setActionType] = useState("");
  const [error, setError] = useState("");

  const fetchLogs = async ({ q = search, from = dateFrom, to = dateTo, type = actionType } = {}) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q) params.set("search", q);
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);
      if (type) params.set("action_type", type);
      const data = await api.get(`/api/action-history?${params}`);
      setLogs(data.logs || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load action history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => fetchLogs({ q: search }), 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Instant filter for date + action type
  useEffect(() => {
    fetchLogs({ from: dateFrom, to: dateTo, type: actionType });
  }, [dateFrom, dateTo, actionType]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PageShell
      title="Action History"
      subtitle="Audit log of all system actions and events."
      right={
        <div className="flex gap-2">
          <Button onClick={() => downloadCsv(["timestamp","employee","action","entity","details"], logs.map(l => [l.created_at||l.timestamp, l.user_name||l.employee_name||l.performed_by||"System", l.action_type||l.action||"", l.entity_type||"", l.details||l.description||""]), "action_history")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button onClick={() => fetchLogs()}>
            <RefreshCcw size={14} className="mr-1 inline" /> Refresh
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-(--ui-danger-bg) bg-(--ui-danger-bg) p-3 text-sm text-(--ui-danger-fg)">{error}</SectionCard>
      ) : null}

      <SectionCard>
        <TableToolbar
          left={
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)"
              />
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)"
              />
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value === "All" ? "" : e.target.value)}
                className="rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-1.5 text-sm text-(--ui-text)"
              >
                {ACTION_TYPES.map((t) => (
                  <option key={t} value={t === "All" ? "" : t}>{t}</option>
                ))}
              </select>
              <div className="relative min-w-65">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                <Input
                  className="pl-8"
                  placeholder="Search actions, employees, entities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
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
                      {log.user_name || log.employee_name || log.performed_by || "System"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-md bg-(--ui-accent)/10 px-1.5 py-0.5 text-xs font-medium text-(--ui-accent)">
                        {log.action_type || log.action || "—"}
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
