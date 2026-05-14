import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { ArrowLeft, Plus, Minus, Trash2, Search, Check } from "lucide-react";
import { api } from "../../../api";
import { useAuth } from "../../../auth/AuthProvider";
import { useCurrency } from "../../../contexts/CurrencyContext";
import { useToast } from "../../../contexts/ToastContext";
import useFeatureFlags from "../../../hooks/useFeatureFlags";
import {
  enqueueFieldOrder,
  markSyncing,
  markSynced,
  markFailed,
} from "../../../utils/offlineQueue";

function newUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `cuid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function FieldOrderRedesign() {
  const { customer_id } = useParams();
  const [searchParams] = useSearchParams();
  const visitUuid = searchParams.get("visit_uuid") || null;
  const navigate = useNavigate();
  const { employee, authHeaders, hasPerm } = useAuth();
  const { fmt } = useCurrency();
  const { success: toastOk, error: toastErr } = useToast();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);

  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [credit, setCredit] = useState(null); // { utilization_pct, available, ... }
  const [outlet, setOutlet] = useState(null);
  const [products, setProducts] = useState([]);

  const [search, setSearch] = useState("");
  const [cart, setCart] = useState({}); // { [productId]: { id, name, price, quantity } }
  const [paymentMethod, setPaymentMethod] = useState("credit");
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  // Load customer, credit status, outlet, products in parallel.
  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    let cancelled = false;
    async function load() {
      try {
        const [route, outletsResp, productsResp] = await Promise.all([
          api.get("/api/field/route/today"),
          api.get("/api/outlets"),
          api.get("/api/products", { status: "active" }),
        ]);
        if (cancelled) return;
        const found = route.customers.find(
          (c) => String(c.customer_id) === String(customer_id)
        );
        setCustomer(found || null);

        // Credit status — only matters when payment_method is credit. Best-
        // effort: failures fall back to "no credit info" rather than blocking.
        try {
          const credResp = await api.get(`/api/customers/${customer_id}/credit-status`);
          if (!cancelled) setCredit(credResp || null);
        } catch { /* ignore — owner may have credit disabled */ }

        const outlets = Array.isArray(outletsResp)
          ? outletsResp
          : outletsResp?.outlets || [];
        setOutlet(outlets[0] || null);
        setProducts(productsResp?.products || []);
      } catch (e) {
        if (!cancelled) toastErr(e.message || "Failed to load order screen");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [customer_id, flagsLoading, flags.wholesale_field_sales]); // eslint-disable-line react-hooks/exhaustive-deps

  const cartItems = useMemo(() => Object.values(cart), [cart]);
  const cartTotal = useMemo(
    () => cartItems.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0),
    [cartItems]
  );
  const cartCount = useMemo(
    () => cartItems.reduce((sum, it) => sum + Number(it.quantity), 0),
    [cartItems]
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    return products
      .filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.barcode || "").toLowerCase().includes(q) ||
          (p.sku || "").toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [products, search]);

  const addToCart = (p) => {
    setCart((c) => {
      const existing = c[p.id];
      const nextQty = existing ? Number(existing.quantity) + 1 : 1;
      return {
        ...c,
        [p.id]: {
          id: p.id,
          name: p.name,
          price: Number(p.price || 0),
          quantity: nextQty,
        },
      };
    });
  };
  const decrement = (id) => {
    setCart((c) => {
      const existing = c[id];
      if (!existing) return c;
      const nextQty = Number(existing.quantity) - 1;
      if (nextQty <= 0) {
        const { [id]: _drop, ...rest } = c;
        return rest;
      }
      return { ...c, [id]: { ...existing, quantity: nextQty } };
    });
  };
  const removeFromCart = (id) => {
    setCart((c) => {
      const { [id]: _drop, ...rest } = c;
      return rest;
    });
  };

  // Soft credit warning — does NOT block submit. Backend enforces the actual
  // limit (hard-block mode rejects with CREDIT_LIMIT_EXCEEDED unless caller
  // has override_credit_limit or manager_pin).
  const creditWarning = useMemo(() => {
    if (paymentMethod !== "credit") return null;
    if (!credit) return null;
    const available = Number(credit.available || 0);
    if (cartTotal > available) {
      return `Order Rs ${cartTotal.toFixed(0)} exceeds available credit Rs ${available.toFixed(0)}.`;
    }
    return null;
  }, [paymentMethod, credit, cartTotal]);

  const submit = async () => {
    if (submittedRef.current) return;
    if (cartItems.length === 0) {
      toastErr("Cart is empty");
      return;
    }
    if (!outlet) {
      toastErr("No outlet available for this tenant");
      return;
    }
    submittedRef.current = true;
    setSubmitting(true);

    const idempotency_key = newUuid();
    const payload = {
      idempotency_key,
      outlet_id: Number(outlet.id),
      employee_id: Number(employee.id),
      customer_id: Number(customer_id),
      cartItems: cartItems.map((it) => ({
        id: it.id,
        price: it.price,
        quantity: it.quantity,
      })),
      payments: [{ method: paymentMethod, amount: cartTotal }],
      paymentMethod,
      discount_amount: 0,
      discount_type: "fixed",
      field_visit_uuid: visitUuid,
    };

    // Optimistic flow: enqueue locally first, then try to sync.
    try {
      await enqueueFieldOrder(employee.id, payload);
    } catch (e) {
      toastErr(e.message || "Could not save order locally");
      setSubmitting(false);
      submittedRef.current = false;
      return;
    }

    try {
      await markSyncing(idempotency_key);
      await api.post("/api/sales", payload);
      await markSynced(idempotency_key);
      toastOk("Order recorded");
    } catch (e) {
      // Hard credit-limit reject from backend → keep order out of queue and
      // let the rep retry with a smaller cart. Soft credit warning above
      // already alerted; if rep still tried, this is the backend saying no.
      const code = e?.body?.code;
      if (code === "CREDIT_LIMIT_EXCEEDED" || code === "CREDIT_OVERPAYMENT") {
        await markSynced(idempotency_key); // remove from queue — don't auto-retry
        toastErr(e.message || "Order blocked by credit limit");
        setSubmitting(false);
        submittedRef.current = false;
        return;
      }
      await markFailed(idempotency_key, e.message);
      toastOk("Saved offline — will sync when connection returns");
    } finally {
      setSubmitting(false);
      navigate("/field/today");
    }
  };

  if (flagsLoading || loading) {
    return (
      <div className="min-h-screen bg-(--ui-bg) p-4">
        <div className="animate-pulse h-32 bg-(--ui-muted-surface) rounded-xl" />
      </div>
    );
  }
  if (!flags.wholesale_field_sales) return <Navigate to="/" replace />;
  if (!hasPerm("manage_field_sales")) return <Navigate to="/" replace />;
  if (!customer) {
    return (
      <div className="min-h-screen bg-(--ui-bg) p-4">
        <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 p-4">
          Customer not found on today's route.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-(--ui-bg) pb-40">
      <header className="sticky top-0 z-10 bg-(--ui-surface) border-b border-(--ui-border) px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/field/today")}
          className="p-1 text-(--ui-text-muted) hover:text-(--ui-text)"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-(--ui-text-muted)">
            Take order
          </div>
          <div className="text-lg font-semibold text-(--ui-text) truncate">
            {customer.name}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-(--ui-text-muted)">Items</div>
          <div className="text-sm font-semibold text-(--ui-text)">{cartCount}</div>
        </div>
      </header>

      {/* Credit status banner — only shown when relevant */}
      {credit && (
        <div className="px-4 pt-3">
          <div className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3 text-xs text-(--ui-text-muted) flex items-center justify-between">
            <span>Credit available</span>
            <span className="font-medium text-(--ui-text)">
              {fmt(Number(credit.available || 0))}
            </span>
          </div>
        </div>
      )}

      {/* Product search */}
      <div className="px-4 pt-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-(--ui-text-muted)" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products by name, barcode, SKU"
            className="w-full rounded-lg border border-(--ui-border) bg-(--ui-surface) py-2 pl-9 pr-3 text-sm focus:outline-none focus:border-(--ui-primary)"
          />
        </div>
      </div>

      {/* Product list */}
      <div className="px-4 pt-3 space-y-2">
        {filteredProducts.length === 0 && (
          <div className="text-center text-sm text-(--ui-text-muted) py-8">
            {search ? "No matching products" : "Type to search products"}
          </div>
        )}
        {filteredProducts.map((p) => {
          const inCart = cart[p.id];
          return (
            <div
              key={p.id}
              className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-(--ui-text) truncate">
                  {p.name}
                </div>
                <div className="text-xs text-(--ui-text-muted)">{fmt(Number(p.price || 0))}</div>
              </div>
              {inCart ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => decrement(p.id)}
                    className="h-9 w-9 rounded-full bg-(--ui-muted-surface) text-(--ui-text) inline-flex items-center justify-center"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <div className="w-8 text-center text-sm font-semibold">
                    {inCart.quantity}
                  </div>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    className="h-9 w-9 rounded-full bg-(--ui-primary) text-white inline-flex items-center justify-center"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => addToCart(p)}
                  className="rounded-lg bg-(--ui-primary) text-white px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1"
                >
                  <Plus className="h-4 w-4" /> Add
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Cart summary + tender + submit (sticky bottom) */}
      <div className="fixed bottom-0 inset-x-0 bg-(--ui-surface) border-t border-(--ui-border) p-3 space-y-2">
        {cartItems.length > 0 && (
          <div className="max-h-36 overflow-y-auto -mx-3 px-3 space-y-1">
            {cartItems.map((it) => (
              <div key={it.id} className="flex items-center justify-between text-xs">
                <div className="flex-1 min-w-0 truncate">
                  {it.name}{" "}
                  <span className="text-(--ui-text-muted)">× {it.quantity}</span>
                </div>
                <div className="ml-2 tabular-nums">
                  {fmt(Number(it.price) * Number(it.quantity))}
                </div>
                <button
                  type="button"
                  onClick={() => removeFromCart(it.id)}
                  className="ml-2 text-(--ui-text-muted) hover:text-red-600"
                  aria-label="Remove"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setPaymentMethod("credit")}
            className={`rounded-lg py-2 text-sm font-medium border ${
              paymentMethod === "credit"
                ? "bg-(--ui-primary) text-white border-(--ui-primary)"
                : "bg-(--ui-surface) text-(--ui-text) border-(--ui-border)"
            }`}
          >
            Credit (A/R)
          </button>
          <button
            type="button"
            onClick={() => setPaymentMethod("Cash")}
            className={`rounded-lg py-2 text-sm font-medium border ${
              paymentMethod === "Cash"
                ? "bg-(--ui-primary) text-white border-(--ui-primary)"
                : "bg-(--ui-surface) text-(--ui-text) border-(--ui-border)"
            }`}
          >
            Cash
          </button>
        </div>

        {creditWarning && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {creditWarning}
          </div>
        )}

        <button
          type="button"
          disabled={submitting || cartItems.length === 0}
          onClick={submit}
          className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <Check className="h-4 w-4" />
          Confirm order · {fmt(cartTotal)}
        </button>
      </div>
    </div>
  );
}
