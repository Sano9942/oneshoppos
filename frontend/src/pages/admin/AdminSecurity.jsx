import { useEffect, useState, useCallback } from "react";
import { ShieldCheck, ShieldOff, KeyRound, Copy, Check, Monitor } from "lucide-react";
import { adminFetch } from "./AdminLogin";

// Super-admin account security. B1: TOTP 2FA enrollment / disable.
// (B2 adds an active-sessions card below.)
export default function AdminSecurity() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // enrollment flow
  const [enrolling, setEnrolling] = useState(false);
  const [setupData, setSetupData] = useState(null); // { secret, otpauth_uri, qr_data_url }
  const [verifyCode, setVerifyCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState(null); // shown once after verify
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  // disable flow
  const [disableCode, setDisableCode] = useState("");
  const [showDisable, setShowDisable] = useState(false);

  // active sessions
  const [sessions, setSessions] = useState([]);
  const [revoking, setRevoking] = useState(false);

  const loadStatus = useCallback(() => {
    setLoading(true);
    adminFetch("/api/admin/auth/totp/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load security status"))))
      .then((res) => { setStatus(res); setError(""); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const loadSessions = useCallback(() => {
    adminFetch("/api/admin/auth/sessions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load sessions"))))
      .then((res) => setSessions(res.sessions || []))
      .catch(() => { /* non-fatal */ });
  }, []);

  useEffect(() => { loadStatus(); loadSessions(); }, [loadStatus, loadSessions]);

  const revokeOthers = async () => {
    setRevoking(true); setError("");
    try {
      const res = await adminFetch("/api/admin/auth/sessions/revoke-others", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Revoke failed");
      loadSessions();
    } catch (err) { setError(err.message); }
    finally { setRevoking(false); }
  };

  const startSetup = async () => {
    setBusy(true); setError("");
    try {
      const res = await adminFetch("/api/admin/auth/totp/setup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Setup failed");
      setSetupData(data);
      setEnrolling(true);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const confirmSetup = async () => {
    if (!verifyCode.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await adminFetch("/api/admin/auth/totp/verify", {
        method: "POST",
        body: JSON.stringify({ code: verifyCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setRecoveryCodes(data.recovery_codes || []);
      setEnrolling(false);
      setSetupData(null);
      setVerifyCode("");
      loadStatus();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const disable2fa = async () => {
    if (!disableCode.trim()) return;
    setBusy(true); setError("");
    try {
      const res = await adminFetch("/api/admin/auth/totp/disable", {
        method: "POST",
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Disable failed");
      setShowDisable(false);
      setDisableCode("");
      setRecoveryCodes(null);
      loadStatus();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const copyRecovery = () => {
    if (!recoveryCodes) return;
    navigator.clipboard.writeText(recoveryCodes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const enabled = !!status?.enabled;

  return (
    <div className="max-w-2xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-(--ui-text)">Account Security</h1>
        <p className="text-xs text-(--ui-text-muted)">Two-factor authentication for the super-admin console.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-(--ui-radius-sm) border border-(--ui-danger) bg-(--ui-danger)/10 px-4 py-2 text-sm font-medium text-(--ui-danger)">
          {error}
        </div>
      )}

      {/* Recovery codes — shown once, right after enabling */}
      {recoveryCodes && (
        <div className="mb-4 rounded-(--ui-radius-lg) border border-(--ui-border) bg-(--ui-surface) p-6">
          <div className="mb-2 flex items-center gap-2">
            <ShieldCheck size={18} className="text-(--ui-success)" />
            <h2 className="text-base font-bold text-(--ui-text)">Save your recovery codes</h2>
          </div>
          <p className="mb-3 text-sm text-(--ui-text-muted)">
            Store these somewhere safe. Each code works once if you lose your authenticator.
            <strong className="text-(--ui-text)"> They won't be shown again.</strong>
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-(--ui-radius-sm) border border-(--ui-border) bg-(--ui-muted-surface) p-3 font-mono text-sm text-(--ui-text)">
            {recoveryCodes.map((c) => <div key={c}>{c}</div>)}
          </div>
          <button
            onClick={copyRecovery}
            className="ui-focus-ring mt-3 flex items-center gap-1.5 rounded-full bg-(--ui-muted-surface) px-4 py-1.5 text-sm font-semibold text-(--ui-text) hover:bg-(--ui-border-strong)"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy all"}
          </button>
        </div>
      )}

      <div className="rounded-(--ui-radius-lg) border border-(--ui-border) bg-(--ui-surface) p-6">
        {loading ? (
          <p className="text-sm text-(--ui-text-muted)">Loading…</p>
        ) : enabled ? (
          <>
            <div className="flex items-center gap-2">
              <ShieldCheck size={20} className="text-(--ui-success)" />
              <h2 className="text-base font-bold text-(--ui-text)">Two-factor authentication is on</h2>
            </div>
            <p className="mt-1 text-sm text-(--ui-text-muted)">
              {status?.recovery_codes_remaining ?? 0} recovery code(s) remaining
              {status?.enabled_at ? ` · enabled ${new Date(status.enabled_at).toLocaleDateString()}` : ""}
            </p>
            {!showDisable ? (
              <button
                onClick={() => setShowDisable(true)}
                className="ui-focus-ring mt-4 flex items-center gap-1.5 rounded-full border border-(--ui-danger) px-4 py-1.5 text-sm font-semibold text-(--ui-danger) hover:bg-(--ui-danger)/10"
              >
                <ShieldOff size={14} /> Disable 2FA
              </button>
            ) : (
              <div className="mt-4 space-y-3">
                <p className="text-sm text-(--ui-text-muted)">Enter a current authenticator or recovery code to disable.</p>
                <input
                  type="text"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="123456"
                  className="ui-focus-ring w-full max-w-xs rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 tracking-widest text-(--ui-text)"
                />
                <div className="flex gap-2">
                  <button
                    onClick={disable2fa}
                    disabled={busy || !disableCode.trim()}
                    className="ui-focus-ring rounded-full bg-(--ui-danger) px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy ? "Disabling…" : "Confirm disable"}
                  </button>
                  <button
                    onClick={() => { setShowDisable(false); setDisableCode(""); }}
                    className="ui-focus-ring rounded-full px-4 py-1.5 text-sm font-medium text-(--ui-text-muted) hover:text-(--ui-text)"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        ) : enrolling && setupData ? (
          <>
            <div className="flex items-center gap-2">
              <KeyRound size={20} className="text-(--ui-text)" />
              <h2 className="text-base font-bold text-(--ui-text)">Scan with your authenticator</h2>
            </div>
            <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row">
              <img src={setupData.qr_data_url} alt="TOTP QR code" width={180} height={180} className="rounded-(--ui-radius-sm) border border-(--ui-border)" />
              <div className="text-sm text-(--ui-text-muted)">
                <p>Or enter this key manually:</p>
                <code className="mt-1 inline-block break-all rounded bg-(--ui-muted-surface) px-2 py-1 font-mono text-(--ui-text)">{setupData.secret}</code>
                <p className="mt-4">Then enter the 6-digit code to confirm:</p>
                <input
                  type="text"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  className="ui-focus-ring mt-1 w-40 rounded-(--ui-radius-sm) border border-(--ui-border-strong) bg-white px-3 py-2 tracking-widest text-(--ui-text)"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={confirmSetup}
                    disabled={busy || !verifyCode.trim()}
                    className="ui-focus-ring rounded-full bg-(--ui-primary) px-4 py-1.5 text-sm font-semibold text-(--ui-on-primary) disabled:opacity-50"
                  >
                    {busy ? "Verifying…" : "Enable 2FA"}
                  </button>
                  <button
                    onClick={() => { setEnrolling(false); setSetupData(null); setVerifyCode(""); }}
                    className="ui-focus-ring rounded-full px-4 py-1.5 text-sm font-medium text-(--ui-text-muted) hover:text-(--ui-text)"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <ShieldOff size={20} className="text-(--ui-text-muted)" />
              <h2 className="text-base font-bold text-(--ui-text)">Two-factor authentication is off</h2>
            </div>
            <p className="mt-1 text-sm text-(--ui-text-muted)">
              Add an authenticator app (Google Authenticator, 1Password, Authy) as a second factor for admin sign-in.
            </p>
            <button
              onClick={startSetup}
              disabled={busy}
              className="ui-focus-ring mt-4 flex items-center gap-1.5 rounded-full bg-(--ui-primary) px-4 py-1.5 text-sm font-semibold text-(--ui-on-primary) disabled:opacity-50"
            >
              <ShieldCheck size={14} /> {busy ? "Starting…" : "Enable 2FA"}
            </button>
          </>
        )}
      </div>

      {/* Active sessions */}
      <div className="mt-4 rounded-(--ui-radius-lg) border border-(--ui-border) bg-(--ui-surface) p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Monitor size={18} className="text-(--ui-text)" />
            <h2 className="text-base font-bold text-(--ui-text)">Active sessions</h2>
          </div>
          {sessions.length > 1 && (
            <button
              onClick={revokeOthers}
              disabled={revoking}
              className="ui-focus-ring rounded-full border border-(--ui-danger) px-3 py-1 text-xs font-semibold text-(--ui-danger) hover:bg-(--ui-danger)/10 disabled:opacity-50"
            >
              {revoking ? "Revoking…" : "Sign out other sessions"}
            </button>
          )}
        </div>
        <div className="mt-3 divide-y divide-(--ui-border)">
          {sessions.length === 0 ? (
            <p className="text-sm text-(--ui-text-muted)">No active sessions.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-(--ui-text)">{s.user_agent || "Unknown device"}</p>
                  <p className="text-xs text-(--ui-text-muted)">
                    {s.ip_address || "—"} · signed in {new Date(s.created_at).toLocaleString()}
                  </p>
                </div>
                {s.current && (
                  <span className="ml-3 shrink-0 rounded-full bg-(--ui-success)/15 px-2 py-0.5 text-xs font-semibold text-(--ui-success)">
                    This device
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
