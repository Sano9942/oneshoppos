# Types — Claude Guide

**2 TypeScript declaration files.** tsconfig uses `allowJs + noEmit` — no runtime type checking enforced. These are reference-only shapes for editor tooling.

---

## `auth.ts`

### `AuthEmployee`

Shape of the employee object stored in `AuthProvider` after login (from `POST /api/auth/login` or `/api/auth/mt-login`). Note: the actual `AuthProvider` stores `permissions` and `token` on the session object, not inside `session.employee`; `AuthEmployee.token` and `AuthEmployee.permissions` being required in this type does not match single-tenant sessions — treat as a loose reference shape.

| Field | Type | Notes |
|-------|------|-------|
| `id` | `number` | |
| `name` | `string` | Display name |
| `username` | `string` | Login username |
| `role_id` | `number` | |
| `outlet_id` | `number \| null` | Null if no outlet assigned |
| `permissions` | `string[]` | Array of permission strings |
| `token` | `string` | JWT access token |
| `refreshToken` | `string?` | Present when refresh tokens issued |

### `JwtPayload`

Reference shape for the decoded JWT payload. **Decoding is server-side only** — not decoded client-side at runtime:

| Field | Type | Notes |
|-------|------|-------|
| `eid` | `number` | Employee ID |
| `tid` | `number` | Tenant ID |
| `rid` | `number` | Role ID |
| `iat` | `number` | Issued-at timestamp |
| `exp` | `number` | Expiry timestamp |

---

## `api.ts`

### `ApiOk<T>`
```ts
{ data?: T; message?: string }
```
Both fields optional — some endpoints return a direct object (no `data` wrapper), some return only `message`.

### `ApiError`
```ts
{ error: string; details?: unknown }
```
Backend always returns `{ error: string }` on failure. `details` is present on Zod validation errors.

### `ApiResponse<T>`
```ts
type ApiResponse<T> = ApiOk<T> | ApiError
```

### `isApiError(res)` — **runtime callable, not just a type**

```ts
isApiError(res: ApiResponse): res is ApiError
// Returns true if res.error is a string
```

Use to narrow an `ApiResponse` to the error case. Import and call directly. Note: a current source search found no imports or calls of `ApiOk`, `ApiError`, `ApiResponse`, `AuthEmployee`, `JwtPayload`, or `isApiError` in the frontend source — these type files are reference-only for editor tooling and are not actively consumed at runtime.
