import React, { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import { parseLocalDate } from "../../utils/dates";
import {
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";
import { useCurrency } from "../../contexts/CurrencyContext";

export function AttendanceTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        employee_id: filters.employeeId,
      });
      if (filters.outletIds && filters.outletIds.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/attendance?${p}`);
      const filtered = (d.records || []).filter((row) =>
        filters.outletIds && filters.outletIds.length ? filters.outletIds.includes(Number(row.outlet_id)) : true,
      );
      setRows(filtered);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.employeeId, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  // check_in / check_out are LOCAL-time columns — use parseLocalDate (no UTC shift)
  const fmtTime = (dt) => {
    if (!dt) return "--:--";
    const d = parseLocalDate(dt);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const totalHours = rows.reduce((sum, row) => sum + Number(row.hours || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CardShell title="Attendance Days" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{rows.length}</div>
        </CardShell>
        <CardShell title="Present Records" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">
            {rows.filter((row) => row.status === "present").length}
          </div>
        </CardShell>
        <CardShell title="Total Hours" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">
            {totalHours.toFixed(2)}
          </div>
        </CardShell>
      </div>

      <CardShell
        title="Staff Attendance Log"
        subtitle="Clock-in/out records, outlet, and total worked hours"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "attendance.csv",
                [
                  { header: "Date", key: "check_in" },
                  { header: "Staff", key: "employee_name" },
                  { header: "Outlet", key: "outlet_name" },
                  { header: "Clock In", key: "check_in" },
                  { header: "Clock Out", key: "check_out" },
                  { header: "Hours", key: "hours" },
                  { header: "Status", key: "status" },
                ],
                rows,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Staff", "Outlet", "Date", "Clock In", "Clock Out", "Duration"]}
          loading={loading}
          empty={!rows.length}
        >
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{r.employee_name}</td>
              <td className="p-4 text-(--ui-text-muted)">{r.outlet_name}</td>
              <td className="p-4 text-(--ui-text-muted)">{fmtDate(r.check_in)}</td>
              <td className="p-4 font-medium text-(--ui-success-fg) font-mono">
                {fmtTime(r.check_in)}
              </td>
              <td className="p-4 font-medium text-(--ui-danger-fg) font-mono">
                {fmtTime(r.check_out)}
              </td>
              <td className="p-4 font-bold text-(--ui-text)">
                {Number(r.hours || 0).toFixed(2)} hrs
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function LaborPerformanceTab({ filters }) {
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
      const d = await api.get(`/api/reports/labor-performance?${p}`);
      setData(d.labor_performance || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalHours = data.reduce((sum, row) => sum + Number(row.total_hours || 0), 0);
  const totalRevenue = data.reduce((sum, row) => sum + Number(row.total_revenue || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CardShell title="Staff Tracked" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{data.length}</div>
        </CardShell>
        <CardShell title="Hours Worked" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">
            {totalHours.toFixed(2)}
          </div>
        </CardShell>
        <CardShell title="Revenue" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</div>
        </CardShell>
      </div>

      <CardShell
        title="Labor Efficiency"
        subtitle="Revenue output per man-hour worked"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "labor_performance.csv",
                [
                  { header: "Staff", key: "employee_name" },
                  { header: "Hours", key: "total_hours" },
                  { header: "Revenue", key: "total_revenue" },
                  { header: "Revenue / Hour", key: "revenue_per_hour" },
                ],
                data,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Employee", "Hours", "Revenue", "Efficiency"]}
          loading={loading}
          empty={!data.length}
        >
          {data.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{r.employee_name}</td>
              <td className="p-4 text-(--ui-text-muted)">{Number(r.total_hours || 0).toFixed(2)} hrs</td>
              <td className="p-4 font-bold text-(--ui-text)">{fmt(r.total_revenue)}</td>
              <td className="p-4">
                <div className="font-bold text-(--ui-warning-fg)">
                  {fmt(r.revenue_per_hour)}/hr
                </div>
                <div className="w-16 bg-(--ui-muted-surface) h-1 rounded-full mt-1">
                  <div
                    className="bg-(--ui-warning-fg) h-full rounded-full"
                    style={{
                      width: `${Math.min(100, (Number(r.revenue_per_hour || 0) / 200) * 100)}%`,
                    }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function LaborVsSalesTab({ filters }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo });
      if (filters.outletIds?.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/labor-vs-sales?${p}`);
      setData(d.labor_vs_sales || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => { load(); }, [load]);

  const totalHours = data.reduce((s, r) => s + Number(r.hours_worked || 0), 0);
  const totalRevenue = data.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const totalLabor = data.reduce((s, r) => s + Number(r.labor_cost || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <CardShell title="Staff" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{data.length}</div>
        </CardShell>
        <CardShell title="Hours Worked" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{totalHours.toFixed(1)}</div>
        </CardShell>
        <CardShell title="Revenue" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{fmt(totalRevenue)}</div>
        </CardShell>
        <CardShell title="Labor Cost" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{fmt(totalLabor)}</div>
        </CardShell>
      </div>
      <CardShell
        title="Labor vs Sales"
        subtitle="Revenue generated per labor hour and cost"
        action={
          <ExportButton onClick={() => exportCSV("labor_vs_sales.csv", [
            { header: "Staff", key: "employee_name" },
            { header: "Hours", key: "hours_worked" },
            { header: "Sales", key: "sale_count" },
            { header: "Revenue", key: "revenue" },
            { header: "Rev/Hour", key: "revenue_per_hour" },
            { header: "Labor Cost", key: "labor_cost" },
          ], data)} />
        }
      >
        <TableShell cols={["Employee", "Hours", "Sales", "Revenue", "Rev/Hour", "Labor Cost"]} loading={loading} empty={!data.length}>
          {data.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{r.employee_name}</td>
              <td className="p-4 text-(--ui-text-muted)">{Number(r.hours_worked || 0).toFixed(1)}h</td>
              <td className="p-4 text-(--ui-text-muted)">{r.sale_count}</td>
              <td className="p-4 font-bold text-(--ui-text)">{fmt(r.revenue)}</td>
              <td className="p-4 font-bold text-(--ui-warning-fg)">{fmt(r.revenue_per_hour)}/hr</td>
              <td className="p-4 text-(--ui-text-muted)">{fmt(r.labor_cost)}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function StaffAttributionTab({ filters }) {
  const { fmt } = useCurrency();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ date_from: filters.dateFrom, date_to: filters.dateTo });
      if (filters.outletIds?.length) p.set("outlet_id", filters.outletIds.join(","));
      const d = await api.get(`/api/reports/staff-attribution?${p}`);
      setData(d.staff_attribution || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <CardShell
        title="Staff Attribution"
        subtitle="Per-employee breakdown of sales, discounts, returns, voids, and approvals"
        action={
          <ExportButton onClick={() => exportCSV("staff_attribution.csv", [
            { header: "Staff", key: "employee_name" },
            { header: "Sales", key: "sale_count" },
            { header: "Revenue", key: "revenue" },
            { header: "Discounts", key: "discount_total" },
            { header: "Voids", key: "void_count" },
            { header: "Returns", key: "return_count" },
            { header: "Return Value", key: "return_total" },
            { header: "Approvals", key: "approval_count" },
          ], data)} />
        }
      >
        <TableShell
          cols={["Employee", "Sales", "Revenue", "Discounts", "Voids", "Returns", "Approvals"]}
          loading={loading}
          empty={!data.length}
        >
          {data.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{r.employee_name}</td>
              <td className="p-4 text-(--ui-text-muted)">{r.sale_count}</td>
              <td className="p-4 font-bold text-(--ui-text)">{fmt(r.revenue)}</td>
              <td className="p-4 text-(--ui-warning-fg)">{fmt(r.discount_total)}</td>
              <td className="p-4 text-(--ui-danger-fg)">{r.void_count}</td>
              <td className="p-4">
                <span className="text-(--ui-warning-fg)">{r.return_count}</span>
                <span className="text-xs text-(--ui-text-muted) ml-1">({fmt(r.return_total)})</span>
              </td>
              <td className="p-4 text-(--ui-link)">{r.approval_count}</td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}

export function LossPreventionTab({ filters }) {
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
      const d = await api.get(`/api/reports/loss-prevention?${p}`);
      setData(d.loss_prevention || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletIds]);

  useEffect(() => {
    load();
  }, [load]);

  const totalVoidValue = data.reduce((sum, row) => sum + Number(row.void_value || 0), 0);
  const totalRefundValue = data.reduce((sum, row) => sum + Number(row.refund_value || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <CardShell title="Staff Audited" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{data.length}</div>
        </CardShell>
        <CardShell title="Void Value" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{fmt(totalVoidValue)}</div>
        </CardShell>
        <CardShell title="Refund Value" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-(--ui-text)">{fmt(totalRefundValue)}</div>
        </CardShell>
      </div>

      <CardShell
        title="Loss Prevention Index"
        subtitle="Monitoring void/refund ratios by staff member"
        action={
          <ExportButton
            onClick={() =>
              exportCSV(
                "loss_prevention.csv",
                [
                  { header: "Staff", key: "employee_name" },
                  { header: "Sales Revenue", key: "total_revenue" },
                  { header: "Sale Count", key: "sale_count" },
                  { header: "Void Count", key: "void_count" },
                  { header: "Void Value", key: "void_value" },
                  { header: "Refund Count", key: "refund_count" },
                  { header: "Refund Value", key: "refund_value" },
                  { header: "Risk %", key: "risk_ratio_pct" },
                ],
                data,
              )
            }
          />
        }
      >
        <TableShell
          cols={["Staff", "Sales", "Leaks", "Risk Ratio"]}
          loading={loading}
          empty={!data.length}
        >
          {data.map((r, i) => (
            <tr key={i} className="hover:bg-(--ui-muted-surface) text-sm">
              <td className="p-4 font-bold text-(--ui-text)">{r.employee_name}</td>
              <td className="p-4 font-medium text-(--ui-text-muted)">{fmt(r.total_revenue)}</td>
              <td className="p-4">
                <div className="text-(--ui-danger-fg) font-bold">Voids: {fmt(r.void_value)}</div>
                <div className="text-(--ui-warning-fg) font-bold">Refunds: {fmt(r.refund_value)}</div>
              </td>
              <td className="p-4">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-bold ${
                    Number(r.risk_ratio_pct || 0) > 5
                      ? "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
                      : "bg-(--ui-success-bg) text-(--ui-success-fg)"
                  }`}
                >
                  {r.risk_ratio_pct}% Risk
                </span>
              </td>
            </tr>
          ))}
        </TableShell>
      </CardShell>
    </div>
  );
}
