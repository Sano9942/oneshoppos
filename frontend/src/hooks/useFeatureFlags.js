import { useEffect, useMemo, useState } from "react";
import { API_BASE as API } from "../config";

// Fail-closed: all flags default to false so privileged features
// are hidden when the backend is unreachable or returns an error.
const DEFAULT_FLAGS = {
  backup_restore: false,
  e_invoicing_export: false,
  supplier_payables: false,
  approvals: false,
  notifications: false,
  accounting_core: false,
  crm_quotations: false,
  advanced_hr: false,
  multi_company: false,
  reports_enhanced_filters: false,
  reports_profit_layer: false,
  reports_inventory_health_plus: false,
  reports_exceptions: false,
  reports_scheduled_exports: false,
  context_selection_required: false,
  context_header_enforced: false,
  kiosk_context_locked: false,
};

// W3 — warm-cache key for last-known flags. On every successful fetch we
// write the resolved flag map to localStorage; on next mount we use it as
// the initial state (fast paint), then revalidate. Eliminates the ~1.5s
// flicker where restaurant/clinic/etc. nav items disappear on first paint
// because fail-closed defaults hide everything until the network resolves.
const FLAGS_CACHE_KEY = "sanopos_feature_flags_cache_v1";

function readCachedFlags() {
  try {
    const raw = localStorage.getItem(FLAGS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedFlags(next) {
  try {
    localStorage.setItem(FLAGS_CACHE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode, quota) — fail silent
  }
}

// Cross-component refresh: code that changes flags server-side (the Business
// Modules toggle page) dispatches this event; every mounted useFeatureFlags
// instance refetches and rewrites the warm cache, so nav/gates update
// in-place without a re-login.
export const FLAGS_REFRESH_EVENT = "sanopos:flags-refresh";

export function refreshFeatureFlags() {
  window.dispatchEvent(new Event(FLAGS_REFRESH_EVENT));
}

export default function useFeatureFlags(authHeaders) {
  // Initial state prefers cached flags so the sidebar/UI paints with the
  // last-known truth instead of all-false. `loading` still starts true so
  // anything that explicitly waits for first fetch keeps working.
  const [flags, setFlags] = useState(() => {
    const cached = readCachedFlags();
    return cached ? { ...DEFAULT_FLAGS, ...cached } : DEFAULT_FLAGS;
  });
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const onRefresh = () => setRefreshTick((t) => t + 1);
    window.addEventListener(FLAGS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(FLAGS_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    let mounted = true;
    const headers =
      typeof authHeaders === "function"
        ? authHeaders()
        : authHeaders && typeof authHeaders === "object"
          ? authHeaders
          : {};

    fetch(`${API}/api/feature-flags`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (!mounted) return;
        const next = { ...DEFAULT_FLAGS };
        (data?.flags || []).forEach((f) => {
          // Step 9 (D1c): `effective` is the outlet-aware state for the
          // caller's resolved outlet (company AND per-outlet); `enabled` is
          // company-level truth. Gates consume effective; older backends
          // without the field fall back to enabled.
          const on = f.effective !== undefined ? f.effective : f.enabled;
          next[f.key] = on === true || Number(on || 0) === 1;
        });
        setFlags(next);
        writeCachedFlags(next);
      })
      .catch(() => {
        if (!mounted) return;
        // Keep whatever was already in state (cached or default) on fetch
        // failure rather than resetting to DEFAULT_FLAGS — a transient
        // network blip should not yank the sidebar out from under the user.
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [authHeaders, refreshTick]);

  return useMemo(
    () => ({ flags, loading, refresh: refreshFeatureFlags }),
    [flags, loading]
  );
}
