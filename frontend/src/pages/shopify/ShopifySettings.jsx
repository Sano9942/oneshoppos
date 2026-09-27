import React, { useState } from "react";
import { Link2, Unplug, CheckCircle2, ShieldAlert, RefreshCw } from "lucide-react";
import { Button, Input, Select, Badge } from "../../ui/primitives";
import { fmtUtcDateTime } from "../../utils/dates";
import { useShopify } from "./ShopifyContext";

// Every button here calls a route that exists (OTS D29: Save sent POST to a
// PUT-only route, Disconnect sent DELETE, and five more buttons called
// addresses the backend never had, so no store could be connected from here).
export default function ShopifySettings() {
  const { config, setConfig, apiFetch, status, loadAll, setError, setSuccess } =
    useShopify();

  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [validating, setValidating] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);

  const isApp = config.auth_mode !== "token";
  const set = (key) => (e) => setConfig((p) => ({ ...p, [key]: e.target.value }));

  const call = async (path, method, body) => {
    const res = await apiFetch(path, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const run = async (setBusy, work) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await work();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = (e) => {
    e.preventDefault();
    run(setSaving, async () => {
      const body = {
        shop_domain: config.shop_domain,
        api_version: config.api_version,
        default_location_id: config.default_location_id,
        ...(isApp
          ? { client_id: config.client_id, client_secret: config.client_secret }
          : { access_token: config.access_token, webhook_secret: config.webhook_secret }),
      };
      await call("/api/integrations/shopify/config", "PUT", body);
      setSuccess(isApp ? "Connected. SanoPOS renews the access key by itself every day." : "Connection saved");
      await loadAll();
    });
  };

  const disconnect = () => {
    if (!window.confirm("Disconnect Shopify? Stock and orders stop syncing until you connect again.")) return;
    run(setSaving, async () => {
      await call("/api/integrations/shopify/disconnect", "POST");
      setSuccess("Disconnected");
      await loadAll();
    });
  };

  const verify = () =>
    run(setVerifying, async () => {
      await call("/api/integrations/shopify/verify", "POST");
      setSuccess("Connection verified: SanoPOS can reach the store.");
      await loadAll();
    });

  const validate = () =>
    run(setValidating, async () => {
      const d = await call("/api/integrations/shopify/live-validation", "POST");
      const sample = d.checks?.mapped_inventory_sample;
      const parts = [
        `Store: ${d.checks?.shop_connection?.shop_name || d.checks?.shop_connection?.myshopify_domain || "reached"}`,
        `${d.checks?.locations?.count ?? 0} location(s)`,
        sample ? `${sample.total - sample.failed} of ${sample.total} sample item counts read` : null,
      ].filter(Boolean);
      (d.ok ? setSuccess : setError)(`${d.ok ? "Live check passed" : "Live check found problems"}: ${parts.join(", ")}.`);
    });

  const processPending = () =>
    run(setProcessingQueue, async () => {
      const d = await call("/api/integrations/shopify/sync/process-pending", "POST");
      setSuccess(d.message || "Waiting stock changes sent.");
      await loadAll();
    });

  const retryFailed = () =>
    run(setRetryingFailed, async () => {
      const d = await call("/api/integrations/shopify/sync/retry-failed", "POST");
      setSuccess(`${d.queued ?? 0} failed stock change(s) queued to send again.`);
      await loadAll();
    });

  const statusTone = (value) =>
    value === "success" ? "success" : value === "failed" ? "danger" : "default";

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 bg-(--ui-surface) border border-(--ui-border) rounded-xl p-5">
        <h3 className="text-lg font-semibold text-(--ui-text) mb-4">Connection Settings</h3>
        <form onSubmit={saveConfig} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-(--ui-text-muted)">
              Shop Domain
              <Input
                value={config.shop_domain}
                onChange={set("shop_domain")}
                placeholder="your-store.myshopify.com"
                className="mt-1 w-full"
                required
              />
            </label>
            <label className="text-xs text-(--ui-text-muted)">
              API Version
              <Input value={config.api_version} onChange={set("api_version")} className="mt-1 w-full" required />
            </label>
            <label className="text-xs text-(--ui-text-muted) md:col-span-2">
              How SanoPOS connects
              <Select value={isApp ? "app" : "token"} onChange={set("auth_mode")} className="mt-1 w-full">
                <option value="app">Dev Dashboard app (Client ID + Client secret)</option>
                <option value="token">Admin API access token (apps made before 2026)</option>
              </Select>
            </label>
            {isApp ? (
              <>
                <label className="text-xs text-(--ui-text-muted)">
                  Client ID
                  <Input value={config.client_id} onChange={set("client_id")} className="mt-1 w-full" required autoComplete="off" />
                </label>
                <label className="text-xs text-(--ui-text-muted)">
                  Client secret
                  <Input
                    type="password"
                    value={config.client_secret}
                    onChange={set("client_secret")}
                    placeholder={config.saved_auth_mode === "app" ? "Saved. Type a new one to change it" : ""}
                    className="mt-1 w-full"
                    required={config.saved_auth_mode !== "app"}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="text-xs text-(--ui-text-muted)">
                  Admin Access Token
                  <Input
                    type="password"
                    value={config.access_token}
                    onChange={set("access_token")}
                    placeholder={config.connected ? "Enter new token to rotate" : "shpat_..."}
                    className="mt-1 w-full"
                    required={config.saved_auth_mode !== "token"}
                    autoComplete="new-password"
                  />
                </label>
                <label className="text-xs text-(--ui-text-muted)">
                  Webhook Secret (optional)
                  <Input
                    type="password"
                    value={config.webhook_secret}
                    onChange={set("webhook_secret")}
                    className="mt-1 w-full"
                    autoComplete="new-password"
                  />
                </label>
              </>
            )}
            <label className="text-xs text-(--ui-text-muted)">
              Default Shopify Location ID
              <Input
                value={config.default_location_id}
                onChange={set("default_location_id")}
                placeholder="Location ID"
                className="mt-1 w-full"
              />
            </label>
          </div>

          {config.connected && (
            <div className="text-xs text-(--ui-text-muted) space-y-1">
              {config.saved_auth_mode === "app" && config.access_token_expires_at && (
                <p>
                  Access key renews automatically. Current one valid until{" "}
                  {fmtUtcDateTime(config.access_token_expires_at)}.
                </p>
              )}
              {config.last_error && <p className="text-(--ui-danger-fg)">Last error: {config.last_error}</p>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" tone="primary" disabled={saving}>
              <Link2 size={14} />
              {saving ? "Saving..." : "Save Connection"}
            </Button>
            <Button type="button" onClick={disconnect} disabled={saving || !config.connected}>
              <Unplug size={14} />
              Disconnect
            </Button>
            <Button type="button" onClick={verify} disabled={verifying || !config.connected}>
              <CheckCircle2 size={14} />
              {verifying ? "Verifying..." : "Verify Connection"}
            </Button>
            <Button type="button" onClick={validate} disabled={validating || !config.connected}>
              <ShieldAlert size={14} />
              {validating ? "Checking..." : "Run Live Check"}
            </Button>
          </div>
        </form>
      </div>

      <div className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-5 space-y-3">
        <h3 className="text-lg font-semibold text-(--ui-text)">Stock sync</h3>
        <p className="text-xs text-(--ui-text-muted)">
          Till sales and other stock moves are sent to Shopify automatically. To make
          Shopify match SanoPOS exactly, use "Set Shopify to SanoPOS counts" on the
          Reconciliation tab. Online orders arrive by webhook.
        </p>
        <Button onClick={processPending} disabled={processingQueue || !config.connected} className="w-full">
          <RefreshCw size={14} />
          {processingQueue ? "Sending..." : "Send waiting stock changes now"}
        </Button>
        <Button onClick={retryFailed} disabled={retryingFailed || !config.connected} className="w-full">
          <RefreshCw size={14} />
          {retryingFailed ? "Queuing..." : "Retry failed stock changes"}
        </Button>
        <div className="text-xs text-(--ui-text-muted) border-t border-(--ui-border) pt-3">
          Last run: {status?.last_run?.finished_at || status?.last_run?.started_at || "-"}{" "}
          <Badge tone={statusTone(status?.last_run?.status)}>{status?.last_run?.status || "n/a"}</Badge>
        </div>
      </div>
    </div>
  );
}
