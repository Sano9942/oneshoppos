import React, { useMemo } from "react";
import { fmtLocalDateTime } from "../../utils/dates";
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
        <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4">
          <div className="text-xs text-(--ui-text-muted) uppercase">Connection</div>
          <div className="mt-2 text-lg font-bold text-(--ui-text)">
            {status?.connected ? "Connected" : "Not Connected"}
          </div>
          <div className="text-xs text-(--ui-text-muted) mt-1">
            {status?.shop_domain || "-"}
          </div>
        </div>
        <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4">
          <div className="text-xs text-(--ui-text-muted) uppercase">Events</div>
          <div className="mt-2 text-lg font-bold text-(--ui-text)">
            {summary.total}
          </div>
          <div className="text-xs text-(--ui-text-muted) mt-1">
            Processed {summary.processed} | Failed {summary.failed} | Pending{" "}
            {summary.pending}
          </div>
        </div>
        <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4">
          <div className="text-xs text-(--ui-text-muted) uppercase">Mappings</div>
          <div className="mt-2 text-lg font-bold text-(--ui-text)">
            {mappingCounts.products +
              mappingCounts.locations +
              mappingCounts.customers}
          </div>
          <div className="text-xs text-(--ui-text-muted) mt-1">
            Products {mappingCounts.products} | Locations{" "}
            {mappingCounts.locations} | Customers {mappingCounts.customers}
          </div>
        </div>
        <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4">
          <div className="text-xs text-(--ui-text-muted) uppercase">Queue Health</div>
          <div className="mt-2 text-lg font-bold text-(--ui-text)">
            Backlog {status?.queue_health?.backlog ?? 0}
          </div>
          <div className="text-xs text-(--ui-text-muted) mt-1">
            Retry due {status?.queue_health?.retry_due ?? 0} | Dead letter{" "}
            {status?.queue_health?.dead_letter ?? 0}
          </div>
        </div>
      </div>

      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-(--ui-border) flex items-center justify-between">
          <h3 className="text-base font-semibold text-(--ui-text)">
            Inventory Sync Status
          </h3>
          <span
            className={`text-xs px-2 py-1 rounded-full ${config.connected ? "bg-(--ui-success-bg) text-(--ui-success-fg)" : "bg-(--ui-muted-surface) text-(--ui-text-muted)"}`}
          >
            {config.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-(--ui-border)">
          <div className="p-4">
            <div className="text-xs text-(--ui-text-muted) uppercase tracking-wide mb-1">
              Last Sync
            </div>
            <div className="text-sm font-semibold text-(--ui-text)">
              {status?.last_sync_at
                ? fmtLocalDateTime(status.last_sync_at)
                : "Never"}
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-(--ui-text-muted) uppercase tracking-wide mb-1">
              Processed Events
            </div>
            <div className="text-sm font-semibold text-(--ui-text)">
              {status?.event_stats?.processed ?? 0}
              <span className="text-xs text-(--ui-text-muted) ml-1">
                / {status?.event_stats?.total ?? 0} total
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-(--ui-text-muted) uppercase tracking-wide mb-1">
              Pending / Failed
            </div>
            <div className="text-sm font-semibold text-(--ui-text)">
              {status?.event_stats?.pending ?? 0}
              <span className="text-xs text-(--ui-text-muted) mx-1">/</span>
              <span className="text-(--ui-danger-fg)">
                {status?.event_stats?.failed ?? 0}
              </span>
            </div>
          </div>
          <div className="p-4">
            <div className="text-xs text-(--ui-text-muted) uppercase tracking-wide mb-1">
              Mapped Products
            </div>
            <div className="text-sm font-semibold text-(--ui-text)">
              {mappingCounts.products}
              <span className="text-xs text-(--ui-text-muted) ml-1">products</span>
            </div>
          </div>
        </div>
        {status?.last_error && (
          <div className="px-4 py-2 bg-(--ui-danger-bg) border-t border-(--ui-danger-bg) text-xs text-(--ui-danger-fg)">
            Last error: {status.last_error}
          </div>
        )}
      </div>
    </div>
  );
}
