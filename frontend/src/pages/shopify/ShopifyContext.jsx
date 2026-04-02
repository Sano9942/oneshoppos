import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { api } from "../../api";

const ShopifyContext = createContext();

export const useShopify = () => {
  const context = useContext(ShopifyContext);
  if (!context) {
    throw new Error("useShopify must be used within a ShopifyProvider");
  }
  return context;
};

export const ShopifyProvider = ({ children }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Shared State
  const [config, setConfig] = useState({
    connected: false,
    shop_domain: "",
    access_token: "",
    api_version: "2025-10",
    webhook_secret: "",
    default_location_id: "",
  });
  const [status, setStatus] = useState(null);
  const [outlets, setOutlets] = useState([]);
  const [mappingCounts, setMappingCounts] = useState({
    products: 0,
    locations: 0,
    customers: 0,
  });

  const apiFetch = useCallback(
    (path, options = {}) => api.raw(path, options),
    [],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [cfgRes, statusRes, prodMapRes, locMapRes, custMapRes, outletsRes] =
        await Promise.all([
          apiFetch("/api/integrations/shopify/config"),
          apiFetch("/api/integrations/shopify/status"),
          apiFetch("/api/integrations/mappings/products"),
          apiFetch("/api/integrations/mappings/locations"),
          apiFetch("/api/integrations/mappings/customers"),
          apiFetch("/api/outlets"),
        ]);

      const cfg = await cfgRes.json();
      const st = await statusRes.json();
      const pm = await prodMapRes.json();
      const lm = await locMapRes.json();
      const cm = await custMapRes.json();
      const outletsData = await outletsRes.json();

      if (!cfgRes.ok) throw new Error(cfg.error || "Failed loading config");
      if (!statusRes.ok) throw new Error(st.error || "Failed loading status");

      const next =
        cfg.connected && cfg.config
          ? {
              connected: true,
              shop_domain: cfg.config.shop_domain || "",
              access_token: "",
              api_version: cfg.config.api_version || "2025-10",
              webhook_secret: "",
              default_location_id: cfg.config.default_location_id || "",
            }
          : {
              connected: false,
              shop_domain: "",
              access_token: "",
              api_version: "2025-10",
              webhook_secret: "",
              default_location_id: "",
            };

      setConfig(next);
      setStatus(st);
      setOutlets(outletsData.outlets || []);
      setMappingCounts({
        products: (pm.mappings || []).length,
        locations: (lm.mappings || []).length,
        customers: (cm.mappings || []).length,
      });
    } catch (e) {
      setError(e.message || "Failed to load Shopify integration data");
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const value = {
    loading,
    setLoading,
    error,
    setError,
    success,
    setSuccess,
    config,
    setConfig,
    status,
    setStatus,
    outlets,
    mappingCounts,
    apiFetch,
    loadAll,
  };

  return (
    <ShopifyContext.Provider value={value}>{children}</ShopifyContext.Provider>
  );
};
