import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter, TabBar } from "../../ui/primitives";
import { Plus, Trash2, Pencil, Users, X } from "lucide-react";
import { fmtUtcDateTime } from "../../utils/dates";
import { downloadCsv } from "../../utils/csvExport";
import { api } from "../../api";

const PLAN_TYPES = [
  { value: "percentage", label: "Percentage of sale" },
  { value: "fixed_per_sale", label: "Fixed per sale" },
  { value: "fixed_per_item", label: "Fixed per item" },
  { value: "tiered", label: "Tiered" },
];

const SCOPE_TYPES = [
  { value: "all", label: "All products" },
  { value: "category", label: "Category" },
  { value: "product", label: "Product" },
  { value: "brand", label: "Brand" },
];

const STATUS_TONES = { pending: "warning", approved: "success", paid: "default", reversed: "danger" };

const emptyRule = () => ({ scope_type: "all", scope_id: null, rate: 0, min_threshold: 0, max_cap: null, priority: 0 });

export default function CommissionPlansRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [tab, setTab] = useState("plans");
  const [plans, setPlans] = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [summary, setSummary] = useState({});
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Plan form
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [planForm, setPlanForm] = useState({ name: "", description: "", type: "percentage", starts_at: "", ends_at: "", rules: [emptyRule()] });

  // Assign modal
  const [showAssignModal, setShowAssignModal] = useState(null);
  const [selectedEmployees, setSelectedEmployees] = useState([]);

  useEffect(() => {
    Promise.all([
      api.get("/api/commission-plans").catch(() => ({ plans: [] })),
      api.get("/api/commissions/earnings").catch(() => ({ earnings: [], summary: {} })),
      api.get("/api/employees").catch(() => ({ employees: [] })),
    ]).then(([p, e, emp]) => {
      setPlans(p.plans || []);
      setEarnings(e.earnings || []);
      setSummary(e.summary || {});
      setEmployees(emp.employees || []);
      setLoading(false);
    });
  }, []);

  const openCreate = () => {
    setEditingPlan(null);
    setPlanForm({ name: "", description: "", type: "percentage", starts_at: "", ends_at: "", rules: [emptyRule()] });
    setShowPlanModal(true);
  };

  const openEdit = (plan) => {
    setEditingPlan(plan);
    setPlanForm({
      name: plan.name, description: plan.description || "", type: plan.type,
      starts_at: plan.starts_at ? plan.starts_at.slice(0, 16) : "",
      ends_at: plan.ends_at ? plan.ends_at.slice(0, 16) : "",
      rules: plan.rules?.length ? plan.rules.map(r => ({ scope_type: r.scope_type, scope_id: r.scope_id, rate: Number(r.rate), min_threshold: Number(r.min_threshold || 0), max_cap: r.max_cap ? Number(r.max_cap) : null, priority: r.priority || 0 })) : [emptyRule()],
    });
    setShowPlanModal(true);
  };

  const handleSavePlan = async () => {
    if (!planForm.name.trim()) return toast.error("Name is required");
    if (!planForm.rules.some(r => r.rate > 0)) return toast.error("At least one rule with a rate is required");
    try {
      const body = { ...planForm, starts_at: planForm.starts_at || undefined, ends_at: planForm.ends_at || undefined };
      if (editingPlan) {
        const res = await api.put(`/api/commission-plans/${editingPlan.id}`, body);
        setPlans(prev => prev.map(p => p.id === editingPlan.id ? { ...res.plan, rules: planForm.rules, assigned_employees: p.assigned_employees } : p));
        toast.success("Plan updated");
      } else {
        const res = await api.post("/api/commission-plans", body);
        setPlans(prev => [...prev, { ...res.plan, rules: planForm.rules, assigned_employees: "0" }]);
        toast.success("Plan created");
      }
      setShowPlanModal(false);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this commission plan? Employees will be unassigned.")) return;
    try {
      await api.del(`/api/commission-plans/${id}`);
      setPlans(prev => prev.filter(p => p.id !== id));
      toast.success("Plan deleted");
    } catch (err) { toast.error(err.message); }
  };

  const openAssign = (plan) => {
    setShowAssignModal(plan);
    setSelectedEmployees(employees.filter(e => e.commission_plan_id === plan.id).map(e => e.id));
  };

  const handleAssign = async () => {
    try {
      await api.post(`/api/commission-plans/${showAssignModal.id}/assign`, { employee_ids: selectedEmployees });
      toast.success("Employees assigned");
      setShowAssignModal(null);
      const res = await api.get("/api/commission-plans");
      setPlans(res.plans || []);
    } catch (err) { toast.error(err.message); }
  };

  const handleEarningStatus = async (earningId, status) => {
    try {
      const res = await api.put(`/api/commissions/earnings/${earningId}/status`, { status });
      setEarnings(prev => prev.map(e => e.id === earningId ? res.earning : e));
      toast.success(`Earning ${status}`);
    } catch (err) { toast.error(err.message); }
  };

  const updateRule = (idx, key, val) => setPlanForm(f => ({ ...f, rules: f.rules.map((r, i) => i === idx ? { ...r, [key]: val } : r) }));
  const addRule = () => setPlanForm(f => ({ ...f, rules: [...f.rules, emptyRule()] }));
  const removeRule = (idx) => setPlanForm(f => ({ ...f, rules: f.rules.filter((_, i) => i !== idx) }));

  if (flagsLoading) return null;
  if (!flags.phase2_commissions) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Commissions"
      subtitle="Commission plans, employee assignments, and earnings tracking"
      right={tab === "plans" && <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" /> New Plan</Button>}
    >
      <div className="mb-4">
        <TabBar
          value={tab}
          onChange={setTab}
          tabs={[{ value: "plans", label: "Plans" }, { value: "earnings", label: "Earnings" }]}
        />
      </div>

      {tab === "plans" && (
        <SectionCard>
          {loading ? <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p> : plans.length === 0 ? (
            <p className="text-(--ui-muted) text-sm py-8 text-center">No commission plans yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                  <th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 font-medium">Rules</th>
                  <th className="py-2 font-medium">Employees</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.id} className="border-b border-(--ui-border)">
                    <td className="py-2 font-medium text-(--ui-text)">{p.name}</td>
                    <td className="py-2">{p.type}</td>
                    <td className="py-2">{p.rules?.length || 0}</td>
                    <td className="py-2">{p.assigned_employees || 0}</td>
                    <td className="py-2"><Badge tone={p.is_active ? "success" : "default"}>{p.is_active ? "Active" : "Inactive"}</Badge></td>
                    <td className="py-2 text-right flex gap-1 justify-end">
                      <Button tone="plain" size="sm" iconOnly onClick={() => openAssign(p)} title="Assign employees" aria-label="Assign employees"><Users size={14} /></Button>
                      <Button tone="plain" size="sm" iconOnly onClick={() => openEdit(p)} title="Edit" aria-label="Edit"><Pencil size={14} /></Button>
                      <Button tone="plain" size="sm" iconOnly onClick={() => handleDelete(p.id)} title="Delete" aria-label="Delete" className="hover:text-red-500"><Trash2 size={14} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {tab === "earnings" && (
        <SectionCard>
          <div className="flex gap-4 mb-4 flex-wrap">
            <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
              <p className="text-xs text-(--ui-muted)">Pending</p>
              <p className="font-semibold text-yellow-600">{fmt(Number(summary.pending_total || 0))}</p>
            </div>
            <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
              <p className="text-xs text-(--ui-muted)">Approved</p>
              <p className="font-semibold text-green-600">{fmt(Number(summary.approved_total || 0))}</p>
            </div>
            <div className="bg-(--ui-bg) border border-(--ui-border) rounded px-4 py-2 text-center">
              <p className="text-xs text-(--ui-muted)">Paid</p>
              <p className="font-semibold text-(--ui-text)">{fmt(Number(summary.paid_total || 0))}</p>
            </div>
          </div>
          {earnings.length === 0 ? (
            <p className="text-(--ui-muted) text-sm py-4 text-center">No commission earnings found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                  <th className="py-2 font-medium">Employee</th>
                  <th className="py-2 font-medium">Plan</th>
                  <th className="py-2 font-medium">Invoice</th>
                  <th className="py-2 font-medium">Sale Amt</th>
                  <th className="py-2 font-medium">Commission</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium">Date</th>
                  <th className="py-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map(e => (
                  <tr key={e.id} className="border-b border-(--ui-border)">
                    <td className="py-2 text-(--ui-text)">{e.employee_name}</td>
                    <td className="py-2">{e.plan_name}</td>
                    <td className="py-2">{e.invoice_number || "-"}</td>
                    <td className="py-2">{fmt(Number(e.sale_amount))}</td>
                    <td className="py-2 font-medium">{fmt(Number(e.commission_amount))}</td>
                    <td className="py-2"><Badge tone={STATUS_TONES[e.status]}>{e.status}</Badge></td>
                    <td className="py-2">{fmtUtcDateTime(e.created_at)}</td>
                    <td className="py-2 text-right flex gap-1 justify-end">
                      {e.status === "pending" && <Button size="sm" tone="plain" onClick={() => handleEarningStatus(e.id, "approved")}>Approve</Button>}
                      {e.status === "approved" && <Button size="sm" tone="plain" onClick={() => handleEarningStatus(e.id, "paid")}>Mark Paid</Button>}
                      {(e.status === "pending" || e.status === "approved") && <Button size="sm" tone="plain" onClick={() => handleEarningStatus(e.id, "reversed")}>Reverse</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      )}

      {/* Plan Create/Edit Modal */}
      <Modal
        open={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        title={editingPlan ? "Edit Plan" : "New Plan"}
        size="lg"
      >
        <label className="block text-sm text-(--ui-muted) mb-1">Name</label>
        <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" value={planForm.name} onChange={e => setPlanForm(f => ({ ...f, name: e.target.value }))} />
        <label className="block text-sm text-(--ui-muted) mb-1">Description</label>
        <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" rows={2} value={planForm.description} onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))} />
        <label className="block text-sm text-(--ui-muted) mb-1">Type</label>
        <select className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" value={planForm.type} onChange={e => setPlanForm(f => ({ ...f, type: e.target.value }))}>
          {PLAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="block text-sm text-(--ui-muted) mb-1">Starts at</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 text-sm bg-(--ui-bg) text-(--ui-text)" type="datetime-local" value={planForm.starts_at} onChange={e => setPlanForm(f => ({ ...f, starts_at: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-(--ui-muted) mb-1">Ends at</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 text-sm bg-(--ui-bg) text-(--ui-text)" type="datetime-local" value={planForm.ends_at} onChange={e => setPlanForm(f => ({ ...f, ends_at: e.target.value }))} />
          </div>
        </div>
        <label className="block text-sm font-medium text-(--ui-muted) mb-2">Rules</label>
        {planForm.rules.map((rule, idx) => (
          <div key={idx} className="flex gap-2 mb-2 items-center flex-wrap">
            <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-28" value={rule.scope_type} onChange={e => updateRule(idx, "scope_type", e.target.value)}>
              {SCOPE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            {rule.scope_type !== "all" && <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-20" type="number" placeholder="ID" value={rule.scope_id || ""} onChange={e => updateRule(idx, "scope_id", e.target.value ? Number(e.target.value) : null)} />}
            <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-20" type="number" step="0.01" placeholder="Rate" value={rule.rate} onChange={e => updateRule(idx, "rate", Number(e.target.value))} />
            <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-20" type="number" placeholder="Min" value={rule.min_threshold} onChange={e => updateRule(idx, "min_threshold", Number(e.target.value))} />
            <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-20" type="number" placeholder="Cap" value={rule.max_cap || ""} onChange={e => updateRule(idx, "max_cap", e.target.value ? Number(e.target.value) : null)} />
            {planForm.rules.length > 1 && <Button tone="plain" size="sm" iconOnly onClick={() => removeRule(idx)} aria-label="Remove rule" className="text-red-500"><X size={14} /></Button>}
          </div>
        ))}
        <Button tone="link" size="sm" onClick={addRule} className="mb-4">+ Add rule</Button>
        <ModalFooter>
          <Button size="sm" onClick={() => setShowPlanModal(false)}>Cancel</Button>
          <Button tone="primary" size="sm" onClick={handleSavePlan}>{editingPlan ? "Update" : "Create"}</Button>
        </ModalFooter>
      </Modal>

      {/* Assign Employees Modal */}
      <Modal
        open={!!showAssignModal}
        onClose={() => setShowAssignModal(null)}
        title={showAssignModal ? `Assign to: ${showAssignModal.name}` : "Assign"}
        size="md"
      >
        <div className="space-y-1 mb-4">
          {employees.map(emp => (
            <label key={emp.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
              <input type="checkbox" checked={selectedEmployees.includes(emp.id)} onChange={e => {
                if (e.target.checked) setSelectedEmployees(p => [...p, emp.id]);
                else setSelectedEmployees(p => p.filter(id => id !== emp.id));
              }} />
              <span className="text-(--ui-text)">{emp.name}</span>
              <span className="text-(--ui-muted) text-xs">{emp.role}</span>
            </label>
          ))}
        </div>
        <ModalFooter>
          <Button size="sm" onClick={() => setShowAssignModal(null)}>Cancel</Button>
          <Button tone="primary" size="sm" onClick={handleAssign}>Assign ({selectedEmployees.length})</Button>
        </ModalFooter>
      </Modal>
    </PageShell>
  );
}
