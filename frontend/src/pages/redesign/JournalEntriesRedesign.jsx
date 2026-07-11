import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Edit2,
  CheckCircle,
  XCircle,
  Download,
  Trash2,
  Search,
} from "lucide-react";
import { Navigate } from "react-router-dom";
import { api } from "../../api";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useCurrency } from "../../contexts/CurrencyContext";
import { fmtLocalDate, todayLocalStr } from "../../utils/dates";
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
} from "../../ui/primitives";

const STATUS_TONE = { draft: "warning", posted: "success", voided: "danger" };

const TABS = [
  { id: "entries", label: "Journal Entries" },
  { id: "trial", label: "Trial Balance" },
];

// ── Journal Entries Page ─────────────────────────────────────────────

export default function JournalEntriesRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const { fmt: money } = useCurrency();
  const [tab, setTab] = useState("entries");

  // ── Entries state ──────────────────────────────────────────────────
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  // ── Form state ─────────────────────────────────────────────────────
  const [modal, setModal] = useState(null); // null | "create" | "edit" | "view"
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ entry_date: "", description: "" });
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [saving, setSaving] = useState(false);

  // ── Accounts (for dropdown) ────────────────────────────────────────
  const [accounts, setAccounts] = useState([]);

  // ── Trial Balance state ────────────────────────────────────────────
  const [tbAccounts, setTbAccounts] = useState([]);
  const [tbGrandDebit, setTbGrandDebit] = useState(0);
  const [tbGrandCredit, setTbGrandCredit] = useState(0);
  const [tbFrom, setTbFrom] = useState("");
  const [tbTo, setTbTo] = useState("");
  const [tbLoading, setTbLoading] = useState(false);

  // ── Fetch entries ──────────────────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      params.set("page", page);
      params.set("per_page", 50);
      const qs = params.toString();
      const data = await api.get(`/api/accounting/journal-entries?${qs}`);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.message || "Failed to load journal entries");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, dateFrom, dateTo, page]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // ── Fetch accounts for dropdown ────────────────────────────────────
  useEffect(() => {
    api.get("/api/accounting/coa").then((d) => {
      setAccounts((d.accounts || []).filter((a) => a.is_active));
    }).catch(() => {});
  }, []);

  // ── Filtered entries (client-side search) ──────────────────────────
  const filtered = useMemo(() => {
    if (!search) return entries;
    const q = search.toLowerCase();
    return entries.filter(
      (e) =>
        (e.entry_number || "").toLowerCase().includes(q) ||
        (e.description || "").toLowerCase().includes(q)
    );
  }, [entries, search]);

  // ── Line helpers ───────────────────────────────────────────────────
  function emptyLine() {
    return { account_id: "", description: "", debit: "", credit: "" };
  }

  function updateLine(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // If entering debit, clear credit and vice versa
      if (field === "debit" && Number(value) > 0) next[idx].credit = "";
      if (field === "credit" && Number(value) > 0) next[idx].debit = "";
      return next;
    });
  }

  function removeLine(idx) {
    setLines((prev) => prev.length <= 2 ? prev : prev.filter((_, i) => i !== idx));
  }

  const lineTotals = useMemo(() => {
    let debit = 0, credit = 0;
    for (const l of lines) {
      debit += Number(l.debit || 0);
      credit += Number(l.credit || 0);
    }
    return { debit, credit, diff: Math.abs(debit - credit) };
  }, [lines]);

  // ── Open create/edit modal ─────────────────────────────────────────
  function openCreate() {
    setForm({ entry_date: todayLocalStr(), description: "" });
    setLines([emptyLine(), emptyLine()]);
    setEditId(null);
    setModal("create");
  }

  async function openEdit(entry) {
    try {
      const data = await api.get(`/api/accounting/journal-entries/${entry.id}`);
      setForm({ entry_date: (data.entry_date || "").slice(0, 10), description: data.description || "" });
      setLines(
        (data.lines || []).map((l) => ({
          account_id: String(l.account_id),
          description: l.description || "",
          debit: Number(l.debit) > 0 ? String(l.debit) : "",
          credit: Number(l.credit) > 0 ? String(l.credit) : "",
        }))
      );
      setEditId(data.id);
      setModal("edit");
    } catch (e) {
      setError(e.message || "Failed to load entry");
    }
  }

  async function openView(entry) {
    try {
      const data = await api.get(`/api/accounting/journal-entries/${entry.id}`);
      setForm({ entry_date: (data.entry_date || "").slice(0, 10), description: data.description || "" });
      setLines(
        (data.lines || []).map((l) => ({
          account_id: String(l.account_id),
          account_name: `${l.account_code} — ${l.account_name}`,
          description: l.description || "",
          debit: Number(l.debit) > 0 ? String(l.debit) : "",
          credit: Number(l.credit) > 0 ? String(l.credit) : "",
        }))
      );
      setEditId(data.id);
      setModal("view");
    } catch (e) {
      setError(e.message || "Failed to load entry");
    }
  }

  // ── Save (create or update) ────────────────────────────────────────
  async function handleSave() {
    if (!form.entry_date || !form.description.trim()) return;
    if (lineTotals.diff > 0.005) return;

    const payload = {
      entry_date: form.entry_date,
      description: form.description.trim(),
      lines: lines
        .filter((l) => l.account_id && (Number(l.debit || 0) > 0 || Number(l.credit || 0) > 0))
        .map((l) => ({
          account_id: Number(l.account_id),
          description: l.description || null,
          debit: Number(l.debit || 0),
          credit: Number(l.credit || 0),
        })),
    };
    if (payload.lines.length < 2) return;

    setSaving(true);
    try {
      if (editId) {
        await api.put(`/api/accounting/journal-entries/${editId}`, payload);
      } else {
        await api.post("/api/accounting/journal-entries", payload);
      }
      setModal(null);
      fetchEntries();
    } catch (e) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // ── Post / Void ────────────────────────────────────────────────────
  async function handlePost(entry) {
    if (!confirm(`Post entry ${entry.entry_number}? This cannot be undone.`)) return;
    try {
      await api.put(`/api/accounting/journal-entries/${entry.id}/post`);
      fetchEntries();
    } catch (e) {
      setError(e.message || "Failed to post");
    }
  }

  async function handleVoid(entry) {
    if (!confirm(`Void entry ${entry.entry_number}? This cannot be undone.`)) return;
    try {
      await api.put(`/api/accounting/journal-entries/${entry.id}/void`);
      fetchEntries();
    } catch (e) {
      setError(e.message || "Failed to void");
    }
  }

  // ── Trial Balance ──────────────────────────────────────────────────
  const fetchTrialBalance = useCallback(async () => {
    setTbLoading(true);
    try {
      const params = new URLSearchParams();
      if (tbFrom) params.set("from", tbFrom);
      if (tbTo) params.set("to", tbTo);
      const qs = params.toString();
      const data = await api.get(`/api/accounting/trial-balance${qs ? `?${qs}` : ""}`);
      setTbAccounts(data.accounts || []);
      setTbGrandDebit(data.grand_total_debit || 0);
      setTbGrandCredit(data.grand_total_credit || 0);
    } catch (e) {
      setError(e.message || "Failed to load trial balance");
    } finally {
      setTbLoading(false);
    }
  }, [tbFrom, tbTo]);

  useEffect(() => {
    if (tab === "trial") fetchTrialBalance();
  }, [tab, fetchTrialBalance]);

  // ── CSV Export ─────────────────────────────────────────────────────
  function exportEntries() {
    downloadCsv(
      ["Entry #", "Date", "Description", "Status", "Debit", "Credit"],
      filtered.map((e) => [
        e.entry_number,
        fmtLocalDate(e.entry_date),
        e.description,
        e.status,
        Number(e.total_debit || 0).toFixed(2),
        Number(e.total_credit || 0).toFixed(2),
      ]),
      "journal-entries.csv"
    );
  }

  function exportTrialBalance() {
    downloadCsv(
      ["Code", "Account", "Type", "Total Debit", "Total Credit", "Balance"],
      tbAccounts.map((a) => [
        a.code,
        a.name,
        a.type,
        a.total_debit.toFixed(2),
        a.total_credit.toFixed(2),
        a.balance.toFixed(2),
      ]),
      "trial-balance.csv"
    );
  }

  // ── Pagination ─────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(total / 50));

  // Inline self-guard (Business Modules): backend already 403s without
  // accounting_core; this stops the page rendering via deep link too.
  if (flagsLoading) return null;
  if (!flags.accounting_core) return <Navigate to="/" replace />;

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <PageShell title="Journal Entries" subtitle="Double-entry bookkeeping — create, post, and review journal entries.">
      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-(--ui-bg-muted) p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-(--ui-surface) text-(--ui-text) shadow-sm"
                : "text-(--ui-text-muted) hover:text-(--ui-text)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-3 rounded-md bg-(--ui-danger-bg) px-4 py-2 text-sm text-(--ui-danger-fg)">
          {error}
          <button className="ml-2 underline" onClick={() => setError("")}>dismiss</button>
        </div>
      )}

      {tab === "entries" && (
        <EntriesTab
          entries={filtered}
          loading={loading}
          money={money}
          search={search}
          setSearch={setSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          dateFrom={dateFrom}
          setDateFrom={setDateFrom}
          dateTo={dateTo}
          setDateTo={setDateTo}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          total={total}
          openCreate={openCreate}
          openEdit={openEdit}
          openView={openView}
          handlePost={handlePost}
          handleVoid={handleVoid}
          exportEntries={exportEntries}
        />
      )}

      {tab === "trial" && (
        <TrialBalanceTab
          accounts={tbAccounts}
          grandDebit={tbGrandDebit}
          grandCredit={tbGrandCredit}
          loading={tbLoading}
          money={money}
          from={tbFrom}
          setFrom={setTbFrom}
          to={tbTo}
          setTo={setTbTo}
          onRefresh={fetchTrialBalance}
          onExport={exportTrialBalance}
        />
      )}

      {/* Create / Edit / View modal */}
      <EntryModal
        open={!!modal}
        mode={modal || "view"}
        form={form}
        setForm={setForm}
        lines={lines}
        setLines={setLines}
        updateLine={updateLine}
        removeLine={removeLine}
        lineTotals={lineTotals}
        accounts={accounts}
        saving={saving}
        onSave={handleSave}
        onClose={() => setModal(null)}
        money={money}
        editId={editId}
      />
    </PageShell>
  );
}

