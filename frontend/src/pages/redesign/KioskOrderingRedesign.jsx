import { useState, useEffect, useCallback } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/AuthProvider";
import useFeatureFlags from "../../hooks/useFeatureFlags";
import { useToast } from "../../contexts/ToastContext";
import { useCurrency } from "../../contexts/CurrencyContext";
import { PageShell, SectionCard, Button, Badge } from "../../ui/primitives";
import { ShoppingCart, Plus, Minus, Trash2, ChevronRight, ArrowLeft } from "lucide-react";
import { api } from "../../api";

export default function KioskOrderingRedesign() {
  const { authHeaders } = useAuth();
  const { flags, loading: flagsLoading } = useFeatureFlags(authHeaders);
  const toast = useToast();
  const { fmt } = useCurrency();
  const [searchParams] = useSearchParams();

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("menu"); // menu | cart | confirm
  const [orderName, setOrderName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [orderResult, setOrderResult] = useState(null);

  const tableId = searchParams.get("table");

  if (!flagsLoading && !flags.phase4_restaurant_qr) return <Navigate to="/dashboard" replace />;

  const loadMenu = useCallback(async () => {
    setLoading(true);
    try {
      const [catData, prodData] = await Promise.all([
        api.get("/restaurant/kiosk/categories").catch(() => ({ categories: [] })),
        api.get("/restaurant/kiosk/products").catch(() => ({ products: [] })),
      ]);
      setCategories(catData.categories || []);
      setProducts(prodData.products || []);
      if (catData.categories?.length) setActiveCategory(catData.categories[0].id);
    } catch (err) { toast.error(err.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadMenu(); }, [loadMenu]);

  const filteredProducts = activeCategory
    ? products.filter(p => p.category_id === activeCategory)
    : products;

  const addToCart = (product) => {
    setCart(prev => {
      const existing = prev.find(c => c.id === product.id);
      if (existing) return prev.map(c => c.id === product.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { id: product.id, name: product.name, price: Number(product.price), quantity: 1 }];
    });
  };

  const updateQty = (productId, delta) => {
    setCart(prev => prev.map(c => {
      if (c.id !== productId) return c;
      const newQty = c.quantity + delta;
      return newQty > 0 ? { ...c, quantity: newQty } : c;
    }).filter(c => c.quantity > 0));
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(c => c.id !== productId));
  };

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const cartCount = cart.reduce((s, c) => s + c.quantity, 0);

  const submitOrder = async () => {
    setSubmitting(true);
    try {
      const result = await api.post("/restaurant/kiosk/orders", {
        table_id: tableId ? Number(tableId) : undefined,
        customer_name: orderName || undefined,
        items: cart.map(c => ({ product_id: c.id, quantity: c.quantity })),
      });
      setOrderResult(result);
      setStep("confirm");
      setCart([]);
    } catch (err) { toast.error(err.message); }
    finally { setSubmitting(false); }
  };

  // Confirmation screen
  if (step === "confirm" && orderResult) {
    return (
      <PageShell title="Order Placed">
        <div className="text-center py-16 max-w-md mx-auto">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Order Confirmed</h2>
          <p className="text-(--ui-text-muted) mb-2">Order #{orderResult.order_number || orderResult.id}</p>
          {orderResult.estimated_time && (
            <p className="text-sm text-(--ui-text-muted)">Estimated time: {orderResult.estimated_time} minutes</p>
          )}
          <Button className="mt-8" onClick={() => { setStep("menu"); setOrderResult(null); setOrderName(""); }}>
            Place Another Order
          </Button>
        </div>
      </PageShell>
    );
  }

  // Cart review screen
  if (step === "cart") {
    return (
      <PageShell title="Review Order" right={
        <Button tone="plain" onClick={() => setStep("menu")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Menu
        </Button>
      }>
        <div className="max-w-lg mx-auto">
          <SectionCard>
            {cart.length === 0 ? (
              <p className="text-center text-(--ui-text-muted) py-8">Your cart is empty</p>
            ) : (
              <div className="space-y-3">
                {cart.map(item => (
                  <div key={item.id} className="flex items-center justify-between py-2 border-b border-(--ui-border) last:border-0">
                    <div className="grow">
                      <div className="font-medium">{item.name}</div>
                      <div className="text-sm text-(--ui-text-muted)">{fmt(item.price)} each</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(item.id, -1)} className="w-7 h-7 rounded-full border border-(--ui-border) flex items-center justify-center hover:bg-(--ui-bg-hover)">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-6 text-center font-medium">{item.quantity}</span>
                      <button onClick={() => updateQty(item.id, 1)} className="w-7 h-7 rounded-full border border-(--ui-border) flex items-center justify-center hover:bg-(--ui-bg-hover)">
                        <Plus className="w-3 h-3" />
                      </button>
                      <button onClick={() => removeFromCart(item.id)} className="p-1 text-red-500 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="w-20 text-right font-medium">{fmt(item.price * item.quantity)}</div>
                  </div>
                ))}

                <div className="flex justify-between pt-3 text-lg font-bold">
                  <span>Total</span>
                  <span>{fmt(cartTotal)}</span>
                </div>
              </div>
            )}
          </SectionCard>

          {cart.length > 0 && (
            <SectionCard className="mt-4">
              <label className="block text-sm font-medium mb-1">Your Name (optional)</label>
              <input className="w-full border border-(--ui-border) rounded px-3 py-2 bg-(--ui-bg) mb-4"
                placeholder="For order pickup" value={orderName} onChange={e => setOrderName(e.target.value)} />
              <Button className="w-full" onClick={submitOrder} disabled={submitting}>
                {submitting ? "Placing Order..." : `Place Order — ${fmt(cartTotal)}`}
              </Button>
            </SectionCard>
          )}
        </div>
      </PageShell>
    );
  }

  // Menu browsing screen
  return (
    <PageShell title="Order" subtitle={tableId ? `Table ${tableId}` : "Self-service kiosk"}>
      {/* Category tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        {categories.map(cat => (
          <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
            className={`px-4 py-2 rounded-full text-sm whitespace-nowrap ${activeCategory === cat.id ? "bg-(--ui-primary) text-white" : "bg-(--ui-bg-hover) text-(--ui-text)"}`}>
            {cat.name}
          </button>
        ))}
      </div>

      {/* Products grid */}
      {loading ? <p className="text-(--ui-text-muted) text-center py-8">Loading menu...</p> : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filteredProducts.map(p => (
            <div key={p.id} className="border border-(--ui-border) rounded-lg overflow-hidden bg-(--ui-bg) hover:shadow-md transition-shadow">
              {p.image_url && (
                <img src={p.image_url} alt={p.name} className="w-full h-32 object-cover" />
              )}
              <div className="p-3">
                <div className="font-medium text-sm">{p.name}</div>
                {p.description && <p className="text-xs text-(--ui-text-muted) line-clamp-2 mt-1">{p.description}</p>}
                <div className="flex justify-between items-center mt-2">
                  <span className="font-bold">{fmt(p.price)}</span>
                  <Button size="sm" onClick={() => addToCart(p)}>
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Floating cart button */}
      {cartCount > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
          <Button className="shadow-lg px-6 py-3 text-base" onClick={() => setStep("cart")}>
            <ShoppingCart className="w-5 h-5 mr-2" />
            View Cart ({cartCount}) — {fmt(cartTotal)}
            <ChevronRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      )}
    </PageShell>
  );
}
