import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell } from "../../ui/primitives";
import { api } from "../../api";
import { useToast } from "../../contexts/ToastContext";
import {
  Plug,
  ShoppingBag,
  MessageCircle,
  Rss,
  Truck,
  Check,
  X,
  RefreshCw,
  ExternalLink,
  AlertCircle,
  Loader2,
} from "lucide-react";

const TABS = [
  { key: "all", label: "All" },
  { key: "marketplace", label: "Marketplaces & Stores" },
  { key: "social", label: "Social Commerce" },
  { key: "messaging", label: "Messaging" },
  { key: "feeds", label: "Product Feeds" },
  { key: "courier", label: "Couriers" },
];

const PROVIDER_META = {
  daraz: { name: "Daraz", category: "marketplace", icon: ShoppingBag, color: "text-orange-500", fields: ["api_key", "api_secret", "oauth_token"], labels: { api_key: "App Key", api_secret: "App Secret", oauth_token: "Access Token" } },
  shopify: { name: "Shopify", category: "marketplace", icon: ShoppingBag, color: "text-green-600", link: "/integrations/shopify" },
  woocommerce: { name: "WooCommerce", category: "marketplace", icon: ShoppingBag, color: "text-purple-600", link: "/integrations/woocommerce" },
  facebook: { name: "Facebook Shop", category: "social", icon: MessageCircle, color: "text-blue-600", fields: ["oauth_token"], labels: { oauth_token: "Page Access Token" }, configFields: ["catalog_id", "commerce_account_id"] },
  instagram: { name: "Instagram Shopping", category: "social", icon: MessageCircle, color: "text-pink-500", note: "Managed via Facebook Shop connection" },
  whatsapp: { name: "WhatsApp Business", category: "messaging", icon: MessageCircle, color: "text-green-500", fields: ["api_key"], labels: { api_key: "API Token" }, configFields: ["phone_number_id", "business_account_id"] },
  google_merchant: { name: "Google Merchant Center", category: "feeds", icon: Rss, color: "text-blue-500", fields: ["oauth_token"], labels: { oauth_token: "OAuth Token" }, configFields: ["merchant_id"] },
};

