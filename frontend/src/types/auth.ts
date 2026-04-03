/**
 * The employee object stored in AuthProvider after a successful login.
 * Derived from POST /api/auth/login / /api/auth/mt-login response,
 * merged with client-side context (username, outlet_id).
 */
export interface AuthEmployee {
  id: number;
  name: string;
  username: string;
  role_id: number;
  outlet_id: number | null;
  permissions: string[];
  token: string;
  refreshToken?: string;
}

/**
 * Decoded JWT payload shape (for reference — not used at runtime,
 * decoding is done server-side).
 */
export interface JwtPayload {
  eid: number;   // employee id
  tid: number;   // tenant id
  rid: number;   // role id
  iat: number;
  exp: number;
}
