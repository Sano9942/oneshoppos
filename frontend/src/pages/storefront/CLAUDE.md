# Storefront Pages — Claude Guide

- **8 files** — public tenant storefront at `/store/:tenantSlug` (unauthenticated, no `api.js`)
- All files use raw `fetch()` (not `api.js`), currency from `config.currency_symbol || "Rs"` (not `useCurrency`), no feature flags, no permissions, self-contained Tailwind UI (no `ui/primitives`)

---

## `StorefrontLayout.jsx`

Root layout shell. Creates and exports `StorefrontContext` — also exports `useStorefront()` hook (consumed by all child pages).

**Context shape provided:**

| Field | Source |
|-------|--------|
| `config` | `GET /api/storefront/config` |
| `categories` | `GET /api/storefront/categories` |
| `tenantSlug` | `:tenantSlug` from `useParams` |
| `cartItemCount` | Total quantity sum (not item count) — caps at "99+" in badge |
| `setCartItemCount` | Setter for cart badge sync |
| `incrementCart` | Increments `cartItemCount` by 1 |
| `cart` | Full `useStorefrontCart(tenantSlug)` return value |

Both config and categories are fetched in parallel on mount.

**Sticky header:** Category nav shows first **6** categories on desktop; mobile hamburger menu shows **all** categories. Cart badge displays total item quantity (sum of `item.quantity`), not item count — caps at "99+".

**Renders:** sticky header → `<Outlet />` → footer

---

## `useStorefrontCart.js`

Token-based anonymous cart hook. `localStorage` key: `sf_cart_<tenantSlug>`.

**Gotcha:** uses `tokenRef` (`useRef`) for all async callbacks — avoids stale closure where `cartToken` state would be stale inside the fetch callbacks.

**Exported fields:**

| Export | Notes |
|--------|-------|
| `cartToken` | Current anonymous cart token (string or null) |
| `items` | Cart line items array |
| `itemCount` | Convenience alias — `items.length` (number of distinct lines, not quantity sum) |
| `addItem` | `(productId, variantId, quantity)` → `{ success, item }` |
| `updateItem` | `(lineItemId, quantity)` → boolean success |
| `removeItem` | `(lineItemId)` → boolean success |
| `getQuote` | `(deliveryMethod, pickupOutletId, courierId)` → quote object or null |
| `clearCart` | Clears token + items |
| `ensureToken` | Lazy-creates cart if no token exists — called before any mutation |

**`fetchCart` 404 handling:** if `GET /api/storefront/cart` returns 404, the token is cleared (expired/invalid cart recovery).

**`ensureToken`:** `POST /api/storefront/cart/init` to create a new cart if `cartToken` is null. Called automatically by `addItem` and other mutations.

---

## `StorefrontHome.jsx`

Landing page: hero, category grid (from context), featured products grid.

- Fetches first 12 products via `GET /api/storefront/products?limit=12`
- Internal `ProductCard` component: shows `compare_at_price` as strikethrough when set
- Stock badge logic: shows "In Stock" if `track_inventory === false` OR `stock_quantity > 0`

---

## `StorefrontProducts.jsx`

Paginated product listing. `PAGE_SIZE = 20`.

**State — all synced to URL search params with `replace: true`:**

| Param | State | Notes |
|-------|-------|-------|
| `category` | category filter | |
| `q` | search query | 300ms debounce via `debounceRef` |
| `sort` | sort order | Options: `newest`, `price_asc`, `price_desc`, `name_asc` |
| `page` | current page | |

**`totalPages` backward compat:** reads `data.totalPages || data.total_pages || 1` — handles both camelCase and snake_case API responses.

---

## `StorefrontProductDetail.jsx`

Single product page. `productId` from `useParams`. `cart` from `useStorefront()`.

- First variant auto-selected on load
- `adding` boolean state prevents double-add while request is in-flight
- Success message ("Added to cart!") clears after **2000ms**
- Renders: image gallery, variant selector, add-to-cart button, reviews, pickup availability table

---

## `StorefrontCart.jsx`

Cart page. **Instantiates its own `useStorefrontCart(tenantSlug)` — does NOT use `cart` from `StorefrontContext`.**

This is intentional: the cart page needs full mutation capability. On mount, it calls `fetchCart()` if a `cartToken` exists, then syncs `setCartItemCount` to `items.length`.

- Internal `CartItem` component: has its own `updating` boolean state per line item (prevents concurrent updates on the same item)
- Line total uses `item.unit_price || item.price` (handles both field shapes)
- Delegates all mutations to its local `useStorefrontCart` instance

---

## `StorefrontCheckout.jsx`

Multi-step checkout. Default delivery method: **"pickup"**.

**Steps:** delivery method → outlet/courier selection → address form + contact info → live quote

- Fetches `GET /api/storefront/pickup-locations` and `GET /api/storefront/shipping-methods` on mount
- Auto-selects first option in each list
- Quote auto-refreshes when `deliveryMethod`, `pickupOutletId`, or `selectedCourierId` change (via `refreshQuote` callback)
- `POST /api/storefront/checkout` places order (COD only)
- Navigates to order status page on success

---

## `StorefrontOrderStatus.jsx`

Post-checkout order tracking. Auto-polls `GET /api/storefront/orders/:token` every **30 seconds**.

**Status timelines:**

| Delivery type | Steps |
|--------------|-------|
| Pickup | `ordered` → `processing` → `ready_for_pickup` → `completed` |
| Shipping | `ordered` → `processing` → `shipped` → `completed` |

- `cancelled` status shows a red banner instead of the timeline
- **"I've Arrived" CTA**: shown when `isPickup && order.status === "ready_for_pickup"` — calls `POST /api/storefront/orders/:token/arrive`
- Internal `StatusBadge` component for colored status chips
