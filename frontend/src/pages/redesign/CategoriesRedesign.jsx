import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Download, FolderPlus, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../../api";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  Select,
  TableToolbar,
} from "../../ui/primitives";
import {
  indentLabel,
  leafCategories,
  parentOptions,
  sortCategories,
} from "../../utils/categoryTree";
import { downloadCsv } from "../../utils/csvExport";

const EMPTY = {
  id: null,
  name: "",
  description: "",
  parent_id: "",
  is_active: "1",
  sort_order: "0",
  tax_id: "",
  hs_code: "",
};

export default function CategoriesRedesign() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [conversionPrompt, setConversionPrompt] = useState(null);
  const [moveModal, setMoveModal] = useState(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moveSaving, setMoveSaving] = useState(false);
  const [taxes, setTaxes] = useState([]);

  useEffect(() => {
    api.get("/api/taxes").then(d => setTaxes(d.taxes || d || [])).catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/categories");
      setRows(sortCategories(data.categories || []));
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load categories");
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
    return rows.filter((r) =>
      [r.name, r.description, r.path_label].some((v) =>
        String(v || "")
          .toLowerCase()
          .includes(q),
      ),
    );
  }, [rows, search]);

  const openCreate = () => {
    setForm(EMPTY);
    setModalOpen(true);
  };

  const openAddChild = (row) => {
    setForm({
      ...EMPTY,
      parent_id: String(row.id),
    });
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      name: row.name || "",
      description: row.description || "",
      parent_id: row.parent_id ? String(row.parent_id) : "",
      is_active: String(Number(row.is_active ?? 1)),
      sort_order: String(row.sort_order ?? 0),
      tax_id: row.tax_id ? String(row.tax_id) : "",
      hs_code: row.hs_code || "",
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        description: form.description,
        parent_id: form.parent_id ? Number(form.parent_id) : null,
        is_active: Number(form.is_active),
        sort_order: Number(form.sort_order || 0),
        tax_id: form.tax_id ? Number(form.tax_id) : null,
        hs_code: form.hs_code || null,
      };
      if (form.id) {
        await api.put(`/api/categories/${form.id}`, payload);
      } else {
        await api.post("/api/categories", payload);
      }
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      if (!form.id && e2.body?.code === "parent_has_products" && form.parent_id) {
        setConversionPrompt({
          form: { ...form },
          parentId: Number(form.parent_id),
          directProductCount: Number(e2.body.direct_product_count || 0),
        });
        return;
      }
      setError(e2.body?.error || e2.message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const confirmCreateChildAndMove = async () => {
    if (!conversionPrompt) return;
    setSaving(true);
    setError("");
    try {
      const promptForm = conversionPrompt.form;
      await api.post("/api/categories/create-child-and-move", {
        name: promptForm.name,
        description: promptForm.description,
        parent_id: promptForm.parent_id ? Number(promptForm.parent_id) : null,
        is_active: Number(promptForm.is_active),
        sort_order: Number(promptForm.sort_order || 0),
      });
      setConversionPrompt(null);
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to create child category");
    } finally {
      setSaving(false);
    }
  };

  const openMoveProducts = (row) => {
    setMoveModal(row);
    setMoveTargetId("");
  };

  const moveProducts = async () => {
    if (!moveModal || !moveTargetId) return;
    setMoveSaving(true);
    setError("");
    try {
      await api.post(`/api/categories/${moveModal.id}/move-products`, { target_category_id: Number(moveTargetId) });
      setMoveModal(null);
      setMoveTargetId("");
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to move products");
    } finally {
      setMoveSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete category "${row.path_label || row.name}"?`))
      return;
    setError("");
    try {
      await api.del(`/api/categories/${row.id}`);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to delete category");
    }
  };

  const selectableParents = useMemo(
    () => parentOptions(rows, form.id ? Number(form.id) : null),
    [rows, form.id],
  );
  const moveTargetOptions = useMemo(() => {
    if (!moveModal) return [];
    const allLeaves = leafCategories(rows).filter(
      (row) => Number(row.id) !== Number(moveModal.id),
    );
    const childLeaves = allLeaves.filter(
      (row) =>
        Array.isArray(row.path_ids) &&
        row.path_ids.includes(Number(moveModal.id)),
    );
    return childLeaves.length ? childLeaves : allLeaves;
  }, [moveModal, rows]);
  const rootCount = rows.filter((r) => r.parent_id == null).length;
  const leafCount = rows.filter((r) => r.is_leaf).length;

  return (
    <PageShell
      title="Categories"
      subtitle="Hierarchical internal category tree for product organization and reporting."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(["id","name","parent_id","type","product_count","active"], visibleRows.map(r => [r.id, r.name||"", r.parent_id||"", r.type||"", r.product_count||0, r.active !== false ? "Yes" : "No"]), "categories")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" />
            Add Category
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Categories</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {rows.length}
          </p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Top Level</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{rootCount}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Leaf Categories</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{leafCount}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Visible</p>
          <p className="text-2xl font-semibold text-(--ui-text)">
            {visibleRows.length}
          </p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-60">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
              />
              <Input
                className="pl-8"
                placeholder="Search categories"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={
            <span className="text-xs text-(--ui-text-muted)">
              Delete is blocked when children or products exist
            </span>
          }
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Products</th>
                <th className="px-3 py-2 text-left">Children</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading &&
                visibleRows.map((row) => (
                  <tr key={row.id} className="border-t border-(--ui-border)">
                    <td className="px-3 py-2">
                      <div
                        className="font-medium text-(--ui-text)"
                        style={{
                          paddingLeft: `${Number(row.depth || 0) * 16}px`,
                        }}
                      >
                        {row.name}
                      </div>
                      {row.depth > 0 && (
                        <div className="text-xs text-(--ui-text-muted)">
                          {row.path_label}
                        </div>
                      )}
                      {row.description && (
                        <div className="text-xs text-(--ui-text-muted) italic">
                          {row.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={row.is_leaf ? "success" : "default"}>
                        {row.is_leaf ? "Leaf" : "Parent"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      Direct {row.product_count_direct || 0} / Rollup{" "}
                      {row.product_count_rollup || 0}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {row.child_count || 0}
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          Number(row.is_active || 0) === 1
                            ? "success"
                            : "default"
                        }
                      >
                        {Number(row.is_active || 0) === 1
                          ? "Active"
                          : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" onClick={() => openAddChild(row)}>
                          <FolderPlus size={12} className="mr-1 inline" />
                          Add Child
                        </Button>
                        {Number(row.product_count_direct || 0) > 0 ? (
                          <Button
                            size="sm"
                            onClick={() => openMoveProducts(row)}
                          >
                            <ArrowRightLeft size={12} className="mr-1 inline" />
                            Move Products
                          </Button>
                        ) : null}
                        <Button size="sm" onClick={() => openEdit(row)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          tone="danger"
                          onClick={() => remove(row)}
                        >
                          <Trash2 size={12} className="mr-1 inline" />
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {loading ? (
            <div className="p-8 text-center text-sm text-(--ui-text-muted)">
              Loading categories...
            </div>
          ) : null}
          {!loading && visibleRows.length === 0 ? (
            <EmptyState
              title="No categories"
              body="Create categories and nest them to organize inventory."
            />
          ) : null}
        </div>
      </SectionCard>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-lg p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              {form.id ? "Edit Category" : "Create Category"}
            </h3>
            <form className="mt-3 space-y-3" onSubmit={save}>
              <Input
                required
                placeholder="Category name"
                value={form.name}
                onChange={(e) =>
                  setForm((p) => ({ ...p, name: e.target.value }))
                }
              />
              <Input
                placeholder="Description"
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
              />
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">
                  Parent Category
                </label>
                <Select
                  value={form.parent_id}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, parent_id: e.target.value }))
                  }
                >
                  <option value="">Top level</option>
                  {selectableParents.map((row) => (
                    <option key={row.id} value={row.id}>
                      {indentLabel(row)}
                    </option>
                  ))}
                </Select>
                {form.parent_id ? (
                  <p className="mt-1 text-xs text-(--ui-text-muted)">
                    If the selected parent currently holds products, you will be
                    prompted to move them into this new child.
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">
                    Status
                  </label>
                  <Select
                    value={form.is_active}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, is_active: e.target.value }))
                    }
                  >
                    <option value="1">Active</option>
                    <option value="0">Inactive</option>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">
                    Sort Order
                  </label>
                  <Input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, sort_order: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">
                    Tax
                  </label>
                  <Select
                    value={form.tax_id}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, tax_id: e.target.value }))
                    }
                  >
                    <option value="">None (inherit from parent)</option>
                    {taxes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({Number(t.rate)}%)
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">
                    HS Code
                  </label>
                  <Input
                    value={form.hs_code}
                    placeholder="e.g. 4901"
                    onChange={(e) =>
                      setForm((p) => ({ ...p, hs_code: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button tone="primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
      {conversionPrompt ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 p-3">
          <SectionCard className="w-full max-w-lg p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              Convert Parent to Tree
            </h3>
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              The selected parent category currently has{" "}
              <span className="font-semibold text-(--ui-text)">
                {conversionPrompt.directProductCount}
              </span>{" "}
              directly assigned product(s). To keep products on leaf categories
              only, create this child and move those products into it.
            </p>
            <div className="mt-3 rounded-lg border border-(--ui-border) bg-(--ui-muted-surface) p-3 text-sm">
              <div className="font-medium text-(--ui-text)">
                New child: {conversionPrompt.form.name || "Untitled category"}
              </div>
              <div className="text-(--ui-text-muted)">
                Products will move to this child automatically.
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                onClick={() => setConversionPrompt(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                tone="primary"
                type="button"
                onClick={confirmCreateChildAndMove}
                disabled={saving}
              >
                {saving ? "Creating..." : "Create Child and Move Products"}
              </Button>
            </div>
          </SectionCard>
        </div>
      ) : null}
      {moveModal ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/55 p-3">
          <SectionCard className="w-full max-w-lg p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              Move Category Products
            </h3>
            <p className="mt-2 text-sm text-(--ui-text-muted)">
              Move all directly assigned products from{" "}
              <span className="font-semibold text-(--ui-text)">
                {moveModal.path_label || moveModal.name}
              </span>{" "}
              into another leaf category.
            </p>
            <div className="mt-3">
              <label className="mb-1 block text-xs text-(--ui-text-muted)">
                Target Leaf Category
              </label>
              <Select
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
              >
                <option value="">Select target category</option>
                {moveTargetOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {indentLabel(row)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                onClick={() => setMoveModal(null)}
                disabled={moveSaving}
              >
                Cancel
              </Button>
              <Button
                tone="primary"
                type="button"
                onClick={moveProducts}
                disabled={!moveTargetId || moveSaving}
              >
                {moveSaving ? "Moving..." : "Move Products"}
              </Button>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
