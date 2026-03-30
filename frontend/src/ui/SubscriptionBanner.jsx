import { useAuth } from "../auth/AuthProvider";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Clock, XCircle } from "lucide-react";

export default function SubscriptionBanner() {
  const { subscriptionStatus, subscriptionDaysLeft } = useAuth();
  const navigate = useNavigate();

  if (!subscriptionStatus || subscriptionStatus === "active") return null;

  if (subscriptionStatus === "trial" && subscriptionDaysLeft != null && subscriptionDaysLeft <= 7) {
    return (
      <div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
        <Clock size={14} />
        <span>Pro trial ends in {subscriptionDaysLeft} {subscriptionDaysLeft === 1 ? "day" : "days"}</span>
        <button onClick={() => navigate("/billing")} className="ml-2 underline hover:no-underline cursor-pointer">Subscribe now</button>
      </div>
    );
  }

  if (subscriptionStatus === "grace") {
    return (
      <div className="flex items-center justify-center gap-2 bg-red-500 px-4 py-2 text-sm font-medium text-white">
        <AlertTriangle size={14} />
        <span>Trial expired — {subscriptionDaysLeft ?? 0} days left to subscribe</span>
        <button onClick={() => navigate("/billing")} className="ml-2 underline hover:no-underline cursor-pointer">Go to Billing</button>
      </div>
    );
  }

  if (subscriptionStatus === "expired") {
    return (
      <div className="flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-medium text-white">
        <XCircle size={14} />
        <span>Subscription expired — your account is read-only</span>
        <button onClick={() => navigate("/billing")} className="ml-2 underline hover:no-underline cursor-pointer">Subscribe to continue</button>
      </div>
    );
  }

  return null;
}
