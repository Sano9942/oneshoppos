import React, { useState, useEffect, useCallback } from "react";
import { Truck, ShoppingCart, Archive } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

// --- Tab: Supplier Wise -------------------------------------------------------
export function SupplierWiseTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/supplier-wise?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
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
      title="Supplier Performance"
      subtitle="Spending and volume aggregation per vendor"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "supplier_wise.csv",
              ["Supplier", "POs", "Total Cost"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Supplier", "Orders", "Spend"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50">
            <td className="p-4">
              <div className="font-bold text-slate-800 text-sm">
                {r.supplier_name}
              </div>
              <div className="text-[10px] text-slate-400 font-medium italic">
                {r.contact_person || "Gen. Supplier"}
              </div>
            </td>
            <td className="p-4">
              <div className="text-sm font-bold text-slate-700">
                {r.total_pos} POs
              </div>
              <div className="text-[10px] text-slate-400 font-medium">
                {r.total_items} items
              </div>
            </td>
            <td className="p-4">
              <div className="text-sm font-bold text-indigo-700">
                {fmt(r.total_cost)}
              </div>
              <div className="text-[10px] text-emerald-600 font-bold tracking-tighter uppercase">
                Net Spent
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Purchase Orders Report ----------------------------------------------
export function PurchaseOrdersReportTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        outlet_id: filters.outletId,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      const res = await fetch(`${API}/api/purchase-orders?${p}`);
      const d = await res.json();
      setRows(d.purchase_orders || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletId, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const statusColor = (s) =>
    s === "Received"
      ? "bg-emerald-100 text-emerald-700"
      : s === "Ordered"
        ? "bg-blue-100 text-blue-700"
        : "bg-slate-100 text-slate-700";

  return (
    <CardShell
      title="Purchase Order Registry"
      subtitle="Complete log of inventory procurement orders"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "purchase_orders.csv",
              ["Date", "PO #", "Supplier", "Total"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Date", "Reference", "Supplier", "Total"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 text-slate-500">{fmtDate(r.created_at)}</td>
            <td className="p-4">
              <div className="font-mono font-bold text-slate-800">
                PO-{String(r.id).padStart(4, "0")}
              </div>
              <div
                className={`mt-0.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${statusColor(r.status)}`}
              >
                {r.status}
              </div>
            </td>
            <td className="p-4 font-medium text-slate-600">
              {r.supplier_name}
            </td>
            <td className="p-4 font-bold text-slate-900">
              {fmt(r.total_cost)}
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- GRN Report Tab -----------------------------------------------------------
export function GRNReportTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/grn-report?${p}`);
      const d = await res.json();
      setRows(d.items || d.rows || []);
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
      title="Goods Received Note (GRN)"
      subtitle="Historical log of stock receipts from suppliers"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "grn_report.csv",
              ["Date", "Product", "Supplier", "Qty", "Cost"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Date", "Product", "Supplier", "Qty Receive"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 text-slate-500">{fmtDate(r.date)}</td>
            <td className="p-4 font-bold text-slate-800">{r.product_name}</td>
            <td className="p-4 font-medium text-slate-600">
              {r.supplier_name}
            </td>
            <td className="p-4 font-bold text-blue-700">+{r.quantity}</td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}
