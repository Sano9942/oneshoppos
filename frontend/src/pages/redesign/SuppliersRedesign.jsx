import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Plus, Search, Trash2, Truck } from "lucide-react";
import { api } from "../../api";
import { useCurrency } from "../../contexts/CurrencyContext";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  ModalFooter,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";
import { downloadCsv } from "../../utils/csvExport";
import { fmtUtcDateTime } from "../../utils/dates";

const TYPE_LABELS = {
  invoice: "Invoice",
  grn: "GRN Receipt",
  payment: "Payment",
  return: "Return",
};
const TYPE_TONES = {
  invoice: "danger",
  grn: "default",
  payment: "success",
  return: "warning",
};

function SupplierLedger({ supplier, fmt, onBack }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [closingBalance, setClosingBalance] = useState(0);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = async (p = 0) => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams({ page: p });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const data = await api.get(`/api/supplier-ledger/${supplier.id}?${qs}`);
      setEntries(data.entries || []);
      setClosingBalance(data.closing_balance || 0);
      setPage(data.page || 0);
      setTotalPages(data.total_pages || 1);
      setTotalCount(data.total_count || 0);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load ledger");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0); }, [supplier.id]);

  const applyFilter = () => load(0);

  return (
    <PageShell
      title={supplier.name}
      subtitle="Supplier Ledger — full transaction history"
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(
            ["Date", "Type", "Reference", "Debit", "Credit", "Balance", "Notes"],
            entries.map(e => [
              e.date || "", TYPE_LABELS[e.type] || e.type, e.reference || "",
              e.debit || 0, e.credit || 0, e.running_balance || 0, e.notes || "",
            ]),
            `supplier-ledger-${supplier.id}`,
          )}>
            <Download size={14} className="mr-1 inline" />Export CSV
          </Button>
          <Button onClick={onBack}>
            <ArrowLeft size={14} className="mr-1 inline" />Back
          </Button>
        </div>
      }
    >
      {error && (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      )}

      {/* Summary card */}
      <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Transactions</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{totalCount}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Closing Balance</p>
          <p className={`text-2xl font-semibold ${closingBalance > 0 ? "text-rose-600" : closingBalance < 0 ? "text-emerald-600" : "text-(--ui-text)"}`}>
            {fmt(Math.abs(closingBalance))}
            {closingBalance > 0 ? " owed" : closingBalance < 0 ? " overpaid" : ""}
          </p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Payment Terms</p>
          <p className="text-lg font-semibold text-(--ui-text)">
            {supplier.payment_terms === "credit"
              ? `Credit · ${supplier.credit_days}d`
              : "Cash"}
          </p>
        </SectionCard>
      </div>

      {/* Date filter */}
      <SectionCard className="mb-3">
        <div className="flex flex-wrap items-end gap-2 p-3">
          <div>
            <label className="mb-1 block text-xs text-(--ui-text-muted)">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-(--ui-text-muted)">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button tone="primary" onClick={applyFilter}>Filter</Button>
          {(from || to) && (
            <Button onClick={() => { setFrom(""); setTo(""); setTimeout(() => load(0), 0); }}>Clear</Button>
          )}
        </div>
      </SectionCard>

      {/* Ledger table */}
      <SectionCard>
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Reference</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2 text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {!loading && entries.map((e, i) => (
                <tr key={`${e.type}-${e.reference}-${i}`} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                  <td className="whitespace-nowrap px-3 py-2 text-(--ui-text)">{fmtUtcDateTime(e.date)}</td>
                  <td className="px-3 py-2">
                    <Badge tone={TYPE_TONES[e.type] || "default"}>{TYPE_LABELS[e.type] || e.type}</Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-(--ui-text)">{e.reference}</td>
                  <td className="px-3 py-2 text-right text-rose-600">{e.debit > 0 ? fmt(e.debit) : "-"}</td>
                  <td className="px-3 py-2 text-right text-emerald-600">{e.credit > 0 ? fmt(e.credit) : "-"}</td>
                  <td className={`px-3 py-2 text-right font-medium ${e.running_balance > 0 ? "text-rose-600" : "text-(--ui-text)"}`}>
                    {fmt(Math.abs(e.running_balance))}
                    {e.running_balance < 0 ? " CR" : ""}
                  </td>
                  <td className="max-w-48 truncate px-3 py-2 text-xs text-(--ui-text-muted)">{e.notes || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading ledger...</div>}
          {!loading && entries.length === 0 && (
            <EmptyState title="No transactions" body="No supplier transactions found for the selected period." />
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-(--ui-border) px-3 py-2 text-xs text-(--ui-text-muted)">
            <span>Page {page + 1} of {totalPages} ({totalCount} entries)</span>
            <div className="flex gap-1">
              <Button size="sm" disabled={page === 0} onClick={() => load(page - 1)}>Prev</Button>
              <Button size="sm" disabled={page >= totalPages - 1} onClick={() => load(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </SectionCard>
    </PageShell>
  );
}

const CREDIT_DAY_OPTIONS = [0, 7, 14, 30, 45, 60, 90];

const EMPTY = {
  id: null,
  name: "",
  contact_person: "",
  phone: "",
  email: "",
  address: "",
  payment_terms: "cash",
  credit_days: 0,
  credit_limit: 0,
};

export default function SuppliersRedesign() {
  const { fmt } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [ledgerSupplier, setLedgerSupplier] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get("/api/suppliers");
      setRows(data.suppliers || []);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visibleRows = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        String(r.name || "").toLowerCase().includes(q) ||
        String(r.contact_person || "").toLowerCase().includes(q) ||
        String(r.phone || "").toLowerCase().includes(q) ||
        String(r.email || "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const creditSuppliers = rows.filter((r) => r.payment_terms === "credit");
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.running_balance || 0), 0);

  const openCreate = () => { setForm(EMPTY); setModalOpen(true); };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      name: row.name || "",
      contact_person: row.contact_person || "",
      phone: row.phone || "",
      email: row.email || "",
      address: row.address || "",
      payment_terms: row.payment_terms || "cash",
      credit_days: row.credit_days || 0,
      credit_limit: row.credit_limit || 0,
    });
    setModalOpen(true);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const isEdit = Boolean(form.id);
      const payload = {
        name: form.name,
        contact_person: form.contact_person,
        phone: form.phone,
        email: form.email,
        address: form.address,
        payment_terms: form.payment_terms,
        credit_days: form.payment_terms === "credit" ? Number(form.credit_days) : 0,
        credit_limit: form.payment_terms === "credit" ? Number(form.credit_limit) : 0,
      };
      if (isEdit) {
        await api.put(`/api/suppliers/${form.id}`, payload);
      } else {
        await api.post("/api/suppliers", payload);
      }
      setModalOpen(false);
      setForm(EMPTY);
      await load();
    } catch (e2) {
      setError(e2.body?.error || e2.message || "Failed to save supplier");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Delete supplier "${row.name}"?`)) return;
    setError("");
    try {
      await api.del(`/api/suppliers/${row.id}`);
      await load();
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to delete supplier");
    }
  };

  if (ledgerSupplier) {
    return <SupplierLedger supplier={ledgerSupplier} fmt={fmt} onBack={() => setLedgerSupplier(null)} />;
  }

  return (
    <PageShell
      title="Suppliers"
      subtitle="Manage supplier accounts, credit terms, and outstanding balances."
      right={
        <div className="flex items-center gap-2">
          <Button onClick={() => downloadCsv(["id","name","contact_person","phone","email","credit_days","outstanding"], visibleRows.map(r => [r.id, r.name||"", r.contact_person||"", r.phone||"", r.email||"", r.credit_days||0, r.outstanding_balance||0]), "suppliers")}><Download size={14} className="mr-1 inline" />Export CSV</Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" />
            Add Supplier
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
          <p className="text-xs text-(--ui-text-muted)">Total Suppliers</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{rows.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Credit Suppliers</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{creditSuppliers.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Cash Suppliers</p>
          <p className="text-2xl font-semibold text-(--ui-text)">{rows.length - creditSuppliers.length}</p>
        </SectionCard>
        <SectionCard className="p-3">
          <p className="text-xs text-(--ui-text-muted)">Total Outstanding</p>
          <p className={`text-xl font-semibold ${totalOutstanding > 0 ? "text-rose-600" : "text-(--ui-text)"}`}>
            {fmt(totalOutstanding)}
          </p>
        </SectionCard>
      </div>

      <SectionCard>
        <TableToolbar
          left={
            <div className="relative min-w-65">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)" />
              <Input
                className="pl-8"
                placeholder="Search supplier, contact, phone, or email"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
          right={<span className="text-xs text-(--ui-text-muted)">{visibleRows.length} rows</span>}
        />
        <div className="overflow-auto">
          <table className="min-w-full border-t border-(--ui-border) text-sm">
            <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left">Supplier</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Terms</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && visibleRows.map((row) => {
                const isCredit = row.payment_terms === "credit";
                const balance = Number(row.running_balance || 0);
                const overLimit = isCredit && Number(row.credit_limit) > 0 && balance > Number(row.credit_limit);
                return (
                  <tr key={row.id} className="border-t border-(--ui-border) hover:bg-(--ui-muted-surface)">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <Truck size={12} className="text-(--ui-text-muted)" />
                        <span className="font-medium text-(--ui-text)">{row.name}</span>
                      </div>
                      {row.phone && <p className="mt-0.5 text-xs text-(--ui-text-muted)">{row.phone}</p>}
                    </td>
                    <td className="px-3 py-2 text-(--ui-text-muted)">
                      {row.contact_person || "-"}
                      {row.email && <p className="text-xs">{row.email}</p>}
                    </td>
                    <td className="px-3 py-2">
                      {isCredit ? (
                        <div className="space-y-0.5">
                          <Badge tone="warning">Credit</Badge>
                          <p className="text-xs text-(--ui-text-muted)">
                            {row.credit_days}d terms
                            {Number(row.credit_limit) > 0 ? ` · limit ${fmt(row.credit_limit)}` : " · no limit"}
                          </p>
                        </div>
                      ) : (
                        <Badge tone="default">Cash</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {balance > 0 ? (
                        <div>
                          <span className={`font-medium ${overLimit ? "text-rose-600" : "text-(--ui-text)"}`}>
                            {fmt(balance)}
                          </span>
                          {overLimit && (
                            <p className="text-xs text-rose-500">Over limit</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-(--ui-text-muted)">Clear</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="inline-flex gap-2">
                        <Button size="sm" tone="primary" onClick={() => setLedgerSupplier(row)}>Ledger</Button>
                        <Button size="sm" onClick={() => openEdit(row)}>Edit</Button>
                        <Button size="sm" tone="danger" onClick={() => remove(row)}>
                          <Trash2 size={12} className="mr-1 inline" />Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {loading && <div className="p-8 text-center text-sm text-(--ui-text-muted)">Loading suppliers...</div>}
          {!loading && visibleRows.length === 0 && (
            <EmptyState title="No suppliers" body="Add a supplier to manage procurement workflows." />
          )}
        </div>
      </SectionCard>

      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title={form.id ? "Edit Supplier" : "Create Supplier"}
        size="xl"
      >
        <form className="space-y-3" onSubmit={save}>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Company Name</label>
                <Input
                  required
                  placeholder="Supplier name"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Contact Person</label>
                  <Input
                    placeholder="Primary contact"
                    value={form.contact_person}
                    onChange={(e) => setForm((p) => ({ ...p, contact_person: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-(--ui-text-muted)">Phone</label>
                  <Input
                    placeholder="Phone number"
                    value={form.phone}
                    onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Email</label>
                <Input
                  type="email"
                  placeholder="Email address"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-(--ui-text-muted)">Address</label>
                <textarea
                  rows={2}
                  className="ui-focus-ring w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm text-(--ui-text) placeholder:text-(--ui-text-muted)"
                  placeholder="Address"
                  value={form.address}
                  onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
                />
              </div>

              {/* Credit Terms Section */}
              <div className="rounded-lg border border-(--ui-border) p-3">
                <p className="mb-2 text-xs font-semibold uppercase text-(--ui-text-muted)">Payment Terms</p>
                {/* Payment-terms selector — custom 2-pill radio control, needs RadioCard primitive. */}
                <div className="flex gap-2 mb-3">
                  {["cash", "credit"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, payment_terms: t }))}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        form.payment_terms === t
                          ? "border-(--ui-accent) bg-(--ui-accent)/5 text-(--ui-accent)"
                          : "border-(--ui-border) text-(--ui-text-muted) hover:bg-(--ui-muted-surface)"
                      }`}
                    >
                      {t === "cash" ? "Cash on Delivery" : "Credit Account"}
                    </button>
                  ))}
                </div>

                {form.payment_terms === "credit" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-(--ui-text-muted)">Credit Days</label>
                      <select
                        value={form.credit_days}
                        onChange={(e) => setForm((p) => ({ ...p, credit_days: Number(e.target.value) }))}
                        className="w-full rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-surface) px-3 py-2 text-sm"
                      >
                        {CREDIT_DAY_OPTIONS.map((d) => (
                          <option key={d} value={d}>{d === 0 ? "Custom" : `${d} days`}</option>
                        ))}
                      </select>
                      {!CREDIT_DAY_OPTIONS.includes(Number(form.credit_days)) || form.credit_days === 0 ? (
                        <Input
                          type="number"
                          min={1}
                          className="mt-1"
                          placeholder="Enter days"
                          value={form.credit_days || ""}
                          onChange={(e) => setForm((p) => ({ ...p, credit_days: Number(e.target.value) }))}
                        />
                      ) : null}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-(--ui-text-muted)">Credit Limit</label>
                      <Input
                        type="number"
                        min={0}
                        placeholder="0 = no limit"
                        value={form.credit_limit || ""}
                        onChange={(e) => setForm((p) => ({ ...p, credit_limit: Number(e.target.value) }))}
                      />
                      <p className="mt-1 text-xs text-(--ui-text-muted)">0 means unlimited credit</p>
                    </div>
                  </div>
                )}
              </div>

              <ModalFooter>
                <Button type="button" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </ModalFooter>
        </form>
      </Modal>
    </PageShell>
  );
}
