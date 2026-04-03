// Central API configuration — reads from Vite env var, falls back to localhost for dev
export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Multi-tenant mode flag (controls Store Code field on login, JWT auth flow)
export const IS_MULTI_TENANT = import.meta.env.VITE_MULTI_TENANT === "1";
