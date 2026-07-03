# Confirmed frontend findings

## F-01 — Critical — Offline queue is not tenant-scoped

- Confidence: High.
- Evidence: `frontend/src/utils/offlineQueue.js:3-5` defines one browser-wide database/store; `:18-21` keys rows by `idempotency_key` and indexes only employee/state/time; `:42-45` retrieves solely by `employeeId`; `:85-95` persists no tenant slug/id. `frontend/src/auth/AuthProvider.jsx:138-154` logs out and clears the auth session but never clears or namespaces IndexedDB. `frontend/src/pages/redesign/pos/hooks/useOfflineQueue.js:75-93` then loads the current employee ID's rows and posts them using the current session.
- Affected conditions: Multi-tenant deployment (`VITE_MULTI_TENANT=1`); browsers used for more than one tenant; especially common when tenant-local employee sequences both assign ID `1`. Affects cashier/field-rep offline rows (sales, returns, check-ins, field orders).
- Reproduction / verification: In tenant A as employee ID N, go offline and enqueue a sale. Log out without syncing. Log into tenant B whose employee also has ID N and open POS. `getQueue(N)` returns A's row; syncing sends it under B's current JWT/context. This follows directly from the key/index and current-session interceptor; no production mutation was performed.
- Counterevidence / uncertainty: Random idempotency keys reduce key collision but do not isolate tenants. Backend product/customer IDs may reject some rows; overlapping tenant-local IDs can instead make a semantically wrong sale valid.
- Impact: Cross-tenant exposure of cart/customer/payment metadata and possible posting of another tenant's sale/return into the current tenant. At minimum, stale foreign rows block the 50-row queue cap.
- Remediation direction: Include immutable tenant ID/slug in the IndexedDB primary/index key and every row; query by `(tenant, employee)`. Migrate or quarantine legacy unscoped rows. On logout/account switch, never sync rows whose stored tenant differs from the authenticated tenant.
- Regression tests: Two sessions with the same employee ID but different tenant IDs must see disjoint queues; logout/login tenant switch must not expose or sync the prior tenant's rows; legacy rows must be quarantined.

## F-02 — High — Field offline records are marked failed but have no valid reconnect drain

- Confidence: High.
- Evidence: `offlineQueue.js:124-150` adds `check_in` and `field_order` row types. Field check-in immediately attempts the network then marks failure (`FieldCheckInRedesign.jsx:138-166`); field order does the same (`FieldOrderRedesign.jsx:263-306`). The POS drain selects only `pending` rows (`useOfflineQueue.js:75-84`), routes only `return` specially and sends every other type to `/api/sales` (`:85-93`), then marks failures `failed` (`:104-108`). Field Today only counts check-in rows and never retries (`FieldTodayRedesign.jsx:63-81`). The only retry UI is POS-specific and relabels the action as a stuck sale (`POSStuckQueueModal.jsx:20-48`).
- Affected conditions: Field reps using `wholesale_field_sales`; offline or transient failure after enqueue. Also affects a check-in later retried from the POS stuck-queue UI.
- Reproduction / verification: Submit a field check-in while offline. The interceptor's synthetic 503 makes `api.post` throw; the row becomes `failed`. Reconnect on `/field/today`: only a counter refreshes, no drain runs. If opened through POS retry, `check_in` is posted to `/api/sales` instead of `/api/field/check-in`.
- Counterevidence / uncertainty: A freshly queued POS sale remains `pending` when the app detects offline before attempting the network, and POS has a manual failed-sale retry. No separate field drain/import was found anywhere in `frontend/src`.
- Impact: The UI promises “will sync when connection returns,” but field visits/orders can remain permanently local. This can lose route evidence, GPS/selfie records, and sales; the counter offers no recovery action.
- Remediation direction: Centralize a type-to-endpoint/payload adapter (`sale`, `return`, `check_in`, `field_order`), drain both retryable `pending` and `failed` rows with bounded backoff, preserve ordering (check-in before linked field order), and provide field-specific retry/error UI.
- Regression tests: Offline check-in and linked order should move pending→syncing→synced after an `online` event; assert endpoint/payload per row type; retryable failures should requeue, while validation failures remain actionable and are not endlessly retried.

## F-03 — Medium — Receipt-logo upload stores the request URL instead of the uploaded asset URL

- Confidence: High.
- Evidence: `frontend/src/api.js:65-72` documents and implements `api.upload` as a raw `Response`. `frontend/src/pages/ReceiptTemplates.jsx:97-105` names that response `data` and reads `data.url` without parsing JSON. The backend returns the asset URL in JSON (`backend/routes/receipt-templates.js:156-170`). A Fetch `Response.url` is the request endpoint, not the JSON `url`.
- Affected conditions: Administrator/all-access user uploading a receipt template logo; all deployments.
- Reproduction / verification: Upload a valid image. The request succeeds, then `form.logo_url` becomes the `/api/uploads/receipt-logo` response URL rather than the R2/logo URL returned by the body.
- Counterevidence / uncertainty: Other upload call sites generally parse `await res.json()` explicitly. No unit test covers receipt logo upload.
- Impact: Receipt template preview/save references an API POST endpoint as an image and the logo is broken.
- Remediation direction: Check `res.ok`, parse JSON, then assign parsed `url`; or introduce a separate `api.uploadJson` that follows the throwing JSON contract.
- Regression tests: Mock 201/200 JSON `{url:"https://cdn/logo.webp"}` and assert saved form URL; assert 4xx body surfaces an error and does not mutate the form.

