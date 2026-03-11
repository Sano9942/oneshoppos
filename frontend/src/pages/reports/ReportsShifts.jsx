import React, { useEffect, useCallback, useState } from "react";
import { Wallet, Receipt, ListChecks, Shield, Calculator } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmtDate,
  fmtDateTime,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

function ShiftRequired({ title, body }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h3 className="text-sm font-bold text-slate-700">{title}</h3>
      <p className="mt-2 text-sm text-slate-500">{body}</p>
    </div>
  );
}

export function ShiftSummaryTab({ filters }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!filters.shiftId) {
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ session_id: filters.shiftId });
      const res = await fetch(`${API}/api/reports/shift-summary?${p}`);
      const d = await res.json();
      setData(d.summary || null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!filters.shiftId) {
    return (
      <ShiftRequired
        title="Select a shift"
        body="Choose a shift from the global filters to review totals, returns, voids, and sales count."
      />
    );
  }

  const summary = data || {};
  const netSales =
    Number(summary.total_sales || 0) - Number(summary.total_returns || 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Gross Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(summary.total_sales)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Returns
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">
            {fmt(summary.total_returns)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Net Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">
            {fmt(netSales)}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Orders / Voids
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {Number(summary.order_count || 0)} / {Number(summary.void_count || 0)}
          </p>
        </div>
      </div>

      <CardShell
        title="Shift Totals"
        subtitle="High-level summary for the selected shift/session"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "shift_summary.csv",
                [
                  { header: "Gross Sales", key: "total_sales" },
                  { header: "Returns", key: "total_returns" },
                  { header: "Order Count", key: "order_count" },
                  { header: "Void Count", key: "void_count" },
                  { header: "Net Sales", key: "net_sales" },
                ],
                [{ ...summary, net_sales: netSales }],
              )
            }
          />
        }
      >
        <TableShell cols={["Metric", "Value"]} loading={loading} empty={!data}>
          <tr>
            <td className="px-4 py-3 text-sm font-medium text-slate-500">
              Total Sales
            </td>
            <td className="px-4 py-3 text-sm font-bold text-slate-900">
              {fmt(summary.total_sales)}
            </td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-sm font-medium text-slate-500">
              Total Returns
            </td>
            <td className="px-4 py-3 text-sm font-bold text-rose-700">
              {fmt(summary.total_returns)}
            </td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-sm font-medium text-slate-500">
              Order Count
            </td>
            <td className="px-4 py-3 text-sm font-bold text-slate-900">
              {Number(summary.order_count || 0)}
            </td>
          </tr>
          <tr>
            <td className="px-4 py-3 text-sm font-medium text-slate-500">
              Void Count
            </td>
            <td className="px-4 py-3 text-sm font-bold text-slate-900">
              {Number(summary.void_count || 0)}
            </td>
          </tr>
          <tr className="bg-emerald-50/60">
            <td className="px-4 py-3 text-sm font-bold text-emerald-700">
              Net Sales
            </td>
            <td className="px-4 py-3 text-sm font-bold text-emerald-700">
              {fmt(netSales)}
            </td>
          </tr>
        </TableShell>
      </CardShell>
    </div>
  );
}

