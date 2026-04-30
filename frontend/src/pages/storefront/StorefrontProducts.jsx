import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { API_BASE } from "../../config";
import { useStorefront } from "./StorefrontLayout";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: Low to High" },
  { value: "price_desc", label: "Price: High to Low" },
  { value: "name_asc", label: "Name A-Z" },
];

const PAGE_SIZE = 20;

export default function StorefrontProducts() {
  const { config, categories, tenantSlug } = useStorefront();
  const [searchParams, setSearchParams] = useSearchParams();

  const categoryId = searchParams.get("category") || "";
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [sort, setSort] = useState(searchParams.get("sort") || "newest");
  const [page, setPage] = useState(Number(searchParams.get("page")) || 1);

  const [products, setProducts] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const currencySymbol = config?.currency_symbol || "Rs";
  const debounceRef = useRef(null);
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Debounce search input
  const handleSearchChange = useCallback((val) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 300);
  }, []);

  // Fetch products
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ tenant: tenantSlug, limit: PAGE_SIZE, page });
    if (categoryId) params.set("category", categoryId);
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (sort) params.set("sort", sort);

    fetch(`${API_BASE}/api/storefront/products?${params}`)
      .then((r) => (r.ok ? r.json() : { products: [], totalPages: 1 }))
      .then((data) => {
        if (!cancelled) {
          setProducts(Array.isArray(data.products) ? data.products : Array.isArray(data) ? data : []);
          setTotalPages(data.totalPages || data.total_pages || 1);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tenantSlug, categoryId, debouncedSearch, sort, page]);

  // Sync params to URL
  useEffect(() => {
    const p = new URLSearchParams();
    if (categoryId) p.set("category", categoryId);
    if (debouncedSearch) p.set("q", debouncedSearch);
    if (sort !== "newest") p.set("sort", sort);
    if (page > 1) p.set("page", page);
    setSearchParams(p, { replace: true });
  }, [categoryId, debouncedSearch, sort, page, setSearchParams]);

  const activeCategoryName = categoryId
    ? categories.find((c) => String(c.id) === String(categoryId))?.name
    : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {activeCategoryName || "All Products"}
        </h1>
        {activeCategoryName && (
          <Link
            to={`/store/${tenantSlug}/products`}
            className="text-sm text-indigo-600 hover:text-indigo-700 mt-1 inline-block"
          >
            &larr; View all products
          </Link>
        )}
      </div>

      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="relative grow">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400"
            fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shrink-0"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
              <div className="aspect-square bg-gray-200" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-20">
          <svg className="h-12 w-12 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <p className="text-gray-500 text-lg">No products found</p>
          <p className="text-gray-400 text-sm mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              tenantSlug={tenantSlug}
              currencySymbol={currencySymbol}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-10">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function ProductCard({ product, tenantSlug, currencySymbol }) {
  const imageUrl = product.image_url || product.images?.[0]?.url;
  const hasStock = product.in_stock === true;

  return (
    <Link
      to={`/store/${tenantSlug}/products/${product.id}`}
      className="group bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="aspect-square bg-gray-100 relative overflow-hidden">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg className="h-12 w-12" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
          </div>
        )}
        {hasStock && (
          <span className="absolute top-2 right-2 bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded-full">
            In Stock
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="text-sm font-medium text-gray-900 group-hover:text-indigo-600 transition-colors line-clamp-2">
          {product.name}
        </h3>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-base font-bold text-gray-900">
            {currencySymbol} {Number(product.price).toLocaleString()}
          </span>
          {product.compare_at_price && Number(product.compare_at_price) > Number(product.price) && (
            <span className="text-sm text-gray-400 line-through">
              {currencySymbol} {Number(product.compare_at_price).toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
