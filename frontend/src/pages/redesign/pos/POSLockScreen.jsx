import React from "react";
import { Lock } from "lucide-react";
import { usePOS } from "./POSContext";

export default function POSLockScreen() {
  const {
    lockPin,
    setLockPin,
    lockError,
    setLockError,
    handleUnlock,
    logout,
    navigate,
  } = usePOS();

  return (
    <div className="flex h-screen w-full items-center justify-center bg-slate-900">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl flex flex-col items-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
          <Lock size={32} />
        </div>
        <h1 className="mb-1 text-2xl font-bold text-slate-800">POS Terminal</h1>
        <p className="mb-6 text-center text-sm text-slate-500">
          Enter your PIN to unlock
        </p>
        <form onSubmit={handleUnlock} className="flex w-full flex-col gap-4">
          <input
            type="password"
            autoFocus
            maxLength="10"
            value={lockPin}
            onChange={(e) => {
              setLockPin(e.target.value);
              setLockError("");
            }}
            className="w-full rounded-xl border border-slate-300 py-3 px-4 text-center font-mono text-2xl tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="••••"
          />
          {lockError && (
            <p className="text-center text-sm font-medium text-red-500">
              {lockError}
            </p>
          )}
          <button
            type="submit"
            disabled={!lockPin}
            className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            Unlock Register
          </button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
            className="text-center text-sm text-slate-400 hover:text-slate-700"
          >
            Sign out completely
          </button>
        </form>
      </div>
    </div>
  );
}
