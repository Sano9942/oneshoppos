import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Search, Filter } from "lucide-react";
import { useShopify } from "./ShopifyContext";
import { API } from "../../config";
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
          `${API}/integrations/shopify/events?limit=100&${query}`,
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
        `${API}/integrations/shopify/events/${id}/retry`,
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
        return "bg-emerald-100 text-emerald-700";
      case "failed":
        return "bg-rose-100 text-rose-700";
      case "pending":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
        <h3 className="text-base font-semibold text-slate-800">
          Sync Events Log
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              size={14}
            />
            <input
              value={filters.search}
              onChange={(e) =>
                setFilters((p) => ({ ...p, search: e.target.value }))
              }
              placeholder="Search ID/Entity..."
              className="pl-8 pr-3 py-1.5 border border-slate-200 rounded text-xs w-40"
            />
          </div>
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((p) => ({ ...p, status: e.target.value }))
            }
            className="px-2 py-1.5 border border-slate-200 rounded text-xs"
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
            className="px-2 py-1.5 border border-slate-200 rounded text-xs"
          >
            <option value="">All Directions</option>
            <option value="push">push (POS {"->"} Shopify)</option>
            <option value="pull">pull (Shopify {"->"} POS)</option>
          </select>
          <button
            onClick={() => loadEvents(false)}
            disabled={loading}
            className="p-1.5 border border-slate-300 rounded hover:bg-slate-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-left">
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
                className="border-t border-slate-100 hover:bg-slate-50/50"
              >
                <td className="p-3 font-mono text-xs text-slate-500">
                  {ev.id}
                </td>
                <td className="p-3 text-slate-600 truncate max-w-30">
                  {fmtLocalDateTime(ev.created_at)}
                </td>
                <td className="p-3">
                  <div className="text-slate-700 font-medium capitalize">
                    {ev.entity_type}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {ev.entity_id}
                  </div>
                </td>
                <td className="p-3">
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${ev.direction === "push" ? "bg-blue-50 text-blue-700" : "bg-indigo-50 text-indigo-700"}`}
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
                      className="text-[10px] text-rose-500 mt-1 truncate max-w-37.5"
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
                      className="p-1 text-slate-400 hover:text-slate-800"
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
                  className="p-8 text-center text-slate-400 italic"
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
