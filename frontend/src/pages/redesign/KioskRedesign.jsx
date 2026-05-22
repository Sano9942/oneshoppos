import { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { readContext, readTenantSlug } from "../../auth/authStore";
import { parseLocalDate, fmtLocalTime } from "../../utils/dates";

const fmtDuration = (hours) => {
  if (!hours && hours !== 0) return "--";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${m}m`;
};

// session_start is LOCAL time — use parseLocalDate so browser doesn't treat it as UTC
const fmtTime = (dt) => fmtLocalTime(dt, { hour: "2-digit", minute: "2-digit" });

const fmtElapsed = (start) => {
  if (!start) return "";
  const mins = Math.round((Date.now() - parseLocalDate(start)) / 60000);
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

const KEYPAD_BTN =
  "w-20 h-20 text-2xl font-bold rounded-2xl bg-slate-700 text-white hover:bg-slate-600 active:scale-95 transition-transform duration-75 disabled:opacity-50 select-none cursor-pointer";
const KEYPAD_BTN_BACK =
  "w-20 h-20 text-xl font-bold rounded-2xl bg-slate-600 text-slate-300 hover:bg-slate-500 active:scale-95 transition-transform duration-75 disabled:opacity-50 select-none cursor-pointer";
const KEYPAD_BTN_OK =
  "w-20 h-20 text-xl font-bold rounded-2xl bg-emerald-600 text-white hover:bg-emerald-500 active:scale-95 transition-transform duration-75 disabled:opacity-40 select-none cursor-pointer";

function PinDots({ length }) {
  const total = Math.max(length, 4);
  return (
    <div className="flex gap-3 justify-center mb-6">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={`w-4 h-4 rounded-full border-2 ${
            i < length ? "bg-white border-white" : "bg-transparent border-slate-500"
          }`}
        />
      ))}
    </div>
  );
}

function PinPad({ pin, error, loading, onDigit, onBackspace, onSubmit }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <PinDots length={pin.length} />
      {error && <p className="text-red-400 text-sm mb-2 text-center">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} onClick={() => onDigit(String(d))} disabled={loading} className={KEYPAD_BTN}>
            {d}
          </button>
        ))}
        <button onClick={onBackspace} disabled={loading} className={KEYPAD_BTN_BACK}>
          Back
        </button>
        <button onClick={() => onDigit("0")} disabled={loading} className={KEYPAD_BTN}>
          0
        </button>
        <button onClick={onSubmit} disabled={loading || !pin} aria-label="Submit PIN" className={KEYPAD_BTN_OK}>
          {loading ? "..." : "OK"}
        </button>
      </div>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right">
      <p className="text-2xl font-mono font-semibold text-white">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
      <p className="text-xs text-slate-400">
        {now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
      </p>
    </div>
  );
}

export default function KioskRedesign() {
  const [searchParams] = useSearchParams();
  const [outlets, setOutlets] = useState([]);
  const [outlet, setOutlet] = useState(null);
  const [kioskLocked, setKioskLocked] = useState(false);

  const [view, setView] = useState("idle");

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [employee, setEmployee] = useState(null);
  const [todayStatus, setTodayStatus] = useState(null);

  const [confirm, setConfirm] = useState({ title: "", body: "", color: "emerald" });

  const urlOutletId = useMemo(() => {
    const v = searchParams.get("outlet");
    return v ? Number(v) : null;
  }, [searchParams]);

  useEffect(() => {
    const tenantSlug = searchParams.get("tenant") || readTenantSlug();
    const outletsQs = tenantSlug ? `?tenant=${tenantSlug}` : "";
    Promise.all([
      api.get(`/api/outlets${outletsQs}`),
      api.get(`/api/feature-flags${outletsQs}`).catch(() => ({ flags: [] })),
    ]).then(([outData, flagsData]) => {
      const outList = outData.outlets || [];
      setOutlets(outList);
      const locked = (flagsData.flags || []).some(
        (f) => f.key === "kiosk_context_locked" && Number(f.enabled) === 1,
      );
      setKioskLocked(locked);
      // Prefer URL outlet, otherwise inherit current app context outlet.
      const contextOutletId = Number(readContext()?.active_outlet_id || 0) || null;
      const preferredOutletId = urlOutletId || contextOutletId;
      if (preferredOutletId) {
        const match = outList.find((o) => o.id === preferredOutletId);
        if (match) setOutlet(match);
      }
    }).catch(() => {});
  }, [urlOutletId]);

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

  const appendDigit = (d) => {
    if (pin.length >= 8) return;
    setError("");
    setPin((p) => p + d);
  };
  const backspace = () => setPin((p) => p.slice(0, -1));

  const submitPin = useCallback(async () => {
    if (!pin) return;
    if (!outlet) {
      setError("Select a store before entering PIN");
      return;
    }
    setLoading(true);
    setError("");
    try {
      let data;
      try {
        data = await api.post("/api/attendance/pin-status", { pin_code: pin, outlet_id: outlet.id });
      } catch (err) {
        setError(err.body?.error || "Invalid PIN");
        setPin("");
        return;
      }
      setEmployee(data.employee);
      setTodayStatus(data);
      setView("status");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [pin, outlet]);

  const clockIn = async () => {
    setLoading(true);
    try {
      let data;
      try {
        data = await api.post("/api/attendance/pin-checkin", { pin_code: pin, outlet_id: outlet.id });
      } catch (err) {
        setError(err.body?.error || "Failed");
        return;
      }
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
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const goOnBreak = (breakReason) => async () => {
    setLoading(true);
    try {
      let data;
      try {
        data = await api.post("/api/attendance/pin-checkout", {
          pin_code: pin,
          break_reason: breakReason,
          outlet_id: outlet?.id || null,
        });
      } catch (err) {
        setError(err.body?.error || "Failed");
        return;
      }
      const reasonLabel = BREAK_REASONS.find((r) => r.key === breakReason)?.label || breakReason;
      setConfirm({
        title: `${reasonLabel} Break Started`,
        body: data.message || `You've worked ${fmtDuration(data.net_work_hours_today)} today.`,
        color: "amber",
      });
      setView("confirmation");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const endOfDay = async () => {
    setLoading(true);
    try {
      let data;
      try {
        data = await api.post("/api/attendance/pin-checkout", {
          pin_code: pin,
          break_reason: null,
          outlet_id: outlet?.id || null,
        });
      } catch (err) {
        setError(err.body?.error || "Failed");
        return;
      }
      setConfirm({
        title: `Goodbye, ${employee.name}!`,
        body: data.message || `You worked ${fmtDuration(data.net_work_hours_today)} today.`,
        color: "blue",
      });
      setView("confirmation");
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (view === "idle") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white px-4">
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-8 py-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm">Store:</span>
            {kioskLocked && outlet ? (
              <>
                <span className="font-semibold text-white">{outlet.name}</span>
                <span className="text-xs text-slate-500 bg-slate-800 rounded px-2 py-1">Locked</span>
              </>
            ) : (
              <select
                value={outlet?.id || ""}
                onChange={(e) => {
                  const found = outlets.find((o) => o.id === Number(e.target.value));
                  setOutlet(found || null);
                }}
                className="bg-slate-800 border border-slate-600 text-white rounded-lg px-3 py-1.5 text-sm font-semibold cursor-pointer"
              >
                <option value="">Select your store...</option>
                {outlets.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Clock />
        </div>

        <div className="flex flex-col items-center">
          <h1 className="text-3xl font-bold text-white mb-2">Attendance Kiosk</h1>
          <p className="text-slate-400 mb-8 text-center">Enter your PIN to clock in, break, or clock out</p>
          <PinPad
            pin={pin}
            error={error}
            loading={loading}
            onDigit={appendDigit}
            onBackspace={backspace}
            onSubmit={submitPin}
          />
        </div>
      </div>
    );
  }

  if (view === "status") {
    const s = todayStatus?.status;
    const netHours = todayStatus?.net_work_hours_today ?? 0;
    const session = todayStatus?.current_session;

    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-900 text-white px-4">
        <div className="w-full max-w-sm flex flex-col items-center gap-6">
          <div className="w-full bg-slate-800 rounded-2xl p-6 text-center border border-slate-700">
            <div className="w-16 h-16 rounded-full bg-slate-600 flex items-center justify-center text-3xl font-bold mx-auto mb-3">
              {employee?.name?.[0]?.toUpperCase()}
            </div>
            <h2 className="text-2xl font-bold text-white">{employee?.name}</h2>

            {s === "not_clocked_in" && <p className="text-slate-400 mt-1">You are not clocked in today</p>}
            {s === "clocked_in" && (
              <>
                <p className="text-emerald-400 font-semibold mt-1">
                  Clocked In - {session ? fmtElapsed(session.session_start) : ""}
                </p>
                <p className="text-slate-400 text-sm mt-1">{fmtDuration(netHours)} worked today</p>
              </>
            )}
            {s === "on_break" && (
              <>
                <p className="text-amber-400 font-semibold mt-1 capitalize">
                  On {session?.break_reason || "Break"} -{" "}
                  {session ? fmtElapsed(session.session_start) : ""}
                </p>
                <p className="text-slate-400 text-sm mt-1">{fmtDuration(netHours)} worked today</p>
              </>
            )}
            {s === "clocked_out" && (
              <p className="text-blue-400 font-semibold mt-1">
                Checked out — {fmtDuration(netHours)} worked today
              </p>
            )}
          </div>

          {s === "not_clocked_in" && (
            <button
              onClick={clockIn}
              disabled={loading}
              className="w-full py-5 text-xl font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? "Please wait..." : "Clock In"}
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
              {loading ? "Please wait..." : "Clock Out (End of Day)"}
            </button>
          </>
        )}

          {s === "on_break" && (
            <button
              onClick={clockIn}
              disabled={loading}
              className="w-full py-5 text-xl font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? "Please wait..." : "Resume Shift"}
            </button>
          )}

          {s === "clocked_out" && (
            <>
              <button
                onClick={clockIn}
                disabled={loading}
                className="w-full py-5 text-xl font-bold rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 transition-all disabled:opacity-50"
              >
                {loading ? "Please wait..." : "Clock In Again"}
              </button>
              <button
                onClick={resetToIdle}
                className="w-full py-4 text-lg font-bold rounded-2xl bg-slate-700 hover:bg-slate-600 active:scale-95 transition-all"
              >
                Done
              </button>
            </>
          )}

          {error && <p className="text-red-400 text-sm text-center">{error}</p>}

          <button onClick={resetToIdle} className="text-slate-500 text-sm hover:text-slate-400 mt-2">
            {"<- Back"}
          </button>
        </div>
      </div>
    );
  }

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
          <button onClick={() => setView("status")} className="text-slate-500 text-sm hover:text-slate-400 mt-2">
            {"<- Cancel"}
          </button>
        </div>
      </div>
    );
  }

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
        {confirm.body && <p className="text-2xl text-white/80">{confirm.body}</p>}
        <p className="text-white/50 mt-8 text-sm">Returning to kiosk in 5 seconds...</p>
      </div>
    </div>
  );
}
