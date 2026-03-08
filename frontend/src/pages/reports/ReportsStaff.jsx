import React, { useState, useEffect, useCallback } from "react";
import { API_BASE as API } from "../../config";
import { parseLocalDate } from "../../utils/dates";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

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
      const res = await fetch(`${API}/api/attendance?${p}`);
      const d = await res.json();
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
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">{rows.length}</div>
        </CardShell>
        <CardShell title="Present Records" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">
            {rows.filter((row) => row.status === "present").length}
          </div>
        </CardShell>
        <CardShell title="Total Hours" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">
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
            <tr key={i} className="hover:bg-slate-50 text-sm">
              <td className="p-4 font-bold text-slate-800">{r.employee_name}</td>
              <td className="p-4 text-slate-600">{r.outlet_name}</td>
              <td className="p-4 text-slate-500">{fmtDate(r.check_in)}</td>
              <td className="p-4 font-medium text-emerald-600 font-mono">
                {fmtTime(r.check_in)}
              </td>
              <td className="p-4 font-medium text-rose-600 font-mono">
                {fmtTime(r.check_out)}
              </td>
              <td className="p-4 font-bold text-slate-900">
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
      const res = await fetch(`${API}/api/reports/labor-performance?${p}`);
      const d = await res.json();
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
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">{data.length}</div>
        </CardShell>
        <CardShell title="Hours Worked" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">
            {totalHours.toFixed(2)}
          </div>
        </CardShell>
        <CardShell title="Revenue" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">{fmt(totalRevenue)}</div>
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
            <tr key={i} className="hover:bg-slate-50 text-sm">
              <td className="p-4 font-bold text-slate-800">{r.employee_name}</td>
              <td className="p-4 text-slate-600">{Number(r.total_hours || 0).toFixed(2)} hrs</td>
              <td className="p-4 font-bold text-slate-800">{fmt(r.total_revenue)}</td>
              <td className="p-4">
                <div className="font-bold text-amber-600">
                  {fmt(r.revenue_per_hour)}/hr
                </div>
                <div className="w-16 bg-slate-100 h-1 rounded-full mt-1">
                  <div
                    className="bg-amber-500 h-full rounded-full"
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

export function LossPreventionTab({ filters }) {
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
      const res = await fetch(`${API}/api/reports/loss-prevention?${p}`);
      const d = await res.json();
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
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">{data.length}</div>
        </CardShell>
        <CardShell title="Void Value" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">{fmt(totalVoidValue)}</div>
        </CardShell>
        <CardShell title="Refund Value" subtitle={null}>
          <div className="px-4 py-5 text-2xl font-bold text-slate-900">{fmt(totalRefundValue)}</div>
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
            <tr key={i} className="hover:bg-slate-50 text-sm">
              <td className="p-4 font-bold text-slate-800">{r.employee_name}</td>
              <td className="p-4 font-medium text-slate-600">{fmt(r.total_revenue)}</td>
              <td className="p-4">
                <div className="text-rose-500 font-bold">Voids: {fmt(r.void_value)}</div>
                <div className="text-orange-500 font-bold">Refunds: {fmt(r.refund_value)}</div>
              </td>
              <td className="p-4">
                <span
                  className={`px-2 py-1 rounded-full text-xs font-bold ${
                    Number(r.risk_ratio_pct || 0) > 5
                      ? "bg-rose-100 text-rose-700"
                      : "bg-emerald-100 text-emerald-700"
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
