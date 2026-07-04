import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, EmptyState, Modal, ModalFooter } from "../../ui/primitives";
import { Plus, Pencil, Pause, Play, XCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { fmtUtcDateTime, fmtUtcDate } from "../../utils/dates";
import { api } from "../../api";

const STATUS_TONES = { draft: "default", active: "success", paused: "warning", past_due: "danger", cancelled: "danger", expired: "danger" };
const INTERVALS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

/* ── Cancel Reason Modal ─────────────────────────────────────────── */

function CancelReasonModal({ open, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Cancel Subscription" size="sm">
      <div className="space-y-3">
        <p className="text-sm text-(--ui-text-muted)">Why is this subscription being cancelled?</p>
        <textarea
          className="w-full border border-(--ui-border) rounded-lg px-3 py-2 bg-(--ui-surface) text-sm text-(--ui-text)"
          rows={3} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Optional: reason for cancellation..."
        />
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Back</Button>
        <Button tone="danger" onClick={() => onConfirm(reason)}>Confirm Cancel</Button>
      </ModalFooter>
    </Modal>
  );
}

/* ── Churn Stats Widget ──────────────────────────────────────────── */

function ChurnStatsWidget() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get("/api/subscriptions/stats").then(setStats).catch(() => {});
  }, []);
  if (!stats) return null;
  return (
    <div className="flex flex-wrap gap-4 mb-4">
      <div className="border border-(--ui-border) rounded-lg px-4 py-3 bg-(--ui-surface)">
        <p className="text-xs text-(--ui-text-muted) mb-1">Active</p>
        <p className="text-xl font-bold text-(--ui-success-fg)">{stats.active_count}</p>
      </div>
      <div className="border border-(--ui-border) rounded-lg px-4 py-3 bg-(--ui-surface)">
        <p className="text-xs text-(--ui-text-muted) mb-1">Churned this month</p>
        <p className="text-xl font-bold text-(--ui-danger-fg)">{stats.churned_this_month}</p>
      </div>
      <div className="border border-(--ui-border) rounded-lg px-4 py-3 bg-(--ui-surface)">
        <p className="text-xs text-(--ui-text-muted) mb-1">Churn rate</p>
        <p className={`text-xl font-bold ${stats.churn_rate > 5 ? "text-(--ui-warning-fg)" : "text-(--ui-text)"}`}>{stats.churn_rate}%</p>
      </div>
    </div>
  );
}

/* ── Subscription Detail View ────────────────────────────────────── */

