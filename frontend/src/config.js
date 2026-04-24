// Central API configuration — reads from Vite env var, falls back to localhost for dev
export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:5000";

// Multi-tenant mode flag (controls Store Code field on login, JWT auth flow)
export const IS_MULTI_TENANT = import.meta.env.VITE_MULTI_TENANT === "1";

// Sentry DSN — empty string means Sentry is disabled
export const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN || "";

// Cloudflare Turnstile site key — empty string means CAPTCHA is disabled.
// When set, SignupPage renders the widget and submission requires a token.
// Backend signup also gates on TURNSTILE_SECRET_KEY being set; the two are
// configured together.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";

// Vite build-time environment flags
export const ENV_MODE = import.meta.env.MODE;
export const IS_PROD = import.meta.env.PROD;
export const IS_DEV = import.meta.env.DEV;
