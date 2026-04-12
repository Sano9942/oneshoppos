# Public Pages — Claude Guide

**2 files** — unauthenticated public-facing pages. No `api.js`, no auth headers, raw `fetch()` throughout. Self-contained Tailwind UI (no `ui/primitives`, no `ToastContext`). Cleanup guards in all `useEffect` via `cancelled` boolean. No TypeScript.

---

## `PublicBookingPage.jsx`

Route: `/book/:tenantSlug` — public appointment booking widget.

**Tenant resolution:** `tenantSlug` from `useParams()`, appended as `?tenant=slug` on all API calls.

**4-step wizard (steps rendered conditionally — each step hidden until prior step complete):**

| Step | Shown when | UI |
|------|-----------|-----|
| 1. Service grid | Always | Card grid, single-select |
| 2. Date & staff | After service selected | Date picker (min=today) + optional staff dropdown (only if `service.staff.length > 0`) |
| 3. Time slots | After service selected | Grid of time buttons, fetched on service/date/employee change |
| 4. Contact form | After service + slot selected | Name* + Phone* + Email (optional) + Notes (optional) |

**API endpoints:**

| Endpoint | Purpose | Params |
|----------|---------|--------|
| `GET /api/public/bookings/config?tenant=` | Load store config + services list | `tenantSlug` |
| `GET /api/public/bookings/availability?tenant=&service_id=&date=&employee_id=` | Load available time slots | `employee_id` is optional |
| `POST /api/public/bookings?tenant=` | Submit booking | Body: `service_id, employee_id, start_at, customer_name, customer_phone, customer_email, notes` |

**Confirmation page:** shown in-place (replaces form). Title: `"Booking Received"` if `status === "pending"`, else `"Booking Confirmed"`. Displays `id`, `start_at`, `end_at` (if present). "Book another appointment" button resets all state.

**Private helpers:**
- `todayStr()` — returns `YYYY-MM-DD` for today (date picker min)
- `formatSlotTime(iso)` — formats ISO datetime to `HH:MM` locale time

**Accent color:** Indigo (`indigo-600`). Default currency symbol: `"Rs"` (falls back if `config.currency_symbol` absent).

---

## `PublicRestaurantMenuPage.jsx`

Route: `/menu/:token` — QR-code-driven digital menu for restaurant tables.

**Tenant resolution:** `token` from `useParams()`, `tenantSlug` from `useSearchParams().get("tenant")` (optional — some setups don't use MT).

**API endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /api/public/restaurant/menu/:token?tenant=` | Load menu (items, categories, store name, table label) |
| `POST /api/public/restaurant/checks/:token/items?tenant=` | Add item to active table check |

**POST body:** `{ product_id, quantity: 1 }` — quantity is **hardcoded to 1** (no quantity selector in UI).

**Category filtering:**
- Categories are **derived from `menu.items`** (not a separate endpoint) using `category_id`/`category_name` fields on each item
- Items with no `category_id` fall into bucket `"uncat"` displayed as `"Other"`
- Chip bar in sticky header — `"All"` chip always first, then categories in order of first appearance

**Toast (local — not `ToastContext`):**
- Success: `bg-gray-900 text-white` — centered bottom, `max-w-sm`
- Error: `bg-red-600 text-white`
- Auto-dismisses at **2500ms** (different from `ToastContext`'s 4000ms)

**Other UI details:**
- Table label shown in header (`menu.table_label`) — e.g. "Table: 5"
- Product images lazy-loaded (`loading="lazy"`)
- Descriptions run through `stripHtml()` — strips all HTML tags + collapses whitespace
- `submittingId` tracks which product is mid-request (prevents double-add per item)

**Accent color:** Amber (`amber-600`). Default currency symbol: `"Rs"`.

**Private helper:** `stripHtml(html)` — removes `<tags>`, collapses whitespace; returns `""` on null/undefined.

---

## Cross-cutting

- Both import `API_BASE` from `../../config`
- Both use raw `fetch()` with manual `Content-Type: application/json` — not `api.js`
- Both use `cancelled` boolean in `useEffect` cleanup to prevent state updates after unmount
- No TypeScript, no `ui/primitives`, no `ToastContext`, no `useAuth()`
- Both show "Powered by SanoPOS" footer
