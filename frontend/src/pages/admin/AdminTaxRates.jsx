import { useState, useEffect } from "react";
import { API } from "../../config";

const adminFetch = (url, opts = {}) => {
  const session = JSON.parse(localStorage.getItem("adminSession") || "{}");
  return fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...opts.headers,
    },
  });
};

const PROVINCE_FIELDS = [
  { key: "federal_gst", label: "Federal GST" },
  { key: "punjab_pra", label: "Punjab PRA" },
  { key: "sindh_srb", label: "Sindh SRB" },
  { key: "kpk_kpra", label: "KPK KPRA" },
  { key: "balochistan_bra", label: "Balochistan BRA" },
];

export default function AdminTaxRates() {
  const [tab, setTab] = useState("rates");
  const [rates, setRates] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editRow, setEditRow] = useState(null);
  const [addMode, setAddMode] = useState(false);
  const [form, setForm] = useState({});
  const [msg, setMsg] = useState("");

  const fetchRates = async () => {
    try {
      const res = await adminFetch(`${API}/api/admin/tax-rates`);
      const data = await res.json();
      setRates(data.rates || []);
    } catch { /* ignore */ }
  };

  const fetchSuggestions = async () => {
    try {
      const res = await adminFetch(`${API}/api/admin/tax-rate-suggestions`);
      const data = await res.json();
      setSuggestions(data.suggestions || []);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    Promise.all([fetchRates(), fetchSuggestions()]).finally(() => setLoading(false));
  }, []);

  const saveRate = async () => {
    try {
      const method = editRow ? "PUT" : "POST";
      const url = editRow
        ? `${API}/api/admin/tax-rates/${editRow.id}`
        : `${API}/api/admin/tax-rates`;
      const res = await adminFetch(url, { method, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); setMsg(d.error); return; }
      setEditRow(null);
      setAddMode(false);
      setForm({});
      setMsg("Saved");
      fetchRates();
    } catch (err) { setMsg(err.message); }
  };

  const deleteRate = async (id) => {
    if (!confirm("Delete this rate?")) return;
    await adminFetch(`${API}/api/admin/tax-rates/${id}`, { method: "DELETE" });
    fetchRates();
  };

  const reviewSuggestion = async (id, tenantSlug, status) => {
    await adminFetch(`${API}/api/admin/tax-rate-suggestions/${id}`, {
      method: "PUT",
      body: JSON.stringify({ status, tenant_slug: tenantSlug }),
    });
    fetchSuggestions();
    if (status === "approved") fetchRates();
  };

  const startEdit = (rate) => {
    setEditRow(rate);
    setForm({ ...rate });
    setAddMode(false);
  };

  const startAdd = () => {
    setEditRow(null);
    setForm({});
    setAddMode(true);
  };

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Tax Rate Reference</h1>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("rates")}
          className={`px-4 py-2 rounded text-sm font-medium ${tab === "rates" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >
          Tax Rates ({rates.length})
        </button>
        <button
          onClick={() => setTab("suggestions")}
          className={`px-4 py-2 rounded text-sm font-medium ${tab === "suggestions" ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
        >
          Suggestions ({suggestions.length})
        </button>
      </div>

      {msg && (
        <div className="mb-3 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {msg}
          <button onClick={() => setMsg("")} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {tab === "rates" && (
        <>
          <button
            onClick={startAdd}
            className="mb-3 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            + Add Rate
          </button>

          {(addMode || editRow) && (
            <div className="mb-4 rounded border bg-white p-4 shadow-sm">
              <h3 className="text-lg font-medium mb-3">{editRow ? "Edit Rate" : "Add Rate"}</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <label className="text-xs font-medium text-gray-600">HS Code</label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" value={form.hs_code || ""} onChange={(e) => setForm({ ...form, hs_code: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Description (EN)</label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" value={form.description_en || ""} onChange={(e) => setForm({ ...form, description_en: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Description (UR)</label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" dir="rtl" value={form.description_ur || ""} onChange={(e) => setForm({ ...form, description_ur: e.target.value })} />
                </div>
                {PROVINCE_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-gray-600">{f.label} %</label>
                    <input className="w-full border rounded px-2 py-1.5 text-sm" type="number" step="0.01" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="text-xs font-medium text-gray-600">Exemption Notes</label>
                  <input className="w-full border rounded px-2 py-1.5 text-sm" value={form.exemption_notes || ""} onChange={(e) => setForm({ ...form, exemption_notes: e.target.value })} />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={saveRate} className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700">Save</button>
                <button onClick={() => { setEditRow(null); setAddMode(false); setForm({}); }} className="rounded border px-4 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
              </div>
            </div>
          )}

          <div className="overflow-auto rounded border bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">HS Code</th>
                  <th className="px-3 py-2 text-left font-medium">Description (EN)</th>
                  <th className="px-3 py-2 text-left font-medium">Federal GST</th>
                  <th className="px-3 py-2 text-left font-medium">Punjab</th>
                  <th className="px-3 py-2 text-left font-medium">Sindh</th>
                  <th className="px-3 py-2 text-left font-medium">KPK</th>
                  <th className="px-3 py-2 text-left font-medium">Balochistan</th>
                  <th className="px-3 py-2 text-left font-medium">Notes</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{r.hs_code}</td>
                    <td className="px-3 py-2">{r.description_en}</td>
                    <td className="px-3 py-2">{Number(r.federal_gst)}%</td>
                    <td className="px-3 py-2">{Number(r.punjab_pra)}%</td>
                    <td className="px-3 py-2">{Number(r.sindh_srb)}%</td>
                    <td className="px-3 py-2">{Number(r.kpk_kpra)}%</td>
                    <td className="px-3 py-2">{Number(r.balochistan_bra)}%</td>
                    <td className="px-3 py-2 text-xs text-gray-500">{r.exemption_notes || "-"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => startEdit(r)} className="mr-2 text-blue-600 hover:underline text-xs">Edit</button>
                      <button onClick={() => deleteRate(r.id)} className="text-red-600 hover:underline text-xs">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "suggestions" && (
        <div className="overflow-auto rounded border bg-white">
          {suggestions.length === 0 ? (
            <p className="p-6 text-center text-gray-500">No pending suggestions</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Tenant</th>
                  <th className="px-3 py-2 text-left font-medium">Ref ID</th>
                  <th className="px-3 py-2 text-left font-medium">Field</th>
                  <th className="px-3 py-2 text-left font-medium">Current</th>
                  <th className="px-3 py-2 text-left font-medium">Suggested</th>
                  <th className="px-3 py-2 text-left font-medium">SRO Ref</th>
                  <th className="px-3 py-2 text-left font-medium">Notes</th>
                  <th className="px-3 py-2 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => (
                  <tr key={`${s.tenant_slug}-${s.id}`} className="border-b hover:bg-gray-50">
                    <td className="px-3 py-2">{s.tenant_name}</td>
                    <td className="px-3 py-2">{s.reference_id}</td>
                    <td className="px-3 py-2">{s.field_name}</td>
                    <td className="px-3 py-2">{s.current_value != null ? `${Number(s.current_value)}%` : "-"}</td>
                    <td className="px-3 py-2 font-semibold">{Number(s.suggested_value)}%</td>
                    <td className="px-3 py-2 text-xs">{s.source_reference || "-"}</td>
                    <td className="px-3 py-2 text-xs">{s.notes || "-"}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => reviewSuggestion(s.id, s.tenant_slug, "approved")} className="mr-2 rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700">Approve</button>
                      <button onClick={() => reviewSuggestion(s.id, s.tenant_slug, "rejected")} className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700">Reject</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
