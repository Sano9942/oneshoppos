import React, { useState, useMemo, useEffect } from "react";
import { RefreshCw, Download } from "lucide-react";
import { useShopify } from "./ShopifyContext";
import { todayLocalStr, fmtUtcDateTime } from "../../utils/dates";
import { ConfirmDialog } from "../../ui/primitives";

// What each check status means, in the owner's words.
const STATUS_LABELS = {
  matched: "Same",
  mismatch: "Different",
  not_at_location: "Not stocked here on Shopify",
  not_found: "Unknown to Shopify",
  error: "Couldn't read Shopify",
  waiting: "Update on its way",
};

// The number Shopify is set to for a SanoPOS count (negative shows as 0).
const shopifyTarget = (posQty) => {
  const n = Math.floor(Number(posQty || 0));
  return n > 0 ? n : 0;
};

function describeSetResult(d) {
  const parts = [`${d.set || 0} item(s) set on Shopify`];
  if (d.mismatch) parts.push(`${d.mismatch} still different`);
  if (d.waiting) parts.push(`${d.waiting} waiting for an earlier update`);
  if (d.not_found) parts.push(`${d.not_found} unknown to Shopify`);
  if (d.not_at_location)
    parts.push(`${d.not_at_location} not stocked at that Shopify location`);
  if (d.errors) parts.push(`${d.errors} couldn't be read`);
  return parts.join(", ") + ".";
}

