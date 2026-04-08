# Onboarding Polish — Design

**Date:** 2026-03-27
**Goal:** Enable self-service signup in production and polish the new tenant journey from discovery to first sale.

---

## Decisions

| Decision | Choice |
|---|---|
| Self-service signup | Enabling in production (`SELF_SERVICE_SIGNUP=1`) |
| Post-signup flow | Immediate redirect to setup wizard (no email verification) |
| Welcome email | Branded template matching password reset email style |
| Landing page | "Sign Up Free" in hero + "Get Started" on pricing cards |
| Security | 48h setup token expiry + 5/IP/hour signup rate limit |
| Dead tenant cleanup | Automated daily job for incomplete tenants after 7 days |

---

## Section 1: Landing Page Changes

**File:** `LandingPage.jsx`

- Hero section: Add "Create Free Account" button/link below or beside the login card, linking to `/signup`.
- Pricing cards: Each plan card gets a "Get Started" button linking to `/signup?plan=free|starter|pro`.
- SignupPage reads `?plan=` query param and pre-selects the plan in the dropdown.

No new pages or routes — just links to the existing `/signup`.

---

## Section 2: Signup Flow Change

**Files:** `SignupPage.jsx`, `backend/routes/auth.js`

**Current:** Submit → success screen → "Check your email" → dead end.
**New:** Submit → backend returns `{ ok, slug, setupToken }` → frontend redirects to `/setup?token=xxx&tenant=slug`.

Backend: `POST /api/auth/signup` returns `setupToken` in the response (currently only sent via email). The email still sends as a backup/reference.

Frontend: On success, `window.location.href = /setup?token=${token}&tenant=${slug}` instead of showing the success card.

---

## Section 3: Branded Welcome Email

**File:** New `buildWelcomeEmailHtml()` in `backend/utils/resendEmail.js`

Template structure (matching password reset email style):

- SanoPOS colored header bar
- "Welcome to SanoPOS, {owner_name}!"
- Store code displayed prominently: "Your store code: {slug}"
- Styled "Complete Setup" button (links to setup wizard with token)
- "What's next" section: 3 bullets (configure store → add products → start selling)
- Footer: "Need help?" + link to landing page guides

Replaces the inline HTML currently hardcoded in `auth.js` signup handler.

---

## Section 4: Setup Token Expiry

**Files:** `backend/tenant-provisioner-pg.js`, `backend/routes/setup.js`, migration v6

- Provisioner: Set `setup_token_expires_at = NOW() + INTERVAL '48 hours'` when creating tenant.
- Schema: Add `setup_token_expires_at TIMESTAMPTZ` column to `company_profile` (migration v6).
- `POST /api/setup/complete`: Check `setup_token_expires_at >= NOW()`. If expired → 403 "Setup link has expired. Contact support."
- Admin panel: "Regenerate Setup Link" button on tenant detail → generates new token + 48h expiry.

---

## Section 5: Signup Rate Limiting

**File:** `backend/routes/auth.js`

Rate limit on `POST /api/auth/signup`: max 5 requests per IP per hour. Use existing rate limiting middleware pattern, keyed by `signup:${ip}`.

---

## Section 6: Dead Tenant Cleanup

**Files:** New `backend/jobs/cleanup-dead-tenants.js`, `backend/routes/admin.js`

**Automatic cleanup:**
- Scheduled job runs daily (triggered via cron or admin endpoint).
- Finds tenants where `setup_complete = false` AND `created_at < NOW() - INTERVAL '7 days'`.
- For each: drops `tenant_{slug}` schema, deletes row from `public.tenants`.
- Logs each cleanup to `tenant_audit_log` with reason `auto_cleanup_incomplete_setup`.

**Admin visibility:**
- `GET /api/admin/tenants` already shows `setup_complete` status.
- Add "Dead Tenants" count to admin dashboard "Needs Attention" card.
- Add manual "Delete Tenant" button on tenant detail page for super-admin.

**Safety:**
- Only deletes tenants with `setup_complete = false` — never touches active tenants.
- If a tenant has ANY sales data, skip it regardless of `setup_complete` flag.
- Dry-run mode: `GET /api/admin/cleanup-preview` returns list that would be deleted, without deleting.

---

## What Does NOT Change

- Setup wizard steps (4 steps, same flow)
- Onboarding checklist on dashboard (already works well)
- Login flow (untouched)
- Admin provisioning (still works for manual onboarding)
- POS, reports, everything else
