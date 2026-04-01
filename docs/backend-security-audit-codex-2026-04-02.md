# Backend Security Audit (Codex)

Date: 2026-04-02

Scope: backend only. This audit is based on direct code review of the current Postgres-first backend. I did not rely on the project's own tests for conclusions. Legacy SQLite paths were treated as historical context, not the primary runtime model.

## Executive Summary

The backend security posture is mixed but workable.

What is solid:
- tenant-aware request context exists for the Postgres multi-tenant path
- JWT access tokens, hashed refresh tokens, and token revocation checks are present
- auth and webhook rate limiting exists
- webhook signature verification is implemented for Shopify and xPay
- super-admin actions and security events are logged

What needs attention:
- there is a real admin-surface SQL injection risk in the tax suggestion approval path
- upload handling is inconsistent, and the support upload path becomes unsafe when R2 falls back to local disk
- some trusted internal content is rendered into HTML without escaping
- admin network hardening is optional rather than mandatory
- credential migration is incomplete because plaintext PIN compatibility still exists in live paths

Overall verdict: the backend is not recklessly insecure, but it has a few concrete issues that should be fixed before calling the security model mature.

## Method

I reviewed:
- app bootstrap and middleware order in `backend/index.js`
- route registration and auth/context flow in `backend/routes/registerAllRoutes.js`
- auth, admin, support, upload, setup, billing, webhook, employee, attendance, and company-profile routes
- token utilities and storage helpers
- package dependencies relevant to security posture

## Security Strengths

1. Tenant isolation is designed around per-request tenant DB context.
   Evidence: `backend/index.js`, `backend/tenant-db-proxy-pg.js`, `backend/tenant-db-manager-pg.js`

2. The JWT stack is better than average for an SMB product.
   Evidence: `backend/jwt-auth.js`, `backend/routes/auth.js`, `backend/index.js`
   Notes:
   - refresh tokens are stored hashed
   - access tokens include `jti`
   - revoked-token and blanket session revocation checks exist

3. Webhook verification is implemented instead of trusting unsigned inbound traffic.
   Evidence: `backend/routes/shopify/webhooks.js`, `backend/routes/webhooks.js`, `backend/services/payment-gateway.js`

4. Login and webhook rate limiting exists.
   Evidence: `backend/index.js:217`, `backend/index.js:231`

5. Super-admin activity and security logging exists.
   Evidence: `backend/routes/admin.js`

## Findings

### High

#### 1. Admin-only dynamic SQL injection risk in tax suggestion approval

Evidence:
- `backend/routes/admin.js:1505`
- `backend/routes/admin.js:1510`
- `backend/routes/admin.js:1514`

Problem:
`tenant_slug` is taken from the request body and interpolated directly into:

`UPDATE tenant_${tenant_slug}.tax_rate_suggestions ...`

Even though this route is super-admin only, it is still a real injection sink. Admin-only injection is still security-relevant because it can corrupt tenant data, break the admin plane, or become a stepping stone if the admin UI or token is ever compromised.

Impact:
- cross-schema data manipulation
- destructive SQL if interpolation is abused
- elevated blast radius because this route targets tenant schemas directly

Recommendation:
- never accept schema names from request body without strict server-side validation
- resolve the tenant by trusted tenant id or slug from master DB, then quote/whitelist schema names
- prefer a helper that validates tenant schema identifiers centrally

#### 2. Support upload path becomes unsafe under local-storage fallback

Evidence:
- `backend/routes/support.js:84`
- `backend/routes/support.js:99`
- `backend/routes/support.js:103`
- `backend/utils/r2.js:44`
- `backend/utils/r2.js:50`

Problem:
Support uploads build the object key from raw `file.originalname`:

`support/${Date.now()}-${file.originalname}`

When R2 credentials are missing, `uploadToR2()` falls back to local disk writes under `backend/exports/...`. In that fallback mode, a crafted filename can influence the final path normalization and potentially escape the intended subdirectory.

This is not just cleanliness debt; it is a file-write risk in fallback deployments.

Impact:
- arbitrary or semi-arbitrary file placement in local fallback mode
- upload namespace pollution
- harder incident response because filenames are user-controlled

Recommendation:
- never use raw `originalname` in object keys or filesystem paths
- generate opaque filenames and keep the original name only as metadata
- normalize to a strict allowlist of characters if any user-facing filename must be preserved

#### 3. Trusted HTML email content is built from unsanitized support ticket text

Evidence:
- `backend/routes/support.js:44`
- `backend/routes/support.js:53`

Problem:
Support ticket alerts interpolate the raw `message` into HTML:

`<blockquote>${message}</blockquote>`

That means HTML supplied by a user is rendered inside an internal alert email. This is not the same as browser XSS on the public site, but it is still unsafe trusted-content rendering.

Impact:
- internal email HTML/script-like payloads
- phishing-style markup in staff inboxes
- future risk if the same content is ever reused in an admin UI

Recommendation:
- HTML-escape all user-provided fields before inserting them into email templates
- store raw text if needed, but only render escaped output

### Medium

#### 4. Admin IP restriction is optional, not enforced by default

Evidence:
- `backend/routes/admin.js:41`
- `backend/routes/admin.js:42`
- `backend/routes/admin.js:60`

Problem:
If `ADMIN_ALLOWED_IPS` is unset, `parseAllowedIps()` returns `null`, and admin endpoints allow traffic from anywhere as long as the bearer token is valid.

This is acceptable as a temporary deployment convenience, but weak as a production default for a super-admin plane that can suspend tenants, impersonate stores, and run backups/migrations.

Impact:
- larger exposure of the admin plane to token theft, leaked laptops, reverse proxy misconfiguration, and credential stuffing attempts

