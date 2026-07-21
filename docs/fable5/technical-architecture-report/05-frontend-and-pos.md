# Frontend, POS, Routing, and Offline Architecture

## Application composition

The React tree is assembled in [`frontend/src/main.jsx`](../../../frontend/src/main.jsx#L51):

```text
ErrorBoundary
└── CurrencyProvider
    └── ToastProvider
        └── AuthProvider
            └── PresetProvider
                └── App
```

The application initializes Sentry when configured, installs stale-chunk recovery, renders in React Strict Mode, and registers the service worker only in production.

## Route organization

[`frontend/src/App.jsx`](../../../frontend/src/App.jsx#L11) composes three route groups:

- Public routes
- Authenticated merchant routes
- Super-admin routes

The merchant route tree is in [`frontend/src/routes/appRoutes.jsx`](../../../frontend/src/routes/appRoutes.jsx#L1). Public, portal, POS, KDS, and storefront routes are in [`frontend/src/routes/publicRoutes.jsx`](../../../frontend/src/routes/publicRoutes.jsx#L1). Super-admin routes are in [`frontend/src/routes/adminRoutes.jsx`](../../../frontend/src/routes/adminRoutes.jsx#L1).

Nearly 200 page modules use `React.lazy`. Vite also emits dedicated chunks for:

- Recharts/D3
- XLSX/codepage
- Reports

See [`frontend/vite.config.js`](../../../frontend/vite.config.js#L10).

## Route guards

Three main guards control the merchant interface:

### RequireAuth

[`RequireAuth.jsx`](../../../frontend/src/components/RequireAuth.jsx#L1) waits for auth boot and redirects unauthenticated users to `/login`.

### RequireContext

[`RequireContext.jsx`](../../../frontend/src/components/RequireContext.jsx#L1) waits for feature flags, then enforces outlet/company context when `context_selection_required` is enabled.

### RequirePerm

[`RequirePerm.jsx`](../../../frontend/src/components/RequirePerm.jsx#L1) supports a single permission or any-of permission array and redirects to an access-denied page.

These guards improve user experience but are not security boundaries. The backend rechecks effective permissions, outlet assignment, features, and modes on every request.

## Staff session management

[`AuthProvider.jsx`](../../../frontend/src/auth/AuthProvider.jsx#L28) manages:

- Current employee
- Permissions
- Access token
- Tenant metadata
- Company data
- Impersonation state
- Subscription state
- Authentication boot state

Session data is stored under `authSession` through [`authStore.js`](../../../frontend/src/auth/authStore.js#L14).

On boot, the provider:

1. Detects an impersonation handoff.
2. Reads the stored session.
3. Reloads base-role permissions from the API.
4. Best-effort refreshes company data.
5. Rewrites the stored session.
6. Loads billing status.

The preset bootstrap later overlays outlet-effective permissions from `/api/context/bootstrap`.

## Global fetch interceptor

The provider patches `window.fetch` at [`AuthProvider.jsx`](../../../frontend/src/auth/AuthProvider.jsx#L345).

For authenticated API calls it injects:

- `x-employee-id`
- `Authorization: Bearer ...`
- `x-company-id`
- `x-outlet-id`
- `x-scope-mode`
- `credentials: include`

It also:

- Rejects most non-GET API calls while `navigator.onLine` is false.
- Coalesces concurrent refresh requests.
- Retries once on `401 TOKEN_EXPIRED`.
- Saves the most recent failed `X-Request-Id` for support.
- Detects `SUBSCRIPTION_EXPIRED`.

The interceptor is convenient but creates implicit global behavior. Providers and portal clients outside this staff-auth scope must attach their own headers.

## API client

[`frontend/src/api.js`](../../../frontend/src/api.js#L1) provides:

- `api.get`
- `api.post`
- `api.put`
- `api.del`
- `api.upload`
- `api.raw`

The JSON helper throws enriched errors and emits a global event when a plan-limit response is received.

The codebase contains more than one thousand `api.*` call sites, so this client and the fetch interceptor are central cross-cutting infrastructure.

## Preset and feature state

[`PresetContext.jsx`](../../../frontend/src/contexts/PresetContext.jsx#L56) loads `/api/context/bootstrap` and exposes:

- Industry type
- Business model
- Terminology labels
- POS layout mode
- Dashboard settings
- Enabled modes
- Unit vocabulary
- Clinical configuration
- `hasMode`
- `label`

It also:

- Applies outlet-effective employee permissions.
- Seeds a single-outlet context when none exists.
- Retries the first bootstrap request after an auth-interceptor race.

[`useFeatureFlags.js`](../../../frontend/src/hooks/useFeatureFlags.js#L58) fetches effective flags and keeps a localStorage warm cache. The cache enables fast navigation paint, then revalidates against the backend.

## Merchant shell

[`AppLayoutRedesign.jsx`](../../../frontend/src/components/AppLayoutRedesign.jsx#L70) provides:

- Responsive sidebar
- Context switcher
- Permission/flag/mode-filtered navigation
- Preset-aware terminology
- Account drawer
- Notifications
- Announcement banner
- Breadcrumbs
- Support widget
- AI chat panel
- Global plan-limit modal

The navigation model is defined in [`frontend/src/ui/nav-config.js`](../../../frontend/src/ui/nav-config.js#L1).

## POS application

The POS is a dedicated full-screen application rather than a child of the ordinary merchant shell.

[`POSRedesign.jsx`](../../../frontend/src/pages/redesign/POSRedesign.jsx#L1) composes the cashier UI, while [`POSContext.jsx`](../../../frontend/src/pages/redesign/pos/POSContext.jsx#L74) owns state and orchestration.

The context delegates to hooks:

- [`useCart`](../../../frontend/src/pages/redesign/pos/hooks/useCart.js#L5)
- [`useCheckout`](../../../frontend/src/pages/redesign/pos/hooks/useCheckout.js#L5)
- [`useShiftGate`](../../../frontend/src/pages/redesign/pos/hooks/useShiftGate.js#L8)
- [`useReceipt`](../../../frontend/src/pages/redesign/pos/hooks/useReceipt.js#L8)
- [`useCustomerDisplay`](../../../frontend/src/pages/redesign/pos/hooks/useCustomerDisplay.js#L6)
- [`useLoyaltyWallet`](../../../frontend/src/pages/redesign/pos/hooks/useLoyaltyWallet.js#L14)
- [`useFolioCharging`](../../../frontend/src/pages/redesign/pos/hooks/useFolioCharging.js#L4)
- [`useOfflineQueue`](../../../frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js#L18)

### POS responsibilities

The POS handles:

- Outlet selection
- Shift opening and closing
- Attendance gate
- Cart search and barcode scanning
- Embedded weight/price barcodes
- Product variants
- Serialized products
- Batch selection
- Price lists
- Promotions
- Discounts and manager approvals
- Customer selection and creation
- Loyalty, wallet, and gift cards
- Holds and parked carts
- Returns and exchanges
- Backorders
- Credit-limit override
- Room and treatment folio charging
- Appointment completion
- Restaurant checks, seats, courses, modifiers, tips, and servers
- Receipt generation and hardware printing
- Customer-facing display
- Offline transaction queueing
- Session, cart, printer, stock, and shift recovery modals

### Checkout payload

[`useCheckout`](../../../frontend/src/pages/redesign/pos/hooks/useCheckout.js#L273) builds one sale payload containing:

- Cart lines and snapshots
- Payments
- Outlet, employee, and shift
- Customer
- Tax mode
- Discount
- Loyalty values
- Folio IDs
- Appointment ID
- Draft order/check context
- Restaurant metadata
- Tip/server data
- Backorder remainder
- Manager override data
- Idempotency key

When online, the hook posts to `/api/sales`. When offline, it queues the identical payload for later replay.

## Offline queue

[`frontend/src/utils/offlineQueue.js`](../../../frontend/src/utils/offlineQueue.js#L1) uses IndexedDB through `idb`.

One queue stores typed rows for:

- Sale
- Return
- Field check-in
- Field order

Each row contains:

- Idempotency key
- Employee ID
- Type
- Sync state
- Retry count
- Last error
- Queue and attempt timestamps
- Full API payload

The combined queue is capped at 50 records, with a warning threshold of 40.

[`useOfflineQueue`](../../../frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js#L75) replays pending sales and returns on demand or when the browser emits `online`. Duplicate responses are treated as successful synchronization.

## Service worker

[`frontend/public/sw.js`](../../../frontend/public/sw.js#L1) provides:

- Static precaching
- Cache cleanup
- Navigation fallback
- Cache-first same-origin static assets
- Cache deletion on logout message

It does not cache authenticated API responses. Offline operation therefore means queued writes and static-shell availability, not a complete local replica of tenant data.

## Receipt architecture

Browser receipt rendering is implemented in [`frontend/src/utils/receipt.js`](../../../frontend/src/utils/receipt.js#L1). Hardware printing is requested through the backend printer API.

The receipt path supports:

- Configurable templates
- Currency and preset terminology
- Barcode
- FBR IRN and QR
- Tax breakdown
- Split payments
- Exchange and refund context
- Gift cards
- Credit/AR details
- Printer retry
- Browser fallback

