import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

function FeatureState({ title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}

function buildParams(filters) {
  const p = new URLSearchParams({
    date_from: filters.dateFrom || "",
    date_to: filters.dateTo || "",
    time_from: filters.timeFrom || "",
    time_to: filters.timeTo || "",
    employee_id: filters.employeeId || "",
    category_id: filters.categoryId || "",
    brand_id: filters.brandId || "",
    supplier_id: filters.supplierId || "",
    search: filters.search || "",
  });
  if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
  return p;
}

export function DiscountLeakageTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setUnavailable("");
    try {
      const res = await fetch(`${API}/api/reports/discount-leakage?${buildParams(filters)}`);
      const data = await res.json();
      if (res.status === 503) {
        setUnavailable(data?.error || "Feature unavailable");
        setRows([]);
        setTotals(null);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to load discount leakage");
      setRows(data.rows || []);
      setTotals(data.totals || null);
    } catch (e) {
      setRows([]);
      setTotals(null);
      setError(e.message || "Failed to load discount leakage");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  if (unavailable) {
    return (
      <FeatureState
        title="Discount leakage is feature-gated"
        body={`${unavailable}. Enable the profitability layer to surface this audit report in production.`}
      />
    );
  }

  if (error && !loading) {
    return (
      <FeatureState
        title="Discount leakage unavailable"
        body={error}
      />
    );
  }

  const summary = totals || { total_discount: 0, total_sales: 0 };
  const leakagePct =
    Number(summary.total_sales || 0) > 0
      ? ((Number(summary.total_discount || 0) / Number(summary.total_sales || 0)) * 100).toFixed(2)
      : "0.00";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Discount Leakage</p>
          <p className="mt-2 text-2xl font-bold text-amber-600">{fmt(summary.total_discount)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sales In Scope</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(summary.total_sales)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leakage Rate</p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{leakagePct}%</p>
        </div>
      </div>

      <CardShell
        title="Discount Leakage Register"
        subtitle="Order-level discount exposure with outlet and employee context"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "discount_leakage.csv",
                [
                  { header: "Sale ID", key: "sale_id" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Total Amount", key: "total_amount" },
                  { header: "Discount Amount", key: "discount_amount" },
                  { header: "Total Discount", key: "total_discount" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Sale", "Outlet", "Employee", "Amount", "Discount"]}
          loading={loading}
          empty={!rows.length}
          emptyIcon={AlertTriangle}
        >
          {rows.map((row) => (
            <tr key={row.sale_id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-500">{fmtDateTime(row.timestamp)}</td>
              <td className="px-4 py-3 text-sm font-mono text-slate-800">#{row.sale_id}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{row.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{row.employee_name}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{fmt(row.total_amount)}</td>
              <td className="px-4 py-3 text-sm font-bold text-amber-700">{fmt(row.total_discount)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ExceptionsTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("negative_margin_sales");
  const [unavailable, setUnavailable] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setUnavailable("");
    try {
      const params = buildParams(filters);
      params.set("type", type);
      const res = await fetch(`${API}/api/reports/exceptions?${params}`);
      const data = await res.json();
      if (res.status === 503) {
        setUnavailable(data?.error || "Feature unavailable");
        setRows([]);
        return;
      }
      if (!res.ok) throw new Error(data?.error || "Failed to load exceptions");
      setRows(data.rows || []);
    } catch (e) {
      setRows([]);
      setError(e.message || "Failed to load exceptions");
    } finally {
      setLoading(false);
    }
  }, [filters, type]);

  useEffect(() => {
    load();
  }, [load]);

  if (unavailable) {
    return (
      <FeatureState
        title="Exceptions are feature-gated"
        body={`${unavailable}. Enable exception reporting to surface specialist audit rows in production.`}
      />
    );
  }

  if (error && !loading) {
    return (
      <FeatureState
        title="Exceptions unavailable"
        body={error}
      />
    );
  }

  const titleMap = {
    negative_margin_sales: "Negative Margin Sales",
    high_discount_orders: "High Discount Orders",
    frequent_voids_by_employee: "Frequent Voids By Employee",
    frequent_returns_by_product: "Frequent Returns By Product",
  };

  const exportColumnsByType = {
    negative_margin_sales: [
      { header: "Sale ID", key: "sale_id" },
      { header: "Timestamp", key: "timestamp" },
      { header: "Product", key: "product_name" },
      { header: "Barcode", key: "barcode" },
      { header: "Outlet", key: "outlet_name" },
      { header: "Employee", key: "employee_name" },
      { header: "Quantity", key: "quantity" },
      { header: "Price", key: "price_at_sale" },
      { header: "Cost", key: "cost_price_at_sale" },
      { header: "Unit Margin", key: "unit_margin" },
    ],
    high_discount_orders: [
      { header: "Sale ID", key: "sale_id" },
      { header: "Timestamp", key: "timestamp" },
      { header: "Outlet", key: "outlet_name" },
      { header: "Employee", key: "employee_name" },
      { header: "Total Amount", key: "total_amount" },
      { header: "Discount", key: "total_discount" },
      { header: "Discount %", key: "discount_pct" },
    ],
    frequent_voids_by_employee: [
      { header: "Employee", key: "employee_name" },
      { header: "Void Count", key: "void_count" },
      { header: "Void Value", key: "void_value" },
    ],
    frequent_returns_by_product: [
      { header: "Product", key: "product_name" },
      { header: "Barcode", key: "barcode" },
      { header: "Return Lines", key: "return_lines" },
      { header: "Returned Qty", key: "returned_qty" },
      { header: "Returned Value", key: "returned_value" },
    ],
  };

  const metricLabel =
    type === "negative_margin_sales"
      ? "Rows"
      : type === "high_discount_orders"
        ? "Orders"
        : type === "frequent_voids_by_employee"
          ? "Employees"
          : "Products";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Exception Type</p>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mt-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800"
          >
            <option value="negative_margin_sales">Negative Margin Sales</option>
            <option value="high_discount_orders">High Discount Orders</option>
            <option value="frequent_voids_by_employee">Frequent Voids By Employee</option>
            <option value="frequent_returns_by_product">Frequent Returns By Product</option>
          </select>
        </div>
        <div className="ml-auto rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{metricLabel}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
      </div>

      <CardShell
        title={titleMap[type]}
        subtitle="Specialist exception output exposed directly in the main reports workspace"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                `exceptions_${type}.csv`,
                exportColumnsByType[type],
                rows,
              )
            }
          />
        }
      >
        {type === "negative_margin_sales" && (
          <TableShell
            cols={["Timestamp", "Sale", "Product", "Outlet", "Employee", "Unit Margin"]}
            loading={loading}
            empty={!rows.length}
            emptyIcon={ShieldAlert}
          >
            {rows.map((row, index) => (
              <tr key={`${row.sale_id}-${row.product_id}-${index}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-500">{fmtDateTime(row.timestamp)}</td>
                <td className="px-4 py-3 text-sm font-mono text-slate-800">#{row.sale_id}</td>
                <td className="px-4 py-3">
                  <div className="text-sm font-semibold text-slate-800">{row.product_name}</div>
                  <div className="text-[11px] text-slate-400">{row.barcode || "-"}</div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.outlet_name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">{fmt(row.unit_margin)}</td>
              </tr>
            ))}
          </TableShell>
        )}

        {type === "high_discount_orders" && (
          <TableShell
            cols={["Timestamp", "Sale", "Outlet", "Employee", "Discount", "Discount %"]}
            loading={loading}
            empty={!rows.length}
            emptyIcon={ShieldAlert}
          >
            {rows.map((row) => (
              <tr key={row.sale_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm text-slate-500">{fmtDateTime(row.timestamp)}</td>
                <td className="px-4 py-3 text-sm font-mono text-slate-800">#{row.sale_id}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.outlet_name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm font-bold text-amber-700">{fmt(row.total_discount)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.discount_pct || 0).toFixed(2)}%</td>
              </tr>
            ))}
          </TableShell>
        )}

        {type === "frequent_voids_by_employee" && (
          <TableShell
            cols={["Employee", "Void Count", "Void Value"]}
            loading={loading}
            empty={!rows.length}
            emptyIcon={ShieldAlert}
          >
            {rows.map((row, index) => (
              <tr key={`${row.employee_id}-${index}`} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.void_count || 0)}</td>
                <td className="px-4 py-3 text-sm font-bold text-rose-700">{fmt(row.void_value)}</td>
              </tr>
            ))}
          </TableShell>
        )}

        {type === "frequent_returns_by_product" && (
          <TableShell
            cols={["Product", "Barcode", "Return Lines", "Returned Qty", "Returned Value"]}
            loading={loading}
            empty={!rows.length}
            emptyIcon={ShieldAlert}
          >
            {rows.map((row) => (
              <tr key={row.product_id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">{row.product_name}</td>
                <td className="px-4 py-3 text-sm text-slate-500">{row.barcode || "-"}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.return_lines || 0)}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{Number(row.returned_qty || 0).toFixed(2)}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(row.returned_value)}</td>
              </tr>
            ))}
          </TableShell>
        )}
      </CardShell>
    </div>
  );
}
