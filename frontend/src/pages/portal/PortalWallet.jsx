import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalWallet() {
  const { tenantSlug } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    portalApi.get(tenantSlug, "/api/portal/me/wallet").then(setData).catch(() => setData(null));
  }, [tenantSlug]);

  if (!data) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Wallet</h1>
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
        <div className="text-sm text-slate-500">Balance</div>
        <div className="text-4xl font-semibold">{Number(data.balance || 0).toLocaleString()}</div>
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
