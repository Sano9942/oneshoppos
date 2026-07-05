import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { API_BASE } from "../../config";
import { useStorefront } from "./StorefrontLayout";
import { useStorefrontCart } from "./useStorefrontCart";

export default function StorefrontCheckout() {
  const { tenantSlug, config, setCartItemCount } = useStorefront();
  const navigate = useNavigate();
  const { items, loading: cartLoading, fetchCart, getQuote, cartToken, clearCart } =
    useStorefrontCart(tenantSlug);
  const currencySymbol = config?.currency_symbol || "Rs";

  const [deliveryMethod, setDeliveryMethod] = useState("pickup");
  const [pickupLocations, setPickupLocations] = useState([]);
  const [pickupOutletId, setPickupOutletId] = useState(null);
  const [shippingMethods, setShippingMethods] = useState([]);
  const [selectedCourierId, setSelectedCourierId] = useState(null);
  const [shippingAddress, setShippingAddress] = useState({
    address_line_1: "",
    address_line_2: "",
    city: "",
    province: "",
    postal_code: "",
    country_code: "PK",
  });
  const [contact, setContact] = useState({ name: "", phone: "", email: "" });
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Load cart on mount
  useEffect(() => {
    if (cartToken) fetchCart();
  }, [cartToken, fetchCart]);

  // Fetch pickup locations and shipping methods
  useEffect(() => {
    fetch(`${API_BASE}/api/storefront/pickup-locations?tenant=${tenantSlug}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        const locs = data?.locations || (Array.isArray(data) ? data : []);
        setPickupLocations(locs);
        if (locs.length > 0 && !pickupOutletId) {
          setPickupOutletId(locs[0].id);
        }
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/storefront/shipping-methods?tenant=${tenantSlug}`)
      .then((r) => (r.ok ? r.json() : { methods: [] }))
      .then((data) => {
        const methods = data?.methods || [];
        setShippingMethods(methods);
        if (methods.length > 0 && !selectedCourierId) {
          setSelectedCourierId(methods[0].courier_id);
        }
      })
      .catch(() => {});
  }, [tenantSlug]);

  // Fetch quote when delivery method, pickup outlet, or shipping courier changes
  const refreshQuote = useCallback(async () => {
    if (!cartToken || items.length === 0) return;
    setQuoteLoading(true);
    const q = await getQuote(
      deliveryMethod,
      deliveryMethod === "pickup" ? pickupOutletId : null,
      deliveryMethod === "ship_to_customer" ? selectedCourierId : null
    );
    setQuote(q);
    setQuoteLoading(false);
  }, [cartToken, items.length, deliveryMethod, pickupOutletId, selectedCourierId, getQuote]);

  useEffect(() => {
    refreshQuote();
  }, [refreshQuote]);

  function handleAddressChange(field, value) {
    setShippingAddress((prev) => ({ ...prev, [field]: value }));
  }

  function handleContactChange(field, value) {
    setContact((prev) => ({ ...prev, [field]: value }));
  }

  async function handlePlaceOrder() {
    setError(null);

    if (!contact.name.trim() || !contact.phone.trim() || !contact.email.trim()) {
      setError("Please fill in all contact information fields.");
      return;
    }
    if (deliveryMethod === "ship_to_customer") {
      if (!shippingAddress.address_line_1.trim() || !shippingAddress.city.trim()) {
        setError("Please fill in the required shipping address fields.");
        return;
      }
    }
    if (deliveryMethod === "pickup" && !pickupOutletId) {
      setError("Please select a pickup location.");
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        delivery_method: deliveryMethod,
        customer_name: contact.name.trim(),
        customer_phone: contact.phone.trim(),
        customer_email: contact.email.trim(),
      };

      if (deliveryMethod === "pickup") {
        body.pickup_outlet_id = pickupOutletId;
      } else {
        if (selectedCourierId) body.courier_id = selectedCourierId;
        body.shipping_address = {
          address_line_1: shippingAddress.address_line_1.trim(),
          address_line_2: shippingAddress.address_line_2.trim(),
          city: shippingAddress.city.trim(),
          province: shippingAddress.province.trim(),
          postal_code: shippingAddress.postal_code.trim(),
          country_code: shippingAddress.country_code,
        };
      }

      const res = await fetch(
        `${API_BASE}/api/storefront/checkout?tenant=${tenantSlug}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cart_token: cartToken, ...body }),
        }
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Checkout failed. Please try again.");
      }

      const result = await res.json();
      clearCart();
      setCartItemCount(0);
      navigate(`/store/${tenantSlug}/order/${result.order_token}`, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Redirect if no cart
  if (!cartLoading && (!cartToken || items.length === 0)) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-xl font-bold text-(--ui-text) mb-2">Your cart is empty</h2>
        <p className="text-(--ui-text-muted) mb-6">Add some items before checking out.</p>
        <Link
          to={`/store/${tenantSlug}/products`}
          className="inline-flex items-center px-6 py-3 bg-(--ui-primary) text-(--ui-on-primary) font-medium rounded-lg hover:bg-(--ui-primary-strong) transition-colors"
        >
          Browse Products
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-(--ui-text-muted) mb-6">
        <Link to={`/store/${tenantSlug}`} className="hover:text-(--ui-link)">Store</Link>
        <span>/</span>
        <Link to={`/store/${tenantSlug}/cart`} className="hover:text-(--ui-link)">Cart</Link>
        <span>/</span>
        <span className="text-(--ui-text) font-medium">Checkout</span>
      </nav>

      <h1 className="text-2xl font-bold text-(--ui-text) mb-8">Checkout</h1>

      {error && (
        <div className="mb-6 p-3 bg-(--ui-danger-bg) border border-(--ui-danger-bg) rounded-lg text-sm text-(--ui-danger-fg)">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Form sections */}
        <div className="lg:col-span-2 space-y-8">
          {/* 1. Delivery Method */}
          <section className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
            <h2 className="text-lg font-bold text-(--ui-text) mb-4">Delivery Method</h2>
            <div className="space-y-3">
              <label className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                deliveryMethod === "pickup" ? "border-(--ui-focus) bg-(--ui-muted-surface)" : "border-(--ui-border) hover:border-(--ui-border-strong)"
              }`}>
                <input
                  type="radio"
                  name="delivery"
                  value="pickup"
                  checked={deliveryMethod === "pickup"}
                  onChange={() => setDeliveryMethod("pickup")}
                  className="text-(--ui-link) focus:ring-(--ui-focus)"
                />
                <div>
                  <p className="text-sm font-medium text-(--ui-text)">Pick Up in Store</p>
                  <p className="text-xs text-(--ui-text-muted)">Collect from a store location</p>
                </div>
              </label>
              <label className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                deliveryMethod === "ship_to_customer" ? "border-(--ui-focus) bg-(--ui-muted-surface)" : "border-(--ui-border) hover:border-(--ui-border-strong)"
              }`}>
                <input
                  type="radio"
                  name="delivery"
                  value="ship_to_customer"
                  checked={deliveryMethod === "ship_to_customer"}
                  onChange={() => setDeliveryMethod("ship_to_customer")}
                  className="text-(--ui-link) focus:ring-(--ui-focus)"
                />
                <div>
                  <p className="text-sm font-medium text-(--ui-text)">Ship to My Address</p>
                  <p className="text-xs text-(--ui-text-muted)">Delivered to your doorstep</p>
                </div>
              </label>
            </div>
          </section>

          {/* 2. Pickup Outlet Selector */}
          {deliveryMethod === "pickup" && (
            <section className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
              <h2 className="text-lg font-bold text-(--ui-text) mb-4">Pickup Location</h2>
              {pickupLocations.length === 0 ? (
                <p className="text-sm text-(--ui-text-muted)">No pickup locations available.</p>
              ) : (
                <div className="space-y-3">
                  {pickupLocations.map((loc) => (
                    <label
                      key={loc.id}
                      className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                        pickupOutletId === loc.id ? "border-(--ui-focus) bg-(--ui-muted-surface)" : "border-(--ui-border) hover:border-(--ui-border-strong)"
                      }`}
                    >
                      <input
                        type="radio"
                        name="pickup_outlet"
                        value={loc.id}
                        checked={pickupOutletId === loc.id}
                        onChange={() => setPickupOutletId(loc.id)}
                        className="mt-0.5 text-(--ui-link) focus:ring-(--ui-focus)"
                      />
                      <div>
                        <p className="text-sm font-medium text-(--ui-text)">{loc.name}</p>
                        {loc.address && <p className="text-xs text-(--ui-text-muted) mt-0.5">{loc.address}</p>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 3. Shipping Address Form */}
          {deliveryMethod === "ship_to_customer" && (
            <section className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
              <h2 className="text-lg font-bold text-(--ui-text) mb-4">Shipping Address</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Address Line 1 *</label>
                  <input
                    type="text"
                    value={shippingAddress.address_line_1}
                    onChange={(e) => handleAddressChange("address_line_1", e.target.value)}
                    placeholder="Street address"
                    className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Address Line 2</label>
                  <input
                    type="text"
                    value={shippingAddress.address_line_2}
                    onChange={(e) => handleAddressChange("address_line_2", e.target.value)}
                    placeholder="Apt, suite, floor (optional)"
                    className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">City *</label>
                    <input
                      type="text"
                      value={shippingAddress.city}
                      onChange={(e) => handleAddressChange("city", e.target.value)}
                      placeholder="City"
                      className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Province</label>
                    <input
                      type="text"
                      value={shippingAddress.province}
                      onChange={(e) => handleAddressChange("province", e.target.value)}
                      placeholder="Province / State"
                      className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Postal Code</label>
                    <input
                      type="text"
                      value={shippingAddress.postal_code}
                      onChange={(e) => handleAddressChange("postal_code", e.target.value)}
                      placeholder="Postal code"
                      className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-(--ui-text) mb-1">Country</label>
                    <select
                      value={shippingAddress.country_code}
                      onChange={(e) => handleAddressChange("country_code", e.target.value)}
                      className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none bg-(--ui-surface)"
                    >
                      <option value="PK">Pakistan</option>
                      <option value="AE">United Arab Emirates</option>
                      <option value="SA">Saudi Arabia</option>
                      <option value="US">United States</option>
                      <option value="GB">United Kingdom</option>
                    </select>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 3b. Shipping Method Selector */}
          {deliveryMethod === "ship_to_customer" && shippingMethods.length > 0 && (
            <section className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
              <h2 className="text-lg font-bold text-(--ui-text) mb-4">Shipping Method</h2>
              <div className="space-y-3">
                {shippingMethods.map((m) => (
                  <label
                    key={m.courier_id}
                    className={`flex items-center justify-between gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedCourierId === m.courier_id ? "border-(--ui-focus) bg-(--ui-muted-surface)" : "border-(--ui-border) hover:border-(--ui-border-strong)"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="shipping_method"
                        value={m.courier_id}
                        checked={selectedCourierId === m.courier_id}
                        onChange={() => setSelectedCourierId(m.courier_id)}
                        className="text-(--ui-link) focus:ring-(--ui-focus)"
                      />
                      <div>
                        <p className="text-sm font-medium text-(--ui-text)">{m.name}</p>
                        <p className="text-xs text-(--ui-text-muted) capitalize">{m.category} delivery</p>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-(--ui-text)">
                      {m.rate > 0 ? `${currencySymbol} ${m.rate.toLocaleString()}` : "Free"}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}

          {/* 4. Contact Information */}
          <section className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6">
            <h2 className="text-lg font-bold text-(--ui-text) mb-4">Contact Information</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-(--ui-text) mb-1">Full Name *</label>
                <input
                  type="text"
                  value={contact.name}
                  onChange={(e) => handleContactChange("name", e.target.value)}
                  placeholder="Your full name"
                  className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Phone *</label>
                  <input
                    type="tel"
                    value={contact.phone}
                    onChange={(e) => handleContactChange("phone", e.target.value)}
                    placeholder="03XX-XXXXXXX"
                    className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-(--ui-text) mb-1">Email *</label>
                  <input
                    type="email"
                    value={contact.email}
                    onChange={(e) => handleContactChange("email", e.target.value)}
                    placeholder="you@example.com"
                    className="w-full px-3 py-2 border border-(--ui-border-strong) rounded-lg text-sm focus:ring-2 focus:ring-(--ui-focus) focus:border-(--ui-focus) outline-none"
                  />
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* 5. Order Summary sidebar */}
        <div className="lg:col-span-1">
          <div className="bg-(--ui-surface) rounded-xl border border-(--ui-border) p-6 sticky top-24">
            <h2 className="text-lg font-bold text-(--ui-text) mb-4">Order Summary</h2>

            {/* Items list */}
            <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded bg-(--ui-muted-surface) overflow-hidden shrink-0">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-(--ui-text-muted) text-xs">
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                        </svg>
                      </div>
                    )}
                  </div>
                  <div className="grow min-w-0">
                    <p className="text-xs font-medium text-(--ui-text) truncate">
                      {item.product_name || item.name}
                    </p>
                    <p className="text-xs text-(--ui-text-muted)">Qty: {item.quantity}</p>
                  </div>
                  <span className="text-xs font-medium text-(--ui-text) shrink-0">
                    {currencySymbol} {(Number(item.unit_price || item.price || 0) * item.quantity).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t border-(--ui-border) pt-4 space-y-2">
              {quoteLoading ? (
                <div className="space-y-2 animate-pulse">
                  <div className="h-4 bg-(--ui-muted-surface) rounded w-full" />
                  <div className="h-4 bg-(--ui-muted-surface) rounded w-3/4" />
                  <div className="h-5 bg-(--ui-muted-surface) rounded w-1/2" />
                </div>
              ) : quote ? (
                <>
                  <div className="flex justify-between text-sm text-(--ui-text-muted)">
                    <span>Subtotal</span>
                    <span>{currencySymbol} {Number(quote.subtotal || 0).toLocaleString()}</span>
                  </div>
                  {Number(quote.taxTotal || 0) > 0 && (
                    <div className="flex justify-between text-sm text-(--ui-text-muted)">
                      <span>Tax</span>
                      <span>{currencySymbol} {Number(quote.taxTotal).toLocaleString()}</span>
                    </div>
                  )}
                  {Number(quote.shippingTotal || 0) > 0 && (
                    <div className="flex justify-between text-sm text-(--ui-text-muted)">
                      <span>Shipping</span>
                      <span>{currencySymbol} {Number(quote.shippingTotal).toLocaleString()}</span>
                    </div>
                  )}
                  {deliveryMethod === "pickup" && (
                    <div className="flex justify-between text-sm text-(--ui-text-muted)">
                      <span>Pickup</span>
                      <span className="text-(--ui-success-fg) font-medium">Free</span>
                    </div>
                  )}
                  <div className="border-t border-(--ui-border) pt-2 mt-2 flex justify-between text-base font-bold text-(--ui-text)">
                    <span>Total</span>
                    <span>{currencySymbol} {Number(quote.grandTotal || 0).toLocaleString()}</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-(--ui-text-muted)">
                  Select a delivery method to see totals.
                </p>
              )}
            </div>

            {/* Place Order */}
            <button
              onClick={handlePlaceOrder}
              disabled={submitting || quoteLoading || items.length === 0}
              className="mt-6 w-full px-6 py-3 bg-(--ui-primary) text-(--ui-on-primary) font-medium rounded-lg hover:bg-(--ui-primary-strong) transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Placing Order..." : "Place Order"}
            </button>

            <p className="text-xs text-(--ui-text-muted) text-center mt-3">
              Payment will be collected at {deliveryMethod === "pickup" ? "pickup" : "delivery"}.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
