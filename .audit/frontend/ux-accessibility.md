# UX, accessibility, responsiveness and PWA evidence

## Positive controls observed

- Global and page-level error boundaries exist, with Sentry capture when configured and recovery/reload actions (`ui/ErrorBoundary.jsx:8-94`).
- Shared Modal restores focus, supports Escape and backdrop policy, and supplies dialog semantics (`ui/primitives.jsx:150-233`).
- Shared buttons carry a visible focus-ring class, and icon-only call sites can provide `aria-label`.
- POS has discoverable F-key help and guards destructive clear with confirmation (`POSContext.jsx:852-866`).
- Offline POS writes use idempotency keys and a bounded IndexedDB queue; duplicate server responses are treated as successful sync (`offlineQueue.js:68-98`, `useOfflineQueue.js:94-105`).
- PWA service worker is production-only, cleans versioned caches, uses network-first navigation with app-shell fallback, cache-first static assets, and receives logout cache-clear messages (`main.jsx:67-70`, `public/sw.js:17-80`, `AuthProvider.jsx:150-154`).

## Confirmed gaps

- Dark form control contrast: F-05.
- Dialog focus/semantics: F-06.
- POS Escape contract: F-07.
- Breadcrumb/loading announcements: F-09.
- Offline cross-tenant and field retry behavior: F-01/F-02.

## Responsive review

- Shared toolbar/footer primitives use wrapping, shared Modal caps height at 90vh and scrolls, and public/PWA prompts cap width.
- Retail and restaurant POS use a dense fixed-viewport (`h-screen`) composition with hardcoded desktop styling. No unit test or non-production browser project asserts a phone/tablet POS viewport. This remains a dynamic-test gap rather than a confirmed break.
- Many inline modal cards use fixed maximum widths and padding but lack a common small-viewport/focus policy; migration to the shared dialog would reduce both responsive and accessibility variance.

## PWA/offline limitations

- The service worker declares `API_CACHE` but never populates it; offline API reads are not provided by the SW. Offline business writes are an application/IndexedDB concern.
- The install precache includes `/` and icons/manifest; runtime JS/CSS chunks are cached after first request. A first-ever offline launch cannot work before a successful install/load, which is expected.
- Failed cache installation is swallowed (`sw.js:17-20`), so partial/offline install failure has no diagnostics.
- Manifest includes 192/512/Apple icons but no maskable icon or shortcuts. This is an install-quality enhancement, not a correctness finding.

## Recommended browser verification (local/staging only)

1. Axe + keyboard pass on login, dashboard, shared CRUD modal, POS help, POS checkout, portal dialog.
2. Computed-contrast assertions for shared Input/Select in dark mode.
3. Viewports: 360×800, 768×1024, 1280×720; validate POS overflow, checkout actions, tables and side panels.
4. PWA: update/activation, offline reload after warm cache, logout cache state, and account/tenant switch with queued records.
5. Screen-reader live announcements for lazy loading, errors, toast updates and POS status changes.
