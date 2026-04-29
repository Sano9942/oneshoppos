import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Award, Ban, BookOpen, Calendar, ChevronLeft, ChevronRight, Clock, Download, Package, Pencil, Plus, Search, ShieldCheck, Tag, Trash2, UserRound, Wallet, X } from "lucide-react";
import { api } from "../../api";
import { fmtDate, fmtUtcDateTime } from "../../utils/dates";
import { useCurrency } from "../../contexts/CurrencyContext";
import { usePreset } from "../../contexts/PresetContext";
import { useToast } from "../../contexts/ToastContext";
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
import GiftCardLookupStrip from "./customers/GiftCardLookupStrip";

const PAGE_SIZE = 25;

const EMPTY = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  cnic: "",
  occupation: "",
  ntn_cnic: "",
  date_of_birth: "",
  gender: "",
  city: "",
  customer_group_id: "",
  notes: "",
  tags: [],
  preferred_payment_method: "",
  preferred_contact: "",
  email_consent: false,
  sms_consent: false,
  whatsapp_consent: false,
  blood_group: "",
  allergies: "",
  medical_notes: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  insurance_id: "",
};

// Clinical presets share the medical UI block on the customer page.
// `clinic` is the legacy preset; `dental_clinic`, `veterinary`, and
// `physiotherapy` are the M10 presets whose `treatment_plans` mode maps here.
const CLINICAL_PRESETS = new Set([
  "clinic",
  "dental_clinic",
  "veterinary",
  "physiotherapy",
]);
function isClinicalPreset(industryType) {
  return CLINICAL_PRESETS.has(industryType);
}

function defaultSubjectType(industryType) {
  return industryType === "veterinary" ? "pet" : "dependent";
}

const SUBJECT_TYPE_OPTIONS = [
  { value: "self", label: "Self" },
  { value: "dependent", label: "Dependent" },
  { value: "pet", label: "Pet" },
];

const EMPTY_SUBJECT = {
  subject_type: "dependent",
  name: "",
  species: "",
  breed: "",
  dob: "",
  sex: "",
  weight_kg: "",
  identifier: "",
  notes: "",
};

