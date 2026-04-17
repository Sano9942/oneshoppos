import { useState, useEffect } from "react";
import { CreditCard, ArrowUpRight, Clock, CheckCircle, AlertTriangle, XCircle, Tag } from "lucide-react";
import { api } from "../../api";
import { PageShell, Modal, ModalFooter, Button } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";

export default function BillingRedesign() {
  const { success, error: showError } = useToast();
  const [billing, setBilling] = useState(null);
  const [pricing, setPricing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState("quarterly");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchBilling = () => {
    api.get("/api/billing/status")
      .then(data => { setBilling(data); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchBilling();
    api.get("/api/billing/pricing").then(data => setPricing(data)).catch(() => {});
  }, []);

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
          const data = await api.get("/api/billing/status");
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
      const data = await api.post("/api/billing/request-upgrade", { plan: selectedPlan, cycle, message: message || undefined });
      success("Upgrade request submitted! We'll be in touch shortly.");
      setShowUpgradeModal(false);
      setMessage("");
      fetchBilling();
    } catch (err) {
      showError(err.body?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayNow = async (cycle = "monthly") => {
    setSubmitting(true);
    try {
      const data = await api.post("/api/billing/create-checkout", { cycle });
      window.location.href = data.checkout_url;
    } catch (err) {
      showError(err.body?.error || err.message);
      setSubmitting(false);
    }
  };

  if (loading) return <PageShell title="Billing"><div className="animate-pulse h-40 bg-(--ui-muted-surface) rounded-xl" /></PageShell>;

  if (paymentProcessing) return (
    <PageShell title="Billing">
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full mb-4" />
        <p className="text-(--ui-text-muted) font-medium">Verifying your payment...</p>
        <p className="text-sm text-(--ui-text-muted) mt-1">This usually takes a few seconds.</p>
      </div>
    </PageShell>
  );

  // Build pricing lookup from API data (pro plan only for upgrade display)
  const proPricing = pricing.filter(p => p.plan === "pro");
  const cycleInfo = proPricing.find(p => p.cycle === cycle) || proPricing[0] || {};
  const CYCLE_LABELS = { monthly: "Monthly", quarterly: "Quarterly", semi_annual: "Semi-Annual", annual: "Annual" };
  const CYCLE_PERIOD = { monthly: "/mo", quarterly: "/quarter", semi_annual: "/6 months", annual: "/year" };

  const priceLabel = cycleInfo.price
    ? `PKR ${cycleInfo.price.toLocaleString()}${CYCLE_PERIOD[cycle] || ""}`
    : "PKR 8,000/mo";

  const RECOMMENDED_CYCLE = "annual";

  const CycleCards = () => (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {proPricing.map(p => {
        const isSelected = cycle === p.cycle;
        const isRecommended = p.cycle === RECOMMENDED_CYCLE;
        return (
          <button key={p.cycle} onClick={() => setCycle(p.cycle)}
            className={`relative rounded-xl border-2 p-4 text-left transition-all cursor-pointer ${
              isSelected
                ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/30"
                : "border-(--ui-border) bg-(--ui-surface) hover:border-(--ui-border)"
            }`}>
            {isRecommended && (
              <span className="absolute -top-2.5 right-2 inline-flex items-center gap-0.5 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide">
                Best Value
              </span>
            )}
            <div className="text-xs font-medium text-(--ui-text-muted) mb-1">{CYCLE_LABELS[p.cycle]}</div>
            <div className="text-base font-bold text-(--ui-text)">PKR {p.price.toLocaleString()}</div>
            <div className="text-xs text-(--ui-text-muted) mt-0.5">PKR {p.monthly_equivalent.toLocaleString()}/mo</div>
            {p.discount_percent > 0 && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                  <Tag size={10} /> {p.discount_percent}% OFF
                </span>
              </div>
            )}
            {p.savings > 0 && (
              <div className="text-[11px] text-emerald-600 font-medium mt-1">
                Save PKR {p.savings.toLocaleString()}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );

  const OutletBreakdown = () => {
    const outlets = billing?.max_outlets || 1;
    if (outlets <= 1) return null;
    const unitPrice = cycleInfo.price || 8000;
    return (
      <p className="text-xs text-(--ui-text-muted) mt-2">
        {outlets} outlets × PKR {unitPrice.toLocaleString()} = <strong>PKR {(unitPrice * outlets).toLocaleString()}</strong>
      </p>
    );
  };

  const planColors = { free: "bg-(--ui-muted-surface) text-(--ui-text)", pro: "bg-emerald-100 text-emerald-700" };
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
      api.get("/api/billing/payment-history")
        .then(data => { setPayments(Array.isArray(data) ? data : []); setLoadingPayments(false); })
        .catch(() => setLoadingPayments(false));
    }, []);

    if (loadingPayments || !payments.length) return null;

    return (
      <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-(--ui-text) mb-4">Payment History</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-(--ui-text-muted)">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Plan</th>
                <th className="pb-2 font-medium">Period</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-b border-(--ui-border)">
                  <td className="py-2 text-(--ui-text)">{new Date(p.recorded_at).toLocaleDateString()}</td>
                  <td className="py-2 text-(--ui-text)">PKR {Number(p.amount).toLocaleString()}</td>
                  <td className="py-2 capitalize text-(--ui-text)">{p.plan} ({p.cycle})</td>
                  <td className="py-2 text-(--ui-text-muted) text-xs">
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
            <div className="w-full bg-(--ui-surface)/60 rounded-full h-2.5 mb-3">
              <div className={`h-2.5 rounded-full ${billing.trial_days_left <= 7 ? "bg-amber-500" : "bg-blue-500"}`}
                style={{ width: `${Math.max(2, ((45 - billing.trial_days_left) / 45) * 100)}%` }} />
            </div>
            <p className="text-sm text-(--ui-text-muted) mb-3">
              {billing.trial_days_left <= 7
                ? "Your trial is ending soon. Subscribe to continue using all features."
                : "You have full access to all Pro features during your trial. Choose a billing cycle:"}
            </p>
            <div className="mb-3"><CycleCards /><OutletBreakdown /></div>
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
            <div className="mt-3 mb-2"><CycleCards /><OutletBreakdown /></div>
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
            <div className="mb-3"><CycleCards /><OutletBreakdown /></div>
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
        <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <CreditCard size={20} className="text-(--ui-text-muted)" />
            <h2 className="text-lg font-semibold text-(--ui-text)">Current Plan</h2>
          </div>
          <div className="flex items-center gap-3 mb-4">
            <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold capitalize ${planColors[billing?.plan] || planColors.free}`}>
              {billing?.plan || "free"}
            </span>
            {billing?.billing_cycle && (
              <span className="text-sm text-(--ui-text-muted) capitalize">{billing.billing_cycle}</span>
            )}
            {paymentStatus !== "active" && billing?.plan !== "free" && (
              <span className={`text-sm font-semibold capitalize ${statusColors[paymentStatus] || "text-(--ui-text-muted)"}`}>
                {paymentStatus}
              </span>
            )}
          </div>
          {billing?.expires_at && (
            <div className="flex items-center gap-2 text-sm text-(--ui-text-muted)">
              <Clock size={14} />
              <span>Expires: {new Date(billing.expires_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
          )}
          {billing?.plan === "free" && (
            <p className="mt-3 text-sm text-(--ui-text-muted)">
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
          <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-(--ui-text) mb-2">Upgrade to Pro</h2>
            <p className="text-sm text-(--ui-text-muted) mb-4">Unlimited employees, products, and all features included. Choose a billing cycle:</p>
            <div className="mb-4"><CycleCards /><OutletBreakdown /></div>
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
      <Modal
        open={showUpgradeModal}
        onClose={submitting ? undefined : () => setShowUpgradeModal(false)}
        title="Request Upgrade to Pro"
        size="sm"
      >
        <p className="text-sm text-(--ui-text-muted) mb-1">{priceLabel} per outlet</p>
        {cycleInfo.discount_percent > 0 && (
          <p className="text-xs text-emerald-600 font-medium mb-2">
            {cycleInfo.discount_percent}% OFF — Save PKR {cycleInfo.savings?.toLocaleString()}
          </p>
        )}
        <div className="mb-3"><CycleCards /><OutletBreakdown /></div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-(--ui-text-muted) mb-1">Message (optional)</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)}
            className="w-full border border-(--ui-border) rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            rows={3} placeholder="Any questions or notes..." />
        </div>
        <ModalFooter>
          <Button onClick={() => setShowUpgradeModal(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button tone="primary" onClick={handleRequestUpgrade} disabled={submitting}>
            {submitting ? "Sending..." : "Send Request"}
          </Button>
        </ModalFooter>
      </Modal>
    </PageShell>
  );
}
