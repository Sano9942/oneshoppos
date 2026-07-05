import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_BASE } from "../../config";

function stripHtml(html) {
  if (!html) return "";
  return String(html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

const COUNTER_RESET_MS = 5000;

export default function PublicRestaurantMenuPage() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const tenantSlug = searchParams.get("tenant");

  const [menu, setMenu] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState("all");
  const [submittingId, setSubmittingId] = useState(null);
  const [toast, setToast] = useState(null);

  // Cart state — frontend mirror of what was added. Backend is the source of
  // truth (draft_order_items rows), but we keep a shadow for the cart panel
  // so the customer sees what they've added without an extra round-trip.
  const [cart, setCart] = useState([]);

  // Confirmation screen state. After successful submit, we render a
  // full-page confirmation. Counter mode auto-resets to the menu after 5s;
  // table mode stays until the customer taps "Back to menu".
  const [confirmation, setConfirmation] = useState(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const resetTimerRef = useRef(null);

  const buildUrl = (suffix) =>
    `${API_BASE}/api/public/restaurant${suffix}${tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ""}`;

  useEffect(() => {
    let cancelled = false;
    const url = buildUrl(`/menu/${encodeURIComponent(token)}`);
    fetch(url)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || "Menu not found");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        setMenu(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, tenantSlug]);

  // Tear down auto-reset timer on unmount.
  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  const categories = useMemo(() => {
    if (!menu?.items) return [];
    const seen = new Map();
    for (const item of menu.items) {
      const id = item.category_id || "uncat";
      if (!seen.has(id)) {
        seen.set(id, { id, name: item.category_name || "Other" });
      }
    }
    return Array.from(seen.values());
  }, [menu]);

  const filteredItems = useMemo(() => {
    if (!menu?.items) return [];
    if (activeCategory === "all") return menu.items;
    return menu.items.filter((i) => (i.category_id || "uncat") === activeCategory);
  }, [menu, activeCategory]);

  const cartTotal = useMemo(
    () => cart.reduce((acc, c) => acc + Number(c.price || 0) * Number(c.quantity || 0), 0),
    [cart],
  );
  const cartCount = useMemo(
    () => cart.reduce((acc, c) => acc + Number(c.quantity || 0), 0),
    [cart],
  );

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const handleAddItem = async (product) => {
    setSubmittingId(product.id);
    try {
      const res = await fetch(buildUrl(`/checks/${encodeURIComponent(token)}/items`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: product.id, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add item");
      // Mirror in local cart. Coalesce repeats by product id.
      setCart((prev) => {
        const idx = prev.findIndex((c) => c.product_id === product.id);
        if (idx >= 0) {
          const next = prev.slice();
          next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
          return next;
        }
        return [...prev, { product_id: product.id, name: product.name, price: Number(product.price || 0), quantity: 1 }];
      });
      showToast(`${product.name} added`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmittingId(null);
    }
  };

  const handlePlaceOrder = async () => {
    if (!cart.length || submittingOrder) return;
    setSubmittingOrder(true);
    try {
      const res = await fetch(buildUrl(`/checks/${encodeURIComponent(token)}/submit`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to place order");
      setConfirmation(data);

      // Counter mode: short auto-reset so the next customer gets a fresh
      // menu. Table mode: stay on the confirmation until the customer
      // taps "Back to menu" — they may want to add another course.
      if (data.mode === "counter") {
        resetTimerRef.current = setTimeout(() => {
          setConfirmation(null);
          setCart([]);
          // Re-fetch menu so the slot gets a new draft minted lazily on
          // the next /menu hit.
          window.location.reload();
        }, COUNTER_RESET_MS);
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleBackToMenu = () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setConfirmation(null);
    setCart([]);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface)">
        <div className="animate-spin h-8 w-8 border-4 border-(--ui-warning-bg) border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface) px-4">
        <div className="text-center max-w-sm">
          <div className="mx-auto h-12 w-12 rounded-full bg-(--ui-danger-bg) flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-(--ui-danger-fg)" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-(--ui-text) mb-2">Menu Unavailable</h1>
          <p className="text-(--ui-text-muted) text-sm">{error}</p>
          <p className="mt-4 text-xs text-(--ui-text-muted)">Please ask your server for help, or scan the QR code again.</p>
        </div>
      </div>
    );
  }

  const storeName = menu?.company_name || "Restaurant";
  const logoUrl = menu?.logo_url;
  const currencySymbol = menu?.currency_symbol || "Rs";
  const tableLabel = menu?.table_label;

  // ── Confirmation screen ───────────────────────────────────────────────
  if (confirmation) {
    const isCounter = confirmation.mode === "counter";
    return (
      <div className="min-h-screen bg-(--ui-muted-surface) flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-(--ui-surface) border border-(--ui-border) rounded-2xl p-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-(--ui-success-bg) flex items-center justify-center mb-5">
            <svg className="h-8 w-8 text-(--ui-success-fg)" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>

          <h1 className="text-2xl font-bold text-(--ui-text) mb-2">Order placed</h1>

          {isCounter ? (
            <>
              <p className="text-sm text-(--ui-text-muted) mb-5">
                Show this number when you collect your order at the counter.
              </p>
              <div className="text-5xl font-bold tracking-tight text-(--ui-warning-fg) mb-6">
                {confirmation.order_number}
              </div>
              <p className="text-xs text-(--ui-text-muted)">
                Returning to menu in a few seconds…
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-(--ui-text-muted) mb-2">
                Sent to your server — please wait.
              </p>
              <p className="text-xs text-(--ui-text-muted) mb-6">
                Need to add another course? Tap below.
              </p>
              <button
                type="button"
                onClick={handleBackToMenu}
                className="inline-flex items-center gap-1 rounded-lg bg-(--ui-warning-fg) px-5 py-3 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-warning-fg)"
              >
                Back to menu
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-(--ui-muted-surface)">
      {/* Header */}
      <header className="bg-(--ui-surface) border-b border-(--ui-border) sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={storeName} className="h-9 w-9 rounded object-cover" />
          ) : (
            <div className="h-9 w-9 rounded bg-(--ui-warning-fg) flex items-center justify-center text-(--ui-on-primary) font-bold">
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-base font-semibold text-(--ui-text) truncate">{storeName}</div>
            {tableLabel && (
              <div className="text-xs text-(--ui-text-muted)">Table: <span className="font-medium text-(--ui-text)">{tableLabel}</span></div>
            )}
          </div>
        </div>

        {/* Category chips */}
        {categories.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-3">
            <div className="flex gap-2 overflow-x-auto">
              <button
                type="button"
                onClick={() => setActiveCategory("all")}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                  activeCategory === "all"
                    ? "bg-(--ui-warning-fg) text-(--ui-on-primary)"
                    : "bg-(--ui-muted-surface) text-(--ui-text) hover:bg-(--ui-muted-surface)"
                }`}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
                    activeCategory === cat.id
                      ? "bg-(--ui-warning-fg) text-(--ui-on-primary)"
                      : "bg-(--ui-muted-surface) text-(--ui-text) hover:bg-(--ui-muted-surface)"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Menu items */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-32">
        {filteredItems.length === 0 ? (
          <div className="py-16 text-center text-sm text-(--ui-text-muted)">No items in this category.</div>
        ) : (
          <ul className="space-y-3">
            {filteredItems.map((item) => {
              const plainDescription = stripHtml(item.description);
              return (
                <li key={item.id} className="bg-(--ui-surface) border border-(--ui-border) rounded-xl p-4 flex gap-3">
                  {item.image_url && (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="h-20 w-20 rounded-lg object-cover shrink-0"
                      loading="lazy"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-medium text-(--ui-text) truncate">{item.name}</h3>
                      <span className="shrink-0 text-sm font-semibold text-(--ui-text)">
                        {currencySymbol} {Number(item.price || 0).toFixed(2)}
                      </span>
                    </div>
                    {plainDescription && (
                      <p className="mt-1 text-xs text-(--ui-text-muted) line-clamp-2">{plainDescription}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAddItem(item)}
                      disabled={submittingId === item.id}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-(--ui-warning-fg) px-3 py-1.5 text-xs font-medium text-(--ui-on-primary) hover:bg-(--ui-warning-fg) disabled:opacity-50"
                    >
                      {submittingId === item.id ? "Adding..." : "+ Add to order"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-center text-xs text-(--ui-text-muted)">Powered by SanoPOS</p>
      </main>

      {/* Sticky Place Order CTA */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-(--ui-border) bg-(--ui-surface) shadow-lg">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-(--ui-text-muted)">{cartCount} item{cartCount === 1 ? "" : "s"} in your order</div>
              <div className="text-base font-semibold text-(--ui-text)">
                {currencySymbol} {cartTotal.toFixed(2)}
              </div>
            </div>
            <button
              type="button"
              onClick={handlePlaceOrder}
              disabled={submittingOrder}
              data-testid="place-order"
              className="inline-flex items-center gap-1 rounded-lg bg-(--ui-warning-fg) px-5 py-3 text-sm font-medium text-(--ui-on-primary) hover:bg-(--ui-warning-fg) disabled:opacity-50"
            >
              {submittingOrder ? "Placing…" : "Place Order"}
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)]">
          <div
            className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              toast.type === "error" ? "bg-(--ui-danger-fg) text-(--ui-on-primary)" : "bg-(--ui-primary) text-(--ui-on-primary)"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
