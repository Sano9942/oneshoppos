import { useState, useEffect } from "react";
import { PageShell } from "../../ui/primitives";
import { api } from "../../api";
import { PAPER_SIZES as SHARED_PAPER_SIZES } from "../../utils/paperSizes";

// Printer Settings adds a "Custom" option to the shared list so admins can
// type a non-standard width for unusual printers.
const PAPER_SIZES = [...SHARED_PAPER_SIZES, { label: "Custom", value: "custom" }];

export default function PrinterSettingsRedesign() {
  const [cfg, setCfg] = useState({
    connection_type: "network",
    host: "192.168.1.100",
    port: 9100,
    usb_vendor_id: "",
    usb_product_id: "",
    paper_width: 48,
    cash_drawer: 1,
    is_active: 1,
  });
  const [customWidth, setCustomWidth] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const [emailCfg, setEmailCfg] = useState({
    smtp_host: "smtp.gmail.com",
    smtp_port: 587,
    smtp_user: "",
    smtp_pass: "",
    from_name: "SanoPOS",
    enabled: false,
  });
  // True when backend has a password saved — used for placeholder only
  const [emailPassSet, setEmailPassSet] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailSaveError, setEmailSaveError] = useState(null);
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState(null);

  useEffect(() => {
    api.get("/api/print/config")
      .then((data) => {
        if (data) {
          setCfg(data);
          const predefined = PAPER_SIZES.find((s) => s.value === data.paper_width);
          if (!predefined || predefined.value === "custom") {
            setIsCustom(true);
            setCustomWidth(String(data.paper_width));
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.get("/api/email/config")
      .then((data) => {
        if (data) {
          // smtp_pass always arrives as "*****" or "" — never store it in state
          setEmailPassSet(data.smtp_pass === "*****");
          setEmailCfg({
            smtp_host: data.smtp_host || "smtp.gmail.com",
            smtp_port: data.smtp_port || 587,
            smtp_user: data.smtp_user || "",
            smtp_pass: "",  // never pre-fill password field
            from_name: data.from_name || "SanoPOS",
            enabled: Boolean(data.enabled),
          });
        }
      })
      .catch(() => {});
  }, []);

  function handleChange(field, value) {
    setCfg((prev) => ({ ...prev, [field]: value }));
  }

  function handlePaperSize(val) {
    if (val === "custom") {
      setIsCustom(true);
    } else {
      setIsCustom(false);
      handleChange("paper_width", Number(val));
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    const body = { ...cfg };
    if (isCustom) body.paper_width = Number(customWidth) || 48;
    try {
      const data = await api.put("/api/print/config", body);
      if (data.ok) setSaved(true);
      else setSaveError(data.error || "Failed to save settings.");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleEmailChange(field, value) {
    setEmailCfg((prev) => ({ ...prev, [field]: value }));
  }

  async function handleEmailSave() {
    setEmailSaving(true);
    setEmailSaved(false);
    setEmailSaveError(null);
    try {
      const data = await api.put("/api/email/config", {
        ...emailCfg,
        // Only send smtp_pass if the user typed a new one
        ...(emailCfg.smtp_pass ? {} : { smtp_pass: "*****" }),
      });
      if (data.ok) setEmailSaved(true);
      else setEmailSaveError(data.error || "Failed to save email settings.");
    } catch (err) {
      setEmailSaveError(err.message);
    } finally {
      setEmailSaving(false);
    }
  }

  async function handleEmailTest() {
    setEmailTesting(true);
    setEmailTestResult(null);
    try {
      const data = await api.post("/api/email/test", {});
      if (data.ok) {
        setEmailTestResult({ ok: true, message: data.message || "Test email sent!" });
      } else {
        setEmailTestResult({ ok: false, message: data.error || "Test failed." });
      }
    } catch (err) {
      setEmailTestResult({ ok: false, message: err.message });
    } finally {
      setEmailTesting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const data = await api.post("/api/print/test", {});
      if (data.ok) {
        setTestResult({ ok: true, message: data.message || "Printer OK — test receipt printed!" });
      } else {
        setTestResult({ ok: false, message: data.error || "Print failed" });
      }
    } catch (err) {
      setTestResult({ ok: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <PageShell title="Printer Settings">
      <div className="max-w-lg space-y-6">

        <div className="flex items-center gap-3">
          <label className="font-medium">Enable Hardware Printing</label>
          <input
            type="checkbox"
            checked={Boolean(cfg.is_active)}
            onChange={(e) => handleChange("is_active", e.target.checked ? 1 : 0)}
          />
        </div>

        <div>
          <label className="block font-medium mb-1">Connection Type</label>
          <div className="flex gap-4">
            {["network", "usb"].map((t) => (
              <label key={t} className="flex items-center gap-2 capitalize cursor-pointer">
                <input
                  type="radio"
                  name="connection_type"
                  value={t}
                  checked={cfg.connection_type === t}
                  onChange={() => handleChange("connection_type", t)}
                />
                {t === "network" ? "Network / WiFi (TCP)" : "USB"}
              </label>
            ))}
          </div>
        </div>

        {cfg.connection_type === "network" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">IP Address</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={cfg.host}
                onChange={(e) => handleChange("host", e.target.value)}
                placeholder="192.168.1.100"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Port</label>
              <input
                type="number"
                className="border rounded px-3 py-2 w-full"
                value={cfg.port}
                onChange={(e) => handleChange("port", Number(e.target.value))}
                placeholder="9100"
              />
            </div>
          </div>
        )}

        {cfg.connection_type === "usb" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block font-medium mb-1">USB Vendor ID</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={cfg.usb_vendor_id || ""}
                onChange={(e) => handleChange("usb_vendor_id", e.target.value)}
                placeholder="0x04b8 (Epson)"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">USB Product ID</label>
              <input
                className="border rounded px-3 py-2 w-full"
                value={cfg.usb_product_id || ""}
                onChange={(e) => handleChange("usb_product_id", e.target.value)}
                placeholder="0x0202"
              />
            </div>
          </div>
        )}

        <div>
          <label className="block font-medium mb-1">Paper Size</label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={isCustom ? "custom" : cfg.paper_width}
            onChange={(e) => handlePaperSize(e.target.value)}
          >
            {PAPER_SIZES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          {isCustom && (
            <input
              type="number"
              className="border rounded px-3 py-2 w-full mt-2"
              value={customWidth}
              onChange={(e) => setCustomWidth(e.target.value)}
              placeholder="Enter chars per line (e.g. 40)"
            />
          )}
        </div>

        {/* 2-R.7 — printer purpose routing. Restaurant tenants split
           receipts / fire chits / guest bills across multiple printers;
           retail tenants leave this on "receipt". */}
        <div>
          <label className="block font-medium mb-1">Purpose</label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={cfg.purpose || "receipt"}
            onChange={(e) => handleChange("purpose", e.target.value)}
          >
            <option value="receipt">Receipt (default)</option>
            <option value="fire_chit">Fire chit (kitchen)</option>
            <option value="guest_bill">Guest bill (restaurant)</option>
            <option value="expo">Expo</option>
          </select>
          <p className="text-xs text-slate-500 mt-1">
            Kitchen stations map to fire-chit printers via KDS station config.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="font-medium">Kick Cash Drawer on Sale</label>
          <input
            type="checkbox"
            checked={Boolean(cfg.cash_drawer)}
            onChange={(e) => handleChange("cash_drawer", e.target.checked ? 1 : 0)}
          />
        </div>

        <div className="flex gap-3 items-center">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Settings"}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="border px-5 py-2 rounded hover:bg-(--ui-muted-surface) disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test Print"}
          </button>
          {saved && <span className="text-green-600 text-sm">Settings saved.</span>}
          {saveError && <span className="text-red-600 text-sm">{saveError}</span>}
        </div>

        {testResult && (
          <div className={`rounded px-4 py-3 text-sm ${testResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {testResult.message}
          </div>
        )}

        <hr className="border-(--ui-border)" />

        <h2 className="text-lg font-semibold text-(--ui-text)">Email Settings</h2>

        <div className="flex items-center gap-3">
          <label className="font-medium">Enable Email Receipts</label>
          <input
            type="checkbox"
            checked={Boolean(emailCfg.enabled)}
            onChange={(e) => handleEmailChange("enabled", e.target.checked)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-medium mb-1">SMTP Host</label>
            <input
              className="border rounded px-3 py-2 w-full"
              value={emailCfg.smtp_host}
              onChange={(e) => handleEmailChange("smtp_host", e.target.value)}
              placeholder="smtp.gmail.com"
            />
          </div>
          <div>
            <label className="block font-medium mb-1">SMTP Port</label>
            <input
              type="number"
              className="border rounded px-3 py-2 w-full"
              value={emailCfg.smtp_port}
              onChange={(e) => handleEmailChange("smtp_port", Number(e.target.value))}
              placeholder="587"
            />
          </div>
        </div>

        <div>
          <label className="block font-medium mb-1">Gmail / Email Address</label>
          <input
            type="email"
            className="border rounded px-3 py-2 w-full"
            value={emailCfg.smtp_user}
            onChange={(e) => handleEmailChange("smtp_user", e.target.value)}
            placeholder="yourstore@gmail.com"
          />
        </div>

        <div>
          <label className="block font-medium mb-1">App Password</label>
          <input
            type="password"
            className="border rounded px-3 py-2 w-full"
            value={emailCfg.smtp_pass}
            onChange={(e) => handleEmailChange("smtp_pass", e.target.value)}
            placeholder={emailPassSet && !emailCfg.smtp_pass ? "Password saved — enter new value to change" : "Gmail App Password"}
          />
          <p className="text-xs text-(--ui-text-muted) mt-1">
            For Gmail: Enable 2-Step Verification, then generate an App Password at{" "}
            <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline">
              myaccount.google.com/apppasswords
            </a>
          </p>
        </div>

        <div>
          <label className="block font-medium mb-1">From Name</label>
          <input
            className="border rounded px-3 py-2 w-full"
            value={emailCfg.from_name}
            onChange={(e) => handleEmailChange("from_name", e.target.value)}
            placeholder="SanoPOS"
          />
        </div>

        <div className="flex gap-3 items-center">
          <button
            onClick={handleEmailSave}
            disabled={emailSaving}
            className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {emailSaving ? "Saving…" : "Save Email Settings"}
          </button>
          <button
            onClick={handleEmailTest}
            disabled={emailTesting}
            className="border px-5 py-2 rounded hover:bg-(--ui-muted-surface) disabled:opacity-50"
          >
            {emailTesting ? "Sending…" : "Send Test Email"}
          </button>
          {emailSaved && <span className="text-green-600 text-sm">Email settings saved.</span>}
          {emailSaveError && <span className="text-red-600 text-sm">{emailSaveError}</span>}
        </div>

        {emailTestResult && (
          <div className={`rounded px-4 py-3 text-sm ${emailTestResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {emailTestResult.message}
          </div>
        )}
      </div>
    </PageShell>
  );
}
