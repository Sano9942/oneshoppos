import React, { useState } from "react";
import {
  Link2,
  Unplug,
  CheckCircle2,
  ShieldAlert,
  RefreshCw,
  Upload,
  Download,
} from "lucide-react";
import { useShopify } from "./ShopifyContext";

export default function ShopifySettings() {
  const { config, setConfig, apiFetch, status, loadAll, setError, setSuccess } =
    useShopify();

  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [runningLiveValidation, setRunningLiveValidation] = useState(false);
  const [syncingPush, setSyncingPush] = useState(false);
  const [syncingPull, setSyncingPull] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  const saveConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`/api/integrations/shopify/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Failed to save configuration");
      setSuccess("Configuration saved successfully");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect Shopify? This will clear credentials."))
      return;
    try {
      const res = await apiFetch(`/api/integrations/shopify/config`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to disconnect");
      setSuccess("Disconnected successfully");
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  };

  const verify = async () => {
    setVerifying(true);
    setError("");
    setSuccess("");
    try {
      const res = await apiFetch(`/api/integrations/shopify/verify`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setSuccess("Connection verified! API access is active.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const runLiveValidation = async () => {
    setRunningLiveValidation(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/validate`, {
        method: "POST",
      });
      if (res.ok)
        setSuccess("Live validation triggered. Check results in Mappings tab.");
    } catch (err) {
      setError("Validation failed: " + err.message);
    } finally {
      setRunningLiveValidation(false);
    }
  };

  const runPush = async () => {
    setSyncingPush(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/sync/inventory`, {
        method: "POST",
      });
      if (res.ok) setSuccess("Dry-run inventory push triggered.");
    } catch (err) {
      setError("Sync failed: " + err.message);
    } finally {
      setSyncingPush(false);
    }
  };

  const runPull = async () => {
    setSyncingPull(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/sync/orders`, {
        method: "POST",
      });
      if (res.ok) setSuccess("Dry-run order pull triggered.");
    } catch (err) {
      setError("Sync failed: " + err.message);
    } finally {
      setSyncingPull(false);
    }
  };

  const processPending = async () => {
    setProcessingQueue(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/queue/process`, {
        method: "POST",
      });
      if (res.ok) setSuccess("Queue processing triggered.");
    } catch (err) {
      setError("Queue processing failed: " + err.message);
    } finally {
      setProcessingQueue(false);
    }
  };

  const retryFailed = async () => {
    setRetryingFailed(true);
    try {
      const res = await apiFetch(`/api/integrations/shopify/queue/retry`, {
        method: "POST",
      });
      if (res.ok) setSuccess("Retrying failed events...");
    } catch (err) {
      setError("Retry failed: " + err.message);
    } finally {
      setRetryingFailed(false);
    }
  };

  const statusClass = (value) => {
    if (value === "success") return "bg-emerald-100 text-emerald-700";
    if (value === "failed") return "bg-rose-100 text-rose-700";
    if (value === "running") return "bg-blue-100 text-blue-700";
    return "bg-slate-100 text-slate-700";
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">
          Connection Settings
        </h3>
        <form onSubmit={saveConfig} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">Shop Domain</label>
              <input
                value={config.shop_domain}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, shop_domain: e.target.value }))
                }
                placeholder="your-store.myshopify.com"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">API Version</label>
              <input
                value={config.api_version}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, api_version: e.target.value }))
                }
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Admin Access Token
              </label>
              <input
                type="password"
                value={config.access_token}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, access_token: e.target.value }))
                }
                placeholder={
                  config.connected ? "Enter new token to rotate" : "shpat_..."
                }
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                required={!config.connected}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Webhook Secret (optional)
              </label>
              <input
                type="password"
                value={config.webhook_secret}
                onChange={(e) =>
                  setConfig((p) => ({ ...p, webhook_secret: e.target.value }))
                }
                placeholder="whsec_..."
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Default Shopify Location ID
              </label>
              <input
                value={config.default_location_id}
                onChange={(e) =>
                  setConfig((p) => ({
                    ...p,
                    default_location_id: e.target.value,
                  }))
                }
                placeholder="Location ID"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              <Link2 size={14} />
              {saving ? "Saving..." : "Save Connection"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold"
            >
              <Unplug size={14} />
              Disconnect
            </button>
            <button
              type="button"
              onClick={verify}
              disabled={verifying}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              <CheckCircle2 size={14} />
              {verifying ? "Verifying..." : "Verify Connection"}
            </button>
            <button
              type="button"
              onClick={runLiveValidation}
              disabled={runningLiveValidation}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
            >
              <ShieldAlert size={14} />
              {runningLiveValidation ? "Validating..." : "Run Live Validation"}
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
        <h3 className="text-lg font-semibold text-slate-800">Manual Sync</h3>
        <p className="text-xs text-slate-500">
          Use these controls to validate connector plumbing before live API
          automation.
        </p>
        <button
          onClick={runPush}
          disabled={syncingPush}
          className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          <Upload size={14} />
          {syncingPush ? "Running..." : "Push Inventory (Dry Run)"}
        </button>
        <button
          onClick={runPull}
          disabled={syncingPull}
          className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          <Download size={14} />
          {syncingPull ? "Running..." : "Pull Orders (Dry Run)"}
        </button>
        <button
          onClick={processPending}
          disabled={processingQueue}
          className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          <RefreshCw size={14} />
          {processingQueue ? "Running..." : "Process Pending Queue"}
        </button>
        <button
          onClick={retryFailed}
          disabled={retryingFailed}
          className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-lg text-sm font-semibold disabled:opacity-60"
        >
          <RefreshCw size={14} />
          {retryingFailed ? "Running..." : "Retry Failed Events"}
        </button>
        <div className="text-xs text-slate-500 border-t border-slate-100 pt-3">
          Last run:{" "}
          {status?.last_run?.finished_at || status?.last_run?.started_at || "-"}
          <span
            className={`ml-2 px-2 py-0.5 rounded-full ${statusClass(status?.last_run?.status)}`}
          >
            {status?.last_run?.status || "n/a"}
          </span>
        </div>
      </div>
    </div>
  );
}
