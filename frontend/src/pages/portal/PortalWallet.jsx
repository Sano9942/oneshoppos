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

  if (!data) return <div className="text-(--ui-text-muted)">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Wallet</h1>
      <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-sm text-(--ui-text-muted)">Balance</div>
            <div className="text-4xl font-semibold">{Number(data.balance || 0).toLocaleString()}</div>
          </div>
          <button
            type="button"
            onClick={() => setTopupOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-(--ui-primary) text-(--ui-on-primary) text-sm font-semibold hover:bg-(--ui-primary-strong)"
          >
            {topupOpen ? "Cancel" : "Top up"}
          </button>
        </div>
        {topupOpen && (
          <div className="mt-4 pt-4 border-t border-(--ui-border) space-y-2">
            <input
              type="number"
              min="1"
              placeholder="Amount"
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
              className="w-full px-3 py-2 border border-(--ui-border) rounded-lg text-sm"
            />
            {topupError && <p className="text-xs text-(--ui-danger-fg)">{topupError}</p>}
            <button
              type="button"
              onClick={submitTopup}
              disabled={topupBusy || !topupAmount}
              className="w-full px-4 py-2 rounded-lg bg-(--ui-primary) text-(--ui-on-primary) text-sm font-semibold hover:bg-(--ui-primary-strong) disabled:opacity-50"
            >
              {topupBusy ? "Redirecting…" : "Pay now"}
            </button>
          </div>
        )}
      </div>
      <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
        <h2 className="font-semibold mb-3">Recent activity</h2>
        {(data.ledger || []).length === 0 ? (
          <div className="text-sm text-(--ui-text-muted)">No wallet activity yet.</div>
        ) : (
          <ul className="divide-y divide-(--ui-border)">
            {data.ledger.map((l) => (
              <li key={l.id} className="py-2 flex justify-between text-sm">
                <span>
                  {new Date(l.created_at).toLocaleDateString()} — {l.note || l.reference_type}
                </span>
                <span className={l.type === "credit" ? "text-(--ui-success-fg)" : "text-(--ui-danger-fg)"}>
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
