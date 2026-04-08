# Frontend Security Audit (Codex)

Date: 2026-04-02

Scope: frontend only. This is a browser-side security review of the current React/Vite app. I did not rely on the project's own tests. The focus here is frontend trust boundaries: session storage, URL/token flows, service worker behavior, impersonation handling, admin-session handling, rendering patterns, and deployment/browser hardening assumptions.

## Executive Summary

The frontend is not broadly unsafe in the classic React sense. I did not find widespread dangerous HTML rendering or obvious client-side code execution sinks. Most UI rendering benefits from React’s default escaping.

The real frontend security risks are different:
- authenticated API responses are cached by the service worker without obvious user or tenant partitioning
- employee and admin sessions are persisted in `localStorage`
- impersonation and admin-state flows depend heavily on browser-stored tokens
- one receipt reprint path still uses raw `document.write` with server-fed values
- browser hardening assumptions are under-documented, and I did not find evidence of frontend-side CSP/frame-policy configuration

Overall verdict: the frontend security posture is moderate, not alarming, but it is too trusting of browser state. The biggest fixes are around cache isolation, storage minimization, and cleanup of legacy client-side auth/rendering paths.

## Security Strengths

1. I did not find use of `dangerouslySetInnerHTML` in the main React app.
2. Shared auth/header injection exists for most authenticated fetches.
   Evidence: `frontend/src/auth/AuthProvider.jsx`
3. Public auth endpoints are explicitly excluded from employee-header injection.
   Evidence: `frontend/src/auth/AuthProvider.jsx`
4. Some printing/barcode paths already use safe DOM APIs rather than HTML string concatenation.
   Evidence: `frontend/src/pages/BarcodeTemplates.jsx`
5. Error capture is present through Sentry and error boundaries.

## Findings

### High

#### 1. Service worker caches protected API responses without visible tenant/user/session scoping

Evidence:
- `frontend/public/sw.js:2`
- `frontend/public/sw.js:5`
- `frontend/public/sw.js:7`
- `frontend/public/sw.js:8`
- `frontend/public/sw.js:12`
- `frontend/public/sw.js:13`
- `frontend/public/sw.js:14`
- `frontend/public/sw.js:40`
- `frontend/public/sw.js:41`
- `frontend/public/sw.js:54`
- `frontend/public/sw.js:106`
- `frontend/public/sw.js:107`

Problem:
The service worker caches same-origin responses for authenticated endpoints such as:
- `/api/feature-flags`
- `/api/outlets`
- `/api/products`
- `/api/reports/dashboard`
- `/api/notifications/count`

The cache keying is URL-based. I did not find evidence that these cached responses are partitioned by tenant slug, employee id, impersonation state, or branch context. On shared browsers, kiosks, or account switching flows, this can surface stale or wrong-user data.

Clearing the cache only on normal `AUTH_LOGOUT` is not enough to fully protect against every session transition.

Impact:
- cross-user or cross-tenant stale data exposure
- sensitive business data lingering after logout/account switching
- difficult-to-debug trust failures between UI and live backend state

Recommendation:
- stop caching protected API responses generically
- if caching remains necessary, partition cache entries by tenant and user identity
- treat offline POS queueing separately from generic API response caching

#### 2. Employee and super-admin sessions are stored in `localStorage`

Evidence:
- `frontend/src/auth/authStore.js:14`
- `frontend/src/auth/authStore.js:25`
- `frontend/src/auth/authStore.js:27`
- `frontend/src/pages/admin/AdminLogin.jsx:8`
- `frontend/src/pages/admin/AdminLogin.jsx:15`
- `frontend/src/pages/admin/AdminLogin.jsx:19`
- `frontend/src/pages/admin/AdminLogin.jsx:34`

Problem:
The browser stores:
- employee session state in `authSession`
- backward-compatibility employee data in `currentEmployee`
- admin session state in `adminSession`

This means the frontend trust model assumes local browser storage is safe enough to hold active session-bearing data. That makes any future XSS, extension compromise, shared-device reuse, or local browser inspection materially more damaging.

Impact:
- full session theft if malicious script runs in-origin
- higher blast radius for browser compromise
- persistent auth residue on shared devices

