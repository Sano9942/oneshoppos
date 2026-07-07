import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { PageShell, Modal, ModalFooter, Button, Input } from "../../ui/primitives";
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
  daraz: { name: "Daraz", category: "marketplace", icon: ShoppingBag, color: "text-(--ui-warning-fg)", fields: ["api_key", "api_secret", "oauth_token"], labels: { api_key: "App Key", api_secret: "App Secret", oauth_token: "Access Token" }, actions: ["sync-products", "pull-orders", "push-inventory"], note: "Manual sync only — click Pull Orders to fetch new orders. Automatic background sync coming soon." },
  shopify: { name: "Shopify", category: "marketplace", icon: ShoppingBag, color: "text-(--ui-success-fg)", link: "/integrations/shopify" },
  woocommerce: { name: "WooCommerce", category: "marketplace", icon: ShoppingBag, color: "text-(--ui-text-muted)", link: "/integrations/woocommerce" },
  facebook: { name: "Facebook Shop", category: "social", icon: MessageCircle, color: "text-(--ui-link)", fields: ["oauth_token"], labels: { oauth_token: "Page Access Token" }, configFields: ["catalog_id", "commerce_account_id"], actions: ["sync-products", "pull-orders", "push-inventory"], note: "Manual sync only — click Pull Orders to fetch new orders. Automatic background sync coming soon." },
  instagram: { name: "Instagram Shopping", category: "social", icon: MessageCircle, color: "text-(--ui-text-muted)", note: "Managed via Facebook Shop connection" },
  whatsapp: { name: "WhatsApp Business", category: "messaging", icon: MessageCircle, color: "text-(--ui-success-fg)", fields: ["api_key"], labels: { api_key: "API Token" }, configFields: ["phone_number_id", "business_account_id"], costWarning: "WhatsApp Business API charges per conversation. First 1,000 service conversations/month are free.", note: "Manual sync only — automatic inbound message sync coming soon." },
  google_merchant: { name: "Google Merchant Center", category: "feeds", icon: Rss, color: "text-(--ui-link)", fields: ["oauth_token"], labels: { oauth_token: "OAuth Token" }, configFields: ["merchant_id"], actions: ["sync-products"], note: "Manual sync only — click Sync Products to push your catalog. Automatic feed status checks coming soon." },
  // Payment providers
  xpay: { name: "xPay", category: "payment", icon: CreditCard, color: "text-(--ui-success-fg)", note: "Configured via environment variables (PAYMENT_GATEWAY=xpay)" },
  jazzcash: { name: "JazzCash", category: "payment", icon: CreditCard, color: "text-(--ui-danger-fg)", fields: ["api_key", "api_secret"], labels: { api_key: "Merchant ID", api_secret: "Merchant Password" }, configFields: ["return_url"] },
  easypaisa: { name: "Easypaisa", category: "payment", icon: CreditCard, color: "text-(--ui-success-fg)", fields: ["api_key", "api_secret"], labels: { api_key: "Store ID", api_secret: "Store Password" } },
  // SMS providers
  zong_sms: { name: "Zong SMS", category: "sms", icon: Smartphone, color: "text-(--ui-text-muted)", fields: ["api_key", "api_secret"], labels: { api_key: "Username", api_secret: "Password" }, configFields: ["sender_mask"] },
  jazz_sms: { name: "Jazz SMS", category: "sms", icon: Smartphone, color: "text-(--ui-danger-fg)", fields: ["api_key", "api_secret"], labels: { api_key: "Username", api_secret: "Password" }, configFields: ["sender_mask"] },
  twilio: { name: "Twilio", category: "sms", icon: Smartphone, color: "text-(--ui-link)", fields: ["api_key", "api_secret"], labels: { api_key: "Account SID", api_secret: "Auth Token" }, configFields: ["from_number"] },
};