// ── Entries Tab ──────────────────────────────────────────────────────

function EntriesTab({
  entries, loading, money, search, setSearch,
  statusFilter, setStatusFilter, dateFrom, setDateFrom, dateTo, setDateTo,
  page, setPage, totalPages, total,
  openCreate, openEdit, openView, handlePost, handleVoid, exportEntries,
}) {
  return (
    <SectionCard>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative grow">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ui-text-muted)" />
          <Input
            placeholder="Search by entry # or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text)"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="posted">Posted</option>
          <option value="voided">Voided</option>
        </select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-36" />
        <span className="text-(--ui-text-muted)">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-36" />
        <Button onClick={exportEntries}><Download className="mr-1 h-4 w-4" /> Export</Button>
        <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> New Entry</Button>
      </div>

      {/* Table */}
      {loading ? (
        <p className="py-12 text-center text-sm text-(--ui-text-muted)">Loading...</p>
      ) : entries.length === 0 ? (
        <EmptyState title="No journal entries found" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--ui-border) text-(--ui-text-muted)">
                  <th className="pb-2 pr-4 font-medium">Entry #</th>
                  <th className="pb-2 pr-4 font-medium">Date</th>
                  <th className="pb-2 pr-4 font-medium">Description</th>
                  <th className="pb-2 pr-4 font-medium">Status</th>
                  <th className="pb-2 pr-4 font-medium text-right">Amount</th>
                  <th className="pb-2 pr-4 font-medium">Lines</th>
                  <th className="pb-2 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-(--ui-border) last:border-0">
                    <td className="py-2.5 pr-4">
                      <button
                        className="font-mono text-xs text-(--ui-accent) hover:underline"
                        onClick={() => openView(e)}
                      >
                        {e.entry_number}
                      </button>
                    </td>
                    <td className="py-2.5 pr-4 text-(--ui-text-muted)">{fmtLocalDate(e.entry_date)}</td>
                    <td className="py-2.5 pr-4 max-w-xs truncate">{e.description}</td>
                    <td className="py-2.5 pr-4">
                      <Badge tone={STATUS_TONE[e.status] || "neutral"}>{e.status}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-right font-mono">{money(Number(e.total_debit || 0))}</td>
                    <td className="py-2.5 pr-4 text-(--ui-text-muted)">{e.line_count}</td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {e.status === "draft" && (
                          <>
                            <button
                              onClick={() => openEdit(e)}
                              className="rounded p-1 text-(--ui-text-muted) hover:bg-(--ui-bg-muted)"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handlePost(e)}
                              className="rounded p-1 text-(--ui-success-fg) hover:bg-(--ui-success-bg)"
                              title="Post"
                            >
                              <CheckCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {e.status === "posted" && (
                          <button
                            onClick={() => handleVoid(e)}
                            className="rounded p-1 text-(--ui-danger-fg) hover:bg-(--ui-danger-bg)"
                            title="Void"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-(--ui-text-muted)">
              <span>Showing page {page} of {totalPages} ({total} entries)</span>
              <div className="flex gap-2">
                <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
                <Button size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

// ── Trial Balance Tab ────────────────────────────────────────────────

function TrialBalanceTab({
  accounts, grandDebit, grandCredit, loading, money,
  from, setFrom, to, setTo, onRefresh, onExport,
}) {
  return (
    <SectionCard>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-36" />
        <span className="text-(--ui-text-muted)">to</span>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-36" />
        <Button onClick={onRefresh}>Refresh</Button>
        <Button onClick={onExport}><Download className="mr-1 h-4 w-4" /> Export</Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-(--ui-text-muted)">Loading...</p>
      ) : accounts.length === 0 ? (
        <EmptyState title="No posted journal entries found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--ui-border) text-(--ui-text-muted)">
                <th className="pb-2 pr-4 font-medium">Code</th>
                <th className="pb-2 pr-4 font-medium">Account</th>
                <th className="pb-2 pr-4 font-medium">Type</th>
                <th className="pb-2 pr-4 font-medium text-right">Total Debit</th>
                <th className="pb-2 pr-4 font-medium text-right">Total Credit</th>
                <th className="pb-2 font-medium text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-(--ui-border) last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{a.code}</td>
                  <td className="py-2 pr-4">{a.name}</td>
                  <td className="py-2 pr-4 capitalize text-(--ui-text-muted)">{a.type}</td>
                  <td className="py-2 pr-4 text-right font-mono">{money(a.total_debit)}</td>
                  <td className="py-2 pr-4 text-right font-mono">{money(a.total_credit)}</td>
                  <td className={`py-2 text-right font-mono font-semibold ${a.balance < 0 ? "text-(--ui-danger-fg)" : ""}`}>
                    {money(Math.abs(a.balance))}{a.balance < 0 ? " CR" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-(--ui-border) font-semibold">
                <td colSpan={3} className="py-2 pr-4">Grand Total</td>
                <td className="py-2 pr-4 text-right font-mono">{money(grandDebit)}</td>
                <td className="py-2 pr-4 text-right font-mono">{money(grandCredit)}</td>
                <td className={`py-2 text-right font-mono ${Math.abs(grandDebit - grandCredit) > 0.005 ? "text-(--ui-danger-fg)" : "text-(--ui-success-fg)"}`}>
                  {Math.abs(grandDebit - grandCredit) < 0.005 ? "Balanced" : money(Math.abs(grandDebit - grandCredit))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── Entry Modal (Create / Edit / View) ───────────────────────────────

function EntryModal({
  open, mode, form, setForm, lines, setLines, updateLine, removeLine,
  lineTotals, accounts, saving, onSave, onClose, money, editId,
}) {
  const readOnly = mode === "view";
  const title = mode === "create" ? "New Journal Entry" : mode === "edit" ? "Edit Journal Entry" : "View Journal Entry";

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title={title}
      size="xl"
    >
      <div className="space-y-5">
          {/* Header fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-(--ui-text)">Date</label>
              <Input
                type="date"
                value={form.entry_date}
                onChange={(e) => setForm({ ...form, entry_date: e.target.value })}
                disabled={readOnly}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-(--ui-text)">Description</label>
              <Input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Opening balances, salary provision..."
                disabled={readOnly}
              />
            </div>
          </div>

          {/* Lines table */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-(--ui-text)">Entry Lines</h3>
              {!readOnly && (
                <Button
                  size="sm"
                  onClick={() => setLines([...lines, { account_id: "", description: "", debit: "", credit: "" }])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add Line
                </Button>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-(--ui-border)">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-(--ui-bg-muted) text-(--ui-text-muted)">
                    <th className="px-3 py-2 font-medium" style={{ minWidth: 200 }}>Account</th>
                    <th className="px-3 py-2 font-medium" style={{ minWidth: 150 }}>Description</th>
                    <th className="px-3 py-2 font-medium text-right" style={{ minWidth: 120 }}>Debit</th>
                    <th className="px-3 py-2 font-medium text-right" style={{ minWidth: 120 }}>Credit</th>
                    {!readOnly && <th className="px-3 py-2 w-10"></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={i} className="border-t border-(--ui-border)">
                      <td className="px-3 py-1.5">
                        {readOnly ? (
                          <span className="text-sm">{line.account_name || line.account_id}</span>
                        ) : (
                          <select
                            value={line.account_id}
                            onChange={(e) => updateLine(i, "account_id", e.target.value)}
                            className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-sm text-(--ui-text)"
                          >
                            <option value="">Select account...</option>
                            {accounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          value={line.description}
                          onChange={(e) => updateLine(i, "description", e.target.value)}
                          placeholder="Optional note"
                          disabled={readOnly}
                          className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-sm text-(--ui-text) disabled:opacity-60"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.debit}
                          onChange={(e) => updateLine(i, "debit", e.target.value)}
                          disabled={readOnly}
                          className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-right text-sm text-(--ui-text) disabled:opacity-60"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="px-3 py-1.5">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={line.credit}
                          onChange={(e) => updateLine(i, "credit", e.target.value)}
                          disabled={readOnly}
                          className="w-full rounded border border-(--ui-border) bg-(--ui-surface) px-2 py-1.5 text-right text-sm text-(--ui-text) disabled:opacity-60"
                          placeholder="0.00"
                        />
                      </td>
                      {!readOnly && (
                        <td className="px-2 py-1.5 text-center">
                          <Button
                            tone="plain"
                            size="sm"
                            iconOnly
                            onClick={() => removeLine(i)}
                            title="Remove line"
                            aria-label="Remove line"
                            className="hover:text-(--ui-danger-fg)"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-(--ui-border) font-semibold">
                    <td colSpan={2} className="px-3 py-2 text-right">Totals</td>
                    <td className="px-3 py-2 text-right font-mono">{money(lineTotals.debit)}</td>
                    <td className="px-3 py-2 text-right font-mono">{money(lineTotals.credit)}</td>
                    {!readOnly && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Balance indicator */}
            <div className={`mt-2 flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
              lineTotals.diff < 0.005
                ? "bg-(--ui-success-bg) text-(--ui-success-fg)"
                : "bg-(--ui-danger-bg) text-(--ui-danger-fg)"
            }`}>
              {lineTotals.diff < 0.005 ? (
                <><CheckCircle className="h-4 w-4" /> Entry is balanced</>
              ) : (
                <><XCircle className="h-4 w-4" /> Out of balance by {money(lineTotals.diff)}</>
              )}
            </div>
          </div>

      </div>
      <ModalFooter>
        <Button onClick={onClose} disabled={saving}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button
            tone="primary"
            onClick={onSave}
            disabled={saving || !form.entry_date || !form.description.trim() || lineTotals.diff > 0.005}
          >
            {saving ? "Saving..." : editId ? "Update Entry" : "Create Entry"}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
