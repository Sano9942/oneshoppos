import { useState, useEffect } from "react";
import { Clock, User, Search, Pencil, X, Check } from "lucide-react";

import { api } from '../api';
import { fmtLocalTime, fmtLocalDate, parseLocalDate } from '../utils/dates';

// "8.25" → "8h 15m"
const fmtHours = (n) => {
  if (n == null) return "—";
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return `${h}h ${m}m`;
};
const fmtTime = (dt) => fmtLocalTime(dt, { hour: "2-digit", minute: "2-digit" });
const fmtDate = (dt) => fmtLocalDate(dt);
// Format a datetime to "YYYY-MM-DDTHH:MM" for datetime-local inputs
const toInputDt = (dt) => {
  if (!dt) return "";
  const d = parseLocalDate(dt);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const today = new Date().toLocaleDateString("sv-SE");

const statusBadge = (status) => {
  const map = {
    present: "bg-emerald-100 text-emerald-800",
    checked_out: "bg-blue-100 text-blue-800",
    absent: "bg-rose-100 text-rose-800",
    late: "bg-amber-100 text-amber-800",
  };
  const label = status === "checked_out" ? "Checked Out" : status;
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${map[status] || "bg-slate-100 text-slate-700"}`}>
      {label}
    </span>
  );
};

export default function Attendance() {
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");

  // Edit modal state
  const [editingRow, setEditingRow] = useState(null);

  // Break detail modal state
  const [breakRow, setBreakRow] = useState(null);
  const [breakSessions, setBreakSessions] = useState([]);
  const [breakLoading, setBreakLoading] = useState(false);

  const openBreakDetail = async (row) => {
    setBreakRow(row);
    setBreakSessions([]);
    setBreakLoading(true);
    try {
      const date = row.check_in?.slice(0, 10);
      const data = await api.get("/api/attendance/sessions", {
        employee_id: row.employee_id,
        date_from: date,
        date_to: date,
        session_type: "break",
      });
      setBreakSessions(data.sessions || []);
    } catch {
      setBreakSessions([]);
    } finally {
      setBreakLoading(false);
    }
  };
  const [editForm, setEditForm] = useState({ check_in: "", check_out: "", comment: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const fetchRecords = () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (employeeId) params.set("employee_id", employeeId);
    api.get(`/api/attendance?${params}`)
      .then((d) => {
        setRecords(d.records || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    api.get("/api/employees")
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
    fetchRecords();
  }, []);
  /* eslint-enable react-hooks/exhaustive-deps */

  const filtered = search
    ? records.filter(
        (r) =>
          r.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.outlet_name?.toLowerCase().includes(search.toLowerCase()),
      )
    : records;

  const totalHours = filtered.reduce((sum, r) => sum + (r.hours || 0), 0);

  const openEdit = (row) => {
    setEditingRow(row);
    setEditForm({
      check_in: toInputDt(row.check_in),
      check_out: toInputDt(row.check_out),
      comment: row.comment || "",
    });
    setEditError("");
  };

  const saveEdit = async () => {
    if (!editingRow) return;
    setEditSaving(true);
    setEditError("");
    try {
      const body = {
        check_in: editForm.check_in ? editForm.check_in.replace("T", " ") + ":00" : undefined,
        check_out: editForm.check_out ? editForm.check_out.replace("T", " ") + ":00" : undefined,
        comment: editForm.comment || null,
      };
      await api.put(`/api/attendance/${editingRow.id}`, body);
      setEditingRow(null);
      fetchRecords();
    } catch (e) {
      setEditError(e.message);
    } finally {
      setEditSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Net hours summary */}
      <div className="flex justify-end">
        <div className="flex gap-2 text-xs font-semibold text-slate-500 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200">
          <Clock size={14} className="text-blue-500" />
          Net Work Hours (filtered):{" "}
          <span className="text-slate-800 ml-1">{fmtHours(totalHours)}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Employee</label>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>
        <button
          onClick={fetchRecords}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
        >
          Apply
        </button>
        <div className="ml-auto flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-slate-50">
          <Search size={14} className="text-slate-400" />
          <input
            type="text"
            placeholder="Search employee / outlet..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="text-sm bg-transparent focus:outline-none w-44"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
          <User size={15} className="text-blue-500" />
          <h3 className="font-bold text-slate-800 text-sm">Attendance Records</h3>
          <span className="ml-auto text-xs text-slate-400">
            {filtered.length} record{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center flex-1 text-slate-400 text-sm">Loading...</div>
        ) : error ? (
          <div className="flex items-center justify-center flex-1 text-rose-600 text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-slate-400 py-16">
            <Clock size={40} className="mb-3 opacity-20" />
            <p className="text-sm">No attendance records for the selected period</p>
          </div>
        ) : (
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0">
                <tr>
                  {["Date", "Employee", "Role", "Outlet", "Check In", "Check Out", "Sessions", "Break", "Net Hours", "Status", ""].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.check_in)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">{r.employee_name}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap capitalize">{r.role}</td>
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{r.outlet_name}</td>
                    <td className="px-4 py-3 text-slate-700 font-mono whitespace-nowrap">{fmtTime(r.check_in)}</td>
                    <td className="px-4 py-3 text-slate-700 font-mono whitespace-nowrap">{fmtTime(r.check_out)}</td>
                    <td className="px-4 py-3 text-center text-slate-600 whitespace-nowrap">
                      {r.work_sessions > 0 ? (
                        <span className="inline-block bg-blue-100 text-blue-700 text-xs font-bold rounded-full px-2 py-0.5">
                          {r.work_sessions}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.break_hours > 0 ? (
                        <button
                          onClick={() => openBreakDetail(r)}
                          className="text-amber-700 hover:text-amber-900 hover:underline font-medium"
                          title="View break details"
                        >
                          {fmtHours(r.break_hours)}
                        </button>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-800 whitespace-nowrap">
                      {fmtHours(r.hours)}
                    </td>
                    <td className="px-4 py-3">{statusBadge(r.status)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openEdit(r)}
                        className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Edit record"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={8} className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">
                    Total Net Work Hours
                  </td>
                  <td className="px-4 py-3 font-bold text-slate-800">{fmtHours(totalHours)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editingRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-slate-800 text-base">Edit Attendance Record</h3>
              <button onClick={() => setEditingRow(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {editingRow.employee_name} — {fmtDate(editingRow.check_in)}
            </p>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Check In</label>
                <input
                  type="datetime-local"
                  value={editForm.check_in}
                  onChange={(e) => setEditForm((f) => ({ ...f, check_in: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Check Out</label>
                <input
                  type="datetime-local"
                  value={editForm.check_out}
                  onChange={(e) => setEditForm((f) => ({ ...f, check_out: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Comment</label>
                <input
                  type="text"
                  value={editForm.comment}
                  onChange={(e) => setEditForm((f) => ({ ...f, comment: e.target.value }))}
                  placeholder="e.g. Corrected by manager"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {editError && <p className="text-rose-600 text-sm">{editError}</p>}
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setEditingRow(null)}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={editSaving}
                className="px-5 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-2 disabled:opacity-60"
              >
                <Check size={14} />
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Break detail modal */}
      {breakRow && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="font-bold text-slate-800 text-base">Break Details</h3>
                <p className="text-xs text-slate-500 mt-0.5">{breakRow.employee_name} — {fmtDate(breakRow.check_in)}</p>
              </div>
              <button onClick={() => setBreakRow(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            {breakLoading ? (
              <p className="text-sm text-slate-500 text-center py-6">Loading…</p>
            ) : breakSessions.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No break sessions recorded.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {breakSessions.map((s, i) => (
                  <div key={s.id} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-800 capitalize">
                          {s.break_reason || "Break"}
                        </p>
                        <p className="text-xs text-slate-500">
                          {fmtTime(s.session_start)} → {s.session_end ? fmtTime(s.session_end) : "ongoing"}
                        </p>
                      </div>
                    </div>
                    <span className="text-sm font-mono text-amber-700">
                      {s.duration_hours != null ? fmtHours(s.duration_hours) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
              <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide">Total Break</span>
              <span className="text-sm font-bold text-amber-700">{fmtHours(breakRow.break_hours)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
