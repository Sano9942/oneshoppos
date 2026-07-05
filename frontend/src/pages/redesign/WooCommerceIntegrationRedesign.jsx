import { useState, useEffect, useCallback } from "react";
import { PageShell } from "../../ui/primitives";
import { api } from "../../api";
import {
  Link2,
  Unplug,
  Download,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from "lucide-react";

const TABS = [
  { id: "connection", label: "Connection" },
  { id: "products", label: "Products" },
  { id: "stock", label: "Stock Sync" },
];

export default function WooCommerceIntegrationRedesign() {
  const [tab, setTab] = useState("connection");
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const data = await api.get("/api/integrations/woocommerce/status");
      setStatus(data);
    } catch {
      setStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  if (loading) {
    return (
      <PageShell title="WooCommerce Integration">
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-(--ui-text-muted)" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="WooCommerce Integration"
      subtitle={
        status?.connected
          ? `Connected to ${status.store_url}`
          : "Not connected"
      }
    >
      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-lg border border-(--ui-border) bg-(--ui-muted-surface) p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-(--ui-surface) text-(--ui-text)"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "connection" && (
        <ConnectionTab status={status} onRefresh={loadStatus} />
      )}
      {tab === "products" && <ProductsTab connected={status?.connected} />}
      {tab === "stock" && <StockTab connected={status?.connected} />}
    </PageShell>
  );
}

/* ── Connection Tab ──────────────────────────────────────────────── */

