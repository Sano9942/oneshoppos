import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "../api";
import { useAuth } from "../auth/AuthProvider";
import { readContext, writeContext } from "../auth/authStore";

const DEFAULT_LABELS = {
  product: "Product",
  products: "Products",
  customer: "Customer",
  customers: "Customers",
  sale: "Sale",
  order: "Order",
  // M5 — extended label keys (preset may override)
  quantity_label: "Qty",
  customer_search_placeholder: "Search customer...",
};

// Canonical weight/length units — mirrors backend/config/industry-config.js WEIGHTED_UNITS
export const WEIGHTED_UNITS = ["kg", "g", "lb", "oz", "m", "cm"];

// Default unit vocabulary — mirrors backend DEFAULT_UNIT_VOCABULARY
export const DEFAULT_UNIT_VOCABULARY = [
  "pcs", "kg", "g", "lb", "oz", "m", "cm", "dozen", "pack",
];

export function isWeightedUnit(unit) {
  if (!unit) return false;
  return WEIGHTED_UNITS.includes(String(unit).toLowerCase());
}

const DEFAULT_PRESET = {
  industry_type: "general_retail",
  business_model: "buy_sell",
  labels: DEFAULT_LABELS,
  dashboard_widgets: {
    inventory_alerts: true, top_products: true, trends: true, attendance: true,
  },
  onboarding_steps: ["store", "product", "employees", "shift", "sale"],
  pos_layout_mode: "grid",
  visible_report_groups: null,
  pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  enabled_modes: [],
  unit_vocabulary: DEFAULT_UNIT_VOCABULARY,
  clinical_config: null,
};

const PresetContext = createContext({
  ...DEFAULT_PRESET,
  presetLoaded: false,
  updatePreset: () => {},
  refreshPreset: () => {},
  hasMode: () => true,
  label: (key) => DEFAULT_LABELS[key] || key,
});

export function PresetProvider({ children }) {
  const { employee, isBootstrapping, applyEffectiveSession } = useAuth();
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [presetLoaded, setPresetLoaded] = useState(false);

  const updatePreset = useCallback((data) => {
    if (data) {
      setPreset({ ...DEFAULT_PRESET, ...data });
      setPresetLoaded(true);
    }
  }, []);

  // Re-fetch the bootstrap payload in place (no logout) — called after a
  // business-module toggle so hasMode()/nav mode gates reflect the new
  // tenant_modes rows immediately, and after an outlet-context switch /
  // role-permission save (Step 14) so the effective permission set follows.
  // Keeps current preset on failure.
  const refreshPreset = useCallback(async () => {
    try {
      const data = await api.get("/api/context/bootstrap");
      if (data?.preset) {
        setPreset({ ...DEFAULT_PRESET, ...data.preset });
        setPresetLoaded(true);
      }
      // Step 14 (D2b): the bootstrap's employee payload carries the
      // outlet-effective role + permission set — overlay it onto the session.
      applyEffectiveSession?.(data?.employee);
    } catch {
      // transient failure — keep the preset we already have
    }
  }, [applyEffectiveSession]);

  // Bootstrap preset once employee is authenticated. Self-contained so any
  // route — including ones outside AppLayoutRedesign (e.g. /pos opens in a
  // new tab) — has presetLoaded available without a layout component
  // having to fetch it.
  //
  // Wait for AuthProvider to finish bootstrapping before fetching: the auth
  // fetch interceptor is wired in an AuthProvider useEffect, and child
  // useEffects run before parent useEffects in React. Without this guard,
  // the first /api/context/bootstrap call goes through unpatched fetch and
  // 401s — preset stays as default `general_retail`, which silently breaks
  // clinic/restaurant tenants on direct /pos navigation.
  //
  // Always flips presetLoaded=true on completion (success or error) so
  // consumers like POSRoute never hang.
  useEffect(() => {
    if (isBootstrapping) return;
    if (!employee?.id) {
      setPresetLoaded(false);
      return;
    }
    let cancelled = false;

    // Local helper — applies a successful bootstrap response.
    const apply = (data) => {
      if (data?.preset) setPreset({ ...DEFAULT_PRESET, ...data.preset });
      // Step 14 (D2b): overlay the context-effective permission set on boot
      // too — the AuthProvider boot path only knows the base role.
      applyEffectiveSession?.(data?.employee);
      // W1 — auto-seed single-branch context for tenants that never visit
      // /context-select (Free / single-outlet / context_selection_required=off).
      // Without this, restaurant pages that gate on
      // readContext()?.active_outlet_id (Floor / Checks / KDS) silently
      // bounce because the session never gets a context object written.
      if (!readContext() && data?.primary_outlet_id) {
        writeContext({
          scope_mode: "single_branch",
          active_outlet_id: data.primary_outlet_id,
          active_company_id: data?.companies?.[0]?.id ?? null,
        });
      }
      setPresetLoaded(true);
    };

    // W7 — first-call retry on transient 401. PresetContext intentionally
    // waits for !isBootstrapping before firing, but the auth fetch
    // interceptor races: AuthProvider's interceptor useEffect runs AFTER
    // PresetProvider's (child effects fire before parent effects on the
    // same commit), so PresetProvider's first fetch sees the previous
    // closure of window.fetch (which captured a null employee) and 401s
    // on the unauthenticated request.
    //
    // Yielding to a macrotask before the first call lets AuthProvider's
    // effect commit the new interceptor closure (with the live employee)
    // first. Retry stays as a safety net in case the wider event loop
    // takes longer than the yield. Removes the console 401 noise that
    // would otherwise fire on every login — important for field reps
    // since their dashboard route loads PresetContext immediately.
    const fetchWithRetry = async () => {
      await new Promise((r) => setTimeout(r, 0));
      try {
        return await api.get("/api/context/bootstrap");
      } catch (err) {
        if (cancelled) throw err;
        if (err?.status === 401) {
          await new Promise((r) => setTimeout(r, 600));
          return api.get("/api/context/bootstrap");
        }
        throw err;
      }
    };

    fetchWithRetry()
      .then((data) => {
        if (cancelled) return;
        apply(data);
      })
      .catch(() => {
        if (cancelled) return;
        setPresetLoaded(true);
      });
    return () => { cancelled = true; };
  }, [employee?.id, isBootstrapping, applyEffectiveSession]);

  const hasMode = useCallback(
    (modeName) => {
      // Before preset loads (pre-migration tenants or initial render),
      // return true so feature flags remain the sole gate
      if (!presetLoaded) return true;
      return preset.enabled_modes.includes(modeName);
    },
    [preset.enabled_modes, presetLoaded]
  );

  const label = useCallback(
    (key) => preset.labels[key] || key,
    [preset.labels]
  );

  return (
    <PresetContext.Provider value={{
      ...preset, presetLoaded, updatePreset, refreshPreset, hasMode, label,
    }}>
      {children}
    </PresetContext.Provider>
  );
}

export function usePreset() {
  return useContext(PresetContext);
}

export { DEFAULT_PRESET };
