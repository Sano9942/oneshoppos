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

  const totalSuppliers = rows.length;
  const totalSpend = rows.reduce(
    (sum, row) => sum + Number(row.total_cost || 0),
    0,
  );
  const totalPurchaseOrders = rows.reduce(
    (sum, row) => sum + Number(row.total_pos || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalSuppliers}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Purchase Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalPurchaseOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Spend
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalSpend)}</p>
        </div>
      </div>

      <CardShell
        title="Supplier Performance"
        subtitle="Vendor-level purchasing activity, item volume, and spend concentration"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "supplier_wise.csv",
                [
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Contact Person", key: "contact_person" },
                  { header: "Phone", key: "phone" },
                  { header: "POs", key: "total_pos" },
                  { header: "Items", key: "total_items" },
                  { header: "Total Cost", key: "total_cost" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Supplier", "Contact", "POs", "Items", "Spend"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.supplier_name}-${i}`} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-slate-800">{r.supplier_name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-slate-600">{r.contact_person || "General"}</div>
                <div className="text-[11px] text-slate-400">{r.phone || "-"}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-700">
                {r.total_pos}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.total_items}</td>
              <td className="px-4 py-3 text-sm font-bold text-indigo-700">
                {fmt(r.total_cost)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
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

  const totalOrders = rows.length;
  const totalCost = rows.reduce(
    (sum, row) => sum + Number(row.total_cost || 0),
    0,
  );
  const receivedOrders = rows.filter((row) => row.status === "Received").length;
  const draftOrders = rows.filter((row) => row.status === "Draft").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Purchase Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Cost
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalCost)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Received
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{receivedOrders}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Draft
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{draftOrders}</p>
        </div>
      </div>

      <CardShell
        title="Purchase Order Registry"
        subtitle="Complete procurement register with supplier, status, and spend visibility"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "purchase_orders.csv",
                [
                  { header: "Date", key: "created_at" },
                  { header: "PO ID", key: "id" },
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Status", key: "status" },
                  { header: "Total Cost", key: "total_cost" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Date", "Reference", "Supplier", "Status", "Total"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-slate-50 text-sm">
              <td className="px-4 py-3 text-slate-500">{fmtDate(r.created_at)}</td>
              <td className="px-4 py-3">
                <div className="font-mono font-bold text-slate-800">
                  PO-{String(r.id).padStart(4, "0")}
                </div>
              </td>
              <td className="px-4 py-3 font-medium text-slate-600">
                {r.supplier_name}
              </td>
              <td className="px-4 py-3">
                <div
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(r.status)}`}
                >
                  {r.status}
                </div>
              </td>
              <td className="px-4 py-3 font-bold text-slate-900">
                {fmt(r.total_cost)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
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

  const totalReceivedQty = rows.reduce(
    (sum, row) => sum + Number(row.quantity || 0),
    0,
  );
  const totalReceivedCost = rows.reduce(
    (sum, row) => sum + Number(row.quantity || 0) * Number(row.cost_price || 0),
    0,
  );
  const suppliersTouched = new Set(rows.map((row) => row.supplier_name).filter(Boolean))
    .size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            GRN Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Qty Received
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{totalReceivedQty}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Received Cost
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(totalReceivedCost)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{suppliersTouched}</p>
        </div>
      </div>

      <CardShell
        title="Goods Received Note (GRN)"
        subtitle="Historical register of received stock lines, suppliers, and landed cost"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "grn_report.csv",
                [
                  { header: "Date", key: "date" },
                  { header: "Product", key: "product_name" },
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Qty", key: "quantity" },
                  { header: "Cost", key: "cost_price" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Date", "Product", "Supplier", "Qty Received", "Line Cost"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.date}-${r.product_name}-${i}`} className="hover:bg-slate-50 text-sm">
              <td className="px-4 py-3 text-slate-500">{fmtDate(r.date)}</td>
              <td className="px-4 py-3 font-bold text-slate-800">{r.product_name}</td>
              <td className="px-4 py-3 font-medium text-slate-600">
                {r.supplier_name}
              </td>
              <td className="px-4 py-3 font-bold text-blue-700">+{r.quantity}</td>
              <td className="px-4 py-3 font-semibold text-slate-700">
                {fmt(Number(r.quantity || 0) * Number(r.cost_price || 0))}
                <div className="text-[10px] text-slate-400">
                  Unit {fmt(r.cost_price)}
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
