import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "../../../ui/primitives";
import { usePOS } from "./POSContext";

// After offline sales sync (One Toy Store blocker 3e/3f): the items sold past
// SanoPOS's stock, to recount, and the closed tills that got cash afterwards
// (their closing count showed that cash as extra). Stays until dismissed.
export default function POSSyncReport() {
  const { syncReport, dismissSyncReport } = usePOS();
  if (!syncReport) return null;
  const { pastStock = [], tillsClosed = [] } = syncReport;
  if (!pastStock.length && !tillsClosed.length) return null;
  return (
    <div className="mx-4 mt-2 rounded-xl border border-(--ui-border-strong) bg-(--ui-warning-bg) px-4 py-3 text-sm text-(--ui-warning-fg)">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-2">
            {pastStock.length > 0 && (
              <div>
                <p className="font-semibold">Sold offline past stock: recount these</p>
                <ul className="mt-1 list-disc pl-5">
                  {pastStock.map((r, i) => (
                    <li key={`${r.product_id}-${r.variant_id ?? 0}-${i}`}>
                      {r.name || `Item #${r.product_id}`}: sold {r.requested}, SanoPOS had {r.available}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {tillsClosed.length > 0 && (
              <p>
                Offline sales went into {tillsClosed.map((id) => `till #${id}`).join(", ")}, already closed.
                Its closing count showed this cash as extra; the figures now include it.
              </p>
            )}
          </div>
        </div>
        <Button type="button" tone="plain" size="sm" onClick={dismissSyncReport}>
          <X size={12} /> Dismiss
        </Button>
      </div>
    </div>
  );
}