## F-04 — Medium — Clinical document upload reports success for HTTP failures

- Confidence: High.
- Evidence: `api.upload` returns raw responses and does not throw (`api.js:65-72`). `TreatmentPlansRedesign.jsx:1112-1125` awaits it, immediately shows “Document uploaded,” clears inputs and reloads. Backend explicitly returns 400/413/500 failure responses (`backend/routes/treatment-plans.js:338-375`).
- Affected conditions: Users with `manage_treatment_plans`; invalid MIME/magic bytes, invalid metadata, oversized file, missing storage, or server error; feature `phase4_treatment_plans`.
- Reproduction / verification: Submit a file that backend rejects (for example magic-byte mismatch). Fetch resolves with status 400, so the success branch runs and the catch never executes.
- Counterevidence / uncertainty: `onReload()` will not find a new document, but the success toast and cleared form have already misled the user.
- Impact: False success can cause clinical staff to believe a patient document was stored when it was not.
- Remediation direction: Parse response, require `res.ok`, throw the server error otherwise. Prefer a throwing upload helper to prevent recurrence.
- Regression tests: Assert 400/413/500 retain form state and show server message; assert 201 clears state and reloads once.

## F-05 — High — Shared Input and Select become near-white text on a white background in dark mode

- Confidence: High.
- Evidence: Dark tokens set `--ui-text: #f1f5f9` and dark surface `#1e293b` (`frontend/src/ui/tokens.css:28-34`). Shared `Input` and `Select` hardcode `bg-white` while using `text-(--ui-text)` (`frontend/src/ui/primitives.jsx:70-86`). Static usage inventory found 585 `<Input`/`<Select` occurrences, so exposure is broad.
- Affected conditions: Any authenticated/admin feature using the shared primitives after enabling dark mode; all roles and flags depending on page.
- Reproduction / verification: Set `document.documentElement.dataset.theme="dark"` and render shared Input/Select. Computed foreground is `#f1f5f9` on `#ffffff`, approximately 1.1:1 contrast, far below WCAG AA.
- Counterevidence / uncertainty: Call-site classes can override the background or text for individual controls, but the default primitive is defective. Existing E2E only asserts theme attribute changes/persistence (`tests/navigation-ux.spec.js:108-152`), not computed colors.
- Impact: Values, placeholders and options are effectively unreadable across many forms in dark mode.
- Remediation direction: Use `bg-(--ui-surface)` (and platform-appropriate `color-scheme`) for both primitives; add disabled/autofill dark-state coverage.
- Regression tests: Render primitives under light/dark tokens and assert computed contrast ≥4.5:1; add representative form screenshot/axe coverage.

## F-06 — Medium — Modal accessibility is inconsistent and most inline dialogs have no dialog semantics/focus containment

- Confidence: High for representative components and systemic exposure.
- Evidence: Repository inventory found 73 `fixed inset-0` modal/backdrop sites in `frontend/src/pages`/`ui`. The POS shortcut overlay is representative: backdrop/card at `POSShortcutsOverlay.jsx:22-30` have no `role="dialog"`, `aria-modal`, labelled relationship, initial focus or focus trap; its icon-only close button at `:36-38` has no accessible name. Even the shared Modal sets role/label and initial/restored focus (`primitives.jsx:162-214`) but never traps Tab/Shift+Tab inside the dialog.
- Affected conditions: Keyboard and screen-reader users across POS and back-office modal flows; all modes with inline dialogs.
- Reproduction / verification: Open Shortcut Help with F1 and press Tab repeatedly: focus is not constrained to the overlay. Inspect the accessibility tree: the overlay is not announced as a dialog and the X button is unnamed.
- Counterevidence / uncertainty: Shared Modal is materially better (Escape, dialog role, focus restoration), and some inline dialogs may implement local behavior. The count indicates exposure, not that every one of 73 has every defect.
- Impact: Users can navigate behind blocking dialogs, lose modal context, or encounter unnamed controls—especially serious in checkout/approval flows.
- Remediation direction: Migrate inline modals to a hardened shared dialog with labelled title, focus trap, inert/aria-hidden background, Escape policy, initial/return focus and named icon buttons.
- Regression tests: Tab/Shift+Tab cycle inside; Escape and backdrop policy; focus returns to trigger; axe reports no dialog/name violations for POS checkout/help and representative CRUD dialogs.

## F-07 — Medium — POS “Esc closes modal” shortcut only closes three modal states

