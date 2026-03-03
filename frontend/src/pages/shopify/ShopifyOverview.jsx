import React, { useMemo } from "react";
import { useShopify } from "./ShopifyContext";

export default function ShopifyOverview() {
  const { status, config, mappingCounts } = useShopify();

  const summary = useMemo(() => {
    const s = status?.event_stats || {};
    return {
      total: s.total || 0,
      processed: s.processed || 0,
      failed: s.failed || 0,
      pending: s.pending || 0,
    };
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Connection</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            {status?.connected ? "Connected" : "Not Connected"}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {status?.shop_domain || "-"}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Events</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            {summary.total}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Processed {summary.processed} | Failed {summary.failed} | Pending{" "}
            {summary.pending}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Mappings</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            {mappingCounts.products +
              mappingCounts.locations +
              mappingCounts.customers}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Products {mappingCounts.products} | Locations{" "}
            {mappingCounts.locations} | Customers {mappingCounts.customers}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase">Queue Health</div>
          <div className="mt-2 text-lg font-bold text-slate-800">
            Backlog {status?.queue_health?.backlog ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Retry due {status?.queue_health?.retry_due ?? 0} | Dead letter{" "}
            {status?.queue_health?.dead_letter ?? 0}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">
            Inventory Sync Status
          </h3>
          <span
            className={`text-xs px-2 py-1 rounded-full ${config.connected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
          >
            {config.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100">
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Last Sync
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {status?.last_sync_at
                ? new Date(status.last_sync_at).toLocaleString()
                : "Never"}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Processed Events
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {status?.event_stats?.processed ?? 0}
              <span className="text-xs text-slate-400 ml-1">
                / {status?.event_stats?.total ?? 0} total
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Pending / Failed
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {status?.event_stats?.pending ?? 0}
              <span className="text-xs text-slate-400 mx-1">/</span>
              <span className="text-rose-600">
                {status?.event_stats?.failed ?? 0}
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">
              Mapped Products
            </div>
            <div className="text-sm font-semibold text-slate-800">
              {mappingCounts.products}
              <span className="text-xs text-slate-400 ml-1">products</span>
            </div>
          </div>
        </div>
        {status?.last_error && (
          <div className="px-4 py-2 bg-rose-50 border-t border-rose-100 text-xs text-rose-700">
            Last error: {status.last_error}
          </div>
        )}
      </div>
    </div>
  );
}
