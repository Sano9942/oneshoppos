import React, { useState, useEffect, useCallback } from "react";
import { Clock, Activity, ShieldAlert, AlertTriangle } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  fmt,
  fmtDate,
  exportCSV,
  ExportButton,
  TableShell,
  CardShell,
} from "./ReportShared";

// --- Attendance Tab -----------------------------------------------------------
export function AttendanceTab({ filters }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
        employee_id: filters.employeeId,
      });
      const res = await fetch(`${API}/api/reports/attendance?${p}`);
      const d = await res.json();
      setRows(d.items || d.attendance || []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId, filters.employeeId]);

  useEffect(() => {
    load();
  }, [load]);

  const fmtTime = (dt) => {
    if (!dt) return "--:--";
    const d = new Date(dt);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <CardShell
      title="Staff Attendance Log"
      subtitle="Clock-in/out records and shift duration"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "attendance.csv",
              ["Date", "Staff", "In", "Out", "Hours"],
              rows,
            )
          }
        />
      }
    >
      <TableShell
        cols={["Staff", "Date", "Clock In", "Clock Out", "Duration"]}
        loading={loading}
        empty={!rows.length}
      >
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-slate-50 text-sm">
            <td className="p-4 font-bold text-slate-800">{r.employee_name}</td>
            <td className="p-4 text-slate-500">{fmtDate(r.date)}</td>
            <td className="p-4 font-medium text-emerald-600 font-mono">
              {fmtTime(r.clock_in)}
            </td>
            <td className="p-4 font-medium text-rose-600 font-mono">
              {fmtTime(r.clock_out)}
            </td>
            <td className="p-4 font-bold text-slate-900">
              {r.total_hours} hrs
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Labor Performance ---------------------------------------------------
export function LaborPerformanceTab({ filters }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/labor-performance?${p}`);
      const d = await res.json();
      setData(d.labor_performance || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Labor Efficiency"
      subtitle="Revenue output per man-hour worked"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "labor_performance.csv",
              ["Staff", "Hours", "Revenue", "Rev/Hr"],
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
            <td className="p-4 text-slate-600">{r.total_hours} hrs</td>
            <td className="p-4 font-bold text-slate-800">
              {fmt(r.total_revenue)}
            </td>
            <td className="p-4">
              <div className="font-bold text-amber-600">
                {fmt(r.revenue_per_hour)}/hr
              </div>
              <div className="w-16 bg-slate-100 h-1 rounded-full mt-1">
                <div
                  className="bg-amber-500 h-full rounded-full"
                  style={{
                    width: `${Math.min(100, (r.revenue_per_hour / 200) * 100)}%`,
                  }}
                />
              </div>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}

// --- Tab: Loss Prevention -----------------------------------------------------
export function LossPreventionTab({ filters }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        outlet_id: filters.outletId,
      });
      const res = await fetch(`${API}/api/reports/loss-prevention?${p}`);
      const d = await res.json();
      setData(d.loss_prevention || []);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [filters.dateFrom, filters.dateTo, filters.outletId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <CardShell
      title="Loss Prevention Index"
      subtitle="Monitoring void/refund ratios by staff member"
      action={
        <ExportButton
          onClick={() =>
            exportCSV(
              "loss_prevention.csv",
              ["Staff", "Sales", "Voids", "Refunds", "Risk"],
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
            <td className="p-4 font-medium text-slate-600">
              {fmt(r.total_revenue)}
            </td>
            <td className="p-4">
              <div className="text-rose-500 font-bold">
                Voids: {fmt(r.void_value)}
              </div>
              <div className="text-orange-500 font-bold">
                Refunds: {fmt(r.refund_value)}
              </div>
            </td>
            <td className="p-4">
              <span
                className={`px-2 py-1 rounded-full text-xs font-bold ${r.risk_ratio_pct > 5 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
              >
                {r.risk_ratio_pct}% Risk
              </span>
            </td>
          </tr>
        ))}
      </TableShell>
    </CardShell>
  );
}
