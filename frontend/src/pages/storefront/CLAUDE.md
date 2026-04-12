# Storefront Pages — Claude Guide

- **8 files** — public tenant storefront at `/store/:tenantSlug` (unauthenticated, no `api.js`)
- **`StorefrontLayout.jsx`** — root layout shell + `useStorefront()` context. Fetches `/api/storefront/config` + `/api/storefront/categories`. Provides `config`, `categories`, `tenantSlug`, `cart` (from hook), `cartItemCount`/`setCartItemCount`/`incrementCart`. Renders sticky header with category nav + cart badge, `<Outlet />`, and footer
- **`useStorefrontCart.js`** — cart hook. Token-based anonymous cart (`sf_cart_<slug>` in localStorage). CRUD via `/api/storefront/cart` endpoints. Returns `cartToken`, `items`, `addItem`, `updateItem`, `removeItem`, `getQuote`, `clearCart`, `ensureToken`. Uses `tokenRef` (useRef) to avoid stale closures
- **`StorefrontHome.jsx`** — landing page: hero, category grid (from context), featured products grid (first 12 via `/api/storefront/products?limit=12`)
- **`StorefrontProducts.jsx`** — paginated product listing with search (300ms debounce), sort, category filter. All state synced to URL search params. Page size 20
- **`StorefrontProductDetail.jsx`** — single product page: image gallery, variant selector, add-to-cart (via `cart.addItem`), reviews, pickup availability table. `productId` from `useParams`
- **`StorefrontCart.jsx`** — cart page: quantity controls, line totals, order summary sidebar. Delegates all mutations to `useStorefrontCart`. Syncs `setCartItemCount` on mount
- **`StorefrontCheckout.jsx`** — multi-step checkout: delivery method (pickup vs ship), outlet/courier selection, address form, contact info, live quote (auto-refreshes on changes). `POST /api/storefront/checkout` places order (COD only). Navigates to order status on success
- **`StorefrontOrderStatus.jsx`** — post-checkout order tracking: status timeline (pickup: ordered/processing/ready/completed; shipping: ordered/processing/shipped/completed), auto-polls every 30s. "I've Arrived" CTA for pickup orders at `ready_for_pickup` status
- **Cross-cutting**: all files use raw `fetch()` (not `api.js`), currency from `config.currency_symbol || "Rs"` (not `useCurrency`), no feature flags, no permissions, self-contained Tailwind UI (no `ui/primitives`)
