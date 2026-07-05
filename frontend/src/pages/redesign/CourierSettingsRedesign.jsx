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
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-(--ui-text-muted)">
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
          className="inline-flex items-center gap-1.5 rounded-lg bg-(--ui-primary) px-3 py-2 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong)"
        >
          <Plus size={16} /> Add Custom Courier
        </button>
      }
    >
      {showAdd && (
        <div className="mb-6 rounded-xl border border-(--ui-focus) bg-(--ui-muted-surface) p-4">
          <h3 className="mb-3 text-sm font-semibold text-(--ui-link)">
            Add Custom Courier
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                Courier Name *
              </label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. My Local Rider"
                className="w-full rounded-lg border border-(--ui-border-strong) px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                Tracking URL Template
              </label>
              <input
                value={newTemplate}
                onChange={(e) => setNewTemplate(e.target.value)}
                placeholder="https://example.com/track/{tracking}"
                className="w-full rounded-lg border border-(--ui-border-strong) px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="mt-1 text-xs text-(--ui-text-muted)">
            Use <code className="rounded bg-(--ui-muted-surface) px-1">{"{tracking}"}</code> as
            a placeholder for the tracking number in the URL template.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={addCourier}
              disabled={adding || !newName.trim()}
              className="rounded-lg bg-(--ui-primary) px-4 py-1.5 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              {adding ? "Adding..." : "Add Courier"}
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="rounded-lg border border-(--ui-border-strong) px-4 py-1.5 text-sm text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
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
            className="rounded-xl border border-(--ui-border) bg-(--ui-surface) p-4"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Truck size={20} className="text-(--ui-text-muted)" />
                <div>
                  <div className="text-sm font-semibold text-(--ui-text)">
                    {c.name}
                  </div>
                  <div className="text-xs text-(--ui-text-muted)">
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
                <span className="text-xs text-(--ui-text-muted)">
                  {c.enabled ? "Enabled" : "Disabled"}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!c.enabled}
                  onClick={() => updateField(c.id, "enabled", !c.enabled)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                    c.enabled ? "bg-(--ui-primary)" : "bg-(--ui-muted-surface)"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-(--ui-surface) transition-transform ${
                      c.enabled ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>
            </div>

            {c.enabled && c.adapter_key !== "generic" && (
              <div className="mt-3 grid gap-3 border-t border-(--ui-border) pt-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                    API Base URL
                  </label>
                  <input
                    value={c.api_base_url || ""}
                    onChange={(e) => updateField(c.id, "api_base_url", e.target.value)}
                    placeholder="https://api.example.com"
                    className="w-full rounded-lg border border-(--ui-border-strong) px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                    API Key
                  </label>
                  <input
                    value={c.api_key || ""}
                    onChange={(e) => updateField(c.id, "api_key", e.target.value)}
                    placeholder="Enter API key"
                    className="w-full rounded-lg border border-(--ui-border-strong) px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-(--ui-text-muted)">
                    API Secret
                  </label>
                  <input
                    type="password"
                    value={c.api_secret || ""}
                    onChange={(e) => updateField(c.id, "api_secret", e.target.value)}
                    placeholder="Enter API secret"
                    className="w-full rounded-lg border border-(--ui-border-strong) px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
            )}

            {c._dirty && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => saveCourier(c)}
                  disabled={saving[c.id]}
                  className="rounded-lg bg-(--ui-primary) px-4 py-1.5 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-primary-strong) disabled:opacity-50"
                >
                  {saving[c.id] ? "Saving..." : "Save"}
                </button>
              </div>
            )}
          </div>
        ))}

        {couriers.length === 0 && (
          <div className="py-12 text-center text-sm text-(--ui-text-muted)">
            No couriers configured. Click "Add Custom Courier" to get started.
          </div>
        )}
      </div>
    </PageShell>
  );
}
