# Types — Claude Guide

TypeScript declaration files (`.ts`) sitting inside a JS codebase. `tsconfig` uses `allowJs + noEmit` — these give editor/IDE hints only, there is no build-time or runtime type checking. Nothing imports from this directory anywhere else in the frontend source today; treat both files as aspirational/reference shapes, not verified contracts, and don't assume changing them affects behavior.

---

## `auth.ts`

**`AuthEmployee`** — intended shape of the employee object after login (`POST /api/auth/login` / `/api/auth/mt-login`), merged with client-side context.

- `id`, `name`, `username`, `role_id`, `outlet_id` (`number | null`), `permissions` (`string[]`), `token`, `refreshToken?`
- `home_page?: "dashboard" | "retail_home" | null` — per-employee login landing preference
- `employee_type?: "in_store" | "field_rep"` — field_rep routes to `/field/today` on login

Gotcha: this type models `token`/`permissions` as living on the employee object, but the real `AuthProvider` (see `frontend/src/auth/AuthProvider.jsx`) stores those on the session object, not nested under `session.employee`. Don't use this file as the ground truth for `AuthProvider`'s actual shape — check `AuthProvider.jsx` directly.

**`JwtPayload`** — reference shape of the decoded JWT (`eid`, `tid`, `rid`, `iat`, `exp`). Decoding happens server-side only (`backend/jwt-auth.js`); nothing on the client decodes tokens at runtime, so this type has no live consumer — it documents the payload shape for humans reading auth code.

---

## `api.ts`

- **`ApiOk<T>`** — `{ data?: T; message?: string }`, both optional since some endpoints return a bare object instead of a `{ data }` wrapper.
- **`ApiError`** — `{ error: string; details?: unknown }`. Backend convention is always `{ error: string }` on failure; `details` shows up on Zod validation errors.
- **`ApiResponse<T>`** — `ApiOk<T> | ApiError` union.
- **`isApiError(res)`** — the one runtime-callable export in this directory: `res is ApiError` type guard, checks `typeof res.error === 'string'`. Not a pure type — it's an actual function you can import and call.

## Consumption status

Nothing in `frontend/src` currently imports `AuthEmployee`, `JwtPayload`, `ApiOk`, `ApiError`, `ApiResponse`, or `isApiError` (verified by grep across `frontend/src`). The real API error-handling path is `api.js`, which throws a plain `Error` with `.message`/`.status`/`.body` on failure rather than returning an `ApiResponse` union — so `isApiError` doesn't match how `api.js` callers actually handle errors today.

If you're about to add real usage of these types (e.g. wiring `isApiError` into `api.js` or a component), verify the shape still matches the live backend/AuthProvider behavior first — these files may have drifted since they were declared as aspirational contracts.
