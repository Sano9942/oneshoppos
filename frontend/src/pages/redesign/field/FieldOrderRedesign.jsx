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

  // Tier 1.3 wholesale schemes — debounced quote against the cart. Mirrors
  // POS's useCart auto-promotions behavior but inlined for the rep app.
  const [appliedPromotions, setAppliedPromotions] = useState([]);
  const [promoDiscount, setPromoDiscount] = useState(0);

  // Load customer, credit status, outlet, products in parallel.
  useEffect(() => {
    if (flagsLoading || !flags.wholesale_field_sales) return;
    let cancelled = false;
    async function load() {
      // Use allSettled so a 403 / transient failure on /api/products or
      // /api/outlets doesn't blank the customer lookup. The route load is
      // the only critical fetch — if that fails the page is unusable.
      const [routeR, outletsR, productsR, creditR] = await Promise.allSettled([
        api.get("/api/field/route/today"),
        api.get("/api/outlets"),
        // Tier 2.11 — pass customer_id so backend filters the catalog to
        // what this customer is allowed to see (visibility='all' + any
        // restricted SKUs whose customer_group_products row matches).
        api.get("/api/products", { status: "active", customer_id }),
        api.get(`/api/customers/${customer_id}/credit-status`),
      ]);
      if (cancelled) return;

      if (routeR.status === "fulfilled") {
        const found = routeR.value.customers.find(
          (c) => String(c.customer_id) === String(customer_id)
        );
        setCustomer(found || null);
      } else {
        toastErr(routeR.reason?.message || "Failed to load today's route");
      }

      if (outletsR.status === "fulfilled") {
        const outlets = Array.isArray(outletsR.value)
          ? outletsR.value
          : outletsR.value?.outlets || [];
        setOutlet(outlets[0] || null);
      }

      if (productsR.status === "fulfilled") {
        setProducts(productsR.value?.products || []);
      } else {
        toastErr("Could not load products list");
      }

      if (creditR.status === "fulfilled") {
        setCredit(creditR.value || null);
      } // else: owner may have credit disabled — ignore silently

      setLoading(false);
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

  // Tier 1.3: debounce 400ms after cart changes, then quote /api/promotions.
  // Pass category_id + brand_id hydrated from the products map so brand-scoped
  // and slab schemes evaluate correctly.
  useEffect(() => {
    if (!cartItems.length) {
      setAppliedPromotions([]);
      setPromoDiscount(0);
      return undefined;
    }
    const productMap = new Map(products.map((p) => [Number(p.id), p]));
    const quoteItems = cartItems.map((it) => {
      const p = productMap.get(Number(it.id)) || {};
      return {
        product_id: Number(it.id),
        category_id: p.category_id || null,
        brand_id: p.brand_id || null,
        quantity: Number(it.quantity || 0),
        price: Number(it.price || 0),
      };
    });
    const orderTotal = quoteItems.reduce((s, i) => s + i.price * i.quantity, 0);
    const timer = setTimeout(async () => {
      try {
        const data = await api.post("/api/promotions/quote", {
          items: quoteItems,
          order_total: orderTotal,
        });
        setAppliedPromotions(data?.applied_promotions || []);
        setPromoDiscount(Number(data?.total_promotion_discount || 0));
      } catch {
        // Soft fail — schemes are best-effort, sale still goes through.
        setAppliedPromotions([]);
        setPromoDiscount(0);
      }
    }, 400);
    return () => clearTimeout(timer);
    // Re-quote when cart contents change OR products list arrives (so hydrated
    // brand_id/category_id flow through). map().join() stringifies the cart so
    // the dep is value-equal across renders.
  }, [cartItems.map((c) => `${c.id}:${c.quantity}:${c.price}`).join(","), products.length]);

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

  // Tier 2.2 — every product carries min_order_qty + order_increment. The
  // rep app pre-blocks bad qtys so a /api/sales 400 only happens on a stale
  // catalog. Each tap on +/- moves by `increment`, and `min_order_qty` is the
  // first-add seed value.
  const addToCart = (p) => {
    setCart((c) => {
      const existing = c[p.id];
      const minQty = Number(p.min_order_qty || 0);
      const increment = Math.max(1, Number(p.order_increment || 1));
      const seed = Math.max(minQty, increment, 1);
      const nextQty = existing ? Number(existing.quantity) + increment : seed;
      return {
        ...c,
        [p.id]: {
          id: p.id,
          name: p.name,
          price: Number(p.price || 0),
          quantity: nextQty,
          min_order_qty: minQty,
          order_increment: increment,
        },
      };
    });
  };
  const decrement = (id) => {
    setCart((c) => {
      const existing = c[id];
      if (!existing) return c;
      const increment = Math.max(1, Number(existing.order_increment || 1));
      const minQty = Number(existing.min_order_qty || 0);
      const nextQty = Number(existing.quantity) - increment;
      // Drop the line when going below the min (or below 1 if no min) — that
      // matches how the +/- buttons behave on the storefront cart.
      if (nextQty <= 0 || (minQty > 0 && nextQty < minQty)) {
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
    // Apply scheme discount upfront so the payment amount matches the post-
    // discount total. POS folds promo discount into discount_amount the same
    // way (see useCheckout.completeSale). Backend persists applied_promotions
    // into sale_promotion_applications for audit.
    const promoDiscountSafe = Math.max(0, Math.min(promoDiscount, cartTotal));
    const netTotal = Math.max(0, cartTotal - promoDiscountSafe);
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
      payments: [{ method: paymentMethod, amount: netTotal }],
      paymentMethod,
      discount_amount: promoDiscountSafe,
      discount_type: "fixed",
      field_visit_uuid: visitUuid,
      applied_promotions: appliedPromotions,
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
      // Tier 2.2 MOQ — frontend pre-block normally catches these, but a
      // stale catalog (rep app cached pre-rule, owner just set MOQ) can
      // still produce a server 400. Don't queue for retry; let the rep
      // adjust the cart and resubmit.
      if (code === "MOQ_VIOLATION") {
        await markSynced(idempotency_key);
        const violations = e?.body?.violations || [];
        const detail = violations
          .map((v) => `${v.name} (qty ${v.quantity}; min ${v.min_order_qty}, case ${v.order_increment})`)
          .join("; ");
        toastErr(detail ? `MOQ violation: ${detail}` : e.message || "Order violates MOQ");
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
        <div className="rounded-xl bg-(--ui-danger-bg) border border-(--ui-danger-bg) text-(--ui-danger-fg) p-4">
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
          const minQty = Number(p.min_order_qty || 0);
          const increment = Math.max(1, Number(p.order_increment || 1));
          const moqHintParts = [];
          if (minQty > 1) moqHintParts.push(`Min ${minQty}`);
          if (increment > 1) moqHintParts.push(`Case ${increment}`);
          const moqHint = moqHintParts.length ? moqHintParts.join(" · ") : null;
          return (
            <div
              key={p.id}
              className="rounded-lg border border-(--ui-border) bg-(--ui-surface) p-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-(--ui-text) truncate">
                  {p.name}
                </div>
                <div className="text-xs text-(--ui-text-muted)">
                  {fmt(Number(p.price || 0))}
                  {moqHint && (
                    <span className="ml-2 text-(--ui-warning-fg) font-medium">({moqHint})</span>
                  )}
                </div>
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
                    className="h-9 w-9 rounded-full bg-(--ui-primary) text-(--ui-on-primary) inline-flex items-center justify-center"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => addToCart(p)}
                  className="rounded-lg bg-(--ui-primary) text-(--ui-on-primary) px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1"
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
                  className="ml-2 text-(--ui-text-muted) hover:text-(--ui-danger-fg)"
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
                ? "bg-(--ui-primary) text-(--ui-on-primary) border-(--ui-primary)"
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
                ? "bg-(--ui-primary) text-(--ui-on-primary) border-(--ui-primary)"
                : "bg-(--ui-surface) text-(--ui-text) border-(--ui-border)"
            }`}
          >
            Cash
          </button>
        </div>

        {appliedPromotions.length > 0 && (
          <div className="text-xs bg-(--ui-success-bg) border border-(--ui-success-bg) rounded-lg px-3 py-2 space-y-1">
            <div className="flex items-center justify-between font-medium text-(--ui-success-fg)">
              <span>Scheme discount</span>
              <span className="tabular-nums">-{fmt(promoDiscount)}</span>
            </div>
            <div className="text-(--ui-success-fg)">
              {appliedPromotions
                .map((ap) => ap.name + (ap.qty_qualifying ? ` (${ap.qty_qualifying} qty)` : ""))
                .join(", ")}
            </div>
          </div>
        )}

        {creditWarning && (
          <div className="text-xs text-(--ui-warning-fg) bg-(--ui-warning-bg) border border-(--ui-warning-bg) rounded-lg px-3 py-2">
            {creditWarning}
          </div>
        )}

        <button
          type="button"
          disabled={submitting || cartItems.length === 0}
          onClick={submit}
          className="w-full rounded-lg bg-(--ui-success-fg) hover:bg-(--ui-success-fg) text-(--ui-on-primary) font-semibold py-3 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
        >
          <Check className="h-4 w-4" />
          Confirm order · {fmt(Math.max(0, cartTotal - promoDiscount))}
        </button>
      </div>
    </div>
  );
}
