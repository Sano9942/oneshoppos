import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { Plus, Trash2, ChevronDown, ChevronUp, X } from "lucide-react";
import { api } from "../../api";

export default function OutletTaxProfilesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [profiles, setProfiles] = useState([]);
  const [taxes, setTaxes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [editLines, setEditLines] = useState([]);
  const [editName, setEditName] = useState("");

  useEffect(() => {
    Promise.all([
      api.get("/outlet-tax-profiles").catch(() => ({ profiles: [] })),
      api.get("/taxes").catch(() => ({ taxes: [] })),
      api.get("/categories").catch(() => ({ categories: [] })),
      api.get("/products?limit=500").catch(() => ({ products: [] })),
      api.get("/outlets").catch(() => ({ outlets: [] })),
    ]).then(([p, t, c, pr, o]) => {
      setProfiles(p.profiles || []);
      setTaxes(t.taxes || []);
      setCategories(c.categories || []);
      setProducts(pr.products || []);
      setOutlets(o.outlets || []);
      setLoading(false);
    });
  }, []);

  const toggleExpand = (profile) => {
    if (expanded === profile.id) {
      setExpanded(null);
    } else {
      setExpanded(profile.id);
      setEditName(profile.name);
      setEditLines(profile.lines || []);
    }
  };

  const startNewProfile = (outlet) => {
    setExpanded(`new-${outlet.id}`);
    setEditName("Default");
    setEditLines([]);
  };

  const handleSave = async (outletId) => {
    try {
      const res = await api.put(`/outlet-tax-profiles/${outletId}`, {
        name: editName,
        is_active: true,
        lines: editLines.map(l => ({ category_id: l.category_id || null, product_id: l.product_id || null, tax_id: l.tax_id, priority: l.priority || 0 })),
      });
      setProfiles(prev => {
        const idx = prev.findIndex(p => p.outlet_id === outletId);
        if (idx >= 0) return prev.map(p => p.outlet_id === outletId ? { ...res.profile, lines: editLines } : p);
        return [...prev, { ...res.profile, lines: editLines, outlet_name: outlets.find(o => o.id === outletId)?.name }];
      });
      toast.success("Tax profile saved");
      setExpanded(null);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (outletId) => {
    if (!confirm("Remove tax profile for this outlet?")) return;
    try {
      await api.del(`/outlet-tax-profiles/${outletId}`);
      setProfiles(prev => prev.filter(p => p.outlet_id !== outletId));
      toast.success("Tax profile removed");
    } catch (err) { toast.error(err.message); }
  };

  const addLine = () => setEditLines(prev => [...prev, { category_id: null, product_id: null, tax_id: taxes[0]?.id || 0, priority: 0 }]);
  const removeLine = (idx) => setEditLines(prev => prev.filter((_, i) => i !== idx));
  const updateLine = (idx, key, val) => setEditLines(prev => prev.map((l, i) => i === idx ? { ...l, [key]: val } : l));

  if (flagsLoading) return null;
  if (!flags.phase2_outlet_tax) return <Navigate to="/" replace />;

  const profiledOutletIds = new Set(profiles.map(p => p.outlet_id));
  const outletsWithoutProfile = outlets.filter(o => o.is_active !== false && !profiledOutletIds.has(o.id));

  return (
    <PageShell
      title="Outlet Tax Profiles"
      subtitle="Override tax rates per outlet for region-specific taxation"
    >
      <SectionCard>
        {loading ? (
          <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p>
        ) : (
          <div className="space-y-3">
            {profiles.map(p => (
              <div key={p.id} className="border border-(--ui-border) rounded-lg">
                <div className="flex items-center justify-between px-4 py-3 cursor-pointer" onClick={() => toggleExpand(p)}>
                  <div>
                    <span className="font-medium text-(--ui-text)">{p.outlet_name}</span>
                    <span className="text-(--ui-muted) text-sm ml-2">- {p.name}</span>
                    <Badge tone={p.is_active ? "success" : "default"} className="ml-2">{p.is_active ? "Active" : "Inactive"}</Badge>
                    <span className="text-(--ui-muted) text-xs ml-2">{p.lines?.length || 0} overrides</span>
                  </div>
                  <div className="flex gap-2 items-center">
                    <button onClick={(e) => { e.stopPropagation(); handleDelete(p.outlet_id); }} className="p-1 hover:text-red-500"><Trash2 size={14} /></button>
                    {expanded === p.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </div>
                {expanded === p.id && (
                  <div className="px-4 pb-4 border-t border-(--ui-border)">
                    <div className="mt-3 mb-3">
                      <label className="text-sm text-(--ui-muted)">Profile Name</label>
                      <input className="w-full border border-(--ui-border) rounded px-3 py-1.5 text-sm bg-(--ui-bg) text-(--ui-text) mt-1" value={editName} onChange={e => setEditName(e.target.value)} />
                    </div>
                    <label className="text-sm font-medium text-(--ui-muted)">Tax Override Lines</label>
                    {editLines.map((line, idx) => (
                      <div key={idx} className="flex gap-2 mt-2 items-center">
                        <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-40" value={line.category_id || ""} onChange={e => updateLine(idx, "category_id", e.target.value ? Number(e.target.value) : null)}>
                          <option value="">Any Category</option>
                          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-40" value={line.product_id || ""} onChange={e => updateLine(idx, "product_id", e.target.value ? Number(e.target.value) : null)}>
                          <option value="">Any Product</option>
                          {products.slice(0, 100).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-36" value={line.tax_id} onChange={e => updateLine(idx, "tax_id", Number(e.target.value))}>
                          {taxes.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
                        </select>
                        <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-16" type="number" placeholder="Priority" value={line.priority} onChange={e => updateLine(idx, "priority", Number(e.target.value))} />
                        <button onClick={() => removeLine(idx)} className="text-red-500 p-1"><X size={14} /></button>
                      </div>
                    ))}
                    <button onClick={addLine} className="text-sm text-blue-500 mt-2 hover:underline">+ Add override line</button>
                    <div className="flex gap-2 justify-end mt-4">
                      <Button tone="plain" size="sm" onClick={() => setExpanded(null)}>Cancel</Button>
                      <Button size="sm" onClick={() => handleSave(p.outlet_id)}>Save</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {outletsWithoutProfile.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-(--ui-muted) mb-2">Outlets without a tax profile:</p>
                <div className="flex flex-wrap gap-2">
                  {outletsWithoutProfile.map(o => (
                    <Button key={o.id} size="sm" tone="plain" onClick={() => startNewProfile(o)}>
                      <Plus size={12} className="mr-1" /> {o.name}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Inline new profile creation */}
            {expanded && String(expanded).startsWith("new-") && (() => {
              const outletId = Number(String(expanded).replace("new-", ""));
              const outlet = outlets.find(o => o.id === outletId);
              return (
                <div className="border border-blue-300 rounded-lg p-4 mt-2">
                  <h3 className="font-medium text-(--ui-text) mb-3">New Tax Profile for {outlet?.name}</h3>
                  <div className="mb-3">
                    <label className="text-sm text-(--ui-muted)">Profile Name</label>
                    <input className="w-full border border-(--ui-border) rounded px-3 py-1.5 text-sm bg-(--ui-bg) text-(--ui-text) mt-1" value={editName} onChange={e => setEditName(e.target.value)} />
                  </div>
                  <label className="text-sm font-medium text-(--ui-muted)">Tax Override Lines</label>
                  {editLines.map((line, idx) => (
                    <div key={idx} className="flex gap-2 mt-2 items-center">
                      <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-40" value={line.category_id || ""} onChange={e => updateLine(idx, "category_id", e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Any Category</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-40" value={line.product_id || ""} onChange={e => updateLine(idx, "product_id", e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Any Product</option>
                        {products.slice(0, 100).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-36" value={line.tax_id} onChange={e => updateLine(idx, "tax_id", Number(e.target.value))}>
                        {taxes.map(t => <option key={t.id} value={t.id}>{t.name} ({Number(t.rate)}%)</option>)}
                      </select>
                      <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-16" type="number" placeholder="Priority" value={line.priority} onChange={e => updateLine(idx, "priority", Number(e.target.value))} />
                      <button onClick={() => removeLine(idx)} className="text-red-500 p-1"><X size={14} /></button>
                    </div>
                  ))}
                  <button onClick={addLine} className="text-sm text-blue-500 mt-2 hover:underline">+ Add override line</button>
                  <div className="flex gap-2 justify-end mt-4">
                    <Button tone="plain" size="sm" onClick={() => setExpanded(null)}>Cancel</Button>
                    <Button size="sm" onClick={() => handleSave(outletId)}>Create Profile</Button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}
