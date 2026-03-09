import { useEffect, useMemo, useState } from "react";
import { Download, Plus, Search, UserRound } from "lucide-react";
import { API_BASE as API_BASE_URL } from "../../config";
import { fmtDate } from "../../utils/dates";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageShell,
  SectionCard,
  TableToolbar,
} from "../../ui/primitives";

const PAGE_SIZE = 25;
const API = `${API_BASE_URL}/api`;

const EMPTY = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  cnic: "",
  occupation: "",
};

function money(n) {
  return `PKRs ${Number(n || 0).toFixed(2)}`;
}

function exportCsv(rows) {
  if (!rows.length) return;
  const headers = [
    "id",
    "name",
    "mobile",
    "email",
    "address",
    "loyalty_points",
    "order_count",
    "total_spent",
  ];
  const body = rows.map((r) =>
    [
      r.id,
      r.name || "",
      r.mobile || "",
      r.email || "",
      r.address || "",
      r.loyalty_points || 0,
      r.order_count || 0,
      r.total_spent || 0,
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers.join(","), ...body].join("\n")], {
    type: "text/csv",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `customers_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function CustomersRedesign() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detail, setDetail] = useState(null);
  const [customerSales, setCustomerSales] = useState([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");

  const [pointsAdjust, setPointsAdjust] = useState("");
  const [walletTopup, setWalletTopup] = useState("");
  const [walletNote, setWalletNote] = useState("");

  const fetchCustomers = async (query = "") => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/customers?search=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load customers");
      setRows(data.customers || []);
      setSelectedIds(new Set());
      setPage(1);
    } catch (e) {
      setError(e.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (customer) => {
    setDetail(customer);
    setPointsAdjust(String(customer.loyalty_points || 0));
    setWalletTopup("");
    setWalletNote("");
    try {
      const [salesRes, walletRes] = await Promise.all([
        fetch(`${API}/customers/${customer.id}/sales`),
        fetch(`${API}/customers/${customer.id}/wallet`),
      ]);
      const salesData = await salesRes.json();
      const walletData = await walletRes.json();
      setCustomerSales(salesData.sales || []);
      setWalletBalance(walletData.balance || 0);
    } catch {
      setCustomerSales([]);
      setWalletBalance(0);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchCustomers(search), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const paged = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, rows],
  );

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError("");
    setModalOpen(true);
  };

  const openEdit = (row) => {
    setEditing(row);
    setForm({
      name: row.name || "",
      mobile: row.mobile || "",
      email: row.email || "",
      address: row.address || "",
      cnic: row.cnic || "",
      occupation: row.occupation || "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      const url = editing ? `${API}/customers/${editing.id}` : `${API}/customers`;
      const method = editing ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save customer");
      setModalOpen(false);
      await fetchCustomers(search);
      if (detail && editing && detail.id === editing.id) {
        await loadDetail({ ...detail, ...form });
      }
    } catch (e2) {
      setFormError(e2.message || "Failed to save customer");
    } finally {
      setBusy(false);
    }
  };

  const deleteCustomers = async (ids) => {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} customer(s)?`)) return;
    setBusy(true);
    setError("");
    try {
      for (const id of ids) {
        const res = await fetch(`${API}/customers/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed deleting customer ${id}`);
      }
      if (detail && ids.includes(detail.id)) setDetail(null);
      await fetchCustomers(search);
    } catch (e) {
      setError(e.message || "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectPage = () => {
    const allSelected = paged.length > 0 && paged.every((r) => selectedIds.has(r.id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      paged.forEach((r) => {
        if (allSelected) next.delete(r.id);
        else next.add(r.id);
      });
      return next;
    });
  };

  const adjustPoints = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/customers/${detail.id}/points`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: Number(pointsAdjust || 0) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update points");
      const nextRows = rows.map((r) =>
        r.id === detail.id ? { ...r, loyalty_points: Number(pointsAdjust || 0) } : r,
      );
      setRows(nextRows);
      setDetail((p) => ({ ...p, loyalty_points: Number(pointsAdjust || 0) }));
    } catch (e) {
      setError(e.message || "Failed to update points");
    } finally {
      setBusy(false);
    }
  };

  const topupWallet = async () => {
    if (!detail || !walletTopup || Number(walletTopup) <= 0) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/customers/${detail.id}/wallet/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(walletTopup), note: walletNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Top-up failed");
      setWalletBalance(Number(data.balance || 0));
      setWalletTopup("");
      setWalletNote("");
    } catch (e) {
      setError(e.message || "Top-up failed");
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = selectedIds.size;

  return (
    <PageShell
      title="Customers"
      subtitle="Manage customers, loyalty points, and wallet balances."
      right={
        <div className="flex gap-2">
          <Button onClick={() => exportCsv(rows)}>
            <Download size={14} className="mr-1 inline" />
            Export CSV
          </Button>
          <Button tone="primary" onClick={openCreate}>
            <Plus size={14} className="mr-1 inline" />
            Add Customer
          </Button>
        </div>
      }
    >
      {error ? (
        <SectionCard className="mb-3 border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          {error}
        </SectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <SectionCard className="xl:col-span-8">
          <TableToolbar
            left={
              <div className="relative min-w-60">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-2.5 text-(--ui-text-muted)"
                />
                <Input
                  className="pl-8"
                  placeholder="Search customer name/mobile/email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            }
            right={
              <span className="text-xs text-(--ui-text-muted)">
                {rows.length} customers
              </span>
            }
          />

          <div className="overflow-auto">
            <table className="min-w-full border-t border-(--ui-border) text-sm">
              <thead className="bg-(--ui-muted-surface) text-xs uppercase text-(--ui-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left">Customer</th>
                  <th className="px-3 py-2 text-left">Mobile</th>
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-center">Points</th>
                  <th className="px-3 py-2 text-center">Orders</th>
                  <th className="px-3 py-2 text-right">Total Spent</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {!loading &&
                  paged.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-t border-(--ui-border) ${
                        detail?.id === r.id ? "bg-emerald-50" : ""
                      }`}
                    >
                      <td className="px-3 py-2">
                        <button
                          className="flex items-center gap-2 text-left"
                          onClick={() => loadDetail(r)}
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                            <UserRound size={12} />
                          </span>
                          <span className="font-medium text-(--ui-text)">{r.name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">
                        {r.mobile || "-"}
                      </td>
                      <td className="px-3 py-2 text-(--ui-text-muted)">
                        {r.email || "-"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Badge tone="success">{r.loyalty_points || 0}</Badge>
                      </td>
                      <td className="px-3 py-2 text-center text-(--ui-text)">
                        {r.order_count || 0}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-(--ui-text)">
                        {money(r.total_spent)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex justify-center gap-1">
                          <Button size="sm" onClick={() => openEdit(r)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            tone="danger"
                            onClick={() => deleteCustomers([r.id])}
                          >
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
                Loading customers...
              </div>
            ) : null}
            {!loading && rows.length === 0 ? (
              <EmptyState title="No customers found" body="Add your first customer to begin." />
            ) : null}
          </div>
          <div className="flex items-center justify-between border-t border-(--ui-border) p-3">
            <span className="text-xs text-(--ui-text-muted)">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard className="xl:col-span-4 p-3">
          {!detail ? (
            <EmptyState
              title="Select a customer"
              body="Open a customer row to view profile, points, wallet, and sales."
            />
          ) : (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-(--ui-text)">{detail.name}</h3>
                <p className="text-xs text-(--ui-text-muted)">
                  {detail.email || detail.mobile || "No contact info"}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SectionCard className="p-2 text-center">
                  <p className="text-xs text-(--ui-text-muted)">Orders</p>
                  <p className="text-lg font-semibold text-(--ui-text)">
                    {detail.order_count || 0}
                  </p>
                </SectionCard>
                <SectionCard className="p-2 text-center">
                  <p className="text-xs text-(--ui-text-muted)">Spent</p>
                  <p className="text-lg font-semibold text-(--ui-text)">
                    {money(detail.total_spent)}
                  </p>
                </SectionCard>
              </div>

              <SectionCard className="p-2">
                <p className="mb-2 text-xs text-(--ui-text-muted)">Loyalty points</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={pointsAdjust}
                    onChange={(e) => setPointsAdjust(e.target.value)}
                  />
                  <Button size="sm" disabled={busy} onClick={adjustPoints}>
                    Set
                  </Button>
                </div>
              </SectionCard>

              <SectionCard className="p-2">
                <p className="mb-2 text-xs text-(--ui-text-muted)">
                  Wallet balance: {money(walletBalance)}
                </p>
                <div className="space-y-2">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="Top-up amount"
                    value={walletTopup}
                    onChange={(e) => setWalletTopup(e.target.value)}
                  />
                  <Input
                    placeholder="Top-up note (optional)"
                    value={walletNote}
                    onChange={(e) => setWalletNote(e.target.value)}
                  />
                  <Button size="sm" disabled={busy || !walletTopup} onClick={topupWallet}>
                    Top Up Wallet
                  </Button>
                </div>
              </SectionCard>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-(--ui-text)">
                  Recent Sales
                </h4>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {customerSales.length === 0 ? (
                    <p className="text-xs text-(--ui-text-muted)">No sales yet.</p>
                  ) : (
                    customerSales.slice(0, 20).map((s) => (
                      <div key={s.id} className="rounded border border-(--ui-border) p-2 text-xs">
                        <p className="font-medium text-(--ui-text)">Sale #{s.id}</p>
                        <p className="text-(--ui-text-muted)">
                          {fmtDate(s.timestamp)} | {money(s.total_amount)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </SectionCard>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              {editing ? "Edit Customer" : "Add Customer"}
            </h3>
            <form className="mt-3 space-y-2" onSubmit={submitForm}>
              {formError ? (
                <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{formError}</p>
              ) : null}
              <Input
                required
                placeholder="Name"
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              />
              <Input
                placeholder="Mobile"
                value={form.mobile}
                onChange={(e) => setForm((p) => ({ ...p, mobile: e.target.value }))}
              />
              <Input
                placeholder="Email"
                value={form.email}
                onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
              />
              <Input
                placeholder="Address"
                value={form.address}
                onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))}
              />
              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setModalOpen(false)}>
                  Cancel
                </Button>
                <Button tone="primary" type="submit" disabled={busy}>
                  {editing ? "Save" : "Create"}
                </Button>
              </div>
            </form>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
