# Backend route shard: direct `backend/routes/*.js`, basenames N-Z

Read-only audit. Scope was reduced by the parent coordinator to deferred production JavaScript files directly under `backend/routes/` whose basenames sort N-Z. Nested `reports/**`, `restaurant/**`, and `tier4/**` are owned by another worker. Tests, archives, and Shopify nested files are excluded.

## Inspection receipts

Every row below was read through a full-file route/control/query pass. The evidence column records concrete review anchors: route count, explicit guard/validation references, transaction count, and parameterized-query review. Higher-risk entrypoints received additional line-level tracing below.

| Path | Lines | Concrete evidence |
|---|---:|---|
| `backend/routes/orders.js` | 1297 | 15 routes; 18 guard/validation references; 2 transaction blocks; order creation and stock-policy calls traced. |
| `backend/routes/outlets.js` | 135 | 4 routes; admin mutations guarded; deletion/reassignment query flow traced. |
| `backend/routes/outlet-tax-profiles.js` | 144 | 5 routes; feature/admin gates and transactional profile-line replacement traced. |
| `backend/routes/outlet-visibility.js` | 98 | 4 routes; feature/admin gates and both transactions traced. |
| `backend/routes/override-reasons.js` | 95 | 4 routes; feature/admin mutation gates and parameterized CRUD traced. |
| `backend/routes/parked-sales.js` | 96 | 4 routes; `pos_park` mutations and transactional create traced. |
| `backend/routes/pos-devices.js` | 91 | 4 routes; UUID registration upsert plus admin management gates traced. |
| `backend/routes/pos-layouts.js` | 106 | 5 routes; feature/admin gates and dynamic update-column allowlist traced. |
| `backend/routes/price-books.js` | 230 | 5 routes; feature/permission guard and transactional upsert traced. |
| `backend/routes/price-list-assignments.js` | 354 | 7 routes; guards, assignment resolution, and transaction traced. |
| `backend/routes/price-lists.js` | 48 | 1 guarded route and parameterized lookup traced. |
| `backend/routes/printer.js` | 169 | 6 routes; authenticated employee bridge, admin config mutation, and network-printer calls traced. |
| `backend/routes/products.js` | 1796 | 32 routes; product CRUD/bulk operations, uploads, public reviews, channel publication, guards, and transactions traced. |
| `backend/routes/product-serials.js` | 101 | 3 routes; report/inventory read guards and admin toggle traced. |
| `backend/routes/projects.js` | 91 | 10 routes; shared mode/feature/permission gate and service delegations traced. |
| `backend/routes/promotions.js` | 332 | 5 routes; inventory mutations guarded; quote evaluation and hydrated brand lookup traced. |
| `backend/routes/public-bookings.js` | 232 | 5 public routes; tenant resolver, limiter, schema validation, deposit checkout, and ICS lookup traced. |
| `backend/routes/public-reservations.js` | 120 | 2 public rate-limited routes; tenant resolver, schema parsing, and UUID token creation traced. |
| `backend/routes/public-restaurant.js` | 351 | 3 token routes; token-to-draft resolution, server-side product pricing, and submit transaction traced. |
| `backend/routes/purchase-orders.js` | 481 | 10 routes; `manage_orders` gates, validation, receive/stock transaction, and status transitions traced. |
| `backend/routes/receipts.js` | 166 | 1 public route; tenant slug resolution, invoice lookup, returned receipt/customer/payment fields traced. |
| `backend/routes/receipt-templates.js` | 251 | 9 routes; template admin gates, upload flow, and both action-history write paths traced. |
| `backend/routes/rentals.js` | 199 | 21 routes; shared feature/mode/permission gating and service delegations traced. |
| `backend/routes/report-builder.js` | 293 | 7 routes; dataset allowlists, dimension/measure validation, parameterized filters, and definition ownership logic traced. |
| `backend/routes/restaurant.js` | 425 | 22 routes; feature/permission gates and restaurant entity CRUD traced. |
| `backend/routes/restaurant-inbox.js` | 85 | 3 routes; feature/order guards and accept/reject paths traced. |
| `backend/routes/restaurant-kiosk.js` | 241 | 4 routes; admin feature gates, token mint/revoke, and slot lifecycle traced. |
| `backend/routes/return-policies.js` | 117 | 6 routes; feature/admin gates and policy CRUD traced. |
| `backend/routes/returns.js` | 788 | 5 routes; return quote/create, original-sale quantity checks, refund/stock transaction, serial status updates, and gateway refund traced. |
| `backend/routes/risk-controls.js` | 284 | 8 routes; feature/admin gates, approval event lookup, and configuration mutations traced. |
| `backend/routes/roles.js` | 135 | 6 routes; admin gates and transactional permission replacement traced. |
| `backend/routes/rooms.js` | 317 | 30 routes; shared room feature/mode/permission gate and service delegations traced. |
| `backend/routes/sales.js` | 2219 | 5 routes; sale/void flows, price/discount calculation, approval metadata, stock locks, transaction, and post-commit side effects traced. |
| `backend/routes/sandbox.js` | 423 | 4 routes; sandbox-only mount assumption, cross-tenant reference lookup, simulated webhook, and HTML escaping traced. |
| `backend/routes/scheduled-changes.js` | 100 | 3 routes; feature/admin gates and service calls traced. |
| `backend/routes/schedules.js` | 183 | 6 routes; employee-management gates and schedule CRUD traced. |
| `backend/routes/service-tickets.js` | 78 | 6 routes; mode/feature/permission gate and service calls traced. |
| `backend/routes/shifts.js` | 298 | 7 routes; shift routes, employee identity bridge, cash mutations, and guard references traced. |
| `backend/routes/smart-collections.js` | 222 | 5 routes; feature/admin gates, rule evaluation, and both transactions traced. |
| `backend/routes/storefront.js` | 1094 | 16 public routes; tenant resolution, UUID cart/order tokens, server-side quote/stock enforcement, checkout transaction, and payment session creation traced. |
| `backend/routes/subscriptions.js` | 278 | 12 routes; shared mode/feature/permission gate and lifecycle mutations traced. |
| `backend/routes/supplier-returns.js` | 124 | 3 routes; inventory permission, return transaction, and outlet stock decrement traced. |
| `backend/routes/suppliers.js` | 113 | 4 routes; order-management mutation gates and parameterized CRUD traced. |
| `backend/routes/support.js` | 147 | 3 authenticated routes; tenant upload validation/storage and ticket writes traced. |
| `backend/routes/taxes.js` | 55 | 4 routes; admin mutation gates and parameterized CRUD traced. |
| `backend/routes/tax-lookup.js` | 109 | 3 routes; public-reference reads and suggestion insert traced. |
| `backend/routes/tips.js` | 259 | 9 routes; restaurant feature/permission gates and payout transactions traced. |
| `backend/routes/treatment-plans.js` | 456 | 43 routes; shared clinical gate, validation references, and service delegations traced. |
| `backend/routes/treatment-plan-templates.js` | 200 | 5 routes; mode/feature/permission gate, validation, and template session creation traced. |
| `backend/routes/woocommerce.js` | 236 | 5 routes; admin gates, credential handling, remote API calls, and stock sync traced. |

