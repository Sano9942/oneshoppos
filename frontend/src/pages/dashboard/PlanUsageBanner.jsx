import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
import { api } from "../../api";

const SESSION_DISMISS_KEY = "plan_usage_banner_dismissed";
const POLL_INTERVAL_MS = 60_000;
const WARN_THRESHOLD = 0.8; // ≥80% triggers the amber banner

/**
 * PlanUsageBanner
 *
 * Polls /api/billing/usage on mount + every 60s and shows an amber banner
 * when any capped dimension is at >=80% utilisation. Dismissible per browser
 * session via sessionStorage.
 *
 * Hidden when:
 *   - usage fetch fails (best-effort; never blocks dashboard render)
 *   - all dimensions are below the warn threshold
 *   - all dimensions are unlimited (limit === null, e.g. Pro plan)
 *   - the user has dismissed the banner this session
 */
export default function PlanUsageBanner() {
  const navigate = useNavigate();
  const [usage, setUsage] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const [plan, setPlan] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchUsage() {
      try {
        const [u, s] = await Promise.all([
          api.get("/api/billing/usage"),
          api.get("/api/billing/status").catch(() => null),
        ]);
        if (!cancelled) {
          setUsage(u);
          if (s?.plan) setPlan(s.plan);
        }
      } catch {
        // Endpoint not available (e.g. tenant without billing perm) — hide silently.
      }
    }
    fetchUsage();
    const id = setInterval(fetchUsage, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (dismissed || !usage) return null;

  // Pro tenants buy additional outlets via /billing/add-outlet — don't surface
  // the outlet dimension here as a "Upgrade to Pro" upsell. employees/products
  // already have limit=null on Pro and are filtered by the line below.
  const dimensions = plan === "pro"
    ? [["employees", "employees"], ["products", "products"]]
    : [["employees", "employees"], ["products", "products"], ["outlets", "outlets"]];

  const overLimit = [];
  for (const [key, label] of dimensions) {
    const dim = usage[key];
    if (!dim || dim.limit == null) continue;
    if (dim.limit > 0 && dim.used / dim.limit >= WARN_THRESHOLD) {
      overLimit.push({ label, used: dim.used, limit: dim.limit });
    }
  }
  if (!overLimit.length) return null;

  const summary = overLimit
    .map((d) => `${d.used} of ${d.limit} ${d.label}`)
    .join(", ");

  function handleDismiss() {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      // sessionStorage disabled — banner just stays hidden in memory
    }
    setDismissed(true);
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-(--ui-radius-md) bg-(--ui-warning-bg) p-3 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-(--ui-warning-fg)" />
      <div className="flex-1">
        <p className="font-semibold text-(--ui-warning-fg)">Approaching plan limit</p>
        <p className="mt-0.5 text-xs text-(--ui-warning-fg)">
          You're using {summary}. Upgrade to Pro for unlimited.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/billing")}
        className="cursor-pointer rounded-full bg-(--ui-primary) px-3.5 py-1.5 text-xs font-semibold text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
      >
        Upgrade
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="cursor-pointer rounded-full p-1 text-(--ui-warning-fg) hover:opacity-70"
      >
        <X size={14} />
      </button>
    </div>
  );
}
