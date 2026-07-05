import React, { useState, useMemo, useEffect } from "react";
import { RefreshCw, CheckCircle2, ShieldAlert, Download } from "lucide-react";
import { useShopify } from "./ShopifyContext";
import { todayLocalStr } from "../../utils/dates";

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
  const [pendingApprovals, setPendingApprovals] = useState({});

  const loadReconciliation = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [reconRes, approvalsRes] = await Promise.all([
        apiFetch(`/api/integrations/shopify/reconciliation`),
        apiFetch(`/api/approvals`),
      ]);
      const reconData = await reconRes.json();
      const approvalsData = await approvalsRes
        .json()
        .catch(() => ({ approvals: [] }));

      setRows(reconData.rows || []);

      const pendingMap = {};
      (approvalsData.approvals || []).forEach((a) => {
        if (
          a.reference_type === "reconciliation" &&
          a.status === "pending_approval"
        ) {
          pendingMap[Number(a.reference_id)] = true;
        }
      });
      setPendingApprovals(pendingMap);
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

  const runReconciliation = async () => {
    setRunning(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/reconciliation`, {
        method: "POST",
      });
      if (res.ok) {
        setSuccess("Live reconciliation triggered. Refreshing data...");
        await loadReconciliation();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
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

  const requestFix = async (id, mode) => {
    try {
      const res = await apiFetch(
        `/api/integrations/shopify/reconciliation/${id}/fix`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      if (res.ok) {
        setSuccess(`Adjustment request created. Mode: ${mode}`);
        loadReconciliation(true);
      } else {
        const d = await res.json();
        setError(d.error || "Failed to create request");
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
      if (res.ok) {
        setSuccess(`Bulk ${actionType} complete.`);
        setSelectedIds([]);
        loadReconciliation(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setProcessingBulk(false);
    }
  };

  const exportCsv = () => {
    const esc = (v) => `"${String(v || "").replace(/"/g, '""')}"`;
    const headers = [
      "ID",
      "Status",
      "Product",
      "Barcode",
      "Outlet",
      "POS Qty",
      "Shopify Qty",
      "Diff",
      "Resolution",
    ];
    const lines = [headers.join(",")];
    filteredRows.forEach((r) => {
      lines.push(
        [
          r.id,
          r.status,
          esc(r.product_name),
          esc(r.barcode),
          esc(r.outlet_name),
          r.pos_qty,
          r.shopify_qty,
          r.pos_qty - r.shopify_qty,
          r.resolution_status,
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
        <h3 className="text-base font-semibold text-(--ui-text)">
          Inventory Reconciliation
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={filters.status}
            onChange={(e) =>
              setFilters((p) => ({ ...p, status: e.target.value }))
            }
            className="px-2 py-1.5 border border-(--ui-border-strong) rounded text-xs"
          >
            <option value="">All Statuses</option>
            <option value="matched">Matched</option>
            <option value="mismatch">Mismatch</option>
            <option value="error">Error</option>
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
            className="p-1.5 border border-(--ui-border-strong) rounded hover:bg-(--ui-muted-surface)"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={runReconciliation}
            disabled={running}
            className="px-3 py-1.5 bg-(--ui-primary) text-(--ui-on-primary) rounded text-xs font-semibold"
          >
            {running ? "Running..." : "Run Reconciliation"}
          </button>
          <button
            onClick={exportCsv}
            className="p-1.5 border border-(--ui-border-strong) rounded hover:bg-(--ui-muted-surface)"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="bg-(--ui-muted-surface) px-4 py-2 border-b border-(--ui-border) flex items-center gap-4 text-xs font-medium text-(--ui-text)">
          <span>{selectedIds.length} items selected</span>
          <button
            onClick={() => runBulkAction("ignore")}
            className="text-(--ui-text-muted) hover:text-(--ui-text)"
          >
            Ignore
          </button>
          <button
            onClick={() => runBulkAction("fix", "pos_wins")}
            className="text-(--ui-link) hover:text-(--ui-link)"
          >
            POS Wins
          </button>
          <button
            onClick={() => runBulkAction("fix", "shopify_wins")}
            className="text-(--ui-success-fg) hover:text-(--ui-success-fg)"
          >
            Shopify Wins
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
              <th className="p-3">POS</th>
              <th className="p-3">Shopify</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((r) => {
              const diff = r.pos_qty - r.shopify_qty;
              const isPending = pendingApprovals[r.id];
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
                    {r.shopify_qty}
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${r.status === "matched" ? "bg-(--ui-success-bg) text-(--ui-success-fg)" : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"}`}
                    >
                      {r.status}{" "}
                      {diff !== 0 ? `(${diff > 0 ? "+" : ""}${diff})` : ""}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-1">
                    {r.resolution_status === "open" &&
                      !isPending &&
                      r.status !== "matched" && (
                        <>
                          <button
                            onClick={() => requestFix(r.id, "pos_wins")}
                            className="px-2 py-1 bg-(--ui-muted-surface) text-(--ui-link) border border-(--ui-focus) rounded text-[10px] font-bold"
                          >
                            POS Wins
                          </button>
                          <button
                            onClick={() => requestFix(r.id, "shopify_wins")}
                            className="px-2 py-1 bg-(--ui-success-bg) text-(--ui-success-fg) border border-(--ui-success-bg) rounded text-[10px] font-bold"
                          >
                            Shopify Wins
                          </button>
                          <button
                            onClick={() =>
                              resolveReconciliation(r.id, "ignored")
                            }
                            className="px-2 py-1 text-(--ui-text-muted) hover:text-(--ui-text-muted) text-[10px]"
                          >
                            Ignore
                          </button>
                        </>
                      )}
                    {isPending && (
                      <span className="text-[10px] text-(--ui-warning-fg) italic">
                        Pending Approval
                      </span>
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
