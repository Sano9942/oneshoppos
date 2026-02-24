import { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Search,
  Edit2,
  Trash2,
  X,
  Phone,
  Mail,
  MapPin,
  ShoppingBag,
  DollarSign,
  Gift,
  Download,
  Wallet,
} from "lucide-react";

const exportCSV = (data, filename) => {
  if (!data.length) return;
  const headers = Object.keys(data[0]).join(",");
  const rows = data.map((r) =>
    Object.values(r)
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(","),
  );
  const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const API = "http://localhost:5000";
const fmt = (n) => "$" + (n || 0).toFixed(2);
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

const EMPTY = {
  name: "",
  mobile: "",
  email: "",
  address: "",
  cnic: "",
  occupation: "",
};

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Detail panel
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerSales, setCustomerSales] = useState([]);
  const [salesLoading, setSalesLoading] = useState(false);

  // Delete
  const [deleteError, setDeleteError] = useState("");

  // Points
  const [pointsAdjust, setPointsAdjust] = useState("");
  const [isAdjustingPoints, setIsAdjustingPoints] = useState(false);

  // Wallet
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletTopup, setWalletTopup] = useState("");
  const [walletNote, setWalletNote] = useState("");
  const [isTopingUp, setIsTopingUp] = useState(false);

  const fetchCustomers = async (q = "") => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${API}/api/customers?search=${encodeURIComponent(q)}`,
      );
      const data = await res.json();
      setCustomers(data.customers || []);
    } catch {
      console.error("Failed to load customers");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => fetchCustomers(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const openAdd = () => {
    setEditingCustomer(null);
    setForm(EMPTY);
    setFormError("");
    setIsModalOpen(true);
  };
  const openEdit = (c) => {
    setEditingCustomer(c);
    setForm({
      name: c.name,
      mobile: c.mobile || "",
      email: c.email || "",
      address: c.address || "",
      cnic: c.cnic || "",
      occupation: c.occupation || "",
    });
    setFormError("");
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormError("");
    setIsSaving(true);
    try {
      const url = editingCustomer
        ? `${API}/api/customers/${editingCustomer.id}`
        : `${API}/api/customers`;
      const method = editingCustomer ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to save");
        return;
      }
      setIsModalOpen(false);
      fetchCustomers(search);
      if (selectedCustomer?.id === editingCustomer?.id)
        setSelectedCustomer({ ...selectedCustomer, ...form });
    } catch {
      setFormError("Connection failed.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (c) => {
    setDeleteError("");
    if (!window.confirm(`Delete customer "${c.name}"?`)) return;
    try {
      const res = await fetch(`${API}/api/customers/${c.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error);
        return;
      }
      if (selectedCustomer?.id === c.id) setSelectedCustomer(null);
      fetchCustomers(search);
    } catch {
      setDeleteError("Connection failed.");
    }
  };

  const handleAdjustPoints = async (e) => {
    e.preventDefault();
    if (!selectedCustomer || pointsAdjust === "") return;
    setIsAdjustingPoints(true);
    try {
      const res = await fetch(
        `${API}/api/customers/${selectedCustomer.id}/points`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: pointsAdjust }),
        },
      );
      if (res.ok) {
        const updatedPoints = parseInt(pointsAdjust);
        setSelectedCustomer({
          ...selectedCustomer,
          loyalty_points: updatedPoints,
        });
        setCustomers(
          customers.map((c) =>
            c.id === selectedCustomer.id
              ? { ...c, loyalty_points: updatedPoints }
              : c,
          ),
        );
        setPointsAdjust("");
      }
    } catch (err) {
      console.error("Failed to adjust points", err);
    } finally {
      setIsAdjustingPoints(false);
    }
  };

  const openDetail = async (c) => {
    setSelectedCustomer(c);
    setSalesLoading(true);
    setCustomerSales([]);
    setPointsAdjust(c.loyalty_points || 0);
    setWalletTopup("");
    setWalletNote("");
    try {
      const [salesRes, walletRes] = await Promise.all([
        fetch(`${API}/api/customers/${c.id}/sales`),
        fetch(`${API}/api/customers/${c.id}/wallet`),
      ]);
      const salesData = await salesRes.json();
      const walletData = await walletRes.json();
      setCustomerSales(salesData.sales || []);
      setWalletBalance(walletData.balance || 0);
    } catch {
      console.error("Failed to load customer detail");
    } finally {
      setSalesLoading(false);
    }
  };

  const handleWalletTopup = async (e) => {
    e.preventDefault();
    if (!selectedCustomer || !walletTopup || parseFloat(walletTopup) <= 0) return;
    setIsTopingUp(true);
    try {
      const res = await fetch(`${API}/api/customers/${selectedCustomer.id}/wallet/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(walletTopup), note: walletNote }),
      });
      const data = await res.json();
      if (res.ok) {
        setWalletBalance(data.balance);
        setWalletTopup("");
        setWalletNote("");
      } else {
        alert(data.error || "Top-up failed");
      }
    } catch {
      alert("Connection failed");
    } finally {
      setIsTopingUp(false);
    }
  };

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Customers
          </h1>
          <p className="text-slate-500">
            {customers.length} customer{customers.length !== 1 ? "s" : ""}{" "}
            registered
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              exportCSV(
                customers.map((c) => ({
                  name: c.name,
                  mobile: c.mobile,
                  email: c.email,
                  address: c.address,
                  cnic: c.cnic,
                  occupation: c.occupation,
                  loyalty_points: c.loyalty_points,
                  total_spent: c.total_spent,
                  order_count: c.order_count,
                })),
                "customers.csv",
              )
            }
            className="border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-4 py-2.5 rounded-xl font-medium flex items-center gap-2 transition-all"
          >
            <Download size={18} /> Export CSV
          </button>
          <button
            onClick={openAdd}
            className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium transition-colors flex items-center gap-2 shadow-sm"
          >
            <Plus size={20} /> Add Customer
          </button>
        </div>
      </div>

      {deleteError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 flex justify-between items-center">
          {deleteError}
          <button onClick={() => setDeleteError("")}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main layout */}
      <div className="flex flex-1 gap-6 overflow-hidden min-h-0">
        {/* Table */}
        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50/50">
            <div className="relative max-w-sm">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <input
                type="text"
                placeholder="Search name, mobile, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-linear-to-br from-indigo-50 to-blue-50 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                  <th className="p-4">Customer</th>
                  <th className="p-4">Mobile</th>
                  <th className="p-4">Email</th>
                  <th className="p-4 text-center">Points</th>
                  <th className="p-4 text-right">Wallet</th>
                  <th className="p-4 text-center">Orders</th>
                  <th className="p-4 text-right">Total Spent</th>
                  <th className="p-4">Joined</th>
                  <th className="p-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan="9" className="p-8 text-center text-slate-400">
                      Loading customers...
                    </td>
                  </tr>
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="p-10 text-center">
                      <Users
                        size={48}
                        className="mx-auto text-slate-300 mb-3"
                      />
                      <p className="font-medium text-slate-600">
                        No customers yet
                      </p>
                      <p className="text-sm text-slate-400 mt-1">
                        Add your first customer to get started.
                      </p>
                    </td>
                  </tr>
                ) : (
                  customers.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => openDetail(c)}
                      className={`hover:bg-blue-50/40 cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? "bg-blue-50 border-l-2 border-blue-500" : ""}`}
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="font-semibold text-slate-800">
                            {c.name}
                          </span>
                        </div>
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {c.mobile || (
                          <span className="italic text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-4 text-sm text-slate-600">
                        {c.email || (
                          <span className="italic text-slate-400">—</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full text-xs font-bold flex items-center justify-center gap-1 mx-auto w-fit">
                          <Gift size={12} /> {c.loyalty_points || 0}
                        </span>
                      </td>
                      <td className="p-4 text-right text-sm font-semibold text-emerald-700">
                        {(c.balance || 0) > 0 ? `PKRs ${(c.balance).toFixed(2)}` : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-4 text-center">
                        <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                          {c.order_count}
                        </span>
                      </td>
                      <td className="p-4 text-right font-bold text-slate-900">
                        {fmt(c.total_spent)}
                      </td>
                      <td className="p-4 text-sm text-slate-500">
                        {fmtDate(c.created_at)}
                      </td>
                      <td className="p-4">
                        <div
                          className="flex items-center justify-center gap-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => openEdit(c)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(c)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedCustomer && (
          <div className="w-80 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
              <h2 className="font-bold text-slate-800">Customer Profile</h2>
              <button
                onClick={() => setSelectedCustomer(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Avatar + name */}
              <div className="text-center py-4">
                <div className="w-16 h-16 rounded-full bg-linear-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-2xl font-bold mx-auto mb-3">
                  {selectedCustomer.name.charAt(0).toUpperCase()}
                </div>
                <h3 className="font-bold text-slate-900 text-lg">
                  {selectedCustomer.name}
                </h3>
                <p className="text-sm text-slate-500">
                  Customer since {fmtDate(selectedCustomer.created_at)}
                </p>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="bg-blue-50 rounded-xl p-3 text-center">
                  <ShoppingBag
                    size={16}
                    className="mx-auto text-blue-600 mb-1"
                  />
                  <p className="text-xl font-bold text-blue-900">
                    {selectedCustomer.order_count}
                  </p>
                  <p className="text-xs text-blue-600">Orders</p>
                </div>
                <div className="bg-green-50 rounded-xl p-3 text-center">
                  <DollarSign
                    size={16}
                    className="mx-auto text-green-600 mb-1"
                  />
                  <p className="text-xl font-bold text-green-900">
                    {fmt(selectedCustomer.total_spent)}
                  </p>
                  <p className="text-xs text-green-600">Total Spent</p>
                </div>
              </div>

              {/* Loyalty Points Edit */}
              <div className="bg-purple-50 rounded-xl p-4 border border-purple-100">
                <div className="flex items-center gap-2 mb-3">
                  <Gift size={16} className="text-purple-600" />
                  <h4 className="font-bold text-purple-900 text-sm">
                    Loyalty Points
                  </h4>
                </div>
                <form onSubmit={handleAdjustPoints} className="flex gap-2">
                  <input
                    type="number"
                    className="w-full px-3 py-1.5 border border-purple-200 rounded-lg text-sm bg-white focus:outline-none focus:border-purple-500 font-bold text-purple-900"
                    value={pointsAdjust}
                    onChange={(e) => setPointsAdjust(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={
                      isAdjustingPoints ||
                      pointsAdjust === "" ||
                      parseInt(pointsAdjust) === selectedCustomer.loyalty_points
                    }
                    className="bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    Set
                  </button>
                </form>
              </div>

              {/* Wallet */}
              <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Wallet size={16} className="text-emerald-600" />
                    <h4 className="font-bold text-emerald-900 text-sm">Store Wallet</h4>
                  </div>
                  <span className="text-lg font-black text-emerald-700">PKRs {walletBalance.toFixed(2)}</span>
                </div>
                <form onSubmit={handleWalletTopup} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="Amount"
                      className="w-full px-3 py-1.5 border border-emerald-200 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-500"
                      value={walletTopup}
                      onChange={(e) => setWalletTopup(e.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={isTopingUp || !walletTopup || parseFloat(walletTopup) <= 0}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      Top Up
                    </button>
                  </div>
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    className="w-full px-3 py-1.5 border border-emerald-200 rounded-lg text-sm bg-white focus:outline-none focus:border-emerald-500"
                    value={walletNote}
                    onChange={(e) => setWalletNote(e.target.value)}
                  />
                </form>
              </div>

              {/* Contact details */}
              <div className="space-y-2">
                {selectedCustomer.mobile && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Phone size={14} className="text-slate-400 shrink-0" />
                    {selectedCustomer.mobile}
                  </div>
                )}
                {selectedCustomer.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Mail size={14} className="text-slate-400 shrink-0" />
                    {selectedCustomer.email}
                  </div>
                )}
                {selectedCustomer.address && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <MapPin size={14} className="text-slate-400 shrink-0" />
                    {selectedCustomer.address}
                  </div>
                )}
              </div>

              {/* Purchase history */}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Recent Purchases
                </h4>
                {salesLoading ? (
                  <p className="text-sm text-slate-400 text-center py-4">
                    Loading...
                  </p>
                ) : customerSales.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4 italic">
                    No purchases yet
                  </p>
                ) : (
                  customerSales.slice(0, 10).map((s) => (
                    <div
                      key={s.id}
                      className="flex justify-between items-center py-2 border-b border-slate-100 last:border-0"
                    >
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          #{s.id}
                        </p>
                        <p className="text-xs text-slate-400">
                          {new Date(s.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="text-sm font-bold text-slate-900">
                        {fmt(s.total_amount)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">
                {editingCustomer ? "Edit Customer" : "New Customer"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {formError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {formError}
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Full Name *
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. John Doe"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Mobile
                  </label>
                  <input
                    type="tel"
                    placeholder="+1 234 567 8900"
                    value={form.mobile}
                    onChange={(e) =>
                      setForm({ ...form, mobile: e.target.value })
                    }
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="email@example.com"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Address
                </label>
                <input
                  type="text"
                  placeholder="Street, City"
                  value={form.address}
                  onChange={(e) =>
                    setForm({ ...form, address: e.target.value })
                  }
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    CNIC
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 42301-1234567-1"
                    value={form.cnic}
                    onChange={(e) => setForm({ ...form, cnic: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Occupation
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Teacher"
                    value={form.occupation}
                    onChange={(e) =>
                      setForm({ ...form, occupation: e.target.value })
                    }
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {isSaving
                    ? "Saving..."
                    : editingCustomer
                      ? "Save Changes"
                      : "Add Customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