function IntegrationCard({ provider, meta, channel, onConnect, onDisconnect, onTest, onSync, navigate }) {
  const isConnected = channel?.is_active || channel?.has_credentials;
  const hasLink = meta.link;

  return (
    <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 ${meta.color}`}>
            <meta.icon size={24} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-(--ui-text)">{meta.name}</span>
              {isConnected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-(--ui-success-bg) px-2 py-0.5 text-xs font-medium text-(--ui-success-fg)">
                  <Check size={12} /> Connected
                </span>
              )}
              {channel?.last_error && (
                <span className="inline-flex items-center gap-1 text-xs text-(--ui-danger-fg)">
                  <AlertCircle size={12} /> Error
                </span>
              )}
            </div>
            {channel?.last_sync_at && (
              <p className="mt-0.5 text-xs text-(--ui-text-muted)">
                Last sync: {new Date(channel.last_sync_at).toLocaleString()}
              </p>
            )}
            {meta.note && (
              <p className="mt-0.5 text-xs text-(--ui-text-muted) italic">{meta.note}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasLink ? (
            <button
              onClick={() => navigate(meta.link)}
              className="inline-flex items-center gap-1 rounded-lg border border-(--ui-border) px-3 py-1.5 text-xs font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
            >
              Manage <ExternalLink size={12} />
            </button>
          ) : isConnected ? (
            <>
              <button
                onClick={() => onTest(provider)}
                className="inline-flex items-center gap-1 rounded-lg border border-(--ui-border) px-3 py-1.5 text-xs font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
              >
                <RefreshCw size={12} /> Test
              </button>
              <button
                onClick={() => onDisconnect(provider)}
                className="inline-flex items-center gap-1 rounded-lg border border-(--ui-danger-bg) px-3 py-1.5 text-xs font-medium text-(--ui-danger-fg) hover:bg-(--ui-danger-bg)"
              >
                <X size={12} /> Disconnect
              </button>
            </>
          ) : meta.fields ? (
            <button
              onClick={() => onConnect(provider)}
              className="inline-flex items-center gap-1 rounded-lg bg-(--ui-primary) px-3 py-1.5 text-xs font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
            >
              <Plug size={12} /> Connect
            </button>
          ) : null}
        </div>
      </div>

      {/* Cost warning banner */}
      {meta.costWarning && (
        <div className="mt-3 rounded-lg bg-(--ui-warning-bg) px-3 py-2 text-xs text-(--ui-warning-fg)">
          <AlertCircle size={12} className="mb-0.5 mr-1 inline" />
          {meta.costWarning}
        </div>
      )}

      {/* Quick sync actions for connected integrations */}
      {isConnected && meta.actions?.length > 0 && (
        <div className="mt-3 flex gap-2 border-t border-(--ui-border) pt-3">
          {meta.actions.map((action) => (
            <button
              key={action}
              onClick={() => onSync(provider, action)}
              className="rounded-md bg-(--ui-muted-surface) px-2.5 py-1 text-xs font-medium text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
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
    <div className="flex items-center justify-between rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4">
      <div className="flex items-center gap-3">
        <Truck size={20} className="text-(--ui-text-muted)" />
        <div>
          <span className="font-medium text-(--ui-text)">{courier.name}</span>
          {courier.enabled && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-(--ui-success-bg) px-2 py-0.5 text-xs font-medium text-(--ui-success-fg)">
              <Check size={12} /> Enabled
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => navigate("/courier-settings")}
        className="inline-flex items-center gap-1 rounded-lg border border-(--ui-border) px-3 py-1.5 text-xs font-medium text-(--ui-text) hover:bg-(--ui-muted-surface)"
      >
        Configure <ExternalLink size={12} />
      </button>
    </div>
  );
}

function ConnectModal({ open, provider, meta, onClose, onSave }) {
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
    <Modal open={open} onClose={saving ? undefined : onClose} title={meta ? `Connect ${meta.name}` : ""} size="sm">
      {meta ? (
        <>
          <div className="space-y-3">
            {(meta.fields || []).map((field) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                  {meta.labels?.[field] || field}
                </label>
                <Input
                  type={field.includes("secret") || field.includes("token") ? "password" : "text"}
                  value={fields[field] || ""}
                  onChange={(e) => setFields((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder={`Enter ${meta.labels?.[field] || field}`}
                />
              </div>
            ))}
            {(meta.configFields || []).map((field) => (
              <div key={field}>
                <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                  {field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </label>
                <Input
                  type="text"
                  value={config[field] || ""}
                  onChange={(e) => setConfig((c) => ({ ...c, [field]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <ModalFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button tone="primary" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              Connect
            </Button>
          </ModalFooter>
        </>
      ) : null}
    </Modal>
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
    const category = PROVIDER_META[payload.provider].category;
    await api.post("/api/integrations/connect", { ...payload, category });
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
        // /api/integrations/test is a DB-only check — it confirms credentials
        // are saved, not that they authenticate. Say so honestly.
        toast.success(result.message || `${provider} credentials saved`);
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
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-(--ui-text-muted)">
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
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg bg-(--ui-muted-surface) p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-(--ui-surface) text-(--ui-text)"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
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
            <p className="py-8 text-center text-sm text-(--ui-text-muted)">No integrations in this category</p>
          )}
        </div>
      )}

      {/* Payment providers section */}
      {(activeTab === "all" || activeTab === "payment") && (
        <div className={activeTab === "all" ? "mt-8" : ""}>
          {activeTab === "all" && (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
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
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
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
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-(--ui-text-muted)">
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

      <ConnectModal
        open={!!(connectProvider && PROVIDER_META[connectProvider])}
        provider={connectProvider}
        meta={connectProvider ? PROVIDER_META[connectProvider] : null}
        onClose={() => setConnectProvider(null)}
        onSave={handleConnect}
      />
    </PageShell>
  );
}