Inspected path count: **50**.

## New findings (checkpoint)

Existing BE-001 through BE-009 are excluded.

### RNZ-001 — High — Checkout trusts client-authored prices, discounts, and redemption value

- CWE: CWE-602 (Client-Side Enforcement of Server-Side Security), CWE-863 (Incorrect Authorization).
- Entry point: `POST /api/sales` at `backend/routes/sales.js:521` accepts any authenticated tenant employee; the route has schema validation but no sale-specific permission middleware.
- Attacker-controlled source: `cartItems[].price`, `discount_amount`, `discount_type`, and `points_redeemed` are destructured from the request (`sales.js:521-568`). `CartItemSchema.price` is only `z.coerce.number()` (`backend/schemas/sales.js:15-20`), while the enclosing schema is passthrough and therefore admits the discount/redemption fields (`schemas/sales.js:33-58`).
- Broken control: price-override checks run only when the client elects to send `price_override` (`sales.js:700-702`). Omitting that optional object bypasses the entire approval path. Even when supplied, an approval event is checked only for `id`, `action_type`, and `status` (`sales.js:732-741`), not product, price, outlet, requester, expiry, or single use.
- Sink: the route computes `subtotal`, `discountValue`, and `totalAmount` directly from those request values (`sales.js:979-988`), synthesizes a payment from that total when none is supplied (`sales.js:990-1007`), stores `totalAmount` in `sales` (`sales.js:1501-1516`), and stores `item.price` as `sale_items.price_at_sale` (`sales.js:1569-1598`).
- Impact: a cashier or any other authenticated employee can sell stock for an arbitrary or negative amount, apply discounts without the `pos_discount`/override controls, or reuse a prior approval event for unrelated merchandise. This enables direct revenue theft and corrupts tax, FBR, loyalty, commission, and accounting records.
- Counterevidence checked: stock quantities are locked and checked in the sale transaction (`sales.js:1380-1497`), and the dedicated override tests reject a missing event only when `price_override` is present. Neither control compares the effective price to server-side product/variant/price-book data or rejects negative totals.
- Remediation: derive effective prices, discounts, promotions, points, tax, and final total from locked server-side records. Treat any requested override as a narrowly bound, expiring, single-use authorization tuple and reject negative prices/totals. Require the appropriate POS permission for checkout and discount operations.

