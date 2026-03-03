import React, { useState, useEffect, useCallback } from "react";
import { TrendingDown, Recycle, ArrowLeftRight, Building2 } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
  MetricCard,
} from "./ReportShared";

// --- Tab: Inventory Loss ------------------------------------------------------
export function InventoryLossTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/inventory-loss?${p}`);
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
      title="Inventory Loss Analysis"
      subtitle="Discrepancies identified during stock takes and audits"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "inventory_loss.csv",
              ["Date", "Product", "Qty Lost", "Value"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Date", "Product", "Quantity", "Loss Value"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4 text-sm text-slate-500">{fmtDate(r.date)}</td>
            <td className="p-4 font-bold text-slate-800 text-sm">
              {r.product_name}
            </td>
            <td className="p-4 text-rose-600 font-bold">-{r.quantity}</td>
            <td className="p-4 font-bold text-slate-900">
              {fmt(r.loss_value)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Wastage -------------------------------------------------------------
export function WastageTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/wastage?${p}`);
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
      title="Wastage & Expiry Report"
      subtitle="Tracking products removed from stock due to damage or expiry"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "wastage.csv",
              ["Date", "Product", "Reason", "Value"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Date", "Product", "Reason", "Value"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 text-slate-500">{fmtDate(r.date)}</td>
            <td className="p-4 font-bold text-slate-800">{r.product_name}</td>
            <td className="p-4">
              <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-[10px] font-bold italic uppercase tracking-wider">
                {r.reason || "Damage"}
              </span>
            </td>
            <td className="p-4 font-bold text-rose-600">{fmt(r.value)}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Product Movement ----------------------------------------------------
export function ProductMovementTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/product-movement?${p}`);
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
      title="Inter-Outlet Transfers"
      subtitle="Inventory lifecycle across physical locations"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "movement.csv",
              ["Date", "Product", "From", "To", "Qty"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Date", "Product", "Transfer", "Qty"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 text-slate-500">{fmtDateTime(r.timestamp)}</td>
            <td className="p-4 font-bold text-slate-800">{r.product_name}</td>
            <td className="p-4 font-medium text-slate-600">
              {r.from_outlet_name} <span className="text-blue-500 mx-1">→</span>{" "}
              {r.to_outlet_name}
            </td>
            <td className="p-4 font-bold text-blue-700">{r.quantity}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: STR Report ----------------------------------------------------------
export function STRReportTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/str-report?${p}`);
      const d = await res.json();
      setRows(d.rows || d || []);
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
      title="Stock Transfer Report (STR)"
      subtitle="Formal register of inventory movement"
      action={
        <ExportButton
          onClick={() =>
            exportCSV("str.csv", ["Date", "From", "To", "Items"], rows)
          }
        />
      }
    >
      <TableShell
        cols={["Reference", "Date", "Domain", "Items"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 font-mono font-bold text-indigo-600 uppercase">
              STR-{String(i + 1).padStart(4, "0")}
            </td>
            <td className="p-4 text-slate-500">{fmtDateTime(r.timestamp)}</td>
            <td className="p-4 font-medium text-slate-600">
              {r.from_outlet_name} → {r.to_outlet_name}
            </td>
            <td className="p-4 font-bold text-slate-900">{r.quantity}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Outlet Comparison ---------------------------------------------------
export function OutletComparisonTab({ filters }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      const res = await fetch(`${API}/api/reports/outlet-comparison?${p}`);
      const d = await res.json();
      setData(d.comparison || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading)
    return (
      <div className="p-8 text-center text-slate-400 font-medium">
        Analyzing outlet performance...
      </div>
    );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data.map((o) => (
          <div
            key={o.outlet_id}
            className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900">{o.outlet_name}</h3>
                  <p className="text-xs text-slate-500">
                    {o.total_orders} Transactions
                  </p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-slate-900">
                  {fmt(o.total_revenue)}
                </div>
                <div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
                  Revenue
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-50">
              <div className="p-3 bg-slate-50 rounded-xl">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Avg Ticket
                </p>
                <p className="font-bold text-slate-800">
                  {fmt(o.total_revenue / o.total_orders || 0)}
                </p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">
                  Item Velocity
                </p>
                <p className="font-bold text-slate-800">
                  {(o.total_items / o.total_orders || 0).toFixed(1)} / tx
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
