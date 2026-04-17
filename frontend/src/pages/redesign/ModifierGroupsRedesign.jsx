import { useState, useEffect, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge, Modal, ModalFooter, Input } from "../../ui/primitives";
import { Plus, Trash2, Pencil } from "lucide-react";
import { api } from "../../api";

export default function ModifierGroupsRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // group being edited (or {} for new)
  const [optionDialogGroup, setOptionDialogGroup] = useState(null);
  const [newOption, setNewOption] = useState({ name: "", price_delta: 0 });

  if (!flagsLoading && !flags.phase4_restaurant) return <Navigate to="/dashboard" replace />;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get("/api/modifiers/groups");
      setGroups(data.groups || []);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveGroup = async () => {
    try {
      const body = {
        name: editing.name,
        selection_type: editing.selection_type || "single",
        min_select: Number(editing.min_select || 0),
        max_select: editing.max_select ? Number(editing.max_select) : null,
        is_required: !!editing.is_required,
        display_order: Number(editing.display_order || 0),
      };
      if (editing.id) {
        await api.put(`/api/modifiers/groups/${editing.id}`, body);
        toast.success("Group updated");
      } else {
        await api.post("/api/modifiers/groups", body);
        toast.success("Group created");
      }
      setEditing(null);
      load();
    } catch (err) { toast.error(err.message); }
  };

  const deactivateGroup = async (id) => {
    if (!window.confirm("Deactivate this modifier group?")) return;
    try {
      await api.del(`/api/modifiers/groups/${id}`);
      toast.success("Group deactivated");
      load();
    } catch (err) { toast.error(err.message); }
  };

  const addOption = async () => {
    try {
      await api.post(`/api/modifiers/groups/${optionDialogGroup.id}/options`, {
        name: newOption.name,
        price_delta: Number(newOption.price_delta || 0),
      });
      toast.success("Option added");
      setNewOption({ name: "", price_delta: 0 });
      const data = await api.get("/api/modifiers/groups");
      setGroups(data.groups || []);
      setOptionDialogGroup(data.groups.find((g) => g.id === optionDialogGroup.id));
    } catch (err) { toast.error(err.message); }
  };

  const deactivateOption = async (optId) => {
    try {
      await api.del(`/api/modifiers/options/${optId}`);
      const data = await api.get("/api/modifiers/groups");
      setGroups(data.groups || []);
      setOptionDialogGroup(data.groups.find((g) => g.id === optionDialogGroup.id));
    } catch (err) { toast.error(err.message); }
  };

  return (
    <PageShell
      title="Modifier Groups"
      subtitle="Define option groups attached to menu items (e.g. doneness, toppings)"
      right={<Button onClick={() => setEditing({})}><Plus className="w-4 h-4 mr-1 inline" /> New group</Button>}
    >
      <SectionCard>
        {loading ? <p className="text-(--ui-text-muted) text-center py-8">Loading...</p> :
          groups.length === 0 ? <p className="text-(--ui-text-muted) text-center py-8">No modifier groups yet</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-(--ui-border)">
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-left py-2 px-3 font-medium">Type</th>
                <th className="text-left py-2 px-3 font-medium">Min/Max</th>
                <th className="text-left py-2 px-3 font-medium">Options</th>
                <th className="text-left py-2 px-3 font-medium">Required</th>
                <th className="text-right py-2 px-3 font-medium">Actions</th>
              </tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id} className="border-b border-(--ui-border) hover:bg-(--ui-bg-hover)">
                    <td className="py-2 px-3 font-medium">{g.name}</td>
                    <td className="py-2 px-3"><Badge tone="default">{g.selection_type}</Badge></td>
                    <td className="py-2 px-3">{g.min_select ?? 0} / {g.max_select ?? "∞"}</td>
                    <td className="py-2 px-3">
                      <button className="underline hover:no-underline" onClick={() => setOptionDialogGroup(g)}>
                        {g.options?.length || 0} options
                      </button>
                    </td>
                    <td className="py-2 px-3">{g.is_required ? <Badge tone="warning">Required</Badge> : "—"}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEditing(g)} className="p-1 rounded hover:bg-(--ui-bg-hover)"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => deactivateGroup(g.id)} className="p-1 rounded hover:bg-(--ui-bg-hover) text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit Group" : "New Group"} size="sm">
        {editing ? (
          <>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <Input value={editing.name || ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Selection type</label>
                <select className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg)" value={editing.selection_type || "single"} onChange={(e) => setEditing({ ...editing, selection_type: e.target.value })}>
                  <option value="single">Single</option>
                  <option value="multi">Multi</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Min select</label>
                  <Input type="number" min="0" value={editing.min_select ?? 0} onChange={(e) => setEditing({ ...editing, min_select: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Max select</label>
                  <Input type="number" min="0" value={editing.max_select ?? ""} onChange={(e) => setEditing({ ...editing, max_select: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!editing.is_required} onChange={(e) => setEditing({ ...editing, is_required: e.target.checked })} />
                <span className="text-sm">Required (guest must pick at least min_select)</span>
              </label>
            </div>
            <ModalFooter>
              <Button tone="plain" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveGroup}>{editing.id ? "Save" : "Create"}</Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>

      <Modal open={!!optionDialogGroup} onClose={() => setOptionDialogGroup(null)} title={optionDialogGroup ? `Options — ${optionDialogGroup.name}` : "Options"} size="md">
        {optionDialogGroup ? (
          <>
            <div className="space-y-3">
              {(optionDialogGroup.options || []).map((o) => (
                <div key={o.id} className="flex items-center justify-between border-b border-(--ui-border) pb-2">
                  <div>
                    <div className="font-medium">{o.name}</div>
                    <div className="text-xs text-(--ui-text-muted)">{Number(o.price_delta) >= 0 ? "+" : ""}{fmt(Number(o.price_delta))}</div>
                  </div>
                  <button onClick={() => deactivateOption(o.id)} className="p-1 rounded hover:bg-(--ui-bg-hover) text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
              <div className="pt-2 border-t border-(--ui-border)">
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs font-medium">Option name</label>
                    <Input value={newOption.name} onChange={(e) => setNewOption({ ...newOption, name: e.target.value })} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium">Price delta</label>
                    <Input type="number" value={newOption.price_delta} onChange={(e) => setNewOption({ ...newOption, price_delta: e.target.value })} />
                  </div>
                </div>
                <Button className="mt-2" onClick={addOption} disabled={!newOption.name}>Add option</Button>
              </div>
            </div>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
