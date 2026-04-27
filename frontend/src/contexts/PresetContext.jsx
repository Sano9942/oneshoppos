import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { api } from "../api";
import { useAuth } from "../auth/AuthProvider";

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
    inventory_alerts: true, top_products: true, trends: true,
    attendance: true, floor_plan: false, appointments_today: false,
  },
  onboarding_steps: ["store", "product", "employees", "shift", "sale"],
  pos_layout_mode: "grid",
  visible_report_groups: null,
  pos_search_config: { show_barcode: true, show_sku: true, show_price: true },
  enabled_modes: [],
  unit_vocabulary: DEFAULT_UNIT_VOCABULARY,
};

const PresetContext = createContext({
  ...DEFAULT_PRESET,
  presetLoaded: false,
  updatePreset: () => {},
  hasMode: () => true,
  label: (key) => DEFAULT_LABELS[key] || key,
});

export function PresetProvider({ children }) {
  const { employee } = useAuth();
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [presetLoaded, setPresetLoaded] = useState(false);

  const updatePreset = useCallback((data) => {
    if (data) {
      setPreset({ ...DEFAULT_PRESET, ...data });
      setPresetLoaded(true);
    }
  }, []);

  // Bootstrap preset once employee is authenticated. Self-contained so any
  // route — including ones outside AppLayoutRedesign (e.g. /pos opens in a
  // new tab) — has presetLoaded available without a layout component
  // having to fetch it. Always flips presetLoaded=true so consumers
  // (POSRoute) don't hang forever if the endpoint fails.
  useEffect(() => {
    if (!employee?.id) {
      setPresetLoaded(false);
      return;
    }
    let cancelled = false;
    api.get("/api/context/bootstrap")
      .then((data) => {
        if (cancelled) return;
        if (data?.preset) setPreset({ ...DEFAULT_PRESET, ...data.preset });
        setPresetLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPresetLoaded(true);
      });
    return () => { cancelled = true; };
  }, [employee?.id]);

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
      ...preset, presetLoaded, updatePreset, hasMode, label,
    }}>
      {children}
    </PresetContext.Provider>
  );
}

export function usePreset() {
  return useContext(PresetContext);
}

export { DEFAULT_PRESET };