function SubscriptionDetail({ subId, onBack, onRefresh, fmt }) {
  const toast = useToast();
  const [sub, setSub] = useState(null);
  const [renewals, setRenewals] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, ren] = await Promise.all([
        api.get(`/api/customer-subscriptions/${subId}`),
        api.get(`/api/customer-subscriptions/${subId}/renewals`),
      ]);
      setSub(detail);
      setRenewals(ren.renewals || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, [subId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="py-12 text-center text-(--ui-text-muted)">Loading...</div>;
  if (!sub) return <EmptyState title="Subscription not found" />;

  const daysLeft = sub.current_period_end
    ? Math.max(0, Math.ceil((new Date(sub.current_period_end) - Date.now()) / 86400000))
    : null;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-(--ui-text-muted) hover:text-(--ui-text) mb-2">
        <ArrowLeft className="w-4 h-4" /> Back to list
      </button>

      <SectionCard>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-(--ui-text)">{sub.plan_name}</h2>
              <Badge tone={STATUS_TONES[sub.status]}>{sub.status}</Badge>
            </div>
            <p className="text-sm text-(--ui-text-muted)">{sub.customer_name} &middot; {fmt(sub.plan_price)}/{sub.billing_interval}</p>
          </div>
          {daysLeft !== null && sub.status === "active" && (
            <div className="text-right">
              <p className="text-2xl font-bold text-(--ui-text)">{daysLeft}</p>
              <p className="text-xs text-(--ui-text-muted)">days remaining</p>
            </div>
          )}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard>
          <h4 className="text-sm font-semibold text-(--ui-text) mb-3">Plan Details</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Plan</dt><dd className="text-(--ui-text)">{sub.plan_name}</dd></div>
            <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Price</dt><dd className="text-(--ui-text)">{fmt(sub.plan_price)}/{sub.billing_interval}</dd></div>
            {sub.trial_days > 0 && <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Trial</dt><dd className="text-(--ui-text)">{sub.trial_days} days</dd></div>}
            <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Period Start</dt><dd className="text-(--ui-text)">{fmtUtcDate(sub.current_period_start)}</dd></div>
            <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Period End</dt><dd className="text-(--ui-text)">{fmtUtcDate(sub.current_period_end)}</dd></div>
            <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Created</dt><dd className="text-(--ui-text)">{fmtUtcDate(sub.created_at)}</dd></div>
          </dl>
        </SectionCard>

        <SectionCard>
          <h4 className="text-sm font-semibold text-(--ui-text) mb-3">Status</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Status</dt><dd><Badge tone={STATUS_TONES[sub.status]}>{sub.status}</Badge></dd></div>
            {sub.cancelled_at && <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Cancelled At</dt><dd className="text-(--ui-text)">{fmtUtcDateTime(sub.cancelled_at)}</dd></div>}
            {sub.cancel_reason && (
              <div>
                <dt className="text-(--ui-text-muted) mb-1">Cancel Reason</dt>
                <dd className="text-sm text-(--ui-text) bg-(--ui-muted-surface) rounded p-2">{sub.cancel_reason}</dd>
              </div>
            )}
            {sub.paused_at && <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Paused At</dt><dd className="text-(--ui-text)">{fmtUtcDateTime(sub.paused_at)}</dd></div>}
            {sub.grace_period_end && <div className="flex justify-between"><dt className="text-(--ui-text-muted)">Grace Period End</dt><dd className="text-(--ui-text)">{fmtUtcDate(sub.grace_period_end)}</dd></div>}
          </dl>
        </SectionCard>
      </div>

      {/* Renewal History */}
      <SectionCard>
        <h4 className="text-sm font-semibold text-(--ui-text) mb-3">
          <RefreshCw className="w-4 h-4 inline mr-1" />Renewal History
        </h4>
        {renewals.length === 0 ? (
          <p className="text-sm text-(--ui-text-muted)">No renewal history yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                  <th className="py-2 px-3 font-medium">Period</th>
                  <th className="py-2 px-3 font-medium text-right">Amount</th>
                  <th className="py-2 px-3 font-medium">Invoice</th>
                  <th className="py-2 px-3 font-medium">Invoice Status</th>
                  <th className="py-2 px-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map(r => (
                  <tr key={r.id} className="border-b border-(--ui-border)">
                    <td className="py-2 px-3 text-(--ui-text)">{fmtUtcDate(r.period_start)} — {fmtUtcDate(r.period_end)}</td>
                    <td className="py-2 px-3 text-right text-(--ui-text)">{fmt(r.charge_amount)}</td>
                    <td className="py-2 px-3 text-(--ui-text)">{r.invoice_number || "-"}</td>
                    <td className="py-2 px-3">
                      {r.invoice_status ? <Badge tone={r.balance_due > 0 ? "warning" : "success"}>{r.invoice_status}</Badge> : "-"}
                    </td>
                    <td className="py-2 px-3 text-(--ui-text-muted)">{fmtUtcDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────────── */

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

  // Cancel modal
  const [cancellingId, setCancellingId] = useState(null);

  // Detail view
  const [detailId, setDetailId] = useState(null);

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
  const cancelSub = async (reason) => {
    const id = cancellingId;
    setCancellingId(null);
    try { await api.post(`/api/customer-subscriptions/${id}/cancel`, { cancel_reason: reason || undefined }); toast.success("Cancelled"); load(); }
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

  // Detail view
  if (detailId) {
    return (
      <PageShell title="Subscriptions">
        <SubscriptionDetail subId={detailId} onBack={() => setDetailId(null)} onRefresh={load} fmt={fmt} />
      </PageShell>
    );
  }

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
                    <button onClick={() => openPlanEdit(p)} className="p-1 rounded hover:bg-(--ui-muted-surface)"><Pencil className="w-4 h-4" /></button>
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
        <>
          <ChurnStatsWidget />
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
                      <tr key={s.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface) cursor-pointer transition-colors" onClick={() => setDetailId(s.id)}>
                        <td className="py-2 px-3">{s.customer_name}</td>
                        <td className="py-2 px-3">{s.plan_name}</td>
                        <td className="py-2 px-3"><Badge tone={STATUS_TONES[s.status]}>{s.status}</Badge></td>
                        <td className="py-2 px-3 text-right">{fmt(s.plan_price)}/{s.billing_interval}</td>
                        <td className="py-2 px-3 text-(--ui-text-muted)">{s.current_period_end ? fmtUtcDate(s.current_period_end) : "—"}</td>
                        <td className="py-2 px-3 text-right" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            {s.status === "active" && <button onClick={() => pauseSub(s.id)} title="Pause" className="p-1 rounded hover:bg-(--ui-muted-surface)"><Pause className="w-4 h-4" /></button>}
                            {s.status === "paused" && <button onClick={() => resumeSub(s.id)} title="Resume" className="p-1 rounded hover:bg-(--ui-muted-surface) text-(--ui-success-fg)"><Play className="w-4 h-4" /></button>}
                            {!["cancelled", "expired"].includes(s.status) && <button onClick={() => setCancellingId(s.id)} title="Cancel" className="p-1 rounded hover:bg-(--ui-muted-surface) text-(--ui-danger-fg)"><XCircle className="w-4 h-4" /></button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      <Modal
        open={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        title={editingPlan ? "Edit Plan" : "New Plan"}
        size="sm"
      >
        <div className="space-y-3">
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Name</label>
            <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Price</label>
            <input type="number" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={planForm.price} onChange={(e) => setPlanForm({ ...planForm, price: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Billing Interval</label>
            <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={planForm.billing_interval} onChange={(e) => setPlanForm({ ...planForm, billing_interval: e.target.value })}>
              {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select></div>
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Trial Days</label>
            <input type="number" className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={planForm.trial_days} onChange={(e) => setPlanForm({ ...planForm, trial_days: e.target.value })} /></div>
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Description</label>
            <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} /></div>
        </div>
        <ModalFooter>
          <Button tone="plain" onClick={() => setShowPlanModal(false)}>Cancel</Button>
          <Button onClick={savePlan} disabled={!planForm.name || !planForm.price}>Save</Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={showSubModal}
        onClose={() => setShowSubModal(false)}
        title="New Subscription"
        size="sm"
      >
        <div className="space-y-3">
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Customer</label>
            <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={subForm.customer_id} onChange={(e) => setSubForm({ ...subForm, customer_id: e.target.value })}>
              <option value="">Select customer...</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          <div><label className="mb-1 block text-sm font-medium text-(--ui-text)">Plan</label>
            <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-surface) text-(--ui-text)" value={subForm.plan_id} onChange={(e) => setSubForm({ ...subForm, plan_id: e.target.value })}>
              <option value="">Select plan...</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {fmt(p.price)}/{p.billing_interval}</option>)}
            </select></div>
          {!flags.subscription_autocharge && (
            <p className="text-sm text-(--ui-text-muted) bg-(--ui-muted-surface) rounded p-2">Auto-charge is not enabled. Renewals will generate invoices that customers pay manually.</p>
          )}
        </div>
        <ModalFooter>
          <Button tone="plain" onClick={() => setShowSubModal(false)}>Cancel</Button>
          <Button onClick={createSubscription} disabled={!subForm.plan_id || !subForm.customer_id}>Create</Button>
        </ModalFooter>
      </Modal>

      <CancelReasonModal
        open={!!cancellingId}
        onConfirm={cancelSub}
        onClose={() => setCancellingId(null)}
      />
    </PageShell>
  );
}
