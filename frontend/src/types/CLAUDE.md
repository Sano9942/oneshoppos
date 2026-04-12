# Types — Claude Guide

- **2 TypeScript declaration files** — reference only (tsconfig: `allowJs` + `noEmit`, no runtime type checking enforced)

---

## `auth.ts`

### `AuthEmployee`
Shape of the employee object stored in `AuthProvider` after a successful login (derived from `POST /api/auth/login` or `/api/auth/mt-login` response):

| Field | Type | Notes |
|-------|------|-------|
| `id` | `number` | Employee ID |
| `name` | `string` | Display name |
| `username` | `string` | Login username |
| `role_id` | `number` | |
| `outlet_id` | `number \| null` | Null if no outlet assigned |
| `permissions` | `string[]` | Array of permission strings |
| `token` | `string` | JWT access token |
| `refreshToken` | `string?` | Optional — present when refresh tokens are issued |

### `JwtPayload`
Reference shape for the decoded JWT payload (decoding is done **server-side only** — not decoded client-side at runtime):

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
Both fields are optional — some endpoints return a direct object (no `data` wrapper); some return only `message`.

### `ApiError`
```ts
{ error: string; details?: unknown }
```
Backend always returns `{ error: string }` on failure. `details` is optional and present on validation errors.

### `ApiResponse<T>`
```ts
type ApiResponse<T> = ApiOk<T> | ApiError
```

### `isApiError(res)`
**Runtime function** (not just a type) — exported as a callable type guard:
```ts
isApiError(res: ApiResponse): res is ApiError
// Returns true if res.error is a string
```
Import and call directly to narrow an `ApiResponse` to the error case.
