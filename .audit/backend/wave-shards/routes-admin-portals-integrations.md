# Routes: admin, portals, integrations, Shopify — exhaustive shard

Status: complete. Read-only source audit; no application or shared-ledger changes. **30 deferred production JavaScript files reviewed in full.**

## Full-file receipts

| Path | Evidence scope inspected |
|---|---|
| `backend/routes/admin/billing.js` | All 275 lines: every super-admin pricing, payment, upgrade, attention, and stuck-intent route; authentication/IP guards; master/tenant DB writes and email/audit side effects. |
| `backend/routes/admin/compliance.js` | All 151 lines: every tax-rate/suggestion/FBR-health route; guards, validation, schema identifier construction, tenant fan-out, and public-reference mutations. |
| `backend/routes/admin/monitoring.js` | All 324 lines: all protected stats/attention/cleanup/revenue/infra routes, dynamic tenant-schema queries, cache behavior, and PostgreSQL monitoring queries. |
| `backend/routes/admin/operations.js` | All 321 lines: support-ticket fan-out/mutations, impersonation issue/end lifecycle, revocation handling, Shopify/payment dead-letter reads and retry. |
| `backend/routes/admin/system.js` | All 313 lines: worker status, orphan detection/drop, backup creation/verification/history, auth guards, process/file boundaries, dynamic schema DDL. |
| `backend/routes/customer-portal/auth.js` | All 528 lines: public tenant resolution, login/signup/OTP/verification, refresh rotation, logout, password reset, cookie/token and email boundaries. |
| `backend/routes/customer-portal/data.js` | All 700 lines: public config plus every customer-authenticated profile/order/invoice/reorder/subscription/loyalty/wallet/address route; ownership predicates, visibility control, gateway call, and transactions. |
| `backend/routes/customer-portal/appointments.js` | All 228 lines: create/reschedule/cancel routes, ownership checks, schemas, booking-service calls, and notification effects. |
| `backend/routes/customer-portal/payments.js` | All 113 lines: invoice ownership/status checks, active-link reuse, gateway checkout creation, payment-link persistence, and returned identifiers. |
| `backend/routes/customer-portal/stays.js` | All 45 lines: customer-authenticated booking/folio/invoice query and failure behavior. |
| `backend/routes/customer-portal/treatments.js` | All 144 lines: plan ownership root query and all child clinical-data queries/share filters. |
| `backend/routes/manufacturer-portal/auth.js` | All 397 lines: public tenant resolution, invite/reset setup, login, refresh rotation, forgot-password, logout, cookie/token/email boundaries. |
| `backend/routes/manufacturer-portal/data.js` | All 540 lines: manufacturer auth/limiting, brand allowlist derivation, summary/sales/promotion/CSV queries, dynamic-but-enumerated grouping, and CSV encoding. |
| `backend/routes/integrations/index.js` | All 23 lines: router composition and mount location. |
| `backend/routes/integrations/credentials.js` | All 146 lines: permission/feature guards, validated connect/disconnect, encrypted credential storage, status/config disclosure, and SMS/test actions. |
| `backend/routes/integrations/hub.js` | All 74 lines: guarded integration/courier/Shopify inventory query and response projection. |
| `backend/routes/integrations/daraz.js` | All 157 lines: guarded client construction, outbound test/sync/pull/push operations, order/map persistence, and external-data handling. |
| `backend/routes/integrations/facebook.js` | All 155 lines: guarded Meta client construction, product/order/inventory outbound operations, remote order ingestion, dedupe checks, and map persistence. |
| `backend/routes/integrations/google-merchant.js` | All 111 lines: guarded Google client construction, product/feed operations, remote status ingestion, and feed-log mutations. |
| `backend/routes/integrations/whatsapp.js` | All 94 lines: guarded client construction, test/template sends, caller-selected destination/order/tracking data, post-send message persistence, and conversation reads. |
| `backend/routes/shopify/index.js` | All 52 lines: dependency wrappers, active-connection/category helpers, and registration of every Shopify route module. |
| `backend/routes/shopify/config.js` | All 110 lines: config read/save/disconnect, permissions, secret encryption/masking, active-connection transaction, and unvalidated remote-domain storage. |
| `backend/routes/shopify/health.js` | All 276 lines: status/verify/location/live validation, webhook setup/host-derived callback, UAT checklist, permissions, and outbound Shopify calls. |
| `backend/routes/shopify/orders.js` | All 81 lines: manual pull, remote order upsert, event/run bookkeeping, idempotency keys, and swallowed bookkeeping failures. |
| `backend/routes/shopify/import.js` | All 310 lines: remote product/inventory import, local identity matching, product/map/metadata/stock writes, error swallowing, and bulk mapped-product deletion. |
| `backend/routes/shopify/mappings.js` | All 362 lines: product/location/customer mapping reads and writes, live auto-match generation, caller-supplied suggestion application, conflict checks, and mapping transactions. |
| `backend/routes/shopify/reconciliation.js` | All 350 lines: reconciliation generation, remote inventory batches, local snapshot replacement, row resolution, approval-request path, and direct bulk fix/ignore paths. |
| `backend/routes/shopify/sync.js` | All 245 lines: event filtering/retry, queue processing callbacks, run bookkeeping, inventory event enqueue/process flows, and permissions. |
| `backend/routes/shopify/webhooks.js` | All 115 lines: webhook limiter, shop/HMAC/timestamp controls, idempotency precheck, order upsert, event recording, and response behavior. |
| `backend/routes/admin.js` | Both lines: modular admin re-export only; no runtime control beyond delegation to `admin/index`. |

