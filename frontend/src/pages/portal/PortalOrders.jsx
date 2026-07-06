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
  // V02 wholesale — open backorders (memo: goods still owed at order-time
  // prices; nothing is payable until the store fulfills them).
  const [backorders, setBackorders] = useState([]);

  useEffect(() => {
    portalApi
      .get(tenantSlug, "/api/portal/me/order-history")
      .then((data) => setOrders(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
    portalApi
      .get(tenantSlug, "/api/portal/me/backorders")
      .then((data) => setBackorders(Array.isArray(data) ? data : []))
      .catch(() => setBackorders([]));
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

      {backorders.length > 0 && (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) overflow-hidden">
          <div className="px-4 py-3 border-b border-(--ui-border)">
            <p className="font-medium">On backorder</p>
            <p className="text-xs text-(--ui-text-muted)">
              These items are reserved for you at the price you ordered at. We'll invoice them when stock arrives — nothing to pay yet.
            </p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {backorders.map((b) => (
                <tr key={b.id} className="border-b border-(--ui-border) last:border-0">
                  <td className="px-4 py-2.5">
                    {b.product_name}
                    {b.variant_sku ? <span className="text-(--ui-text-muted)"> — {b.variant_sku}</span> : null}
                  </td>
                  <td className="px-4 py-2.5 text-right">{Number(b.qty_remaining)} × {Number(b.unit_price).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right text-(--ui-text-muted)">
                    {b.expected_at ? `Expected ${new Date(b.expected_at).toLocaleDateString()}` : b.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notice && (
        <div className="bg-(--ui-warning-bg) border border-(--ui-warning-bg) text-(--ui-warning-fg) rounded-lg px-4 py-3 text-sm">
          {notice}
        </div>
      )}

      {loading ? (
        <div className="text-(--ui-text-muted)">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-8 text-center text-(--ui-text-muted)">
          No orders yet.
        </div>
      ) : (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-(--ui-muted-surface) border-b border-(--ui-border)">
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
                  <tr key={key} className="border-b border-(--ui-border) last:border-0">
                    <td className="px-4 py-3 font-medium">{o.order_number || `#${o.id}`}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          o.source === "web"
                            ? "bg-(--ui-muted-surface) text-(--ui-link)"
                            : "bg-(--ui-muted-surface) text-(--ui-text)"
                        }`}
                      >
                        {o.source === "web" ? "Online" : "In-store"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{Number(o.item_count) || 0}</td>
                    <td className="px-4 py-3 text-right">{Number(o.total || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-(--ui-text-muted)">
                      {o.ordered_at ? new Date(o.ordered_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleReorder(o)}
                        disabled={!!reorderingKey}
                        className="inline-flex items-center px-3 py-1.5 bg-(--ui-primary) text-(--ui-on-primary) text-xs font-medium rounded hover:bg-(--ui-primary-strong) disabled:opacity-50 disabled:cursor-not-allowed"
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
