import { useState, useEffect } from "react";
import { PageShell, SectionCard, Button, Input, Select } from "../../ui/primitives";
import { useToast } from "../../contexts/ToastContext";
import { api } from "../../api";

const PROVINCES = [
  "Punjab",
  "Sindh",
  "KPK",
  "Balochistan",
  "ICT",
  "AJK",
  "Gilgit-Baltistan",
];

export default function FBRSettingsRedesign() {
  const { success, error: showError } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // form state
  const [enabled, setEnabled] = useState(false);
  const [ntn, setNtn] = useState("");
  const [strn, setStrn] = useState("");
  const [province, setProvince] = useState("");
  const [fbrApiToken, setFbrApiToken] = useState("");
  const [fbrEnvironment, setFbrEnvironment] = useState("sandbox");
  const [defaultHsCode, setDefaultHsCode] = useState("");

  // connection status: "untested" | "connected" | "failed"
  const [connectionStatus, setConnectionStatus] = useState("untested");

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const data = await api.get("/api/fbr/config");
      setEnabled(!!data.enabled);
      setNtn(data.ntn || "");
      setStrn(data.strn || "");
      setProvince(data.fbr_province || "");
      setFbrApiToken(data.fbr_api_token || "");
      setFbrEnvironment(data.fbr_environment || "sandbox");
      setDefaultHsCode(data.fbr_default_hs_code || "");
    } catch (e) {
      showError(e.body?.error || e.message || "Failed to load FBR configuration");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.put("/api/fbr/config", {
        enabled,
        fbr_api_token: fbrApiToken,
        fbr_environment: fbrEnvironment,
        fbr_default_hs_code: defaultHsCode,
        fbr_province: province,
      });
      success("FBR settings saved");
    } catch (e) {
      showError(e.body?.error || e.message || "Failed to save FBR settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setConnectionStatus("untested");
    try {
      const res = await api.raw("/api/fbr/test-connection", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setConnectionStatus("connected");
        success("FBR connection successful");
      } else {
        setConnectionStatus("failed");
        showError(data.error || "Connection test failed");
      }
    } catch (e) {
      setConnectionStatus("failed");
      showError(e.message || "Connection test failed");
    } finally {
      setTesting(false);
    }
  }

  const statusDot =
    connectionStatus === "connected"
      ? "bg-emerald-500"
      : connectionStatus === "failed"
        ? "bg-red-500"
        : "bg-(--ui-border)";

  const statusLabel =
    connectionStatus === "connected"
      ? "Connected"
      : connectionStatus === "failed"
        ? "Connection Failed"
        : "Not Tested";

  if (loading) {
    return (
      <PageShell title="FBR Settings">
        <p className="text-sm text-(--ui-text-muted)">Loading...</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="FBR Settings" subtitle="Configure FBR (Federal Board of Revenue) integration for tax compliance">
      <div className="space-y-6">
        {/* Enable / Disable */}
        <SectionCard>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-(--ui-text)">Enable FBR Integration</h2>
                <p className="mt-0.5 text-sm text-(--ui-text-muted)">
                  When enabled, sales will be reported to FBR in real time.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => setEnabled((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                  enabled ? "bg-(--ui-primary)" : "bg-(--ui-border)"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                    enabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>
        </SectionCard>

        {/* Connection Status */}
        <SectionCard>
          <div className="p-5">
            <h2 className="mb-4 text-base font-semibold text-(--ui-text)">Connection Status</h2>
            <div className="flex items-center gap-3">
              <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${statusDot}`} />
              <span className="text-sm text-(--ui-text)">{statusLabel}</span>
            </div>
          </div>
        </SectionCard>

        {/* Tax Registration */}
        <SectionCard>
          <div className="p-5">
            <h2 className="mb-4 text-base font-semibold text-(--ui-text)">Tax Registration</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-(--ui-text)">NTN</label>
                <Input
                  value={ntn}
                  onChange={(e) => setNtn(e.target.value)}
                  placeholder="National Tax Number"
                />
                <p className="mt-1 text-xs text-(--ui-text-muted)">From your company profile</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-(--ui-text)">STRN</label>
                <Input
                  value={strn}
                  onChange={(e) => setStrn(e.target.value)}
                  placeholder="Sales Tax Registration Number"
                />
                <p className="mt-1 text-xs text-(--ui-text-muted)">From your company profile</p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* API Configuration */}
        <SectionCard>
          <div className="p-5">
            <h2 className="mb-4 text-base font-semibold text-(--ui-text)">API Configuration</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-(--ui-text)">Province</label>
                <Select value={province} onChange={(e) => setProvince(e.target.value)}>
                  <option value="">Select Province</option>
                  {PROVINCES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-(--ui-text)">Environment</label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFbrEnvironment("sandbox")}
                    className={`rounded-(--ui-radius-sm) px-4 py-2 text-sm font-medium transition ${
                      fbrEnvironment === "sandbox"
                        ? "bg-(--ui-primary) text-white"
                        : "border border-(--ui-border) bg-(--ui-surface) text-(--ui-text) hover:bg-(--ui-muted-surface)"
                    }`}
                  >
                    Sandbox
                  </button>
                  <button
                    type="button"
                    onClick={() => setFbrEnvironment("production")}
                    className={`rounded-(--ui-radius-sm) px-4 py-2 text-sm font-medium transition ${
                      fbrEnvironment === "production"
                        ? "bg-(--ui-primary) text-white"
                        : "border border-(--ui-border) bg-(--ui-surface) text-(--ui-text) hover:bg-(--ui-muted-surface)"
                    }`}
                  >
                    Production
                  </button>
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-(--ui-text)">FBR API Token</label>
                <Input
                  type="password"
                  value={fbrApiToken}
                  onChange={(e) => setFbrApiToken(e.target.value)}
                  placeholder="Enter your FBR API token"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-(--ui-text)">Default HS Code</label>
                <Input
                  value={defaultHsCode}
                  onChange={(e) => setDefaultHsCode(e.target.value)}
                  placeholder="e.g. 8471.30"
                />
                <p className="mt-1 text-xs text-(--ui-text-muted)">
                  Harmonized System code used when a product does not have one assigned.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button onClick={handleTestConnection} disabled={testing || !fbrApiToken}>
            {testing ? "Testing..." : "Test Connection"}
          </Button>
        </div>
      </div>
    </PageShell>
  );
}
