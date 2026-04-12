# Public Pages — Claude Guide

- **2 files** — unauthenticated public-facing pages (no `api.js`, no auth, raw `fetch()`)
- **`PublicBookingPage.jsx`** — appointment booking widget. 4-step flow on one page: service grid, date+staff picker, time slot grid, contact form + submit. Endpoints: `GET /api/public/bookings/config`, `GET /api/public/bookings/availability`, `POST /api/public/bookings`. Tenant from `useParams()` as `tenantSlug`, passed via `?tenant=` query param. Indigo accent. Shows confirmation with booking ID on success
- **`PublicRestaurantMenuPage.jsx`** — QR-code-driven digital menu for restaurant tables. Token from `useParams()`, tenant from `useSearchParams()`. Endpoints: `GET /api/public/restaurant/menu/:token`, `POST /api/public/restaurant/checks/:token/items` (quantity hardcoded to 1). Category chip filter, lazy-loaded images, local toast (not `ToastContext`). Amber accent. `stripHtml()` helper for rich-text descriptions
- **Cross-cutting**: both use `API_BASE` from `../../config`, self-contained Tailwind UI (no `ui/primitives`), cleanup guards in `useEffect` via `cancelled` boolean, no TypeScript