export function ShiftSalesTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!filters.shiftId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ session_id: filters.shiftId });
      const res = await fetch(`${API}/api/reports/shift-sales?${p}`);
      const d = await res.json();
      setRows(d.sales || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!filters.shiftId) {
    return (
      <ShiftRequired
        title="Select a shift"
        body="Choose a shift from the global filters to review the shift-level transaction list."
      />
    );
  }

  const totalSales = rows.reduce(
    (sum, row) => sum + Number(row.total_amount || 0),
    0,
  );
  const voidedSales = rows.filter((row) => Number(row.voided || 0) !== 0).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Transactions
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Shift Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalSales)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Voided Sales
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{voidedSales}</p>
        </div>
      </div>

      <CardShell
        title="Shift Sales Journal"
        subtitle="All sales linked to the selected session"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "shift_sales.csv",
                [
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Sale ID", key: "id" },
                  { header: "Customer", key: "customer_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Payment Method", key: "payment_method" },
                  { header: "Voided", key: "voided" },
                  { header: "Total", key: "total_amount" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Timestamp", "Sale", "Customer", "Employee", "Payment", "Status", "Total"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-600">
                {fmtDateTime(r.timestamp)}
              </td>
              <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">
                #{r.id}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {r.customer_name || "Walk-in"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {r.employee_name || "-"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {r.payment_method || "-"}
              </td>
              <td className="px-4 py-3 text-sm">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                    Number(r.voided || 0) !== 0
                      ? "bg-rose-100 text-rose-700"
                      : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  {Number(r.voided || 0) !== 0 ? "Voided" : "Posted"}
                </span>
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.total_amount)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function PaymentSummaryTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!filters.shiftId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ session_id: filters.shiftId });
      const res = await fetch(`${API}/api/reports/payment-summary?${p}`);
      const d = await res.json();
      setRows(d.payments || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!filters.shiftId) {
    return (
      <ShiftRequired
        title="Select a shift"
        body="Choose a shift from the global filters to review payment mix for the session."
      />
    );
  }

  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Payment Types
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Settled
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(total)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Transactions
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {rows.reduce((sum, row) => sum + Number(row.count || 0), 0)}
          </p>
        </div>
      </div>

      <CardShell
        title="Payment Mix"
        subtitle="Tender breakdown for the selected shift"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "shift_payment_summary.csv",
                [
                  { header: "Payment Method", key: "payment_method" },
                  { header: "Count", key: "count" },
                  { header: "Total", key: "total" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Payment Method", "Count", "Total", "Mix"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => {
            const pct =
              total > 0 ? ((Number(r.total || 0) / total) * 100).toFixed(1) : "0.0";
            return (
              <tr key={r.payment_method} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                  {r.payment_method || "Unknown"}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{r.count}</td>
                <td className="px-4 py-3 text-sm font-bold text-slate-900">
                  {fmt(r.total)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{pct}%</td>
              </tr>
            );
          })}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function CashFlowTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
      });
      const res = await fetch(`${API}/api/reports/cash-flow?${p}`);
      const d = await res.json();
      setRows(d.sessions || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Sessions
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Opening Float
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(rows.reduce((sum, row) => sum + Number(row.start_cash || 0), 0))}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Closing Cash
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(rows.reduce((sum, row) => sum + Number(row.end_cash || 0), 0))}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Open Sessions
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {rows.filter((row) => !row.end_time).length}
          </p>
        </div>
      </div>

      <CardShell
        title="Cash Flow By Session"
        subtitle="Register session list with employee and opening/closing cash"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "cash_flow.csv",
                [
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Employee", key: "employee_name" },
                  { header: "Start Time", key: "start_time" },
                  { header: "End Time", key: "end_time" },
                  { header: "Start Cash", key: "start_cash" },
                  { header: "End Cash", key: "end_cash" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Outlet", "Employee", "Start", "End", "Opening", "Closing"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {r.outlet_name}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {r.employee_name || "-"}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {fmtDateTime(r.start_time)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-600">
                {r.end_time ? fmtDateTime(r.end_time) : "Open"}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.start_cash)}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.end_cash)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function CurrentSessionZReportTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!filters.shiftId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ session_id: filters.shiftId });
      const res = await fetch(`${API}/api/reports/current-session-zreport?${p}`);
      const d = await res.json();
      setRows(d.zReport || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!filters.shiftId) {
    return (
      <ShiftRequired
        title="Select a shift"
        body="Choose a shift from the global filters to review the session z-report."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tenders
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Session Total
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {fmt(rows.reduce((sum, row) => sum + Number(row.total || 0), 0))}
          </p>
        </div>
      </div>

      <CardShell
        title="Session Z-Report"
        subtitle="Tender totals for the selected session"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "session_zreport.csv",
                [
                  { header: "Method", key: "method" },
                  { header: "Total", key: "total" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell cols={["Method", "Total"]} loading={loading} empty={!rows.length}>
          {rows.map((r) => (
            <tr key={r.method} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">
                {r.method}
              </td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">
                {fmt(r.total)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function CashAuditTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!filters.shiftId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ session_id: filters.shiftId });
      const res = await fetch(`${API}/api/reports/cash-audit?${p}`);
      const d = await res.json();
      setRows(d.audit || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!filters.shiftId) {
    return (
      <ShiftRequired
        title="Select a shift"
        body="Choose a shift from the global filters to review cash sales and cash returns in sequence."
      />
    );
  }

  const totalIn = rows
    .filter((row) => Number(row.amount || 0) > 0)
    .reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalOut = rows
    .filter((row) => Number(row.amount || 0) < 0)
    .reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cash In
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{fmt(totalIn)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Cash Out
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{fmt(totalOut)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Net Cash
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalIn - totalOut)}</p>
        </div>
      </div>

      <CardShell
        title="Cash Audit Trail"
        subtitle="Chronological cash movement for the selected session"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "cash_audit.csv",
                [
                  { header: "Type", key: "type" },
                  { header: "Timestamp", key: "timestamp" },
                  { header: "Reference", key: "ref_id" },
                  { header: "Amount", key: "amount" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell cols={["Timestamp", "Type", "Reference", "Amount"]} loading={loading} empty={!rows.length}>
          {rows.map((r, index) => (
            <tr key={`${r.type}-${r.ref_id}-${index}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-sm text-slate-600">{fmtDateTime(r.timestamp)}</td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">{r.type}</td>
              <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">#{r.ref_id}</td>
              <td className={`px-4 py-3 text-sm font-bold ${Number(r.amount || 0) < 0 ? "text-rose-700" : "text-emerald-700"}`}>
                {fmt(r.amount)}
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function DenominationsTab({ filters }) {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (filters.shiftId) p.set("session_id", filters.shiftId);
      const res = await fetch(`${API}/api/reports/all-denominations?${p}`);
      const d = await res.json();
      setRows(d.denominations || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.shiftId]);

  useEffect(() => {
    load();
  }, [load]);

  const totalValue = rows.reduce((sum, row) => sum + Number(row.subtotal || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Denomination Rows
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Total Value
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fmt(totalValue)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Stages
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">
            {new Set(rows.map((row) => row.stage).filter(Boolean)).size}
          </p>
        </div>
      </div>

      <CardShell
        title="Denomination Breakdown"
        subtitle={filters.shiftId ? "Denominations for the selected session" : "Recent denomination records across sessions"}
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "denominations.csv",
                [
                  { header: "Session", key: "session_id" },
                  { header: "Stage", key: "stage" },
                  { header: "Denomination", key: "denomination" },
                  { header: "Count", key: "count" },
                  { header: "Subtotal", key: "subtotal" },
                  { header: "Employee", key: "employee_name" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Session", "Stage", "Denomination", "Count", "Subtotal", "Employee"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, index) => (
            <tr key={`${r.session_id}-${r.stage}-${r.denomination}-${index}`} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs font-bold text-slate-800">#{r.session_id}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.stage || "-"}</td>
              <td className="px-4 py-3 text-sm font-semibold text-slate-800">{Number(r.denomination || 0)}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.count}</td>
              <td className="px-4 py-3 text-sm font-bold text-slate-900">{fmt(r.subtotal)}</td>
              <td className="px-4 py-3 text-sm text-slate-600">{r.employee_name || "-"}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export const SHIFT_TAB_META = {
  "shift-summary": { label: "Shift Summary", icon: Wallet },
  "shift-sales": { label: "Shift Sales", icon: Receipt },
  "payment-summary": { label: "Payment Summary", icon: Calculator },
  "cash-flow": { label: "Cash Flow", icon: ListChecks },
  "cash-audit": { label: "Cash Audit", icon: Shield },
  denominations: { label: "Denominations", icon: ListChecks },
  "current-session-zreport": { label: "Session Z-Report", icon: Shield },
};