Supporting evidence inspected: `backend/routes/registerAllRoutes.js:171-245` (portal routes mount before tenant/subscription middleware), `backend/routes/webhooks.js:280-305,311-435` (invoice-link and wallet callback lookup/commit), and `backend/services/marketplace/daraz-client.js` (all 146 lines; configured base URL reaches `fetch`).

## New source-backed findings (provisional; shard review continuing)

### RAP-001 — Medium — Portal business writes bypass tenant subscription and feature enforcement

- CWE: CWE-284 (Improper Access Control)
- Entrypoint/control: `backend/routes/registerAllRoutes.js:183-197` mounts all customer/manufacturer portal routers before `requireActiveSubscription` at `:229-232` and before tenant feature middleware.
- Reachable sinks: `backend/routes/customer-portal/appointments.js:73-103,130-157,184-201` creates/reschedules/cancels appointments with only portal authentication and body schemas; `backend/routes/customer-portal/data.js:599-632,639-679,686-693` mutates addresses; `backend/routes/customer-portal/payments.js:20-98` creates gateway payment links. No route-local subscription or feature guard is present.
- Impact: an authenticated end customer can continue mutating an expired tenant's business data; appointment APIs remain writable even when the appointment feature is disabled. This defeats the documented read-only expiration state and per-tenant feature entitlement boundary.
- Remediation: after public tenant resolution, apply a portal-compatible active-subscription guard to all writes and explicit feature checks to feature-specific routes (appointments, invoicing, etc.); fail closed on entitlement lookup errors.
- Counterevidence/limits: portal JWT authentication and customer ownership checks are present. They authenticate the customer but do not enforce the tenant subscription/feature entitlement.

### RAP-002 — Medium — Manufacturer sales CSV permits spreadsheet formula injection

- CWE: CWE-1236 (Improper Neutralization of Formula Elements in a CSV File)
- Source: customer-controlled `city` is accepted by `backend/routes/customer-portal/data.js:136-155`; product and brand names are also stored tenant inputs.
- Entrypoint/control/sink: `backend/routes/manufacturer-portal/data.js:398-420` selects city/brand/product into export rows; `:423-440` writes them into CSV; `csvEscape` at `:529-532` only quotes delimiters and does not neutralize leading `=`, `+`, `-`, `@`, tab, or carriage return.
- Impact: when a manufacturer opens the export in Excel/compatible software, a crafted city/product/brand value can execute as a spreadsheet formula, enabling content spoofing and, depending on client policy, external callbacks/data exfiltration.
- Remediation: neutralize formula-leading characters before CSV quoting (for example prefix a single quote), and centralize exports on the project's safe CSV helper with formula-injection tests.
- Counterevidence/limits: SQL is parameterized and RFC-style CSV quoting prevents delimiter breakout; quoting alone does not prevent formula interpretation.

### RAP-003 — Medium — Ending impersonation acknowledges success when token revocation fails

- CWE: CWE-754 (Improper Check for Unusual or Exceptional Conditions), CWE-613 (Insufficient Session Expiration)
- Entrypoint: protected super-admin endpoint `backend/routes/admin/operations.js:210-218` selects an impersonation session to end.
- Broken control/sink: tenant `revoked_tokens` insertion failure is caught and only warned at `:221-233`; the route still marks the master session ended/revoked at `:235-237` and returns `{ok:true}` at `:239-240`.
- Impact: on a tenant DB/schema/transient failure, the UI and audit state say impersonation ended while the already-issued full-scope tenant JWT remains usable until its one-hour expiry.
- Remediation: make tenant-token revocation a required precondition for success (or implement a master-level revocation check used by tenant auth); return failure/retry state and reconcile incomplete revocations durably.
- Counterevidence/limits: the endpoint is super-admin/IP protected and normal successful inserts revoke the JWT. The finding is the explicitly swallowed failure window, distinct from BE-009's revocation-read fail-open behavior.

