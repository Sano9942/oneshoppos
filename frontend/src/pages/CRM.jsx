/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from "react";
import { API_BASE as API } from "../config";
import { useAuth } from "../auth/AuthProvider";

const STAGES = ["new", "contacted", "qualified", "converted", "lost"];

export default function CRM() {
  const { authHeaders } = useAuth();
  const [leads, setLeads] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({ name: "", company: "", phone: "", email: "", source: "", priority: "medium", stage: "new", expected_value: 0, assigned_to: "", notes: "" });
  const [activityLead, setActivityLead] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activityText, setActivityText] = useState("");

  const load = async () => {
    try {
      const [leadRes, empRes] = await Promise.all([
        fetch(`${API}/api/crm/leads`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setLeads(leadRes.leads || []);
      setEmployees(empRes.employees || []);
    } catch {
      // ignore
    }
  };

  const loadActivities = async (leadId) => {
    try {
      const res = await fetch(`${API}/api/crm/leads/${leadId}/activities`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setActivities(data.activities || []);
    } catch {
      setActivities([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createLead = async (e) => {
    e.preventDefault();
    await fetch(`${API}/api/crm/leads`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(form),
    });
    setForm({ name: "", company: "", phone: "", email: "", source: "", priority: "medium", stage: "new", expected_value: 0, assigned_to: "", notes: "" });
    load();
  };

  const setStage = async (lead, stage) => {
    await fetch(`${API}/api/crm/leads/${lead.id}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ ...lead, stage }),
    });
    load();
  };

  const convertLead = async (leadId) => {
    await fetch(`${API}/api/crm/leads/${leadId}/convert`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
    });
    load();
  };

  const addActivity = async (e) => {
    e.preventDefault();
    if (!activityLead || !activityText.trim()) return;
    await fetch(`${API}/api/crm/leads/${activityLead.id}/activities`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ type: "note", description: activityText, employee_id: null }),
    });
    setActivityText("");
    loadActivities(activityLead.id);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">CRM</h1>
        <p className="text-sm text-slate-500 mt-1">Pipeline and lead activities</p>
      </div>

      <form onSubmit={createLead} className="bg-white border rounded-xl p-4 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Lead Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Company" value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        <input className="border rounded-lg px-3 py-2 text-sm" placeholder="Source" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
        <select className="border rounded-lg px-3 py-2 text-sm" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <input type="number" className="border rounded-lg px-3 py-2 text-sm" placeholder="Expected Value" value={form.expected_value} onChange={(e) => setForm((f) => ({ ...f, expected_value: e.target.value }))} />
        <select className="border rounded-lg px-3 py-2 text-sm" value={form.assigned_to} onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}>
          <option value="">Assign to</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <textarea className="border rounded-lg px-3 py-2 text-sm md:col-span-4" rows={2} placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm w-fit">Add Lead</button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        {STAGES.map((stage) => {
          const rows = leads.filter((l) => String(l.stage || "").toLowerCase() === stage);
          return (
            <div key={stage} className="bg-white border rounded-xl p-3">
              <p className="font-semibold text-sm capitalize text-slate-700">{stage} <span className="text-slate-400">({rows.length})</span></p>
              <div className="space-y-2 mt-2">
                {rows.map((lead) => (
                  <div key={lead.id} className="border rounded-lg p-2 bg-slate-50">
                    <p className="text-sm font-medium text-slate-700">{lead.name}</p>
                    <p className="text-xs text-slate-500">{lead.company || "-"}</p>
                    <p className="text-xs text-indigo-600 mt-1">PKRs {Number(lead.expected_value || 0).toFixed(2)}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {STAGES.filter((s) => s !== stage).map((s) => (
                        <button key={s} className="text-[11px] px-2 py-0.5 rounded bg-white border" onClick={() => setStage(lead, s)}>{s}</button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2 text-xs">
                      <button className="text-blue-600" onClick={() => { setActivityLead(lead); loadActivities(lead.id); }}>Activity</button>
                      <button className="text-emerald-600" onClick={() => convertLead(lead.id)}>Convert</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {activityLead && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border w-full max-w-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Activities - {activityLead.name}</h2>
              <button className="text-sm text-slate-500" onClick={() => setActivityLead(null)}>Close</button>
            </div>
            <form onSubmit={addActivity} className="flex gap-2 mb-3">
              <input className="flex-1 border rounded-lg px-3 py-2 text-sm" value={activityText} onChange={(e) => setActivityText(e.target.value)} placeholder="Add activity note" />
              <button className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Add</button>
            </form>
            <div className="max-h-72 overflow-auto border rounded-lg">
              {activities.map((a) => (
                <div key={a.id} className="p-2 border-b">
                  <p className="text-sm text-slate-700">{a.description}</p>
                  <p className="text-xs text-slate-400">{a.employee_name || "-"} - {a.created_at}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
