import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

export default function PortalOrders() {
  const { tenantSlug } = useParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    portalApi
      .get(tenantSlug, "/api/portal/me/orders")
      .then(setOrders)
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Orders</h1>
      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500">
          No orders yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left font-medium px-4 py-3">Order #</th>
                <th className="text-right font-medium px-4 py-3">Total</th>
                <th className="text-left font-medium px-4 py-3">Payment</th>
                <th className="text-left font-medium px-4 py-3">Fulfillment</th>
                <th className="text-left font-medium px-4 py-3">Placed</th>
                <th className="text-left font-medium px-4 py-3">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{o.external_order_number || `#${o.id}`}</td>
                  <td className="px-4 py-3 text-right">{Number(o.grand_total).toLocaleString()}</td>
                  <td className="px-4 py-3">{o.payment_status}</td>
                  <td className="px-4 py-3">{o.fulfillment_status}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {o.ordered_at ? new Date(o.ordered_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{o.tracking_number || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
