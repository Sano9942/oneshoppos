# API authentication and tenant matrix

| Surface | Mount position / tenant source | Authentication / authorization | Audit result |
|---|---|---|---|
| `/api/health` | Before tenant middleware; raw pool for deep check (`registerAllRoutes.js:51-148`) | Public | Expected; no tenant data query |
| `/api/webhooks/xpay` | Before tenant middleware; intent/gateway reference resolution | HMAC via adapter (`webhooks.js:466-475`) + webhook limiter | Signature positive; atomicity defect BE-001 |
| `/api/webhooks/meta`, `/whatsapp`, `/daraz` | Before tenant middleware | Rate limiter; GET verification tokens only; no POST signature check found | WhatsApp routing/ack defect BE-004; Meta/Daraz currently log/ack only |
| Public receipts/gift cards/storefront/restaurant/reservations/bookings | Before tenant middleware; each is expected to resolve tenant explicitly (`registerAllRoutes.js:158-181`) | Public domain-specific tokens/identifiers and rate limits as implemented | Boundary inventoried; no cross-tenant claim made without sink evidence |
| Customer/manufacturer portals | Before employee tenant middleware; `resolvePublicTenantDb` + scope-specific JWT | Separate customer/manufacturer auth chain (`registerAllRoutes.js:183-197`) | Structure is tenant-separated; targeted unit portal tests included in suite |
| `/api/setup/*` | Before employee auth; tenant from query/body | Completion uses high-entropy setup token; status has no token | PII disclosure BE-006 |
| Tenant employee API | JWT -> `loadTenantAndPerms` -> `resolveTenant` ALS -> company/context -> subscription -> route guards (`registerAllRoutes.js:211-255`) | Route `requirePerm/requireAnyPerm`, features/modes, Zod where applied | Core sequence positive; revocation fail-open BE-009 |
| Super-admin API | Mounted outside tenant chain; raw public pool | `requireAllowedIp` then `requireSuperAdmin` on protected routes; login is limited | Middleware use confirmed across declarations; raw-pool search-path contamination BE-003 |
| Password reset | Tenant resolved from store code/public auth allowlist | Random token; no session required | CPU amplification BE-005; reset writes are also separate queries, so single-use atomicity should be covered when remediating |

## Tenant isolation controls verified

- Public `?tenant=` is honored by central `resolveTenant` only on an explicit allowlist (`tenant-auth.js:33-40, 216-247`).
- Tenant identity for authenticated employee routes comes from the verified JWT `tid`, not an arbitrary header (`tenant-auth.js:87-115`).
- ALS-scoped `deps.db.query/transaction` resolves through a per-tenant wrapper using `SET LOCAL` (`tenant-auth.js:253-262`; `tenant-db-manager-pg.js:58-87`).
- Missing JWT on non-public `/api` routes returns 401 before tenant handlers (`tenant-auth.js:240-248`).
- Permission middleware defaults to deny when permission state is absent (`permissions.js:5-27`).

## Authorization regression targets

1. Every pre-tenant write must prove signature/token/rate-limit and explicit tenant resolution.
2. Every admin route must retain both IP allowlist and admin JWT checks.
3. Kiosk/customer/manufacturer/admin token scopes must be rejected across other surfaces.
4. Revocation lookup failures must not authorize execution (BE-009).
5. Anonymous setup status must not return employee PII (BE-006).

