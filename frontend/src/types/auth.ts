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
  // 2-G.16: per-employee login landing preference.
  home_page?: "dashboard" | "retail_home" | null;
  // Tier 1.1 wholesale: routes 'field_rep' employees to /field/today on login.
  employee_type?: "in_store" | "field_rep";
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
