import React, { useState, useEffect, useCallback } from "react";
import { Building2 } from "lucide-react";
import { api } from "../../api";
import {
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
  MetricCard,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

export function InventoryLossTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/inventory-loss?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQty = rows.reduce(
    (sum, row) => sum + Math.abs(Number(row.quantity_change || 0)),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="Loss Rows" value={rows.length} compPct={0} compLabel="Events" />
        <MetricCard title="Qty Lost" value={totalQty} compPct={0} compLabel="Units" />
        <MetricCard
          title="Reasons Seen"
          value={new Set(rows.map((row) => row.reason).filter(Boolean)).size}
          compPct={0}
          compLabel="Reasons"
        />
      </div>

      <CardShell
        title="Inventory Loss Analysis"
        subtitle="Negative stock adjustments identified during stock takes and audits"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "inventory_loss.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Quantity Change", key: "quantity_change" },
                  { header: "Reason", key: "reason" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Date", "Product", "Outlet", "Qty Lost", "Reason"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface)">
              <td className="p-4 text-sm text-(--ui-text-muted)">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 text-sm">
                <div className="font-bold text-(--ui-text)">{r.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{r.barcode}</div>
              </td>
              <td className="p-4 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="p-4 text-(--ui-danger-fg) font-bold">
                {Math.abs(Number(r.quantity_change || 0))}
              </td>
              <td className="p-4 text-sm text-(--ui-text)">{r.reason || "-"}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function WastageTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/wastage?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQty = rows.reduce(
    (sum, row) => sum + Math.abs(Number(row.quantity_change || 0)),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="Wastage Rows" value={rows.length} compPct={0} compLabel="Events" />
        <MetricCard title="Units Removed" value={totalQty} compPct={0} compLabel="Units" />
        <MetricCard
          title="Expired Rows"
          value={rows.filter((row) => row.reason === "Expired").length}
          compPct={0}
          compLabel="Subset"
        />
      </div>

      <CardShell
        title="Wastage & Expiry Report"
        subtitle="Products removed from stock due to damage or expiry"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "wastage.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Quantity Change", key: "quantity_change" },
                  { header: "Reason", key: "reason" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Date", "Product", "Outlet", "Reason", "Qty Removed"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 text-(--ui-text-muted)">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 font-bold text-(--ui-text)">{r.product_name}</td>
              <td className="p-4 text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="p-4">
                <span className="bg-(--ui-warning-bg) text-(--ui-warning-fg) px-2 py-0.5 rounded text-[10px] font-bold italic uppercase tracking-wider">
                  {r.reason || "Damage"}
                </span>
              </td>
              <td className="p-4 font-bold text-(--ui-danger-fg)">
                {Math.abs(Number(r.quantity_change || 0))}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ProductMovementTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/product-movement?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="Transfers" value={rows.length} compPct={0} compLabel="Lines" />
        <MetricCard title="Units Moved" value={totalQty} compPct={0} compLabel="Units" />
        <MetricCard
          title="Routes Used"
          value={new Set(rows.map((row) => `${row.from_outlet_name}->${row.to_outlet_name}`)).size}
          compPct={0}
          compLabel="Pairs"
        />
      </div>

      <CardShell
        title="Inter-Outlet Transfers"
        subtitle="Inventory lifecycle across physical locations"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "movement.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "From Outlet", key: "from_outlet_name" },
                  { header: "To Outlet", key: "to_outlet_name" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Employee", key: "employee_name" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Date", "Product", "Transfer", "Qty", "By"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 text-(--ui-text-muted)">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4">
                <div className="font-bold text-(--ui-text)">{r.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{r.barcode}</div>
              </td>
              <td className="p-4 font-medium text-(--ui-text-muted)">
                {r.from_outlet_name} <span className="text-(--ui-link) mx-1">-&gt;</span> {r.to_outlet_name}
              </td>
              <td className="p-4 font-bold text-(--ui-link)">{r.quantity}</td>
              <td className="p-4 text-sm text-(--ui-text-muted)">{r.employee_name}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function STRReportTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/str-report?${p}`);
      setRows(d.items || d.rows || d || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalQty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="STR Rows" value={rows.length} compPct={0} compLabel="Transfers" />
        <MetricCard title="Units in STR" value={totalQty} compPct={0} compLabel="Units" />
        <MetricCard
          title="Routes Used"
          value={new Set(rows.map((row) => `${row.from_outlet_name}->${row.to_outlet_name}`)).size}
          compPct={0}
          compLabel="Pairs"
        />
      </div>

      <CardShell
        title="Stock Transfer Report (STR)"
        subtitle="Formal register of grouped stock transfer movements"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "str.csv",
                [
                  { header: "Reference ID", key: "reference_id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "From Outlet", key: "from_outlet_name" },
                  { header: "To Outlet", key: "to_outlet_name" },
                  { header: "Quantity", key: "quantity" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Reference", "Date", "Route", "Items"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-mono font-bold text-(--ui-link) uppercase">
                STR-{String(r.reference_id || i + 1).padStart(4, "0")}
              </td>
              <td className="p-4 text-(--ui-text-muted)">{fmtDateTime(r.timestamp)}</td>
              <td className="p-4 font-medium text-(--ui-text-muted)">
                {r.from_outlet_name} -&gt; {r.to_outlet_name}
              </td>
              <td className="p-4 font-bold text-(--ui-text)">{r.quantity}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function OutletComparisonTab({ filters }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/outlet-comparison?${p}`);
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

  if (loading) {
    return (
      <div className="p-8 text-center text-(--ui-text-muted) font-medium">
        Analyzing outlet performance...
      </div>
    );
  }

  const totalRevenue = data.reduce((sum, row) => sum + Number(row.revenue || 0), 0);
  const totalOrders = data.reduce((sum, row) => sum + Number(row.order_count || 0), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard title="Outlets Compared" value={data.length} compPct={0} compLabel="Outlets" />
        <MetricCard title="Revenue" value={fmt(totalRevenue)} compPct={0} compLabel="Range" />
        <MetricCard title="Orders" value={totalOrders} compPct={0} compLabel="Range" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {data.map((o) => (
          <div
            key={o.id}
            className="bg-(--ui-surface) rounded-2xl border border-(--ui-border) p-5 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-(--ui-muted-surface) flex items-center justify-center text-(--ui-link)">
                  <Building2 size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-(--ui-text)">{o.name}</h3>
                  <p className="text-xs text-(--ui-text-muted)">{o.order_count} Transactions</p>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold text-(--ui-text)">{fmt(o.revenue)}</div>
                <div className="text-[10px] font-bold text-(--ui-success-fg) uppercase tracking-widest">
                  Revenue
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-(--ui-border)">
              <div className="p-3 bg-(--ui-muted-surface) rounded-xl">
                <p className="text-[10px] font-bold text-(--ui-text-muted) uppercase mb-1">
                  Avg Ticket
                </p>
                <p className="font-bold text-(--ui-text)">{fmt(o.avg_basket || 0)}</p>
              </div>
              <div className="p-3 bg-(--ui-muted-surface) rounded-xl">
                <p className="text-[10px] font-bold text-(--ui-text-muted) uppercase mb-1">
                  Unique Customers
                </p>
                <p className="font-bold text-(--ui-text)">{o.unique_customers}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
