import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter } from "../../ui/primitives";
import { Plus, Trash2, Pencil, Eye, X } from "lucide-react";
import { api } from "../../api";

const FIELDS = [
  { value: "category_id", label: "Category" },
  { value: "brand_id", label: "Brand" },
  { value: "product_type", label: "Product Type" },
  { value: "vendor", label: "Vendor" },
  { value: "tags", label: "Tags" },
  { value: "price", label: "Price" },
  { value: "stock", label: "Stock" },
  { value: "status", label: "Status" },
  { value: "created_at", label: "Created At" },
];

const OPERATORS = [
  { value: "equals", label: "equals" },
  { value: "not_equals", label: "does not equal" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
  { value: "contains", label: "contains" },
  { value: "starts_with", label: "starts with" },
  { value: "in", label: "is in (comma-separated)" },
];

const SORT_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "name_asc", label: "Name A-Z" },
  { value: "name_desc", label: "Name Z-A" },
  { value: "price_asc", label: "Price Low-High" },
  { value: "price_desc", label: "Price High-Low" },
  { value: "created_at_desc", label: "Newest First" },
];

const emptyRule = () => ({ field: "category_id", operator: "equals", value: "" });

export default function SmartCollectionsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewCollection, setViewCollection] = useState(null);

  // Form state
  const [form, setForm] = useState({ name: "", description: "", disjunctive: false, sort_order: "manual", rules: [emptyRule()] });

  useEffect(() => {
    api.get("/api/smart-collections").then(r => {
      setCollections(r.collections || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", description: "", disjunctive: false, sort_order: "manual", rules: [emptyRule()] });
    setShowModal(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({ name: c.name, description: c.description || "", disjunctive: c.disjunctive, sort_order: c.sort_order || "manual", rules: c.rules?.length ? c.rules.map(r => ({ field: r.field, operator: r.operator, value: r.value })) : [emptyRule()] });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    if (!form.rules.every(r => r.value.trim())) return toast.error("All rules must have a value");
    try {
      if (editing) {
        const res = await api.put(`/api/smart-collections/${editing.id}`, form);
        setCollections(prev => prev.map(c => c.id === editing.id ? { ...res.collection, rules: form.rules } : c));
        toast.success("Collection updated");
      } else {
        const res = await api.post("/api/smart-collections", form);
        setCollections(prev => [...prev, { ...res.collection, rules: form.rules }]);
        toast.success("Collection created");
      }
      setShowModal(false);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this collection?")) return;
    try {
      await api.del(`/api/smart-collections/${id}`);
      setCollections(prev => prev.filter(c => c.id !== id));
      toast.success("Collection deleted");
    } catch (err) { toast.error(err.message); }
  };

  const handleView = async (id) => {
    try {
      const res = await api.get(`/api/smart-collections/${id}`);
      setViewCollection(res.collection);
    } catch (err) { toast.error(err.message); }
  };

  const updateRule = (idx, key, val) => {
    setForm(f => ({ ...f, rules: f.rules.map((r, i) => i === idx ? { ...r, [key]: val } : r) }));
  };

  const addRule = () => setForm(f => ({ ...f, rules: [...f.rules, emptyRule()] }));
  const removeRule = (idx) => setForm(f => ({ ...f, rules: f.rules.filter((_, i) => i !== idx) }));

  if (flagsLoading) return null;
  if (!flags.phase2_smart_collections) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="Smart Collections"
      subtitle="Auto-curate product groups with rule-based matching"
      right={<Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" /> New Collection</Button>}
    >
      <SectionCard>
        {loading ? (
          <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p>
        ) : collections.length === 0 ? (
          <p className="text-(--ui-muted) text-sm py-8 text-center">No smart collections yet. Create one to auto-group products by rules.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Rules</th>
                <th className="py-2 font-medium">Mode</th>
                <th className="py-2 font-medium">Sort</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {collections.map(c => (
                <tr key={c.id} className="border-b border-(--ui-border)">
                  <td className="py-2 font-medium text-(--ui-text)">{c.name}</td>
                  <td className="py-2">{c.rules?.length || 0} rules</td>
                  <td className="py-2"><Badge tone={c.disjunctive ? "warning" : "default"}>{c.disjunctive ? "OR" : "AND"}</Badge></td>
                  <td className="py-2">{c.sort_order}</td>
                  <td className="py-2"><Badge tone={c.is_active ? "success" : "default"}>{c.is_active ? "Active" : "Inactive"}</Badge></td>
                  <td className="py-2 text-right flex gap-1 justify-end">
                    <Button tone="plain" size="sm" iconOnly onClick={() => handleView(c.id)} title="View" aria-label="View"><Eye size={14} /></Button>
                    <Button tone="plain" size="sm" iconOnly onClick={() => openEdit(c)} title="Edit" aria-label="Edit"><Pencil size={14} /></Button>
                    <Button tone="plain" size="sm" iconOnly onClick={() => handleDelete(c.id)} title="Delete" aria-label="Delete" className="hover:text-red-500"><Trash2 size={14} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? "Edit Collection" : "New Collection"}
        size="lg"
      >
        <label className="block text-sm font-medium text-(--ui-muted) mb-1">Name</label>
        <input className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />

        <label className="block text-sm font-medium text-(--ui-muted) mb-1">Description</label>
        <textarea className="w-full border border-(--ui-border) rounded px-3 py-2 mb-3 text-sm bg-(--ui-bg) text-(--ui-text)" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />

        <div className="flex gap-4 mb-3">
          <label className="flex items-center gap-2 text-sm text-(--ui-text)">
            <input type="checkbox" checked={form.disjunctive} onChange={e => setForm(f => ({ ...f, disjunctive: e.target.checked }))} />
            OR mode (match any rule)
          </label>
          <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text)" value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <label className="block text-sm font-medium text-(--ui-muted) mb-2">Rules</label>
        {form.rules.map((rule, idx) => (
          <div key={idx} className="flex gap-2 mb-2 items-center">
            <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-32" value={rule.field} onChange={e => updateRule(idx, "field", e.target.value)}>
              {FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-36" value={rule.operator} onChange={e => updateRule(idx, "operator", e.target.value)}>
              {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) grow" placeholder="Value" value={rule.value} onChange={e => updateRule(idx, "value", e.target.value)} />
            {form.rules.length > 1 && <Button tone="plain" size="sm" iconOnly onClick={() => removeRule(idx)} aria-label="Remove rule" className="text-red-500"><X size={14} /></Button>}
          </div>
        ))}
        <Button tone="link" size="sm" onClick={addRule} className="mb-4">+ Add rule</Button>

        <ModalFooter>
          <Button size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button tone="primary" size="sm" onClick={handleSave}>{editing ? "Update" : "Create"}</Button>
        </ModalFooter>
      </Modal>

      {/* View Collection Detail */}
      <Modal
        open={!!viewCollection}
        onClose={() => setViewCollection(null)}
        title={viewCollection ? `${viewCollection.name} (${viewCollection.product_count} products)` : ""}
        size="xl"
      >
        {viewCollection && (
          <>
            <div className="mb-3">
              <p className="text-sm text-(--ui-muted)">Rules: {viewCollection.rules?.map(r => `${r.field} ${r.operator} ${r.value}`).join(viewCollection.disjunctive ? " OR " : " AND ")}</p>
            </div>

            {viewCollection.products?.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 font-medium">Barcode</th>
                    <th className="py-2 font-medium">Price</th>
                    <th className="py-2 font-medium">Stock</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {viewCollection.products.map(p => (
                    <tr key={p.id} className="border-b border-(--ui-border)">
                      <td className="py-2 text-(--ui-text)">{p.name}</td>
                      <td className="py-2">{p.barcode || "-"}</td>
                      <td className="py-2">{Number(p.price).toFixed(2)}</td>
                      <td className="py-2">{p.stock}</td>
                      <td className="py-2"><Badge tone={p.status === "active" ? "success" : "default"}>{p.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-(--ui-muted) text-sm py-4 text-center">No products match these rules.</p>
            )}
          </>
        )}
      </Modal>
    </PageShell>
  );
}
