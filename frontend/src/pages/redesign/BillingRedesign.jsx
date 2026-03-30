import { useState, useEffect } from "react";
import { CreditCard, ArrowUpRight, Clock, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { API_BASE } from "../../config";
import { PageShell } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";

export default function BillingRedesign() {
  const { success, error: showError } = useToast();
  const [billing, setBilling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState("monthly");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchBilling = () => {
    fetch(`${API_BASE}/api/billing/status`)
      .then(r => r.json())
      .then(data => { setBilling(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { fetchBilling(); }, []);

  const handleRequestUpgrade = async () => {
    if (!selectedPlan) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/request-upgrade`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: selectedPlan, cycle, message: message || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      success("Upgrade request submitted! We'll be in touch shortly.");
      setShowUpgradeModal(false);
      setMessage("");
      fetchBilling();
    } catch (err) {
      showError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <PageShell title="Billing"><div className="animate-pulse h-40 bg-slate-100 rounded-xl" /></PageShell>;

  const planColors = { free: "bg-slate-100 text-slate-700", pro: "bg-emerald-100 text-emerald-700" };
  const statusColors = { active: "text-emerald-600", trial: "text-blue-600", grace: "text-amber-600", expired: "text-red-600", due: "text-amber-600", overdue: "text-red-600" };

  const upgradePlans = {};
  (billing?.upgrade_options || []).forEach(o => {
    if (!upgradePlans[o.plan]) upgradePlans[o.plan] = {};
    upgradePlans[o.plan][o.cycle] = o.price;
  });

  const paymentStatus = billing?.payment_status || "active";
  const isTrial = paymentStatus === "trial";
  const isGrace = paymentStatus === "grace";
  const isExpired = paymentStatus === "expired";

  return (
    <PageShell title="Billing">
      <div className="max-w-3xl space-y-6">
        {/* Trial Banner */}
        {isTrial && billing.trial_days_left != null && (
          <div className={`rounded-xl border p-5 ${billing.trial_days_left <= 7 ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
            <div className="flex items-center gap-2 mb-3">
              <Clock size={18} className={billing.trial_days_left <= 7 ? "text-amber-600" : "text-blue-600"} />
              <h2 className={`text-base font-semibold ${billing.trial_days_left <= 7 ? "text-amber-800" : "text-blue-800"}`}>
                Pro Trial — {billing.trial_days_left} {billing.trial_days_left === 1 ? "day" : "days"} remaining
              </h2>
            </div>
            <div className="w-full bg-white/60 rounded-full h-2.5 mb-3">
              <div className={`h-2.5 rounded-full ${billing.trial_days_left <= 7 ? "bg-amber-500" : "bg-blue-500"}`}
                style={{ width: `${Math.max(2, ((45 - billing.trial_days_left) / 45) * 100)}%` }} />
            </div>
            <p className="text-sm text-slate-600">
              {billing.trial_days_left <= 7
                ? "Your trial is ending soon. Subscribe to continue using all features."
                : "You have full access to all Pro features during your trial."}
            </p>
          </div>
        )}

        {/* Grace Period Banner */}
        {isGrace && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={18} className="text-red-600" />
              <h2 className="text-base font-semibold text-red-800">
                Trial Expired — {billing.grace_days_left ?? 0} {(billing.grace_days_left ?? 0) === 1 ? "day" : "days"} left to subscribe
              </h2>
            </div>
            <p className="text-sm text-red-700">
              Your account will become read-only after the grace period. Subscribe now to continue selling.
              <strong> Pro plan: PKR 8,000/month per outlet.</strong>
            </p>
          </div>
        )}

        {/* Expired Banner */}
        {isExpired && (
          <div className="rounded-xl border border-red-400 bg-red-50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <XCircle size={18} className="text-red-600" />
              <h2 className="text-base font-semibold text-red-800">Subscription Expired — Account Read-Only</h2>
            </div>
            <p className="text-sm text-red-700 mb-3">
              You can still view your data and export reports, but cannot make sales or changes.
              Subscribe to restore full access.
            </p>
            <button onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors">
              Subscribe Now — PKR 8,000/mo
            </button>
          </div>
        )}

        {/* Current Plan */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <CreditCard size={20} className="text-slate-400" />
            <h2 className="text-lg font-semibold text-slate-800">Current Plan</h2>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize ${planColors[billing?.plan] || planColors.free}`}>
              {billing?.plan || "free"}
            </span>
            {billing?.billing_cycle && (
              <span className="text-sm text-slate-500 capitalize">{billing.billing_cycle}</span>
            )}
            {paymentStatus !== "active" && billing?.plan !== "free" && (
              <span className={`text-sm font-semibold capitalize ${statusColors[paymentStatus] || "text-slate-600"}`}>
                {paymentStatus}
              </span>
            )}
          </div>
          {billing?.expires_at && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock size={14} />
              <span>Expires: {new Date(billing.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          )}
          {billing?.plan === "free" && (
            <p className="mt-3 text-sm text-slate-500">
              You're on the Free plan (1 outlet, 3 employees, 100 products). Upgrade to Pro for unlimited access.
            </p>
          )}
        </div>

        {/* Upgrade Options */}
        {Object.keys(upgradePlans).length > 0 && !billing?.pending_request && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Upgrade to Pro</h2>
            <p className="text-sm text-slate-500 mb-4">PKR 8,000/month per outlet. Unlimited employees and products. All features included.</p>
            <button
              onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}
              className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors flex items-center gap-1"
            >
              Request Upgrade <ArrowUpRight size={14} />
            </button>
          </div>
        )}

        {/* Pending Request */}
        {billing?.pending_request && (
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-6">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={18} className="text-purple-600" />
              <h2 className="text-base font-semibold text-purple-700">Upgrade Request Pending</h2>
            </div>
            <p className="text-sm text-purple-600">
              You requested <span className="font-semibold capitalize">{billing.pending_request.requested_plan}</span> ({billing.pending_request.requested_cycle}) on {new Date(billing.pending_request.created_at).toLocaleDateString()}.
              We'll be in touch shortly.
            </p>
          </div>
        )}
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Request Upgrade to Pro</h3>
            <p className="text-sm text-slate-500 mb-4">PKR 8,000/month per outlet</p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Message (optional)</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                rows={3} placeholder="Any questions or notes..." />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowUpgradeModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 cursor-pointer">Cancel</button>
              <button onClick={handleRequestUpgrade} disabled={submitting}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
