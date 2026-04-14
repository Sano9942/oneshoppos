import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalProfile() {
  const { tenantSlug } = useParams();
  const [me, setMe] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [addresses, setAddresses] = useState([]);

  async function reload() {
    const [m, a] = await Promise.all([
      portalApi.get(tenantSlug, "/api/portal/me"),
      portalApi.get(tenantSlug, "/api/portal/me/addresses").catch(() => []),
    ]);
    setMe(m);
    setForm({
      name: m.name || "",
      mobile: m.mobile || "",
      address: m.address || "",
      city: m.city || "",
      date_of_birth: m.date_of_birth || "",
      gender: m.gender || "",
      email_consent: !!m.email_consent,
      sms_consent: !!m.sms_consent,
      whatsapp_consent: !!m.whatsapp_consent,
      preferred_contact: m.preferred_contact || "",
    });
    setAddresses(a);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantSlug]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await portalApi.put(tenantSlug, "/api/portal/me", form);
      setSaved(true);
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function update(key, val) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  async function deleteAddress(id) {
    if (!window.confirm("Delete this address?")) return;
    await portalApi.del(tenantSlug, `/api/portal/me/addresses/${id}`);
    reload();
  }

  if (!me) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Profile</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-medium mb-1">Name</span>
            <input
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Mobile</span>
            <input
              value={form.mobile}
              onChange={(e) => update("mobile", e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="block text-sm font-medium mb-1">Street address</span>
            <input
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">City</span>
            <input
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Date of birth</span>
            <input
              type="date"
              value={form.date_of_birth || ""}
              onChange={(e) => update("date_of_birth", e.target.value || null)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Gender</span>
            <select
              value={form.gender || ""}
              onChange={(e) => update("gender", e.target.value || null)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            >
              <option value="">Prefer not to say</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-sm font-medium mb-1">Preferred contact</span>
            <select
              value={form.preferred_contact || ""}
              onChange={(e) => update("preferred_contact", e.target.value || null)}
              className="w-full border border-slate-300 rounded px-3 py-2"
            >
              <option value="">No preference</option>
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="phone">Phone</option>
            </select>
          </label>
        </div>

        <fieldset className="border border-slate-200 rounded p-4">
          <legend className="text-sm font-medium px-2">Marketing consent</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2 text-sm">
            {[
              ["email_consent", "Email"],
              ["sms_consent", "SMS"],
              ["whatsapp_consent", "WhatsApp"],
            ].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!form[key]}
                  onChange={(e) => update(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {error && <div className="text-sm text-red-600">{error}</div>}
        {saved && <div className="text-sm text-emerald-700">Saved.</div>}

        <div className="flex justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-semibold mb-3">Saved addresses</h2>
        {addresses.length === 0 ? (
          <div className="text-sm text-slate-500">No saved addresses yet.</div>
        ) : (
          <ul className="space-y-2">
            {addresses.map((a) => (
              <li
                key={a.id}
                className="bg-white rounded border border-slate-200 p-4 text-sm flex justify-between items-start"
              >
                <div>
                  <div className="font-medium">{a.label || "Address"}</div>
                  <div className="text-slate-600">
                    {a.address_line_1}
                    {a.address_line_2 ? `, ${a.address_line_2}` : ""}
                  </div>
                  <div className="text-slate-600">
                    {[a.city, a.province, a.postal_code, a.country_code].filter(Boolean).join(", ")}
                  </div>
                  {a.is_default && (
                    <span className="inline-block mt-1 text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded">
                      Default
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => deleteAddress(a.id)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
