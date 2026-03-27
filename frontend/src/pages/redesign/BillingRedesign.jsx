import { useState, useEffect } from "react";
import { CreditCard, ArrowUpRight, Clock, CheckCircle } from "lucide-react";
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

  const planColors = { free: "bg-slate-100 text-slate-700", starter: "bg-blue-100 text-blue-700", pro: "bg-emerald-100 text-emerald-700" };
  const statusColors = { active: "text-emerald-600", due: "text-amber-600", overdue: "text-red-600", suspended: "text-red-700" };

  // Group upgrade options by plan
  const upgradePlans = {};
  (billing?.upgrade_options || []).forEach(o => {
    if (!upgradePlans[o.plan]) upgradePlans[o.plan] = {};
    upgradePlans[o.plan][o.cycle] = o.price;
  });

  return (
    <PageShell title="Billing">
      <div className="max-w-3xl space-y-6">
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
            {billing?.payment_status && billing.plan !== "free" && (
              <span className={`text-sm font-semibold capitalize ${statusColors[billing.payment_status] || "text-slate-600"}`}>
                {billing.payment_status}
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
            <p className="mt-3 text-sm text-slate-500">You're on the Free plan. Upgrade to unlock more outlets, employees, and products.</p>
          )}
        </div>

        {/* Upgrade Options */}
        {Object.keys(upgradePlans).length > 0 && !billing?.pending_request && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-800">Upgrade</h2>
              <div className="flex rounded-lg border border-slate-200 text-sm">
                <button onClick={() => setCycle("monthly")} className={`px-3 py-1.5 rounded-l-lg font-medium transition-colors ${cycle === "monthly" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Monthly</button>
                <button onClick={() => setCycle("annual")} className={`px-3 py-1.5 rounded-r-lg font-medium transition-colors ${cycle === "annual" ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>Annual</button>
              </div>
            </div>
            {cycle === "annual" && (
              <p className="text-xs text-emerald-600 font-semibold mb-3">Save 2 months with annual billing</p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {Object.entries(upgradePlans).map(([plan, prices]) => (
                <div key={plan} className="rounded-lg border border-slate-200 p-4 hover:border-emerald-300 transition-colors">
                  <h3 className="text-base font-semibold text-slate-800 capitalize mb-1">{plan}</h3>
                  <p className="text-2xl font-bold text-slate-900 mb-3">
                    PKR {Number(prices[cycle] || prices.monthly || 0).toLocaleString()}
                    <span className="text-sm font-normal text-slate-500">/{cycle === "annual" ? "yr" : "mo"}</span>
                  </p>
                  <button
                    onClick={() => { setSelectedPlan(plan); setShowUpgradeModal(true); }}
                    className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1"
                  >
                    Request Upgrade <ArrowUpRight size={14} />
                  </button>
                </div>
              ))}
            </div>
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
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Request Upgrade to <span className="capitalize">{selectedPlan}</span></h3>
            <p className="text-sm text-slate-500 mb-4">
              {cycle === "monthly" ? "Monthly" : "Annual"} billing — PKR {Number(upgradePlans[selectedPlan]?.[cycle] || 0).toLocaleString()}/{cycle === "annual" ? "yr" : "mo"}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-600 mb-1">Message (optional)</label>
              <textarea value={message} onChange={e => setMessage(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                rows={3} placeholder="Any questions or notes..." />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowUpgradeModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={handleRequestUpgrade} disabled={submitting}
                className="px-4 py-2 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                {submitting ? "Sending..." : "Send Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