const BLOOD_GROUPS = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const GENDER_OPTIONS = ["", "Male", "Female", "Other"];
const PAYMENT_OPTIONS = ["", "Cash", "Card", "Bank Transfer", "Mobile Wallet", "Credit"];
const CONTACT_OPTIONS = ["", "Phone", "Email", "WhatsApp", "SMS"];

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
  const { label, industry_type } = usePreset();
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

  // Clinical subjects + treatment plans (M10) — only fetched for clinical presets
  const [clinicalSubjects, setClinicalSubjects] = useState([]);
  const [clinicalPlans, setClinicalPlans] = useState([]);
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [subjectEditing, setSubjectEditing] = useState(null);
  const [subjectForm, setSubjectForm] = useState(EMPTY_SUBJECT);
  const [subjectError, setSubjectError] = useState("");
  const [subjectSaving, setSubjectSaving] = useState(false);

  // Order history
  const [orderHistory, setOrderHistory] = useState([]);
  const [ohPage, setOhPage] = useState(1);
  const [ohTotal, setOhTotal] = useState(0);
  const [ohLoading, setOhLoading] = useState(false);
  const OH_LIMIT = 20;

  // Customer groups + profile
  const [customerGroups, setCustomerGroups] = useState([]);
  const [profileData, setProfileData] = useState(null);
  const [allTags, setAllTags] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState([]);

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
    setOrderHistory([]);
    setOhPage(1);
    setOhTotal(0);
    setProfileData(null);
    setClinicalSubjects([]);
    setClinicalPlans([]);
    try {
      const [salesData, walletData, profileRes] = await Promise.all([
        api.get(`/api/customers/${customer.id}/sales`),
        api.get(`/api/customers/${customer.id}/wallet`),
        api.get(`/api/customers/${customer.id}/profile`),
      ]);
      setCustomerSales(salesData.sales || []);
      setWalletBalance(walletData.balance || 0);
      setWalletLedger(walletData.ledger || []);
      setProfileData(profileRes);
    } catch {
      setCustomerSales([]);
      setWalletBalance(0);
      setWalletLedger([]);
    }
    // Clinical presets: fetch subjects + treatment plans in parallel.
    // Endpoints are mode/flag-gated on the backend — a 403 (M29) means the
    // clinical feature isn't enabled, so swallow and leave the arrays empty.
    if (isClinicalPreset(industry_type)) {
      try {
        const [subjectsRes, plansRes] = await Promise.all([
          api.get(`/api/patient-subjects`, { customer_id: customer.id }),
          api.get(`/api/treatment-plans`, { customer_id: customer.id }),
        ]);
        setClinicalSubjects(subjectsRes.subjects || []);
        setClinicalPlans(plansRes.plans || []);
      } catch {
        setClinicalSubjects([]);
        setClinicalPlans([]);
      }
    }
  };

  const refreshClinicalSubjects = async (customerId) => {
    try {
      const res = await api.get(`/api/patient-subjects`, { customer_id: customerId });
      setClinicalSubjects(res.subjects || []);
    } catch {
      // Endpoint 403 (mode off, M29) or transient error — leave prior list intact.
    }
  };

  const openSubjectCreate = () => {
    setSubjectEditing(null);
    setSubjectForm({ ...EMPTY_SUBJECT, subject_type: defaultSubjectType(industry_type) });
    setSubjectError("");
    setSubjectModalOpen(true);
  };

  const openSubjectEdit = (subject) => {
    setSubjectEditing(subject);
    setSubjectForm({
      subject_type: subject.subject_type || "dependent",
      name: subject.name || "",
      species: subject.species || "",
      breed: subject.breed || "",
      dob: subject.dob ? String(subject.dob).slice(0, 10) : "",
      sex: subject.sex || "",
      weight_kg: subject.weight_kg != null ? String(subject.weight_kg) : "",
      identifier: subject.identifier || "",
      notes: subject.notes || "",
    });
    setSubjectError("");
    setSubjectModalOpen(true);
  };

  const submitSubject = async (e) => {
    e.preventDefault();
    if (!detail) return;
    if (!subjectForm.name.trim()) {
      setSubjectError("Name is required");
      return;
    }
    const payload = {
      customer_id: detail.id,
      subject_type: subjectForm.subject_type,
      name: subjectForm.name.trim(),
      species: subjectForm.species.trim() || null,
      breed: subjectForm.breed.trim() || null,
      dob: subjectForm.dob || null,
      sex: subjectForm.sex.trim() || null,
      weight_kg: subjectForm.weight_kg === "" ? null : Number(subjectForm.weight_kg),
      identifier: subjectForm.identifier.trim() || null,
      notes: subjectForm.notes.trim() || null,
    };
    setSubjectSaving(true);
    setSubjectError("");
    try {
      if (subjectEditing) {
        const { customer_id, ...rest } = payload;
        await api.put(`/api/patient-subjects/${subjectEditing.id}`, rest);
        toast.success("Subject updated");
      } else {
        await api.post(`/api/patient-subjects`, payload);
        toast.success("Subject added");
      }
      setSubjectModalOpen(false);
      await refreshClinicalSubjects(detail.id);
    } catch (err) {
      setSubjectError(err.body?.error || err.message || "Save failed");
    } finally {
      setSubjectSaving(false);
    }
  };

  const deleteSubject = async (subject) => {
    if (!detail) return;
    if (!window.confirm(`Remove ${subject.name}?`)) return;
    try {
      await api.del(`/api/patient-subjects/${subject.id}`);
      toast.success("Subject removed");
      await refreshClinicalSubjects(detail.id);
    } catch (err) {
      toast.error(err.body?.error || err.message || "Delete failed");
    }
  };

  useEffect(() => {
    fetchCustomers();
    api.get("/api/loyalty/tiers").then((d) => setLoyaltyTiers(d.tiers || [])).catch(() => {});
    api.get("/api/customer-groups").then((d) => setCustomerGroups(d.groups || [])).catch(() => {});
    api.get("/api/customers/tags").then((d) => setAllTags(d.tags || [])).catch(() => {});
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
      date_of_birth: row.date_of_birth ? row.date_of_birth.slice(0, 10) : "",
      gender: row.gender || "",
      city: row.city || "",
      customer_group_id: row.customer_group_id || "",
      notes: row.notes || "",
      tags: row.tags || [],
      preferred_payment_method: row.preferred_payment_method || "",
      preferred_contact: row.preferred_contact || "",
      email_consent: !!row.email_consent,
      sms_consent: !!row.sms_consent,
      whatsapp_consent: !!row.whatsapp_consent,
      blood_group: row.blood_group || "",
      allergies: row.allergies || "",
      medical_notes: row.medical_notes || "",
      emergency_contact_name: row.emergency_contact_name || "",
      emergency_contact_phone: row.emergency_contact_phone || "",
      insurance_id: row.insurance_id || "",
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

  const fetchOrderHistory = async (customerId, pg = 1) => {
    setOhLoading(true);
    try {
      const data = await api.get(`/api/customers/${customerId}/order-history?page=${pg}&limit=${OH_LIMIT}`);
      setOrderHistory(data.orders || []);
      setOhTotal(data.pagination?.total || 0);
      setOhPage(data.pagination?.page || pg);
    } catch {
      setOrderHistory([]);
      setOhTotal(0);
    } finally {
      setOhLoading(false);
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

  // --- Tag management ---
  const addTag = async (tag) => {
    if (!detail || !tag.trim()) return;
    const cleaned = tag.trim().toLowerCase();
    const current = detail.tags || [];
    if (current.includes(cleaned)) return;
    const updated = [...current, cleaned];
    try {
      await api.put(`/api/customers/${detail.id}/tags`, { tags: updated });
      setDetail((p) => ({ ...p, tags: updated }));
      setRows((prev) => prev.map((r) => r.id === detail.id ? { ...r, tags: updated } : r));
      if (!allTags.includes(cleaned)) setAllTags((prev) => [...prev, cleaned].sort());
      setTagInput("");
      setTagSuggestions([]);
    } catch (e) {
      toast.error(e.body?.error || "Failed to update tags");
    }
  };

  const removeTag = async (tag) => {
    if (!detail) return;
    const updated = (detail.tags || []).filter((t) => t !== tag);
    try {
      await api.put(`/api/customers/${detail.id}/tags`, { tags: updated });
      setDetail((p) => ({ ...p, tags: updated }));
      setRows((prev) => prev.map((r) => r.id === detail.id ? { ...r, tags: updated } : r));
    } catch (e) {
      toast.error(e.body?.error || "Failed to update tags");
    }
  };

  const handleTagInput = (val) => {
    setTagInput(val);
    if (!val.trim()) { setTagSuggestions([]); return; }
    const q = val.toLowerCase();
    const current = detail?.tags || [];
    setTagSuggestions(allTags.filter((t) => t.includes(q) && !current.includes(t)).slice(0, 6));
  };

  const selectedCount = selectedIds.size;

  return (
    <PageShell
      title={label("customers")}
      subtitle={`Manage ${label("customers").toLowerCase()}, loyalty points, and wallet balances.`}
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

      <GiftCardLookupStrip />

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
                          {r.group_name && (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                              {r.group_name}
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
                  { key: "orders", label: "Order History", icon: Clock },
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
                      if (key === "orders" && orderHistory.length === 0) fetchOrderHistory(detail.id);
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

                  {/* Purchase Summary Cards */}
                  <div className="grid grid-cols-2 gap-2">
                    <SectionCard className="p-2 text-center">
                      <p className="text-xs text-(--ui-text-muted)">Orders</p>
                      <p className="text-lg font-semibold text-(--ui-text)">
                        {profileData?.purchase_summary?.total_orders ?? detail.order_count ?? 0}
                      </p>
                    </SectionCard>
                    <SectionCard className="p-2 text-center">
                      <p className="text-xs text-(--ui-text-muted)">Spent</p>
                      <p className="text-lg font-semibold text-(--ui-text)">
                        {money(profileData?.purchase_summary?.total_spend ?? detail.total_spent ?? 0)}
                      </p>
                    </SectionCard>
                    <SectionCard className="p-2 text-center">
                      <p className="text-xs text-(--ui-text-muted)">Avg Order</p>
                      <p className="text-lg font-semibold text-(--ui-text)">
                        {money(profileData?.purchase_summary?.avg_order_value ?? 0)}
                      </p>
                    </SectionCard>
                    <SectionCard className="p-2 text-center">
                      <p className="text-xs text-(--ui-text-muted)">Last Purchase</p>
                      <p className="text-sm font-semibold text-(--ui-text)">
                        {profileData?.purchase_summary?.last_purchase_date ? fmtDate(profileData.purchase_summary.last_purchase_date) : "Never"}
                      </p>
                    </SectionCard>
                  </div>

                  {/* Demographics & Preferences */}
                  {(detail.gender || detail.date_of_birth || detail.city || detail.preferred_payment_method || detail.preferred_contact || detail.group_name) && (
                    <SectionCard className="p-2">
                      <p className="text-xs font-semibold text-(--ui-text-muted) mb-1.5">Demographics & Preferences</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {detail.gender && <><span className="text-(--ui-text-muted)">Gender</span><span className="text-(--ui-text)">{detail.gender}</span></>}
                        {detail.date_of_birth && <><span className="text-(--ui-text-muted)">Birthday</span><span className="text-(--ui-text)">{detail.date_of_birth.slice(0, 10)}</span></>}
                        {detail.city && <><span className="text-(--ui-text-muted)">City</span><span className="text-(--ui-text)">{detail.city}</span></>}
                        {detail.preferred_payment_method && <><span className="text-(--ui-text-muted)">Payment</span><span className="text-(--ui-text)">{detail.preferred_payment_method}</span></>}
                        {detail.preferred_contact && <><span className="text-(--ui-text-muted)">Contact</span><span className="text-(--ui-text)">{detail.preferred_contact}</span></>}
                        {detail.group_name && <><span className="text-(--ui-text-muted)">Group</span><span className="text-(--ui-text)">{detail.group_name}</span></>}
                      </div>
                    </SectionCard>
                  )}

                  {/* Consent & Quick Actions */}
                  <SectionCard className="p-2">
                    <div className="flex gap-2 mb-2">
                      {detail.email_consent && <Badge tone="success">Email OK</Badge>}
                      {detail.sms_consent && <Badge tone="success">SMS OK</Badge>}
                      {detail.whatsapp_consent && <Badge tone="success">WhatsApp OK</Badge>}
                      {!detail.email_consent && !detail.sms_consent && !detail.whatsapp_consent && <span className="text-xs text-(--ui-text-muted)">No communication consent</span>}
                    </div>
                    <div className="flex gap-2">
                      <a href={`/customer-invoices?customer_id=${detail.id}`} className="text-xs text-blue-600 hover:underline">View Invoices</a>
                      <a href={`/messaging/inbox`} className="text-xs text-blue-600 hover:underline">View Messages</a>
                    </div>
                  </SectionCard>

                  {/* Medical Info — clinical presets (clinic, dental_clinic, veterinary, physiotherapy) */}
                  {isClinicalPreset(industry_type) && (detail.blood_group || detail.allergies || detail.medical_notes || detail.emergency_contact_name || detail.insurance_id) && (
                    <SectionCard className="p-2">
                      <p className="text-xs font-semibold text-(--ui-text-muted) mb-1.5">Medical Information</p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        {detail.blood_group && <><span className="text-(--ui-text-muted)">Blood Group</span><span className="text-(--ui-text) font-medium">{detail.blood_group}</span></>}
                        {detail.insurance_id && <><span className="text-(--ui-text-muted)">Insurance ID</span><span className="text-(--ui-text)">{detail.insurance_id}</span></>}
                        {detail.allergies && <><span className="text-(--ui-text-muted)">Allergies</span><span className="text-red-600 font-medium">{detail.allergies}</span></>}
                        {detail.emergency_contact_name && <><span className="text-(--ui-text-muted)">Emergency Contact</span><span className="text-(--ui-text)">{detail.emergency_contact_name}{detail.emergency_contact_phone ? ` · ${detail.emergency_contact_phone}` : ""}</span></>}
                      </div>
                      {detail.medical_notes && <p className="mt-1 text-xs text-(--ui-text-muted) italic">{detail.medical_notes}</p>}
                    </SectionCard>
                  )}

                  {/* Clinical — Subjects (M10): self / dependent / pet. Only shown for clinical presets. */}
                  {isClinicalPreset(industry_type) && (
                    <SectionCard className="p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-xs font-semibold text-(--ui-text-muted)">
                          {industry_type === "veterinary" ? "Pets & Subjects" : "Patients & Dependents"}
                        </p>
                        <button
                          type="button"
                          onClick={openSubjectCreate}
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                          data-testid="subject-add"
                        >
                          <Plus size={12} /> Add
                        </button>
                      </div>
                      {clinicalSubjects.length === 0 ? (
                        <p className="text-xs text-(--ui-text-muted) italic">
                          {industry_type === "veterinary"
                            ? "No pets on file. Add one to link treatment plans."
                            : "No dependents on file. Add one to link treatment plans."}
                        </p>
                      ) : (
                        <div className="space-y-1">
                          {clinicalSubjects.map((s) => (
                            <div key={s.id} className="flex items-center justify-between text-xs group">
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge tone="default">{s.subject_type}</Badge>
                                <span className="font-medium text-(--ui-text) truncate">{s.name}</span>
                                {s.species && <span className="text-(--ui-text-muted) truncate">· {s.species}{s.breed ? `, ${s.breed}` : ""}</span>}
                                {s.weight_kg && <span className="text-(--ui-text-muted)">· {s.weight_kg} kg</span>}
                              </div>
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                <button
                                  type="button"
                                  onClick={() => openSubjectEdit(s)}
                                  className="p-1 rounded hover:bg-(--ui-bg) text-(--ui-text-muted) hover:text-(--ui-text)"
                                  aria-label={`Edit ${s.name}`}
                                  data-testid={`subject-edit-${s.id}`}
                                >
                                  <Pencil size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteSubject(s)}
                                  className="p-1 rounded hover:bg-rose-50 text-(--ui-text-muted) hover:text-rose-600"
                                  aria-label={`Remove ${s.name}`}
                                  data-testid={`subject-delete-${s.id}`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </SectionCard>
                  )}

                  {/* Clinical — Treatment Plans (M10). Only shown for clinical presets. */}
                  {isClinicalPreset(industry_type) && clinicalPlans.length > 0 && (
                    <SectionCard className="p-2">
                      <p className="text-xs font-semibold text-(--ui-text-muted) mb-1.5">Treatment Plans</p>
                      <div className="space-y-1">
                        {clinicalPlans.map((p) => (
                          <a
                            key={p.id}
                            href={`/treatment-plans/${p.id}`}
                            className="flex items-center justify-between text-xs hover:bg-(--ui-bg) rounded px-1 py-0.5"
                          >
                            <div className="flex items-center gap-2">
                              <Badge tone={p.status === "active" ? "success" : p.status === "completed" ? "default" : "warning"}>
                                {p.status}
                              </Badge>
                              <span className="font-medium text-(--ui-text)">{p.plan_number || `#${p.id}`}</span>
                              {p.diagnosis && <span className="text-(--ui-text-muted) truncate max-w-40">· {p.diagnosis}</span>}
                            </div>
                            <span className="text-(--ui-text-muted)">
                              {p.sessions_completed || 0} / {p.total_sessions_planned || "?"}
                            </span>
                          </a>
                        ))}
                      </div>
                    </SectionCard>
                  )}

                  {/* Tags */}
                  <SectionCard className="p-2">
                    <p className="text-xs font-semibold text-(--ui-text-muted) mb-1.5">
                      <Tag size={11} className="inline mr-1" />Tags
                    </p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(detail.tags || []).map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                          {tag}
                          <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-600 transition-colors">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      {(!detail.tags || detail.tags.length === 0) && (
                        <span className="text-[11px] text-(--ui-text-muted)">No tags</span>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        placeholder="Add tag..."
                        value={tagInput}
                        onChange={(e) => handleTagInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && tagInput.trim()) { e.preventDefault(); addTag(tagInput); }
                        }}
                      />
                      {tagSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-(--ui-border) bg-(--ui-bg) shadow-lg max-h-32 overflow-auto">
                          {tagSuggestions.map((t) => (
                            <button key={t} type="button" className="block w-full px-3 py-1.5 text-left text-xs hover:bg-(--ui-bg-hover)" onClick={() => addTag(t)}>
                              {t}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </SectionCard>

                  {/* Notes */}
                  {detail.notes && (
                    <SectionCard className="p-2">
                      <p className="text-xs font-semibold text-(--ui-text-muted) mb-1">Notes</p>
                      <p className="text-xs text-(--ui-text) whitespace-pre-wrap">{detail.notes}</p>
                    </SectionCard>
                  )}

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
                      <Button size="sm" className="mt-2 w-full" onClick={openTransfer}>
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

                  {/* Top Products */}
                  {profileData?.top_products?.length > 0 && (
                    <SectionCard className="p-2">
                      <p className="text-xs font-semibold text-(--ui-text-muted) mb-1.5">
                        <Package size={11} className="inline mr-1" />Top Products
                      </p>
                      <div className="space-y-1">
                        {profileData.top_products.map((p, i) => (
                          <div key={i} className="flex items-center justify-between rounded border border-(--ui-border) px-2 py-1.5 text-xs">
                            <div className="min-w-0">
                              <p className="font-medium text-(--ui-text) truncate">{p.name}</p>
                              {p.sku && <p className="text-[10px] text-(--ui-text-muted)">{p.sku}</p>}
                            </div>
                            <div className="text-right shrink-0 ml-2">
                              <p className="font-semibold text-(--ui-text)">{p.total_qty}x</p>
                              <p className="text-[10px] text-(--ui-text-muted)">{money(p.total_value)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </SectionCard>
                  )}

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

              {detailTab === "orders" && (() => {
                const ohTotalPages = Math.max(1, Math.ceil(ohTotal / OH_LIMIT));
                const channelBadge = (ch) => {
                  const map = {
                    pos: "bg-(--ui-muted-surface) text-(--ui-text)",
                    storefront: "bg-blue-100 text-blue-700",
                    shopify: "bg-green-100 text-green-700",
                    daraz: "bg-orange-100 text-orange-700",
                    facebook: "bg-blue-100 text-blue-600",
                    instagram: "bg-pink-100 text-pink-700",
                    whatsapp: "bg-green-100 text-green-600",
                  };
                  return map[ch] || "bg-(--ui-muted-surface) text-(--ui-text-muted)";
                };
                const statusColor = (s) => {
                  if (s === "completed" || s === "closed") return "text-emerald-700";
                  if (s === "open") return "text-amber-600";
                  return "text-(--ui-text-muted)";
                };
                return (
                  <div className="space-y-3">
                    <div className="overflow-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-(--ui-muted-surface) text-[10px] uppercase text-(--ui-text-muted)">
                          <tr>
                            <th className="px-2 py-1.5 text-left">Date</th>
                            <th className="px-2 py-1.5 text-left">Order #</th>
                            <th className="px-2 py-1.5 text-left">Channel</th>
                            <th className="px-2 py-1.5 text-right">Total</th>
                            <th className="px-2 py-1.5 text-left">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ohLoading ? (
                            <tr><td colSpan={5} className="px-2 py-6 text-center text-(--ui-text-muted)">Loading...</td></tr>
                          ) : orderHistory.length === 0 ? (
                            <tr><td colSpan={5} className="px-2 py-6 text-center text-(--ui-text-muted)">No orders found for this customer.</td></tr>
                          ) : (
                            orderHistory.map((o) => (
                              <tr key={`${o.type}-${o.id}`} className="border-t border-(--ui-border)">
                                <td className="px-2 py-1.5 whitespace-nowrap text-(--ui-text-muted)">{fmtUtcDateTime(o.date)}</td>
                                <td className="px-2 py-1.5 font-medium text-(--ui-text)">{o.orderNumber}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold capitalize ${channelBadge(o.channel)}`}>
                                    {o.channel === "pos" ? "POS" : o.channel}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 text-right font-medium text-(--ui-text)">{money(o.total)}</td>
                                <td className="px-2 py-1.5">
                                  <span className={`text-[10px] font-semibold capitalize ${statusColor(o.status)}`}>{o.status}</span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>

                    {ohTotalPages > 1 && (
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-(--ui-text-muted)">{ohTotal} orders · Page {ohPage}/{ohTotalPages}</span>
                        <div className="flex gap-1">
                          <Button size="sm" disabled={ohPage <= 1} onClick={() => { const p = ohPage - 1; setOhPage(p); fetchOrderHistory(detail.id, p); }}>
                            <ChevronLeft size={12} />
                          </Button>
                          <Button size="sm" disabled={ohPage >= ohTotalPages} onClick={() => { const p = ohPage + 1; setOhPage(p); fetchOrderHistory(detail.id, p); }}>
                            <ChevronRight size={12} />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </SectionCard>
      </div>

      <Modal
        open={modalOpen}
        onClose={busy ? undefined : () => setModalOpen(false)}
        title={editing ? "Edit Customer" : "Add Customer"}
        size="lg"
      >
        <form className="space-y-3" onSubmit={submitForm}>
              {formError ? (
                <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{formError}</p>
              ) : null}

              {/* Basic Info */}
              <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide">Basic Info</p>
              <Input required placeholder="Name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Mobile" value={form.mobile} onChange={(e) => setForm((p) => ({ ...p, mobile: e.target.value }))} />
                <Input placeholder="Email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
              </div>
              <Input placeholder="Address" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
              <Input placeholder="NTN / CNIC (for FBR invoicing)" value={form.ntn_cnic} onChange={(e) => setForm((p) => ({ ...p, ntn_cnic: e.target.value }))} />

              {/* Demographics */}
              <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide pt-1">Demographics</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Date of Birth</label>
                  <Input type="date" value={form.date_of_birth} onChange={(e) => setForm((p) => ({ ...p, date_of_birth: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Gender</label>
                  <select className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text)" value={form.gender} onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))}>
                    {GENDER_OPTIONS.map((g) => <option key={g} value={g}>{g || "— Select —"}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="City" value={form.city} onChange={(e) => setForm((p) => ({ ...p, city: e.target.value }))} />
                <Input placeholder="Occupation" value={form.occupation} onChange={(e) => setForm((p) => ({ ...p, occupation: e.target.value }))} />
              </div>

              {/* Preferences */}
              <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide pt-1">Preferences</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Customer Group</label>
                  <select className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text)" value={form.customer_group_id} onChange={(e) => setForm((p) => ({ ...p, customer_group_id: e.target.value || "" }))}>
                    <option value="">— No Group —</option>
                    {customerGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Preferred Payment</label>
                  <select className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text)" value={form.preferred_payment_method} onChange={(e) => setForm((p) => ({ ...p, preferred_payment_method: e.target.value }))}>
                    {PAYMENT_OPTIONS.map((o) => <option key={o} value={o}>{o || "— Select —"}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-medium text-(--ui-text-muted)">Preferred Contact</label>
                <select className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text)" value={form.preferred_contact} onChange={(e) => setForm((p) => ({ ...p, preferred_contact: e.target.value }))}>
                  {CONTACT_OPTIONS.map((o) => <option key={o} value={o}>{o || "— Select —"}</option>)}
                </select>
              </div>

              {/* Communication Consent */}
              <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide pt-1">Communication Consent</p>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.email_consent} onChange={(e) => setForm((p) => ({ ...p, email_consent: e.target.checked }))} />
                  Email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.sms_consent} onChange={(e) => setForm((p) => ({ ...p, sms_consent: e.target.checked }))} />
                  SMS
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.whatsapp_consent} onChange={(e) => setForm((p) => ({ ...p, whatsapp_consent: e.target.checked }))} />
                  WhatsApp
                </label>
              </div>

              {/* Medical Information — clinical presets (clinic, dental_clinic, veterinary, physiotherapy) */}
              {isClinicalPreset(industry_type) && (
                <>
                  <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide pt-1">Medical Information</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-medium text-(--ui-text-muted)">Blood Group</label>
                      <select className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text)" value={form.blood_group} onChange={(e) => setForm((p) => ({ ...p, blood_group: e.target.value }))}>
                        {BLOOD_GROUPS.map((o) => <option key={o} value={o}>{o || "— Select —"}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-(--ui-text-muted)">Insurance ID</label>
                      <Input placeholder="Insurance / Policy ID" value={form.insurance_id} onChange={(e) => setForm((p) => ({ ...p, insurance_id: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-(--ui-text-muted)">Allergies</label>
                    <Input placeholder="Known allergies" value={form.allergies} onChange={(e) => setForm((p) => ({ ...p, allergies: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-medium text-(--ui-text-muted)">Emergency Contact Name</label>
                      <Input placeholder="Emergency contact" value={form.emergency_contact_name} onChange={(e) => setForm((p) => ({ ...p, emergency_contact_name: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium text-(--ui-text-muted)">Emergency Contact Phone</label>
                      <Input placeholder="Phone number" value={form.emergency_contact_phone} onChange={(e) => setForm((p) => ({ ...p, emergency_contact_phone: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-(--ui-text-muted)">Medical Notes</label>
                    <textarea
                      className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text) min-h-16 resize-y"
                      placeholder="Medical conditions, ongoing treatments..."
                      value={form.medical_notes}
                      onChange={(e) => setForm((p) => ({ ...p, medical_notes: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {/* Notes */}
              <p className="text-xs font-semibold text-(--ui-text-muted) uppercase tracking-wide pt-1">Notes</p>
              <textarea
                className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text) min-h-16 resize-y"
                placeholder="Internal notes about this customer..."
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              />

          <ModalFooter>
            <Button type="button" onClick={() => setModalOpen(false)} disabled={busy}>Cancel</Button>
            <Button tone="primary" type="submit" disabled={busy}>{editing ? "Save" : "Create"}</Button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        open={subjectModalOpen && !!detail}
        onClose={subjectSaving ? undefined : () => setSubjectModalOpen(false)}
        title={subjectEditing ? "Edit Subject" : (industry_type === "veterinary" ? "Add Pet" : "Add Subject")}
        size="md"
      >
        {detail ? (
          <>
            <p className="text-xs text-(--ui-text-muted) mb-3">
              For <strong>{detail.name}</strong>
            </p>
            <form className="space-y-3" onSubmit={submitSubject}>
              {subjectError ? (
                <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{subjectError}</p>
              ) : null}

              <div>
                <label className="text-[10px] font-medium text-(--ui-text-muted)">Type</label>
                <select
                  className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text)"
                  value={subjectForm.subject_type}
                  onChange={(e) => setSubjectForm((p) => ({ ...p, subject_type: e.target.value }))}
                  data-testid="subject-type"
                >
                  {SUBJECT_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-medium text-(--ui-text-muted)">Name</label>
                <Input
                  required
                  autoFocus
                  placeholder={subjectForm.subject_type === "pet" ? "Pet name" : "Full name"}
                  value={subjectForm.name}
                  onChange={(e) => setSubjectForm((p) => ({ ...p, name: e.target.value }))}
                  data-testid="subject-name"
                />
              </div>

              {subjectForm.subject_type === "pet" ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-medium text-(--ui-text-muted)">Species</label>
                    <Input
                      placeholder="Dog, Cat, Bird…"
                      value={subjectForm.species}
                      onChange={(e) => setSubjectForm((p) => ({ ...p, species: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-(--ui-text-muted)">Breed</label>
                    <Input
                      placeholder="Breed"
                      value={subjectForm.breed}
                      onChange={(e) => setSubjectForm((p) => ({ ...p, breed: e.target.value }))}
                    />
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Date of birth</label>
                  <Input
                    type="date"
                    value={subjectForm.dob}
                    onChange={(e) => setSubjectForm((p) => ({ ...p, dob: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Sex</label>
                  <Input
                    placeholder={subjectForm.subject_type === "pet" ? "M / F / Neutered" : "Male / Female / Other"}
                    value={subjectForm.sex}
                    onChange={(e) => setSubjectForm((p) => ({ ...p, sex: e.target.value }))}
                  />
                </div>
              </div>

              {subjectForm.subject_type === "pet" ? (
                <div>
                  <label className="text-[10px] font-medium text-(--ui-text-muted)">Weight (kg)</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder="Optional"
                    value={subjectForm.weight_kg}
                    onChange={(e) => setSubjectForm((p) => ({ ...p, weight_kg: e.target.value }))}
                  />
                </div>
              ) : null}

              <div>
                <label className="text-[10px] font-medium text-(--ui-text-muted)">
                  {subjectForm.subject_type === "pet" ? "Microchip / tag ID" : "Identifier (MRN, passport…)"}
                </label>
                <Input
                  placeholder="Optional"
                  value={subjectForm.identifier}
                  onChange={(e) => setSubjectForm((p) => ({ ...p, identifier: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-medium text-(--ui-text-muted)">Notes</label>
                <textarea
                  className="w-full rounded border border-(--ui-border) bg-(--ui-bg) px-2.5 py-1.5 text-sm text-(--ui-text) min-h-16 resize-y"
                  placeholder="Relationship, allergies, special notes..."
                  value={subjectForm.notes}
                  onChange={(e) => setSubjectForm((p) => ({ ...p, notes: e.target.value }))}
                />
              </div>

              <ModalFooter>
                <Button type="button" onClick={() => setSubjectModalOpen(false)} disabled={subjectSaving}>Cancel</Button>
                <Button tone="primary" type="submit" disabled={subjectSaving} data-testid="subject-save">
                  {subjectEditing ? "Save" : "Add"}
                </Button>
              </ModalFooter>
            </form>
          </>
        ) : null}
      </Modal>

      <Modal
        open={!!blacklistModal}
        onClose={busy ? undefined : () => setBlacklistModal(false)}
        title="Blacklist Customer"
        size="sm"
      >
        <p className="text-xs text-(--ui-text-muted)">
          This will block {detail?.name} from POS checkout.
        </p>
        <div className="mt-3 space-y-2">
          <Input
            required
            placeholder="Reason for blacklisting"
            value={blacklistReason}
            onChange={(e) => setBlacklistReason(e.target.value)}
          />
        </div>
        <ModalFooter>
          <Button type="button" onClick={() => setBlacklistModal(false)} disabled={busy}>
            Cancel
          </Button>
          <Button tone="danger" disabled={busy || !blacklistReason.trim()} onClick={blacklistCustomer}>
            Confirm Blacklist
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={transferOpen && !!detail}
        onClose={busy ? undefined : () => setTransferOpen(false)}
        title={<><ArrowRightLeft size={16} className="inline mr-1.5 -mt-0.5" />Transfer Loyalty Points</>}
        size="md"
      >
        {detail ? (
          <>
            <p className="text-xs text-(--ui-text-muted)">
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
                  <Button size="sm" onClick={() => { setTransferTarget(null); setTransferSearch(""); }}>Change</Button>
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
                        /* Autocomplete dropdown item — <Button> would break the hover/text-left layout. */
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
            </div>
            <ModalFooter>
              <Button type="button" onClick={() => setTransferOpen(false)} disabled={busy}>Cancel</Button>
              <Button
                tone="primary"
                disabled={busy || !transferTarget || !transferPoints || Number(transferPoints) <= 0 || Number(transferPoints) > (detail.loyalty_points || 0)}
                onClick={submitTransfer}
              >
                Transfer {transferPoints && Number(transferPoints) > 0 ? `${transferPoints} Points` : ""}
              </Button>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </PageShell>
  );
}
