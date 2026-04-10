import { useState, useCallback, useRef } from "react";
import { API_BASE } from "../../config";

export function useStorefrontCart(tenantSlug) {
  const [cartToken, setCartToken] = useState(() => {
    const stored = localStorage.getItem(`sf_cart_${tenantSlug}`);
    if (!stored || stored === "undefined" || stored === "null") return null;
    return stored;
  });
  const [cart, setCart] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const tokenRef = useRef(cartToken);

  const baseUrl = `${API_BASE}/api/storefront`;
  const qs = `?tenant=${tenantSlug}`;

  function saveToken(token) {
    tokenRef.current = token;
    setCartToken(token);
    if (token) {
      localStorage.setItem(`sf_cart_${tenantSlug}`, token);
    } else {
      localStorage.removeItem(`sf_cart_${tenantSlug}`);
    }
  }

  function applyCartData(data) {
    setCart(data);
    setItems(Array.isArray(data.items) ? data.items : []);
  }

  const initCart = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/cart${qs}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to create cart");
      const data = await res.json();
      saveToken(data.token);
      applyCartData(data);
      return data.token;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  const fetchCart = useCallback(async (token) => {
    const t = token || tokenRef.current;
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/cart/${t}${qs}`);
      if (!res.ok) {
        if (res.status === 404) {
          saveToken(null);
          setCart(null);
          setItems([]);
          return;
        }
        throw new Error("Failed to load cart");
      }
      const data = await res.json();
      applyCartData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  const ensureToken = useCallback(async () => {
    if (tokenRef.current) return tokenRef.current;
    return await initCart();
  }, [initCart]);

  const addItem = useCallback(async (productId, variantId, qty = 1) => {
    setError(null);
    const token = await ensureToken();
    if (!token) return false;
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/cart/${token}/items${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, variant_id: variantId || null, quantity: qty }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to add item");
      }
      const data = await res.json();
      applyCartData(data);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [tenantSlug, ensureToken]);

  const updateItem = useCallback(async (itemId, qty) => {
    const token = tokenRef.current;
    if (!token) return false;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/cart/${token}/items/${itemId}${qs}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity: qty }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to update item");
      }
      const data = await res.json();
      applyCartData(data);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  const removeItem = useCallback(async (itemId) => {
    const token = tokenRef.current;
    if (!token) return false;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${baseUrl}/cart/${token}/items/${itemId}${qs}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove item");
      const data = await res.json();
      applyCartData(data);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [tenantSlug]);

  const getQuote = useCallback(async (deliveryMethod, pickupOutletId, courierId) => {
    const token = tokenRef.current;
    if (!token) return null;
    setError(null);
    try {
      const res = await fetch(`${baseUrl}/cart/${token}/quote${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_method: deliveryMethod,
          pickup_outlet_id: pickupOutletId || null,
          courier_id: courierId || null,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to get quote");
      }
      return await res.json();
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, [tenantSlug]);

  const clearCart = useCallback(() => {
    saveToken(null);
    setCart(null);
    setItems([]);
  }, [tenantSlug]);

  return {
    cartToken,
    cart,
    items,
    loading,
    error,
    initCart,
    fetchCart,
    addItem,
    updateItem,
    removeItem,
    getQuote,
    clearCart,
    ensureToken,
    itemCount: items.length,
  };
}
