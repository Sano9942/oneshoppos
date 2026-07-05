import React, { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { api } from "../../api";
import {
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

function InventoryHealthStat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-(--ui-text)">{value}</p>
      {hint ? <p className="mt-1 text-xs text-(--ui-text-muted)">{hint}</p> : null}
    </div>
  );
}

// --- Tab: Replenishment -------------------------------------------------------
export function ReplenishmentTab({ filters }) {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/replenishment?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const rowsWithSuggestion = rows.map((row) => ({
    ...row,
    suggested_order: Math.max(0, Number(row.min_qty || 0) - Number(row.quantity || 0)),
  }));

  const handleCreateDraftPOs = async () => {
    if (!window.confirm("Create Draft Purchase Orders for all items below?"))
      return;
    setDrafting(true);
    setDraftResult(null);
    try {
      const candidates = rowsWithSuggestion.filter(
        (row) => Number(row.suggested_order || 0) > 0 && Number(row.supplier_id || 0) > 0,
      );
      const grouped = new Map();
      candidates.forEach((row) => {
        const sid = Number(row.supplier_id || 0);
        if (!grouped.has(sid)) grouped.set(sid, []);
        grouped.get(sid).push(row);
      });

      let createdCount = 0;
      const failed = [];
      for (const [supplierId, supplierRows] of grouped.entries()) {
        const items = supplierRows.map((row) => ({
          product_id: Number(row.product_id),
        quantity: Number(row.suggested_order || 0),
        cost_price: Number(row.cost_price || 0),
        }));
        const total_cost = items.reduce(
          (sum, item) => sum + Number(item.quantity || 0) * Number(item.cost_price || 0),
        0,
        );

        const res = await api.raw("/api/purchase-orders", {
          method: "POST",
          body: JSON.stringify({
            supplier_id: supplierId,
            total_cost,
            items,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          createdCount += 1;
        } else {
          failed.push(`Supplier ${supplierId}: ${data.error || "Request failed"}`);
        }
      }

      const result = {
        success: failed.length === 0,
        created_count: createdCount,
        failed,
      };
      setDraftResult(result);
      if (result.success) load();
    } catch (e) {
      alert("Error creating drafts: " + e.message);
    } finally {
      setDrafting(false);
    }
  };

  const suppliersWithItems = new Set(
    rowsWithSuggestion.filter((r) => r.suggested_order > 0).map((r) => r.supplier_id),
  ).size;
  const totalSuggested = rowsWithSuggestion.reduce(
    (sum, row) => sum + Number(row.suggested_order || 0),
    0,
  );

  return (
    <div className="space-y-4">
      {draftResult && (
        <div
          className={`p-4 rounded-xl border ${draftResult.success ? "bg-(--ui-success-bg) border-(--ui-success-bg) text-(--ui-success-fg)" : "bg-(--ui-danger-bg) border-(--ui-danger-bg) text-(--ui-danger-fg)"}`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            {draftResult.success ? "Success!" : "Drafting Incomplete"}
          </div>
          <p className="text-sm">
            Created {draftResult.created_count} Draft POs.{" "}
            {draftResult.failed?.length > 0 &&
              `Failed: ${draftResult.failed.join(", ")}`}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Items Below Min
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rowsWithSuggestion.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Suggested Units
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalSuggested}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Suppliers Impacted
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{suppliersWithItems}</p>
        </div>
      </div>

      <CardShell
        title="Replenishment Engine"
        subtitle="Automatic stock out prevention and purchase suggestions"
        action={
          <div className="flex gap-2">
            {suppliersWithItems > 0 && (
              <button
                onClick={handleCreateDraftPOs}
                disabled={drafting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-(--ui-primary) text-(--ui-on-primary) rounded-lg text-xs font-bold hover:bg-(--ui-primary-strong) disabled:bg-(--ui-muted-surface) transition-colors"
              >
                <ShoppingCart size={14} />
                {drafting
                  ? "Creating..."
                  : `Draft POs for ${suppliersWithItems} Suppliers`}
              </button>
            )}
            <ExportButton
              onClick={() =>
                exportCSV(
                  "replenishment.csv",
                  [
                    { header: "Product", key: "product_name" },
                    { header: "Barcode", key: "barcode" },
                    { header: "Outlet", key: "outlet_name" },
                    { header: "On Hand", key: "quantity" },
                    { header: "Minimum", key: "min_qty" },
                    { header: "Suggested", key: "suggested_order" },
                    { header: "Supplier", key: "supplier_name" },
                  ],
        rowsWithSuggestion,
                )
              }
            />
          </div>
        }
      >
        <TableShell
          cols={["Product", "Current Stock", "Threshold", "Suggestion"]}
          loading={loading}
          empty={!rows.length}
        >
          {rowsWithSuggestion.map((r, i) => (
            <tr key={`${r.outlet_id}-${r.product_id}-${i}`} className="hover:bg-(--ui-muted-surface) transition-colors">
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-text)">{r.product_name}</div>
                <div className="text-[10px] font-mono text-(--ui-text-muted)">
                  {r.barcode}
                </div>
                <div className="text-[10px] text-(--ui-text-muted) font-medium">
                  Supplier: {r.supplier_name || "Generic"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div
                  className={`text-sm font-bold ${r.quantity <= r.min_qty ? "text-(--ui-danger-fg)" : "text-(--ui-text)"}`}
                >
                  {r.quantity}
                </div>
                <div className="text-[10px] text-(--ui-text-muted) font-medium leading-none mt-1">
                  {r.outlet_name}
                </div>
              </td>
              <td className="px-4 py-3 text-sm font-medium text-(--ui-text-muted)">
                {r.min_qty} units
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-link)">
                  +{r.suggested_order}
                </div>
                <div className="text-[10px] text-(--ui-link)/70 font-bold uppercase tracking-tighter">
                  Required
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Stockout Risk ------------------------------------------------------
export function StockoutRiskTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        lookback_days: String(lookbackDays),
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/stockout-risk?${p}`);
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    lookbackDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const highRisk = rows.filter((row) => row.risk_level === "high").length;
  const mediumRisk = rows.filter((row) => row.risk_level === "medium").length;
  const stable = rows.filter((row) => row.risk_level === "stable").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Lookback Days</span>
          <input
            type="number"
            min="7"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value || 7))}
            className="w-20 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="High Risk" value={highRisk} />
        <InventoryHealthStat label="Medium Risk" value={mediumRisk} />
        <InventoryHealthStat label="Stable" value={stable} />
        <InventoryHealthStat label="Rows" value={rows.length} />
      </div>

      <CardShell
        title="Stockout Risk"
        subtitle="Velocity-based days-of-cover view to spot fast movers that will run out soon"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "stockout_risk.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Stock Qty", key: "stock_qty" },
                  { header: "Average Daily Units", key: "avg_daily_units" },
                  { header: "Days of Cover", key: "days_of_cover" },
                  { header: "Risk Level", key: "risk_level" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "On Hand", "Velocity", "Days of Cover", "Risk"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={AlertTriangle}
        >
          {rows.map((row, i) => {
            const riskTone =
              row.risk_level === "high"
                ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                : row.risk_level === "medium"
                  ? "bg-(--ui-warning-bg) text-(--ui-warning-fg)"
                  : "bg-(--ui-muted-surface) text-(--ui-text)";
            return (
              <tr key={`${row.product_id}-${row.outlet_id}-${i}`} className="hover:bg-(--ui-muted-surface)">
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-(--ui-text)">{row.product_name}</div>
                  <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-(--ui-text)">{row.outlet_name}</div>
                  <div className="text-[11px] text-(--ui-text-muted)">{row.category}</div>
                  <div className="text-[11px] text-(--ui-text-muted)">{row.brand} | {row.supplier}</div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{row.stock_qty}</td>
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{Number(row.avg_daily_units || 0).toFixed(2)} / day</td>
                <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                  {row.days_of_cover == null ? "N/A" : row.days_of_cover}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${riskTone}`}>
                    {row.risk_level || "stable"}
                  </span>
                </td>
              </tr>
            );
          })}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Forecast Demand ----------------------------------------------------
export function ForecastDemandTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(28);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        lookback_days: String(lookbackDays),
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/forecast-demand?${p}`);
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    lookbackDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalForecast7d = rows.reduce((sum, row) => sum + Number(row.forecast_7d_units || 0), 0);
  const totalForecast14d = rows.reduce((sum, row) => sum + Number(row.forecast_14d_units || 0), 0);
  const atRisk = rows.filter((row) => Number(row.days_of_cover || 99999) < 14).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Lookback Days</span>
          <input
            type="number"
            min="7"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value || 7))}
            className="w-20 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="Rows" value={rows.length} />
        <InventoryHealthStat label="7-Day Forecast" value={Math.round(totalForecast7d)} />
        <InventoryHealthStat label="14-Day Forecast" value={Math.round(totalForecast14d)} />
        <InventoryHealthStat label="Cover < 14 Days" value={atRisk} />
      </div>

      <CardShell
        title="Forecast Demand"
        subtitle="Moving-average demand projection using recent sales velocity by outlet"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "forecast_demand.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Units Lookback", key: "units_lookback" },
                  { header: "Average Daily Units", key: "avg_daily_units" },
                  { header: "On Hand", key: "on_hand_qty" },
                  { header: "Forecast 7D", key: "forecast_7d_units" },
                  { header: "Forecast 14D", key: "forecast_14d_units" },
                  { header: "Days of Cover", key: "days_of_cover" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Avg Daily", "On Hand", "Forecast 7D / 14D", "Cover"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={TrendingUp}
        >
          {rows.map((row, i) => (
            <tr key={`${row.product_id}-${row.outlet_id}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.outlet_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.brand} | {row.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {Number(row.avg_daily_units || 0).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{row.on_hand_qty}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                <div>7D: {Number(row.forecast_7d_units || 0).toFixed(2)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">14D: {Number(row.forecast_14d_units || 0).toFixed(2)}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {row.days_of_cover == null ? "N/A" : row.days_of_cover}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Replenishment Smart ------------------------------------------------
export function ReplenishmentSmartTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lookbackDays, setLookbackDays] = useState(28);
  const [forecastDays, setForecastDays] = useState(14);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        supplier_id: filters.supplierId,
        search: filters.search,
        lookback_days: String(lookbackDays),
        forecast_days: String(forecastDays),
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/replenishment-smart?${p}`);
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
    filters.supplierId,
    filters.search,
    lookbackDays,
    forecastDays,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const reorderRows = rows.filter((row) => Number(row.suggested_reorder_qty || 0) > 0);
  const totalSuggested = reorderRows.reduce((sum, row) => sum + Number(row.suggested_reorder_qty || 0), 0);
  const totalTarget = reorderRows.reduce((sum, row) => sum + Number(row.target_cover_units || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Lookback</span>
          <input
            type="number"
            min="7"
            max="365"
            value={lookbackDays}
            onChange={(e) => setLookbackDays(Number(e.target.value || 7))}
            className="w-16 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-(--ui-border) px-3 py-1.5">
          <span className="text-xs font-semibold text-(--ui-text-muted)">Forecast</span>
          <input
            type="number"
            min="7"
            max="90"
            value={forecastDays}
            onChange={(e) => setForecastDays(Number(e.target.value || 7))}
            className="w-16 border-none bg-transparent p-0 text-sm font-semibold focus:ring-0"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <InventoryHealthStat label="Reorder Rows" value={reorderRows.length} />
        <InventoryHealthStat label="Suggested Qty" value={totalSuggested} />
        <InventoryHealthStat label="Target Cover Units" value={Math.round(totalTarget)} />
        <InventoryHealthStat label="Rows in Scope" value={rows.length} />
      </div>

      <CardShell
        title="Replenishment Smart"
        subtitle="Suggested reorder quantities from velocity, on-hand, and chosen forecast cover window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "replenishment_smart.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier" },
                  { header: "Average Daily Units", key: "avg_daily_units" },
                  { header: "On Hand", key: "on_hand_qty" },
                  { header: "Days of Cover", key: "days_of_cover" },
                  { header: "Target Cover Units", key: "target_cover_units" },
                  { header: "Suggested Reorder Qty", key: "suggested_reorder_qty" },
                ],
        reorderRows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Outlet / Tags", "Avg Daily", "On Hand", "Target Cover", "Suggested Reorder"]}
          loading={loading}
          empty={!reorderRows.length}
          emptyIcon={ShoppingCart}
        >
          {reorderRows.map((row, i) => (
            <tr key={`${row.product_id}-${row.outlet_id}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{row.outlet_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.brand} | {row.supplier}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {Number(row.avg_daily_units || 0).toFixed(2)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{row.on_hand_qty}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                <div>{Number(row.target_cover_units || 0).toFixed(2)} units</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.days_of_cover ?? "N/A"} days cover</div>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-(--ui-muted-surface) px-2 py-1 text-xs font-bold text-(--ui-link)">
                  +{row.suggested_reorder_qty}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
