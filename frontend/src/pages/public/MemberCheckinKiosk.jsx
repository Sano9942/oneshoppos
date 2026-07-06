import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { API_BASE } from "../../config";

/**
 * V07 gym — public member check-in kiosk. Mounted at /member-checkin?tenant=slug.
 *
 * A lobby tablet: member types/scans their code (a barcode scanner types digits
 * + Enter, which the autofocused input + Enter-submit handles), and gets a big
 * traffic-light verdict. Talks only to the PUBLIC endpoints, which return the
 * minimal projection (first name + verdict + expiry + today's class). No login.
 *
 * Verdict → colour: allow = green, warn = amber (let in, but see the desk),
 * deny = red. Auto-resets to the entry screen after a few seconds.
 */
export default function MemberCheckinKiosk() {
  const [params] = useSearchParams();
  const tenant = params.get("tenant") || "";

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { verdict, first_name, ... } | { notFound } | { error }
  const inputRef = useRef(null);
  const resetTimer = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    return () => clearTimeout(resetTimer.current);
  }, []);

  const reset = () => {
    setResult(null);
    setCode("");
    clearTimeout(resetTimer.current);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const submit = async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const url = `${API_BASE}/api/member-kiosk/check-in?tenant=${encodeURIComponent(tenant)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_code: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ error: body.error || "Check-in unavailable. Please see the front desk." });
      } else if (body.found === false) {
        setResult({ notFound: true });
      } else {
        setResult(body);
      }
      // Auto-reset for the next member.
      resetTimer.current = setTimeout(reset, 6000);
    } catch {
      setResult({ error: "Connection problem. Please see the front desk." });
      resetTimer.current = setTimeout(reset, 6000);
    } finally {
      setBusy(false);
    }
  };

  const Shell = ({ children }) => (
    <div className="min-h-screen bg-(--ui-bg) flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );

  // ── Result screens ────────────────────────────────────────────────────
  if (result) {
    const tone =
      result.error || result.notFound ? "deny" : result.verdict; // allow | warn | deny
    const palette = {
      allow: { bg: "bg-emerald-600", chip: "✓" },
      warn: { bg: "bg-amber-500", chip: "!" },
      deny: { bg: "bg-red-600", chip: "✕" },
    }[tone] || { bg: "bg-red-600", chip: "✕" };

    return (
      <Shell>
        <button
          type="button"
          onClick={reset}
          className={`w-full rounded-3xl ${palette.bg} text-white p-10 text-center shadow-lg transition active:scale-[.99]`}
        >
          <div className="text-6xl font-bold mb-4">{palette.chip}</div>
          {result.notFound ? (
            <>
              <div className="text-3xl font-bold">Member not found</div>
              <div className="mt-3 text-lg opacity-90">Please see the front desk.</div>
            </>
          ) : result.error ? (
            <>
              <div className="text-3xl font-bold">Please see the front desk</div>
              <div className="mt-3 text-lg opacity-90">{result.error}</div>
            </>
          ) : (
            <>
              <div className="text-3xl font-bold">
                {tone === "allow" ? "Welcome" : tone === "warn" ? "Welcome" : "Check-in"},{" "}
                {result.first_name}!
              </div>
              <div className="mt-3 text-lg opacity-95">{result.message}</div>
              {result.class_today && (
                <div className="mt-5 rounded-xl bg-white/15 px-4 py-3 text-base">
                  {result.class_marked ? "Checked in to" : "Your class"}:{" "}
                  <span className="font-semibold">{result.class_today.title}</span>
                </div>
              )}
            </>
          )}
          <div className="mt-8 text-sm opacity-75">Tap to check in the next member</div>
        </button>
      </Shell>
    );
  }

  // ── Entry screen ──────────────────────────────────────────────────────
  return (
    <Shell>
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-(--ui-text)">Member Check-In</h1>
        <p className="text-(--ui-text-muted) mt-2">Scan your card or enter your member code</p>
      </div>
      <div className="rounded-2xl border border-(--ui-border) bg-(--ui-surface) p-6">
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          inputMode="numeric"
          autoComplete="off"
          placeholder="Member code"
          className="w-full text-center text-3xl tracking-widest font-semibold rounded-xl border border-(--ui-border) bg-(--ui-bg) py-5 outline-none focus:border-(--ui-primary)"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !code.trim()}
          className="mt-5 w-full rounded-xl bg-(--ui-primary) text-white py-4 text-xl font-semibold disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check In"}
        </button>
      </div>
    </Shell>
  );
}