### RNZ-002 — High — Return creation trusts client-authored refund value

- CWE: CWE-602, CWE-863.
- Entry point: `POST /api/returns` at `backend/routes/returns.js:153` (requires `manage_orders`).
- Attacker-controlled source: `total_refund`, each `items[].refund_price`, and `refund_method` are request fields (`returns.js:154-174`). Their Zod fields are coercions with no nonnegative bound and no relationship constraint (`backend/schemas/returns.js:3-24`).
- Broken control: the original-sale validation checks only product/variant membership and remaining quantity (`returns.js:219-277`); it never loads the original `price_at_sale`, recomputes the allowed refund, or checks `total_refund == sum(quantity * allowed price)`. The optional risk threshold only applies when the feature flag is enabled and a positive threshold is configured (`returns.js:331-389`).
- Sink: request values are persisted to `returns.total_refund` (`returns.js:413-437`) and `return_items.refund_price` (`returns.js:449-463`). For card returns the same untrusted total is sent to `paymentGateway.refund` (`returns.js:575-585`); credit reversals reduce the invoice balance using it (`returns.js:517-564`).
- Impact: a user with order-management access can return one legitimate low-value unit while recording or attempting an arbitrarily large cash/card/credit reversal, or submit negative refund values that corrupt ledgers.
- Counterevidence checked: quantity caps, policy quoting, manager-PIN thresholds, and provider-side card-refund behavior limit some cases, but cash/store-credit/accounting paths and flag-off tenants retain the defect. Existing tests pass matching client prices; no test asserts server-derived value or rejects mismatched/negative totals.
- Remediation: in the same transaction, load and lock original sale lines, compute refundable value from immutable sale snapshots and policy, constrain method/amount, and send only the server-derived value to downstream payment/ledger operations.

### RNZ-003 — High — Concurrent returns can both pass the remaining-quantity cap

- CWE: CWE-362 (Concurrent Execution using Shared Resource with Improper Synchronization).
- Entry point/source: two concurrent `POST /api/returns` requests for the same original sale and item, using absent or distinct idempotency keys (`returns.js:153-180`).
- Broken control: sold quantity and prior returned quantity are read before the transaction and without row locks (`returns.js:219-277`). The write transaction begins only at `returns.js:413`; it does not repeat the remaining-quantity check under lock.
- Sink: both requests can insert return headers/items (`returns.js:413-463`) and increment outlet/variant stock (`returns.js:465-491`), then each can initiate a refund (`returns.js:575-585`).
- Impact: duplicate refunds and inventory inflation beyond the quantity originally sold.
- Counterevidence checked: the partial unique index and 409 fallback apply only to the same `(original_sale_id, idempotency_key)` tuple; idempotency keys are optional and distinct keys do not serialize the quantity invariant. `returns-double-refund-cap.test.js` covers sequential requests, not concurrent transactions.
- Remediation: require an idempotency key, lock the sale/returnable line or a per-sale guard row, recompute already-returned quantities inside the transaction, and enforce a database invariant or serialized ledger update before inserting/refunding.

