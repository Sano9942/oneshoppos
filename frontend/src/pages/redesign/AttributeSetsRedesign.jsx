import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { API_BASE as API } from "../../config";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const EMPTY_FORM = {
  id: null,
  name: "",
  description: "",
  attributes: [{ name: "", options: [] }],
};

export default function AttributeSetsRedesign() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [optionInputs, setOptionInputs] = useState({});

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/attribute-sets`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load attribute sets");
      setRows(data.attributeSets || []);
      setSelectedId((prev) => prev ?? data.attributeSets?.[0]?.id ?? null);
    } catch (e) {
      setError(e.message || "Failed to load attribute sets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((r) => String(r.name || "").toLowerCase().includes(q));
  }, [rows, search]);

  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) || null,
    [rows, selectedId],
  );

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setOptionInputs({});
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      name: row.name || "",
      description: row.description || "",
      attributes:
        row.attributes?.map((a) => ({
          name: a.name,
          options: (a.options || []).map((o) => o.value),
        })) || [],
    });
    setOptionInputs({});
    setModalOpen(true);
  };

  const addAttribute = () => {
    setForm((p) => ({
      ...p,
      attributes: [...p.attributes, { name: "", options: [] }],
    }));
  };

  const removeAttribute = (idx) => {
    setForm((p) => ({
      ...p,
      attributes: p.attributes.filter((_, i) => i !== idx),
    }));
  };

  const addOption = (attrIndex) => {
    const raw = (optionInputs[attrIndex] || "").trim();
    if (!raw) return;
    const values = raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    setForm((p) => {
      const next = [...p.attributes];
      const current = new Set(next[attrIndex].options || []);
      values.forEach((v) => current.add(v));
      next[attrIndex] = { ...next[attrIndex], options: [...current] };
      return { ...p, attributes: next };
    });
    setOptionInputs((prev) => ({ ...prev, [attrIndex]: "" }));
  };

  const removeOption = (attrIndex, optIndex) => {
    setForm((p) => {
      const next = [...p.attributes];
      next[attrIndex] = {
        ...next[attrIndex],
        options: next[attrIndex].options.filter((_, i) => i !== optIndex),
      };
      return { ...p, attributes: next };
    });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const cleanAttrs = (form.attributes || [])
        .filter((a) => String(a.name || "").trim())
        .map((a) => ({
          name: String(a.name).trim(),
          options: (a.options || []).filter(Boolean),
        }));

      const url = form.id
        ? `${API}/api/attribute-sets/${form.id}`
        : `${API}/api/attribute-sets`;
      const method = form.id ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || null,
          attributes: cleanAttrs,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save attribute set");

      setModalOpen(false);
      setForm(EMPTY_FORM);
      await load();
      if (form.id) setSelectedId(form.id);
      else if (data.id) setSelectedId(data.id);
    } catch (e2) {
      setError(e2.message || "Failed to save attribute set");
    } finally {
      setSaving(false);
    }
  };

  const removeSet = async (row) => {
    if (!window.confirm(`Delete attribute set "${row.name}"?`)) return;
    setError("");
    try {
      const res = await fetch(`${API}/api/attribute-sets/${row.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete attribute set");
      await load();
      if (selectedId === row.id) setSelectedId(null);
    } catch (e) {
      setError(e.message || "Failed to delete attribute set");
    }
  };

  return (
    <PageShell
      title="Attribute Sets"
      subtitle="variant schema management with nested attributes and options."
      right={
        <Button tone="primary" onClick={openCreate}>
          <Plus size={14} className="mr-1 inline" />
          New Set
        </Button>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-7">
          <TableToolbar
            left={
              <div className="relative min-w-60">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
                <Input
                  className="pl-8"
                  placeholder="Search attribute sets"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            }
            right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} sets</span>}
          />

          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Set</th>
                  <th className="px-3 py-2 text-center">Attributes</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loading && visibleRows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-(--ui-border) ${selectedId === row.id ? "bg-emerald-50" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <button className="text-left" onClick={() => setSelectedId(row.id)}>
                        <p className="font-medium text-(--ui-text)">{row.name}</p>
                        <p className="text-xs text-(--ui-text-muted)">{row.description || "No description"}</p>
                      </button>
                    </td>
                    <td className="px-3 py-2 text-center text-(--ui-text)">{(row.attributes || []).length}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openEdit(row)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => removeSet(row)}><Trash2 size={12} className="mr-1 inline" />Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loading ? <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading sets...</div> : null}
            {!loading && visibleRows.length === 0 ? <EmptyState title="No attribute sets" body="Create your first set to manage product variants." /> : null}
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-5 p-3">
          {!selected ? (
            <EmptyState title="Select an attribute set" body="Click a set to inspect attributes and options." />
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-(--ui-text)">{selected.name}</h3>
                <p className="text-xs text-(--ui-text-muted)">{selected.description || "No description"}</p>
              </div>
              <div className="max-h-105 space-y-2 overflow-auto">
                {(selected.attributes || []).map((attr) => (
                  <SectionCard key={attr.id} className="p-2">
                    <p className="text-sm font-semibold text-(--ui-text)">{attr.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(attr.options || []).length === 0 ? (
                        <span className="text-xs text-(--ui-text-muted)">No options</span>
                      ) : (
                        attr.options.map((opt) => (
                          <Badge key={opt.id}>{opt.value}</Badge>
                        ))
                      )}
                    </div>
                  </SectionCard>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="max-h-[90vh] w-full max-w-2xl overflow-auto p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              {form.id ? "Edit Attribute Set" : "Create Attribute Set"}
            </h3>
            <form className="mt-3 space-y-3" onSubmit={save}>
              <Input required placeholder="Set name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <Input placeholder="Description" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />

              <SectionCard className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-(--ui-text)">Attributes</p>
                  <Button size="sm" type="button" onClick={addAttribute}>Add Attribute</Button>
                </div>
                <div className="space-y-3">
                  {(form.attributes || []).map((attr, idx) => (
                    <div key={`attr-${idx}`} className="rounded border border-(--ui-border) p-2">
                      <div className="mb-2 flex gap-2">
                        <Input
                          placeholder="Attribute name (e.g. Size)"
                          value={attr.name}
                          onChange={(e) => {
                            const next = [...form.attributes];
                            next[idx] = { ...next[idx], name: e.target.value };
                            setForm((p) => ({ ...p, attributes: next }));
                          }}
                        />
                        {(form.attributes || []).length > 1 ? (
                          <Button size="sm" tone="danger" type="button" onClick={() => removeAttribute(idx)}>
                            <X size={12} />
                          </Button>
                        ) : null}
                      </div>

                      <div className="mb-2 flex flex-wrap gap-1">
                        {(attr.options || []).map((opt, optIdx) => (
                          <span key={`${opt}-${optIdx}`} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">
                            {opt}
                            <button type="button" onClick={() => removeOption(idx, optIdx)}>
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>

                      <div className="flex gap-2">
                        <Input
                          placeholder="Type option(s), comma separated"
                          value={optionInputs[idx] || ""}
                          onChange={(e) => setOptionInputs((p) => ({ ...p, [idx]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addOption(idx);
                            }
                          }}
                        />
                        <Button size="sm" type="button" onClick={() => addOption(idx)}>Add</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
