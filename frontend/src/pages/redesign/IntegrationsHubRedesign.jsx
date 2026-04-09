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
  CreditCard,
  Smartphone,
} from "lucide-react";

const TABS = [
  { key: "all", label: "All" },
  { key: "marketplace", label: "Marketplaces & Stores" },
  { key: "social", label: "Social Commerce" },
  { key: "messaging", label: "Messaging" },
  { key: "feeds", label: "Product Feeds" },
  { key: "courier", label: "Couriers" },
  { key: "payment", label: "Payments" },
  { key: "sms", label: "SMS" },
];

const PROVIDER_META = {
  daraz: { name: "Daraz", category: "marketplace", icon: ShoppingBag, color: "text-orange-500", fields: ["api_key", "api_secret", "oauth_token"], labels: { api_key: "App Key", api_secret: "App Secret", oauth_token: "Access Token" }, actions: ["sync-products", "pull-orders", "push-inventory"] },
  shopify: { name: "Shopify", category: "marketplace", icon: ShoppingBag, color: "text-green-600", link: "/integrations/shopify" },
  woocommerce: { name: "WooCommerce", category: "marketplace", icon: ShoppingBag, color: "text-purple-600", link: "/integrations/woocommerce" },
  facebook: { name: "Facebook Shop", category: "social", icon: MessageCircle, color: "text-blue-600", fields: ["oauth_token"], labels: { oauth_token: "Page Access Token" }, configFields: ["catalog_id", "commerce_account_id"], actions: ["sync-products", "pull-orders", "push-inventory"] },
  instagram: { name: "Instagram Shopping", category: "social", icon: MessageCircle, color: "text-pink-500", note: "Managed via Facebook Shop connection" },
  whatsapp: { name: "WhatsApp Business", category: "messaging", icon: MessageCircle, color: "text-green-500", fields: ["api_key"], labels: { api_key: "API Token" }, configFields: ["phone_number_id", "business_account_id"], costWarning: "WhatsApp Business API charges per conversation. First 1,000 service conversations/month are free." },
  google_merchant: { name: "Google Merchant Center", category: "feeds", icon: Rss, color: "text-blue-500", fields: ["oauth_token"], labels: { oauth_token: "OAuth Token" }, configFields: ["merchant_id"], actions: ["sync-products"] },
  // Payment providers
  xpay: { name: "xPay", category: "payment", icon: CreditCard, color: "text-emerald-600", note: "Configured via environment variables (PAYMENT_GATEWAY=xpay)" },
  jazzcash: { name: "JazzCash", category: "payment", icon: CreditCard, color: "text-red-500", fields: ["api_key", "api_secret"], labels: { api_key: "Merchant ID", api_secret: "Merchant Password" }, configFields: ["return_url"] },
  easypaisa: { name: "Easypaisa", category: "payment", icon: CreditCard, color: "text-green-600", fields: ["api_key", "api_secret"], labels: { api_key: "Store ID", api_secret: "Store Password" } },
  // SMS providers
  zong_sms: { name: "Zong SMS", category: "sms", icon: Smartphone, color: "text-purple-600", fields: ["api_key", "api_secret"], labels: { api_key: "Username", api_secret: "Password" }, configFields: ["sender_mask"] },
  jazz_sms: { name: "Jazz SMS", category: "sms", icon: Smartphone, color: "text-red-500", fields: ["api_key", "api_secret"], labels: { api_key: "Username", api_secret: "Password" }, configFields: ["sender_mask"] },
  twilio: { name: "Twilio", category: "sms", icon: Smartphone, color: "text-blue-600", fields: ["api_key", "api_secret"], labels: { api_key: "Account SID", api_secret: "Auth Token" }, configFields: ["from_number"] },
};

function IntegrationCard({ provider, meta, channel, onConnect, onDisconnect, onTest, onSync, navigate }) {
  const isConnected = channel?.is_active || channel?.has_credentials;
  const hasLink = meta.link;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start justify-between">
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

      {/* Cost warning banner */}
      {meta.costWarning && (
        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
          <AlertCircle size={12} className="mb-0.5 mr-1 inline" />
          {meta.costWarning}
        </div>
      )}

      {/* Quick sync actions for connected integrations */}
      {isConnected && meta.actions?.length > 0 && (
        <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
          {meta.actions.map((action) => (
            <button
              key={action}
              onClick={() => onSync(provider, action)}
              className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
            >
              {action.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
      )}
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

  const handleSync = async (provider, action) => {
    try {
      const result = await api.post(`/api/integrations/${provider}/${action}`);
      if (result.synced !== undefined) {
        toast.success(`${provider}: ${result.synced} synced, ${result.failed || 0} failed`);
      } else if (result.imported !== undefined) {
        toast.success(`${provider}: ${result.imported} imported, ${result.skipped || 0} skipped`);
      } else if (result.updated !== undefined) {
        toast.success(`${provider}: ${result.updated} updated`);
      } else {
        toast.success(`${provider} ${action} completed`);
      }
      loadHub();
    } catch (err) {
      toast.error(err.message || `${action} failed`);
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
    // Payment and SMS have dedicated sections
    if (meta.category === "payment" || meta.category === "sms") return false;
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
              onSync={handleSync}
              navigate={navigate}
            />
          ))}
          {filteredProviders.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">No integrations in this category</p>
          )}
        </div>
      )}

      {/* Payment providers section */}
      {(activeTab === "all" || activeTab === "payment") && (
        <div className={activeTab === "all" ? "mt-8" : ""}>
          {activeTab === "all" && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Payment Gateways
            </h2>
          )}
          <div className="space-y-3">
            {Object.entries(PROVIDER_META)
              .filter(([, meta]) => meta.category === "payment")
              .map(([key, meta]) => (
                <IntegrationCard
                  key={key}
                  provider={key}
                  meta={meta}
                  channel={(hub?.payment_providers || []).find((p) => p.provider === key)}
                  onConnect={setConnectProvider}
                  onDisconnect={handleDisconnect}
                  onTest={handleTest}
                  onSync={handleSync}
                  navigate={navigate}
                />
              ))}
          </div>
        </div>
      )}

      {/* SMS providers section */}
      {(activeTab === "all" || activeTab === "sms") && (
        <div className={activeTab === "all" ? "mt-8" : ""}>
          {activeTab === "all" && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              SMS Providers
            </h2>
          )}
          <div className="space-y-3">
            {Object.entries(PROVIDER_META)
              .filter(([, meta]) => meta.category === "sms")
              .map(([key, meta]) => (
                <IntegrationCard
                  key={key}
                  provider={key}
                  meta={meta}
                  channel={(hub?.sms_providers || []).find((p) => p.provider === key)}
                  onConnect={setConnectProvider}
                  onDisconnect={handleDisconnect}
                  onTest={handleTest}
                  onSync={handleSync}
                  navigate={navigate}
                />
              ))}
          </div>
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