- Confidence: High.
- Evidence: Shortcut help advertises “Esc — Close modal” (`POSShortcutsOverlay.jsx:18,51`). The global handler only clears discount, parked-sales and shortcut-help states (`POSContext.jsx:852-866`). POS mounts many other blocking dialogs (checkout, receipt, serial, holds, returns, approval, etc.; `POSRestaurantRedesign.jsx:130-189` is representative), and they are inline rather than the shared Escape-aware Modal.
- Affected conditions: Cashiers using keyboard workflows in retail/restaurant POS; especially checkout and error/recovery dialogs.
- Reproduction / verification: Open checkout with F9, press Escape. The global Escape branch does not touch `checkoutOpen`, so it remains open.
- Counterevidence / uncertainty: Individual dialogs may have their own close buttons; no `keydown`/Escape handler was found in the checkout dialog. Some sensitive dialogs may intentionally disallow Escape, but the blanket help text is still incorrect.
- Impact: Keyboard workflow is inconsistent at the highest-frequency screen and can trap or slow cashiers.
- Remediation direction: Maintain a modal stack with a single topmost close policy, or make the help text enumerate supported dialogs. Sensitive non-dismissible dialogs should explicitly announce that behavior.
- Regression tests: Parameterized shortcut tests for every POS dialog; verify only the topmost dismissible dialog closes and no underlying action fires.

## F-08 — Medium — Direct restaurant POS route omits the primary feature-flag gate

- Confidence: Medium-high.
- Evidence: `/pos/restaurant` is wrapped only in `RequireAuth` (`publicRoutes.jsx:148-156`). `POSRestaurantRedesign.jsx:194-208` redirects when preset mode is not restaurant but never checks `phase4_restaurant`. Retail `/pos` redirects into restaurant only when both mode and flag are true (`POSRoute.jsx:12-23`). Backend restaurant APIs require `phase4_restaurant` and `manage_restaurant` (`backend/routes/restaurant.js:37`).
- Affected conditions: Restaurant-mode tenant whose main restaurant flag is disabled/expired, or authenticated employee lacking restaurant permission who deep-links directly.
- Reproduction / verification: With restaurant preset and flag false, visit `/pos/restaurant`: component renders and begins gated API calls instead of redirecting/feature-state. Backend then returns 403s.
- Counterevidence / uncertainty: Backend enforcement prevents unauthorized mutations; this is primarily a frontend access/error-state defect, not an authorization bypass.
- Impact: Users see a broken floor/POS rather than an entitlement/access message; unnecessary gated requests and confusing support incidents.
- Remediation direction: Apply the same preset + feature + permission decision before mounting `POSProvider`, and direct users to a stable access/upgrade screen.
- Regression tests: Matrix for restaurant mode × flag × permission; assert no restaurant API call occurs when denied.

## F-09 — Low — Breadcrumb/loading semantics omit accessible names and status announcements

- Confidence: High.
- Evidence: Breadcrumb `<nav>` has no `aria-label`; its home link contains only a Lucide icon and no `aria-label`; current item lacks `aria-current` (`frontend/src/ui/Breadcrumbs.jsx:122-143`). Route loading is plain text without `role="status"`/`aria-live` (`frontend/src/routes/RouteLoading.jsx:1-8`). The E2E source itself notes the missing breadcrumb aria-label (`tests/navigation-ux.spec.js:66`).
- Affected conditions: Screen-reader users on all lazy app routes.
- Reproduction / verification: Inspect accessibility tree while navigating: navigation landmark is unnamed, home link may be unnamed, and loading changes are not announced.
- Counterevidence / uncertainty: Visible users receive clear breadcrumb/loading text; browser/Lucide versions can expose SVG details differently, but an explicit name is still required.
- Impact: Harder landmark navigation and silent route transitions.
- Remediation direction: `aria-label="Breadcrumb"`, `aria-label="Home"`, decorative separators/icons, `aria-current="page"`, and a polite status region for route loading.
- Regression tests: Testing Library role/name assertions plus an axe check.

## F-10 — Low — API parity npm scripts point to a deleted scanner

- Confidence: High.
- Evidence: `frontend/package.json:11-13` invokes `../tools/api-parity-audit.js`; the file is absent (only `tools/inspect-slow-queries.js` exists). Backend scripts reference the same missing file. `docs/archive/ROADMAP.md:299` confirms the scanner/workflow was previously deleted.
- Affected conditions: Developers/CI attempting frontend-backend parity audit/checks.
- Reproduction / verification: `npm.cmd run parity:audit` resolves to a nonexistent module and fails before analysis.
- Counterevidence / uncertainty: The current CI workflow may no longer invoke it; scripts remain user-facing and misleading.
- Impact: Contract drift check cannot run, weakening detection of route/API mismatches.
- Remediation direction: Restore a maintained scanner or remove/replace scripts and document the supported parity workflow.
- Regression tests: Execute parity command in CI and assert the scanner completes with a machine-readable report.
