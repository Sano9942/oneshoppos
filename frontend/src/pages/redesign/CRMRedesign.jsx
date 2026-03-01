import { useCallback, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { API_BASE as API } from "../../config";
import { useAuth } from "../../auth/AuthProvider";
import {
  Badge,
  Button,
  Input,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const STAGES = ["new", "contacted", "qualified", "converted", "lost"];
const STAGE_TONE = { new: "default", contacted: "info", qualified: "warning", converted: "success", lost: "danger" };
const PRIORITY_TONE = { low: "default", medium: "warning", high: "danger" };

const EMPTY_FORM = {
  name: "", company: "", phone: "", email: "", source: "",
  priority: "medium", stage: "new", expected_value: 0, assigned_to: "", notes: "",
};

const money = (v) => `PKRs ${Number(v || 0).toFixed(2)}`;
const fmtDate = (d) => d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export default function CRMRedesign() {
  const { authHeaders } = useAuth();
  const [leads, setLeads] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [activityLead, setActivityLead] = useState(null);
  const [activities, setActivities] = useState([]);
  const [activityText, setActivityText] = useState("");
  const [addingActivity, setAddingActivity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [leadRes, empRes] = await Promise.all([
        fetch(`${API}/api/crm/leads`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API}/api/employees`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setLeads(leadRes.leads || []);
      setEmployees(empRes.employees || []);
    } catch (e) {
      setError(e.message || "Failed to load CRM data");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  const loadActivities = useCallback(async (leadId) => {
    try {
      const res = await fetch(`${API}/api/crm/leads/${leadId}/activities`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setActivities(data.activities || []);
    } catch {
      setActivities([]);
    }
  }, [authHeaders]);

  useEffect(() => { load(); }, [load]);

  const createLead = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/crm/leads`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create lead");
      setForm(EMPTY_FORM);
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.message || "Failed to create lead");
    } finally {
      setSaving(false);
    }
  };

  const setStage = async (lead, stage) => {
    try {
      await fetch(`${API}/api/crm/leads/${lead.id}`, {
        method: "PUT",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ ...lead, stage }),
      });
      await load();
    } catch {
      // silent — optimistic failure
    }
  };

  const convertLead = async (leadId) => {
    try {
      await fetch(`${API}/api/crm/leads/${leadId}/convert`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      await load();
    } catch {
      // silent
    }
  };

  const addActivity = async (e) => {
    e.preventDefault();
    if (!activityLead || !activityText.trim()) return;
    setAddingActivity(true);
    try {
      await fetch(`${API}/api/crm/leads/${activityLead.id}/activities`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ type: "note", description: activityText, employee_id: null }),
      });
      setActivityText("");
      await loadActivities(activityLead.id);
    } finally {
      setAddingActivity(false);
    }
  };

  const openActivity = (lead) => {
    setActivityLead(lead);
    loadActivities(lead.id);
  };

  const totalByStage = (stage) =>
    leads.filter((l) => String(l.stage || "").toLowerCase() === stage)
      .reduce((s, l) => s + Number(l.expected_value || 0), 0);

  return (
    <PageShell
      title="CRM"
      subtitle="Sales pipeline and lead activity tracking."
      right={
        <Button tone="primary" onClick={() => { setForm(EMPTY_FORM); setModalOpen(true); }}>
          <Plus size={14} className="mr-1 inline" /> Add Lead
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</SectionCard>
      ) : null}

      {/* Pipeline summary */}
      <div className="mb-4 grid grid-cols-5 gap-2">
        {STAGES.map((stage) => {
          const count = leads.filter((l) => String(l.stage || "").toLowerCase() === stage).length;
          return (
            <SectionCard key={stage} className="p-3">
              <p className="text-xs capitalize text-(--ui-text-muted)">{stage}</p>
              <p className="text-xl font-bold text-(--ui-text)">{count}</p>
              <p className="mt-0.5 text-xs text-(--ui-text-muted)">{money(totalByStage(stage))}</p>
            </SectionCard>
          );
        })}
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="py-12 text-center text-sm text-(--ui-text-muted)">Loading pipeline...</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {STAGES.map((stage) => {
            const stageleads = leads.filter((l) => String(l.stage || "").toLowerCase() === stage);
            return (
              <div key={stage} className="flex flex-col gap-2">
                <div className="flex items-center gap-2 px-1">
                  <Badge tone={STAGE_TONE[stage]} className="capitalize">{stage}</Badge>
                  <span className="text-xs text-(--ui-text-muted)">{stageleads.length}</span>
                </div>
                {stageleads.length === 0 && (
                  <div className="rounded-lg border border-dashed border-(--ui-border) p-4 text-center text-xs text-(--ui-text-muted)">
                    No leads
                  </div>
                )}
                {stageleads.map((lead) => (
                  <SectionCard key={lead.id} className="p-3">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-semibold text-(--ui-text)">{lead.name}</p>
                      <Badge tone={PRIORITY_TONE[lead.priority] || "default"} className="shrink-0 capitalize text-[10px]">
                        {lead.priority}
                      </Badge>
                    </div>
                    {lead.company && (
                      <p className="mt-0.5 text-xs text-(--ui-text-muted)">{lead.company}</p>
                    )}
                    <p className="mt-1 text-xs font-medium text-(--ui-accent)">{money(lead.expected_value)}</p>

                    {/* Stage move buttons */}
                    <div className="mt-2 flex flex-wrap gap-1">
                      {STAGES.filter((s) => s !== stage).map((s) => (
                        <button
                          key={s}
                          onClick={() => setStage(lead, s)}
                          className="rounded border border-(--ui-border) bg-(--ui-surface) px-1.5 py-0.5 text-[10px] capitalize text-(--ui-text-muted) hover:bg-(--ui-muted-surface) transition-colors"
                        >
                          → {s}
                        </button>
                      ))}
                    </div>

                    <div className="mt-2 flex gap-2 border-t border-(--ui-border) pt-2">
                      <button
                        className="text-xs text-(--ui-accent) hover:underline"
                        onClick={() => openActivity(lead)}
                      >
                        Activity
                      </button>
                      {stage !== "converted" && (
                        <button
                          className="text-xs text-emerald-600 hover:underline"
                          onClick={() => convertLead(lead.id)}
                        >
                          Convert
                        </button>
                      )}
                    </div>
                  </SectionCard>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Lead Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">Add Lead</h3>
              <button onClick={() => setModalOpen(false)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
                <X size={16} />
              </button>
            </div>
            <form className="grid grid-cols-2 gap-2" onSubmit={createLead}>
              <Input required placeholder="Lead name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <Input placeholder="Company" value={form.company} onChange={(e) => setForm((p) => ({ ...p, company: e.target.value }))} />
              <Input placeholder="Phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
              <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              <Input placeholder="Source" value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))} />
              <Input placeholder="Expected Value" type="number" min={0} value={form.expected_value} onChange={(e) => setForm((p) => ({ ...p, expected_value: e.target.value }))} />
              <Select value={form.priority} onChange={(e) => setForm((p) => ({ ...p, priority: e.target.value }))}>
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </Select>
              <Select value={form.stage} onChange={(e) => setForm((p) => ({ ...p, stage: e.target.value }))}>
                {STAGES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </Select>
              <Select className="col-span-2" value={form.assigned_to} onChange={(e) => setForm((p) => ({ ...p, assigned_to: e.target.value }))}>
                <option value="">Assign to employee</option>
                {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
              </Select>
              <textarea
                className="col-span-2 rounded-lg border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) placeholder-(--ui-text-muted) focus:outline-none focus:ring-2 focus:ring-(--ui-accent)/20"
                rows={2}
                placeholder="Notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />
              <div className="col-span-2 flex gap-2 pt-1">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Add Lead"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      )}

      {/* Activity Drawer */}
      {activityLead && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="flex w-full max-w-lg flex-col p-5" style={{ maxHeight: "80vh" }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-(--ui-text)">
                Activities — {activityLead.name}
              </h3>
              <button onClick={() => setActivityLead(null)} className="text-(--ui-text-muted) hover:text-(--ui-text)">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={addActivity} className="mb-3 flex gap-2">
              <Input
                className="flex-1"
                placeholder="Add a note..."
                value={activityText}
                onChange={(e) => setActivityText(e.target.value)}
              />
              <Button tone="primary" type="submit" disabled={addingActivity}>
                {addingActivity ? "..." : "Add"}
              </Button>
            </form>

            <div className="flex-1 overflow-auto divide-y divide-(--ui-border) rounded-lg border border-(--ui-border)">
              {activities.length === 0 && (
                <p className="p-4 text-center text-sm text-(--ui-text-muted)">No activities yet.</p>
              )}
              {activities.map((a) => (
                <div key={a.id} className="p-3">
                  <p className="text-sm text-(--ui-text)">{a.description}</p>
                  <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                    {a.employee_name || "System"} · {fmtDate(a.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )}
    </PageShell>
  );
}
