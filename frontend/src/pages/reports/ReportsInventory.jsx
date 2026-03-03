import React, { useState, useEffect, useCallback } from "react";
import {
  Package,
  Search,
  ShoppingCart,
  Building2,
  TrendingUp,
  PackageX,
  AlertTriangle,
} from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

// --- Tab: Sales & Stock -------------------------------------------------------
export function SalesStockTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/sales-stock?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Sales & Stock Alignment"
      subtitle="Correlation between purchase velocity and shelf availability"
      action={
        <ExportButton
          onClick={() =>
            exportCSV("sales_stock.csv", ["Product", "Sold", "On Hand"], rows)
          }
        />
      }
    >
      <TableShell
        cols={["Product", "Units Sold", "Current Stock"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4">
              <div className="text-sm font-bold text-slate-800">{r.name}</div>
              <div className="text-[10px] text-slate-400 font-mono italic">
                {r.sku}
              </div>
            </td>
            <td className="p-4">
              <div className="text-sm font-bold text-slate-900">{r.sold}</div>
              <div className="text-[10px] text-emerald-600 font-medium">
                Revenue: {fmt(r.revenue)}
              </div>
            </td>
            <td className="p-4">
              <div
                className={`text-sm font-bold ${r.stock <= 5 ? "text-rose-600" : "text-slate-900"}`}
              >
                {r.stock}
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                In {r.outlet_name}
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Inventory Dump ------------------------------------------------------
export function InventoryDumpTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      const res = await fetch(`${API}/api/reports/inventory-dump?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId, filters.brandId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Master Inventory Audit"
      subtitle="Raw exported dump of all stock positions and valuation"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "inventory_dump.csv",
              ["SKU", "Name", "Stock", "Cost", "Value"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Product Details", "Stock Level", "Valuation"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4">
              <div className="text-sm font-bold text-slate-800">{r.name}</div>
              <div className="text-[10px] text-slate-500 font-mono tracking-tighter">
                {r.sku} | {r.category_name}
              </div>
            </td>
            <td className="p-4">
              <div className="text-sm font-bold text-slate-900">{r.stock}</div>
              <div className="text-[10px] text-slate-400 font-medium">
                {r.unit || "Units"}
              </div>
            </td>
            <td className="p-4">
              <div className="text-sm font-bold text-indigo-600">
                {fmt(r.stock * r.cost_price)}
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                Cost: {fmt(r.cost_price)} ea
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Product Performance -------------------------------------------------
export function ProductPerformanceTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/product-performance?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Product Alpha Performance"
      subtitle="Ranking by contribution margin and volume"
      action={
        <ExportButton
          onClick={() =>
            exportCSV("performance.csv", ["Product", "Sales", "Margin"], rows)
          }
        />
      }
    >
      <TableShell
        cols={["Product", "Volume", "Margin %"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 transition-colors">
            <td className="p-4 font-medium text-slate-800">{r.name}</td>
            <td className="p-4 font-bold text-slate-900">{r.sales_count}</td>
            <td className="p-4">
              <div className="text-sm font-bold text-emerald-600">
                {r.margin}%
              </div>
              <div className="w-16 bg-slate-100 h-1 rounded-full mt-1">
                <div
                  className="bg-emerald-500 h-full rounded-full"
                  style={{ width: `${r.margin}%` }}
                />
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: On Hand Inventory ---------------------------------------------------
export function OnHandTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        category_id: filters.categoryId,
      });
      const res = await fetch(`${API}/api/reports/on-hand?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.categoryId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRetail = rows.reduce((s, r) => s + r.stock * r.selling_price, 0);

  return (
    <CardShell
      title="Real-time Shelf Position"
      subtitle={`Current valuation at retail: ${fmt(totalRetail)}`}
      action={
        <ExportButton
          onClick={() =>
            exportCSV("on_hand.csv", ["Product", "Stock", "Retail Value"], rows)
          }
        />
      }
    >
      <TableShell
        cols={["Product", "Available", "Retail Value"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 text-sm font-medium text-slate-700">{r.name}</td>
            <td className="p-4 font-bold text-slate-900">{r.stock}</td>
            <td className="p-4 font-bold text-blue-600">
              {fmt(r.stock * r.selling_price)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
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
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/replenishment?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreateDraftPOs = async () => {
    if (!window.confirm("Create Draft Purchase Orders for all items below?"))
      return;
    setDrafting(true);
    setDraftResult(null);
    try {
      const res = await fetch(
        `${API}/api/reports/replenishment/create-draft-pos`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: rows, outlet_id: filters.outletId }),
        },
      );
      const d = await res.json();
      setDraftResult(d);
      if (d.success) load();
    } catch (e) {
      alert("Error creating drafts: " + e.message);
    } finally {
      setDrafting(false);
    }
  };

  const suppliersWithItems = new Set(
    rows.filter((r) => r.suggested_order > 0).map((r) => r.supplier_id),
  ).size;

  return (
    <div className="space-y-4">
      {draftResult && (
        <div
          className={`p-4 rounded-xl border ${draftResult.success ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-rose-50 border-rose-100 text-rose-800"}`}
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

      <CardShell
        title="Replenishment Engine"
        subtitle="Automatic stock out prevention and purchase suggestions"
        action={
          <div className="flex gap-2">
            {suppliersWithItems > 0 && (
              <button
                onClick={handleCreateDraftPOs}
                disabled={drafting}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:bg-slate-300 transition-colors shadow-sm"
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
                  ["Product", "Stock", "Min", "Suggest"],
                  rows,
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
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50 transition-colors">
              <td className="p-4">
                <div className="text-sm font-bold text-slate-800">{r.name}</div>
                <div className="text-[10px] text-slate-400 font-medium">
                  Supplier: {r.supplier_name || "Generic"}
                </div>
              </td>
              <td className="p-4">
                <div
                  className={`text-sm font-bold ${r.stock <= r.min_stock ? "text-rose-600" : "text-slate-900"}`}
                >
                  {r.stock}
                </div>
                <div className="text-[10px] text-slate-400 font-medium leading-none mt-1">
                  On Hand
                </div>
              </td>
              <td className="p-4 text-sm font-medium text-slate-600">
                {r.min_stock} units
              </td>
              <td className="p-4">
                <div className="text-sm font-bold text-blue-700">
                  +{r.suggested_order}
                </div>
                <div className="text-[10px] text-blue-500/70 font-bold uppercase tracking-tighter">
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

// --- Tab: Pricing & Margin Matrix ---------------------------------------------
export function PricingMarginTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/retail-matrix?${p}`);
      const d = await res.json();
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Pricing & Margin Matrix"
      subtitle="Financial health map of product catalog"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "retail_matrix.csv",
              ["Product", "Cost", "Retail", "Margin %"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Product", "Cost vs Price", "Profit/Unit", "Margin"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 font-bold text-slate-800 text-sm">{r.name}</td>
            <td className="p-4">
              <div className="text-xs text-slate-400">
                Cost: {fmt(r.cost_price)}
              </div>
              <div className="text-xs text-slate-600 font-bold">
                Sell: {fmt(r.selling_price)}
              </div>
            </td>
            <td className="p-4 text-sm font-bold text-indigo-600">
              {fmt(r.selling_price - r.cost_price)}
            </td>
            <td className="p-4">
              <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-[10px] font-bold">
                {(
                  ((r.selling_price - r.cost_price) / r.selling_price) *
                  100
                ).toFixed(1)}
                %
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}
