import React, { useState, useEffect, useCallback } from "react";
import { Truck, ShoppingCart, Archive, Boxes, ClipboardList } from "lucide-react";
import { api } from "../../api";
import {
  fmtDate,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
  MetricCard,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

// --- Tab: Supplier Wise -------------------------------------------------------
export function SupplierWiseTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/supplier-wise?${p}`);
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds]);

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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalSuppliers}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Purchase Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalPurchaseOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Total Spend
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalSpend)}</p>
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
            <tr key={`${r.supplier_name}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-bold text-(--ui-text)">{r.supplier_name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-sm text-(--ui-text-muted)">{r.contact_person || "General"}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{r.phone || "-"}</div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {r.total_pos}
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.total_items}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-link)">
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
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/purchase-orders?${p}`);
      setRows(d.purchaseOrders || d.purchase_orders || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.outletIds, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const statusColor = (s) =>
    s === "Received"
      ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
      : s === "Ordered"
        ? "bg-(--ui-muted-surface) text-(--ui-link)"
        : "bg-(--ui-muted-surface) text-(--ui-text)";

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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Purchase Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Total Cost
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalCost)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Received
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{receivedOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Draft
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{draftOrders}</p>
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
            <tr key={`${r.id}-${i}`} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3 text-(--ui-text-muted)">{fmtDate(r.created_at)}</td>
              <td className="px-4 py-3">
                <div className="font-mono font-bold text-(--ui-text)">
                  PO-{String(r.id).padStart(4, "0")}
                </div>
              </td>
              <td className="px-4 py-3 font-medium text-(--ui-text-muted)">
                {r.supplier_name}
              </td>
              <td className="px-4 py-3">
                <div
                  className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${statusColor(r.status)}`}
                >
                  {r.status}
                </div>
              </td>
              <td className="px-4 py-3 font-bold text-(--ui-text)">
                {fmt(r.total_cost)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function TotalPurchasesTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMode, setStatusMode] = useState("all");
  const [taxMode, setTaxMode] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        supplier_id: filters.supplierId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        search: filters.search,
        status_mode: statusMode,
        tax_mode: taxMode,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/total-purchases?${p}`);
      setRows(d.items || []);
      setSummary(d.summary || null);
    } catch {
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.outletIds,
    filters.supplierId,
    filters.categoryId,
    filters.brandId,
    filters.search,
    statusMode,
    taxMode,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex rounded-xl bg-(--ui-muted-surface) p-1">
          {[
            ["all", "All"],
            ["received", "Received"],
            ["pending", "Pending"],
            ["not_received", "Not Received"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusMode(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${statusMode === value ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl bg-(--ui-muted-surface) p-1">
          {[
            ["all", "All Tax"],
            ["gst", "GST"],
            ["no_gst", "No GST"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTaxMode(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${taxMode === value ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">POs</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{summary?.order_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Received</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{summary?.received_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Not Received</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{summary?.not_received_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Ordered Cost</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary?.ordered_cost || 0)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Received Cost</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary?.received_cost || 0)}</p>
        </div>
      </div>

      <CardShell
        title="Total Purchases"
        subtitle="Purchase-order level procurement view with received, pending, and tax-aware totals"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "total_purchases.csv",
                [
                  { header: "Date", key: "created_at" },
                  { header: "PO ID", key: "id" },
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Status", key: "status" },
                  { header: "Qty Ordered", key: "qty_ordered" },
                  { header: "Qty Received", key: "qty_received" },
                  { header: "Ordered Cost", key: "ordered_cost" },
                  { header: "Received Cost", key: "received_cost" },
                  { header: "Ordered Tax", key: "ordered_tax" },
                  { header: "Received Tax", key: "received_tax" },
                  { header: "Invoice Status", key: "invoice_status" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Date", "Reference", "Supplier / Outlet", "Status", "Qty", "Cost / Tax"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={Boxes}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3 text-(--ui-text-muted)">{fmtDate(row.created_at)}</td>
              <td className="px-4 py-3">
                <div className="font-mono font-bold text-(--ui-text)">PO-{String(row.id).padStart(4, "0")}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.line_count} lines</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-(--ui-text)">{row.supplier_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.outlet_name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="inline-block rounded bg-(--ui-muted-surface) px-2 py-0.5 text-[10px] font-bold uppercase text-(--ui-text)">
                  {row.status}
                </div>
                <div className="mt-1 text-[11px] text-(--ui-text-muted)">Invoice: {row.invoice_status}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">{row.qty_ordered} ordered</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.qty_received} received</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-bold text-(--ui-text)">{fmt(row.received_cost || row.ordered_cost)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  Tax {fmt(row.received_tax || row.ordered_tax)} | Pending {fmt(row.pending_cost)}
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ItemwisePurchasesTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusMode, setStatusMode] = useState("all");
  const [taxMode, setTaxMode] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        supplier_id: filters.supplierId,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
        search: filters.search,
        status_mode: statusMode,
        tax_mode: taxMode,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/itemwise-purchases?${p}`);
      setRows(d.items || []);
      setSummary(d.summary || null);
    } catch {
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.outletIds,
    filters.supplierId,
    filters.categoryId,
    filters.brandId,
    filters.search,
    statusMode,
    taxMode,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-3">
        <div className="flex rounded-xl bg-(--ui-muted-surface) p-1">
          {[
            ["all", "All"],
            ["received", "Received"],
            ["pending", "Pending"],
            ["not_received", "Not Received"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusMode(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${statusMode === value ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-xl bg-(--ui-muted-surface) p-1">
          {[
            ["all", "All Tax"],
            ["gst", "GST"],
            ["no_gst", "No GST"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTaxMode(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${taxMode === value ? "bg-(--ui-surface) text-(--ui-text)" : "text-(--ui-text-muted)"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Items</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{summary?.item_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Qty Ordered</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{summary?.qty_ordered || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Qty Received</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{summary?.qty_received || 0}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Received Cost</p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(summary?.received_cost || 0)}</p>
        </div>
      </div>

      <CardShell
        title="Itemwise Purchases"
        subtitle="Product-level procurement view across supplier, received quantity, and GST/no-GST cost"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "itemwise_purchases.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Category", key: "category" },
                  { header: "Brand", key: "brand" },
                  { header: "Supplier", key: "supplier_name" },
                  { header: "PO Count", key: "po_count" },
                  { header: "Qty Ordered", key: "qty_ordered" },
                  { header: "Qty Received", key: "qty_received" },
                  { header: "Average Cost", key: "avg_cost_price" },
                  { header: "Ordered Cost", key: "ordered_cost" },
                  { header: "Received Cost", key: "received_cost" },
                  { header: "Tax Name", key: "tax_name" },
                  { header: "Tax Rate", key: "tax_rate" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Tags", "POs", "Qty", "Cost", "Tax"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={ClipboardList}
        >
          {rows.map((row) => (
            <tr key={`${row.product_id}-${row.supplier_name}`} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">{row.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="text-(--ui-text)">{row.category}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.brand}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.supplier_name}</div>
              </td>
              <td className="px-4 py-3 font-semibold text-(--ui-text)">{row.po_count}</td>
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">{row.qty_ordered} ordered</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.qty_received} received</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-bold text-(--ui-text)">{fmt(row.received_cost || row.ordered_cost)}</div>
                <div className="text-[11px] text-(--ui-text-muted)">Avg {fmt(row.avg_cost_price)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">{row.tax_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.tax_rate}%</div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function POWorkflowTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        supplier_id: filters.supplierId,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/po-workflow?${p}`);
      setRows(d.items || []);
      setSummary(d.summary || null);
    } catch {
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.supplierId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <MetricCard title="POs" value={summary?.po_count || 0} compPct={0} compLabel="workflow" />
        <MetricCard title="Draft" value={summary?.draft_count || 0} compPct={0} compLabel="stage" />
        <MetricCard title="Pending Approval" value={summary?.pending_approval_count || 0} compPct={0} compLabel="stage" />
        <MetricCard title="Awaiting Receipt" value={summary?.approved_waiting_receipt_count || 0} compPct={0} compLabel="stage" />
        <MetricCard title="Missing GRN" value={summary?.received_without_grn_count || 0} compPct={0} compLabel="gap" />
        <MetricCard title="Unpaid Invoices" value={summary?.unpaid_invoice_count || 0} compPct={0} compLabel="invoices" />
        <MetricCard title="Invoice Due" value={fmt(summary?.invoice_due || 0)} compPct={0} compLabel="open" />
      </div>

      <CardShell
        title="PO Workflow"
        subtitle="Approval, receipt, GRN, and invoice/payment state in one procurement workflow view"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "po_workflow.csv",
                [
                  { header: "PO ID", key: "id" },
                  { header: "Created At", key: "created_at" },
                  { header: "Supplier", key: "supplier_name" },
                  { header: "PO Status", key: "po_status" },
                  { header: "Approval Status", key: "approval_status" },
                  { header: "GRN Number", key: "grn_number" },
                  { header: "Received At", key: "received_at" },
                  { header: "Invoice Status", key: "invoice_status" },
                  { header: "Invoice Amount", key: "invoice_amount" },
                  { header: "Amount Paid", key: "amount_paid" },
                  { header: "Amount Due", key: "amount_due" },
                  { header: "Workflow Stage", key: "workflow_stage" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Reference", "Supplier", "Approval / Receipt", "Invoice", "Workflow Stage"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={ClipboardList}
        >
          {rows.map((row) => (
            <tr key={row.id} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3">
                <div className="font-mono font-bold text-(--ui-text)">PO-{String(row.id).padStart(4, "0")}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{fmtDate(row.created_at)}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-(--ui-text)">{row.supplier_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.outlet_name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">Approval: {row.approval_status}</div>
                <div className="text-[11px] text-(--ui-text-muted)">PO: {row.po_status}</div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  {row.grn_number ? `${row.grn_number} | ${fmtDateTime(row.received_at)}` : "No GRN"}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">{row.invoice_status}</div>
                <div className="text-[11px] text-(--ui-text-muted)">
                  {fmt(row.amount_paid)} paid / {fmt(row.invoice_amount)} invoiced
                </div>
                <div className="text-[11px] text-(--ui-text-muted)">Due {fmt(row.amount_due)}</div>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-(--ui-muted-surface) px-2 py-1 text-[10px] font-bold uppercase text-(--ui-text)">
                  {row.workflow_stage}
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ProcurementParityTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/procurement-parity?${p}`);
      setRows(d.items || []);
      setSummary(d.summary || null);
    } catch {
      setRows([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricCard title="Receipts" value={summary?.receipt_count || 0} compPct={0} compLabel="events" />
        <MetricCard title="Transfers" value={summary?.transfer_count || 0} compPct={0} compLabel="events" />
        <MetricCard title="Adjustments" value={summary?.adjustment_count || 0} compPct={0} compLabel="events" />
        <MetricCard title="Estimated Cost" value={fmt(summary?.total_estimated_cost || 0)} compPct={0} compLabel="value" />
      </div>

      <CardShell
        title="Procurement Parity"
        subtitle="Receipts, transfers, and stock adjustments in one movement ledger for procurement follow-through"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "procurement_parity.csv",
                [
                  { header: "Event Type", key: "event_type" },
                  { header: "Event At", key: "event_at" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Supplier", key: "supplier_name" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Cost Price", key: "cost_price" },
                  { header: "Estimated Cost", key: "estimated_cost" },
                  { header: "Reference", key: "reference" },
                  { header: "Counterparty", key: "counterparty" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Type", "Date", "Product", "Outlet / Counterparty", "Qty", "Estimated Cost"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={Archive}
        >
          {rows.map((row, index) => (
            <tr key={`${row.event_type}-${row.reference}-${index}`} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3">
                <span className="rounded-full bg-(--ui-muted-surface) px-2 py-1 text-[10px] font-bold uppercase text-(--ui-text)">
                  {row.event_type}
                </span>
              </td>
              <td className="px-4 py-3 text-(--ui-text-muted)">{fmtDateTime(row.event_at)}</td>
              <td className="px-4 py-3">
                <div className="font-semibold text-(--ui-text)">{row.product_name}</div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">{row.barcode}</div>
              </td>
              <td className="px-4 py-3">
                <div className="font-medium text-(--ui-text)">{row.outlet_name}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.counterparty || row.supplier_name || "-"}</div>
                <div className="text-[11px] text-(--ui-text-muted)">{row.reference}</div>
              </td>
              <td className="px-4 py-3 font-semibold text-(--ui-text)">{row.quantity}</td>
              <td className="px-4 py-3 font-bold text-(--ui-text)">{fmt(row.estimated_cost)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- GRN Report Tab -----------------------------------------------------------
export function GRNReportTab({ filters }) {
  const { fmt } = useCurrency();
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
      const d = await api.get(`/api/reports/grn-report?${p}`);
      setRows(d.items || d.rows || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

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
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            GRN Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Qty Received
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalReceivedQty}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Received Cost
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {fmt(totalReceivedCost)}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Suppliers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{suppliersTouched}</p>
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
            <tr key={`${r.date}-${r.product_name}-${i}`} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="px-4 py-3 text-(--ui-text-muted)">{fmtDate(r.date)}</td>
              <td className="px-4 py-3 font-bold text-(--ui-text)">{r.product_name}</td>
              <td className="px-4 py-3 font-medium text-(--ui-text-muted)">
                {r.supplier_name}
              </td>
              <td className="px-4 py-3 font-bold text-(--ui-link)">+{r.quantity}</td>
              <td className="px-4 py-3 font-semibold text-(--ui-text)">
                {fmt(Number(r.quantity || 0) * Number(r.cost_price || 0))}
                <div className="text-[10px] text-(--ui-text-muted)">
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
