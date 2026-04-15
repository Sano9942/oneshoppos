import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalWallet() {
  const { tenantSlug } = useParams();
  const [data, setData] = useState(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmount, setTopupAmount] = useState("");
  const [topupBusy, setTopupBusy] = useState(false);
  const [topupError, setTopupError] = useState("");

  useEffect(() => {
    portalApi.get(tenantSlug, "/api/portal/me/wallet").then(setData).catch(() => setData(null));
  }, [tenantSlug]);

  const submitTopup = async () => {
    setTopupError("");
    const amt = Number(topupAmount);
    if (!amt || amt <= 0) {
      setTopupError("Enter an amount greater than 0");
      return;
    }
    setTopupBusy(true);
    try {
      const res = await portalApi.post(tenantSlug, "/api/portal/me/wallet/top-up-intent", { amount: amt });
      if (res.checkout_url) {
        window.location.href = res.checkout_url;
        return;
      }
      setTopupError("No checkout URL returned");
    } catch (err) {
      setTopupError(err.message || "Failed to start top-up");
    } finally {
      setTopupBusy(false);
    }
  };

  if (!data) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Wallet</h1>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-sm text-slate-500">Balance</div>
            <div className="text-4xl font-semibold">{Number(data.balance || 0).toLocaleString()}</div>
          </div>
          <button
            type="button"
            onClick={() => setTopupOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          >
            {topupOpen ? "Cancel" : "Top up"}
          </button>
        </div>
        {topupOpen && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
            <input
              type="number"
              min="1"
              placeholder="Amount"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
            />
            {topupError && <p className="text-xs text-red-600">{topupError}</p>}
            <button
              type="button"
              onClick={submitTopup}
              disabled={topupBusy || !topupAmount}
              className="w-full px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {topupBusy ? "Redirecting…" : "Pay now"}
            </button>
          </div>
        )}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Recent activity</h2>
        {(data.ledger || []).length === 0 ? (
          <div className="text-sm text-slate-500">No wallet activity yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.ledger.map((l) => (
              <li key={l.id} className="py-2 flex justify-between text-sm">
                <span>
                  {new Date(l.created_at).toLocaleDateString()} — {l.note || l.reference_type}
                </span>
                <span className={l.type === "credit" ? "text-emerald-700" : "text-red-600"}>
                  {l.type === "credit" ? "+" : "−"}
                  {Number(l.amount).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
