import { useState, useEffect } from "react";
import { adminFetch } from "./AdminLogin";

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
      const res = await adminFetch(`/api/admin/tax-rates`);
      const data = await res.json();
      setRates(data.rates || []);
    } catch { /* ignore */ }
  };

  const fetchSuggestions = async () => {
    try {
      const res = await adminFetch(`/api/admin/tax-rate-suggestions`);
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
        ? `/api/admin/tax-rates/${editRow.id}`
        : `/api/admin/tax-rates`;
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
    await adminFetch(`/api/admin/tax-rates/${id}`, { method: "DELETE" });
    fetchRates();
  };

  const reviewSuggestion = async (id, tenantSlug, status) => {
    await adminFetch(`/api/admin/tax-rate-suggestions/${id}`, {
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

  if (loading) return <div className="p-6 text-center text-(--ui-text-muted)">Loading...</div>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-(--ui-text) mb-4">Tax Rate Reference</h1>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab("rates")}
          className={`ui-focus-ring px-4 py-2 rounded-full text-sm font-semibold transition ${tab === "rates" ? "bg-(--ui-primary) text-(--ui-on-primary)" : "bg-(--ui-muted-surface) text-(--ui-text-muted) hover:bg-(--ui-border-strong) hover:text-(--ui-text)"}`}
        >
          Tax Rates ({rates.length})
        </button>
        <button
          onClick={() => setTab("suggestions")}
          className={`ui-focus-ring px-4 py-2 rounded-full text-sm font-semibold transition ${tab === "suggestions" ? "bg-(--ui-primary) text-(--ui-on-primary)" : "bg-(--ui-muted-surface) text-(--ui-text-muted) hover:bg-(--ui-border-strong) hover:text-(--ui-text)"}`}
        >
          Suggestions ({suggestions.length})
        </button>
      </div>

      {msg && (
        <div className="mb-3 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) px-3 py-2 text-sm text-(--ui-text)">
          {msg}
          <button onClick={() => setMsg("")} className="ml-2 font-bold">&times;</button>
        </div>
      )}

      {tab === "rates" && (
        <>
          <button
            onClick={startAdd}
            className="ui-focus-ring mb-3 rounded-full bg-(--ui-primary) px-4 py-2 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)"
          >
            + Add Rate
          </button>

          {(addMode || editRow) && (
            <div className="mb-4 rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface) p-4">
              <h3 className="text-lg font-bold text-(--ui-text) mb-3">{editRow ? "Edit Rate" : "Add Rate"}</h3>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">HS Code</label>
                  <input className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)" value={form.hs_code || ""} onChange={(e) => setForm({ ...form, hs_code: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">Description (EN)</label>
                  <input className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)" value={form.description_en || ""} onChange={(e) => setForm({ ...form, description_en: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-(--ui-text-muted)">Description (UR)</label>
                  <input className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)" dir="rtl" value={form.description_ur || ""} onChange={(e) => setForm({ ...form, description_ur: e.target.value })} />
                </div>
                {PROVINCE_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-(--ui-text-muted)">{f.label} %</label>
                    <input className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)" type="number" step="0.01" value={form[f.key] ?? ""} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="text-xs font-medium text-(--ui-text-muted)">Exemption Notes</label>
                  <input className="ui-focus-ring w-full border border-(--ui-border-strong) bg-white rounded-(--ui-radius-sm) px-2 py-1.5 text-sm text-(--ui-text)" value={form.exemption_notes || ""} onChange={(e) => setForm({ ...form, exemption_notes: e.target.value })} />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={saveRate} className="ui-focus-ring rounded-full bg-(--ui-primary) px-4 py-1.5 text-sm font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)">Save</button>
                <button onClick={() => { setEditRow(null); setAddMode(false); setForm({}); }} className="ui-focus-ring rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-sm font-semibold text-(--ui-text) transition hover:bg-(--ui-border-strong)">Cancel</button>
              </div>
            </div>
          )}

          <div className="overflow-auto rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
            <table className="min-w-full text-sm">
              <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border) text-(--ui-text-muted)">
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
                  <tr key={r.id} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2 font-mono text-(--ui-text)">{r.hs_code}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{r.description_en}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{Number(r.federal_gst)}%</td>
                    <td className="px-3 py-2 text-(--ui-text)">{Number(r.punjab_pra)}%</td>
                    <td className="px-3 py-2 text-(--ui-text)">{Number(r.sindh_srb)}%</td>
                    <td className="px-3 py-2 text-(--ui-text)">{Number(r.kpk_kpra)}%</td>
                    <td className="px-3 py-2 text-(--ui-text)">{Number(r.balochistan_bra)}%</td>
                    <td className="px-3 py-2 text-xs text-(--ui-text-muted)">{r.exemption_notes || "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => startEdit(r)} className="mr-3 text-(--ui-link) hover:underline text-xs font-semibold">Edit</button>
                      <button onClick={() => deleteRate(r.id)} className="text-(--ui-danger) hover:underline text-xs font-semibold">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "suggestions" && (
        <div className="overflow-auto rounded-(--ui-radius-md) border border-(--ui-border) bg-(--ui-surface)">
          {suggestions.length === 0 ? (
            <p className="p-6 text-center text-(--ui-text-muted)">No pending suggestions</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border) text-(--ui-text-muted)">
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
                  <tr key={`${s.tenant_slug}-${s.id}`} className="border-b border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2 text-(--ui-text)">{s.tenant_name}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{s.reference_id}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{s.field_name}</td>
                    <td className="px-3 py-2 text-(--ui-text)">{s.current_value != null ? `${Number(s.current_value)}%` : "-"}</td>
                    <td className="px-3 py-2 font-semibold text-(--ui-text)">{Number(s.suggested_value)}%</td>
                    <td className="px-3 py-2 text-xs text-(--ui-text-muted)">{s.source_reference || "-"}</td>
                    <td className="px-3 py-2 text-xs text-(--ui-text-muted)">{s.notes || "-"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => reviewSuggestion(s.id, s.tenant_slug, "approved")} className="ui-focus-ring mr-2 rounded-full bg-(--ui-primary) px-3 py-1 text-xs font-semibold text-(--ui-on-primary) transition hover:bg-(--ui-primary-strong)">Approve</button>
                      <button onClick={() => reviewSuggestion(s.id, s.tenant_slug, "rejected")} className="ui-focus-ring rounded-full bg-(--ui-danger) px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90">Reject</button>
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
