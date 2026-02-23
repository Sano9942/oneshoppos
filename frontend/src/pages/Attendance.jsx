import { useState, useEffect } from "react";
import { Clock, User, Search, Download } from "lucide-react";

const API = "http://localhost:5000";
const fmt = (n) => (n == null ? "—" : `${parseFloat(n).toFixed(2)}h`);
const fmtTime = (dt) =>
  dt ? new Date(dt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "—";
const fmtDate = (dt) =>
  dt ? new Date(dt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const today = new Date().toISOString().slice(0, 10);

export default function Attendance() {
  const [records, setRecords] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch(`${API}/api/employees`)
      .then((r) => r.json())
      .then((d) => setEmployees(d.employees || []))
      .catch(() => {});
  }, []);

  const fetchRecords = () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (dateFrom) params.set("date_from", dateFrom);
    if (dateTo) params.set("date_to", dateTo);
    if (employeeId) params.set("employee_id", employeeId);
    fetch(`${API}/api/attendance?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRecords(d.records || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRecords(); }, []);

  const filtered = search
    ? records.filter(
        (r) =>
          r.employee_name?.toLowerCase().includes(search.toLowerCase()) ||
          r.outlet_name?.toLowerCase().includes(search.toLowerCase())
      )
    : records;

  const totalHours = filtered.reduce((sum, r) => sum + (r.hours || 0), 0);

  const statusBadge = (status) => {
    const map = {
      present: "bg-emerald-100 text-emerald-800",
      absent: "bg-rose-100 text-rose-800",
      late: "bg-amber-100 text-amber-800",
    };
    return (
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${map[status] || "bg-slate-100 text-slate-700"}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Attendance</h1>
          <p className="text-slate-500 text-sm">Clock-in and clock-out records from the POS terminal</p>
        </div>
        <div className="flex gap-2 text-xs font-semibold text-slate-500 bg-slate-100 px-4 py-2 rounded-xl border border-slate-200">
          <Clock size={14} className="text-blue-500" />
          Total Hours (filtered): <span className="text-slate-800 ml-1">{totalHours.toFixed(2)}h</span>
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
          <span className="ml-auto text-xs text-slate-400">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</span>
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
                  {["Date", "Employee", "Role", "Outlet", "Check In", "Check Out", "Hours", "Status"].map((h) => (
                    <th key={h} className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 text-slate-700 whitespace-nowrap">{fmtDate(r.check_in)}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap">{r.employee_name}</td>
                    <td className="px-5 py-3 text-slate-500 whitespace-nowrap capitalize">{r.role}</td>
                    <td className="px-5 py-3 text-slate-600 whitespace-nowrap">{r.outlet_name}</td>
                    <td className="px-5 py-3 text-slate-700 font-mono whitespace-nowrap">{fmtTime(r.check_in)}</td>
                    <td className="px-5 py-3 text-slate-700 font-mono whitespace-nowrap">{fmtTime(r.check_out)}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800 whitespace-nowrap">{fmt(r.hours)}</td>
                    <td className="px-5 py-3">{statusBadge(r.status)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t border-slate-200">
                <tr>
                  <td colSpan={6} className="px-5 py-3 text-xs font-bold text-slate-500 uppercase">Total</td>
                  <td className="px-5 py-3 font-bold text-slate-800">{totalHours.toFixed(2)}h</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
