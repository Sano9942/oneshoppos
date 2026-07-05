import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter } from "../../ui/primitives";
import { Plus, Trash2, Pencil, X } from "lucide-react";
import { api } from "../../api";

const SCOPE_TYPES = [
  { value: "global", label: "Global" },
  { value: "outlet", label: "Outlet" },
  { value: "role", label: "Role" },
  { value: "employee", label: "Employee" },
  { value: "device", label: "Device" },
];

const TILE_TYPES = [
  { value: "product", label: "Product Shortcut" },
  { value: "category", label: "Category Shortcut" },
  { value: "action", label: "Action Button" },
];

const ACTION_OPTIONS = [
  { value: "park_sale", label: "Park Sale" },
  { value: "discount", label: "Apply Discount" },
  { value: "customer_search", label: "Customer Search" },
  { value: "clear_cart", label: "Clear Cart" },
];

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#6366F1", "#14B8A6"];

const emptyTile = (pos) => ({ id: `tile-${Date.now()}-${pos}`, type: "product", product_id: null, category_id: null, action: null, label: "", color: COLORS[pos % COLORS.length], size: "1x1", position: { row: Math.floor(pos / 4), col: pos % 4 } });

export default function POSLayoutsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();

  const [layouts, setLayouts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  // Form
  const [form, setForm] = useState({ name: "", scope_type: "global", scope_id: null, tiles: [] });

  useEffect(() => {
    api.get("/api/pos-layouts/all").then(r => {
      setLayouts(r.layouts || []);
      setLoading(false);
    }).catch(() => setLoading(false));
    // 2-G.13: load registered devices for the Device scope picker. Silent
    // fail keeps the page usable if the flag is off or no devices yet.
    api.get("/api/pos-devices").then(r => setDevices(r.devices || [])).catch(() => {});
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", scope_type: "global", scope_id: null, tiles: [emptyTile(0)] });
    setShowModal(true);
  };

  const openEdit = (layout) => {
    setEditing(layout);
    setForm({ name: layout.name, scope_type: layout.scope_type, scope_id: layout.scope_id, tiles: layout.layout_json || [] });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error("Name is required");
    try {
      if (editing) {
        const res = await api.put(`/api/pos-layouts/${editing.id}`, { name: form.name, layout_json: form.tiles });
        setLayouts(prev => prev.map(l => l.id === editing.id ? res.layout : l));
        toast.success("Layout updated");
      } else {
        const res = await api.post("/api/pos-layouts", { name: form.name, scope_type: form.scope_type, scope_id: form.scope_id || null, layout_json: form.tiles });
        setLayouts(prev => [...prev, res.layout]);
        toast.success("Layout created");
      }
      setShowModal(false);
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this layout?")) return;
    try {
      await api.del(`/api/pos-layouts/${id}`);
      setLayouts(prev => prev.filter(l => l.id !== id));
      toast.success("Layout deleted");
    } catch (err) { toast.error(err.message); }
  };

  const updateTile = (idx, key, val) => setForm(f => ({ ...f, tiles: f.tiles.map((t, i) => i === idx ? { ...t, [key]: val } : t) }));
  const addTile = () => setForm(f => ({ ...f, tiles: [...f.tiles, emptyTile(f.tiles.length)] }));
  const removeTile = (idx) => setForm(f => ({ ...f, tiles: f.tiles.filter((_, i) => i !== idx) }));

  if (flagsLoading) return null;
  if (!flags.phase2_pos_layouts) return <Navigate to="/" replace />;

  return (
    <PageShell
      title="POS Layouts"
      subtitle="Configure tile shortcuts for the POS grid — per outlet, role, or employee"
      right={<Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" /> New Layout</Button>}
    >
      <SectionCard>
        {loading ? <p className="text-(--ui-muted) text-sm py-8 text-center">Loading...</p> : layouts.length === 0 ? (
          <p className="text-(--ui-muted) text-sm py-8 text-center">No POS layouts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-left text-(--ui-muted)">
                <th className="py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Scope</th>
                <th className="py-2 font-medium">Tiles</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {layouts.map(l => (
                <tr key={l.id} className="border-b border-(--ui-border)">
                  <td className="py-2 font-medium text-(--ui-text)">{l.name}</td>
                  <td className="py-2">
                    {l.scope_type}
                    {l.scope_id ? (
                      l.scope_type === "device"
                        ? ` · ${devices.find((d) => d.id === l.scope_id)?.label || `Device #${l.scope_id}`}`
                        : ` #${l.scope_id}`
                    ) : ""}
                  </td>
                  <td className="py-2">{l.layout_json?.length || 0}</td>
                  <td className="py-2"><Badge tone={l.is_active ? "success" : "default"}>{l.is_active ? "Active" : "Inactive"}</Badge></td>
                  <td className="py-2 text-right flex gap-1 justify-end">
                    <Button tone="plain" size="sm" iconOnly onClick={() => openEdit(l)} title="Edit" aria-label="Edit"><Pencil size={14} /></Button>
                    <Button tone="plain" size="sm" iconOnly onClick={() => handleDelete(l.id)} title="Delete" aria-label="Delete" className="hover:text-(--ui-danger-fg)"><Trash2 size={14} /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Preview section */}
      {layouts.length > 0 && (
        <SectionCard className="mt-4">
          <div className="p-4">
            <p className="text-xs font-semibold uppercase text-(--ui-muted) mb-3">Preview: {layouts[0]?.name}</p>
            <div className="grid grid-cols-4 gap-2">
              {(layouts[0]?.layout_json || []).map((tile, i) => (
                <div key={tile.id || i} className={`rounded-lg p-3 text-white text-center text-sm font-medium cursor-pointer ${tile.size === "2x1" ? "col-span-2" : ""}`} style={{ backgroundColor: tile.color || "#3B82F6" }}>
                  {tile.label || tile.type}
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      )}

      {/* Create/Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? "Edit Layout" : "New Layout"}
        size="xl"
      >
        <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm text-(--ui-muted) mb-1">Name</label>
                <input className="w-full border border-(--ui-border) rounded px-3 py-2 text-sm bg-(--ui-bg) text-(--ui-text)" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              {!editing && (
                <div>
                  <label className="block text-sm text-(--ui-muted) mb-1">Scope</label>
                  <select className="w-full border border-(--ui-border) rounded px-3 py-2 text-sm bg-(--ui-bg) text-(--ui-text)" value={form.scope_type} onChange={e => setForm(f => ({ ...f, scope_type: e.target.value }))}>
                    {SCOPE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            {!editing && form.scope_type !== "global" && form.scope_type !== "device" && (
              <div className="mb-3">
                <label className="block text-sm text-(--ui-muted) mb-1">Scope ID ({form.scope_type} ID)</label>
                <input className="w-full border border-(--ui-border) rounded px-3 py-2 text-sm bg-(--ui-bg) text-(--ui-text)" type="number" value={form.scope_id || ""} onChange={e => setForm(f => ({ ...f, scope_id: e.target.value ? Number(e.target.value) : null }))} />
              </div>
            )}

            {!editing && form.scope_type === "device" && (
              <div className="mb-3">
                <label className="block text-sm text-(--ui-muted) mb-1">Device</label>
                {devices.length === 0 ? (
                  <div className="text-xs text-(--ui-muted) italic">No devices registered yet. Open the POS on a terminal to register it.</div>
                ) : (
                  <select
                    className="w-full border border-(--ui-border) rounded px-3 py-2 text-sm bg-(--ui-bg) text-(--ui-text)"
                    value={form.scope_id || ""}
                    onChange={(e) => setForm((f) => ({ ...f, scope_id: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">Select a device…</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label || `Device #${d.id}`}
                        {d.outlet_name ? ` · ${d.outlet_name}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <label className="block text-sm font-medium text-(--ui-muted) mb-2">Tiles</label>
            {form.tiles.map((tile, idx) => (
              <div key={idx} className="flex gap-2 mb-2 items-center flex-wrap p-2 border border-(--ui-border) rounded">
                <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-32" value={tile.type} onChange={e => updateTile(idx, "type", e.target.value)}>
                  {TILE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-28" placeholder="Label" value={tile.label} onChange={e => updateTile(idx, "label", e.target.value)} />
                {tile.type === "product" && <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-24" type="number" placeholder="Product ID" value={tile.product_id || ""} onChange={e => updateTile(idx, "product_id", Number(e.target.value))} />}
                {tile.type === "category" && <input className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-24" type="number" placeholder="Category ID" value={tile.category_id || ""} onChange={e => updateTile(idx, "category_id", Number(e.target.value))} />}
                {tile.type === "action" && (
                  <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-32" value={tile.action || ""} onChange={e => updateTile(idx, "action", e.target.value)}>
                    <option value="">Select action</option>
                    {ACTION_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                )}
                <input className="border border-(--ui-border) rounded px-1 py-1 text-sm w-8 h-8" type="color" value={tile.color} onChange={e => updateTile(idx, "color", e.target.value)} />
                <select className="border border-(--ui-border) rounded px-2 py-1 text-sm bg-(--ui-bg) text-(--ui-text) w-16" value={tile.size} onChange={e => updateTile(idx, "size", e.target.value)}>
                  <option value="1x1">1x1</option>
                  <option value="2x1">2x1</option>
                </select>
                <Button tone="plain" size="sm" iconOnly onClick={() => removeTile(idx)} aria-label="Remove tile" className="text-(--ui-danger-fg)"><X size={14} /></Button>
              </div>
            ))}
            <Button tone="link" size="sm" onClick={addTile} className="mb-4">+ Add tile</Button>

            {/* Mini preview */}
            {form.tiles.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase text-(--ui-muted) mb-2">Preview</p>
                <div className="grid grid-cols-4 gap-2">
                  {form.tiles.map((tile, i) => (
                    <div key={i} className={`rounded-lg p-2 text-white text-center text-xs font-medium ${tile.size === "2x1" ? "col-span-2" : ""}`} style={{ backgroundColor: tile.color || "#3B82F6" }}>
                      {tile.label || tile.type}
                    </div>
                  ))}
                </div>
              </div>
            )}

        <ModalFooter>
          <Button size="sm" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button tone="primary" size="sm" onClick={handleSave}>{editing ? "Update" : "Create"}</Button>
        </ModalFooter>
      </Modal>
    </PageShell>
  );
}
