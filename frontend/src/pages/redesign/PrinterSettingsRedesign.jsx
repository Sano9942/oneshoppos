import { useState, useEffect } from "react";
import { PageShell } from "../../ui/primitives";

const API = "http://localhost:5000";

const PAPER_SIZES = [
  { label: "80mm — 48 chars (standard)", value: 48 },
  { label: "76mm — 42 chars", value: 42 },
  { label: "58mm — 32 chars (mini)", value: 32 },
  { label: "57mm — 30 chars (narrow)", value: 30 },
  { label: "Custom", value: "custom" },
];

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

  useEffect(() => {
    fetch(`${API}/api/print/config`, {
      headers: { "x-employee-id": localStorage.getItem("employeeId") || "1" },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
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
    const body = { ...cfg };
    if (isCustom) body.paper_width = Number(customWidth) || 48;
    try {
      const res = await fetch(`${API}/api/print/config`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-employee-id": localStorage.getItem("employeeId") || "1",
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const statusRes = await fetch(`${API}/api/print/status`, {
        headers: { "x-employee-id": localStorage.getItem("employeeId") || "1" },
      });
      const status = await statusRes.json();
      if (!status.reachable && status.reachable !== null) {
        setTestResult({ ok: false, message: status.error || "Printer unreachable" });
        return;
      }
      const printRes = await fetch(`${API}/api/print/receipt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-employee-id": localStorage.getItem("employeeId") || "1",
        },
        body: JSON.stringify({
          slip: {
            invoiceNumber: "TEST-001",
            timestamp: new Date().toLocaleString(),
            cart: [{ name: "Test Item", quantity: 1, price: 100 }],
            payments: [{ method: "Cash", amount: 100 }],
            total: 100,
            change: 0,
            outlet: { name: "Test Store" },
            employee: { name: "Test Cashier" },
            taxAmount: 0,
            discountAmount: 0,
          },
          template: null,
        }),
      });
      const printData = await printRes.json();
      if (printData.ok) {
        setTestResult({ ok: true, message: "Printer OK — test receipt printed!" });
      } else {
        setTestResult({ ok: false, message: printData.error || "Print failed" });
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
            className="border px-5 py-2 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            {testing ? "Testing…" : "Test Print"}
          </button>
          {saved && <span className="text-green-600 text-sm">Settings saved.</span>}
        </div>

        {testResult && (
          <div className={`rounded px-4 py-3 text-sm ${testResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {testResult.message}
          </div>
        )}
      </div>
    </PageShell>
  );
}
