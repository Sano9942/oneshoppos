# Types — Claude Guide

- **2 TypeScript declaration files** — reference only (tsconfig: `allowJs` + `noEmit`)
- **`api.ts`** — `ApiOk<T>`, `ApiError`, `ApiResponse<T>` union. Type guard: `isApiError(res)`. Backend always returns `{ error: string }` on failure
- **`auth.ts`** — `AuthEmployee` (id, name, username, role_id, outlet_id, permissions, token, refreshToken?). `JwtPayload` (eid, tid, rid, iat, exp). JWT decoding happens server-side only
