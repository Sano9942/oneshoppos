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

// --- Tab: Refunds & Voids ----------------------------------------------------
export function RefundsVoidsTab({ filters }) {
  const { fmt } = useCurrency();

  const [data, setData] = useState(null);
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
      const d = await api.get(`/api/reports/refunds-voids?${p}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletIds,
    filters.employeeId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = data?.summary || {};
  const voids = data?.voids || [];
  const refunds = data?.refunds || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Voids
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-danger-fg)">
            {Number(summary.void_count || 0)}
          </p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{fmt(summary.void_value)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Refunds
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-warning-fg)">
            {Number(summary.refund_count || 0)}
          </p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">{fmt(summary.refund_value)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Combined Leakage
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">
            {fmt(summary.leakage_total)}
          </p>
        </div>
      </div>

      <CardShell
        title="Voided Transactions"
        subtitle="Sales that were voided in the selected reporting window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "voided_sales.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Sale ID", key: "sale_id" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Total", key: "total_amount" },
                ],
        voids,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Sale", "Outlet", "Employee", "Customer", "Total"]}
          loading={loading}
          empty={!voids.length}
        >
          {voids.map((r) => (
            <tr key={r.sale_id} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmtDateTime(r.timestamp)}</td>
              <td className="px-4 py-3 font-mono text-xs font-bold text-(--ui-text)">#{r.sale_id}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.employee_name}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.customer_name}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-danger-fg)">{fmt(r.total_amount)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>

      <CardShell
        title="Refund Journal"
        subtitle="Returns processed in the selected reporting window"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "refund_journal.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Return ID", key: "return_id" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Method", key: "refund_method" },
                  { header: "Total Refund", key: "total_refund" },
                ],
        refunds,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Return", "Outlet", "Employee", "Customer", "Method", "Total"]}
          loading={loading}
          empty={!refunds.length}
        >
          {refunds.map((r) => (
            <tr key={r.return_id} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmtDateTime(r.timestamp)}</td>
              <td className="px-4 py-3 font-mono text-xs font-bold text-(--ui-text)">#{r.return_id}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.employee_name}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.customer_name}</td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.refund_method}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-warning-fg)">{fmt(r.total_refund)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Cashier Wise -------------------------------------------------------
export function CashierWiseTab({ filters }) {
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
      const d = await api.get(`/api/reports/cashier-wise?${p}`);
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
    filters.employeeId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const grossSales = rows.reduce((sum, row) => sum + Number(row.sales_value || 0), 0);
  const totalRefunds = rows.reduce((sum, row) => sum + Number(row.refund_value || 0), 0);
  const totalVoids = rows.reduce((sum, row) => sum + Number(row.void_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Cashiers
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Gross Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(grossSales)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Refunds
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-warning-fg)">{fmt(totalRefunds)}</p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Voids
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-danger-fg)">{fmt(totalVoids)}</p>
        </div>
      </div>

      <CardShell
        title="Cashier Sales Performance"
        subtitle="Sales, discounts, refunds, and voids grouped by cashier"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "cashier_wise.csv",
                [
                  { header: "Cashier", key: "employee_name" },
                  { header: "Sales Count", key: "sale_count" },
                  { header: "Gross Sales", key: "sales_value" },
                  { header: "Discounts", key: "discount_value" },
                  { header: "Refund Count", key: "refund_count" },
                  { header: "Refund Value", key: "refund_value" },
                  { header: "Void Count", key: "void_count" },
                  { header: "Void Value", key: "void_value" },
                  { header: "Net Sales", key: "net_sales" },
                ],
        rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Cashier", "Sales", "Gross", "Discounts", "Refunds", "Voids", "Net"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => (
            <tr key={r.employee_id} className="hover:bg-(--ui-muted-surface)">
              <td className="px-4 py-3">
                <div className="text-sm font-semibold text-(--ui-text)">{r.employee_name}</div>
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{r.sale_count}</td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(r.sales_value)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-warning-fg)">{fmt(r.discount_value)}</td>
              <td className="px-4 py-3 text-sm text-(--ui-warning-fg)">
                {r.refund_count} / {fmt(r.refund_value)}
              </td>
              <td className="px-4 py-3 text-sm text-(--ui-danger-fg)">
                {r.void_count} / {fmt(r.void_value)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-(--ui-success-fg)">{fmt(r.net_sales)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

// --- Tab: Daily Operations ---------------------------------------------------
export function DailyOperationsTab({ filters }) {
  const { fmt } = useCurrency();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [refundsVoids, setRefundsVoids] = useState(null);
  const [cashiers, setCashiers] = useState([]);
  const [selectedShiftSummary, setSelectedShiftSummary] = useState(null);
  const [selectedShiftPayments, setSelectedShiftPayments] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const commonParams = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        time_from: filters.timeFrom,
        time_to: filters.timeTo,
        employee_id: filters.employeeId,
      });
      if (filters.outletIds && filters.outletIds.length) commonParams.set("outlet_id", filters.outletIds.join(","));
      const common = commonParams.toString();
      const [salesRes, refundRes, cashierRes] = await Promise.all([
        api.get(`/api/reports/sales-summary?${common}`),
        api.get(`/api/reports/refunds-voids?${common}`),
        api.get(`/api/reports/cashier-wise?${common}`),
      ]);

      setSummary(salesRes);
      setRefundsVoids(refundRes);
      setCashiers(cashierRes.items || []);

      if (filters.shiftId) {
        const [shiftSummaryRes, shiftPaymentRes] = await Promise.all([
          api.get(`/api/reports/shift-summary?session_id=${filters.shiftId}`),
          api.get(`/api/reports/payment-summary?session_id=${filters.shiftId}`),
        ]);
        setSelectedShiftSummary(shiftSummaryRes);
        setSelectedShiftPayments(shiftPaymentRes.payments || []);
      } else {
        setSelectedShiftSummary(null);
        setSelectedShiftPayments([]);
      }
    } catch {
      setSummary(null);
      setRefundsVoids(null);
      setCashiers([]);
      setSelectedShiftSummary(null);
      setSelectedShiftPayments([]);
    } finally {
      setLoading(false);
    }
  }, [
    filters.dateFrom,
    filters.dateTo,
    filters.timeFrom,
    filters.timeTo,
    filters.outletIds,
    filters.employeeId,
    filters.shiftId,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  const paymentMethods = summary?.payment_methods || [];
  const topCashiers = cashiers.slice(0, 5);
  const topVoids = (refundsVoids?.voids || []).slice(0, 5);
  const topRefunds = (refundsVoids?.refunds || []).slice(0, 5);
  const totalRevenue = Number(summary?.total_revenue || 0);
  const totalOrders = (summary?.daily_sales || []).reduce(
    (sum, row) => sum + Number(row.orders || 0),
    0,
  );
  const leakageTotal = Number(refundsVoids?.summary?.leakage_total || 0);
  const totalRefunds = Number(refundsVoids?.summary?.refund_value || 0);
  const totalVoids = Number(refundsVoids?.summary?.void_value || 0);
  const netSales = totalRevenue - leakageTotal;
  const averageOrderValue = totalOrders ? totalRevenue / totalOrders : 0;
  const leakageRate = totalRevenue ? (leakageTotal / totalRevenue) * 100 : 0;
  const primaryTender = paymentMethods[0];
  const shift = selectedShiftSummary?.shift || null;
  const shiftOperationalSummary = selectedShiftSummary?.summary || null;
  const shiftSales = Number(shiftOperationalSummary?.total_sales || 0);
  const shiftReturns = Number(shiftOperationalSummary?.total_returns || 0);
  const shiftOrders = Number(shiftOperationalSummary?.order_count || 0);
  const shiftDifference = totalRevenue - shiftSales;
  const shiftPaymentTotal = selectedShiftPayments.reduce(
    (sum, row) => sum + Number(row.total || 0),
    0,
  );
  const selectedWindow = [
    filters.dateFrom || "Start not set",
    filters.dateTo || "End not set",
  ].join(" to ");
  const selectedTime = filters.timeFrom || filters.timeTo
    ? `${filters.timeFrom || "00:00"} to ${filters.timeTo || "23:59"}`
    : "Full day";
  const scopeBadges = [
    `Window: ${selectedWindow}`,
    `Time: ${selectedTime}`,
    filters.outletIds && filters.outletIds.length ? `Outlet filtered` : "All outlets",
    filters.employeeId ? "Single cashier filter" : "All cashiers",
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-5">
          <div className="h-4 w-40 animate-pulse rounded bg-(--ui-muted-surface)" />
          <div className="mt-3 flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-7 w-32 animate-pulse rounded-full bg-(--ui-muted-surface)"
              />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4"
            >
              <div className="h-3 w-20 animate-pulse rounded bg-(--ui-muted-surface)" />
              <div className="mt-3 h-8 w-24 animate-pulse rounded bg-(--ui-muted-surface)" />
              <div className="mt-2 h-3 w-28 animate-pulse rounded bg-(--ui-muted-surface)" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-(--ui-text-muted)">
              Daily Operations Brief
            </p>
            <h2 className="mt-1 text-lg font-bold text-(--ui-text)">
              Manager view for sales, leakage, and tender mix
            </h2>
            <p className="mt-1 text-sm text-(--ui-text-muted)">
              This view consolidates sales, refunds, voids, and cashier activity for the selected reporting window.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {scopeBadges.map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-1 text-xs font-semibold text-(--ui-text-muted)"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Revenue
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">
            Avg order {fmt(averageOrderValue)}
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Net Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-success-fg)">{fmt(netSales)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">
            After refunds and voids
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Leakage
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-danger-fg)">{fmt(leakageTotal)}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">
            {leakageRate.toFixed(1)}% of gross revenue
          </p>
        </div>
        <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
            Orders
          </p>
          <p className="mt-2 text-2xl font-bold text-(--ui-text)">{totalOrders}</p>
          <p className="mt-1 text-xs text-(--ui-text-muted)">
            {cashiers.length} cashiers in view
          </p>
        </div>
      </div>

      {filters.shiftId ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
          <CardShell
            title="Shift Reconciliation"
            subtitle="Selected shift compared with the broader daily reporting window"
          >
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-4">
              <div className="rounded-xl border border-(--ui-border) bg-(--ui-muted-surface) p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">
                  Shift Sales
                </div>
                <div className="mt-2 text-2xl font-bold text-(--ui-text)">
                  {fmt(shiftSales)}
                </div>
                <div className="mt-1 text-xs text-(--ui-text-muted)">
                  {shiftOrders} orders in shift #{filters.shiftId}
                </div>
              </div>
              <div className="rounded-xl border border-(--ui-warning-bg) bg-(--ui-warning-bg) p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-warning-fg)">
                  Shift Returns
                </div>
                <div className="mt-2 text-2xl font-bold text-(--ui-warning-fg)">
                  {fmt(shiftReturns)}
                </div>
                <div className="mt-1 text-xs text-(--ui-warning-fg)">
                  Derived from returns in the shift window
                </div>
              </div>
              <div className="rounded-xl border border-(--ui-focus) bg-(--ui-muted-surface) p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-link)">
                  Opening to Closing Cash
                </div>
                <div className="mt-2 text-2xl font-bold text-(--ui-link)">
                  {fmt(shift?.opening_float || 0)} to {fmt(shift?.closing_cash || 0)}
                </div>
                <div className="mt-1 text-xs text-(--ui-link)">
                  Expected {fmt(shift?.expected_cash || 0)}
                </div>
              </div>
              <div className="rounded-xl border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-danger-fg)">
                  Daily vs Shift Delta
                </div>
                <div className="mt-2 text-2xl font-bold text-(--ui-danger-fg)">
                  {fmt(shiftDifference)}
                </div>
                <div className="mt-1 text-xs text-(--ui-danger-fg)">
                  Revenue outside the selected shift
                </div>
              </div>
            </div>
            <div className="border-t border-(--ui-border) px-4 py-3 text-sm text-(--ui-text-muted)">
              {shift ? (
                <>
                  Shift window {fmtDateTime(shift.opened_at)} to{" "}
                  {shift.closed_at ? fmtDateTime(shift.closed_at) : "Open shift"}.
                  {/* Bucket F: flag shifts force-closed by the background worker so
                      finance knows to reconcile manually (expected_cash is NULL). */}
                  {shift.closing_method === "auto" && (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-(--ui-warning-bg) px-2 py-0.5 text-xs font-semibold text-(--ui-warning-fg) ring-1 ring-(--ui-warning-fg)">
                      Auto-closed
                    </span>
                  )}
                  {" "}
                  Variance {fmt(shift.variance || 0)}
                  {shift.variance_reason ? ` (${shift.variance_reason})` : ""}.
                  {shift.closing_note ? ` ${shift.closing_note}.` : ""}
                </>
              ) : (
                "Shift data unavailable for the selected filter."
              )}
            </div>
          </CardShell>

          <CardShell
            title="Selected Shift Tender Mix"
            subtitle="Tender totals for the currently selected shift"
          >
            <TableShell
              cols={["Method", "Total", "Count"]}
              loading={loading}
              empty={!selectedShiftPayments.length}
            >
              {selectedShiftPayments.map((row) => (
                <tr key={row.payment_method} className="hover:bg-(--ui-muted-surface)">
                  <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                    {row.payment_method}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">
                    {fmt(row.total)}
                  </td>
                  <td className="px-4 py-3 text-sm text-(--ui-text-muted)">
                    {row.count}
                  </td>
                </tr>
              ))}
            </TableShell>
            {!!selectedShiftPayments.length && (
              <div className="border-t border-(--ui-border) px-4 py-3 text-sm text-(--ui-text-muted)">
                Shift tender total {fmt(shiftPaymentTotal)}.
              </div>
            )}
          </CardShell>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-(--ui-border-strong) bg-(--ui-muted-surface) px-5 py-4 text-sm text-(--ui-text-muted)">
          Select a shift in the global filters when you need end-of-day reconciliation against cash, payment mix, and variance.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <CardShell
          title="Payment Mix"
          subtitle="Tender mix for the selected reporting window"
        >
          <TableShell cols={["Method", "Total"]} loading={loading} empty={!paymentMethods.length}>
            {paymentMethods.map((row) => (
              <tr key={row.method} className="hover:bg-(--ui-muted-surface)">
                <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">
                  <div>{row.method}</div>
                  <div className="text-[11px] font-medium text-(--ui-text-muted)">
                    {totalRevenue ? `${((Number(row.total || 0) / totalRevenue) * 100).toFixed(1)}% of revenue` : "0.0% of revenue"}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm font-bold text-(--ui-text)">{fmt(row.total)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Top Cashiers"
          subtitle="Highest grossing cashiers in the current view"
        >
          <TableShell cols={["Cashier", "Gross", "Net"]} loading={loading} empty={!topCashiers.length}>
            {topCashiers.map((row) => (
              <tr key={row.employee_id} className="hover:bg-(--ui-muted-surface)">
                <td className="px-4 py-3 text-sm font-semibold text-(--ui-text)">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm text-(--ui-text)">{fmt(row.sales_value)}</td>
                <td className="px-4 py-3 text-sm font-bold text-(--ui-success-fg)">{fmt(row.net_sales)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Operations Snapshot"
          subtitle="Quick risk and throughput read for the current view"
        >
          <div className="grid grid-cols-2 gap-3 p-4">
            <div className="rounded-xl bg-(--ui-muted-surface) p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-text-muted)">Primary Tender</div>
              <div className="mt-2 text-2xl font-bold text-(--ui-danger-fg)">
                {primaryTender?.method || "N/A"}
              </div>
              <div className="mt-1 text-xs text-(--ui-text-muted)">
                {primaryTender ? fmt(primaryTender.total) : "No payments in view"}
              </div>
            </div>
            <div className="rounded-xl bg-(--ui-success-bg) p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-success-fg)">Active Cashiers</div>
              <div className="mt-2 text-2xl font-bold text-(--ui-success-fg)">
                {cashiers.length}
              </div>
              <div className="mt-1 text-xs text-(--ui-success-fg)">
                Top performer {topCashiers[0]?.employee_name || "N/A"}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-(--ui-border) p-4">
            <div className="rounded-xl bg-(--ui-danger-bg) p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-danger-fg)">Voids</div>
              <div className="mt-2 text-2xl font-bold text-(--ui-danger-fg)">
                {Number(refundsVoids?.summary?.void_count || 0)}
              </div>
              <div className="mt-1 text-xs text-(--ui-danger-fg)">{fmt(totalVoids)}</div>
            </div>
            <div className="rounded-xl bg-(--ui-warning-bg) p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-(--ui-warning-fg)">Refunds</div>
              <div className="mt-2 text-2xl font-bold text-(--ui-warning-fg)">
                {Number(refundsVoids?.summary?.refund_count || 0)}
              </div>
              <div className="mt-1 text-xs text-(--ui-warning-fg)">{fmt(totalRefunds)}</div>
            </div>
          </div>
        </CardShell>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <CardShell
          title="Latest Voids"
          subtitle="Most recent voided transactions in view"
        >
          <TableShell cols={["Time", "Sale", "Employee", "Total"]} loading={loading} empty={!topVoids.length}>
            {topVoids.map((row) => (
              <tr key={row.sale_id} className="hover:bg-(--ui-muted-surface)">
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmtDateTime(row.timestamp)}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-(--ui-text)">#{row.sale_id}</td>
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm font-bold text-(--ui-danger-fg)">{fmt(row.total_amount)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>

        <CardShell
          title="Latest Refunds"
          subtitle="Most recent refunds in view"
        >
          <TableShell cols={["Time", "Return", "Employee", "Total"]} loading={loading} empty={!topRefunds.length}>
            {topRefunds.map((row) => (
              <tr key={row.return_id} className="hover:bg-(--ui-muted-surface)">
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{fmtDateTime(row.timestamp)}</td>
                <td className="px-4 py-3 font-mono text-xs font-bold text-(--ui-text)">#{row.return_id}</td>
                <td className="px-4 py-3 text-sm text-(--ui-text-muted)">{row.employee_name}</td>
                <td className="px-4 py-3 text-sm font-bold text-(--ui-warning-fg)">{fmt(row.total_refund)}</td>
              </tr>
            ))}
          </TableShell>
        </CardShell>
      </div>
    </div>
  );
}