### RNZ-004 — High — Outlet assignment enforcement can validate one outlet while a route mutates another

- CWE: CWE-863.
- Root control: global enforcement reads context/header/query/body outlet IDs but selects the first truthy value (`backend/routes/registerAllRoutes.js:255-260`), then checks only that chosen ID in `employee_outlets` (`registerAllRoutes.js:263-274`).
- Exploit path: a non-admin employee supplies an assigned `X-Outlet-Id`/context and a different unassigned `body.outlet_id`. The middleware validates the header/context outlet, while domain handlers use the body outlet.
- Concrete sinks inspected:
  - sale creation/stock deduction: body source `backend/routes/sales.js:521-568`; sale outlet at `sales.js:1501-1506`; stock sinks `sales.js:1652-1679`;
  - return/restock: source `backend/routes/returns.js:153-174`; return row `returns.js:413-437`; restock `returns.js:465-491`;
  - PO receiving: source `backend/routes/purchase-orders.js:341-350`; GRN/stock sinks `purchase-orders.js:392-420`;
  - supplier returns: source `backend/routes/supplier-returns.js:58-69`; return/stock sinks `supplier-returns.js:78-100`;
  - web-order creation: source `backend/routes/orders.js:307-328`; order outlet sink `orders.js:337-366`.
- Impact: branch-limited employees with the relevant domain permission can create transactions and alter inventory in outlets to which they are not assigned, defeating branch segregation and attribution.
- Counterevidence checked: tenant isolation and permission checks remain in place; all-access and field-rep bypasses are explicit. If no header/context is present, the body outlet is checked. The bypass specifically relies on the precedence mismatch between a valid assigned context and a different body outlet.
- Remediation: reject conflicting outlet sources, normalize one authoritative `req.context.outletId`, and require every branch-scoped route/service to use it. For multi-outlet operations, validate every referenced outlet explicitly.

### RNZ-005 — Medium — Public booking calendar export is enumerable and exposes booking details

- CWE: CWE-639 (Authorization Bypass Through User-Controlled Key), CWE-200.
- Entry point/source: unauthenticated `GET /api/public/bookings/:id/ics` at `backend/routes/public-bookings.js:169`; the path uses a positive integer ID (`public-bookings.js:175-178`).
- Broken control: lookup authorization is only `appointments.id = $1 AND source = 'public'` (`public-bookings.js:181-186`); there is no booking-specific secret/token or ownership proof.
- Sink/data: the query returns customer name and notes (`public-bookings.js:181`), and the generated calendar includes booking number, service, times, location, and notes (`public-bookings.js:192-223`).
- Impact: anyone who knows a tenant slug can enumerate sequential appointment IDs and recover customer/appointment information.
- Counterevidence checked: tenant resolution confines enumeration to one active tenant, invalid IDs return 404, and phone/email are not included. The create endpoint is rate-limited, but this GET export has no route limiter.
- Remediation: mint a high-entropy calendar token per booking, query by a token hash, avoid embedding unnecessary customer notes, and rate-limit failed lookups.

### RNZ-006 — Medium — Sequential invoice numbers act as public receipt credentials

- CWE: CWE-639, CWE-200.
- Entry point: unauthenticated `GET /api/receipts/:invoiceNumber/public` at `backend/routes/receipts.js:4`, explicitly mounted before tenant authentication.
- Predictable source: invoice numbers are generated from a yearly incrementing sequence and padded to five digits (`backend/routes/sales.js:14-25`).
- Broken control: the receipt query authorizes solely by `s.invoice_number = $1` (`receipts.js:31-56`) plus a public tenant slug.
- Sink/data: response includes customer and employee names, full line items/SKUs/prices, discount/tax, payment methods and amounts, and FBR IRN/QR data (`receipts.js:31-150`).
- Impact: an unauthenticated party can enumerate a store's receipts and recover transaction/customer metadata.
- Counterevidence checked: voided receipts are excluded; customer email/phone and raw card details are not returned; tenant resolution prevents cross-tenant lookup without choosing the tenant. The product intentionally supports shareable receipts, but a sequential invoice number is not a possession-grade share token.
- Remediation: use a separate random receipt-share token (store only its hash), support revocation/expiry where appropriate, and return the minimum public fields.

