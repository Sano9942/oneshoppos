import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { API_BASE } from "../../config";
import { useStorefront } from "./StorefrontLayout";

export default function StorefrontProductDetail() {
  const { tenantSlug, productId } = useParams();
  const { config } = useStorefront();
  const currencySymbol = config?.currency_symbol || "Rs";

  const { cart } = useStorefront();
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addedMessage, setAddedMessage] = useState("");

  const handleAddToCart = async () => {
    if (!product || adding) return;
    setAdding(true);
    setAddedMessage("");
    // Tier 2.2 — default the add-to-cart qty to the larger of min_order_qty
    // and order_increment. Avoids an instant 400 on products with a min > 1
    // when the user clicks the default Add button.
    const minQty = Number(product.min_order_qty || 0);
    const increment = Math.max(1, Number(product.order_increment || 1));
    const startQty = Math.max(minQty, increment, 1);
    const ok = await cart.addItem(product.id, selectedVariant?.id || null, startQty);
    setAdding(false);
    if (ok) {
      setAddedMessage(`Added ${startQty} to cart`);
      setTimeout(() => setAddedMessage(""), 2000);
    } else {
      setAddedMessage(cart.error || "Could not add to cart");
    }
  };

  const moqHint = (() => {
    if (!product) return null;
    const min = Number(product.min_order_qty || 0);
    const inc = Number(product.order_increment || 1);
    const parts = [];
    if (min > 1) parts.push(`Minimum order ${min}`);
    if (inc > 1) parts.push(`Sold in cases of ${inc}`);
    return parts.length ? parts.join(" · ") : null;
  })();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Tier 2.11 — pass cart_token so backend can apply visibility filtering.
    const tokenForVisibility = localStorage.getItem(`sf_cart_${tenantSlug}`);
    const visParam = tokenForVisibility
      ? `&cart_token=${encodeURIComponent(tokenForVisibility)}`
      : "";
    fetch(`${API_BASE}/api/storefront/products/${productId}?tenant=${tenantSlug}${visParam}`)
      .then((r) => {
        if (!r.ok) throw new Error("Product not found");
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setProduct(data);
          if (data.variants?.length > 0) setSelectedVariant(data.variants[0]);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [tenantSlug, productId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="animate-pulse grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div className="aspect-square bg-(--ui-muted-surface) rounded-xl" />
          <div className="space-y-4">
            <div className="h-8 bg-(--ui-muted-surface) rounded w-3/4" />
            <div className="h-6 bg-(--ui-muted-surface) rounded w-1/3" />
            <div className="h-4 bg-(--ui-muted-surface) rounded w-full" />
            <div className="h-4 bg-(--ui-muted-surface) rounded w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 text-center">
        <h2 className="text-xl font-bold text-(--ui-text) mb-2">Product Not Found</h2>
        <p className="text-(--ui-text-muted) mb-6">{error || "This product does not exist."}</p>
        <Link
          to={`/store/${tenantSlug}/products`}
          className="text-(--ui-link) hover:text-(--ui-link) font-medium"
        >
          &larr; Back to products
        </Link>
      </div>
    );
  }

  // Build images array
  const images = [];
  if (product.image_url) images.push(product.image_url);
  if (product.images) {
    product.images.forEach((img) => {
      const url = typeof img === "string" ? img : img.url;
      if (url && !images.includes(url)) images.push(url);
    });
  }

  const activePrice = selectedVariant?.price ?? product.price;
  const comparePrice = selectedVariant?.compare_at_price ?? product.compare_at_price;
  const hasDiscount = comparePrice && Number(comparePrice) > Number(activePrice);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-(--ui-text-muted) mb-6">
        <Link to={`/store/${tenantSlug}`} className="hover:text-(--ui-link)">Store</Link>
        <span>/</span>
        <Link to={`/store/${tenantSlug}/products`} className="hover:text-(--ui-link)">Products</Link>
        <span>/</span>
        <span className="text-(--ui-text) font-medium truncate">{product.name}</span>
      </nav>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Image Gallery */}
        <div>
          <div className="aspect-square bg-(--ui-muted-surface) rounded-xl overflow-hidden mb-4">
            {images.length > 0 ? (
              <img
                src={images[selectedImage] || images[0]}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-(--ui-text-muted)">
                <svg className="h-20 w-20" fill="none" viewBox="0 0 24 24" strokeWidth={0.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                </svg>
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {images.map((url, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedImage(idx)}
                  className={`shrink-0 h-16 w-16 rounded-lg overflow-hidden border-2 transition-colors ${
                    selectedImage === idx ? "border-(--ui-focus)" : "border-(--ui-border) hover:border-(--ui-border-strong)"
                  }`}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Product Info */}
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-(--ui-text) mb-4">
            {product.name}
          </h1>

          {/* Price */}
          <div className="flex items-center gap-3 mb-2">
            <span className="text-3xl font-bold text-(--ui-text)">
              {currencySymbol} {Number(activePrice).toLocaleString()}
            </span>
            {hasDiscount && (
              <span className="text-lg text-(--ui-text-muted) line-through">
                {currencySymbol} {Number(comparePrice).toLocaleString()}
              </span>
            )}
          </div>
          {moqHint && (
            <p className="text-sm text-(--ui-warning-fg) mb-6">{moqHint}</p>
          )}
          {!moqHint && <div className="mb-6" />}

          {/* Variant Selector */}
          {product.variants && product.variants.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-(--ui-text) mb-2">Variant</label>
              <div className="flex flex-wrap gap-2">
                {product.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariant(v)}
                    className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                      selectedVariant?.id === v.id
                        ? "border-(--ui-focus) bg-(--ui-muted-surface) text-(--ui-link)"
                        : "border-(--ui-border-strong) text-(--ui-text) hover:border-(--ui-border-strong)"
                    }`}
                  >
                    {v.name || v.title || `Variant ${v.id}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {product.description && (
            <div className="mb-6">
              <h2 className="text-sm font-medium text-(--ui-text) mb-2">Description</h2>
              <p className="text-(--ui-text-muted) leading-relaxed whitespace-pre-line">
                {product.description}
              </p>
            </div>
          )}

          {/* Add to Cart */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={adding}
              className="w-full sm:w-auto px-8 py-3 bg-(--ui-primary) text-(--ui-on-primary) font-medium rounded-lg hover:bg-(--ui-primary-strong) transition-colors text-base disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {adding ? "Adding..." : "Add to Cart"}
            </button>
            {addedMessage ? (
              <p className="text-sm text-(--ui-success-fg) font-medium">{addedMessage}</p>
            ) : null}
          </div>

          {/* Reviews */}
          {product.reviews && product.reviews.length > 0 && (
            <div className="mt-10 border-t border-(--ui-border) pt-8">
              <h2 className="text-lg font-bold text-(--ui-text) mb-4">
                Reviews ({product.reviews.length})
              </h2>
              <div className="space-y-6">
                {product.reviews.map((review, idx) => (
                  <div key={idx} className="border-b border-(--ui-border) pb-4 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StarRating rating={review.rating} />
                      {review.author && (
                        <span className="text-sm font-medium text-(--ui-text)">{review.author}</span>
                      )}
                    </div>
                    {review.text && (
                      <p className="text-sm text-(--ui-text-muted) mt-1">{review.text}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pickup Availability */}
          {product.availability && product.availability.length > 0 && (
            <div className="mt-10 border-t border-(--ui-border) pt-8">
              <h2 className="text-lg font-bold text-(--ui-text) mb-4">Pickup Availability</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--ui-border)">
                      <th className="text-left py-2 font-medium text-(--ui-text)">Location</th>
                      <th className="text-left py-2 font-medium text-(--ui-text)">Availability</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.availability.map((loc, idx) => (
                      <tr key={idx} className="border-b border-(--ui-border)">
                        <td className="py-2 text-(--ui-text)">{loc.outlet_name || loc.name}</td>
                        <td className="py-2">
                          {loc.in_stock ? (
                            <span className="inline-flex items-center gap-1 text-(--ui-success-fg)">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                              </svg>
                              In Stock
                            </span>
                          ) : (
                            <span className="text-(--ui-text-muted)">Out of Stock</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StarRating({ rating }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <svg
        key={i}
        className={`h-4 w-4 ${i <= rating ? "text-(--ui-warning-fg) fill-yellow-400" : "text-(--ui-text-muted)"}`}
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z"
        />
      </svg>
    );
  }
  return <div className="flex items-center gap-0.5">{stars}</div>;
}
