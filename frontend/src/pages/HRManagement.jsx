/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

export default function HRManagement() {
  const { authHeaders } = useAuth();
  const [tab, setTab] = useState("leave");
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [lines, setLines] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [leaveForm, setLeaveForm] = useState({ employee_id: "", type: "annual", start_date: "", end_date: "", days: 1, reason: "" });
  const [periodForm, setPeriodForm] = useState({ period_name: "", start_date: "", end_date: "" });

  const loadAll = useCallback(async () => {
    try {
      const [empRes, leaveRes, periodRes] = await Promise.all([
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/hr/leave`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/hr/payroll/periods`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setEmployees(empRes.employees || []);
      setLeaves(leaveRes.leave_requests || []);
      setPeriods(periodRes.periods || []);
    } catch {
      // ignore
    }
  }, [authHeaders]);

  const loadLines = useCallback(async (periodId) => {
    if (!periodId) return setLines([]);
    try {
      const res = await fetch(`${API}/api/hr/payroll/periods/${periodId}/lines`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setLines(data.lines || []);
    } catch {
      setLines([]);
    }
  }, [authHeaders]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    loadLines(selectedPeriod);
  }, [selectedPeriod, loadLines]);

  const submitLeave = async (e) => {
    e.preventDefault();
    await fetch(`${API}/api/hr/leave`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(leaveForm),
    });
    setLeaveForm({ employee_id: "", type: "annual", start_date: "", end_date: "", days: 1, reason: "" });
    loadAll();
  };

  const updateLeaveStatus = async (id, status) => {
    await fetch(`${API}/api/hr/leave/${id}/status`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status }),
    });
    loadAll();
  };

  const createPeriod = async (e) => {
    e.preventDefault();
    await fetch(`${API}/api/hr/payroll/periods`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(periodForm),
    });
    setPeriodForm({ period_name: "", start_date: "", end_date: "" });
    loadAll();
  };

  const generatePayroll = async (periodId) => {
    await fetch(`${API}/api/hr/payroll/periods/${periodId}/generate`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
    });
    loadAll();
    setSelectedPeriod(String(periodId));
    loadLines(periodId);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">HR Management</h1>
        <p className="text-sm text-slate-500 mt-1">Leave requests and payroll periods</p>
      </div>

      <div className="flex gap-2 border-b">
        <button onClick={() => setTab("leave")} className={`px-4 py-2 text-sm border-b-2 ${tab === "leave" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>Leave</button>
        <button onClick={() => setTab("payroll")} className={`px-4 py-2 text-sm border-b-2 ${tab === "payroll" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>Payroll</button>
      </div>

      {tab === "leave" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form onSubmit={submitLeave} className="bg-white border rounded-xl p-4 space-y-3">
            <p className="font-semibold text-slate-700">Create Leave Request</p>
            <select value={leaveForm.employee_id} onChange={(e) => setLeaveForm((f) => ({ ...f, employee_id: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select employee</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select value={leaveForm.type} onChange={(e) => setLeaveForm((f) => ({ ...f, type: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option><option value="unpaid">Unpaid</option><option value="other">Other</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={leaveForm.start_date} onChange={(e) => setLeaveForm((f) => ({ ...f, start_date: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
              <input type="date" value={leaveForm.end_date} onChange={(e) => setLeaveForm((f) => ({ ...f, end_date: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <input type="number" min="0.5" step="0.5" value={leaveForm.days} onChange={(e) => setLeaveForm((f) => ({ ...f, days: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Days" />
            <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm((f) => ({ ...f, reason: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" rows={3} placeholder="Reason" />
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Submit Leave</button>
          </form>

          <div className="bg-white border rounded-xl p-4 overflow-auto">
            <p className="font-semibold text-slate-700 mb-2">Requests</p>
            <table className="w-full text-sm min-w-[650px]">
              <thead>
                <tr className="text-left text-slate-500"><th className="py-2">Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                {leaves.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2">{r.employee_name}</td>
                    <td>{r.type}</td>
                    <td>{r.start_date} to {r.end_date}</td>
                    <td>{r.days}</td>
                    <td>{r.status}</td>
                    <td className="space-x-2">
                      <button className="text-xs text-emerald-600" onClick={() => updateLeaveStatus(r.id, "approved")}>Approve</button>
                      <button className="text-xs text-rose-600" onClick={() => updateLeaveStatus(r.id, "rejected")}>Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "payroll" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <form onSubmit={createPeriod} className="bg-white border rounded-xl p-4 space-y-3">
            <p className="font-semibold text-slate-700">Create Payroll Period</p>
            <input value={periodForm.period_name} onChange={(e) => setPeriodForm((f) => ({ ...f, period_name: e.target.value }))} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Period Name" />
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={periodForm.start_date} onChange={(e) => setPeriodForm((f) => ({ ...f, start_date: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
              <input type="date" value={periodForm.end_date} onChange={(e) => setPeriodForm((f) => ({ ...f, end_date: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">Create Period</button>
          </form>

          <div className="bg-white border rounded-xl p-4">
            <p className="font-semibold text-slate-700 mb-2">Periods</p>
            <div className="space-y-2 max-h-72 overflow-auto">
              {periods.map((p) => (
                <div key={p.id} className="border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{p.period_name}</p>
                    <p className="text-xs text-slate-500">{p.start_date} to {p.end_date} - {p.status}</p>
                  </div>
                  <div className="space-x-2">
                    <button className="text-xs text-blue-600" onClick={() => { setSelectedPeriod(String(p.id)); loadLines(p.id); }}>View</button>
                    <button className="text-xs text-emerald-600" onClick={() => generatePayroll(p.id)}>Generate</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border rounded-xl p-4 lg:col-span-2 overflow-auto">
            <p className="font-semibold text-slate-700 mb-2">Payroll Lines</p>
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-slate-500"><th className="py-2">Employee</th><th>Salary Type</th><th>Base Rate</th><th>Hours</th><th>Days</th><th>Leave</th><th>Gross</th><th>Deductions</th><th>Net</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t">
                    <td className="py-2">{l.employee_name}</td>
                    <td>{l.salary_type}</td><td>{l.base_rate}</td><td>{l.total_hours}</td><td>{l.total_days}</td><td>{l.leave_days}</td><td>{l.gross_pay}</td><td>{l.deductions}</td><td>{l.net_pay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