### RNZ-007 — Medium — WooCommerce connection testing permits tenant-admin SSRF

- CWE: CWE-918 (Server-Side Request Forgery).
- Entry point/source: an `all_access` tenant user supplies `store_url` to `POST /api/integrations/woocommerce/connect` (`backend/routes/woocommerce.js:49-63`).
- Broken control: `wooFetch` concatenates the unvalidated URL with a fixed API path and calls `fetch` (`woocommerce.js:6-14`). There is no scheme restriction, DNS/IP allow/deny policy, redirect revalidation, or egress boundary. The URL is persisted and reused by status/import/sync (`woocommerce.js:75-78,117-124,201-212`).
- Sink: backend-originated HTTP requests, with Basic Authorization on the initial request, to attacker-selected hosts; default fetch redirect behavior can extend reachability.
- Impact: an untrusted SaaS tenant administrator can probe private services/cloud metadata reachable from the backend and use response/timing differences as a blind oracle. Persisted URLs provide repeatable access through other integration actions.
- Counterevidence checked: exploitation requires `all_access`; the appended WooCommerce path and JSON parsing reduce response exfiltration; connect returns a generic failure. Those constraints do not prevent blind SSRF or access to internal HTTP services.
- Remediation: accept only HTTPS URLs; resolve and block loopback, link-local, private, reserved, and internal DNS destinations; revalidate every redirect hop; use an egress proxy/allowlist; apply time/size limits.

### RNZ-008 — Medium — Any authenticated employee can forge action-history audit entries

- CWE: CWE-345 (Insufficient Verification of Data Authenticity), CWE-862.
- Entry point: `POST /api/action-history` at `backend/routes/receipt-templates.js:178` has no route permission guard.
- Attacker-controlled source/control failure: `user_name`, `action_type`, and `description` are accepted from the body; only the latter two are checked for presence (`receipt-templates.js:179-183`). The route does not derive identity/action from the authenticated principal.
- Sink: direct insertion into `action_history` (`receipt-templates.js:184-188`). A separate `/api/action-history/log` path is correctly admin-guarded at `receipt-templates.js:194-210`, demonstrating the missing control on the legacy path.
- Impact: any authenticated tenant employee can plant misleading audit records, impersonate another user in the log, and contaminate incident/compliance evidence.
- Counterevidence checked: tenant authentication prevents anonymous/cross-tenant writes, and this endpoint does not modify the underlying business object. It still defeats the integrity purpose of the audit table.
- Remediation: remove the generic client-authored logger or restrict it to a trusted internal service; derive employee identity from `req.employee`, allowlist server-known action types, and log business actions within the same transaction as the protected mutation.

## Suppressed / negative-control notes

- SQL composition in report builder, product sorting, and status filters uses static allowlists plus bound values; no request-controlled identifier reached SQL syntax in this shard.
- Storefront cart/order capabilities use UUID tokens, server-side catalog quoting, stock locks, and a checkout transaction; no predictable-token or client-price finding survived.
- Public restaurant item pricing is reloaded from `products`, and token resolution requires a live kiosk slot/open table draft. The permanent counter token is an operational bearer capability, but no separate privilege boundary was proven.
- Sandbox mutations are anonymous by design but the module is mounted only when the payment adapter is explicitly configured as `sandbox`; this is a deployment precondition rather than a production-code bypass in the reviewed configuration.
- Product review submission can claim a `customer_id` and thereby attach a purchase `sale_id`, but reviews remain moderation-gated. This was retained as a hardening concern, not promoted above the finding bar.
