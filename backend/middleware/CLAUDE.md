# Middleware — Claude Guide

- **8 files** — Express middleware, mounted in specific order (see backend/CLAUDE.md Middleware Chain)
- **`tenant-auth.js`** — requires `init(deps)` at boot. Exports 5 middleware in chain order: `loadTenantAndPerms` → `resolveTenant` → `loadCompanyProfile` (5-min cache) → `resolveContext`. In MT mode, `dbProxy` uses AsyncLocalStorage for transparent tenant schema routing
- **`permissions.js`** — `requirePerm(perm)`, `requireAnyPerm(perms[])`, `requireContextOutlet`. `"all_access"` is superuser — bypasses all checks. `PERMISSION_RULES` array for declarative route guards. `ensureDefaultRolePermissions(db)` bootstraps roles
- **`feature-flags.js`** — requires `init(deps)` at boot. `requireFeature(flagKey)` returns 503 if off. `getFeatureFlagsMap(tenantId)` merges DB overrides with `DEFAULT_FEATURE_FLAGS` (60s cache). If `feature_flags` table missing, returns all defaults
- **`plan-limits.js`** — `requirePlanLimit(resource)` for `"employees"`, `"outlets"`, `"products"`. `0` = unlimited. Only active in MT mode. Reads limit from master `tenants` table, counts from tenant DB
- **`rate-limit.js`** — 4 limiters: `globalLimiter` (600/min, skips POS burst paths), `authLimiter` (20/15min), `webhookLimiter` (120/min), `reviewLimiter` (5/15min). Returns 429 with `Retry-After` header
- **`validate.js`** — `validate(schema)` factory for Zod. Replaces `req.body` with parsed result. Returns 400 `{ error, details[] }` on failure
- **`upload-validation.js`** — `imageFileFilter` for multer + `safeExtension()`. Checks both MIME and extension. Allowed: JPEG, PNG, GIF, WebP, SVG, BMP, TIFF
- **`request-id.js`** — pino-http middleware. Generates/honours `X-Request-Id`. `req.log` available after this. Logs warn for 4xx or slow (>2s), error for 5xx
