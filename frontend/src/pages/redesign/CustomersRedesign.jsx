import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Award, Ban, BookOpen, Calendar, ChevronLeft, ChevronRight, Download, Plus, Search, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { api } from "../../api";
import { fmtDate, fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { useToast } from "../../contexts/ToastContext";
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

const EMPTY = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  cnic: "",
  occupation: "",
  ntn_cnic: "",
};

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
  const { fmt: money } = useCurrency();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detail, setDetail] = useState(null);
  const [customerSales, setCustomerSales] = useState([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletLedger, setWalletLedger] = useState([]);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);

  const [loyaltyTiers, setLoyaltyTiers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");

  const [pointsAdjust, setPointsAdjust] = useState("");
  const [walletTopup, setWalletTopup] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [blacklistModal, setBlacklistModal] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [detailTab, setDetailTab] = useState("profile");
  const [ledger, setLedger] = useState([]);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerPages, setLedgerPages] = useState(1);
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Transfer points modal state
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferPoints, setTransferPoints] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [transferSearch, setTransferSearch] = useState("");
  const [transferResults, setTransferResults] = useState([]);
  const [transferTarget, setTransferTarget] = useState(null);
  const [transferSearching, setTransferSearching] = useState(false);
  const transferDebounce = useRef(null);
  const toast = useToast();

  const fetchCustomers = async (query = "") => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get(`/api/customers?search=${encodeURIComponent(query)}`);
      setRows(data.customers || []);
      setSelectedIds(new Set());
      setPage(1);
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (customer) => {
    setDetail(customer);
    setDetailTab("profile");
    setPointsAdjust(String(customer.loyalty_points || 0));
    setWalletTopup("");
    setWalletNote("");
    setLedger([]);
    setLedgerFrom("");
    setLedgerTo("");
    try {
      const [salesData, walletData] = await Promise.all([
        api.get(`/api/customers/${customer.id}/sales`),
        api.get(`/api/customers/${customer.id}/wallet`),
      ]);
      setCustomerSales(salesData.sales || []);
      setWalletBalance(walletData.balance || 0);
      setWalletLedger(walletData.ledger || []);
    } catch {
      setCustomerSales([]);
      setWalletBalance(0);
      setWalletLedger([]);
    }
  };

  useEffect(() => {
    fetchCustomers();
    api.get("/api/loyalty/tiers").then((d) => setLoyaltyTiers(d.tiers || [])).catch(() => {});
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
      ntn_cnic: row.ntn_cnic || "",
    });
    setFormError("");
    setModalOpen(true);
  };

  const submitForm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setFormError("");
    try {
      if (editing) {
        await api.put(`/api/customers/${editing.id}`, form);
      } else {
        await api.post("/api/customers", form);
      }
      setModalOpen(false);
      await fetchCustomers(search);
      if (detail && editing && detail.id === editing.id) {
        await loadDetail({ ...detail, ...form });
      }
    } catch (e2) {
      setFormError(e2.body?.error || e2.message || "Failed to save customer");
    } finally {
      setBusy(false);
    }
  };

  const deleteCustomers = async (ids) => {
    if (!ids.length) return;
    if (!window.confirm(`Archive ${ids.length} customer(s)? They will be hidden from listings but preserved in history.`)) return;
    setBusy(true);
    setError("");
    try {
      for (const id of ids) {
        await api.del(`/api/customers/${id}`);
      }
      if (detail && ids.includes(detail.id)) setDetail(null);
      await fetchCustomers(search);
    } catch (e) {
      setError(e.body?.error || e.message || "Delete failed");
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
      await api.put(`/api/customers/${detail.id}/points`, { points: Number(pointsAdjust || 0) });
      const nextRows = rows.map((r) =>
        r.id === detail.id ? { ...r, loyalty_points: Number(pointsAdjust || 0) } : r,
      );
      setRows(nextRows);
      setDetail((p) => ({ ...p, loyalty_points: Number(pointsAdjust || 0) }));
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to update points");
    } finally {
      setBusy(false);
    }
  };

  const topupWallet = async () => {
    if (!detail || !walletTopup || Number(walletTopup) <= 0) return;
    setBusy(true);
    try {
      const data = await api.post(`/api/customers/${detail.id}/wallet/topup`, { amount: Number(walletTopup), note: walletNote });
      setWalletBalance(Number(data.balance || 0));
      setWalletTopup("");
      setWalletNote("");
    } catch (e) {
      setError(e.body?.error || e.message || "Top-up failed");
    } finally {
      setBusy(false);
    }
  };

  // --- Transfer points logic ---
  const openTransfer = () => {
    setTransferPoints("");
    setTransferReason("");
    setTransferSearch("");
    setTransferResults([]);
    setTransferTarget(null);
    setTransferOpen(true);
  };

  const searchTransferTarget = useCallback((q) => {
    setTransferSearch(q);
    setTransferTarget(null);
    if (transferDebounce.current) clearTimeout(transferDebounce.current);
    if (!q.trim()) { setTransferResults([]); return; }
    transferDebounce.current = setTimeout(async () => {
      setTransferSearching(true);
      try {
        const data = await api.get(`/api/customers?search=${encodeURIComponent(q)}`);
        setTransferResults((data.customers || []).filter((c) => c.id !== detail?.id));
      } catch { setTransferResults([]); }
      finally { setTransferSearching(false); }
    }, 300);
  }, [detail?.id]);

  const submitTransfer = async () => {
    if (!detail || !transferTarget || !transferPoints) return;
    const pts = parseInt(transferPoints);
    if (!pts || pts <= 0 || pts > (detail.loyalty_points || 0)) return;
    setBusy(true);
    try {
      const data = await api.post("/api/customers/transfer-points", {
        from_customer_id: detail.id,
        to_customer_id: transferTarget.id,
        points: pts,
        reason: transferReason || undefined,
      });
      // Update sender in list + detail
      setRows((prev) => prev.map((r) =>
        r.id === detail.id ? { ...r, loyalty_points: data.from_balance } :
        r.id === transferTarget.id ? { ...r, loyalty_points: data.to_balance } : r
      ));
      setDetail((p) => ({ ...p, loyalty_points: data.from_balance }));
      setPointsAdjust(String(data.from_balance));
      setTransferOpen(false);
      toast.success(`Transferred ${pts} points to ${transferTarget.name}`);
    } catch (e) {
      setError(e.body?.error || e.message || "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  const fetchLedger = async (customerId, pg = 1, from = "", to = "") => {
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams({ page: pg, per_page: 50 });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const data = await api.get(`/api/customers/${customerId}/ledger?${params}`);
      setLedger(data.ledger || []);
      setLedgerTotal(data.total || 0);
      setLedgerPage(data.page || 1);
      setLedgerPages(data.total_pages || 1);
    } catch {
      setLedger([]);
      setLedgerTotal(0);
    } finally {
      setLedgerLoading(false);
    }
  };

  const blacklistCustomer = async () => {
    if (!detail || !blacklistReason.trim()) return;
    setBusy(true);
    try {
      const updated = await api.put(`/api/customers/${detail.id}/blacklist`, { reason: blacklistReason.trim() });
      setDetail((p) => ({ ...p, is_blacklisted: true, blacklist_reason: updated.blacklist_reason, blacklisted_at: updated.blacklisted_at }));
      setRows((prev) => prev.map((r) => r.id === detail.id ? { ...r, is_blacklisted: true, blacklist_reason: updated.blacklist_reason, blacklisted_at: updated.blacklisted_at } : r));
      setBlacklistModal(false);
      setBlacklistReason("");
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to blacklist customer");
    } finally {
      setBusy(false);
    }
  };

  const unblacklistCustomer = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.put(`/api/customers/${detail.id}/unblacklist`);
      setDetail((p) => ({ ...p, is_blacklisted: false, blacklist_reason: null, blacklisted_at: null }));
      setRows((prev) => prev.map((r) => r.id === detail.id ? { ...r, is_blacklisted: false, blacklist_reason: null, blacklisted_at: null } : r));
    } catch (e) {
      setError(e.body?.error || e.message || "Failed to unblacklist customer");
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
                          {r.tier_name && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: (r.tier_color || "#888") + "22", color: r.tier_color || "#888" }}>
                              <Award size={9} />{r.tier_name}
                            </span>
                          )}
                          {r.is_blacklisted && (
                            <span className="ml-1.5 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                              Blacklisted
                            </span>
                          )}
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
                            Archive
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

              <div className="flex border-b border-(--ui-border)">
                {[
                  { key: "profile", label: "Profile" },
                  { key: "ledger", label: "Ledger", icon: BookOpen },
                ].map(({ key, label, icon: Icon }) => (
                  <button
                    key={key}
                    className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                      detailTab === key
                        ? "border-emerald-600 text-emerald-700"
                        : "border-transparent text-(--ui-text-muted) hover:text-(--ui-text)"
                    }`}
                    onClick={() => {
                      setDetailTab(key);
                      if (key === "ledger" && ledger.length === 0) fetchLedger(detail.id);
                    }}
                  >
                    {Icon && <Icon size={12} />}
                    {label}
                  </button>
                ))}
              </div>

              {detailTab === "profile" && (
                <>
                  {detail.is_blacklisted && (
                    <div className="rounded-md border border-red-300 bg-red-50 p-2.5">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
                        <Ban size={13} /> Blacklisted
                      </p>
                      <p className="mt-1 text-xs text-red-600">{detail.blacklist_reason}</p>
                      {detail.blacklisted_at && (
                        <p className="mt-0.5 text-[10px] text-red-400">Since {fmtDate(detail.blacklisted_at)}</p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {detail.is_blacklisted ? (
                      <Button size="sm" onClick={unblacklistCustomer} disabled={busy}>
                        <ShieldCheck size={13} className="mr-1 inline text-emerald-600" />
                        Unblacklist
                      </Button>
                    ) : (
                      <Button size="sm" tone="danger" onClick={() => { setBlacklistReason(""); setBlacklistModal(true); }} disabled={busy}>
                        <Ban size={13} className="mr-1 inline" />
                        Blacklist
                      </Button>
                    )}
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

                  {/* Loyalty Tier Badge + Progress */}
                  {(() => {
                    const sorted = [...loyaltyTiers].sort((a, b) => Number(a.min_spend) - Number(b.min_spend));
                    const spend = Number(detail.total_spend || detail.total_spent || 0);
                    const currentIdx = sorted.findIndex((t) => t.id === detail.loyalty_tier_id);
                    const current = currentIdx >= 0 ? sorted[currentIdx] : null;
                    const next = currentIdx >= 0 && currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : (currentIdx < 0 && sorted.length ? sorted[0] : null);
                    const progressTo = next ? Math.min(100, Math.round((spend / Number(next.min_spend)) * 100)) : 100;
                    const remaining = next ? Math.max(0, Number(next.min_spend) - spend) : 0;
                    return sorted.length > 0 ? (
                      <SectionCard className="p-2">
                        <div className="flex items-center gap-2 mb-2">
                          {current ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: (current.color || "#8066FF") + "33", color: current.color || "#8066FF" }}>
                              <Award size={12} />{current.name}
                              {Number(current.points_multiplier) > 1 && <span className="opacity-70 text-[10px]">{current.points_multiplier}x pts</span>}
                              {Number(current.discount_percent) > 0 && <span className="opacity-70 text-[10px]">· {current.discount_percent}% off</span>}
                            </span>
                          ) : (
                            <span className="text-xs text-(--ui-text-muted)">No tier yet</span>
                          )}
                        </div>
                        {next && (
                          <>
                            <div className="h-1.5 rounded-full bg-(--ui-bg-elevated) overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${progressTo}%`, backgroundColor: next.color || "#8066FF" }} />
                            </div>
                            <p className="text-[10px] text-(--ui-text-muted) mt-1">
                              {money(remaining)} more to reach <span className="font-semibold" style={{ color: next.color || "#8066FF" }}>{next.name}</span>
                            </p>
                          </>
                        )}
                        {!next && current && (
                          <p className="text-[10px] text-(--ui-text-muted)">Highest tier reached</p>
                        )}
                      </SectionCard>
                    ) : null;
                  })()}

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
                    {(detail.loyalty_points || 0) > 0 && (
                      <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={openTransfer}>
                        <ArrowRightLeft size={13} className="mr-1" /> Transfer Points
                      </Button>
                    )}
                  </SectionCard>

                  <SectionCard className="p-2">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Wallet size={13} className="text-emerald-600" />
                      <p className="text-xs font-semibold text-(--ui-text)">
                        Wallet · {money(walletBalance)}
                      </p>
                    </div>
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
                    {walletLedger.length > 0 && (
                      <div className="mt-3 border-t border-(--ui-border) pt-2">
                        <p className="text-xs font-semibold text-(--ui-text-muted) mb-1.5">
                          Wallet History
                        </p>
                        <div className="max-h-44 overflow-auto space-y-1">
                          {walletLedger.slice(0, 10).map((entry, i) => (
                            <div
                              key={i}
                              className="flex items-start justify-between rounded border border-(--ui-border) px-2 py-1.5 text-xs"
                            >
                              <div className="min-w-0">
                                <p
                                  className={`font-semibold truncate ${
                                    entry.type === "credit"
                                      ? "text-emerald-700"
                                      : "text-rose-600"
                                  }`}
                                >
                                  {entry.type === "credit" ? "+" : "-"}
                                  {money(Math.abs(entry.amount))}
                                  {entry.note ? (
                                    <span className="ml-1 font-normal text-(--ui-text-muted)">
                                      · {entry.note}
                                    </span>
                                  ) : null}
                                </p>
                                <p className="text-(--ui-text-muted)">
                                  {fmtUtcDateTime(entry.created_at)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
                </>
              )}

              {detailTab === "ledger" && (
                <div className="space-y-3">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 grow">
                      <label className="text-[10px] font-medium text-(--ui-text-muted)">From</label>
                      <Input type="date" value={ledgerFrom} onChange={(e) => setLedgerFrom(e.target.value)} />
                    </div>
                    <div className="min-w-0 grow">
                      <label className="text-[10px] font-medium text-(--ui-text-muted)">To</label>
                      <Input type="date" value={ledgerTo} onChange={(e) => setLedgerTo(e.target.value)} />
                    </div>
                    <Button size="sm" onClick={() => { setLedgerPage(1); fetchLedger(detail.id, 1, ledgerFrom, ledgerTo); }}>
                      <Calendar size={12} className="mr-1 inline" />
                      Filter
                    </Button>
                  </div>

                  <div className="overflow-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-(--ui-muted-surface) text-[10px] uppercase text-(--ui-text-muted)">
                        <tr>
                          <th className="px-2 py-1.5 text-left">Date</th>
                          <th className="px-2 py-1.5 text-left">Type</th>
                          <th className="px-2 py-1.5 text-left">Ref</th>
                          <th className="px-2 py-1.5 text-right">Debit</th>
                          <th className="px-2 py-1.5 text-right">Credit</th>
                          <th className="px-2 py-1.5 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerLoading ? (
                          <tr><td colSpan={6} className="px-2 py-6 text-center text-(--ui-text-muted)">Loading...</td></tr>
                        ) : ledger.length === 0 ? (
                          <tr><td colSpan={6} className="px-2 py-6 text-center text-(--ui-text-muted)">No transactions found.</td></tr>
                        ) : (
                          ledger.map((entry, i) => {
                            const isCredit = entry.amount > 0;
                            const typeColors = {
                              sale: "text-emerald-700 bg-emerald-50",
                              return: "text-rose-700 bg-rose-50",
                              wallet_credit: "text-blue-700 bg-blue-50",
                              wallet_debit: "text-blue-700 bg-blue-50",
                              points_earned: "text-amber-700 bg-amber-50",
                              points_redeemed: "text-amber-700 bg-amber-50",
                            };
                            const typeLabels = {
                              sale: "Sale",
                              return: "Return",
                              wallet_credit: "Wallet In",
                              wallet_debit: "Wallet Out",
                              points_earned: "Pts Earned",
                              points_redeemed: "Pts Used",
                            };
                            return (
                              <tr key={i} className="border-t border-(--ui-border)">
                                <td className="px-2 py-1.5 whitespace-nowrap text-(--ui-text-muted)">{fmtUtcDateTime(entry.date)}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${typeColors[entry.type] || ""}`}>
                                    {typeLabels[entry.type] || entry.type}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-(--ui-text-muted) truncate max-w-24">{entry.reference || "-"}</td>
                                <td className="px-2 py-1.5 text-right text-rose-600 font-medium">
                                  {!isCredit ? money(Math.abs(entry.amount)) : ""}
                                </td>
                                <td className="px-2 py-1.5 text-right text-emerald-700 font-medium">
                                  {isCredit ? money(entry.amount) : ""}
                                </td>
                                <td className="px-2 py-1.5 text-right font-semibold text-(--ui-text)">{money(entry.running_balance)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>

                  {ledgerPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-(--ui-text-muted)">{ledgerTotal} entries · Page {ledgerPage}/{ledgerPages}</span>
                      <div className="flex gap-1">
                        <Button size="sm" disabled={ledgerPage <= 1} onClick={() => { const p = ledgerPage - 1; setLedgerPage(p); fetchLedger(detail.id, p, ledgerFrom, ledgerTo); }}>
                          <ChevronLeft size={12} />
                        </Button>
                        <Button size="sm" disabled={ledgerPage >= ledgerPages} onClick={() => { const p = ledgerPage + 1; setLedgerPage(p); fetchLedger(detail.id, p, ledgerFrom, ledgerTo); }}>
                          <ChevronRight size={12} />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
              <Input
                placeholder="NTN / CNIC (for FBR invoicing)"
                value={form.ntn_cnic}
                onChange={(e) => setForm((p) => ({ ...p, ntn_cnic: e.target.value }))}
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

      {blacklistModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-sm p-4">
            <h3 className="text-lg font-semibold text-red-700">Blacklist Customer</h3>
            <p className="mt-1 text-xs text-(--ui-text-muted)">
              This will block {detail?.name} from POS checkout.
            </p>
            <div className="mt-3 space-y-2">
              <Input
                required
                placeholder="Reason for blacklisting"
                value={blacklistReason}
                onChange={(e) => setBlacklistReason(e.target.value)}
              />
              <div className="flex gap-2 pt-1">
                <Button type="button" onClick={() => setBlacklistModal(false)}>
                  Cancel
                </Button>
                <Button tone="danger" disabled={busy || !blacklistReason.trim()} onClick={blacklistCustomer}>
                  Confirm Blacklist
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {transferOpen && detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3">
          <SectionCard className="w-full max-w-md p-4">
            <h3 className="text-lg font-semibold text-(--ui-text)">
              <ArrowRightLeft size={16} className="inline mr-1.5 -mt-0.5" />
              Transfer Loyalty Points
            </h3>
            <p className="mt-1 text-xs text-(--ui-text-muted)">
              From <strong>{detail.name}</strong> · {detail.loyalty_points || 0} points available
            </p>

            {/* Target customer search */}
            <div className="mt-3 space-y-2">
              <label className="text-xs font-medium text-(--ui-text-muted)">Recipient</label>
              {transferTarget ? (
                <div className="flex items-center justify-between rounded border border-(--ui-border) px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-(--ui-text)">{transferTarget.name}</p>
                    <p className="text-xs text-(--ui-text-muted)">{transferTarget.mobile || transferTarget.email || ""}</p>
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => { setTransferTarget(null); setTransferSearch(""); }}>Change</Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    placeholder="Search customer by name or phone..."
                    value={transferSearch}
                    onChange={(e) => searchTransferTarget(e.target.value)}
                    autoFocus
                  />
                  {transferSearching && <p className="mt-1 text-xs text-(--ui-text-muted)">Searching...</p>}
                  {transferResults.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-40 overflow-auto rounded border border-(--ui-border) bg-(--ui-bg) shadow-lg">
                      {transferResults.slice(0, 8).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-(--ui-bg-hover) transition-colors"
                          onClick={() => { setTransferTarget(c); setTransferSearch(c.name); setTransferResults([]); }}
                        >
                          <span className="font-medium text-(--ui-text)">{c.name}</span>
                          <span className="text-xs text-(--ui-text-muted)">{c.mobile || ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <label className="text-xs font-medium text-(--ui-text-muted)">Points to transfer</label>
              <Input
                type="number"
                min="1"
                max={detail.loyalty_points || 0}
                placeholder={`Max ${detail.loyalty_points || 0}`}
                value={transferPoints}
                onChange={(e) => setTransferPoints(e.target.value)}
              />
              {transferPoints && Number(transferPoints) > 0 && Number(transferPoints) <= (detail.loyalty_points || 0) && (
                <p className="text-xs text-(--ui-text-muted)">
                  Remaining balance: <strong>{(detail.loyalty_points || 0) - Number(transferPoints)}</strong> points
                </p>
              )}
              {transferPoints && Number(transferPoints) > (detail.loyalty_points || 0) && (
                <p className="text-xs text-red-600">Exceeds available points</p>
              )}

              <label className="text-xs font-medium text-(--ui-text-muted)">Reason (optional)</label>
              <Input
                placeholder="e.g. Family member, reward share"
                value={transferReason}
                onChange={(e) => setTransferReason(e.target.value)}
              />

              <div className="flex gap-2 pt-2">
                <Button type="button" onClick={() => setTransferOpen(false)}>Cancel</Button>
                <Button
                  tone="primary"
                  disabled={busy || !transferTarget || !transferPoints || Number(transferPoints) <= 0 || Number(transferPoints) > (detail.loyalty_points || 0)}
                  onClick={submitTransfer}
                >
                  Transfer {transferPoints && Number(transferPoints) > 0 ? `${transferPoints} Points` : ""}
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>
      ) : null}
    </PageShell>
  );
}
