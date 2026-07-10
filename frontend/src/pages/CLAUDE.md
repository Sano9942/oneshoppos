# pages — Claude Guide

`pages/` holds every UI page in the app. Most active tenant UI lives in `redesign/` — see `redesign/CLAUDE.md` for the full domain breakdown. This file orients you to the directory as a whole: what's in each subdirectory, and the thin-wrapper convention used for route files.

---

## The `*Route.jsx` thin-wrapper convention

Most top-level `pages/*Route.jsx` files are **not** real page implementations — they are lazy-load pass-throughs that route files (`src/routes/*.jsx`) import. The typical shape:

```jsx
import XRedesign from './redesign/XRedesign';
export default function XRoute() { return <XRedesign />; }
```

**Never edit a `*Route.jsx` file** — all real logic belongs in the matching `redesign/*Redesign.jsx`. The two documented exceptions that carry real logic of their own: `POSRoute.jsx` and `ReportsRoute.jsx`.

---

## Subdirectories (each has its own CLAUDE.md — read it before working inside)

### `redesign/` — primary tenant UI
`*Redesign.jsx` files — the actual implementations behind almost every `*Route.jsx` wrapper. POS lives in its own `redesign/pos/` sub-module. See `redesign/CLAUDE.md`.

### `admin/` — super-admin panel
Routes at `/admin/*`. Entirely separate auth system: Bearer token in `localStorage["adminSession"]` via `auth/adminAuthStore.js`, fetched through `adminFetch` (defined in `AdminLogin.jsx`) — never `api.js`. No tenant permissions system, no `ui/primitives`, no `useCurrency`. Styled with the same `--ui-*` Square tokens as the rest of the app (not a separate dark theme). `adminFetch` silently refreshes on a `401`/`TOKEN_EXPIRED` via the httpOnly refresh cookie and retries once. 2FA (TOTP) layers on top of password login. See `admin/CLAUDE.md` for the full page-by-page breakdown (dashboard, tenant list/detail, support tickets, emails, dead letters, activity log, adoption matrix, billing, security, tax rates, stuck payments).

### `portal/` — customer self-service portal
Routes at `/portal/:tenantSlug`. Fully self-contained: its own auth (`PortalAuthProvider` + `auth/customerPortalStore.js`, slug-scoped sessions) and its own API client (`api/portalApi.js`, not `api.js`) — never the main-app `useAuth()`. Tab visibility is server-driven via `GET /api/portal/config`. See `portal/CLAUDE.md` for the auth pages (login/signup/OTP/reset) and every authenticated tab (invoices, appointments, orders, loyalty, wallet, treatments, stays, packages, gallery, contracts, subscriptions, tickets, profile).

### `reports/` — report tab components
Orchestrated by `pages/Reports.jsx` (not legacy — the active reports entry point). All use the `{ api }` named import from `api.js`. Split into barrel modules by domain (Sales, Inventory, Finance, Analytics, Audit, Catalog, Customers, Governance, Operations, Purchasing, Shifts, Staff, Multichannel, Commissions) plus several standalone files (`ClinicalTab`, `KdsAnalyticsTab`, `MenuEngineeringTab`, `FBRExportTab`, `ARAgingTab`). Most tabs use `date_from`/`date_to` params — a handful (`ReportsMultichannel`, `ReportsCommissions`, `KdsAnalyticsTab`, `MenuEngineeringTab`, `FBRExportTab`) use `from`/`to` instead; shift-locked tabs use `session_id` only. See `reports/CLAUDE.md` before adding or touching any tab — the date-param convention is the most common copy-paste bug in this directory.

---

## Other subdirectories

### `dashboard/`
Dashboard widget components, most receiving data as props from `DashboardRedesign.jsx`. Use `SectionCard` from `ui/primitives`; return `null` on empty data rather than rendering a skeleton.

### `public/`
Unauthenticated public pages (`PublicBookingPage.jsx`, `PublicRestaurantMenuPage.jsx`, etc.) — no `api.js`, no auth headers, raw `fetch()` throughout, self-contained styling.

### `shopify/`
Shopify integration tab modules, rendered inside `ShopifyIntegrationRedesign.jsx` under `<ShopifyProvider>`. `useShopify()` exposes `apiFetch` (an `api.raw` wrapper) — caller checks `res.ok` manually.

### `storefront/`
Public tenant storefront at `/store/:tenantSlug`. Unauthenticated, raw `fetch()`, token-based anonymous cart in `localStorage`.

### `treatment/` (under `redesign/`)
Clinical treatment-plan sub-pages (dental/body chart components) consumed by `TreatmentPlansRedesign.jsx`.

### `field/` (under `redesign/`)
Field-rep mobile PWA pages (check-in, order capture, visit log) for wholesale field sales.

---

## Top-level pages worth knowing

| File | Notes |
|------|-------|
| `LandingPage.jsx` | Public marketing/pricing/login page at `/` |
| `LoginPage.jsx` | Standalone login (multi-tenant mode) |
| `SignupPage.jsx` | Public self-service signup, gated by `SELF_SERVICE_SIGNUP=1` |
| `ResetPassword.jsx`, `VerifyEmail.jsx` | Public auth flows |
| `ReceiptPublicPage.jsx` | Public shareable receipt, no auth |
| `ContextSelect.jsx` | Post-login outlet/context picker; also the impersonation-flow landing page |
| `AccessDenied.jsx`, `PlaceholderPage.jsx` | Error/stub pages |
| `CustomerDisplayPage.jsx` | Second-screen customer-facing display |
| `Reports.jsx` | **Not legacy** — the active reports orchestrator, delegates to `pages/reports/` |
| `Accounting.jsx`, `Attendance.jsx`, `Approvals.jsx`, `BarcodeTemplates.jsx`, `ReceiptTemplates.jsx`, `ShopifyIntegration.jsx`, `InvoiceView.jsx` | Legacy components, imported by their `*Redesign.jsx` wrappers — don't edit unless the task specifically targets the wrapped legacy component |
| `Landing*.jsx` (Bazaar/Brutalist/Editorial/Luxury/Scrapbook/Showroom/Truckart/Y2k) | Alternative landing-page visual styles, not shown to production users by default |

A large set of `*Route.jsx` files (Appointments, Rentals, RoomManagement, TreatmentPlans, ServiceTickets, Projects, Contracts, Subscriptions, CommissionPlans, ManufacturerPartners, and most other domain routes) are all thin pass-throughs per the convention above — when in doubt, open the matching `redesign/*Redesign.jsx` file instead.

---

## Conventions

- Never edit a `*Route.jsx` file except `POSRoute.jsx`/`ReportsRoute.jsx` — put logic in the matching `redesign/*Redesign.jsx`.
- `redesign/` is the primary codebase for tenant UI — when fixing a page, go there first.
- Admin pages use `adminFetch`; portal pages use `portalApi`; public pages (`public/`, `storefront/`) use raw `fetch()`. Never replace any of these with `api.js`.
- Feature flag / currency / timestamp / CSV-export / Tailwind conventions are frontend-wide — see `frontend/src/CLAUDE.md` and `redesign/CLAUDE.md`, not repeated per-subdirectory.
