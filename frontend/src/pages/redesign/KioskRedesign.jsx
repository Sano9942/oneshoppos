import { useState, useEffect, useCallback } from "react";
import { API_BASE } from "../../config";

const API = `${API_BASE}/api`;

// Format decimal hours to "Xh Ym"
const fmtDuration = (hours) => {
  if (!hours && hours !== 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

// Format a datetime string to "9:04 AM"
const fmtTime = (dt) => {
  if (!dt) return "";
  return new Date(dt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// Elapsed time from a start datetime to now as "Xh Ym" or "Xm"
const fmtElapsed = (start) => {
  if (!start) return "";
  const mins = Math.round((Date.now() - new Date(start)) / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
};

const BREAK_REASONS = [
  { key: "lunch", label: "Lunch" },
  { key: "prayer", label: "Prayer" },
  { key: "bathroom", label: "Bathroom" },
  { key: "personal", label: "Personal" },
  { key: "other", label: "Other" },
];

export default function KioskRedesign() {
  // ── Outlet selection ──
  const [outlets, setOutlets] = useState([]);
  const [outlet, setOutlet] = useState(null); // { id, name }

  // ── View state machine ──
  const [view, setView] = useState("idle"); // "idle" | "status" | "break_select" | "confirmation"

  // ── PIN input ──
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // ── Employee / today data ──
  const [employee, setEmployee] = useState(null);
  const [todayStatus, setTodayStatus] = useState(null); // response from pin-status

  // ── Confirmation banner ──
  const [confirm, setConfirm] = useState({ title: "", body: "", color: "emerald" });

  // ── Clock for idle screen ──
  const [clock, setClock] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load outlets on mount
  useEffect(() => {
    fetch(`${API}/outlets`)
      .then((r) => r.json())
      .then((d) => setOutlets(d.outlets || []))
      .catch(() => {});
  }, []);

  // Auto-reset from confirmation screen after 5 seconds
  useEffect(() => {
    if (view !== "confirmation") return;
    const t = setTimeout(() => resetToIdle(), 5000);
    return () => clearTimeout(t);
  }, [view]);

  const resetToIdle = () => {
    setView("idle");
    setPin("");
    setEmployee(null);
    setTodayStatus(null);
    setError("");
    setConfirm({ title: "", body: "", color: "emerald" });
  };

  // PIN pad handlers
  const appendDigit = (d) => {
    if (pin.length >= 8) return;
    setError("");
    setPin((p) => p + d);
  };
  const backspace = () => setPin((p) => p.slice(0, -1));

  const submitPin = useCallback(async () => {
    if (!pin) return;
    if (!outlet) { setError("Please select a store first"); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/attendance/pin-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: pin }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Invalid PIN"); setPin(""); return; }
      setEmployee(data.employee);
      setTodayStatus(data);
      setView("status");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }, [pin, outlet]);

  // Clock In
  const clockIn = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/attendance/pin-checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: pin, outlet_id: outlet.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      const isReturn = todayStatus?.status === "on_break";
      if (isReturn) {
        const breakDuration = todayStatus.current_session
          ? fmtElapsed(todayStatus.current_session.session_start)
          : "";
        setConfirm({
          title: `Welcome back, ${data.employee.name}!`,
          body: breakDuration ? `Break was ${breakDuration}.` : "",
          color: "emerald",
        });
      } else {
        setConfirm({
          title: `Welcome, ${data.employee.name}!`,
          body: `Clocked in at ${fmtTime(new Date().toISOString())}`,
          color: "emerald",
        });
      }
      setView("confirmation");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  // Go on break
  const goOnBreak = (breakReason) => async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/attendance/pin-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: pin, break_reason: breakReason }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      const reasonLabel = BREAK_REASONS.find((r) => r.key === breakReason)?.label || breakReason;
      setConfirm({
        title: `${reasonLabel} break started`,
        body: data.message || `You've worked ${fmtDuration(data.net_work_hours_today)} today.`,
        color: "amber",
      });
      setView("confirmation");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  // End of day
  const endOfDay = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/attendance/pin-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin_code: pin, break_reason: null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Failed"); return; }
      setConfirm({
        title: `Goodbye, ${employee.name}!`,
        body: data.message || `You worked ${fmtDuration(data.net_work_hours_today)} today.`,
        color: "blue",
      });
      setView("confirmation");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  };

  // ── Render helpers ──────────────────────────────────────────────────────────

  const PinDots = () => (
    <div className="flex gap-3 justify-center mb-6">
      {Array.from({ length: Math.max(pin.length, 4) }).map((_, i) => (
        <div
          key={i}
          className={`w-4 h-4 rounded-full border-2 transition-all ${
            i < pin.length
              ? "bg-white border-white"
              : "bg-transparent border-slate-500"
          }`}
        />
      ))}
    </div>
  );

  const PinPad = () => (
    <div className="flex flex-col items-center gap-2">
      <PinDots />
      {error && (
        <p className="text-red-400 text-sm mb-2 text-center">{error}</p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button
            key={d}
            onClick={() => appendDigit(String(d))}
            disabled={loading}
            className="w-20 h-20 text-2xl font-bold rounded-2xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-50 select-none"
          >
            {d}
          </button>
        ))}
        <button
          onClick={backspace}
          disabled={loading}
          className="w-20 h-20 text-xl font-bold rounded-2xl bg-slate-600 text-slate-300 hover:bg-slate-500 active:scale-95 transition-all disabled:opacity-50 select-none"
        >
          ←
        </button>
        <button
          onClick={() => appendDigit("0")}
          disabled={loading}
          className="w-20 h-20 text-2xl font-bold rounded-2xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95 transition-all disabled:opacity-50 select-none"
        >
          0
        </button>
        <button
          onClick={submitPin}
          disabled={loading || !pin}
          className="w-20 h-20 text-xl font-bold rounded-2xl bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-40 select-none"
        >
          {loading ? "…" : "✓"}
        </button>
      </div>
    </div>
  );

  // ── Views ───────────────────────────────────────────────────────────────────

  // IDLE — PIN entry screen
  if (view === "idle") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white px-4">
        {/* Header: outlet selector + clock */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm">Store:</span>
            {outlet ? (
              <span className="font-semibold text-white">{outlet.name}</span>
            ) : null}
            <select
              value={outlet?.id || ""}
              onChange={(e) => {
                const found = outlets.find((o) => o.id === Number(e.target.value));
                setOutlet(found || null);
              }}
              className={`bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-1.5 text-sm ${
                outlet ? "text-slate-400" : "text-white"
              }`}
            >
              <option value="">Select your store…</option>
              {outlets.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="text-right">
            <p className="text-2xl font-mono font-semibold text-white">
              {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-xs text-slate-400">
              {clock.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
        </div>

        {/* PIN pad */}
        <div className="flex flex-col items-center">
          <h1 className="text-3xl font-bold text-white mb-2">Employee Clock-In</h1>
          <p className="text-slate-400 mb-8 text-center">Enter your PIN to clock in or out</p>
          <PinPad />
        </div>
      </div>
    );
  }

  // STATUS — show employee's current state + action buttons
  if (view === "status") {
    const s = todayStatus?.status;
    const netHours = todayStatus?.net_work_hours_today ?? 0;
    const session = todayStatus?.current_session;

    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white px-4">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          {/* Employee card */}
          <div className="w-full bg-slate-800 rounded-2xl p-6 text-center border border-slate-700">
            <div className="w-16 h-16 rounded-full bg-slate-600 flex items-center justify-center text-3xl font-bold mx-auto mb-3">
              {employee?.name?.[0]?.toUpperCase()}
            </div>
            <h2 className="text-2xl font-bold text-white">{employee?.name}</h2>

            {s === "not_clocked_in" && (
              <p className="text-slate-400 mt-1">Not clocked in today</p>
            )}
            {s === "clocked_in" && (
              <>
                <p className="text-emerald-400 font-semibold mt-1">
                  Clocked In — {session ? fmtElapsed(session.session_start) : ""}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {fmtDuration(netHours)} worked today
                </p>
              </>
            )}
            {s === "on_break" && (
              <>
                <p className="text-amber-400 font-semibold mt-1 capitalize">
                  On {session?.break_reason || "Break"} — {session ? fmtElapsed(session.session_start) : ""}
                </p>
                <p className="text-slate-400 text-sm mt-1">
                  {fmtDuration(netHours)} worked today
                </p>
              </>
            )}
            {s === "clocked_out" && (
              <p className="text-blue-400 font-semibold mt-1">
                Finished today — {fmtDuration(netHours)} worked
              </p>
            )}
          </div>

          {/* Action buttons */}
          {s === "not_clocked_in" && (
            <button
              onClick={clockIn}
              disabled={loading}
              className="w-full py-5 text-xl font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? "Please wait…" : "Clock In"}
            </button>
          )}

          {s === "clocked_in" && (
            <>
              <button
                onClick={() => setView("break_select")}
                disabled={loading}
                className="w-full py-5 text-xl font-bold rounded-2xl bg-amber-500 hover:bg-amber-400 active:scale-95 transition-all disabled:opacity-50"
              >
                Go on Break
              </button>
              <button
                onClick={endOfDay}
                disabled={loading}
                className="w-full py-4 text-lg font-bold rounded-2xl bg-slate-600 hover:bg-slate-500 active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? "Please wait…" : "End of Day Clock Out"}
              </button>
            </>
          )}

          {s === "on_break" && (
            <button
              onClick={clockIn}
              disabled={loading}
              className="w-full py-5 text-xl font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? "Please wait…" : "Clock Back In"}
            </button>
          )}

          {s === "clocked_out" && (
            <button
              onClick={resetToIdle}
              className="w-full py-4 text-lg font-bold rounded-2xl bg-slate-700 hover:bg-slate-600 active:scale-95 transition-all"
            >
              Done
            </button>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button
            onClick={resetToIdle}
            className="text-slate-500 text-sm hover:text-slate-400 mt-2"
          >
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // BREAK SELECT — reason picker
  if (view === "break_select") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white px-4">
        <div className="w-full max-w-sm flex flex-col items-center gap-4">
          <h2 className="text-2xl font-bold text-white mb-2">Select Break Reason</h2>
          <div className="w-full grid grid-cols-2 gap-3">
            {BREAK_REASONS.map((r) => (
              <button
                key={r.key}
                onClick={goOnBreak(r.key)}
                disabled={loading}
                className="py-5 text-lg font-bold rounded-2xl bg-slate-700 hover:bg-amber-600 active:scale-95 transition-all disabled:opacity-50"
              >
                {r.label}
              </button>
            ))}
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            onClick={() => setView("status")}
            className="text-slate-500 text-sm hover:text-slate-400 mt-2"
          >
            ← Cancel
          </button>
        </div>
      </div>
    );
  }

  // CONFIRMATION — full-screen colored banner
  const colorMap = {
    emerald: "bg-emerald-700",
    amber: "bg-amber-600",
    blue: "bg-blue-700",
  };

  return (
    <div
      className={`min-h-screen w-full flex flex-col items-center justify-center text-white px-4 ${
        colorMap[confirm.color] || "bg-slate-800"
      }`}
    >
      <div className="text-center">
        <p className="text-5xl font-bold mb-4">{confirm.title}</p>
        {confirm.body && (
          <p className="text-2xl text-white/80">{confirm.body}</p>
        )}
        <p className="text-white/50 mt-8 text-sm">Returning in 5 seconds…</p>
      </div>
    </div>
  );
}
