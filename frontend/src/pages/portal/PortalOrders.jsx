import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { portalApi } from "../../api/portalApi";

// Tier 2.10 — unified order history (web + in-store) with one-click Reorder.
// The reorder POST returns a redirect URL into the storefront cart, which
// adopts the cart_token via a query param.
export default function PortalOrders() {
  const { tenantSlug } = useParams();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reorderingKey, setReorderingKey] = useState(null);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    portalApi
      .get(tenantSlug, "/api/portal/me/order-history")
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [tenantSlug]);

  async function handleReorder(order) {
    const key = `${order.source}:${order.id}`;
    setReorderingKey(key);
    setNotice(null);
    try {
      const res = await portalApi.post(tenantSlug, "/api/portal/me/reorder", {
        source: order.source,
        order_id: order.id,
      });
      if (res?.items_skipped?.length) {
        const names = res.items_skipped.map((s) => s.title).join(", ");
        setNotice(`${res.items_added} item(s) added. Skipped: ${names}.`);
      }
      // Hand off to storefront. The storefront cart page reads ?adopt= on
      // mount, saves the token to localStorage, then strips the param.
      window.location.href = res.redirect_url;
    } catch (err) {
      const detail = err?.body?.items_skipped?.length
        ? ` (${err.body.items_skipped.map((s) => s.title).join(", ")})`
        : "";
      setNotice(err.message + detail);
      setReorderingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Order history</h1>

      {notice && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm">
          {notice}
        </div>
      )}

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
                <th className="text-left font-medium px-4 py-3">Type</th>
                <th className="text-right font-medium px-4 py-3">Items</th>
                <th className="text-right font-medium px-4 py-3">Total</th>
                <th className="text-left font-medium px-4 py-3">Placed</th>
                <th className="text-right font-medium px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const key = `${o.source}:${o.id}`;
                const busy = reorderingKey === key;
                return (
                  <tr key={key} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium">{o.order_number || `#${o.id}`}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          o.source === "web"
                            ? "bg-indigo-50 text-indigo-700"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {o.source === "web" ? "Online" : "In-store"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{Number(o.item_count) || 0}</td>
                    <td className="px-4 py-3 text-right">{Number(o.total || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {o.ordered_at ? new Date(o.ordered_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleReorder(o)}
                        disabled={!!reorderingKey}
                        className="inline-flex items-center px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busy ? "Loading…" : "Reorder"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