### RAP-004 — Medium — Daraz configurable base URL creates authenticated SSRF and credential forwarding

- CWE: CWE-918 (Server-Side Request Forgery)
- Source/control: an `all_access` tenant user can set arbitrary URL-shaped `store_url` through `backend/routes/integrations/credentials.js:7-35`; validation is URL syntax only (`backend/schemas/integrations.js:6`). No scheme, host, DNS/IP, redirect, or egress allowlist is enforced.
- Entrypoints: `backend/routes/integrations/daraz.js:19-30,35-75,79-123,127-156` construct the client and trigger outbound calls.
- Sink: `backend/services/marketplace/daraz-client.js:7,20-34` concatenates the configured base URL with an API path and calls `fetch`; query parameters include the decrypted app key, OAuth access token, timestamp, and HMAC signature (`:21-31`).
- Impact: a tenant administrator can make the backend request attacker-chosen internal/cloud-metadata destinations and can forward configured Daraz credentials to an attacker-controlled server.
- Remediation: do not accept a base URL for Daraz in production, or enforce HTTPS plus a canonical Daraz hostname allowlist, reject private/link-local/loopback/reserved IPs after DNS resolution, and constrain redirects with revalidation.
- Counterevidence/limits: configuration requires `all_access` and execution requires authenticated marketplace permissions/feature enablement. Tenant administrators remain untrusted relative to the platform network and other tenants.

### RAP-005 — Medium — Shopify shop domain creates a second authenticated SSRF and token-forwarding surface

- CWE: CWE-918 (Server-Side Request Forgery)
- Source/control: a tenant user with `manage_inventory` stores arbitrary `shop_domain` at `backend/routes/shopify/config.js:32-86`; the only normalization is lowercase/trim at `:48`, with no Shopify hostname or network-range allowlist.
- Entrypoints: connection verification, location/catalog/order/inventory operations are reachable through `backend/routes/shopify/health.js:84-189`, `orders.js:8-75`, `import.js:11-265`, and `mappings.js:87-173`.
- Root control/sink: `backend/shopify/client.js:8-15` strips a scheme/path but accepts arbitrary host, userinfo, port, loopback, link-local, and private-network forms; `:31-45` fetches `https://${shopDomain}/...` and forwards the decrypted `X-Shopify-Access-Token`.
- Impact: a tenant inventory manager can induce requests to HTTPS services reachable from the backend and forward a configured Shopify access token to an attacker host. Crafted authority syntax such as userinfo can make a superficially benign prefix resolve to another destination.
- Remediation: require a canonical hostname matching an approved Shopify domain suffix (with exact label-boundary validation), reject userinfo/ports unless explicitly required, resolve and block private/link-local/loopback/reserved addresses, and revalidate redirects.
- Counterevidence/limits: requests are forced to HTTPS and the path is fixed. Those constraints reduce reachable services but do not establish a destination trust boundary.

### RAP-006 — Medium — Bulk reconciliation bypasses the approval-gated fix workflow

- CWE: CWE-862 (Missing Authorization), CWE-840 (Business Logic Errors)
- Intended control: single-row fix requests require the `approvals` feature and create an `approval_requests` row without applying inventory changes at `backend/routes/shopify/reconciliation.js:239-275`.
- Bypass entrypoint/sink: the bulk endpoint at `:283-349` requires only `manage_inventory`; `action="fix", mode="shopify_wins"` directly overwrites `outlet_stock.quantity` at `:313-325` and marks reconciliation rows resolved at `:330-337`, with no approval check or request.
- Impact: a user who is supposed to submit reconciliation fixes for approval can bypass that workflow by selecting the same row IDs through the bulk API, immediately changing inventory quantities and closing the audit rows.
- Remediation: route bulk fixes through the same approval-request mechanism as single-row fixes, or require the explicit approval permission and validate an approved request before applying; add parity tests across single and bulk actions.
- Counterevidence/limits: `manage_inventory` is still required and all queries are tenant scoped. The broken boundary is the repository's explicit approval workflow, not cross-tenant access.

### RAP-007 — Medium — Public customer signup mutates existing POS customer records before email ownership is proven

