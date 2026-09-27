import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Search, Filter } from "lucide-react";
import { useShopify } from "./ShopifyContext";
import { fmtLocalDateTime } from "../../utils/dates";

export default function ShopifyEvents() {
  const { apiFetch, setError, setSuccess } = useShopify();

  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({
    status: "",
    entity_type: "",
    direction: "",
    search: "",
  });

  const loadEvents = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const query = new URLSearchParams(filters).toString();
        const res = await apiFetch(
          `/api/integrations/shopify/events?limit=100&${query}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load events");
        setEvents(data.events || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [apiFetch, filters, setError],
  );

  useEffect(() => {
    loadEvents(true);
  }, [loadEvents]);

  const retrySingleEvent = async (id) => {
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/sync/retry-event/${id}`,
        { method: "POST" },
      );
      if (res.ok) {
        setSuccess(`Event ${id} queued for retry.`);
        loadEvents(true);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "processed":
        return "bg-(--ui-success-bg) text-(--ui-success-fg)";
      case "failed":
        return "bg-(--ui-danger-bg) text-(--ui-danger-fg)";
      case "pending":
        return "bg-(--ui-warning-bg) text-(--ui-warning-fg)";
      default:
        return "bg-(--ui-muted-surface) text-(--ui-text)";
    }
  };

  return (
    <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-(--ui-border) flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-base font-semibold text-(--ui-text)">
          Sync Events Log
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--ui-text-muted)"
              size={14}
            />
            <input
              value={filters.search}
              onChange={(e) =>
                setFilters((p) => ({ ...p, search: e.target.value }))
              }
              placeholder="Search ID/Entity..."
              className="pl-8 pr-3 py-1.5 border border-(--ui-border) rounded text-xs w-40"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((p) => ({ ...p, status: e.target.value }))
            }
            className="px-2 py-1.5 border border-(--ui-border) rounded text-xs"
          >
            <option value="">All Statuses</option>
            <option value="pending">pending</option>
            <option value="processed">processed</option>
            <option value="failed">failed</option>
          </select>
          <select
            value={filters.direction}
            onChange={(e) =>
              setFilters((p) => ({ ...p, direction: e.target.value }))
            }
            className="px-2 py-1.5 border border-(--ui-border) rounded text-xs"
          >
            <option value="">All Directions</option>
            <option value="push">push (POS {"->"} Shopify)</option>
            <option value="pull">pull (Shopify {"->"} POS)</option>
          </select>
          <button
            onClick={() => loadEvents(false)}
            disabled={loading}
            className="p-1.5 border border-(--ui-border-strong) rounded hover:bg-(--ui-muted-surface)"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-(--ui-muted-surface) text-(--ui-text-muted) text-left">
            <tr>
              <th className="p-3">ID</th>
              <th className="p-3">Timestamp</th>
              <th className="p-3">Entity</th>
              <th className="p-3">Direction</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Retry</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr
                key={ev.id}
                className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)/50"
              >
                <td className="p-3 font-mono text-xs text-(--ui-text-muted)">
                  {ev.id}
                </td>
                <td className="p-3 text-(--ui-text-muted) truncate max-w-30">
                  {fmtLocalDateTime(ev.created_at)}
                </td>
                <td className="p-3">
                  <div className="text-(--ui-text) font-medium capitalize">
                    {ev.entity_type}
                  </div>
                  <div className="text-[10px] text-(--ui-text-muted) font-mono">
                    {ev.entity_id}
                  </div>
                </td>
                <td className="p-3">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${ev.direction === "push" ? "bg-(--ui-muted-surface) text-(--ui-link)" : "bg-(--ui-muted-surface) text-(--ui-link)"}`}
                  >
                    {ev.direction.toUpperCase()}
                  </span>
                </td>
                <td className="p-3">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${getStatusBadge(ev.status)}`}
                  >
                    {ev.status}
                  </span>
                  {ev.error_message && (
                    <div
                      className="text-[10px] text-(--ui-danger-fg) mt-1 truncate max-w-37.5"
                      title={ev.error_message}
                    >
                      {ev.error_message}
                    </div>
                  )}
                </td>
                <td className="p-3 text-right">
                  {ev.status === "failed" && (
                    <button
                      onClick={() => retrySingleEvent(ev.id)}
                      className="p-1 text-(--ui-text-muted) hover:text-(--ui-text)"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {events.length === 0 && !loading && (
              <tr>
                <td
                  colSpan="6"
                  className="p-8 text-center text-(--ui-text-muted) italic"
                >
                  No events found matching filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
