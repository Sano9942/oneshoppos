import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Plus, Pencil, Pause, Play, XCircle, X } from "lucide-react";
import { fmtUtcDateTime, fmtUtcDate } from "../../utils/dates";
import { api } from "../../api";

const STATUS_TONES = { draft: "default", active: "success", paused: "warning", cancelled: "danger", expired: "danger" };
const INTERVALS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export default function SubscriptionsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [tab, setTab] = useState("subscriptions");
  const [plans, setPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Plan modal
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [planForm, setPlanForm] = useState({ name: "", description: "", price: "", billing_interval: "monthly", billing_interval_count: 1, trial_days: 0 });

  // Subscription modal
  const [showSubModal, setShowSubModal] = useState(false);
  const [subForm, setSubForm] = useState({ plan_id: "", customer_id: "", auto_charge: false });

  const load = useCallback(async () => {
    setLoading(true);
    const [p, s, c] = await Promise.all([
      api.get("/api/subscription-plans").catch(() => ({ plans: [] })),
      api.get("/api/customer-subscriptions").catch(() => ({ subscriptions: [] })),
      api.get("/api/customers?limit=500").catch(() => ({ customers: [] })),
    ]);
    setPlans(p.plans || []);
    setSubscriptions(s.subscriptions || []);
    setCustomers(c.customers || c.rows || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!flagsLoading && !flags.subscription_billing) return <Navigate to="/dashboard" replace />;

  const savePlan = async () => {
    try {
      const body = { ...planForm, price: Number(planForm.price), billing_interval_count: Number(planForm.billing_interval_count), trial_days: Number(planForm.trial_days) };
      if (editingPlan) {
        await api.put(`/api/subscription-plans/${editingPlan.id}`, body);
        toast.success("Plan updated");
      } else {
        await api.post("/api/subscription-plans", body);
        toast.success("Plan created");
      }
      setShowPlanModal(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const createSubscription = async () => {
    try {
      await api.post("/api/customer-subscriptions", {
        plan_id: Number(subForm.plan_id),
        customer_id: Number(subForm.customer_id),
        auto_charge: subForm.auto_charge,
      });
      toast.success("Subscription created");
      setShowSubModal(false);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const pauseSub = async (id) => {
    try { await api.post(`/api/customer-subscriptions/${id}/pause`); toast.success("Paused"); load(); }
    catch (err) { toast.error(err.message); }
  };
  const resumeSub = async (id) => {
    try { await api.post(`/api/customer-subscriptions/${id}/resume`); toast.success("Resumed"); load(); }
    catch (err) { toast.error(err.message); }
  };
  const cancelSub = async (id) => {
    try { await api.post(`/api/customer-subscriptions/${id}/cancel`); toast.success("Cancelled"); load(); }
    catch (err) { toast.error(err.message); }
  };

  const openPlanCreate = () => {
    setEditingPlan(null);
    setPlanForm({ name: "", description: "", price: "", billing_interval: "monthly", billing_interval_count: 1, trial_days: 0 });
    setShowPlanModal(true);
  };

  const openPlanEdit = (plan) => {
    setEditingPlan(plan);
    setPlanForm({ name: plan.name, description: plan.description || "", price: plan.price, billing_interval: plan.billing_interval, billing_interval_count: plan.billing_interval_count || 1, trial_days: plan.trial_days || 0 });
    setShowPlanModal(true);
  };

  return (
    <PageShell title="Subscriptions" right={
      <div className="flex gap-2">
        <Button onClick={() => setTab(tab === "subscriptions" ? "plans" : "subscriptions")} tone="plain">
          {tab === "subscriptions" ? "Plans" : "Subscriptions"}
        </Button>
        {tab === "plans" && <Button onClick={openPlanCreate}><Plus className="w-4 h-4 mr-1" />New Plan</Button>}
        {tab === "subscriptions" && <Button onClick={() => { setSubForm({ plan_id: "", customer_id: "", auto_charge: false }); setShowSubModal(true); }}><Plus className="w-4 h-4 mr-1" />New Subscription</Button>}
      </div>
    }>
      {loading ? <SectionCard><p className="text-(--ui-text-muted) text-center py-8">Loading...</p></SectionCard> : tab === "plans" ? (
        <SectionCard>
          {plans.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No plans yet. Create your first subscription plan.</p> : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <div key={p.id} className="border border-(--ui-border) rounded-lg p-4">
                  <div className="flex justify-between items-start">
                    <h3 className="font-bold text-lg">{p.name}</h3>
                    <button onClick={() => openPlanEdit(p)} className="p-1 rounded hover:bg-(--ui-bg-hover)"><Pencil className="w-4 h-4" /></button>
                  </div>
                  <p className="text-2xl font-bold mt-2">{fmt(p.price)}<span className="text-sm text-(--ui-text-muted) font-normal">/{p.billing_interval}</span></p>
                  {p.description && <p className="text-sm text-(--ui-text-muted) mt-1">{p.description}</p>}
                  {p.trial_days > 0 && <Badge tone="warning" className="mt-2">{p.trial_days}-day trial</Badge>}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard>
          {subscriptions.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No active subscriptions.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-(--ui-border)">
                  <th className="text-left py-2 px-3 font-medium">Customer</th>
                  <th className="text-left py-2 px-3 font-medium">Plan</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-right py-2 px-3 font-medium">Price</th>
                  <th className="text-left py-2 px-3 font-medium">Period End</th>
                  <th className="text-right py-2 px-3 font-medium">Actions</th>
                </tr></thead>
                <tbody>
                  {subscriptions.map((s) => (
                    <tr key={s.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover)">
                      <td className="py-2 px-3">{s.customer_name}</td>
                      <td className="py-2 px-3">{s.plan_name}</td>
                      <td className="py-2 px-3"><Badge tone={STATUS_TONES[s.status]}>{s.status}</Badge></td>
                      <td className="py-2 px-3 text-right">{fmt(s.plan_price)}/{s.billing_interval}</td>
                      <td className="py-2 px-3 text-(--ui-text-muted)">{s.current_period_end ? fmtUtcDate(s.current_period_end) : "—"}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex gap-1 justify-end">
                          {s.status === "active" && <button onClick={() => pauseSub(s.id)} title="Pause" className="p-1 rounded hover:bg-(--ui-bg-hover)"><Pause className="w-4 h-4" /></button>}
                          {s.status === "paused" && <button onClick={() => resumeSub(s.id)} title="Resume" className="p-1 rounded hover:bg-(--ui-bg-hover) text-green-600"><Play className="w-4 h-4" /></button>}
                          {s.status !== "cancelled" && <button onClick={() => cancelSub(s.id)} title="Cancel" className="p-1 rounded hover:bg-(--ui-bg-hover) text-red-500"><XCircle className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* Plan Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">{editingPlan ? "Edit Plan" : "New Plan"}</h2>
              <button onClick={() => setShowPlanModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Name</label>
                <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Price</label>
                <input type="number" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Billing Interval</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={planForm.billing_interval} onChange={(e) => setPlanForm({ ...planForm, billing_interval: e.target.value })}>
                  {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Trial Days</label>
                <input type="number" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={planForm.trial_days} onChange={(e) => setPlanForm({ ...planForm, trial_days: e.target.value })} /></div>
              <div><label className="block text-sm font-medium mb-1">Description</label>
                <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} /></div>
              <div className="flex gap-2 justify-end">
                <Button tone="plain" onClick={() => setShowPlanModal(false)}>Cancel</Button>
                <Button onClick={savePlan} disabled={!planForm.name || !planForm.price}>Save</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Subscription Modal */}
      {showSubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-(--ui-bg) rounded-lg shadow-lg w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">New Subscription</h2>
              <button onClick={() => setShowSubModal(false)}><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div><label className="block text-sm font-medium mb-1">Customer</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={subForm.customer_id} onChange={(e) => setSubForm({ ...subForm, customer_id: e.target.value })}>
                  <option value="">Select customer...</option>
                  {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></div>
              <div><label className="block text-sm font-medium mb-1">Plan</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={subForm.plan_id} onChange={(e) => setSubForm({ ...subForm, plan_id: e.target.value })}>
                  <option value="">Select plan...</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}/{p.billing_interval}</option>)}
                </select></div>
              {!flags.subscription_autocharge && (
                <p className="text-sm text-(--ui-text-muted) bg-(--ui-bg-hover) rounded p-2">Auto-charge is not enabled. Renewals will generate invoices that customers pay manually.</p>
              )}
              <div className="flex gap-2 justify-end">
                <Button tone="plain" onClick={() => setShowSubModal(false)}>Cancel</Button>
                <Button onClick={createSubscription} disabled={!subForm.plan_id || !subForm.customer_id}>Create</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
