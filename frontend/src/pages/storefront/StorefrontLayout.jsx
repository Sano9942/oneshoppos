import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { Outlet, useParams, Link, useLocation } from "react-router-dom";
import { API_BASE } from "../../config";
import { useStorefrontCart } from "./useStorefrontCart";

const StorefrontContext = createContext(null);
export const useStorefront = () => useContext(StorefrontContext);

export default function StorefrontLayout() {
  const { tenantSlug } = useParams();
  const location = useLocation();
  const [config, setConfig] = useState(null);
  const [categories, setCategories] = useState([]);
  const [cartItemCount, setCartItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const cart = useStorefrontCart(tenantSlug);

  // Keep header cart badge in sync with the actual cart
  useEffect(() => {
    const total = (cart.items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
    setCartItemCount(total);
  }, [cart.items]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [cfgRes, catRes] = await Promise.all([
          fetch(`${API_BASE}/api/storefront/config?tenant=${tenantSlug}`),
          fetch(`${API_BASE}/api/storefront/categories?tenant=${tenantSlug}`),
        ]);
        if (!cfgRes.ok) throw new Error("Store not found");
        const cfgData = await cfgRes.json();
        const catData = catRes.ok ? await catRes.json() : [];
        if (!cancelled) {
          setConfig(cfgData);
          setCategories(Array.isArray(catData) ? catData : []);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantSlug]);

  const incrementCart = useCallback((n = 1) => {
    setCartItemCount((prev) => prev + n);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface)">
        <div className="animate-spin h-8 w-8 border-4 border-(--ui-focus) border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--ui-muted-surface)">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-(--ui-text) mb-2">Store Not Found</h1>
          <p className="text-(--ui-text-muted)">{error}</p>
        </div>
      </div>
    );
  }

  const storeName = config?.company_name || tenantSlug;
  const logoUrl = config?.logo_url;

  return (
    <StorefrontContext.Provider
      value={{ config, categories, tenantSlug, cartItemCount, setCartItemCount, incrementCart, cart }}
    >
      <div className="min-h-screen bg-(--ui-muted-surface) flex flex-col">
        {/* Header */}
        <header className="bg-(--ui-surface) border-b border-(--ui-border) sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo + Store Name */}
              <Link
                to={`/store/${tenantSlug}`}
                className="flex items-center gap-3 shrink-0"
              >
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={storeName}
                    className="h-8 w-8 rounded object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 rounded bg-(--ui-primary) flex items-center justify-center text-(--ui-on-primary) font-bold text-sm">
                    {storeName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-lg font-semibold text-(--ui-text) hidden sm:block">
                  {storeName}
                </span>
              </Link>

              {/* Desktop category nav */}
              <nav className="hidden md:flex items-center gap-6">
                <Link
                  to={`/store/${tenantSlug}/products`}
                  className="text-sm font-medium text-(--ui-text) hover:text-(--ui-link) transition-colors"
                >
                  All Products
                </Link>
                {categories.slice(0, 6).map((cat) => (
                  <Link
                    key={cat.id}
                    to={`/store/${tenantSlug}/products?category=${cat.id}`}
                    className="text-sm font-medium text-(--ui-text) hover:text-(--ui-link) transition-colors"
                  >
                    {cat.name}
                  </Link>
                ))}
              </nav>

              {/* Cart + Mobile menu */}
              <div className="flex items-center gap-3">
                {/* My Account */}
                <Link
                  to={`/portal/${tenantSlug}/login`}
                  className="p-2 text-(--ui-text) hover:text-(--ui-link) transition-colors"
                  aria-label="My Account"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                  </svg>
                </Link>

                {/* Cart icon */}
                <Link
                  to={`/store/${tenantSlug}/cart`}
                  className="relative p-2 text-(--ui-text) hover:text-(--ui-link) transition-colors"
                  aria-label="Cart"
                >
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                  {cartItemCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-(--ui-primary) text-(--ui-on-primary) text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                      {cartItemCount > 99 ? "99+" : cartItemCount}
                    </span>
                  )}
                </Link>

                {/* Mobile hamburger */}
                <button
                  className="md:hidden p-2 text-(--ui-text) hover:text-(--ui-link)"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  aria-label="Toggle menu"
                >
                  {mobileMenuOpen ? (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Mobile menu */}
          {mobileMenuOpen && (
            <div className="md:hidden border-t border-(--ui-border) bg-(--ui-surface)">
              <div className="px-4 py-3 space-y-2">
                <Link
                  to={`/store/${tenantSlug}/products`}
                  className="block px-3 py-2 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) rounded-md"
                >
                  All Products
                </Link>
                {categories.map((cat) => (
                  <Link
                    key={cat.id}
                    to={`/store/${tenantSlug}/products?category=${cat.id}`}
                    className="block px-3 py-2 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) rounded-md"
                  >
                    {cat.name}
                  </Link>
                ))}
                <Link
                  to={`/portal/${tenantSlug}/login`}
                  className="block px-3 py-2 text-sm font-medium text-(--ui-text) hover:bg-(--ui-muted-surface) rounded-md border-t border-(--ui-border) mt-2 pt-3"
                >
                  My Account
                </Link>
              </div>
            </div>
          )}
        </header>

        {/* Main content */}
        <main className="grow">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="bg-(--ui-surface) border-t border-(--ui-border) mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <p className="text-sm text-(--ui-text-muted)">
                {storeName}
              </p>
              <div className="flex items-center gap-4">
                <Link
                  to={`/portal/${tenantSlug}/login`}
                  className="text-xs text-(--ui-text-muted) hover:text-(--ui-text-muted) transition-colors"
                >
                  My Account
                </Link>
                <p className="text-xs text-(--ui-text-muted)">
                  Powered by SanoPOS
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </StorefrontContext.Provider>
  );
}
