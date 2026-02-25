import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  Plus,
  ChevronDown,
  Building2,
  User,
  DollarSign,
  Clock,
  CheckCircle2,
  AlertTriangle,
  X,
  Calculator,
  Download,
  Filter,
} from "lucide-react";

const API = "http://localhost:5000";
const fmt = (n) => "$" + (n ?? 0).toFixed(2);
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// PKR note/coin denominations (descending)
const DENOMS = [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1];

function makeDenomState() {
  return DENOMS.map((d) => ({ denomination: d, count: 0 }));
}

function VarianceBadge({ variance }) {
  if (variance === null || variance === undefined)
    return <span className="text-slate-400 italic text-sm">—</span>;
  const v = parseFloat(variance);
  if (v === 0)
    return <span className="text-slate-600 font-semibold text-sm">$0.00</span>;
  return (
    <span className={`font-bold text-sm ${v > 0 ? "text-green-600" : "text-red-600"}`}>
      {v > 0 ? "+" : ""}
      {fmt(v)}
    </span>
  );
}

export default function CashManagement() {
  const [shifts, setShifts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [varianceReasons, setVarianceReasons] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [activeShift, setActiveShift] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [historyFilter, setHistoryFilter] = useState("all");

  // Open shift modal
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [openForm, setOpenForm] = useState({ opening_float: "", employee_id: "" });
  const [openError, setOpenError] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  // Close shift modal
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [denomCounts, setDenomCounts] = useState(makeDenomState());
  const [closeNotes, setCloseNotes] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [varianceApprovedBy, setVarianceApprovedBy] = useState("");
  const [closeResult, setCloseResult] = useState(null);
  const [closeError, setCloseError] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  // Denomination detail panel for closed shifts
  const [denomDetail, setDenomDetail] = useState(null); // { shiftId, rows }

  const closingCash = denomCounts.reduce((s, d) => s + d.denomination * d.count, 0);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [shiftRes, outRes, empRes, reasonRes] = await Promise.all([
        fetch(`${API}/api/shifts`),
        fetch(`${API}/api/outlets`),
        fetch(`${API}/api/employees`),
        fetch(`${API}/api/variance-reasons`),
      ]);
      const [shiftData, outData, empData, reasonData] = await Promise.all([
        shiftRes.json(), outRes.json(), empRes.json(), reasonRes.json(),
      ]);
      setShifts(shiftData.shifts || []);
      const outList = outData.outlets || [];
      setOutlets(outList);
      setEmployees(empData.employees || []);
      setVarianceReasons(reasonData.reasons || []);
      if (!selectedOutlet && outList.length > 0)
        setSelectedOutlet(String(outList[0].id));
    } catch {
      console.error("Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedOutlet]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!selectedOutlet) return;
    fetch(`${API}/api/shifts/active?outlet_id=${selectedOutlet}`)
      .then((r) => r.json())
      .then((d) => setActiveShift(d.shift || null))
      .catch(() => setActiveShift(null));
  }, [selectedOutlet, shifts]);

  const handleOpenShift = async (e) => {
    e.preventDefault();
    setOpenError("");
    setIsOpening(true);
    try {
      const res = await fetch(`${API}/api/shifts/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outlet_id: parseInt(selectedOutlet),
          employee_id: openForm.employee_id ? parseInt(openForm.employee_id) : null,
          opening_float: parseFloat(openForm.opening_float) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setOpenError(data.error || "Failed to open shift"); return; }
      setIsOpenModalOpen(false);
      setOpenForm({ opening_float: "", employee_id: "" });
      fetchData();
    } catch {
      setOpenError("Connection failed.");
    } finally {
      setIsOpening(false);
    }
  };

  const handleCloseShift = async (e) => {
    e.preventDefault();
    setCloseError("");
    setIsClosing(true);
    try {
      const res = await fetch(`${API}/api/shifts/${activeShift.id}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closing_cash: closingCash,
          notes: closeNotes || null,
          variance_reason: varianceReason || null,
          variance_approved_by: varianceApprovedBy || null,
          denominations: denomCounts.filter((d) => d.count > 0),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setCloseError(data.error || "Failed to close shift"); return; }
      setCloseResult(data);
      fetchData();
    } catch {
      setCloseError("Connection failed.");
    } finally {
      setIsClosing(false);
    }
  };

  const updateDenomCount = (idx, value) => {
    const n = Math.max(0, parseInt(value) || 0);
    setDenomCounts((prev) => prev.map((d, i) => i === idx ? { ...d, count: n } : d));
  };

  const openCloseModal = () => {
    setDenomCounts(makeDenomState());
    setCloseNotes("");
    setVarianceReason("");
    setVarianceApprovedBy("");
    setCloseResult(null);
    setCloseError("");
    setIsCloseModalOpen(true);
  };

  const loadDenomDetail = async (shift) => {
    if (shift.status !== "closed") return;
    try {
      const res = await fetch(`${API}/api/shifts/${shift.id}/denominations`);
      const data = await res.json();
      if (data.denominations && data.denominations.length > 0)
        setDenomDetail({ shiftId: shift.id, rows: data.denominations, shift });
    } catch { /* ignore */ }
  };

  const filteredShifts = selectedOutlet
    ? shifts.filter((s) => String(s.outlet_id) === selectedOutlet)
    : shifts;
  const visibleShifts = filteredShifts.filter((s) => {
    if (historyFilter === "all") return true;
    return String(s.status || "").toLowerCase() === historyFilter;
  });

  const totalSaleCash = filteredShifts.reduce((sum, s) => sum + Number(s.total_cash_sales || 0), 0);
  const totalCashIn = filteredShifts.reduce((sum, s) => sum + Number(s.opening_float || 0), 0);
  const totalCashOut = filteredShifts.reduce((sum, s) => sum + Math.max(0, -Number(s.variance || 0)), 0);
  const totalCashInHand = filteredShifts.reduce((sum, s) => sum + Number(s.closing_cash || 0), 0);

  const exportCsv = () => {
    if (!visibleShifts.length) return;
    const headers = ["opened_at", "closed_at", "outlet", "cashier", "opening_float", "expected_cash", "closing_cash", "variance", "status"];
    const rows = visibleShifts.map((s) => [
      s.opened_at || "",
      s.closed_at || "",
      s.outlet_name || "",
      s.employee_name || "",
      s.opening_float || 0,
      s.expected_cash || 0,
      s.closing_cash || 0,
      s.variance || 0,
      s.status || "",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cash_management_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // For close result: compute variance after result is set
  const resultVariance = closeResult ? parseFloat(closeResult.variance) : 0;

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">Cash Management</h1>
          <p className="text-slate-500">Manage cash drawer shifts, opening floats, and end-of-day reconciliation.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 bg-[#7B61FF]/10 hover:bg-[#7B61FF]/20 text-[#6a50e5] px-4 py-2 rounded-lg text-sm font-semibold"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={() => {
              setOpenForm({ opening_float: "", employee_id: "" });
              setOpenError("");
              setIsOpenModalOpen(true);
            }}
            className="inline-flex items-center gap-2 bg-[#7B61FF] hover:bg-[#6a50e5] text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            <Plus size={14} /> Add Cash
          </button>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <Building2 size={16} className="text-slate-400" />
            <select value={selectedOutlet} onChange={(e) => setSelectedOutlet(e.target.value)}
              className="text-sm font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer pr-2">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        {[
          ["Total Sale Cash", totalSaleCash],
          ["Total Customer Balance", 0],
          ["Cash In", totalCashIn],
          ["Cash Out", totalCashOut],
          ["Cash In Hand", totalCashInHand],
        ].map(([label, value]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-2xl font-bold text-slate-800 mt-1">{fmt(Number(value || 0))}</p>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 text-sm font-semibold"
          onClick={() => setHistoryFilter((prev) => (prev === "all" ? "open" : prev === "open" ? "closed" : "all"))}
        >
          <Filter size={14} /> Filter ({historyFilter})
        </button>
      </div>

      {/* Active Shift Card */}
      <div className={`rounded-2xl border-2 p-6 shadow-sm transition-all ${activeShift ? "border-green-300 bg-green-50" : "border-dashed border-slate-300 bg-slate-50"}`}>
        {activeShift ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="bg-green-100 rounded-xl p-3"><CheckCircle2 size={28} className="text-green-600" /></div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg font-bold text-green-800">Shift Open</span>
                  <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full font-semibold">ACTIVE</span>
                </div>
                <div className="grid grid-cols-3 gap-6 mt-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Opening Float</p>
                    <p className="text-xl font-bold text-slate-800">{fmt(activeShift.opening_float)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Opened By</p>
                    <p className="font-semibold text-slate-700">{activeShift.employee_name || "Admin"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Opened At</p>
                    <p className="font-semibold text-slate-700">{fmtDate(activeShift.opened_at)}</p>
                  </div>
                </div>
              </div>
            </div>
            <button onClick={openCloseModal}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-sm transition-colors flex items-center gap-2 shrink-0">
              <X size={16} /> Close Shift
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-slate-200 rounded-xl p-3"><Wallet size={28} className="text-slate-500" /></div>
              <div>
                <p className="font-bold text-slate-600 text-lg">No Active Shift</p>
                <p className="text-slate-500 text-sm mt-0.5">Open a shift to track cash drawer activity for this outlet.</p>
              </div>
            </div>
            {selectedOutlet && (
              <button onClick={() => { setOpenForm({ opening_float: "", employee_id: "" }); setOpenError(""); setIsOpenModalOpen(true); }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-sm transition-colors flex items-center gap-2">
                <Plus size={16} /> Open Shift
              </button>
            )}
          </div>
        )}
      </div>

      {/* Shift History Table */}
      <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h2 className="font-bold text-slate-700">Shift History</h2>
        </div>
        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500 font-semibold sticky top-0 z-10">
                <th className="p-4">Opened At</th>
                <th className="p-4">Closed At</th>
                <th className="p-4">Outlet</th>
                <th className="p-4">Cashier</th>
                <th className="p-4 text-right">Opening Float</th>
                <th className="p-4 text-right">Expected</th>
                <th className="p-4 text-right">Actual</th>
                <th className="p-4 text-right">Variance</th>
                <th className="p-4">Reason</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan="10" className="p-8 text-center text-slate-400">Loading shifts...</td></tr>
              ) : visibleShifts.length === 0 ? (
                <tr><td colSpan="10" className="p-10 text-center">
                  <Clock size={48} className="mx-auto text-slate-300 mb-3" />
                  <p className="font-medium text-slate-600">No shifts yet</p>
                  <p className="text-sm text-slate-400 mt-1">Open a shift to start tracking cash.</p>
                </td></tr>
              ) : visibleShifts.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-4 text-sm text-slate-600 whitespace-nowrap">{fmtDate(s.opened_at)}</td>
                  <td className="p-4 text-sm text-slate-600 whitespace-nowrap">{fmtDate(s.closed_at)}</td>
                  <td className="p-4 text-sm font-medium text-slate-800">{s.outlet_name}</td>
                  <td className="p-4 text-sm text-slate-600">{s.employee_name || "Admin"}</td>
                  <td className="p-4 text-sm text-right font-medium text-slate-800">{fmt(s.opening_float)}</td>
                  <td className="p-4 text-sm text-right text-slate-600">{s.expected_cash != null ? fmt(s.expected_cash) : "—"}</td>
                  <td className="p-4 text-sm text-right text-slate-600">
                    {s.closing_cash != null ? (
                      <button onClick={() => loadDenomDetail(s)} className="hover:underline text-blue-600 font-medium" title="View denomination breakdown">
                        {fmt(s.closing_cash)}
                      </button>
                    ) : "—"}
                  </td>
                  <td className="p-4 text-right"><VarianceBadge variance={s.variance} /></td>
                  <td className="p-4 text-xs text-slate-500 max-w-30 truncate">{s.variance_reason || "—"}</td>
                  <td className="p-4">
                    {s.status === "open" ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">Open</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">Closed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Open Shift Modal */}
      {isOpenModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Wallet size={20} /> Open Shift</h2>
                <p className="text-sm text-slate-500 mt-0.5">Count the opening cash float</p>
              </div>
              <button onClick={() => setIsOpenModalOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleOpenShift} className="p-6 space-y-4">
              {openError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{openError}</div>}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Opening Float (Cash in Drawer)</label>
                <div className="relative">
                  <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="number" required min="0" step="0.01" placeholder="0.00"
                    value={openForm.opening_float}
                    onChange={(e) => setOpenForm({ ...openForm, opening_float: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Cashier <span className="font-normal text-slate-400">(optional)</span></label>
                <div className="relative">
                  <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select value={openForm.employee_id} onChange={(e) => setOpenForm({ ...openForm, employee_id: e.target.value })}
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white text-sm">
                    <option value="">Select cashier...</option>
                    {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsOpenModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" disabled={isOpening}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                  <Plus size={16} /> {isOpening ? "Opening..." : "Open Shift"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Shift Modal — with denomination grid */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden max-h-[95vh] flex flex-col">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Calculator size={18} /> Close Shift</h2>
                <p className="text-sm text-slate-500 mt-0.5">Count notes and coins in the drawer</p>
              </div>
              <button onClick={() => { setIsCloseModalOpen(false); setCloseResult(null); }}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {closeResult ? (
                /* ── Result Panel ── */
                <div className="p-6 space-y-4">
                  <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Opening Float</span>
                      <span className="font-semibold">{fmt(closeResult.opening_float)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Cash Sales</span>
                      <span className="font-semibold text-green-600">+{fmt(closeResult.cash_sales)}</span>
                    </div>
                    {parseFloat(closeResult.cash_refunds || 0) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Cash Refunds</span>
                        <span className="font-semibold text-red-600">−{fmt(closeResult.cash_refunds)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-slate-200 pt-2">
                      <span className="text-slate-700 font-semibold">Expected</span>
                      <span className="font-bold">{fmt(closeResult.expected_cash)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-700 font-semibold">Counted (Actual)</span>
                      <span className="font-bold">{fmt(closeResult.closing_cash)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-2">
                      <span className="font-bold text-slate-800">Variance</span>
                      <VarianceBadge variance={closeResult.variance} />
                    </div>
                    {closeResult.variance_reason && (
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Reason</span>
                        <span className="text-slate-700">{closeResult.variance_reason}</span>
                      </div>
                    )}
                  </div>
                  {resultVariance !== 0 && (
                    <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${resultVariance > 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                      {resultVariance > 0 ? "Cash over — check for any unrecorded transactions." : "Cash short — investigate before banking."}
                    </div>
                  )}
                  <button onClick={() => { setIsCloseModalOpen(false); setCloseResult(null); }}
                    className="w-full py-2.5 bg-slate-800 text-white rounded-lg font-medium text-sm hover:bg-slate-900 transition-colors">Done</button>
                </div>
              ) : (
                /* ── Denomination Entry Form ── */
                <form onSubmit={handleCloseShift} className="p-5 space-y-4">
                  {closeError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{closeError}</div>
                  )}

                  {/* Denomination grid */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-semibold text-slate-700">Count by Denomination</label>
                      <span className="text-xs text-slate-400">Enter number of each note/coin</span>
                    </div>
                    <div className="border rounded-xl overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Denomination</th>
                            <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Count</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Subtotal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {denomCounts.map((d, i) => (
                            <tr key={d.denomination} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 font-mono font-semibold text-slate-700">
                                PKR {d.denomination >= 1 ? d.denomination.toLocaleString() : d.denomination}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <input
                                  type="number" min="0" max="9999" value={d.count || ""}
                                  placeholder="0"
                                  onChange={(e) => updateDenomCount(i, e.target.value)}
                                  className="w-20 text-center border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                                {d.count > 0 ? `PKR ${(d.denomination * d.count).toLocaleString()}` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="bg-blue-50 border-t-2 border-blue-200">
                          <tr>
                            <td colSpan={2} className="px-3 py-2 font-bold text-blue-800 text-sm">Total Counted</td>
                            <td className="px-3 py-2 text-right font-bold text-blue-800 text-base font-mono">
                              PKR {closingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Variance reason — show proactively since we don't know variance yet */}
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Variance Reason <span className="font-normal text-slate-400">(if applicable)</span>
                    </label>
                    <select value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white">
                      <option value="">— None / No variance —</option>
                      {varianceReasons.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>

                  {varianceReason && (
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Approved By</label>
                      <input value={varianceApprovedBy} onChange={(e) => setVarianceApprovedBy(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        placeholder="Manager name" />
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                      Notes <span className="font-normal text-slate-400">(optional)</span>
                    </label>
                    <textarea rows="2" placeholder="Any issues or comments..."
                      value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm resize-none" />
                  </div>

                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => setIsCloseModalOpen(false)}
                      className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors">Cancel</button>
                    <button type="submit" disabled={isClosing}
                      className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
                      {isClosing ? "Closing..." : `Close & Reconcile (PKR ${closingCash.toLocaleString()})`}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Denomination Breakdown Detail Panel */}
      {denomDetail && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Denomination Breakdown</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Shift #{denomDetail.shiftId} · {fmtDate(denomDetail.shift?.closed_at)}
                </p>
              </div>
              <button onClick={() => setDenomDetail(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg">
                <X size={16} />
              </button>
            </div>
            <div className="p-5">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Denomination</th>
                    <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Count</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {denomDetail.rows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-700">PKR {r.denomination}</td>
                      <td className="px-3 py-2 text-center text-slate-600">{r.count}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-700">PKR {r.subtotal.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2">
                  <tr>
                    <td colSpan={2} className="px-3 py-2 font-bold text-slate-700">Total</td>
                    <td className="px-3 py-2 text-right font-bold text-slate-800 font-mono">
                      PKR {denomDetail.rows.reduce((s, r) => s + r.subtotal, 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
              {denomDetail.shift?.variance_reason && (
                <div className="mt-4 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800">
                  <strong>Variance reason:</strong> {denomDetail.shift.variance_reason}
                  {denomDetail.shift.variance_approved_by && ` · Approved by: ${denomDetail.shift.variance_approved_by}`}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
