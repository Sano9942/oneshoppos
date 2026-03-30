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

  const [paymentProcessing, setPaymentProcessing] = useState(false);

  // Handle payment return from gateway
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentResult = params.get("payment");
    const intentId = params.get("intent");

    if (paymentResult === "success" && intentId) {
      setPaymentProcessing(true);
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const r = await fetch(`${API_BASE}/api/billing/status`);
          const data = await r.json();
          if (data.payment_status === "active" && data.expires_at) {
            clearInterval(poll);
            setPaymentProcessing(false);
            setBilling(data);
            success("Payment confirmed! Your subscription is now active.");
            window.history.replaceState({}, "", "/billing");
          } else if (attempts >= 15) {
            clearInterval(poll);
            setPaymentProcessing(false);
            fetchBilling();
            success("Payment is being processed. Check back in a minute.");
            window.history.replaceState({}, "", "/billing");
          }
        } catch {
          if (attempts >= 15) {
            clearInterval(poll);
            setPaymentProcessing(false);
            fetchBilling();
          }
        }
      }, 2000);
      return () => clearInterval(poll);
    }

    if (paymentResult === "cancelled") {
      showError("Payment was cancelled.");
      window.history.replaceState({}, "", "/billing");
    }
  }, []);

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

  const handlePayNow = async (cycle = "monthly") => {
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create checkout");
      window.location.href = data.checkout_url;
    } catch (err) {
      showError(err.message);
      setSubmitting(false);
    }
  };

  if (loading) return <PageShell title="Billing"><div className="animate-pulse h-40 bg-slate-100 rounded-xl" /></PageShell>;

  if (paymentProcessing) return (
    <PageShell title="Billing">
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full mb-4" />
        <p className="text-slate-600 font-medium">Verifying your payment...</p>
        <p className="text-sm text-slate-400 mt-1">This usually takes a few seconds.</p>
      </div>
    </PageShell>
  );

  const PRICING = { monthly: 8000, annual: 80000 };
  const priceLabel = cycle === "annual"
    ? `PKR ${PRICING.annual.toLocaleString()}/year`
    : `PKR ${PRICING.monthly.toLocaleString()}/mo`;

  const CycleToggle = () => (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-sm">
      {["monthly", "annual"].map(c => (
        <button key={c} onClick={() => setCycle(c)}
          className={`px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer ${
            cycle === c ? "bg-emerald-600 text-white" : "text-slate-600 hover:text-slate-800"
          }`}>
          {c === "annual" ? "Annual (save 17%)" : "Monthly"}
        </button>
      ))}
    </div>
  );

  const OutletBreakdown = () => {
    const outlets = billing?.max_outlets || 1;
    if (outlets <= 1) return null;
    const unitPrice = cycle === "annual" ? PRICING.annual : PRICING.monthly;
    return (
      <p className="text-xs text-slate-500 mt-1">
        {outlets} outlets × PKR {unitPrice.toLocaleString()}/{cycle === "annual" ? "yr" : "mo"} = <strong>PKR {(unitPrice * outlets).toLocaleString()}</strong>
      </p>
    );
  };

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

  function PaymentHistorySection() {
    const [payments, setPayments] = useState([]);
    const [loadingPayments, setLoadingPayments] = useState(true);

    useEffect(() => {
      fetch(`${API_BASE}/api/billing/payment-history`)
        .then(r => r.json())
        .then(data => { setPayments(Array.isArray(data) ? data : []); setLoadingPayments(false); })
        .catch(() => setLoadingPayments(false));
    }, []);

    if (loadingPayments || !payments.length) return null;

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Payment History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Period</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-2 text-slate-700">{new Date(p.recorded_at).toLocaleDateString()}</td>
                  <td className="py-2 text-slate-700">PKR {Number(p.amount).toLocaleString()}</td>
                  <td className="py-2 capitalize text-slate-700">{p.plan} ({p.cycle})</td>
                  <td className="py-2 text-slate-500 text-xs">
                    {new Date(p.period_start).toLocaleDateString()} — {new Date(p.period_end).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

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
            <div className="mt-3 mb-2"><CycleToggle /><OutletBreakdown /></div>
            {billing.payment_enabled && (
              <button onClick={() => handlePayNow(cycle)} disabled={submitting}
                className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Redirecting..." : `Subscribe Now — ${priceLabel}`}
              </button>
            )}
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
              <strong> Pro plan: {priceLabel} per outlet.</strong>
            </p>
            <div className="mt-3 mb-2"><CycleToggle /><OutletBreakdown /></div>
            {billing.payment_enabled && (
              <button onClick={() => handlePayNow(cycle)} disabled={submitting}
                className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Redirecting..." : `Pay Now — ${priceLabel}`}
              </button>
            )}
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
            <div className="mb-3"><CycleToggle /><OutletBreakdown /></div>
            {billing.payment_enabled ? (
              <button onClick={() => handlePayNow(cycle)} disabled={submitting}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer">
                {submitting ? "Redirecting..." : `Pay Now — ${priceLabel}`}
              </button>
            ) : (
              <button onClick={() => { setSelectedPlan("pro"); setShowUpgradeModal(true); }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors cursor-pointer">
                {`Subscribe Now — ${priceLabel}`}
              </button>
            )}
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

        {/* Upcoming Renewal */}
        {paymentStatus === "active" && billing?.plan === "pro" && billing?.expires_at && (() => {
          const daysUntilExpiry = Math.ceil((new Date(billing.expires_at) - new Date()) / 86400000);
          if (daysUntilExpiry > 7) return null;
          return (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <Clock size={18} className="text-amber-600" />
                <h2 className="text-base font-semibold text-amber-800">
                  Subscription renews in {daysUntilExpiry} {daysUntilExpiry === 1 ? "day" : "days"}
                </h2>
              </div>
              <p className="text-sm text-amber-700">Renew now to avoid any interruption in service.</p>
              {billing.payment_enabled && (
                <button onClick={() => handlePayNow(billing.billing_cycle || "monthly")} disabled={submitting}
                  className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 cursor-pointer">
                  {submitting ? "Redirecting..." : "Renew Now"}
                </button>
              )}
            </div>
          );
        })()}

        {/* Upgrade Options */}
        {Object.keys(upgradePlans).length > 0 && !billing?.pending_request && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-800 mb-4">Upgrade to Pro</h2>
            <p className="text-sm text-slate-500 mb-4">{priceLabel} per outlet. Unlimited employees and products. All features included.</p>
            <div className="mb-4"><CycleToggle /><OutletBreakdown /></div>
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

        {/* Payment History */}
        {billing?.plan !== "free" && <PaymentHistorySection />}
      </div>

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Request Upgrade to Pro</h3>
            <p className="text-sm text-slate-500 mb-2">{priceLabel} per outlet</p>
            <div className="mb-3"><CycleToggle /><OutletBreakdown /></div>
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