Recommendation:
- minimize what is stored client-side
- reduce token-bearing storage where possible
- align admin and employee auth handling under stricter storage rules

### Medium

#### 3. Impersonation flow trusts URL-delivered tokens and stores them as a local session

Evidence:
- `frontend/src/auth/AuthProvider.jsx:179`
- `frontend/src/auth/AuthProvider.jsx:185`
- `frontend/src/auth/AuthProvider.jsx:197`
- `frontend/src/auth/AuthProvider.jsx:208`
- `frontend/src/ui/ImpersonationBanner.jsx:10`
- `frontend/src/ui/ImpersonationBanner.jsx:18`
- `frontend/src/ui/ImpersonationBanner.jsx:29`
- `frontend/src/ui/ImpersonationBanner.jsx:35`

Problem:
The frontend accepts `impersonate_token` and `impersonate_session` from the URL, decodes the JWT payload client-side with `atob`, and writes the impersonation session into local storage.

The backend signature is still the real security control, so this is not automatically a broken auth model. But it is a browser-trust-heavy flow:
- the impersonation token enters through the URL
- the frontend treats it as the source of a local session
- exiting impersonation depends on a separate `adminSession` token also present in browser storage

Impact:
- more token exposure through browser history, copied URLs, crash logs, or third-party observation points
- brittle coupling between employee impersonation state and admin local storage
- higher complexity during session cleanup

Recommendation:
- keep impersonation URLs extremely short-lived and one-time where possible
- avoid depending on dual browser-stored sessions longer than necessary
- prefer server-mediated handoff flows over URL-token persistence when feasible

#### 4. Global `window.fetch` patching is powerful but widens the browser trust surface

Evidence:
- `frontend/src/auth/AuthProvider.jsx:293`
- `frontend/src/auth/AuthProvider.jsx:339`
- `frontend/src/auth/AuthProvider.jsx:345`
- `frontend/src/auth/AuthProvider.jsx:347`
- `frontend/src/auth/AuthProvider.jsx:350`
- `frontend/src/auth/AuthProvider.jsx:353`

Problem:
The app replaces `window.fetch` globally to inject:
- employee headers
- bearer tokens
- company/outlet/scope context
- token refresh behavior

This is convenient, but it means security-sensitive behavior is implicit and global. Any page that bypasses the shared flow can silently behave differently, and any unexpected fetch call inherits auth behavior unless explicitly excluded.

Impact:
- harder security review because auth behavior is ambient, not local
- more fragile behavior around public endpoints, utility pages, and legacy components
- increased risk of accidental credential/header bleed into new endpoints

Recommendation:
- keep the exclusion rules tight and documented
- gradually move toward explicit API client helpers rather than patching the global browser primitive

#### 5. `PrinterSettingsRedesign` bypasses the shared auth model and falls back to `x-employee-id: "1"`

