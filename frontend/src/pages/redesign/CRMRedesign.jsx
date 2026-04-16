import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../api";
import {
  Badge,
  Button,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const STAGES = ["new", "contacted", "qualified", "converted", "lost"];
const STAGE_TONE = { new: "default", contacted: "info", qualified: "warning", converted: "success", lost: "danger" };
const PRIORITY_TONE = { low: "default", medium: "warning", high: "danger" };

const ACTIVITY_TYPES = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "demo", label: "Demo" },
  { value: "follow_up", label: "Follow-up" },
];
const ACTIVITY_TYPE_STYLE = {
  note:      "bg-gray-100 text-gray-700",
  call:      "bg-blue-100 text-blue-700",
  email:     "bg-purple-100 text-purple-700",
  meeting:   "bg-green-100 text-green-700",
  demo:      "bg-orange-100 text-orange-700",
  follow_up: "bg-amber-100 text-amber-700",
};

const EMPTY_FORM = {
  name: "", company: "", phone: "", email: "", source: "",
  priority: "medium", stage: "new", expected_value: 0, assigned_to: "", notes: "",
};

import { fmtLocalDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
const fmtDate = fmtLocalDateTime;

export default function CRMRedesign() {
  const { fmt: money } = useCurrency();
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
  const [activityType, setActivityType] = useState("note");
  const [addingActivity, setAddingActivity] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [leadRes, empRes] = await Promise.all([
        api.get("/api/crm/leads"),
        api.get("/api/employees"),
      ]);
      setLeads(leadRes.leads || []);
      setEmployees(empRes.employees || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load CRM data");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActivities = useCallback(async (leadId) => {
    try {
      const data = await api.get(`/api/crm/leads/${leadId}/activities`);
      setActivities(data.activities || []);
    } catch {
      setActivities([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createLead = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.post("/api/crm/leads", form);
      setForm(EMPTY_FORM);
      setModalOpen(false);
      await load();
    } catch (e2) {
      setError(e2.body?.error || e2.message || "Failed to create lead");
    } finally {
      setSaving(false);
    }
  };

  const setStage = async (lead, stage) => {
    try {
      await api.put(`/api/crm/leads/${lead.id}`, { ...lead, stage });
      await load();
    } catch {
      // silent — optimistic failure
    }
  };

  const convertLead = async (leadId) => {
    try {
      await api.post(`/api/crm/leads/${leadId}/convert`, {});
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
      await api.post(`/api/crm/leads/${activityLead.id}/activities`, { type: activityType, description: activityText, employee_id: null });
      setActivityText("");
      setActivityType("note");
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
      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title="Add Lead"
        size="lg"
      >
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
          <div className="col-span-2">
            <ModalFooter>
              <Button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
              <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Add Lead"}</Button>
            </ModalFooter>
          </div>
        </form>
      </Modal>

      {/* Activity Drawer */}
      <Modal
        open={!!activityLead}
        onClose={() => setActivityLead(null)}
        title={activityLead ? `Activities — ${activityLead.name}` : "Activities"}
        size="lg"
      >
        {activityLead ? (
          <>
            <form onSubmit={addActivity} className="mb-3 flex flex-col gap-2">
              <div className="flex gap-2">
                <Select
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                  className="w-36 shrink-0"
                >
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>
                <Input
                  className="flex-1"
                  placeholder="Add a note..."
                  value={activityText}
                  onChange={(e) => setActivityText(e.target.value)}
                />
                <Button tone="primary" type="submit" disabled={addingActivity}>
                  {addingActivity ? "..." : "Add"}
                </Button>
              </div>
            </form>

            <div className="max-h-[50vh] overflow-auto divide-y divide-(--ui-border) rounded-lg border border-(--ui-border)">
              {activities.length === 0 && (
                <p className="p-4 text-center text-sm text-(--ui-text-muted)">No activities yet.</p>
              )}
              {activities.map((a) => (
                <div key={a.id} className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize ${ACTIVITY_TYPE_STYLE[a.type] || ACTIVITY_TYPE_STYLE.note}`}>
                      {(a.type || "note").replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-sm text-(--ui-text)">{a.description}</p>
                  <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                    {a.employee_name || "System"} · {fmtDate(a.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