function IntegrationCard({ provider, meta, channel, onConnect, onDisconnect, onTest, navigate }) {
  const isConnected = channel?.is_active || channel?.has_credentials;
  const hasLink = meta.link;

  return (
    <div className="flex items-start justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 ${meta.color}`}>
          <meta.icon size={24} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white">{meta.name}</span>
            {isConnected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <Check size={12} /> Connected
              </span>
            )}
            {channel?.last_error && (
              <span className="inline-flex items-center gap-1 text-xs text-red-500">
                <AlertCircle size={12} /> Error
              </span>
            )}
          </div>
          {channel?.last_sync_at && (
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Last sync: {new Date(channel.last_sync_at).toLocaleString()}
            </p>
          )}
          {meta.note && (
            <p className="mt-0.5 text-xs text-slate-400 italic">{meta.note}</p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {hasLink ? (
          <button
            onClick={() => navigate(meta.link)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Manage <ExternalLink size={12} />
          </button>
        ) : isConnected ? (
          <>
            <button
              onClick={() => onTest(provider)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <RefreshCw size={12} /> Test
            </button>
            <button
              onClick={() => onDisconnect(provider)}
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <X size={12} /> Disconnect
            </button>
          </>
        ) : meta.fields ? (
          <button
            onClick={() => onConnect(provider)}
            className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <Plug size={12} /> Connect
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CourierCard({ courier }) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-3">
        <Truck size={20} className="text-slate-400" />
        <div>
          <span className="font-medium text-slate-900 dark:text-white">{courier.name}</span>
          {courier.enabled && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
              <Check size={12} /> Enabled
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => navigate("/courier-settings")}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        Configure <ExternalLink size={12} />
      </button>
    </div>
  );
}

function ConnectModal({ provider, meta, onClose, onSave }) {
  const [fields, setFields] = useState({});
  const [config, setConfig] = useState({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { provider, ...fields };
      if (meta.configFields) {
        payload.config_json = JSON.stringify(config);
      }
      await onSave(payload);
      onClose();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
          Connect {meta.name}
        </h3>

        <div className="space-y-3">
          {(meta.fields || []).map((field) => (
            <div key={field}>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {meta.labels?.[field] || field}
              </label>
              <input
                type={field.includes("secret") || field.includes("token") ? "password" : "text"}
                value={fields[field] || ""}
                onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                placeholder={`Enter ${meta.labels?.[field] || field}`}
              />
            </div>
          ))}
          {(meta.configFields || []).map((field) => (
            <div key={field}>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </label>
              <input
                type="text"
                value={config[field] || ""}
                onChange={(e) => setConfig((c) => ({ ...c, [field]: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              />
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Connect
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IntegrationsHubRedesign() {
  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [connectProvider, setConnectProvider] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();

  const loadHub = useCallback(() => {
    api.get("/api/integrations/hub")
      .then(setHub)
      .catch((err) => toast.error(err.message || "Failed to load integrations"))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => { loadHub(); }, [loadHub]);

  const handleConnect = async (payload) => {
    await api.post("/api/integrations/connect", payload);
    toast.success(`${payload.provider} connected`);
    loadHub();
  };

  const handleDisconnect = async (provider) => {
    await api.post("/api/integrations/disconnect", { provider });
    toast.success(`${provider} disconnected`);
    loadHub();
  };

  const handleTest = async (provider) => {
    try {
      const result = await api.post("/api/integrations/test", { provider });
      if (result.success) {
        toast.success(`${provider} connection OK`);
      } else {
        toast.error(result.error || "Connection test failed");
      }
    } catch (err) {
      toast.error(err.message || "Connection test failed");
    }
  };

  // Build channel map from hub data
  const channelMap = {};
  if (hub) {
    for (const ch of hub.channels || []) {
      channelMap[ch.provider] = ch;
    }
    if (hub.shopify) {
      channelMap.shopify = { ...hub.shopify, is_active: hub.shopify.is_active, has_credentials: true };
    }
    if (hub.woocommerce) {
      channelMap.woocommerce = hub.woocommerce;
    }
  }

  const filteredProviders = Object.entries(PROVIDER_META).filter(([, meta]) => {
    if (activeTab === "all") return true;
    return meta.category === activeTab;
  });

  if (loading) {
    return (
      <PageShell title="Integrations">
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-400">
          Loading...
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Integrations"
      subtitle="Connect your store to marketplaces, social channels, messaging, and courier services"
    >
      {/* Tabs */}
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Channel integrations */}
      {activeTab !== "courier" && (
        <div className="space-y-3">
          {filteredProviders.map(([key, meta]) => (
            <IntegrationCard
              key={key}
              provider={key}
              meta={meta}
              channel={channelMap[key]}
              onConnect={setConnectProvider}
              onDisconnect={handleDisconnect}
              onTest={handleTest}
              navigate={navigate}
            />
          ))}
          {filteredProviders.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">No integrations in this category</p>
          )}
        </div>
      )}

      {/* Courier section */}
      {(activeTab === "all" || activeTab === "courier") && (
        <div className={activeTab === "all" ? "mt-8" : ""}>
          {activeTab === "all" && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Courier Services
            </h2>
          )}
          <div className="space-y-3">
            {(hub?.couriers || []).map((courier) => (
              <CourierCard key={courier.id} courier={courier} />
            ))}
          </div>
        </div>
      )}

      {/* Connect modal */}
      {connectProvider && PROVIDER_META[connectProvider] && (
        <ConnectModal
          provider={connectProvider}
          meta={PROVIDER_META[connectProvider]}
          onClose={() => setConnectProvider(null)}
          onSave={handleConnect}
        />
      )}
    </PageShell>
  );
}