Evidence:
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:50`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:68`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:112`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:139`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:165`
- `frontend/src/pages/redesign/PrinterSettingsRedesign.jsx:190`

Problem:
This page manually builds authentication headers from `localStorage.getItem("employeeId") || "1"` instead of using the main auth/session layer.

I did not find a clear writer for `employeeId`, so `"1"` is a likely real fallback in some states. That is both an authorization-consistency problem and a browser-side trust issue.

Impact:
- incorrect acting-user identity
- permission drift from the rest of the app
- higher risk of privileged actions being tied to the wrong browser-side state

Recommendation:
- remove the localStorage employee-id shortcut entirely
- use `useAuth()` and shared auth headers only

#### 6. A sales-history receipt reprint path still uses `document.write` with server-fed values

Evidence:
- `frontend/src/pages/redesign/SalesHistoryRedesign.jsx:172`
- `frontend/src/pages/redesign/SalesHistoryRedesign.jsx:176`
- `frontend/src/pages/redesign/SalesHistoryRedesign.jsx:184`
- `frontend/src/pages/redesign/SalesHistoryRedesign.jsx:189`

Problem:
The receipt reprint popup constructs HTML strings and writes them directly into a new window using `document.write(...)`, interpolating values like:
- `product_name`
- `payment_method`

If upstream data ever contains unexpected markup, this path is more exposed than normal React rendering because it bypasses React’s escaping model.

Impact:
- popup-window HTML injection risk
- harder sanitization guarantees than the rest of the app

Recommendation:
- replace this with DOM API construction or a dedicated print component
- avoid string-built HTML for any server-fed data

### Low

#### 7. Support widget collects rich client metadata and previews object URLs without cleanup

Evidence:
- `frontend/src/ui/SupportWidget.jsx:83`
- `frontend/src/ui/SupportWidget.jsx:84`
- `frontend/src/ui/SupportWidget.jsx:86`
- `frontend/src/ui/SupportWidget.jsx:177`

Observation:
The widget sends:
- page path
- browser user-agent
- last failed request id

and uses `URL.createObjectURL()` for previews without a visible revoke call.

This is not a major frontend security flaw by itself, but it does increase data sensitivity and browser-memory residue. The stronger issue is really on the backend email/rendering side, which I already called out in the backend security audit.

Recommendation:
- revoke object URLs after previews are discarded
- document which support metadata is intentionally collected

#### 8. Public/payment/setup flows rely heavily on URL query parameters

Evidence:
- `frontend/src/pages/ReceiptPublicPage.jsx`
- `frontend/src/pages/SetupWizard.jsx`
- `frontend/src/pages/SignupPage.jsx:52`
- `frontend/src/pages/redesign/BillingRedesign.jsx:31`
- `frontend/src/pages/redesign/BillingRedesign.jsx:32`
- `frontend/src/pages/redesign/BillingRedesign.jsx:104`

Problem:
Several flows derive security-relevant behavior from URL state:
- tenant setup links
- password reset tokens
- receipt public views
- payment return states
- impersonation sessions

That is common in SPA workflows, but it increases the importance of careful URL cleanup, short-lived tokens, and strong backend validation.

Recommendation:
- keep browser-visible tokens short-lived
- clean URLs as early as possible after use
- prefer backend truth over frontend query-state assumptions

#### 9. I did not find evidence of frontend-declared browser hardening headers or policies

Evidence:
- `frontend/index.html`
- `frontend/vercel.json`

Observation:
I did not find evidence in the frontend deployment files of:
- Content Security Policy
- frame-ancestors / X-Frame-Options
- Referrer-Policy
- Permissions-Policy

These may still be enforced upstream by a reverse proxy or platform config, but they are not visible in the frontend repo surface I reviewed.

Impact:
- security posture depends on external infrastructure assumptions
- clickjacking and script-source hardening are not self-evident from repo config

Recommendation:
- document where these headers are enforced
- if they are not already enforced upstream, add them at the deployment edge

## Additional Notes

### Rendering Posture

The good news is that most of the app follows normal React rendering, which sharply reduces common XSS risk compared with string-built DOM code. I did not find broad misuse of `dangerouslySetInnerHTML`.

The main rendering exception worth fixing is the `document.write` receipt reprint path.

### Admin Browser Risk

The admin browser surface deserves extra care because:
- the admin session is stored in `localStorage`
- impersonation exit depends on that stored admin token
- super-admin actions have a much higher blast radius than normal employee UI actions

Even if the backend is well protected, the browser-side admin story is still more exposed than I would want long-term.

## Priority Recommendations

1. Remove protected API response caching from the service worker, or partition it strictly by session/tenant/user.
2. Reduce browser-stored session/token data for both employee and admin flows.
3. Replace the `document.write` receipt reprint path with safe DOM/component rendering.
4. Remove legacy auth/header bypasses such as the printer-settings `employeeId || "1"` pattern.
5. Tighten and document impersonation URL/session handling.
6. Confirm CSP, frame protection, referrer policy, and permission policy are enforced at the deployment edge.

## Final Assessment

If I were auditing this frontend in isolation, I would say:

- the app is safer than many SPAs in rendering terms
- the bigger risks are state and trust, not JSX injection
- the most important work is reducing how much the browser is trusted to safely hold and replay privileged context

So yes, a frontend security audit was worth doing. The risks are real, but they are concentrated and fixable.
