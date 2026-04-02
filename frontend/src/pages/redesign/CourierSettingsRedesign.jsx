import { useState, useEffect } from "react";
import { PageShell } from "../../ui/primitives";
import { api } from "../../api";
import { Truck, Plus, ExternalLink } from "lucide-react";

export default function CourierSettingsRedesign() {
  const [couriers, setCouriers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTemplate, setNewTemplate] = useState("");
  const [adding, setAdding] = useState(false);

  const load = () => {
    api.get("/api/couriers")
      .then((data) => {
        setCouriers((data.couriers || []).map((c) => ({ ...c, _dirty: false })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const updateField = (id, field, value) => {
    setCouriers((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value, _dirty: true } : c))
    );
  };

  const saveCourier = async (courier) => {
    setSaving((s) => ({ ...s, [courier.id]: true }));
    try {
      await api.put(`/api/couriers/${courier.id}`, {
        enabled: courier.enabled,
        api_key: courier.api_key || null,
        api_secret: courier.api_secret || null,
        api_base_url: courier.api_base_url || null,
      });
      setCouriers((prev) =>
        prev.map((c) => (c.id === courier.id ? { ...c, _dirty: false } : c))
      );
    } catch { /* ignore */ }
    setSaving((s) => ({ ...s, [courier.id]: false }));
  };

  const addCourier = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await api.post("/api/couriers", { name: newName.trim(), tracking_url_template: newTemplate.trim() });
      setNewName("");
      setNewTemplate("");
      setShowAdd(false);
      load();
    } catch { /* ignore */ }
    setAdding(false);
  };

  if (loading) {
    return (
      <PageShell title="Delivery Couriers">
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-400">
          Loading...
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Delivery Couriers"
      subtitle="Configure courier integrations for order dispatch"
      right={
        <button
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus size={16} /> Add Custom Courier
        </button>
      }
    >
      {showAdd && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
          <h3 className="mb-3 text-sm font-semibold text-blue-900 dark:text-blue-200">
            Add Custom Courier
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Courier Name *
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. My Local Rider"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Tracking URL Template
              </label>
              <input
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value)}
                placeholder="https://example.com/track/{tracking}"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Use <code className="rounded bg-slate-200 px-1 dark:bg-slate-700">{"{tracking}"}</code> as
            a placeholder for the tracking number in the URL template.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={addCourier}
              disabled={adding || !newName.trim()}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add Courier"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {couriers.map((c) => (
          <div
            key={c.id}
            className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Truck size={20} className="text-slate-400" />
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-white">
                    {c.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    Adapter: {c.adapter_key}
                    {c.tracking_url_template ? (
                      <span className="ml-2">
                        <ExternalLink size={10} className="mr-0.5 inline" />
                        Tracking URL configured
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <span className="text-xs text-slate-500">
                  {c.enabled ? "Enabled" : "Disabled"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!c.enabled}
                  onClick={() => updateField(c.id, "enabled", !c.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    c.enabled ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                      c.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
            </div>

            {c.enabled && c.adapter_key !== "generic" && (
              <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3 dark:border-slate-700">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    API Base URL
                  </label>
                  <input
                    value={c.api_base_url || ""}
                    onChange={(e) => updateField(c.id, "api_base_url", e.target.value)}
                    placeholder="https://api.example.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    API Key
                  </label>
                  <input
                    value={c.api_key || ""}
                    onChange={(e) => updateField(c.id, "api_key", e.target.value)}
                    placeholder="Enter API key"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    API Secret
                  </label>
                  <input
                    type="password"
                    value={c.api_secret || ""}
                    onChange={(e) => updateField(c.id, "api_secret", e.target.value)}
                    placeholder="Enter API secret"
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {c._dirty && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => saveCourier(c)}
                  disabled={saving[c.id]}
                  className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving[c.id] ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>
        ))}

        {couriers.length === 0 && (
          <div className="py-12 text-center text-sm text-slate-400">
            No couriers configured. Click "Add Custom Courier" to get started.
          </div>
        )}
      </div>
    </PageShell>
  );
}
