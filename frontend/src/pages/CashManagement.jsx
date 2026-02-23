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

function VarianceBadge({ variance }) {
  if (variance === null || variance === undefined)
    return <span className="text-slate-400 italic text-sm">—</span>;
  const v = parseFloat(variance);
  if (v === 0)
    return <span className="text-slate-600 font-semibold text-sm">$0.00</span>;
  return (
    <span
      className={`font-bold text-sm ${v > 0 ? "text-green-600" : "text-red-600"}`}
    >
      {v > 0 ? "+" : ""}
      {fmt(v)}
    </span>
  );
}

export default function CashManagement() {
  const [shifts, setShifts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [selectedOutlet, setSelectedOutlet] = useState("");
  const [activeShift, setActiveShift] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Open shift modal
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [openForm, setOpenForm] = useState({
    opening_float: "",
    employee_id: "",
  });
  const [openError, setOpenError] = useState("");
  const [isOpening, setIsOpening] = useState(false);

  // Close shift modal
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closeForm, setCloseForm] = useState({ closing_cash: "", notes: "" });
  const [closeResult, setCloseResult] = useState(null);
  const [closeError, setCloseError] = useState("");
  const [isClosing, setIsClosing] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [shiftRes, outRes, empRes] = await Promise.all([
        fetch(`${API}/api/shifts`),
        fetch(`${API}/api/outlets`),
        fetch(`${API}/api/employees`),
      ]);
      const [shiftData, outData, empData] = await Promise.all([
        shiftRes.json(),
        outRes.json(),
        empRes.json(),
      ]);
      setShifts(shiftData.shifts || []);
      const outList = outData.outlets || [];
      setOutlets(outList);
      setEmployees(empData.employees || []);
      if (!selectedOutlet && outList.length > 0)
        setSelectedOutlet(String(outList[0].id));
    } catch {
      console.error("Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [selectedOutlet]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch active shift whenever selected outlet changes
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
          employee_id: openForm.employee_id
            ? parseInt(openForm.employee_id)
            : null,
          opening_float: parseFloat(openForm.opening_float) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOpenError(data.error || "Failed to open shift");
        return;
      }
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
          closing_cash: parseFloat(closeForm.closing_cash) || 0,
          notes: closeForm.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloseError(data.error || "Failed to close shift");
        return;
      }
      setCloseResult(data);
      fetchData();
    } catch {
      setCloseError("Connection failed.");
    } finally {
      setIsClosing(false);
    }
  };

  const filteredShifts = selectedOutlet
    ? shifts.filter((s) => String(s.outlet_id) === selectedOutlet)
    : shifts;

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-1">
            Cash Management
          </h1>
          <p className="text-slate-500">
            Manage cash drawer shifts, opening floats, and end-of-day
            reconciliation.
          </p>
        </div>
        {/* Outlet selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
            <Building2 size={16} className="text-slate-400" />
            <select
              value={selectedOutlet}
              onChange={(e) => setSelectedOutlet(e.target.value)}
              className="text-sm font-semibold text-slate-700 bg-transparent focus:outline-none cursor-pointer pr-2"
            >
              <option value="">All Outlets</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="text-slate-400" />
          </div>
        </div>
      </div>

      {/* Active Shift Card */}
      <div
        className={`rounded-2xl border-2 p-6 shadow-sm transition-all ${activeShift ? "border-green-300 bg-green-50" : "border-dashed border-slate-300 bg-slate-50"}`}
      >
        {activeShift ? (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="bg-green-100 rounded-xl p-3">
                <CheckCircle2 size={28} className="text-green-600" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg font-bold text-green-800">
                    Shift Open
                  </span>
                  <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded-full font-semibold">
                    ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-6 mt-3">
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">
                      Opening Float
                    </p>
                    <p className="text-xl font-bold text-slate-800">
                      {fmt(activeShift.opening_float)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Opened By</p>
                    <p className="font-semibold text-slate-700">
                      {activeShift.employee_name || "Admin"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-0.5">Opened At</p>
                    <p className="font-semibold text-slate-700">
                      {fmtDate(activeShift.opened_at)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                setCloseForm({ closing_cash: "", notes: "" });
                setCloseResult(null);
                setCloseError("");
                setIsCloseModalOpen(true);
              }}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-sm transition-colors flex items-center gap-2 shrink-0"
            >
              <X size={16} /> Close Shift
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-slate-200 rounded-xl p-3">
                <Wallet size={28} className="text-slate-500" />
              </div>
              <div>
                <p className="font-bold text-slate-600 text-lg">
                  No Active Shift
                </p>
                <p className="text-slate-500 text-sm mt-0.5">
                  Open a shift to track cash drawer activity for this outlet.
                </p>
              </div>
            </div>
            {selectedOutlet && (
              <button
                onClick={() => {
                  setOpenForm({ opening_float: "", employee_id: "" });
                  setOpenError("");
                  setIsOpenModalOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium text-sm shadow-sm transition-colors flex items-center gap-2"
              >
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
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan="9" className="p-8 text-center text-slate-400">
                    Loading shifts...
                  </td>
                </tr>
              ) : filteredShifts.length === 0 ? (
                <tr>
                  <td colSpan="9" className="p-10 text-center">
                    <Clock size={48} className="mx-auto text-slate-300 mb-3" />
                    <p className="font-medium text-slate-600">No shifts yet</p>
                    <p className="text-sm text-slate-400 mt-1">
                      Open a shift to start tracking cash.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredShifts.map((s) => (
                  <tr
                    key={s.id}
                    className="hover:bg-slate-50/80 transition-colors"
                  >
                    <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                      {fmtDate(s.opened_at)}
                    </td>
                    <td className="p-4 text-sm text-slate-600 whitespace-nowrap">
                      {fmtDate(s.closed_at)}
                    </td>
                    <td className="p-4 text-sm font-medium text-slate-800">
                      {s.outlet_name}
                    </td>
                    <td className="p-4 text-sm text-slate-600">
                      {s.employee_name || "Admin"}
                    </td>
                    <td className="p-4 text-sm text-right font-medium text-slate-800">
                      {fmt(s.opening_float)}
                    </td>
                    <td className="p-4 text-sm text-right text-slate-600">
                      {s.expected_cash != null ? fmt(s.expected_cash) : "—"}
                    </td>
                    <td className="p-4 text-sm text-right text-slate-600">
                      {s.closing_cash != null ? fmt(s.closing_cash) : "—"}
                    </td>
                    <td className="p-4 text-right">
                      <VarianceBadge variance={s.variance} />
                    </td>
                    <td className="p-4">
                      {s.status === "open" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                          Open
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                          Closed
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
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
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Wallet size={20} /> Open Shift
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Count the opening cash float
                </p>
              </div>
              <button
                onClick={() => setIsOpenModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleOpenShift} className="p-6 space-y-4">
              {openError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                  {openError}
                </div>
              )}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Opening Float (Cash in Drawer)
                </label>
                <div className="relative">
                  <DollarSign
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={openForm.opening_float}
                    onChange={(e) =>
                      setOpenForm({
                        ...openForm,
                        opening_float: e.target.value,
                      })
                    }
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  Cashier{" "}
                  <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <div className="relative">
                  <User
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <select
                    value={openForm.employee_id}
                    onChange={(e) =>
                      setOpenForm({ ...openForm, employee_id: e.target.value })
                    }
                    className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white text-sm"
                  >
                    <option value="">Select cashier...</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsOpenModalOpen(false)}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isOpening}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> {isOpening ? "Opening..." : "Open Shift"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Close Shift Modal */}
      {isCloseModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
              <div>
                <h2 className="text-xl font-bold text-slate-800">
                  Close Shift
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  Count the cash in the drawer
                </p>
              </div>
              <button
                onClick={() => {
                  setIsCloseModalOpen(false);
                  setCloseResult(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {closeResult ? (
              <div className="p-6 space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Opening Float</span>
                    <span className="font-semibold">
                      {fmt(closeResult.opening_float)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cash Sales</span>
                    <span className="font-semibold text-green-600">
                      +{fmt(closeResult.cash_sales)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="text-slate-700 font-semibold">
                      Expected
                    </span>
                    <span className="font-bold">
                      {fmt(closeResult.expected_cash)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-700 font-semibold">Actual</span>
                    <span className="font-bold">
                      {fmt(closeResult.closing_cash)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2">
                    <span className="font-bold text-slate-800">Variance</span>
                    <VarianceBadge variance={closeResult.variance} />
                  </div>
                </div>
                {parseFloat(closeResult.variance) !== 0 && (
                  <div
                    className={`flex items-start gap-2 p-3 rounded-lg text-sm ${parseFloat(closeResult.variance) > 0 ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
                  >
                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                    {parseFloat(closeResult.variance) > 0
                      ? "Cash over — check for any unrecorded transactions."
                      : "Cash short — investigate before banking."}
                  </div>
                )}
                <button
                  onClick={() => {
                    setIsCloseModalOpen(false);
                    setCloseResult(null);
                  }}
                  className="w-full py-2.5 bg-slate-800 text-white rounded-lg font-medium text-sm hover:bg-slate-900 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCloseShift} className="p-6 space-y-4">
                {closeError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                    {closeError}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Actual Cash in Drawer
                  </label>
                  <div className="relative">
                    <DollarSign
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      autoFocus
                      value={closeForm.closing_cash}
                      onChange={(e) =>
                        setCloseForm({
                          ...closeForm,
                          closing_cash: e.target.value,
                        })
                      }
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    Notes{" "}
                    <span className="font-normal text-slate-400">
                      (optional)
                    </span>
                  </label>
                  <textarea
                    rows="2"
                    placeholder="Any issues or comments..."
                    value={closeForm.notes}
                    onChange={(e) =>
                      setCloseForm({ ...closeForm, notes: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm resize-none"
                  />
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsCloseModalOpen(false)}
                    className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg font-medium text-sm hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isClosing}
                    className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg font-medium text-sm hover:bg-red-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {isClosing ? "Closing..." : "Close & Reconcile"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
