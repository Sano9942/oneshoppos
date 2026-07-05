import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { API_BASE } from "../../config";
import { useStorefront } from "./StorefrontLayout";

const STATUS_STEPS = {
  pickup: ["ordered", "processing", "ready_for_pickup", "completed"],
  shipping: ["ordered", "processing", "shipped", "completed"],
};

const STATUS_LABELS = {
  ordered: "Order Placed",
  processing: "Processing",
  ready_for_pickup: "Ready for Pickup",
  shipped: "Shipped",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default function StorefrontOrderStatus() {
  const { tenantSlug, orderToken } = useParams();
  const { config } = useStorefront();
  const currencySymbol = config?.currency_symbol || "Rs";

  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [arriving, setArriving] = useState(false);
  const [arriveMsg, setArriveMsg] = useState(null);

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(
        `${API_BASE}/api/storefront/orders/${orderToken}?tenant=${tenantSlug}`
      );
      if (!res.ok) throw new Error("Order not found");
      const data = await res.json();
      setOrder(data);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, orderToken]);

  // Initial fetch
  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchOrder, 30000);
    return () => clearInterval(interval);
  }, [fetchOrder]);

  async function handleArrive() {
    setArriving(true);
    setArriveMsg(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/storefront/orders/${orderToken}/arrive?tenant=${tenantSlug}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to notify store");
      }
      setArriveMsg("The store has been notified that you've arrived!");
      fetchOrder();
    } catch (err) {
      setArriveMsg(err.message);
    } finally {
      setArriving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-(--ui-muted-surface) rounded w-1/2" />
          <div className="h-4 bg-(--ui-muted-surface) rounded w-1/3" />
          <div className="h-24 bg-(--ui-muted-surface) rounded" />
          <div className="h-48 bg-(--ui-muted-surface) rounded" />
        </div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-xl font-bold text-(--ui-text) mb-2">Order Not Found</h2>
        <p className="text-(--ui-text-muted) mb-6">{error || "This order does not exist or has expired."}</p>
        <Link
          to={`/store/${tenantSlug}`}
          className="text-(--ui-link) hover:text-(--ui-link) font-medium"
        >
          Back to Store
        </Link>
      </div>
    );
  }

  const isPickup = order.delivery_method === "pickup";
  const steps = STATUS_STEPS[isPickup ? "pickup" : "shipping"];
  const currentStepIdx = steps.indexOf(order.status);
  const isCancelled = order.status === "cancelled";

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-(--ui-text-muted) mb-6">
        <Link to={`/store/${tenantSlug}`} className="hover:text-(--ui-link)">Store</Link>
        <span>/</span>
        <span className="text-(--ui-text) font-medium">Order Status</span>
      </nav>

      {/* Order header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-(--ui-text)">
            Order {order.order_number || `#${order.id}`}
          </h1>
          {order.created_at && (
            <p className="text-sm text-(--ui-text-muted) mt-1">
              Placed on {new Date(order.created_at).toLocaleDateString(undefined, {
                year: "numeric", month: "long", day: "numeric",
              })}
            </p>
          )}
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* Progress timeline */}
      {!isCancelled && (
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6 mb-6">
          <h2 className="text-sm font-medium text-(--ui-text) mb-4">Order Progress</h2>
          <div className="flex items-center justify-between">
            {steps.map((step, idx) => {
              const isCompleted = idx <= currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              return (
                <div key={step} className="flex-1 flex flex-col items-center relative">
                  {/* Connector line */}
                  {idx > 0 && (
                    <div
                      className={`absolute top-3.5 right-1/2 w-full h-0.5 ${
                        idx <= currentStepIdx ? "bg-(--ui-primary)" : "bg-(--ui-muted-surface)"
                      }`}
                      style={{ zIndex: 0 }}
                    />
                  )}
                  {/* Step dot */}
                  <div
                    className={`relative z-10 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      isCompleted
                        ? "bg-(--ui-primary) text-(--ui-on-primary)"
                        : "bg-(--ui-muted-surface) text-(--ui-text-muted)"
                    } ${isCurrent ? "ring-4 ring-(--ui-focus)" : ""}`}
                  >
                    {isCompleted ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    ) : (
                      idx + 1
                    )}
                  </div>
                  <span className={`text-xs mt-2 text-center ${
                    isCurrent ? "text-(--ui-link) font-semibold" : "text-(--ui-text-muted)"
                  }`}>
                    {STATUS_LABELS[step]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancelled banner */}
      {isCancelled && (
        <div className="bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded-xl p-4 mb-6">
          <p className="text-sm font-medium text-(--ui-danger-fg)">This order has been cancelled.</p>
        </div>
      )}

      {/* I've Arrived button */}
      {isPickup && order.status === "ready_for_pickup" && (
        <div className="bg-(--ui-success-bg) border border-(--ui-success-bg) rounded-xl p-6 mb-6 text-center">
          <p className="text-sm text-(--ui-success-fg) mb-3">
            Your order is ready! Let the store know when you arrive.
          </p>
          <button
            onClick={handleArrive}
            disabled={arriving}
            className="px-6 py-2.5 bg-(--ui-primary) text-(--ui-on-primary) font-medium rounded-lg hover:bg-(--ui-primary-strong) transition-colors disabled:opacity-50"
          >
            {arriving ? "Notifying..." : "I've Arrived"}
          </button>
          {arriveMsg && (
            <p className="text-sm text-(--ui-success-fg) mt-3">{arriveMsg}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6">
        {/* Items */}
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
          <h2 className="text-sm font-medium text-(--ui-text) mb-4">Items</h2>
          <div className="space-y-3">
            {(order.items || []).map((item, idx) => (
              <div key={item.id || idx} className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-medium text-(--ui-text)">
                    {item.product_name || item.name}
                  </p>
                  {item.variant_name && (
                    <p className="text-xs text-(--ui-text-muted)">{item.variant_name}</p>
                  )}
                  <p className="text-xs text-(--ui-text-muted)">Qty: {item.quantity}</p>
                </div>
                <span className="text-sm font-medium text-(--ui-text) shrink-0">
                  {currencySymbol} {(Number(item.unit_price || item.price || 0) * item.quantity).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Delivery info */}
        <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
          <h2 className="text-sm font-medium text-(--ui-text) mb-4">
            {isPickup ? "Pickup Location" : "Shipping Address"}
          </h2>
          {isPickup ? (
            <div>
              {order.pickup_outlet_name && (
                <p className="text-sm font-medium text-(--ui-text)">{order.pickup_outlet_name}</p>
              )}
              {order.pickup_outlet_address && (
                <p className="text-sm text-(--ui-text-muted) mt-1">{order.pickup_outlet_address}</p>
              )}
              {!order.pickup_outlet_name && (
                <p className="text-sm text-(--ui-text-muted)">Pickup details will be confirmed.</p>
              )}
            </div>
          ) : (
            <div className="text-sm text-(--ui-text) space-y-0.5">
              {order.shipping_address ? (
                <>
                  <p>{order.shipping_address.address_line_1}</p>
                  {order.shipping_address.address_line_2 && <p>{order.shipping_address.address_line_2}</p>}
                  <p>
                    {[order.shipping_address.city, order.shipping_address.province, order.shipping_address.postal_code]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  {order.shipping_address.country_code && order.shipping_address.country_code !== "PK" && (
                    <p>{order.shipping_address.country_code}</p>
                  )}
                </>
              ) : (
                <p className="text-(--ui-text-muted)">Address details will be confirmed.</p>
              )}
            </div>
          )}

          {/* Contact */}
          {(order.customer_name || order.customer_phone || order.customer_email) && (
            <div className="border-t border-(--ui-border) mt-4 pt-4">
              <h3 className="text-xs font-medium text-(--ui-text-muted) uppercase tracking-wide mb-2">Contact</h3>
              {order.customer_name && <p className="text-sm text-(--ui-text)">{order.customer_name}</p>}
              {order.customer_phone && <p className="text-sm text-(--ui-text-muted)">{order.customer_phone}</p>}
              {order.customer_email && <p className="text-sm text-(--ui-text-muted)">{order.customer_email}</p>}
            </div>
          )}
        </div>
      </div>

      {/* Order totals */}
      <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
        <h2 className="text-sm font-medium text-(--ui-text) mb-4">Order Totals</h2>
        <div className="space-y-2">
          {order.subtotal != null && (
            <div className="flex justify-between text-sm text-(--ui-text-muted)">
              <span>Subtotal</span>
              <span>{currencySymbol} {Number(order.subtotal).toLocaleString()}</span>
            </div>
          )}
          {Number(order.tax || 0) > 0 && (
            <div className="flex justify-between text-sm text-(--ui-text-muted)">
              <span>Tax</span>
              <span>{currencySymbol} {Number(order.tax).toLocaleString()}</span>
            </div>
          )}
          {Number(order.shipping_fee || 0) > 0 && (
            <div className="flex justify-between text-sm text-(--ui-text-muted)">
              <span>Shipping</span>
              <span>{currencySymbol} {Number(order.shipping_fee).toLocaleString()}</span>
            </div>
          )}
          <div className="border-t border-(--ui-border) pt-2 mt-2 flex justify-between text-base font-bold text-(--ui-text)">
            <span>Total</span>
            <span>{currencySymbol} {Number(order.total || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Back link */}
      <div className="mt-8 text-center">
        <Link
          to={`/store/${tenantSlug}`}
          className="text-sm text-(--ui-link) hover:text-(--ui-link) font-medium"
        >
          Continue Shopping
        </Link>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    ordered: "bg-(--ui-muted-surface) text-(--ui-link)",
    processing: "bg-(--ui-warning-bg) text-(--ui-warning-fg)",
    ready_for_pickup: "bg-(--ui-success-bg) text-(--ui-success-fg)",
    shipped: "bg-(--ui-muted-surface) text-(--ui-text-muted)",
    completed: "bg-(--ui-success-bg) text-(--ui-success-fg)",
    cancelled: "bg-(--ui-danger-bg) text-(--ui-danger-fg)",
  };

  return (
    <span className={`inline-flex items-center px-3 py-1 text-sm font-medium rounded-full ${colors[status] || "bg-(--ui-muted-surface) text-(--ui-text)"}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}
