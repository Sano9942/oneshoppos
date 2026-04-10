import { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API_BASE } from "../../config";

function stripHtml(html) {
  if (!html) return "";
  return String(html).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

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

  useEffect(() => {
    let cancelled = false;
    const url = `${API_BASE}/api/public/restaurant/menu/${encodeURIComponent(token)}${
      tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ""
    }`;
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
  }, [token, tenantSlug]);

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

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  };

  const handleAddItem = async (product) => {
    setSubmittingId(product.id);
    try {
      const url = `${API_BASE}/api/public/restaurant/checks/${encodeURIComponent(token)}/items${
        tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ""
      }`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: product.id, quantity: 1 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add item");
      showToast(`${product.name} added to your order`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmittingId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin h-8 w-8 border-4 border-amber-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-sm">
          <div className="mx-auto h-12 w-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Menu Unavailable</h1>
          <p className="text-gray-500 text-sm">{error}</p>
          <p className="mt-4 text-xs text-gray-400">Please ask your server for help, or scan the QR code again.</p>
        </div>
      </div>
    );
  }

  const storeName = menu?.company_name || "Restaurant";
  const logoUrl = menu?.logo_url;
  const currencySymbol = menu?.currency_symbol || "Rs";
  const tableLabel = menu?.table_label;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={storeName} className="h-9 w-9 rounded object-cover" />
          ) : (
            <div className="h-9 w-9 rounded bg-amber-600 flex items-center justify-center text-white font-bold">
              {storeName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900 truncate">{storeName}</div>
            {tableLabel && (
              <div className="text-xs text-gray-500">Table: <span className="font-medium text-gray-700">{tableLabel}</span></div>
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
                    ? "bg-amber-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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
                      ? "bg-amber-600 text-white"
                      : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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
      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 pb-24">
        {filteredItems.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">No items in this category.</div>
        ) : (
          <ul className="space-y-3">
            {filteredItems.map((item) => {
              const plainDescription = stripHtml(item.description);
              return (
                <li key={item.id} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-3">
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
                      <h3 className="font-medium text-gray-900 truncate">{item.name}</h3>
                      <span className="shrink-0 text-sm font-semibold text-gray-900">
                        {currencySymbol} {Number(item.price || 0).toFixed(2)}
                      </span>
                    </div>
                    {plainDescription && (
                      <p className="mt-1 text-xs text-gray-500 line-clamp-2">{plainDescription}</p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleAddItem(item)}
                      disabled={submittingId === item.id}
                      className="mt-2 inline-flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {submittingId === item.id ? "Adding..." : "+ Add to order"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-center text-xs text-gray-400">Powered by SanoPOS</p>
      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-sm w-[calc(100%-2rem)]">
          <div
            className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
              toast.type === "error" ? "bg-red-600 text-white" : "bg-gray-900 text-white"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
