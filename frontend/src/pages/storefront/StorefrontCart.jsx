import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useStorefront } from "./StorefrontLayout";
import { useStorefrontCart } from "./useStorefrontCart";

export default function StorefrontCart() {
  const { tenantSlug, config, setCartItemCount } = useStorefront();

  // Tier 2.10 reorder adoption — when arriving from /portal/.../orders with
  // ?adopt=<token>, persist that token to localStorage BEFORE useStorefrontCart
  // runs its useState initializer, then strip the param so back/forward and
  // future visits don't re-adopt. useState initializer runs once per mount,
  // synchronously, which is exactly the ordering we need vs. the child hook.
  useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const adopt = params.get("adopt");
    if (adopt) {
      localStorage.setItem(`sf_cart_${tenantSlug}`, adopt);
      params.delete("adopt");
      const newSearch = params.toString();
      const newUrl =
        window.location.pathname +
        (newSearch ? `?${newSearch}` : "") +
        window.location.hash;
      window.history.replaceState({}, "", newUrl);
    }
    return null;
  });

  const { items, loading, error, fetchCart, updateItem, removeItem, cartToken } =
    useStorefrontCart(tenantSlug);
  const currencySymbol = config?.currency_symbol || "Rs";

  useEffect(() => {
    if (cartToken) fetchCart();
  }, [cartToken, fetchCart]);

  useEffect(() => {
    setCartItemCount(items.length);
  }, [items.length, setCartItemCount]);

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.unit_price || item.price || 0) * (item.quantity || 1),
    0
  );

  if (loading && items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4 bg-white rounded-xl p-4 border border-gray-200">
              <div className="h-20 w-20 bg-gray-200 rounded-lg shrink-0" />
              <div className="grow space-y-2">
                <div className="h-4 bg-gray-200 rounded w-1/2" />
                <div className="h-4 bg-gray-200 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!cartToken || items.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <div className="mb-6">
          <svg className="mx-auto h-16 w-16 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Your cart is empty</h2>
        <p className="text-gray-500 mb-6">Browse our products and add items to your cart.</p>
        <Link
          to={`/store/${tenantSlug}/products`}
          className="inline-flex items-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Continue Shopping
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6">
        <Link to={`/store/${tenantSlug}`} className="hover:text-indigo-600">Store</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Cart</span>
      </nav>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Shopping Cart ({items.length})</h1>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cart Items */}
        <div className="lg:col-span-2 space-y-4">
          {items.map((item) => (
            <CartItem
              key={item.id}
              item={item}
              currencySymbol={currencySymbol}
              onUpdate={updateItem}
              onRemove={removeItem}
              loading={loading}
            />
          ))}
        </div>

        {/* Summary */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-xl border border-gray-200 p-6 sticky top-24">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Order Summary</h2>
            <div className="flex justify-between text-sm text-gray-600 mb-2">
              <span>Subtotal ({items.length} items)</span>
              <span>{currencySymbol} {subtotal.toLocaleString()}</span>
            </div>
            <div className="border-t border-gray-200 mt-4 pt-4">
              <div className="flex justify-between text-base font-bold text-gray-900">
                <span>Total</span>
                <span>{currencySymbol} {subtotal.toLocaleString()}</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Tax and shipping calculated at checkout</p>
            </div>
            <Link
              to={`/store/${tenantSlug}/checkout`}
              className="mt-6 block w-full text-center px-6 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Proceed to Checkout
            </Link>
            <Link
              to={`/store/${tenantSlug}/products`}
              className="mt-3 block w-full text-center px-6 py-3 border border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function CartItem({ item, currencySymbol, onUpdate, onRemove, loading }) {
  const [updating, setUpdating] = useState(false);
  const unitPrice = Number(item.unit_price || item.price || 0);
  const lineTotal = unitPrice * (item.quantity || 1);
  const imageUrl = item.image_url || null;

  async function handleQtyChange(newQty) {
    if (newQty < 1 || updating) return;
    setUpdating(true);
    await onUpdate(item.id, newQty);
    setUpdating(false);
  }

  async function handleRemove() {
    setUpdating(true);
    await onRemove(item.id);
    setUpdating(false);
  }

  return (
    <div className={`flex gap-4 bg-white rounded-xl border border-gray-200 p-4 ${updating ? "opacity-60" : ""}`}>
      {/* Thumbnail */}
      <div className="h-20 w-20 rounded-lg bg-gray-100 overflow-hidden shrink-0">
        {imageUrl ? (
          <img src={imageUrl} alt={item.product_name || item.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="grow min-w-0">
        <h3 className="text-sm font-medium text-gray-900 truncate">
          {item.product_name || item.name}
        </h3>
        {item.variant_name && (
          <p className="text-xs text-gray-500 mt-0.5">{item.variant_name}</p>
        )}
        <p className="text-sm font-medium text-gray-700 mt-1">
          {currencySymbol} {unitPrice.toLocaleString()}
        </p>

        {/* Quantity controls */}
        <div className="flex items-center gap-3 mt-2">
          <div className="flex items-center border border-gray-300 rounded-lg">
            <button
              onClick={() => handleQtyChange(item.quantity - 1)}
              disabled={updating || item.quantity <= 1}
              className="px-2.5 py-1 text-gray-600 hover:bg-gray-100 rounded-l-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              -
            </button>
            <span className="px-3 py-1 text-sm font-medium text-gray-900 min-w-[2rem] text-center">
              {item.quantity}
            </span>
            <button
              onClick={() => handleQtyChange(item.quantity + 1)}
              disabled={updating}
              className="px-2.5 py-1 text-gray-600 hover:bg-gray-100 rounded-r-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              +
            </button>
          </div>
          <button
            onClick={handleRemove}
            disabled={updating}
            className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Line Total */}
      <div className="text-right shrink-0">
        <span className="text-sm font-bold text-gray-900">
          {currencySymbol} {lineTotal.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
