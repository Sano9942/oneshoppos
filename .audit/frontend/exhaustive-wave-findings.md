# Additional confirmed frontend findings — exhaustive deferred-file wave

## F-11 — High — POS cart-resume checkpoints are not tenant-scoped

- Confidence: High.
- Evidence: `frontend/src/pages/redesign/pos/POSContext.jsx:276` keys the checkpoint only as `pos_cart_checkpoint_${employee.id}`. The stored object contains the entire cart, outlet ID, and selected customer object (`:306-321`), and the next session with that employee ID reads and offers it for restore (`:280-299`). Tenant logout calls `clearSession()` (`frontend/src/auth/AuthProvider.jsx:153`), while neither that logout path nor `authStore.clearSession()` removes POS checkpoint keys.
- Affected conditions: Multi-tenant deployment; the same browser tab is used to log out of tenant A and into tenant B within eight hours; both schemas assign the same tenant-local employee ID (commonly `1`).
- Reproduction / verification: In tenant A as employee ID 1, add a product and customer and wait one second for the checkpoint. Log out, then log into tenant B as employee ID 1 in the same tab and open POS. The tenant-B POS reads tenant A's checkpoint and presents it for restoration; accepting it installs tenant-A product/customer/outlet identifiers into tenant B's current cart state.
- Counterevidence / uncertainty: The eight-hour TTL limits persistence. Backend validation may reject identifiers that do not exist in tenant B, but overlapping tenant-local IDs can instead resolve to different valid records.
- Impact: Cross-tenant disclosure of product, pricing, customer and outlet data in the resume prompt; accepting the prompt can create a semantically wrong tenant-B cart and potentially a wrong sale when identifiers overlap.
- Remediation direction: Include immutable tenant ID/slug in the checkpoint key and payload, verify it before displaying/restoring, and quarantine or delete legacy unscoped checkpoints. Clear only the departing tenant's checkpoint on logout.
- Regression tests: Two tenants with employee ID 1 must have disjoint checkpoints; a tenant switch must not display or restore the prior tenant's cart; legacy keys must not be trusted.

## F-12 — Medium — Failed upgrade-request decisions disappear from the super-admin UI

- Confidence: High.
- Evidence: `frontend/src/pages/admin/AdminTenantDetail.jsx:493-498` awaits raw `adminFetch()` for Approve/Dismiss but never checks `Response.ok`; Fetch resolves normally for HTTP 4xx/5xx, after which the request is unconditionally removed from local state. The backend can return 400, 404, or 500 without applying the decision (`backend/routes/admin/billing.js:170-195`).
- Affected conditions: Expired/invalid admin authorization, IP-policy denial, request already handled in another tab, validation failure, or database/server error while resolving a tenant upgrade request.
- Reproduction / verification: Make the PUT return 500 (or resolve the request concurrently so it returns 404), then click Approve. The row vanishes from the current page even though the backend did not update it; it reappears only after data is reloaded.
- Counterevidence / uncertainty: A full reload restores still-pending requests, so persistence is not corrupted. No success toast is shown, but disappearance is the only decision feedback.
- Impact: Super-admins can believe a billing decision succeeded and leave a tenant's upgrade pending, delaying activation or follow-up.
- Remediation direction: Parse the response, require `res.ok` before mutating local state, surface the backend error, and refresh the authoritative list after success or conflict.
- Regression tests: 400/401/404/500 responses retain the row and show an error; only a successful response removes it; concurrent resolution triggers a list refresh.

## F-13 — Medium — Storefront checkout clears a different cart-hook instance and leaves the active storefront cart stale

- Confidence: High.
- Evidence: `StorefrontLayout.jsx:18,85` creates the long-lived cart hook and exposes it through context; product detail uses that instance to add items (`StorefrontProductDetail.jsx:11,30`). Cart and checkout each create separate `useStorefrontCart(tenantSlug)` instances (`StorefrontCart.jsx:32`, `StorefrontCheckout.jsx:12`). After checkout, only checkout's local instance is cleared (`StorefrontCheckout.jsx:145`). The layout instance retains its `tokenRef` (`useStorefrontCart.js:14,78`), while checkout deletes the server cart (`backend/routes/storefront.js:885`).
- Affected conditions: A shopper completes an order and then navigates within the still-mounted `/store/:tenantSlug` layout to continue shopping, without a full page reload.
- Reproduction / verification: Add an item, check out successfully, navigate from the order page to a product, and add it. Product detail calls the layout cart instance; `ensureToken()` returns the stale pre-checkout token, and the add request targets a cart deleted during checkout, so the add fails. The independent instances also race the header count (layout sums quantities while the cart page sets line count).
- Counterevidence / uncertainty: A full reload remounts the layout, rereads the cleared localStorage key, and restores normal behavior. Checkout manually sets the visible count to zero, masking the stale context until the next add.
- Impact: Repeat shopping in the same SPA session is broken after a successful order, and cart-count state can be inconsistent across storefront pages.
- Remediation direction: Create exactly one cart hook in `StorefrontLayout`; consume `context.cart` everywhere, and call that shared instance's `clearCart()` after checkout. Derive the badge in one place from shared items.
- Regression tests: Complete checkout then add another product without reload; assert a fresh cart token is created. Verify badge quantity consistently across product, cart, checkout, and order pages.

## F-14 — Medium — Manufacturer portal hardcodes Pakistani currency for every tenant

- Confidence: High.
- Evidence: Dashboard, sales, and promotions format all money with literal `"Rs "` (`ManufacturerPortalDashboard.jsx:6-11`, `ManufacturerPortalSales.jsx:10-15`, `ManufacturerPortalSchemes.jsx:12-17`); promotions also labels fixed discounts as `Rs off` (`ManufacturerPortalSchemes.jsx:33-35`). The authenticated `/me` response selects partner/brand fields but no company currency (`backend/routes/manufacturer-portal/data.js:112-145`), so the frontend has no tenant currency to use.
- Affected conditions: Any non-Pakistan tenant using the manufacturer-partner portal; multi-country configuration is supported by company/country-pack currency fields.
- Reproduction / verification: Configure a tenant with USD, AED, SAR, or another currency and open manufacturer dashboard/sales/promotions. Every amount is still presented as rupees, including CSV-adjacent report views and fixed-discount labels.
- Counterevidence / uncertainty: Current commercial deployment may be predominantly Pakistani, but the application schema/setup supports other country packs and currencies; no route-level restriction limits this portal to Pakistan.
- Impact: Partners receive materially mislabeled revenue and promotion values, creating reporting and commercial interpretation risk.
- Remediation direction: Return `currency_symbol` and `currency_code` from an authenticated portal bootstrap/profile response and use a shared `Intl.NumberFormat` formatter across all manufacturer pages and exports.
- Regression tests: Parameterize PKR, USD, AED, and SAR tenants; verify dashboard, sales, promotion labels, and downloaded report metadata use the tenant currency.