Recommendation:
- require `ADMIN_ALLOWED_IPS` in production
- consider a second control such as VPN-only access, admin-specific MFA, or separate admin auth secrets

#### 5. Upload validation is inconsistent across modules

Evidence:
- Product upload has file filtering: `backend/routes/products.js:898`, `backend/routes/products.js:900`
- Support upload only checks declared MIME after upload: `backend/routes/support.js:99`
- Company logo upload has size limits but no type filter: `backend/routes/tier4/company-profile.js:147`, `backend/routes/tier4/company-profile.js:153`

Problem:
The backend has at least three different upload trust models:
- products: filtered and transformed with Sharp
- support: MIME-string checked only
- company logo: no explicit MIME allowlist at route level

This inconsistency raises the chance of unsafe file handling drifting into production.

Impact:
- non-image content accepted in some upload paths
- content-type spoofing
- stored-file abuse if public serving or permissive browser handling is involved

Recommendation:
- centralize upload policy
- whitelist MIME and extension pairs
- re-encode image uploads server-side where feasible
- reject SVG/HTML unless explicitly needed and safely handled

#### 6. Plaintext PIN compatibility is still active in live authentication flows

Evidence:
- `backend/routes/auth.js:13`
- `backend/routes/auth.js:33`
- `backend/routes/auth.js:201`
- `backend/routes/auth.js:222`
- `backend/routes/employees.js:64`
- `backend/routes/employees.js:71`
- `backend/routes/employees.js:91`
- `backend/routes/employees.js:141`
- `backend/routes/employees.js:428`

Problem:
The system still stores and uses `pin_code` alongside `pin_hash`, and several flows fall back to plaintext comparison if a hash is absent.

That made sense during migration, but it means the credential hardening work is incomplete.

Impact:
- higher credential exposure if DB contents or logs are leaked
- migration debt that keeps sensitive data in weaker form
- more branches to secure and test in auth-related code

Recommendation:
- complete a one-way migration to hashed-only PIN handling
- stop writing plaintext `pin_code`
- backfill missing hashes and then remove plaintext fallback paths

#### 7. Security-sensitive links sometimes use raw `CORS_ORIGIN` as a full URL

Evidence:
- `backend/routes/auth.js:487`
- `backend/routes/employees.js:460`
- compare with safer handling in `backend/routes/auth.js:672`

Problem:
Password-reset and related flows sometimes build URLs directly from `process.env.CORS_ORIGIN`. If that env var contains multiple comma-separated origins, the generated link is malformed.

This is more reliability than exploit severity, but broken reset/setup flows are still security-relevant because they affect account recovery and onboarding.

Impact:
- broken password reset links
- setup emails pointing to invalid URLs
- confused-deputy behavior in multi-origin deployments

Recommendation:
- use a dedicated single-value `APP_BASE_URL`
- do not reuse CORS configuration as a canonical frontend URL

### Low

#### 8. Some state-changing routes rely on implicit trust rather than explicit permission checks

Evidence:
- `backend/routes/tier4/company-profile.js:136`
- `backend/routes/receipt-templates.js:81`

Problem:
A few mutating routes do not have clear route-level permission gates. Examples:
- `PUT /api/company-profile/onboarding-dismiss`
- `POST /api/action-history`

In the current Postgres multi-tenant model, these are not necessarily internet-open because tenant DB access depends on request context. Still, they show an inconsistent authorization style that can become dangerous as routes evolve.

Impact:
- easier accidental privilege creep
- more brittle security review because middleware order matters too much

Recommendation:
- require explicit auth/permission decorators on every mutating route
- treat "works because middleware order happens to constrain it" as a code smell

#### 9. Hardening middleware is lighter than expected for an internet-facing admin/API surface

Evidence:
- `backend/index.js`
- `backend/package.json`

Observation:
I did not find evidence of common header-hardening middleware such as `helmet`, and I did not find CSRF-specific protection packages in the backend dependency set.

This is not automatically a vulnerability in an API-first app, especially where bearer tokens dominate, but it does mean some default browser-facing protections are left to reverse proxies or frontend deployment choices.

Recommendation:
- add explicit response-header hardening where compatible
- document which protections are expected from the proxy/CDN layer versus the Node app

## Additional Notes

### Webhook posture

Webhook security is one of the better areas in this backend.

Good points:
- raw body capture exists in `backend/index.js`
- Shopify HMAC verification and replay-window checks exist
- xPay HMAC verification exists
- duplicate-event handling exists

Main caution:
- keep secrets rotated and avoid drifting into "temporary bypass" code during operational incidents

### Auth model

The auth stack is structurally decent, but it is carrying migration baggage:
- JWTs and revocation are solid
- refresh tokens are handled thoughtfully
- PIN/password coexistence adds complexity
- route-level authorization is not consistently explicit

## Priority Fix Order

1. Remove the admin dynamic SQL sink in `backend/routes/admin.js`.
2. Fix upload key generation and local fallback path safety in support uploads.
3. Escape support ticket HTML before sending alert emails.
4. Finish the plaintext PIN deprecation plan.
5. Standardize upload validation across support, company logo, and product media.
6. Make admin IP restriction mandatory in production.
7. Replace `CORS_ORIGIN`-as-URL usage with a dedicated app base URL.

## Final Assessment

If I were taking over this backend as a new project, I would call it:

- architecturally promising
- operationally more mature than many SMB backends
- security-conscious in some core areas
- still carrying a few sharp edges that need deliberate cleanup

The most important conclusion is that the problems are mostly fixable engineering debt, not evidence of a fundamentally unsafe architecture. But the high-severity findings should be treated as real and prioritized quickly.
