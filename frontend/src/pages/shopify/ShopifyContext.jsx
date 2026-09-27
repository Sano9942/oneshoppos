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

// Secrets are never loaded back: the form shows them empty and an empty field
// keeps the saved value. New connections default to a Dev Dashboard app, the
// only kind of app Shopify lets you create now.
const emptyConfig = {
  connected: false,
  shop_domain: "",
  api_version: "2025-10",
  default_location_id: "",
  auth_mode: "app",
  saved_auth_mode: null,
  client_id: "",
  client_secret: "",
  access_token: "",
  webhook_secret: "",
  access_token_expires_at: null,
  last_error: null,
};

export const ShopifyProvider = ({ children }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Shared State
  const [config, setConfig] = useState(emptyConfig);
  const [status, setStatus] = useState(null);
  const [outlets, setOutlets] = useState([]);
  const [locationMappings, setLocationMappings] = useState([]);
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
              ...emptyConfig,
              connected: true,
              shop_domain: cfg.config.shop_domain || "",
              api_version: cfg.config.api_version || "2025-10",
              default_location_id: cfg.config.default_location_id || "",
              auth_mode: cfg.config.auth_mode || "token",
              saved_auth_mode: cfg.config.auth_mode || "token",
              client_id: cfg.config.client_id || "",
              access_token_expires_at: cfg.config.access_token_expires_at || null,
              last_error: cfg.config.last_error || null,
            }
          : emptyConfig;

      setConfig(next);
      setStatus(st);
      setOutlets(outletsData.outlets || []);
      setLocationMappings(lm.mappings || []);
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
    locationMappings,
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
