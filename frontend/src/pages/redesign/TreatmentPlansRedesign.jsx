import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle } from "react";
import { useLocation, useParams, useNavigate, Navigate, Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Input, Select, EmptyState } from "../../ui/primitives";
import { Plus, X, ClipboardList, Calendar as CalendarIcon, FileText, FlaskConical, FileSignature, Receipt, Stethoscope, Activity } from "lucide-react";
import { api } from "../../api";
import { fmtUtcDateTime } from "../../utils/dates";
import DentalChart from "./treatment/DentalChart";
import BodyChart from "./treatment/BodyChart";
import AllergyBanner, { matchAllergies } from "./treatment/AllergyBanner";

// ── Shared constants ─────────────────────────────────────────────────

const PLAN_STATUS_TONES = {
  draft: "default",
  active: "warning",
  on_hold: "default",
  completed: "success",
  discontinued: "danger",
  invoiced: "success",
};

const PLAN_STATUS_LABELS = {
  draft: "Draft",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  discontinued: "Discontinued",
  invoiced: "Invoiced",
};

const CONDITION_OPTIONS = [
  "healthy", "caries", "restoration", "extraction", "crown",
  "root_canal", "missing", "implant", "mobility", "plaque", "gingivitis", "custom",
];

// ── Root page ────────────────────────────────────────────────────────

export default function TreatmentPlansRedesign() {
  const { isAuthenticated, hasPerm } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags();
  const location = useLocation();
  const { planId } = useParams();

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!hasPerm("manage_treatment_plans")) return <Navigate to="/access-denied" replace />;
  if (flagsLoading) return null;
  if (!flags.phase4_treatment_plans) return <Navigate to="/dashboard" replace />;

  // Tab dispatch
  const path = location.pathname;
  const tab =
    path.includes("/treatment-plans/templates") ? "templates" :
    path.includes("/treatment-plans/labs") ? "labs" :
    path.includes("/treatment-plans/calendar") ? "calendar" :
    path.includes("/treatment-plans/chart/") ? "chart" :
    planId ? "detail" :
    "list";

  return (
    <PageShell
      title="Treatment Plans"
      subtitle="Multi-visit clinical plans — sessions, charting, prescriptions, lab orders"
      right={<TabNav currentTab={tab} />}
    >
      {tab === "list" && <PlanListTab />}
      {tab === "detail" && <PlanDetailView planId={planId} />}
      {tab === "calendar" && <CalendarTab />}
      {tab === "labs" && <LabsTab />}
      {tab === "templates" && <TemplatesTab />}
      {tab === "chart" && <PlanDetailView planId={planId} initialInnerTab="chart" />}
    </PageShell>
  );
}

function TabNav({ currentTab }) {
  const tabs = [
    ["list", "Plans", "/treatment-plans/active"],
    ["calendar", "Calendar", "/treatment-plans/calendar"],
    ["labs", "Lab Orders", "/treatment-plans/labs"],
    ["templates", "Templates", "/treatment-plans/templates"],
  ];
  return (
    <div className="flex gap-1">
      {tabs.map(([key, label, path]) => (
        <Link key={key} to={path}>
          <Button size="sm" tone={currentTab === key ? "primary" : "default"}>
            {label}
          </Button>
        </Link>
      ))}
    </div>
  );
}

// ── Plan list tab ────────────────────────────────────────────────────

function PlanListTab() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (search) params.search = search;
      const res = await api.get("/api/treatment-plans", params);
      setPlans(res.plans || []);
    } catch (err) {
      toast.error(err.message || "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }, [filterStatus, search, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <SectionCard>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-(--ui-text-muted) mb-1">Status</label>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              {Object.entries(PLAN_STATUS_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </div>
          <div className="grow">
            <label className="block text-xs text-(--ui-text-muted) mb-1">Search</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Plan number or title…"
            />
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4 mr-1 inline" /> New Plan
          </Button>
        </div>
      </SectionCard>

      <SectionCard>
        {loading ? (
          <div className="py-6 text-center text-(--ui-text-muted)">Loading…</div>
        ) : plans.length === 0 ? (
          <EmptyState
            title="No treatment plans yet"
            body="Create your first plan for a patient — it'll track multiple sessions, charting, prescriptions, and the folio."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-(--ui-text-muted) border-b">
                <th className="py-2">Plan #</th>
                <th>Title</th>
                <th>Patient</th>
                <th>Subject</th>
                <th>Provider</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Start</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b hover:bg-(--ui-muted-surface)">
                  <td className="py-2 font-mono text-xs">{p.plan_number}</td>
                  <td className="max-w-[260px] truncate">{p.title}</td>
                  <td>{p.customer_name || "—"}</td>
                  <td>{p.subject_name || "—"}</td>
                  <td>{p.provider_name || "—"}</td>
                  <td>{p.sessions_completed || 0} / {p.total_sessions_planned}</td>
                  <td>
                    <Badge tone={PLAN_STATUS_TONES[p.status]}>
                      {PLAN_STATUS_LABELS[p.status] || p.status}
                    </Badge>
                  </td>
                  <td className="text-xs text-(--ui-text-muted)">{p.start_date || "—"}</td>
                  <td>
                    <Link to={`/treatment-plans/${p.id}`}>
                      <Button size="sm">Open</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {showCreate && <CreatePlanModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); load(); }} />}
    </div>
  );
}

// ── Create plan modal ────────────────────────────────────────────────

function CreatePlanModal({ onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [form, setForm] = useState({
    customer_id: "",
    subject_id: "",
    provider_id: "",
    title: "",
    diagnosis_code: "",
    diagnosis_notes: "",
    start_date: "",
    expected_end_date: "",
    total_sessions_planned: 1,
    estimated_total: 0,
    deposit_collected: 0,
    deposit_method: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    Promise.all([
      api.get("/api/customers").catch(() => ({ customers: [] })),
      api.get("/api/employees").catch(() => ({ employees: [] })),
    ]).then(([c, e]) => {
      setCustomers(c.customers || c || []);
      setEmployees(e.employees || e || []);
    });
  }, []);

  useEffect(() => {
    if (!form.customer_id) { setSubjects([]); return; }
    api.get("/api/patient-subjects", { customer_id: form.customer_id })
      .then((r) => setSubjects(r.subjects || []))
      .catch(() => setSubjects([]));
  }, [form.customer_id]);

  const handleSubmit = async () => {
    if (!form.customer_id || !form.title) {
      toast.error("Patient and title are required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...form,
        customer_id: Number(form.customer_id),
        subject_id: form.subject_id ? Number(form.subject_id) : null,
        provider_id: form.provider_id ? Number(form.provider_id) : null,
        total_sessions_planned: Number(form.total_sessions_planned) || 1,
        estimated_total: Number(form.estimated_total) || 0,
        deposit_collected: Number(form.deposit_collected) || 0,
      };
      await api.post("/api/treatment-plans", body);
      toast.success("Plan created");
      onCreated();
    } catch (err) {
      toast.error(err.message || "Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title="Create Treatment Plan" onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Patient *">
          <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value, subject_id: "" })}>
            <option value="">Select patient…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Subject (pet / dependent)">
          <Select value={form.subject_id} onChange={(e) => setForm({ ...form, subject_id: e.target.value })} disabled={!form.customer_id}>
            <option value="">—</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.subject_type})</option>)}
          </Select>
        </Field>
        <Field label="Provider">
          <Select value={form.provider_id} onChange={(e) => setForm({ ...form, provider_id: e.target.value })}>
            <option value="">—</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Diagnosis code / ICD-10">
          <Input value={form.diagnosis_code} onChange={(e) => setForm({ ...form, diagnosis_code: e.target.value })} />
        </Field>
        <Field label="Title *" full>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Root canal — upper molar" />
        </Field>
        <Field label="Diagnosis notes" full>
          <Input value={form.diagnosis_notes} onChange={(e) => setForm({ ...form, diagnosis_notes: e.target.value })} />
        </Field>
        <Field label="Start date">
          <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
        <Field label="Expected end date">
          <Input type="date" value={form.expected_end_date} onChange={(e) => setForm({ ...form, expected_end_date: e.target.value })} />
        </Field>
        <Field label="Sessions planned">
          <Input type="number" min="1" value={form.total_sessions_planned} onChange={(e) => setForm({ ...form, total_sessions_planned: e.target.value })} />
        </Field>
        <Field label="Estimated total">
          <Input type="number" min="0" value={form.estimated_total} onChange={(e) => setForm({ ...form, estimated_total: e.target.value })} />
        </Field>
        <Field label="Deposit collected">
          <Input type="number" min="0" value={form.deposit_collected} onChange={(e) => setForm({ ...form, deposit_collected: e.target.value })} />
        </Field>
        <Field label="Deposit method">
          <Input value={form.deposit_method} onChange={(e) => setForm({ ...form, deposit_method: e.target.value })} placeholder="Cash / Card" />
        </Field>
        <Field label="Notes" full>
          <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving}>{saving ? "Saving…" : "Create Plan"}</Button>
      </div>
    </ModalShell>
  );
}

