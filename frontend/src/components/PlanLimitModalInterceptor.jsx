import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X, Sparkles } from "lucide-react";
import { PLAN_LIMIT_EVENT } from "../api";

/**
 * PlanLimitModalInterceptor
 *
 * Listens for the global PLAN_LIMIT_EVENT dispatched by api.js whenever an API
 * call returns 403 + { code: "PLAN_LIMIT_REACHED" }. Renders a single global
 * modal regardless of which page triggered the limit.
 *
 * Mounted ONCE inside AppLayoutRedesign. Per-page error toasts still fire via
 * the original rejected promise — this is in addition, not a replacement.
 */
export default function PlanLimitModalInterceptor() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    function handler(e) {
      setDetail(e.detail || {});
      setOpen(true);
    }
    window.addEventListener(PLAN_LIMIT_EVENT, handler);
    return () => window.removeEventListener(PLAN_LIMIT_EVENT, handler);
  }, []);

  if (!open) return null;

  const used = detail?.current;
  const limit = detail?.limit;
  const message = detail?.error || "You've reached a plan limit.";

  return (
    <div
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/45 px-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md rounded-(--ui-radius-md) bg-(--ui-surface) p-6 shadow-(--ui-shadow-lg)"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="ui-focus-ring absolute right-3 top-3 rounded-full p-1 text-(--ui-text-muted) hover:bg-(--ui-muted-surface) hover:text-(--ui-text) cursor-pointer"
        >
          <X size={18} />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-(--ui-warning-bg)">
          <AlertTriangle size={24} className="text-(--ui-warning-fg)" />
        </div>

        <h2 className="mb-2 text-lg font-semibold text-(--ui-text)">
          Plan limit reached
        </h2>
        <p className="text-sm text-(--ui-text-muted)">{message}</p>

        {used != null && limit != null && (
          <p className="mt-2 text-xs text-(--ui-text-muted)">
            Currently using <span className="font-semibold text-(--ui-text)">{used} of {limit}</span> on the Free plan.
          </p>
        )}

        <div className="mt-5 rounded-(--ui-radius-md) border border-(--ui-border-strong) bg-(--ui-muted-surface) p-4">
          <div className="flex items-start gap-3">
            <Sparkles size={18} className="mt-0.5 shrink-0 text-(--ui-text)" />
            <div>
              <p className="text-sm font-semibold text-(--ui-text)">Upgrade to Pro</p>
              <p className="mt-1 text-xs text-(--ui-text-muted)">
                Unlimited products and employees, plus advanced features. <span className="font-semibold">8000 PKR/month</span> per outlet.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ui-focus-ring flex-1 rounded-(--ui-radius-pill) border border-(--ui-border-strong) bg-(--ui-surface) px-4 py-2.5 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) cursor-pointer"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              navigate("/billing");
            }}
            className="ui-focus-ring flex-1 rounded-(--ui-radius-pill) bg-(--ui-primary) px-4 py-2.5 text-sm font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong) cursor-pointer"
          >
            Upgrade to Pro
          </button>
        </div>
      </div>
    </div>
  );
}
