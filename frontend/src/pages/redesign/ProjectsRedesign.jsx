import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, EmptyState } from "../../ui/primitives";
import { Plus, ArrowLeft, X, CheckCircle, Clock, FileText } from "lucide-react";
import { api } from "../../api";

const STATUS_TONES = { draft: "default", active: "success", on_hold: "warning", completed: "success", cancelled: "danger" };
const STATUSES = ["draft", "active", "on_hold", "completed", "cancelled"];

function fmtDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MilestoneProgress({ milestones }) {
  if (!milestones || milestones.length === 0) return <span className="text-xs text-(--ui-text-muted)">No milestones</span>;
  const completed = milestones.filter(m => m.status === "completed").length;
  const pct = Math.round((completed / milestones.length) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-(--ui-text-muted)">{completed}/{milestones.length}</span>
    </div>
  );
}

/* ---- Create Project Modal ---- */
function CreateProjectModal({ customers, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", description: "", customer_id: "", start_date: "", end_date: "", budget: "" });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Project name is required"); return; }
    setSaving(true);
    try {
      const body = { ...form, budget: form.budget ? Number(form.budget) : undefined, customer_id: form.customer_id ? Number(form.customer_id) : undefined };
      await api.post("/projects", body);
      toast.success("Project created");
      onCreated();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-(--ui-bg) border border-(--ui-border) rounded-xl p-6 w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-(--ui-text)">New Project</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Name *</label>
            <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Project name" />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Description</label>
            <textarea className="w-full rounded-lg border border-(--ui-border) bg-white px-3 py-2 text-sm text-(--ui-text)" rows={3} value={form.description} onChange={e => set("description", e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Customer</label>
            <select className="w-full rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)" value={form.customer_id} onChange={e => set("customer_id", e.target.value)}>
              <option value="">-- Select --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Start Date</label>
              <Input type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">End Date</label>
              <Input type="date" value={form.end_date} onChange={e => set("end_date", e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Budget</label>
            <Input type="number" value={form.budget} onChange={e => set("budget", e.target.value)} placeholder="0.00" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" onClick={submit} disabled={saving}>{saving ? "Saving..." : "Create Project"}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---- Add Milestone Inline ---- */
function AddMilestoneRow({ projectId, onAdded }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", due_date: "", amount: "" });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Milestone name is required"); return; }
    setSaving(true);
    try {
      await api.post(`/projects/${projectId}/milestones`, {
        name: form.name,
        due_date: form.due_date || undefined,
        amount: form.amount ? Number(form.amount) : undefined,
      });
      toast.success("Milestone added");
      setForm({ name: "", due_date: "", amount: "" });
      setOpen(false);
      onAdded();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-(--ui-primary) hover:underline flex items-center gap-1 mt-2"><Plus className="w-4 h-4" /> Add Milestone</button>;

  return (
    <div className="flex flex-wrap items-end gap-2 mt-2 p-3 border border-(--ui-border) rounded-lg bg-(--ui-bg)">
      <div className="flex-1 min-w-[140px]">
        <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Name</label>
        <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Milestone name" />
      </div>
      <div className="w-36">
        <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Due Date</label>
        <Input type="date" value={form.due_date} onChange={e => setForm(p => ({ ...p, due_date: e.target.value }))} />
      </div>
      <div className="w-28">
        <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Amount</label>
        <Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0" />
      </div>
      <Button size="sm" tone="primary" onClick={submit} disabled={saving}>Add</Button>
      <Button size="sm" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

/* ---- Project Detail View ---- */
function ProjectDetail({ projectId, onBack }) {
  const toast = useToast();
  const { fmt } = useCurrency();
  const [project, setProject] = useState(null);
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statusDropdown, setStatusDropdown] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/projects/${projectId}`);
      setProject(data.project || data);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [projectId]);

  const loadBilling = useCallback(async () => {
    try {
      const data = await api.get(`/projects/${projectId}/billing`);
      setBilling(data);
    } catch {}
  }, [projectId]);

  useEffect(() => { load(); loadBilling(); }, [load, loadBilling]);

  const updateStatus = async (status) => {
    try {
      await api.put(`/projects/${projectId}`, { status });
      toast.success(`Project marked ${status}`);
      setStatusDropdown(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const toggleMilestone = async (mid, currentStatus) => {
    const newStatus = currentStatus === "completed" ? "pending" : "completed";
    try {
      await api.put(`/projects/${projectId}/milestones/${mid}`, { status: newStatus });
      load();
    } catch (err) { toast.error(err.message); }
  };

  if (loading) return <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>;
  if (!project) return <div className="text-center py-12 text-(--ui-text-muted)">Project not found</div>;

  const milestones = project.milestones || [];
  const activities = project.activities || [];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="text-(--ui-text-muted) hover:text-(--ui-text)"><ArrowLeft className="w-5 h-5" /></button>
        <div className="flex-1">
          <h2 className="text-xl font-semibold text-(--ui-text)">{project.name}</h2>
          {project.customer_name && <p className="text-sm text-(--ui-text-muted)">{project.customer_name}</p>}
        </div>
        <div className="relative">
          <Button size="sm" onClick={() => setStatusDropdown(!statusDropdown)}>
            <Badge tone={STATUS_TONES[project.status] || "default"}>{project.status?.replace(/_/g, " ")}</Badge>
          </Button>
          {statusDropdown && (
            <div className="absolute right-0 mt-1 bg-(--ui-bg) border border-(--ui-border) rounded-lg shadow-lg z-10 min-w-[140px]">
              {STATUSES.filter(s => s !== project.status).map(s => (
                <button key={s} onClick={() => updateStatus(s)} className="block w-full text-left px-3 py-2 text-sm text-(--ui-text) hover:bg-(--ui-bg-hover) first:rounded-t-lg last:rounded-b-lg">
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Info + Milestones */}
        <div className="lg:col-span-2 space-y-4">
          {/* Info */}
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Details</h3>
            {project.description && <p className="text-sm text-(--ui-text-muted) mb-3">{project.description}</p>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><span className="text-(--ui-text-muted)">Start</span><p className="font-medium text-(--ui-text)">{fmtDate(project.start_date)}</p></div>
              <div><span className="text-(--ui-text-muted)">End</span><p className="font-medium text-(--ui-text)">{fmtDate(project.end_date)}</p></div>
              <div><span className="text-(--ui-text-muted)">Budget</span><p className="font-medium text-(--ui-text)">{project.budget ? fmt(project.budget) : "-"}</p></div>
              <div><span className="text-(--ui-text-muted)">Created</span><p className="font-medium text-(--ui-text)">{fmtDate(project.created_at)}</p></div>
            </div>
          </SectionCard>

          {/* Billing summary */}
          {billing && (
            <SectionCard className="p-4">
              <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Billing Summary</h3>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><span className="text-(--ui-text-muted)">Total Billed</span><p className="font-medium text-(--ui-text)">{fmt(billing.total_billed || 0)}</p></div>
                <div><span className="text-(--ui-text-muted)">Total Paid</span><p className="font-medium text-(--ui-text)">{fmt(billing.total_paid || 0)}</p></div>
                <div><span className="text-(--ui-text-muted)">Outstanding</span><p className="font-medium text-(--ui-text)">{fmt(billing.outstanding || 0)}</p></div>
              </div>
            </SectionCard>
          )}

          {/* Milestones */}
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Milestones</h3>
            {milestones.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">No milestones yet.</p>
            ) : (
              <div className="space-y-2">
                {milestones.map(m => (
                  <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg border border-(--ui-border) hover:bg-(--ui-bg-hover)">
                    <button onClick={() => toggleMilestone(m.id, m.status)} className={`flex-shrink-0 ${m.status === "completed" ? "text-emerald-500" : "text-slate-300 hover:text-slate-400"}`}>
                      <CheckCircle className="w-5 h-5" />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${m.status === "completed" ? "line-through text-(--ui-text-muted)" : "text-(--ui-text)"}`}>{m.name}</p>
                      <div className="flex gap-3 text-xs text-(--ui-text-muted)">
                        {m.due_date && <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {fmtDate(m.due_date)}</span>}
                        {m.amount && <span>{fmt(m.amount)}</span>}
                      </div>
                    </div>
                    <Badge tone={m.status === "completed" ? "success" : m.status === "in_progress" ? "warning" : "default"}>{m.status?.replace(/_/g, " ")}</Badge>
                  </div>
                ))}
              </div>
            )}
            <AddMilestoneRow projectId={projectId} onAdded={load} />
          </SectionCard>
        </div>

        {/* Right: Activity Timeline */}
        <div>
          <SectionCard className="p-4">
            <h3 className="text-sm font-semibold text-(--ui-text) mb-3">Activity</h3>
            {activities.length === 0 ? (
              <p className="text-sm text-(--ui-text-muted)">No activity yet.</p>
            ) : (
              <div className="space-y-3">
                {activities.map((a, i) => (
                  <div key={a.id || i} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-(--ui-primary) mt-2 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="text-(--ui-text)">{a.description || a.type}</p>
                      <p className="text-xs text-(--ui-text-muted)">{fmtDateTime(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/* ---- Main Component ---- */
export default function ProjectsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");

  if (!flagsLoading && !flags.phase4_service_projects) return <Navigate to="/dashboard" replace />;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      let url = "/projects";
      const params = [];
      if (statusFilter) params.push(`status=${statusFilter}`);
      if (search.trim()) params.push(`search=${encodeURIComponent(search.trim())}`);
      if (params.length) url += "?" + params.join("&");
      const data = await api.get(url);
      setProjects(data.projects || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [statusFilter, search]);

  const loadCustomers = useCallback(async () => {
    try {
      const data = await api.get("/customers");
      setCustomers(data.customers || data || []);
    } catch {}
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);
  useEffect(() => { loadCustomers(); }, [loadCustomers]);

  if (selectedId) {
    return (
      <PageShell title="Projects" subtitle="Service project workspace">
        <ProjectDetail projectId={selectedId} onBack={() => { setSelectedId(null); loadProjects(); }} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Projects" subtitle="Service project workspace" right={<Button tone="primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4 mr-1" /> New Project</Button>}>
      {/* Filters */}
      <SectionCard className="p-4 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Search</label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Project name..." />
          </div>
          <div>
            <label className="text-xs font-medium text-(--ui-text-muted) mb-1 block">Status</label>
            <select className="rounded-lg border border-(--ui-border) bg-(--ui-bg) px-3 py-2 text-sm text-(--ui-text)" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <Button size="sm" onClick={loadProjects}>Filter</Button>
        </div>
      </SectionCard>

      {/* Project List */}
      <SectionCard>
        {loading ? (
          <div className="text-center py-12 text-(--ui-text-muted)">Loading...</div>
        ) : projects.length === 0 ? (
          <EmptyState title="No projects found" body="Create a new project to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="pb-2 pr-4 pl-4 font-medium">Project</th>
                  <th className="pb-2 pr-4 font-medium">Customer</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium">Budget</th>
                  <th className="pb-2 pr-4 font-medium">Milestones</th>
                  <th className="pb-2 pr-4 font-medium">Dates</th>
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover) cursor-pointer" onClick={() => setSelectedId(p.id)}>
                    <td className="py-2.5 pr-4 pl-4">
                      <p className="font-medium text-(--ui-text)">{p.name}</p>
                      {p.description && <p className="text-xs text-(--ui-text-muted) truncate max-w-[200px]">{p.description}</p>}
                    </td>
                    <td className="py-2.5 pr-4 text-(--ui-text)">{p.customer_name || "-"}</td>
                    <td className="py-2.5 pr-4"><Badge tone={STATUS_TONES[p.status] || "default"}>{p.status?.replace(/_/g, " ")}</Badge></td>
                    <td className="py-2.5 pr-4 text-(--ui-text)">{p.budget ? fmt(p.budget) : "-"}</td>
                    <td className="py-2.5 pr-4"><MilestoneProgress milestones={p.milestones} /></td>
                    <td className="py-2.5 pr-4 text-xs text-(--ui-text-muted) whitespace-nowrap">{fmtDate(p.start_date)} - {fmtDate(p.end_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {showCreate && <CreateProjectModal customers={customers} onClose={() => setShowCreate(false)} onCreated={loadProjects} />}
    </PageShell>
  );
}