// ── Plan detail view ─────────────────────────────────────────────────

function PlanDetailView({ planId, initialInnerTab = "overview" }) {
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [innerTab, setInnerTab] = useState(initialInnerTab);
  const [completingSession, setCompletingSession] = useState(null);
  const [chartEntries, setChartEntries] = useState([]);
  const [chartAreas, setChartAreas] = useState([]);
  const [subject, setSubject] = useState(null); // V05 — safety banner + vaccine card
  const { flags } = useFeatureFlags();
  const toast = useToast();
  const { fmt } = useCurrency();
  const navigate = useNavigate();

  const load = useCallback(async () => {
    if (!planId) return;
    setLoading(true);
    try {
      const data = await api.get(`/api/treatment-plans/${planId}`);
      setPlan(data);
    } catch (err) {
      toast.error(err.message || "Failed to load plan");
    } finally {
      setLoading(false);
    }
  }, [planId, toast]);

  const loadChart = useCallback(async () => {
    if (!planId) return;
    try {
      const res = await api.get(`/api/treatment-plans/${planId}/chart`);
      setChartEntries(res.entries || []);
    } catch { /* ignore */ }
  }, [planId]);

  // Load chart areas based on preset (we just load all three — preset selection is a later refinement)
  useEffect(() => {
    // Default to dental_adult; user/preset could override
    api.get("/api/chart-areas", { preset: "dental_adult" })
      .then((r) => setChartAreas(r.areas || []))
      .catch(() => setChartAreas([]));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (innerTab === "chart") loadChart(); }, [innerTab, loadChart]);

  // V05 — resolve the plan's subject for the allergy banner + vaccine card.
  useEffect(() => {
    if (!plan?.subject_id || !plan?.customer_id) { setSubject(null); return; }
    api.get("/api/patient-subjects", { customer_id: plan.customer_id })
      .then((r) => setSubject((r.subjects || []).find((s) => s.id === plan.subject_id) || null))
      .catch(() => setSubject(null));
  }, [plan?.subject_id, plan?.customer_id]);

  const handleStatusTransition = async (action) => {
    try {
      await api.post(`/api/treatment-plans/${planId}/${action}`, {});
      toast.success(`Plan ${action}d`);
      load();
    } catch (err) {
      toast.error(err.message || "Action failed");
    }
  };

  const handleAddChartEntry = async (sessionId, areaCode, conditionCode, severity, notes) => {
    try {
      await api.post(`/api/treatment-sessions/${sessionId}/chart-entries`, {
        area_code: areaCode,
        condition_code: conditionCode,
        severity: severity || null,
        notes: notes || null,
      });
      toast.success("Chart entry saved");
      loadChart();
    } catch (err) {
      toast.error(err.message || "Failed to save chart entry");
    }
  };

  if (loading) return <div className="py-10 text-center text-(--ui-text-muted)">Loading plan…</div>;
  if (!plan) return <EmptyState title="Plan not found" />;

  const innerTabs = [
    ["overview", "Overview", ClipboardList],
    ["sessions", "Sessions", CalendarIcon],
    ["chart", "Chart", Stethoscope],
    ["labs", "Lab Orders", FlaskConical],
    ["consent", "Consent", FileSignature],
    ["documents", "Documents", FileText],
    ["folio", "Folio", Receipt],
  ];

  return (
    <div className="space-y-4">
      <AllergyBanner subject={subject} />
      <SectionCard>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">{plan.title}</h2>
              <Badge tone={PLAN_STATUS_TONES[plan.status]}>{PLAN_STATUS_LABELS[plan.status]}</Badge>
            </div>
            <div className="text-sm text-(--ui-text-muted) mt-1">
              <span className="font-mono">{plan.plan_number}</span> · {plan.customer_name}
              {plan.subject_name && <> · <em>{plan.subject_name}</em></>}
              {plan.provider_name && <> · Dr. {plan.provider_name}</>}
              {flags.vet_vaccinations && plan.subject_id && (
                <> · <Link to={`/vaccination-card/${plan.subject_id}`} className="text-(--ui-link) hover:underline">Vaccination card</Link></>
              )}
            </div>
            <div className="text-xs text-(--ui-text-muted) mt-1">
              Progress: {plan.sessions_completed || 0} / {plan.total_sessions_planned} sessions ({plan.progress_pct || 0}%)
            </div>
          </div>
          <div className="flex gap-1">
            {plan.status === "draft" && (
              <Button size="sm" onClick={() => handleStatusTransition("activate")}>Activate</Button>
            )}
            {plan.status === "active" && (
              <>
                <Button size="sm" tone="plain" onClick={() => handleStatusTransition("hold")}>Hold</Button>
                <Button size="sm" onClick={() => handleStatusTransition("complete")}>Complete</Button>
              </>
            )}
            {plan.status === "on_hold" && (
              <Button size="sm" onClick={() => handleStatusTransition("resume")}>Resume</Button>
            )}
            {["draft", "active", "on_hold"].includes(plan.status) && (
              <Button size="sm" tone="danger" onClick={() => handleStatusTransition("discontinue")}>Discontinue</Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-4 border-t pt-3">
          {innerTabs.map(([key, label, Icon]) => (
            <Button key={key} size="sm" tone={innerTab === key ? "primary" : "plain"} onClick={() => setInnerTab(key)}>
              <Icon className="w-3.5 h-3.5 mr-1 inline" /> {label}
            </Button>
          ))}
        </div>
      </SectionCard>

      {innerTab === "overview" && <OverviewPanel plan={plan} fmt={fmt} />}
      {innerTab === "sessions" && (
        <SessionsPanel
          plan={plan}
          onReload={load}
          onCompleteClick={setCompletingSession}
        />
      )}
      {innerTab === "chart" && (
        <ChartPanel
          plan={plan}
          entries={chartEntries}
          onAddEntry={handleAddChartEntry}
        />
      )}
      {innerTab === "labs" && <LabOrdersPanel planId={planId} orders={plan.lab_orders || []} onReload={load} />}
      {innerTab === "consent" && <ConsentPanel planId={planId} consents={plan.consents || []} onReload={load} />}
      {innerTab === "documents" && <DocumentsPanel planId={planId} documents={plan.documents || []} onReload={load} />}
      {innerTab === "folio" && <FolioPanel plan={plan} onReload={load} fmt={fmt} />}

      {completingSession && (
        <SessionCompleteModal
          session={completingSession}
          chartAreas={chartAreas}
          subject={subject}
          onClose={() => setCompletingSession(null)}
          onCompleted={() => { setCompletingSession(null); load(); }}
        />
      )}
    </div>
  );
}

function OverviewPanel({ plan, fmt }) {
  return (
    <SectionCard>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
        <Info label="Status" value={PLAN_STATUS_LABELS[plan.status]} />
        <Info label="Sessions" value={`${plan.sessions_completed || 0} / ${plan.total_sessions_planned}`} />
        <Info label="Start date" value={plan.start_date || "—"} />
        <Info label="Expected end" value={plan.expected_end_date || "—"} />
        <Info label="Estimated total" value={fmt(plan.estimated_total)} />
        <Info label="Deposit collected" value={fmt(plan.deposit_collected)} />
        <Info label="Deposit status" value={plan.deposit_status || "—"} />
        <Info label="Provider" value={plan.provider_name || "—"} />
        <Info label="Diagnosis" value={plan.diagnosis_code || "—"} />
        <Info label="Notes" value={plan.notes || plan.diagnosis_notes || "—"} />
      </dl>
      {(plan.activities || []).length > 0 && (
        <div className="mt-5 pt-4 border-t">
          <h4 className="text-sm font-semibold mb-2">Activity</h4>
          <ul className="text-xs text-(--ui-text-muted) space-y-1 max-h-60 overflow-auto">
            {plan.activities.map((a) => (
              <li key={a.id}>
                <span className="font-mono text-(--ui-text-muted) mr-2">{fmtUtcDateTime(a.created_at)}</span>
                [{a.activity_type}] {a.description}
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function Info({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-(--ui-text-muted)">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

// ── Sessions panel ───────────────────────────────────────────────────

function SessionsPanel({ plan, onReload, onCompleteClick }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ scheduled_at: "", chief_complaint: "", create_appointment: true });
  const toast = useToast();

  const addSession = async () => {
    try {
      await api.post(`/api/treatment-plans/${plan.id}/sessions`, form);
      toast.success("Session added");
      setAdding(false);
      setForm({ scheduled_at: "", chief_complaint: "", create_appointment: true });
      onReload();
    } catch (err) {
      toast.error(err.message || "Failed to add session");
    }
  };

  const startSession = async (id) => {
    try {
      await api.post(`/api/treatment-sessions/${id}/start`, {});
      onReload();
    } catch (err) {
      toast.error(err.message || "Failed to start");
    }
  };

  const sessions = plan.sessions || [];

  return (
    <SectionCard>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Sessions ({sessions.length})</h3>
        <Button size="sm" onClick={() => setAdding(!adding)}>
          <Plus className="w-4 h-4 mr-1 inline" /> Add Session
        </Button>
      </div>
      {adding && (
        <div className="bg-(--ui-muted-surface) rounded p-3 mb-3 grid grid-cols-3 gap-2 items-end">
          <Field label="Scheduled at">
            <Input type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </Field>
          <Field label="Chief complaint" full>
            <Input value={form.chief_complaint} onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })} />
          </Field>
          <div className="col-span-3 flex gap-2 justify-end">
            <Button size="sm" tone="plain" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={addSession}>Save</Button>
          </div>
        </div>
      )}
      {sessions.length === 0 ? (
        <div className="text-sm text-(--ui-text-muted) py-4 text-center">No sessions scheduled yet</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-(--ui-text-muted) border-b">
              <th className="py-2">#</th>
              <th>When</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Complaint</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id} className="border-b hover:bg-(--ui-muted-surface)">
                <td className="py-2 font-mono">{s.session_number}</td>
                <td className="text-xs">{s.scheduled_at ? fmtUtcDateTime(s.scheduled_at) : "—"}</td>
                <td className="text-xs">{s.provider_name || "—"}</td>
                <td>
                  <Badge tone={s.status === "completed" ? "success" : s.status === "no_show" ? "danger" : "default"}>
                    {s.status}
                  </Badge>
                </td>
                <td className="text-xs max-w-[300px] truncate">{s.chief_complaint || "—"}</td>
                <td>
                  {s.status === "scheduled" && (
                    <Button size="sm" onClick={() => startSession(s.id)}>Start</Button>
                  )}
                  {(s.status === "in_progress" || s.status === "scheduled") && (
                    <Button size="sm" onClick={() => onCompleteClick(s)}>Complete</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ── Session complete modal ───────────────────────────────────────────

function SessionCompleteModal({ session, chartAreas, subject, onClose, onCompleted }) {
  const [soap, setSoap] = useState({ subjective: "", objective: "", assessment: "", plan: "" });
  const [vitals, setVitals] = useState({
    blood_pressure_sys: "", blood_pressure_dia: "", heart_rate: "", temperature_c: "", pain_score: "",
  });
  const [rxList, setRxList] = useState([]);
  const [chartEntries, setChartEntries] = useState([]);
  const [sessionFee, setSessionFee] = useState(0);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const addRx = () => setRxList([...rxList, { medication_name: "", strength: "", dosage: "", frequency: "", duration: "" }]);
  const updateRx = (i, f, v) => setRxList(rxList.map((rx, idx) => idx === i ? { ...rx, [f]: v } : rx));
  const removeRx = (i) => setRxList(rxList.filter((_, idx) => idx !== i));

  const addEntry = () => setChartEntries([...chartEntries, { area_code: "", condition_code: "healthy", severity: "", notes: "" }]);
  const updateEntry = (i, f, v) => setChartEntries(chartEntries.map((e, idx) => idx === i ? { ...e, [f]: v } : e));
  const removeEntry = (i) => setChartEntries(chartEntries.filter((_, idx) => idx !== i));

  const submit = async () => {
    setSaving(true);
    try {
      const payload = {
        soap_subjective: soap.subjective || null,
        soap_objective: soap.objective || null,
        soap_assessment: soap.assessment || null,
        soap_plan: soap.plan || null,
        session_fee: Number(sessionFee) || 0,
        vitals: Object.values(vitals).some((v) => v !== "") ? [{
          blood_pressure_sys: vitals.blood_pressure_sys ? Number(vitals.blood_pressure_sys) : null,
          blood_pressure_dia: vitals.blood_pressure_dia ? Number(vitals.blood_pressure_dia) : null,
          heart_rate: vitals.heart_rate ? Number(vitals.heart_rate) : null,
          temperature_c: vitals.temperature_c ? Number(vitals.temperature_c) : null,
          pain_score: vitals.pain_score !== "" ? Number(vitals.pain_score) : null,
        }] : [],
        prescriptions: rxList.filter((rx) => rx.medication_name),
        chart_entries: chartEntries.filter((ce) => ce.area_code && ce.condition_code),
      };
      const res = await api.post(`/api/treatment-sessions/${session.id}/complete`, payload);
      // V05 — server-side name-match allergy backstop (advisory, never a block)
      if (res?.allergy_warnings?.length) {
        for (const w of res.allergy_warnings) {
          toast.warning(`⚠ ${w.medication_name} name-matches recorded allergy: ${w.matched_allergies.join(", ")}`);
        }
      }
      toast.success("Session completed");
      onCompleted();
    } catch (err) {
      toast.error(err.message || "Failed to complete session");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Complete Session #${session.session_number}`} onClose={onClose} width="max-w-3xl">
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold mb-2">SOAP Notes</h4>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Subjective" full>
              <Input value={soap.subjective} onChange={(e) => setSoap({ ...soap, subjective: e.target.value })} placeholder="Patient reports…" />
            </Field>
            <Field label="Objective" full>
              <Input value={soap.objective} onChange={(e) => setSoap({ ...soap, objective: e.target.value })} placeholder="Exam findings…" />
            </Field>
            <Field label="Assessment" full>
              <Input value={soap.assessment} onChange={(e) => setSoap({ ...soap, assessment: e.target.value })} placeholder="Diagnosis / impression…" />
            </Field>
            <Field label="Plan" full>
              <Input value={soap.plan} onChange={(e) => setSoap({ ...soap, plan: e.target.value })} placeholder="Treatment plan…" />
            </Field>
          </div>
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2">Vital Signs (optional)</h4>
          <div className="grid grid-cols-5 gap-2">
            <Field label="BP Sys">
              <Input type="number" value={vitals.blood_pressure_sys} onChange={(e) => setVitals({ ...vitals, blood_pressure_sys: e.target.value })} />
            </Field>
            <Field label="BP Dia">
              <Input type="number" value={vitals.blood_pressure_dia} onChange={(e) => setVitals({ ...vitals, blood_pressure_dia: e.target.value })} />
            </Field>
            <Field label="HR">
              <Input type="number" value={vitals.heart_rate} onChange={(e) => setVitals({ ...vitals, heart_rate: e.target.value })} />
            </Field>
            <Field label="Temp °C">
              <Input type="number" step="0.1" value={vitals.temperature_c} onChange={(e) => setVitals({ ...vitals, temperature_c: e.target.value })} />
            </Field>
            <Field label="Pain 0-10">
              <Input type="number" min="0" max="10" value={vitals.pain_score} onChange={(e) => setVitals({ ...vitals, pain_score: e.target.value })} />
            </Field>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-semibold">Prescriptions ({rxList.length})</h4>
            <Button size="sm" onClick={addRx}><Plus className="w-3 h-3 inline" /> Add</Button>
          </div>
          {rxList.length > 0 && <div className="mb-2"><AllergyBanner subject={subject} compact /></div>}
          {rxList.map((rx, i) => {
            const hits = matchAllergies(subject, rx.medication_name);
            return (
              <div key={i} className="mb-1">
                <div className="grid grid-cols-6 gap-1 text-xs items-center">
                  <Input className="col-span-2" placeholder="Medication" value={rx.medication_name} onChange={(e) => updateRx(i, "medication_name", e.target.value)} />
                  <Input placeholder="Strength" value={rx.strength} onChange={(e) => updateRx(i, "strength", e.target.value)} />
                  <Input placeholder="Dosage" value={rx.dosage} onChange={(e) => updateRx(i, "dosage", e.target.value)} />
                  <Input placeholder="Frequency" value={rx.frequency} onChange={(e) => updateRx(i, "frequency", e.target.value)} />
                  <div className="flex gap-1">
                    <Input placeholder="Duration" value={rx.duration} onChange={(e) => updateRx(i, "duration", e.target.value)} />
                    <Button size="sm" tone="plain" onClick={() => removeRx(i)}><X className="w-3 h-3" /></Button>
                  </div>
                </div>
                {hits.length > 0 && (
                  <div className="text-[11px] text-(--ui-danger) mt-0.5">
                    ⚠ Name-matches recorded allergy: {hits.join(", ")} (name-match check only)
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-sm font-semibold">Chart Entries ({chartEntries.length})</h4>
            <Button size="sm" onClick={addEntry}><Plus className="w-3 h-3 inline" /> Add</Button>
          </div>
          {chartEntries.map((ce, i) => (
            <div key={i} className="grid grid-cols-5 gap-1 mb-1 text-xs items-center">
              <Input placeholder="Area (e.g. 16, K, shoulder_left)" value={ce.area_code} onChange={(e) => updateEntry(i, "area_code", e.target.value)} />
              <Select value={ce.condition_code} onChange={(e) => updateEntry(i, "condition_code", e.target.value)}>
                {CONDITION_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
              <Select value={ce.severity} onChange={(e) => updateEntry(i, "severity", e.target.value)}>
                <option value="">—</option>
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </Select>
              <Input placeholder="Notes" value={ce.notes} onChange={(e) => updateEntry(i, "notes", e.target.value)} />
              <Button size="sm" tone="plain" onClick={() => removeEntry(i)}><X className="w-3 h-3" /></Button>
            </div>
          ))}
        </div>

        <div className="flex items-end gap-3">
          <Field label="Session fee (adds to folio)">
            <Input type="number" min="0" value={sessionFee} onChange={(e) => setSessionFee(e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t">
          <Button tone="plain" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Complete Session"}</Button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Chart panel ──────────────────────────────────────────────────────

function ChartPanel({ plan, entries }) {
  const [preset, setPreset] = useState("dental_adult");
  const [bodyAreas, setBodyAreas] = useState([]);

  useEffect(() => {
    if (preset === "body" || preset === "vet_body_canine" || preset === "vet_body_feline") {
      api.get("/api/chart-areas", { preset })
        .then((r) => setBodyAreas(r.areas || []))
        .catch(() => setBodyAreas([]));
    }
  }, [preset]);

  return (
    <SectionCard>
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold">Chart — {plan.customer_name}</h3>
        <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="dental_adult">Dental (Adult)</option>
          <option value="dental_primary">Dental (Primary)</option>
          <option value="body">Body (Physio)</option>
          <option value="vet_body_canine">Vet (Canine)</option>
          <option value="vet_body_feline">Vet (Feline)</option>
        </Select>
      </div>
      {(preset === "dental_adult" || preset === "dental_primary") ? (
        <DentalChart preset={preset} entries={entries} />
      ) : (
        <BodyChart preset={preset} areas={bodyAreas} entries={entries} />
      )}
      <div className="text-xs text-(--ui-text-muted) mt-3">
        Click a region to view details. Entries are added when completing a session.
      </div>
    </SectionCard>
  );
}

// ── Lab orders ───────────────────────────────────────────────────────

function LabOrdersPanel({ planId, orders, onReload }) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ test_name: "", lab_vendor: "", test_code: "", cost: 0 });
  const toast = useToast();

  const add = async () => {
    try {
      await api.post(`/api/treatment-plans/${planId}/lab-orders`, {
        ...form,
        cost: Number(form.cost) || 0,
      });
      toast.success("Lab ordered");
      setAdding(false);
      setForm({ test_name: "", lab_vendor: "", test_code: "", cost: 0 });
      onReload();
    } catch (err) {
      toast.error(err.message || "Failed to create lab order");
    }
  };

  const toggleShare = async (o) => {
    try {
      await api.put(`/api/lab-orders/${o.id}`, { shared_with_patient: !o.shared_with_patient });
      onReload();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <SectionCard>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Lab Orders</h3>
        <Button size="sm" onClick={() => setAdding(!adding)}><Plus className="w-3 h-3 inline" /> Add Order</Button>
      </div>
      {adding && (
        <div className="bg-(--ui-muted-surface) rounded p-3 mb-3 grid grid-cols-4 gap-2 items-end">
          <Field label="Test name *"><Input value={form.test_name} onChange={(e) => setForm({ ...form, test_name: e.target.value })} /></Field>
          <Field label="Lab vendor"><Input value={form.lab_vendor} onChange={(e) => setForm({ ...form, lab_vendor: e.target.value })} /></Field>
          <Field label="Test code"><Input value={form.test_code} onChange={(e) => setForm({ ...form, test_code: e.target.value })} /></Field>
          <Field label="Cost"><Input type="number" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /></Field>
          <div className="col-span-4 flex gap-2 justify-end">
            <Button size="sm" tone="plain" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" onClick={add}>Save</Button>
          </div>
        </div>
      )}
      {orders.length === 0 ? (
        <div className="text-sm text-(--ui-text-muted) py-4 text-center">No lab orders</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-(--ui-text-muted)">
              <th className="py-2">Order #</th>
              <th>Test</th>
              <th>Vendor</th>
              <th>Status</th>
              <th>Cost</th>
              <th>Shared w/ patient</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="py-2 font-mono text-xs">{o.order_number}</td>
                <td>{o.test_name}</td>
                <td>{o.lab_vendor || "—"}</td>
                <td><Badge tone={o.status === "completed" ? "success" : "default"}>{o.status}</Badge></td>
                <td>{o.cost}</td>
                <td>
                  <input type="checkbox" checked={!!o.shared_with_patient} onChange={() => toggleShare(o)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ── Consent panel ────────────────────────────────────────────────────

// Native signature pad — intentionally dependency-free. Pointer events cover
// mouse, touch, and stylus. Exposes `toDataURL()` + `clear()` + `isEmpty()`
// via the forwarded ref so the parent can read/reset the drawn signature.
const SignaturePad = forwardRef(function SignaturePad({ height = 150 }, ref) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasStrokeRef = useRef(false);

  useImperativeHandle(ref, () => ({
    isEmpty: () => !hasStrokeRef.current,
    clear: () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      hasStrokeRef.current = false;
    },
    toDataURL: () => canvasRef.current?.toDataURL("image/png") || null,
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Match canvas backing resolution to CSS size so strokes aren't blurred.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext("2d");
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.strokeStyle = "#0f172a";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e) => {
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
    hasStrokeRef.current = true;
  };
  const onMove = (e) => {
    if (!drawingRef.current) return;
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const onUp = () => {
    drawingRef.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={onUp}
      style={{ touchAction: "none", height, width: "100%" }}
      className="rounded border border-(--ui-border) bg-(--ui-surface)"
    />
  );
});

function ConsentPanel({ planId, consents, onReload }) {
  const [templates, setTemplates] = useState([]);
  const [signing, setSigning] = useState(null);
  const [form, setForm] = useState({ signed_by_name: "", signed_by_relation: "self" });
  const sigRef = useRef(null);
  const toast = useToast();

  useEffect(() => {
    api.get("/api/consent-templates").then((r) => setTemplates(r.templates || [])).catch(() => {});
  }, []);

  const sign = async () => {
    if (!signing || !form.signed_by_name) {
      toast.error("Patient name required");
      return;
    }
    // Require a drawn signature — typed-name-only is weaker evidence for
    // clinical consent. Backend (treatment-plans.js:304) already handles
    // the image_base64 → R2 upload when present.
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("Please draw your signature");
      return;
    }
    const signatureDataUrl = sigRef.current.toDataURL();
    // Strip the `data:image/png;base64,` prefix — backend expects raw base64.
    const signature_image_base64 = signatureDataUrl?.split(",")[1] || null;
    try {
      await api.post(`/api/treatment-plans/${planId}/consents`, {
        form_template_key: signing.key,
        title: signing.title,
        body_markdown: signing.body,
        signed_by_name: form.signed_by_name,
        signed_by_relation: form.signed_by_relation,
        signature_image_base64,
      });
      toast.success("Consent recorded");
      setSigning(null);
      setForm({ signed_by_name: "", signed_by_relation: "self" });
      sigRef.current?.clear();
      onReload();
    } catch (err) {
      toast.error(err.message || "Failed to record consent");
    }
  };

  return (
    <SectionCard>
      <h3 className="font-semibold mb-3">Consent Forms</h3>
      <div className="mb-4">
        <div className="text-xs text-(--ui-text-muted) mb-1">Available templates:</div>
        <div className="flex flex-wrap gap-1">
          {templates.map((t) => (
            <Button key={t.key} size="sm" tone="plain" onClick={() => setSigning(t)}>
              {t.title}
            </Button>
          ))}
        </div>
      </div>
      {signing && (
        <div className="bg-(--ui-muted-surface) rounded p-3 mb-4">
          <h4 className="font-medium mb-2">{signing.title}</h4>
          <div className="text-xs text-(--ui-text) whitespace-pre-wrap mb-3 max-h-32 overflow-auto border border-(--ui-border) bg-(--ui-surface) p-2 rounded">
            {signing.body}
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <Field label="Signed by *">
              <Input value={form.signed_by_name} onChange={(e) => setForm({ ...form, signed_by_name: e.target.value })} />
            </Field>
            <Field label="Relation">
              <Select value={form.signed_by_relation} onChange={(e) => setForm({ ...form, signed_by_relation: e.target.value })}>
                <option value="self">Self</option>
                <option value="parent">Parent</option>
                <option value="guardian">Guardian</option>
                <option value="owner">Owner</option>
                <option value="next_of_kin">Next of Kin</option>
              </Select>
            </Field>
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-(--ui-text-muted)">Signature *</label>
                <button
                  type="button"
                  className="text-xs text-(--ui-text-muted) hover:text-(--ui-text)"
                  onClick={() => sigRef.current?.clear()}
                >
                  Clear
                </button>
              </div>
              <SignaturePad ref={sigRef} height={140} />
            </div>
            <div className="col-span-2 flex gap-2 justify-end">
              <Button tone="plain" size="sm" onClick={() => setSigning(null)}>Cancel</Button>
              <Button size="sm" onClick={sign}>Record Consent</Button>
            </div>
          </div>
        </div>
      )}
      {consents.length === 0 ? (
        <div className="text-sm text-(--ui-text-muted) py-4 text-center">No signed consents</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-(--ui-text-muted)">
              <th className="py-2">Form</th>
              <th>Signed by</th>
              <th>Relation</th>
              <th>Signed at</th>
            </tr>
          </thead>
          <tbody>
            {consents.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-2">{c.title}</td>
                <td>{c.signed_by_name}</td>
                <td>{c.signed_by_relation}</td>
                <td className="text-xs">{fmtUtcDateTime(c.signed_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ── Documents panel ──────────────────────────────────────────────────

function DocumentsPanel({ planId, documents, onReload }) {
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("other");
  const [shared, setShared] = useState(false);
  const toast = useToast();

  const upload = async () => {
    if (!file || !title) { toast.error("File and title required"); return; }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("document_type", docType);
    fd.append("title", title);
    fd.append("shared_with_patient", shared ? "true" : "false");
    try {
      await api.upload(`/api/treatment-plans/${planId}/documents`, fd);
      toast.success("Document uploaded");
      setFile(null); setTitle(""); setShared(false);
      onReload();
    } catch (err) {
      toast.error(err.message || "Upload failed");
    }
  };

  return (
    <SectionCard>
      <h3 className="font-semibold mb-3">Clinical Documents</h3>
      <div className="bg-(--ui-muted-surface) rounded p-3 mb-4 grid grid-cols-4 gap-2 items-end">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Type">
          <Select value={docType} onChange={(e) => setDocType(e.target.value)}>
            {["lab_report","imaging_xray","imaging_ct","imaging_mri","photo","referral_letter","discharge_summary","other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="File (max 50MB)">
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <div>
          <label className="text-xs flex items-center gap-1">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with patient
          </label>
          <Button size="sm" onClick={upload} className="mt-1">Upload</Button>
        </div>
      </div>
      {documents.length === 0 ? (
        <div className="text-sm text-(--ui-text-muted) py-4 text-center">No documents</div>
      ) : (
        <ul className="divide-y">
          {documents.map((d) => (
            <li key={d.id} className="py-2 text-sm flex justify-between items-center">
              <div>
                <a href={d.file_url} target="_blank" rel="noreferrer" className="font-medium text-(--ui-link) hover:underline">{d.title}</a>
                <span className="text-xs text-(--ui-text-muted) ml-2">[{d.document_type}] {(d.file_size_bytes || 0) > 0 ? `${(d.file_size_bytes / 1024).toFixed(0)} KB` : ""}</span>
              </div>
              <Badge tone={d.shared_with_patient ? "success" : "default"}>
                {d.shared_with_patient ? "Shared" : "Internal"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ── Folio panel ──────────────────────────────────────────────────────

function FolioPanel({ plan, onReload, fmt }) {
  const folio = plan.folio;
  const [lines, setLines] = useState([]);
  const toast = useToast();

  useEffect(() => {
    if (!folio?.id) return;
    api.get(`/api/treatment-folios/${folio.id}`)
      .then((r) => setLines(r.lines || []))
      .catch(() => setLines([]));
  }, [folio?.id]);

  const settle = async () => {
    if (!folio) return;
    try {
      await api.post(`/api/treatment-folios/${folio.id}/settle`, { apply_deposit: true });
      toast.success("Folio settled — invoice generated");
      onReload();
    } catch (err) {
      toast.error(err.message || "Settlement failed");
    }
  };

  if (!folio) return <SectionCard><EmptyState title="No folio for this plan" /></SectionCard>;

  return (
    <SectionCard>
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="font-semibold">Folio</h3>
          <div className="text-xs text-(--ui-text-muted)">Status: <Badge tone={folio.status === "open" ? "warning" : "success"}>{folio.status}</Badge></div>
        </div>
        {folio.status === "open" && (
          <Button size="sm" onClick={settle}>Settle & Generate Invoice</Button>
        )}
      </div>
      <dl className="grid grid-cols-4 gap-3 text-sm mb-4 p-3 bg-(--ui-muted-surface) rounded">
        <Info label="Session charges" value={fmt(folio.session_charge_total)} />
        <Info label="POS charges" value={fmt(folio.pos_charge_total)} />
        <Info label="Tax" value={fmt(folio.tax_total)} />
        <Info label="Grand total" value={fmt(folio.grand_total)} />
      </dl>
      {lines.length === 0 ? (
        <div className="text-sm text-(--ui-text-muted) py-4 text-center">No folio lines yet</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-(--ui-text-muted)">
              <th className="py-2">Type</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b">
                <td className="py-2"><Badge>{l.line_type}</Badge></td>
                <td>{l.description}</td>
                <td>{l.quantity}</td>
                <td>{fmt(l.unit_price)}</td>
                <td className="font-medium">{fmt(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ── Calendar tab (lightweight — calendar of all sessions across plans) ──

function CalendarTab() {
  const [plans, setPlans] = useState([]);
  const toast = useToast();

  useEffect(() => {
    api.get("/api/treatment-plans", { status: "active" })
      .then((r) => setPlans(r.plans || []))
      .catch((e) => toast.error(e.message));
  }, [toast]);

  return (
    <SectionCard>
      <h3 className="font-semibold mb-3">Upcoming Sessions</h3>
      <div className="text-sm text-(--ui-text-muted)">
        Upcoming sessions are scheduled through each plan's Sessions tab and flow into the main Appointments calendar at <Link to="/appointments/calendar" className="text-(--ui-link)">/appointments/calendar</Link>.
      </div>
      <div className="mt-4 space-y-1 text-sm">
        {plans.map((p) => (
          <div key={p.id} className="flex justify-between border-b py-1">
            <span><Link to={`/treatment-plans/${p.id}`} className="text-(--ui-link)">{p.plan_number}</Link> — {p.customer_name}</span>
            <span className="text-(--ui-text-muted)">{p.sessions_completed}/{p.total_sessions_planned}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ── Labs tab (cross-plan lab orders) ─────────────────────────────────

function LabsTab() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => {
    // Cross-plan list via listPlans + per-plan fetch — no dedicated endpoint in v1.
    api.get("/api/treatment-plans")
      .then(async (r) => {
        const plans = r.plans || [];
        const all = [];
        for (const p of plans) {
          try {
            const res = await api.get(`/api/treatment-plans/${p.id}/lab-orders`);
            for (const o of res.lab_orders || []) {
              all.push({ ...o, plan_number: p.plan_number, customer_name: p.customer_name });
            }
          } catch { /* continue */ }
        }
        setOrders(all);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [toast]);

  return (
    <SectionCard>
      <h3 className="font-semibold mb-3">All Lab Orders</h3>
      {loading ? (
        <div className="text-sm text-(--ui-text-muted) py-4 text-center">Loading…</div>
      ) : orders.length === 0 ? (
        <EmptyState title="No lab orders" body="Lab orders are created inside individual treatment plans." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b text-(--ui-text-muted)">
              <th className="py-2">Order #</th>
              <th>Plan</th>
              <th>Patient</th>
              <th>Test</th>
              <th>Status</th>
              <th>Ordered</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b">
                <td className="py-2 font-mono text-xs">{o.order_number}</td>
                <td className="font-mono text-xs">{o.plan_number}</td>
                <td>{o.customer_name}</td>
                <td>{o.test_name}</td>
                <td><Badge tone={o.status === "completed" ? "success" : "default"}>{o.status}</Badge></td>
                <td className="text-xs">{fmtUtcDateTime(o.ordered_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </SectionCard>
  );
}

// ── Templates tab (A7) ───────────────────────────────────────────────

function TemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(null); // null | "new" | template row
  const [showCloneFor, setShowCloneFor] = useState(null); // template row
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/api/treatment-plan-templates");
      setTemplates(res.templates || []);
    } catch (err) {
      toast.error(err.message || "Failed to load templates");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const archive = async (tpl) => {
    if (!confirm(`Archive "${tpl.name}"? Past plans referencing it are unaffected.`)) return;
    try {
      await api.del(`/api/treatment-plan-templates/${tpl.id}`);
      toast.success("Template archived");
      load();
    } catch (err) {
      toast.error(err.message || "Failed to archive");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-sm text-(--ui-text-muted)">
            Save commonly-used plan structures as templates — create new plans for patients with one click.
          </p>
        </div>
        <Button onClick={() => setShowForm("new")}><Plus className="w-4 h-4 mr-1 inline" /> New Template</Button>
      </div>

      <SectionCard>
        {loading ? (
          <div className="p-6 text-center text-(--ui-text-muted)">Loading…</div>
        ) : templates.length === 0 ? (
          <EmptyState
            title="No templates yet"
            body="Save a template to streamline creating recurring plans like standard root-canal or physiotherapy programs."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-(--ui-text-muted)">
                <th className="py-2 px-3">Name</th>
                <th>Title</th>
                <th>Sessions</th>
                <th>Est. Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b hover:bg-(--ui-muted-surface)">
                  <td className="py-2 px-3 font-medium">
                    {t.name}
                    {t.is_archived && <Badge tone="default">archived</Badge>}
                  </td>
                  <td>{t.default_title || "—"}</td>
                  <td>{t.default_sessions_planned}</td>
                  <td>{Number(t.default_estimated_total || 0)}</td>
                  <td className="text-right pr-2">
                    <Button size="sm" tone="primary" onClick={() => setShowCloneFor(t)} disabled={t.is_archived}>
                      Create Plan
                    </Button>
                    <Button size="sm" tone="plain" onClick={() => setShowForm(t)}>Edit</Button>
                    {!t.is_archived && (
                      <Button size="sm" tone="plain" onClick={() => archive(t)}>Archive</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {showForm && (
        <TemplateFormModal
          template={showForm === "new" ? null : showForm}
          onClose={() => setShowForm(null)}
          onSaved={() => { setShowForm(null); load(); }}
        />
      )}
      {showCloneFor && (
        <CloneTemplateModal
          template={showCloneFor}
          onClose={() => setShowCloneFor(null)}
          onCreated={() => { setShowCloneFor(null); load(); }}
        />
      )}
    </div>
  );
}

function TemplateFormModal({ template, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: template?.name || "",
    description: template?.description || "",
    default_title: template?.default_title || "",
    default_diagnosis_code: template?.default_diagnosis_code || "",
    default_diagnosis_notes: template?.default_diagnosis_notes || "",
    default_sessions_planned: template?.default_sessions_planned || 1,
    default_estimated_total: template?.default_estimated_total || 0,
    default_notes: template?.default_notes || "",
    // V05 — recall config + folio-tax source (copied onto plans at creation)
    recall_interval_months: template?.recall_interval_months || "",
    recall_type: template?.recall_type || "checkup",
    tax_id: template?.tax_id || "",
  });
  const [taxes, setTaxes] = useState([]);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api.get("/api/taxes").then((d) => setTaxes(d.taxes || d || [])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      const body = {
        ...form,
        // 0 clears the value server-side (NULLIF pattern) — "" means untouched
        recall_interval_months: form.recall_interval_months === "" ? (template ? 0 : null) : Number(form.recall_interval_months),
        tax_id: form.tax_id === "" ? (template ? 0 : null) : Number(form.tax_id),
      };
      if (template) {
        await api.put(`/api/treatment-plan-templates/${template.id}`, body);
        toast.success("Template updated");
      } else {
        await api.post("/api/treatment-plan-templates", body);
        toast.success("Template created");
      }
      onSaved();
    } catch (err) {
      toast.error(err.message || "Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={template ? "Edit Template" : "New Template"} onClose={onClose} width="max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Template name *" full>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Standard Root Canal" />
        </Field>
        <Field label="Description" full>
          <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>
        <Field label="Default plan title">
          <Input value={form.default_title} onChange={(e) => setForm({ ...form, default_title: e.target.value })} />
        </Field>
        <Field label="Default diagnosis code">
          <Input value={form.default_diagnosis_code} onChange={(e) => setForm({ ...form, default_diagnosis_code: e.target.value })} />
        </Field>
        <Field label="Sessions planned">
          <Input type="number" min="1" value={form.default_sessions_planned} onChange={(e) => setForm({ ...form, default_sessions_planned: e.target.value })} />
        </Field>
        <Field label="Estimated total">
          <Input type="number" min="0" value={form.default_estimated_total} onChange={(e) => setForm({ ...form, default_estimated_total: e.target.value })} />
        </Field>
        <Field label="Default diagnosis notes" full>
          <Input value={form.default_diagnosis_notes} onChange={(e) => setForm({ ...form, default_diagnosis_notes: e.target.value })} />
        </Field>
        <Field label="Default notes" full>
          <Input value={form.default_notes} onChange={(e) => setForm({ ...form, default_notes: e.target.value })} />
        </Field>
        <Field label="Recall interval (months)">
          <Input
            type="number" min="1" max="120" placeholder="e.g. 6 — blank = no recall"
            value={form.recall_interval_months}
            onChange={(e) => setForm({ ...form, recall_interval_months: e.target.value })}
          />
        </Field>
        <Field label="Recall type">
          <Select value={form.recall_type} onChange={(e) => setForm({ ...form, recall_type: e.target.value })}>
            <option value="checkup">Checkup</option>
            <option value="hygiene">Hygiene</option>
            <option value="follow_up">Follow-up</option>
          </Select>
        </Field>
        <Field label="Session-fee tax" full>
          <Select value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })}>
            <option value="">Untaxed</option>
            {taxes.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.rate}%)</option>)}
          </Select>
        </Field>
      </div>
      <p className="text-[11px] text-(--ui-text-muted) mt-2">
        Completing a plan or session made from this template automatically arms the recall
        — the patient appears in Recalls and gets a "time for your {form.recall_type}" reminder.
      </p>
      <div className="flex justify-end gap-2 mt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
      </div>
    </ModalShell>
  );
}

function CloneTemplateModal({ template, onClose, onCreated }) {
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ customer_id: "", subject_id: "", start_date: "" });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/customers").then((d) => setCustomers(d.customers || d || [])).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.customer_id) { toast.error("Select a patient"); return; }
    setSaving(true);
    try {
      const res = await api.post(`/api/treatment-plan-templates/${template.id}/create-plan`, form);
      toast.success(`Plan ${res.plan?.plan_number || ""} created`);
      onCreated();
      if (res.plan?.id) navigate(`/treatment-plans/${res.plan.id}`);
    } catch (err) {
      toast.error(err.message || "Failed to create plan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell title={`Create Plan from "${template.name}"`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Patient *">
          <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Select patient…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Start date">
          <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
        </Field>
        <p className="text-xs text-(--ui-text-muted)">
          This will create a new plan in draft status, pre-filled from the template. You can edit sessions, charting, and pricing afterward.
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button tone="plain" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "Creating…" : "Create Plan"}</Button>
      </div>
    </ModalShell>
  );
}

// ── Shared helpers ───────────────────────────────────────────────────

function ModalShell({ title, onClose, width = "max-w-xl", children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-(--ui-surface) rounded-lg shadow-lg w-full ${width} max-h-[90vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center border-b p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-(--ui-text-muted) hover:text-(--ui-text)"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, full }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-xs text-(--ui-text-muted) mb-1">{label}</label>
      {children}
    </div>
  );
}