export default function ShopifyReconciliation() {
  const { apiFetch, setError, setSuccess } = useShopify();

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState([]);
  const [filters, setFilters] = useState({
    status: "",
    resolution_status: "open",
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [confirmSetAll, setConfirmSetAll] = useState(false);
  const [settingAll, setSettingAll] = useState(false);
  const [lastSetResult, setLastSetResult] = useState(null);

  const loadReconciliation = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const reconRes = await apiFetch(`/api/integrations/shopify/reconciliation`);
      const reconData = await reconRes.json();
      setRows(reconData.rows || []);
    } catch (err) {
      setError("Failed to load reconciliation: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReconciliation(true);
  }, []);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filters.status && String(r.status || "") !== filters.status)
        return false;
      if (
        filters.resolution_status &&
        String(r.resolution_status || "open") !== filters.resolution_status
      )
        return false;
      return true;
    });
  }, [rows, filters]);

  const lastChecked = rows.reduce(
    (latest, r) => (r.checked_at && (!latest || r.checked_at > latest) ? r.checked_at : latest),
    null,
  );

  const runReconciliation = async () => {
    setRunning(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/reconciliation`, {
        method: "POST",
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        setSuccess(
          `Checked ${d.row_count} item(s): ${d.matched} the same, ${d.mismatch} different.`,
        );
        await loadReconciliation();
      } else {
        setError(d.error || "Check failed");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const showSetResult = (d) => {
    setLastSetResult(d);
    const msg = describeSetResult(d);
    if (d.mismatch || d.waiting || d.failed) setError(msg);
    else setSuccess(msg);
  };

  // Sets Shopify's count to SanoPOS's count. ids = rows of the check; none = every item.
  const setShopifyToPos = async (ids = null) => {
    const res = await apiFetch(`/api/integrations/shopify/stock/set-to-pos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ids ? { ids } : {}),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Couldn't set Shopify counts");
    showSetResult(d);
    return d;
  };

  const runSetAll = async () => {
    setSettingAll(true);
    try {
      await setShopifyToPos();
      setConfirmSetAll(false);
      await loadReconciliation(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingAll(false);
    }
  };

  const setRowToPos = async (id) => {
    try {
      await setShopifyToPos([id]);
      loadReconciliation(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const resolveReconciliation = async (id, resolution_status) => {
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/reconciliation/${id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution_status }),
        },
      );
      if (res.ok) {
        setSuccess(`Problem marked as ${resolution_status}`);
        loadReconciliation(true);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredRows.length) setSelectedIds([]);
    else setSelectedIds(filteredRows.map((r) => r.id));
  };

  const toggleSelectRow = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const runBulkAction = async (actionType, mode = null) => {
    if (!selectedIds.length) return;
    setProcessingBulk(true);
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/reconciliation/bulk`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: selectedIds, action: actionType, mode }),
        },
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (actionType === "fix" && mode === "pos_wins") showSetResult(d);
        else setSuccess(d.message || `Bulk ${actionType} complete.`);
        setSelectedIds([]);
        loadReconciliation(true);
      } else {
        setError(d.error || `Bulk ${actionType} failed`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingBulk(false);
    }
  };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const headers = [
      "ID",
      "Status",
      "Product",
      "Barcode",
      "Outlet",
      "SanoPOS Qty",
      "Shopify Qty",
      "Diff",
      "Resolution",
      "Note",
    ];
    const lines = [headers.join(",")];
    filteredRows.forEach((r) => {
      lines.push(
        [
          r.id,
          esc(STATUS_LABELS[r.status] || r.status),
          esc(r.product_name),
          esc(r.barcode),
          esc(r.outlet_name),
          r.pos_qty,
          r.shopify_qty ?? "",
          r.diff ?? "",
          r.resolution_status,
          esc(r.resolution_note),
        ].join(","),
      );
    });
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `recon_${todayLocalStr()}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-(--ui-border) flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-(--ui-text)">
            Inventory Reconciliation
          </h3>
          <p className="text-xs text-(--ui-text-muted)">
            SanoPOS counts vs Shopify. Checked automatically once a day; the
            daily check only reports, it never changes a count.
            {lastChecked ? ` Last checked ${fmtUtcDateTime(lastChecked)}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((p) => ({ ...p, status: e.target.value }))
            }
            className="px-2 py-1.5 border border-(--ui-border-strong) rounded text-xs"
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={filters.resolution_status}
            onChange={(e) =>
              setFilters((p) => ({ ...p, resolution_status: e.target.value }))
            }
            className="px-2 py-1.5 border border-(--ui-border-strong) rounded text-xs"
          >
            <option value="">All Resolutions</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="ignored">Ignored</option>
          </select>
          <button
            onClick={() => loadReconciliation(false)}
            disabled={loading}
            aria-label="Reload"
            className="p-1.5 border border-(--ui-border-strong) rounded hover:bg-(--ui-muted-surface)"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={runReconciliation}
            disabled={running}
            className="px-3 py-1.5 border border-(--ui-border-strong) rounded text-xs font-semibold text-(--ui-text) hover:bg-(--ui-muted-surface)"
          >
            {running ? "Checking..." : "Check now"}
          </button>
          <button
            onClick={() => setConfirmSetAll(true)}
            disabled={settingAll}
            className="px-3 py-1.5 bg-(--ui-primary) text-(--ui-on-primary) rounded text-xs font-semibold"
          >
            {settingAll ? "Setting..." : "Set Shopify to SanoPOS counts"}
          </button>
          <button
            onClick={exportCsv}
            aria-label="Download CSV"
            className="p-1.5 border border-(--ui-border-strong) rounded hover:bg-(--ui-muted-surface)"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmSetAll}
        title="Set Shopify to SanoPOS counts?"
        body="Every linked item on Shopify will be changed to show the SanoPOS count for its shop. Items with an update still on its way are skipped. If Shopify's count changes while this runs (an online order), that item is left alone and you can run it again."
        confirmLabel="Set Shopify counts"
        busy={settingAll}
        onConfirm={runSetAll}
        onCancel={() => setConfirmSetAll(false)}
      />

      {lastSetResult && (
        <div className="px-4 py-2 border-b border-(--ui-border) text-xs text-(--ui-text)">
          Last set: {describeSetResult(lastSetResult)}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="bg-(--ui-muted-surface) px-4 py-2 border-b border-(--ui-border) flex items-center gap-4 text-xs font-medium text-(--ui-text)">
          <span>{selectedIds.length} items selected</span>
          <button
            onClick={() => runBulkAction("ignore")}
            disabled={processingBulk}
            className="text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            Ignore
          </button>
          <button
            onClick={() => runBulkAction("fix", "pos_wins")}
            disabled={processingBulk}
            className="text-(--ui-link) hover:text-(--ui-link)"
          >
            Set Shopify to SanoPOS
          </button>
          <button
            onClick={() => runBulkAction("fix", "shopify_wins")}
            disabled={processingBulk}
            className="text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            Copy Shopify count into SanoPOS
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-(--ui-muted-surface) text-(--ui-text-muted) text-left">
            <tr>
              <th className="p-3 w-10">
                <input
                  type="checkbox"
                  checked={
                    selectedIds.length === filteredRows.length &&
                    filteredRows.length > 0
                  }
                  onChange={toggleSelectAll}
                />
              </th>
              <th className="p-3">Product</th>
              <th className="p-3">Outlet</th>
              <th className="p-3">SanoPOS</th>
              <th className="p-3">Shopify</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              const diff =
                r.diff === null || r.diff === undefined ? 0 : Number(r.diff);
              return (
                <tr
                  key={r.id}
                  className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)/50"
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(r.id)}
                      onChange={() => toggleSelectRow(r.id)}
                    />
                  </td>
                  <td className="p-3">
                    <div className="text-(--ui-text) font-medium">
                      {r.product_name}
                    </div>
                    <div className="text-[10px] text-(--ui-text-muted) font-mono">
                      {r.barcode}
                    </div>
                  </td>
                  <td className="p-3 text-(--ui-text-muted) font-medium">
                    {r.outlet_name}
                  </td>
                  <td className="p-3 text-(--ui-text) font-bold">{r.pos_qty}</td>
                  <td className="p-3 text-(--ui-text) font-bold">
                    {r.shopify_qty ?? "—"}
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${r.status === "matched" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"}`}
                    >
                      {STATUS_LABELS[r.status] || r.status}{" "}
                      {diff !== 0 ? `(${diff > 0 ? "+" : ""}${diff})` : ""}
                    </span>
                    {r.resolution_note && (
                      <div className="text-[10px] text-(--ui-text-muted) mt-1 max-w-xs">
                        {r.resolution_note}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-right space-x-1">
                    {r.resolution_status === "open" && r.status !== "matched" && (
                      <>
                        {r.status === "mismatch" && (
                          <button
                            onClick={() => setRowToPos(r.id)}
                            className="px-2 py-1 bg-(--ui-muted-surface) text-(--ui-link) border border-(--ui-focus) rounded text-[10px] font-bold"
                          >
                            Set Shopify to {shopifyTarget(r.pos_qty)}
                          </button>
                        )}
                        <button
                          onClick={() => resolveReconciliation(r.id, "ignored")}
                          className="px-2 py-1 text-(--ui-text-muted) hover:text-(--ui-text-muted) text-[10px]"
                        >
                          Ignore
                        </button>
                      </>
                    )}
                    {r.resolution_status !== "open" && (
                      <span className="text-[10px] text-(--ui-text-muted) uppercase font-bold">
                        {r.resolution_status}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
