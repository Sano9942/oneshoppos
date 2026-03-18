# Password Auth + Resend Email + Forgot Password — Design

**Date:** 2026-03-19
**Status:** Approved

---

## Overview

Add password-based login for the web dashboard, replacing PIN login for dashboard users. PIN remains exclusively for kiosk clock-in. Add Resend as the system-level email service for transactional emails (password reset, future onboarding). Existing nodemailer/SMTP stays for tenant-level emails (receipts, digest, CRM).

## Decisions

1. **All employees** can have a password set — not just admins/managers.
2. **Password replaces PIN for dashboard login** — PIN stays for kiosk only.
3. **Graceful fallback** — if no `password_hash` is set, employee can still log in with PIN. Once a password is set, dashboard login requires the password.
4. **Admin triggers reset emails** — admin clicks "Send Password Reset" on Employees page, which sends a Resend email to the employee's email address.
5. **Email column on employees** — nullable, unique. Required for password reset flow.
6. **Email architecture split:**
   - **Resend** = SanoPOS system emails (password reset, future onboarding). Sender: `onboarding@resend.dev` now, swap to `noreply@sanopos.com` when domain is verified.
   - **Nodemailer/SMTP** = tenant store emails (receipts, digest, CRM). Sender: tenant's own SMTP config from `email_config` table.

---

## Database Changes (Migration v3)

```sql
-- Add email + password_hash to employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Password reset tokens (lives in tenant schema, same as employees)
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
```

- `email` — nullable, unique. Admin fills in when creating/editing employee.
- `password_hash` — nullable. When NULL, employee falls back to PIN login on dashboard. When set, only password works for dashboard login.
- `password_reset_tokens` — short-lived tokens (1 hour TTL). Raw token is 32-byte random hex. Only bcrypt hash stored in DB. Token marked `used_at` after consumption.

---

## Backend Changes

### Auth Endpoints (`routes/auth.js`)

**Modified — login verification order:**
- `POST /api/auth/login` (single-tenant) and `POST /api/auth/mt-login` (multi-tenant):
  1. Look up employee by `name`
  2. Request body now accepts `{ username, password, pin, store_code }` — `password` is new, `pin` still accepted
  3. If `password` is provided → verify against `password_hash` via bcrypt
  4. If `pin` is provided (and no `password_hash` exists) → existing PIN verification (fallback)
  5. If `password_hash` is set but caller sends `pin` → reject ("Please use your password to log in")
  6. Kiosk login (`/api/auth/kiosk-login`) — **unchanged**, PIN only

**New endpoints:**
- `POST /api/auth/forgot-password` — public (no auth required)
  - Accepts `{ username, store_code }` (store_code only in MT mode)
  - Looks up employee by name, checks `email` is set
  - Generates 32-byte random hex token, stores bcrypt hash in `password_reset_tokens` with 1-hour expiry
  - Sends password reset email via Resend with link: `{FRONTEND_URL}/reset-password?token={rawToken}&tenant={slug}`
  - Always returns 200 with generic message ("If an account exists, a reset link was sent") — no information leakage
  - Rate limited: reuse existing rate limiter, tighter limit on this endpoint (5 requests/15 min per IP)

- `POST /api/auth/reset-password` — public (no auth required)
  - Accepts `{ token, new_password, store_code }`
  - Finds matching token in `password_reset_tokens` where `used_at IS NULL` and `expires_at > NOW()`
  - Verifies token against stored `token_hash` via bcrypt
  - Sets `password_hash` on the employee, marks token `used_at = NOW()`
  - Returns success message

### Employee Endpoints (`routes/employees.js`)

**Modified:**
- `POST /api/employees` — accepts optional `email` and `password` fields. If `password` provided, bcrypt-hashes and stores as `password_hash`.
- `PUT /api/employees/:id` — accepts optional `email` field for updates.
- `GET /api/employees` — includes `email` in response (already returns employee list).

**New endpoints:**
- `PUT /api/employees/:id/set-password` — admin/manager sets password for any employee
  - Requires role_id 1 (admin) or 2 (manager)
  - Accepts `{ password }`, bcrypt-hashes, stores as `password_hash`
  - Logs to action_history

- `PUT /api/employees/:id/change-password` — employee changes their own password
  - Requires `x-employee-id` header matching `:id`
  - Accepts `{ current_password, new_password }` or `{ pin, new_password }` (for first-time setup from PIN)
  - Verifies current credential before allowing change

- `POST /api/employees/:id/send-reset` — admin triggers password reset email
  - Requires admin/manager role
  - Checks employee has `email` set
  - Generates token, sends Resend email (same logic as forgot-password)
  - Logs to action_history

### Resend Email Utility

**New file: `backend/utils/resendEmail.js`**

```js
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'SanoPOS <onboarding@resend.dev>';

async function sendPasswordResetEmail({ toEmail, employeeName, resetLink, storeName }) {
  // Sends branded HTML email with reset link button
  // Link expires in 1 hour (stated in email body)
}

module.exports = { sendPasswordResetEmail };
```

**Environment variables (Railway):**
- `RESEND_API_KEY` — from Resend dashboard
- `RESEND_FROM_EMAIL` — optional override, defaults to `SanoPOS <onboarding@resend.dev>`

---

## Frontend Changes

### LandingPage.jsx — Login Form

- Replace PIN field with Password field (`type="password"`)
- Password field placeholder: "Enter your password"
- Add "Forgot password?" link below password field → navigates to forgot-password modal/page
- Login submit sends `{ username, password, store_code }` instead of `{ username, pin, store_code }`
- AuthProvider's `login()` function updated to send `password` instead of `pin`

### New Page: ResetPassword.jsx (`/reset-password`)

- Public page (no auth), route added to App.jsx
- Reads `token` and `tenant` from URL query params
- Shows: new password field + confirm password field + submit button
- Validates: min 8 chars, passwords match
- On submit → `POST /api/auth/reset-password` with `{ token, new_password, store_code }`
- Success → redirect to login page with success message

### New Component: ForgotPasswordModal

- Simple modal triggered from "Forgot password?" link on login form
- Shows username field (+ store code in MT mode)
- On submit → `POST /api/auth/forgot-password`
- Shows generic success message regardless of result

### EmployeesRedesign.jsx

- Add `email` field to employee create/edit form (optional, validated format)
- Add "Set Password" action button per employee → opens modal with password + confirm fields
- Add "Send Password Reset" action button per employee → calls `POST /api/employees/:id/send-reset`
  - Disabled/hidden if employee has no email set (with tooltip explaining why)

---

## Security Considerations

- Reset tokens are 32-byte random hex (256 bits of entropy)
- Only bcrypt hash stored in DB — raw token never persisted
- 1-hour expiry on reset tokens
- Tokens single-use (marked `used_at` on consumption)
- `forgot-password` endpoint rate limited (5 req/15 min per IP)
- Generic response on forgot-password (no user enumeration)
- Password minimum: 8 characters
- `password_hash` uses bcrypt with salt rounds = 10 (same as existing `pin_hash`)

---

## Migration Path

1. Deploy migration v3 (adds columns + table) — zero downtime, all columns nullable
2. Deploy backend changes — login now accepts password, falls back to PIN
3. Deploy frontend changes — login form shows password field
4. Existing employees log in with PIN until admin sets their password
5. Admin sets passwords progressively via Employees page
6. Once all employees have passwords, PIN login stops working on dashboard automatically

---

## Out of Scope

- Self-service signup (requires email verification flow)
- Onboarding email after tenant provisioning (future Resend use)
- Password complexity rules beyond minimum length (can add later)
- 2FA / MFA (future enhancement)
