import { useEffect, useMemo, useState } from "react";
import { api } from "../../../../api";
import { useCurrency } from "../../../../contexts/CurrencyContext";
import { usePOS } from "../POSContext";

// W42 — counter-service tile grid for cafe / quick-service tenants.
// Replaces the restaurant POS's POSLayouts-driven tile block when
// pos_layout_mode === 'counter'. Loads the full product list once on
// mount, groups by category, renders category tabs + a 4-column grid.
// Tap a tile → addToCart (which is addToCartWithModifiers under the hood,
// so modifier-bearing items still open POSModifierModal automatically).

const ALL_TAB = { id: "__all__", name: "All Items" };

export default function CounterTileGrid() {
  const { addToCart, selectedOutletId } = usePOS();
  const { fmt } = useCurrency();

  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  const [activeTabId, setActiveTabId] = useState(ALL_TAB.id);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const params = selectedOutletId ? { outlet_id: selectedOutletId } : undefined;
        const res = await api.get("/api/products", params);
        const list = Array.isArray(res?.products) ? res.products : [];
        if (!cancelled) {
          setProducts(list.filter((p) => p && p.status !== "inactive" && p.deleted_at == null));
        }
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "Failed to load menu");
          setProducts([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedOutletId]);

  const tabs = useMemo(() => {
    if (!products?.length) return [ALL_TAB];
    const seen = new Map();
    for (const p of products) {
      if (p.category_id && p.category_name && !seen.has(p.category_id)) {
        seen.set(p.category_id, { id: p.category_id, name: p.category_name });
      }
    }
    const cats = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
    return cats.length ? [ALL_TAB, ...cats] : [ALL_TAB];
  }, [products]);

  const visibleProducts = useMemo(() => {
    if (!products?.length) return [];
    if (activeTabId === ALL_TAB.id) return products;
    return products.filter((p) => p.category_id === activeTabId);
  }, [products, activeTabId]);

  if (products === null) {
    return <div className="text-xs text-slate-500 px-1 py-2">Loading menu…</div>;
  }

  if (error) {
    return <div className="text-xs text-rose-600 px-1 py-2">{error}</div>;
  }

  if (!products.length) {
    return (
      <div className="text-xs text-slate-500 px-1 py-2">
        No menu items yet. Add products in Inventory to see them here.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tabs.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
          {tabs.map((t) => {
            const isActive = t.id === activeTabId;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTabId(t.id)}
                className={`shrink-0 px-3 h-9 rounded-lg text-xs font-bold transition ${
                  isActive
                    ? "bg-[#8066FF] text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                }`}
              >
                {t.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        {visibleProducts.map((p) => (
          <CounterTile key={p.id} product={p} fmt={fmt} onAdd={() => addToCart(p)} />
        ))}
      </div>

      {visibleProducts.length === 0 && (
        <div className="text-xs text-slate-500 px-1 py-2">No items in this category.</div>
      )}
    </div>
  );
}

function CounterTile({ product, fmt, onAdd }) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = product.image_url && !imgFailed;
  const price = Number(product.price || 0);

  return (
    <button
      onClick={onAdd}
      className="min-h-[100px] rounded-lg bg-white border border-slate-200 hover:border-[#8066FF] hover:shadow-md flex flex-col overflow-hidden transition text-left"
    >
      <div className="h-12 bg-slate-50 flex items-center justify-center overflow-hidden">
        {showImage ? (
          <img
            src={product.image_url}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
            {(product.name || "?").slice(0, 2)}
          </span>
        )}
      </div>
      <div className="flex-1 px-2 py-1.5 flex flex-col justify-between">
        <div className="text-xs font-bold text-slate-900 line-clamp-2 leading-tight">
          {product.name}
        </div>
        <div className="text-xs font-black text-[#8066FF] mt-1">{fmt(price)}</div>
      </div>
    </button>
  );
}
