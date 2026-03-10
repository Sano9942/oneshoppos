import React, { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { usePOS } from "./POSContext";
import { API_BASE as API } from "../../../config";

export default function POSSessionExpiredModal() {
  const {
    sessionExpired,
    setSessionExpired,
    retryPendingSale,
    parkSale,
    navigate,
    employee,
    authHeaders,
  } = usePOS();

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!sessionExpired) return null;

  const handleReLogin = async (e) => {
    e.preventDefault();
    if (!pin) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: employee?.name || "", pin }),
      });
      const data = await res.json();
      if (!res.ok || !data.employee) {
        setError(data.error || "Invalid PIN");
        setPin("");
        return;
      }
      setPin("");
      await retryPendingSale();
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setSessionExpired(false);
    await parkSale();
    navigate("/login", { replace: true });
  };

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl flex flex-col items-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <AlertTriangle size={32} />
        </div>
        <h1 className="mb-1 text-xl font-bold text-slate-800">Session Expired</h1>
        <p className="mb-1 text-center text-sm text-slate-500">
          Your session expired during checkout.
        </p>
        <p className="mb-6 text-center text-sm font-medium text-slate-700">
          {employee?.name}
        </p>
        <form onSubmit={handleReLogin} className="flex w-full flex-col gap-4">
          <input
            type="password"
            autoFocus
            maxLength="10"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError("");
            }}
            className="w-full rounded-xl border border-slate-300 py-3 px-4 text-center font-mono text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="••••"
          />
          {error && (
            <p className="text-center text-sm font-medium text-red-500">{error}</p>
          )}
          <button
            type="submit"
            disabled={!pin || loading}
            className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {loading ? "Verifying…" : "Re-login & Complete Sale"}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            className="text-center text-sm text-slate-400 hover:text-slate-700"
          >
            Park sale &amp; go to login
          </button>
        </form>
      </div>
    </div>
  );
}
