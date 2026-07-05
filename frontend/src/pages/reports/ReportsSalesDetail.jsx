import React, { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import {
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

// --- Tab: Sales Detail --------------------------------------------------------
export function SalesDetailTab({ filters }) {
  const { fmt } = useCurrency();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
        employee_id: filters.employeeId,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/sales-detail?${p}`);
      setRows(d.sales || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletIds, filters.employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.line_total || 0),
    0,
  );
  const uniqueSales = new Set(rows.map((row) => row.sale_id)).size;
  const uniqueProducts = new Set(rows.map((row) => row.product_name)).size;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Sales in View
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{uniqueSales}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Line Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {fmt(totalRevenue)}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Products Touched
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{uniqueProducts}</p>
        </div>
      </div>

      <CardShell
        title="Transaction Journal"
        subtitle="Line-level sales ledger for audit, lookup, and exception tracing"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "sales_detail.csv",
                [
                  { header: "Sale ID", key: "sale_id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Quantity", key: "quantity" },
                  { header: "Price", key: "price_at_sale" },
                  { header: "Line Total", key: "line_total" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Sale", "Customer", "Product", "Qty", "Price", "Line Total"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.sale_id}-${r.barcode}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                <div className="font-medium text-(--ui-text)">
                  {fmtDateTime(r.timestamp)}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="font-mono text-xs font-bold text-(--ui-text)">
                  #{r.sale_id}
                </div>
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                {r.customer_name}
              </td>
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">
                  {r.product_name}
                </div>
                <div className="font-mono text-[11px] text-(--ui-text-muted)">
                  {r.barcode}
                </div>
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {r.quantity}
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                {fmt(r.price_at_sale)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                {fmt(r.line_total)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Order Wise ----------------------------------------------------------
export function OrderWiseTab({ filters }) {
  const { fmt } = useCurrency();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/order-wise?${p}`);
      setRows(d.orders || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.timeFrom, filters.timeTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalOrders = rows.length;
  const grossSales = rows.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0,
  );
  const discountedOrders = rows.filter(
    (row) => Number(row.discount_amount || 0) > 0,
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Orders in View
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalOrders}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(grossSales)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Discounted Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{discountedOrders}</p>
        </div>
      </div>

      <CardShell
        title="Order Fulfillment"
        subtitle="Operational register of completed orders and payment mix"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "orders.csv",
                [
                  { header: "Order ID", key: "id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Payment", key: "payment_method" },
                  { header: "Discount", key: "discount_amount" },
                  { header: "Total", key: "total_amount" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Order", "Customer", "Outlet", "Payment", "Total"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-(--ui-muted-surface) transition-colors">
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="px-4 py-3">
                <div className="font-mono text-xs font-bold text-(--ui-text)">
                  #{r.id}
                </div>
                {Number(r.discount_amount || 0) > 0 ? (
                  <div className="mt-1 inline-flex rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-[10px] font-bold uppercase text-(--ui-warning-fg)">
                    Discounted
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.customer_name}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="px-4 py-3 text-sm font-medium text-(--ui-text-muted)">
                {r.payment_method || "N/A"}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                {fmt(r.total_amount)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Item Wise -----------------------------------------------------------
export function ItemWiseTab({ filters }) {
  const { fmt } = useCurrency();

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
        category_id: filters.categoryId,
        brand_id: filters.brandId,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/item-wise?${p}`);
      setRows(d.items || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletIds,
    filters.categoryId,
    filters.brandId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const totalUnits = rows.reduce(
    (sum, row) => sum + Number(row.units_sold || 0),
    0,
  );
  const totalRevenue = rows.reduce(
    (sum, row) => sum + Number(row.revenue || 0),
    0,
  );
  const totalGrossProfit = rows.reduce(
    (sum, row) => sum + Number(row.gross_profit || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Units Sold
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalUnits}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Profit
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {fmt(totalGrossProfit)}
          </p>
        </div>
      </div>

      <CardShell
        title="Merchandise Velocity"
        subtitle="SKU-level sales volume, revenue, and gross profit performance"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "items.csv",
                [
                  { header: "Product", key: "product_name" },
                  { header: "Barcode", key: "barcode" },
                  { header: "Units Sold", key: "units_sold" },
                  { header: "Revenue", key: "revenue" },
                  { header: "Total Cost", key: "total_cost" },
                  { header: "Gross Profit", key: "gross_profit" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Product", "Barcode", "Units Sold", "Revenue", "Gross Profit"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={`${r.id}-${i}`} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {r.product_name}
              </td>
              <td className="px-4 py-3 font-mono text-[11px] text-(--ui-text-muted)">
                {r.barcode}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                {r.units_sold}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                {fmt(r.revenue)}
              </td>
              <td className="px-4 py-3 text-sm font-semibold text-(--ui-success-fg)">
                {fmt(r.gross_profit)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