function ConnectionTab({ status, onRefresh }) {
  const [storeUrl, setStoreUrl] = useState("");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const connect = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api.post("/api/integrations/woocommerce/connect", {
        store_url: storeUrl,
        consumer_key: consumerKey,
        consumer_secret: consumerSecret,
      });
      setMsg({ type: "success", text: "Connected successfully!" });
      setStoreUrl("");
      setConsumerKey("");
      setConsumerSecret("");
      onRefresh();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect WooCommerce? This will clear credentials."))
      return;
    try {
      await api.post("/api/integrations/woocommerce/disconnect", {});
      setMsg({ type: "success", text: "Disconnected." });
      onRefresh();
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {msg && (
        <div
          className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
            msg.type === "success"
              ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
              : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
          }`}
        >
          {msg.type === "success" ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {msg.text}
        </div>
      )}

      {status?.connected ? (
        <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-(--ui-success-bg)">
              <Link2 className="h-5 w-5 text-(--ui-success-fg)" />
            </div>
            <div>
              <p className="font-semibold text-(--ui-text)">Connected</p>
              <p className="text-sm text-(--ui-text-muted)">{status.store_url}</p>
            </div>
          </div>
          <button
            onClick={disconnect}
            className="flex items-center gap-2 rounded-lg border border-(--ui-danger-bg) px-4 py-2 text-sm font-medium text-(--ui-danger-fg) hover:bg-(--ui-danger-bg)"
          >
            <Unplug className="h-4 w-4" />
            Disconnect
          </button>
        </div>
      ) : (
        <form
          onSubmit={connect}
          className="space-y-4 rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6"
        >
          <h3 className="text-base font-semibold text-(--ui-text)">
            Connect WooCommerce Store
          </h3>
          <p className="text-sm text-(--ui-text-muted)">
            Enter your WooCommerce store URL and REST API credentials. You can
            generate API keys in WooCommerce &rarr; Settings &rarr; Advanced
            &rarr; REST API.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-(--ui-text)">
              Store URL
            </label>
            <input
              type="url"
              required
              placeholder="https://yourstore.com"
              value={storeUrl}
              onChange={(e) => setStoreUrl(e.target.value)}
              className="w-full rounded-lg border border-(--ui-border) px-3 py-2 text-sm focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-(--ui-text)">
              Consumer Key
            </label>
            <input
              type="text"
              required
              placeholder="ck_..."
              value={consumerKey}
              onChange={(e) => setConsumerKey(e.target.value)}
              className="w-full rounded-lg border border-(--ui-border) px-3 py-2 text-sm font-mono focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-(--ui-text)">
              Consumer Secret
            </label>
            <input
              type="password"
              required
              placeholder="cs_..."
              value={consumerSecret}
              onChange={(e) => setConsumerSecret(e.target.value)}
              className="w-full rounded-lg border border-(--ui-border) px-3 py-2 text-sm font-mono focus:border-(--ui-focus) focus:ring-1 focus:ring-(--ui-focus) focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-(--ui-primary) px-4 py-2.5 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            {saving ? "Connecting..." : "Connect"}
          </button>
        </form>
      )}
    </div>
  );
}

/* ── Products Tab ────────────────────────────────────────────────── */

function ProductsTab({ connected }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const importProducts = async () => {
    setImporting(true);
    setResult(null);
    setError(null);
    try {
      const data = await api.post("/api/integrations/woocommerce/import-products", {});
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  if (!connected) {
    return (
      <div className="rounded-xl border border-(--ui-warning-bg) bg-(--ui-warning-bg) p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-(--ui-warning-fg)" />
        <p className="font-medium text-(--ui-warning-fg)">
          Connect your WooCommerce store first
        </p>
        <p className="mt-1 text-sm text-(--ui-warning-fg)">
          Go to the Connection tab to set up your store credentials.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6">
        <h3 className="mb-2 text-base font-semibold text-(--ui-text)">
          Import Products
        </h3>
        <p className="mb-4 text-sm text-(--ui-text-muted)">
          Pull all products from your WooCommerce store. Existing products
          (matched by SKU) will be updated; new products will be created.
        </p>
        <button
          onClick={importProducts}
          disabled={importing}
          className="flex items-center gap-2 rounded-lg bg-(--ui-primary) px-4 py-2.5 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {importing ? "Importing..." : "Import Products"}
        </button>
      </div>

      {result && (
        <div className="flex items-center gap-3 rounded-xl border border-(--ui-success-bg) bg-(--ui-success-bg) p-4">
          <CheckCircle2 className="h-5 w-5 text-(--ui-success-fg)" />
          <div>
            <p className="font-medium text-(--ui-success-fg)">Import complete</p>
            <p className="text-sm text-(--ui-success-fg)">
              {result.imported} new products imported, {result.updated} existing
              products updated.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
          <AlertTriangle className="h-5 w-5 text-(--ui-danger-fg)" />
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}
    </div>
  );
}

/* ── Stock Sync Tab ──────────────────────────────────────────────── */

function StockTab({ connected }) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const syncStock = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const data = await api.post("/api/integrations/woocommerce/sync-stock", {});
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  if (!connected) {
    return (
      <div className="rounded-xl border border-(--ui-warning-bg) bg-(--ui-warning-bg) p-6 text-center">
        <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-(--ui-warning-fg)" />
        <p className="font-medium text-(--ui-warning-fg)">
          Connect your WooCommerce store first
        </p>
        <p className="mt-1 text-sm text-(--ui-warning-fg)">
          Go to the Connection tab to set up your store credentials.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-6">
        <h3 className="mb-2 text-base font-semibold text-(--ui-text)">
          Sync Stock to WooCommerce
        </h3>
        <p className="mb-4 text-sm text-(--ui-text-muted)">
          Push your current stock levels to WooCommerce. Products are matched by
          SKU. Only products with a matching SKU in WooCommerce will be updated.
        </p>
        <button
          onClick={syncStock}
          disabled={syncing}
          className="flex items-center gap-2 rounded-lg bg-(--ui-primary) px-4 py-2.5 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
        >
          {syncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {syncing ? "Syncing..." : "Sync Stock"}
        </button>
      </div>

      {result && (
        <div className="flex items-center gap-3 rounded-xl border border-(--ui-success-bg) bg-(--ui-success-bg) p-4">
          <CheckCircle2 className="h-5 w-5 text-(--ui-success-fg)" />
          <div>
            <p className="font-medium text-(--ui-success-fg)">Sync complete</p>
            <p className="text-sm text-(--ui-success-fg)">
              {result.synced} product stock levels pushed to WooCommerce.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-(--ui-danger-bg) bg-(--ui-danger-bg) p-4">
          <AlertTriangle className="h-5 w-5 text-(--ui-danger-fg)" />
          <p className="text-sm text-(--ui-danger-fg)">{error}</p>
        </div>
      )}
    </div>
  );
}
