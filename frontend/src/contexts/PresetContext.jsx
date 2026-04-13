import { createContext, useContext, useState, useCallback } from "react";

const DEFAULT_LABELS = {
  product: "Product",
  products: "Products",
  customer: "Customer",
  customers: "Customers",
  sale: "Sale",
  order: "Order",
};

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
  enabled_modes: [],
};

const PresetContext = createContext({
  ...DEFAULT_PRESET,
  presetLoaded: false,
  updatePreset: () => {},
  hasMode: () => true,
  label: (key) => DEFAULT_LABELS[key] || key,
});

export function PresetProvider({ children }) {
  const [preset, setPreset] = useState(DEFAULT_PRESET);
  const [presetLoaded, setPresetLoaded] = useState(false);

  const updatePreset = useCallback((data) => {
    if (data) {
      setPreset({ ...DEFAULT_PRESET, ...data });
      setPresetLoaded(true);
    }
  }, []);

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
