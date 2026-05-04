import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { api } from "../api";

const SESSION_DISMISS_KEY = "multi_outlet_banner_dismissed";

/**
 * MultiOutletEnabledBanner
 *
 * Shown once after a tenant transitions from 1 → 2 outlets, telling them we
 * auto-enabled the multi-outlet flag bundle (context selection, outlet
 * pricing, outlet visibility, price books). Dismissible per session.
 *
 * Visibility: company_profile.multi_outlet_flags_seeded === true AND outlet
 * count >= 2 AND not dismissed this session.
 */
export default function MultiOutletEnabledBanner() {
  const navigate = useNavigate();
  const [shouldShow, setShouldShow] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(SESSION_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (dismissed) return;
    let cancelled = false;
    async function check() {
      try {
        // /api/billing/status surfaces both `multi_outlet_flags_seeded`
        // (added in PR 5) and `max_outlets`. We use max_outlets as a proxy
        // for "tenant has paid for >=2 outlets"; combined with the seeded
        // flag we know the auto-enable already fired.
        const billing = await api.get("/api/billing/status");
        const seeded = billing?.multi_outlet_flags_seeded === true;
        const maxOutlets = Number(billing?.max_outlets || 1);
        if (!cancelled) setShouldShow(seeded && maxOutlets >= 2);
      } catch {
        // Silently hide on error — banner is informational.
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [dismissed]);

  if (dismissed || !shouldShow) return null;

  function handleDismiss() {
    try {
      sessionStorage.setItem(SESSION_DISMISS_KEY, "1");
    } catch {
      // sessionStorage disabled — banner just stays hidden in memory
    }
    setDismissed(true);
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <Sparkles size={16} className="mt-0.5 shrink-0 text-emerald-600" />
      <div className="flex-1">
        <p className="font-medium text-emerald-900">Multi-outlet features enabled</p>
        <p className="mt-0.5 text-xs text-emerald-800">
          We turned on outlet selection, per-outlet pricing, outlet-level product visibility, and price books.
          You can manage price lists in the Inventory section. Outlet visibility appears on each product's edit page.
        </p>
      </div>
      <button
        type="button"
        onClick={() => navigate("/price-lists")}
        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer"
      >
        Manage price lists
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss"
        className="rounded-full p-1 text-emerald-600 hover:bg-emerald-100 cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}
