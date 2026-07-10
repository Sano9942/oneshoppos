# Types — Claude Guide

TypeScript declaration files (`.ts`) inside an otherwise-JS codebase. `tsconfig` uses `allowJs + noEmit` — these give editor/IDE hints only, no build-time or runtime type checking. Nothing in `frontend/src` imports from this directory (verified by grep) — treat both files as aspirational/reference shapes, not verified contracts.

---

## `auth.ts`

**`AuthEmployee`** — intended shape of the employee object after login (`POST /api/auth/login` / `/api/auth/mt-login`), merged with client-side context.

- `id`, `name`, `username`, `role_id`, `outlet_id` (`number | null`), `permissions` (`string[]`), `token`, `refreshToken?`
- `home_page?: "dashboard" | "retail_home" | null` — per-employee login landing preference
- `employee_type?: "in_store" | "field_rep"` — field_rep routes to `/field/today` on login

Gotcha: this type puts `token`/`permissions` directly on the employee object, but the real `AuthProvider` (`frontend/src/auth/AuthProvider.jsx`) stores those on the session object, not nested under an employee object. Don't treat this file as ground truth for `AuthProvider`'s actual shape — check `AuthProvider.jsx` directly.

**`JwtPayload`** — reference shape of the decoded JWT (`eid`, `tid`, `rid`, `iat`, `exp`). Decoding happens server-side only (`backend/jwt-auth.js`); nothing on the client decodes tokens at runtime, so this has no live consumer — documentation for humans reading auth code, not a used type.

---

## `api.ts`

- **`ApiOk<T>`** — `{ data?: T; message?: string }`, both optional since some endpoints return a bare object instead of a `{ data }` wrapper.
- **`ApiError`** — `{ error: string; details?: unknown }`. Backend convention is always `{ error: string }` on failure; `details` shows up on Zod validation errors.
- **`ApiResponse<T>`** — `ApiOk<T> | ApiError` union.
- **`isApiError(res)`** — the one runtime-callable export in this directory: `res is ApiError` type guard, narrows via `typeof res.error === 'string'`. Not a pure type — an actual function that can be imported and called.

## Consumption status

Nothing in `frontend/src` currently imports `AuthEmployee`, `JwtPayload`, `ApiOk`, `ApiError`, `ApiResponse`, or `isApiError`. The real API error-handling path is `api.js`, which throws a plain `Error` with `.message`/`.status`/`.body` on failure rather than returning an `ApiResponse` union — so `isApiError` doesn't match how `api.js` callers actually handle errors today.

If you're about to add real usage of these types (e.g. wiring `isApiError` into `api.js` or a new component), verify the shape still matches live backend/`AuthProvider` behavior first — these files may have drifted since being declared as aspirational contracts.