- CWE: CWE-862 (Missing Authorization), CWE-639 (Authorization Bypass Through User-Controlled Key)
- Entrypoint/source: unauthenticated `POST /api/portal/auth/signup` resolves an attacker-chosen active tenant and accepts email/name/mobile/password at `backend/routes/customer-portal/auth.js:164-171`.
- Broken control/sink: if a POS customer row already has that email but has never enabled the portal, lookup at `:185-190` selects it and the public request immediately overwrites its name, mobile, and portal password hash at `:193-202`. Email verification is generated only afterward at `:213-231` and does not roll back the profile mutation.
- Impact: anyone who knows a tenant slug and customer email can alter that customer's core POS name/mobile data and plant a portal password before proving control of the email, potentially corrupting communications, customer lookup, and downstream records.
- Remediation: keep pending signup data in a separate verification record; mutate/attach the existing customer only in one transaction after a valid email-verification token is consumed. At minimum, never update core name/mobile fields before verification.
- Counterevidence/limits: the attacker cannot enable the portal session without the emailed OTP, and an already-enabled portal account returns 409. The unauthorized persistent profile mutation occurs specifically for existing unenabled customer rows.

### RAP-008 — Medium — Portal refresh-token rotation is race-replayable in both portal implementations

- CWE: CWE-367 (Time-of-check Time-of-use Race Condition), CWE-384 (Session Fixation)
- Customer instance: `backend/routes/customer-portal/auth.js:384-398` selects an unrevoked token and later revokes it unconditionally; `:400-408` then issues/stores a replacement. Two concurrent requests can both pass the select before either update commits and both mint valid successor sessions.
- Manufacturer instance: the duplicated sequence at `backend/routes/manufacturer-portal/auth.js:256-270,272-286` has the same independent race.
- Impact: an attacker replaying a stolen refresh token concurrently with the legitimate browser can preserve a separate valid token chain despite rotation, weakening theft detection and single-use refresh semantics.
- Remediation: atomically claim the old token with `UPDATE ... SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>NOW() RETURNING ...`, then create the successor in the same transaction; revoke the token family when replay is detected.
- Counterevidence/limits: JWT signature, tenant/scope checks, expiration, and stored-token checks are present. They do not serialize concurrent claims of the same row.

### RAP-009 — Medium — Manufacturer invite/password-reset token consumption is race-replayable

- CWE: CWE-367 (Time-of-check Time-of-use Race Condition), CWE-613 (Insufficient Session Expiration)
- Entrypoint/source: public setup accepts a bearer invite/reset token at `backend/routes/manufacturer-portal/auth.js:125-141` and checks its expiry/status at `:143-154`.
- Broken control/sink: after a bcrypt delay, the update at `:157-169` targets only `WHERE id=$1`, not the still-present token or expiry. Concurrent requests that selected the same token can both set different passwords, clear the token, and issue sessions at `:171-182`.
- Impact: a token intercepted or reused during a legitimate setup/reset can win the password race and obtain its own access/refresh session even though the link is documented as single-use.
- Remediation: claim the token atomically (`UPDATE ... WHERE signup_token=$token AND expires_at>NOW() ... RETURNING`) in a transaction, make only the winner hash/set the password and issue a session, and store reset tokens hashed at rest.
- Counterevidence/limits: tokens are high entropy, time-limited, and cleared after use; suspension is checked. The update predicate fails to preserve those controls across concurrency.

## Important negative/control evidence

- Every reviewed modular super-admin route applies both `requireAllowedIp` and `requireSuperAdmin`; no anonymous admin operation was found in this shard.
- Portal and manufacturer read queries consistently derive object identity from verified portal JWTs and include customer/brand ownership predicates. Child clinical queries are reached only after the owning treatment-plan root query succeeds.
- SQL values are parameterized throughout. Dynamic SQL fragments in manufacturer grouping are selected from fixed enumerations; dynamic tenant identifiers originate from validated tenant slugs; bulk placeholder lists are generated from array positions, not values.
- Shopify webhook code validates HMAC over `rawBody`, shop domain when supplied, and a timestamp window. In multi-tenant deployment it is mounted after tenant auth and is not on the public tenant allowlist, so ordinary Shopify callbacks appear unable to reach it without a tenant JWT; this is an integration-availability defect, not an auth bypass, and was not promoted as a security finding here.
- `shopify/import/products` can delete any product present in `shopify_product_map`, including pre-existing locally mapped products, and performs multi-table deletes without one transaction. Because `manage_inventory` already authorizes destructive catalog operations, this was retained as a serious product-integrity concern rather than promoted as a distinct privilege-boundary finding.
