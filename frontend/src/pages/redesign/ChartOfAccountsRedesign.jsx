import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Lock, Plus, Search, Trash2, Edit2 } from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import { downloadCsv } from "../../utils/csvExport";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  Select,
} from "../../ui/primitives";

const TYPE_LABELS = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  expense: "Expenses",
};
const TYPE_ORDER = ["asset", "liability", "equity", "revenue", "expense"];
const TYPE_COLORS = {
  asset: "blue",
  liability: "red",
  equity: "purple",
  revenue: "green",
  expense: "orange",
};

const EMPTY_FORM = {
  id: null,
  code: "",
  name: "",
  type: "asset",
  sub_type: "",
  parent_id: "",
  description: "",
};

export default function ChartOfAccountsRedesign() {
  const { fmt } = useCurrency();
  const [accounts, setAccounts] = useState([]);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/accounting/coa");
      setAccounts(data.accounts || []);
      setTree(data.tree || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Expand all by default on first load
  useEffect(() => {
    if (accounts.length && expanded.size === 0) {
      setExpanded(new Set(accounts.filter((a) => accounts.some((c) => c.parent_id === a.id)).map((a) => a.id)));
    }
  }, [accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasAccounts = accounts.length > 0;

  // Group flat accounts by type for search-filtered view
  const filteredByType = useMemo(() => {
    const q = search.toLowerCase();
    const filtered = q
      ? accounts.filter((a) => a.name.toLowerCase().includes(q) || a.code.includes(q))
      : accounts;
    const grouped = {};
    for (const type of TYPE_ORDER) grouped[type] = [];
    for (const a of filtered) {
      if (grouped[a.type]) grouped[a.type].push(a);
    }
    return grouped;
  }, [accounts, search]);

  const toggleExpand = (id) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = async () => {
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
    // Auto-suggest next code for default type
    try {
      const data = await api.get("/api/accounting/coa/next-code/asset");
      setForm((f) => ({ ...f, code: data.next_code || "" }));
    } catch { /* ignore */ }
  };

  const openEdit = (account) => {
    setForm({
      id: account.id,
      code: account.code,
      name: account.name,
      type: account.type,
      sub_type: account.sub_type || "",
      parent_id: account.parent_id || "",
      description: account.description || "",
      is_system: account.is_system,
    });
    setModalOpen(true);
  };

  const handleTypeChange = async (type) => {
    setForm((f) => ({ ...f, type }));
    if (!form.id) {
      try {
        const data = await api.get(`/api/accounting/coa/next-code/${type}`);
        setForm((f) => ({ ...f, code: data.next_code || f.code }));
      } catch { /* ignore */ }
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (form.id) {
        await api.put(`/api/accounting/coa/${form.id}`, form);
      } else {
        await api.post("/api/accounting/coa", form);
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e.body?.error || e.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Deactivate this account?")) return;
    try {
      await api.del(`/api/accounting/coa/${id}`);
      load();
    } catch (e) {
      setError(e.body?.error || e.message || "Delete failed");
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      await api.post("/api/accounting/coa/seed");
      load();
    } catch (e) {
      setError(e.body?.error || e.message || "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

  const handleExport = () => {
    const headers = ["Code", "Name", "Type", "Sub-Type", "System", "Active", "Normal Balance"];
    const rows = accounts.map((a) => [
      a.code, a.name, a.type, a.sub_type || "", a.is_system ? "Yes" : "No",
      a.is_active ? "Yes" : "No", a.normal_balance,
    ]);
    downloadCsv(headers, rows, "chart-of-accounts.csv");
  };

  // Possible parents: active accounts of same type (exclude self and children)
  const parentOptions = useMemo(() => {
    const type = form.type;
    return accounts
      .filter((a) => a.type === type && a.is_active && a.id !== form.id)
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [accounts, form.type, form.id]);

  // Render tree node recursively
  const renderNode = (node, depth = 0) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded.has(node.id);

    return (
      <div key={node.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 ${!node.is_active ? "opacity-50" : ""}`}
          style={{ paddingLeft: `${depth * 24 + 12}px` }}
        >
          {hasChildren ? (
            <button
              onClick={() => toggleExpand(node.id)}
              className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 shrink-0"
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="w-5 shrink-0" />
          )}

          <span className="font-mono text-sm text-gray-500 dark:text-gray-400 w-14 shrink-0">{node.code}</span>
          <span className="font-medium text-sm grow">{node.name}</span>
          <Badge color={TYPE_COLORS[node.type]} className="text-xs shrink-0">{node.type}</Badge>
          {node.is_system && (
            <span className="text-gray-400 shrink-0" title="System account — protected">
              <Lock size={14} />
            </span>
          )}

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => openEdit(node)}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"
              title="Edit"
            >
              <Edit2 size={14} />
            </button>
            {!node.is_system && (
              <button
                onClick={() => handleDelete(node.id)}
                className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600"
                title="Deactivate"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
        {hasChildren && isExpanded && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <PageShell
      title="Chart of Accounts"
      subtitle="Manage your account structure for double-entry bookkeeping"
      right={
        <div className="flex items-center gap-2">
          {!hasAccounts && (
            <Button onClick={handleSeed} disabled={seeding} className="gap-1">
              {seeding ? "Seeding..." : "Seed Default Accounts"}
            </Button>
          )}
          <Button onClick={handleExport} disabled={!hasAccounts} className="gap-1">
            <Download size={16} /> Export
          </Button>
          <Button onClick={openCreate} className="gap-1">
            <Plus size={16} /> Add Account
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
          {error}
          <button onClick={() => setError("")} className="ml-2 underline">dismiss</button>
        </div>
      )}

      <SectionCard>
        <div className="flex items-center gap-3 mb-4">
          <div className="relative grow">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500 text-center py-8">Loading accounts...</p>
        ) : !hasAccounts ? (
          <EmptyState
            title="No accounts yet"
            message="Seed the default Pakistan-standard chart of accounts to get started, or add accounts manually."
          />
        ) : search ? (
          // Flat filtered view when searching
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {TYPE_ORDER.map((type) => {
              const items = filteredByType[type];
              if (!items || !items.length) return null;
              return (
                <div key={type}>
                  <div className="bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                    {TYPE_LABELS[type]} ({items.length})
                  </div>
                  {items.map((a) => (
                    <div
                      key={a.id}
                      className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800 ${!a.is_active ? "opacity-50" : ""}`}
                    >
                      <span className="font-mono text-sm text-gray-500 dark:text-gray-400 w-14 shrink-0">{a.code}</span>
                      <span className="font-medium text-sm grow">{a.name}</span>
                      <Badge color={TYPE_COLORS[a.type]} className="text-xs shrink-0">{a.type}</Badge>
                      {a.is_system && <Lock size={14} className="text-gray-400 shrink-0" />}
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openEdit(a)} className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500"><Edit2 size={14} /></button>
                        {!a.is_system && (
                          <button onClick={() => handleDelete(a.id)} className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          // Tree view grouped by type
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            {TYPE_ORDER.map((type) => {
              const roots = tree.filter((n) => n.type === type);
              if (!roots.length) return null;
              return (
                <div key={type}>
                  <div className="bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
                    {TYPE_LABELS[type]}
                  </div>
                  {roots.map((n) => renderNode(n))}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title={
          <>
            {form.id ? "Edit Account" : "Add Account"}
            {form.is_system && <span className="ml-2 text-sm text-gray-400">(system — limited editing)</span>}
          </>
        }
        size="md"
      >
        <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Code</label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. 1050"
                  disabled={form.is_system}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Petty Cash"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Type</label>
                <Select
                  value={form.type}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  disabled={form.is_system}
                >
                  {TYPE_ORDER.map((t) => (
                    <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Sub-Type</label>
                <Input
                  value={form.sub_type}
                  onChange={(e) => setForm((f) => ({ ...f, sub_type: e.target.value }))}
                  placeholder="e.g. current_asset, fixed_asset"
                  disabled={form.is_system}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Parent Account</label>
                <Select
                  value={form.parent_id}
                  onChange={(e) => setForm((f) => ({ ...f, parent_id: e.target.value }))}
                  disabled={form.is_system}
                >
                  <option value="">— None (top level) —</option>
                  {parentOptions.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description"
                />
              </div>
            </div>

        <ModalFooter>
          <Button onClick={() => setModalOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button tone="primary" onClick={handleSave} disabled={saving || !form.code || !form.name}>
            {saving ? "Saving..." : form.id ? "Update" : "Create"}
          </Button>
        </ModalFooter>
      </Modal>
    </PageShell>
  );
}
