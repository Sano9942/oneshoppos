# Customer Portal Discovery — Design Doc

**Date:** 2026-05-02  
**Status:** Approved

---

## Problem

The customer portal (`/portal/:slug`) is fully built but completely invisible. Tenants have no way to find or share it, and customers have no way to discover it unless a tenant manually tells them the URL. Zero surface area = zero adoption.

---

## Goals

1. Tenants can find and copy their portal URL from within the app
2. Customers who shop on the storefront can see and access the portal
3. Customers who receive a receipt email see a link to their portal account
4. Tenant staff can see portal status per customer and copy an invite link

---

## Out of Scope

- "Send invite" email from the customer list (no endpoint yet — future work)
- Gating storefront portal link on a tenant config flag
- Portal enable/disable toggle in settings

---

## Changes

### 1. Settings page — Customer Portal card
**File:** `frontend/src/pages/redesign/CompanySettingsRedesign.jsx`

Add a new `SectionCard` inside the existing settings page. Content:
- Heading: "Customer Portal"
- Body text: "Share this link with your customers so they can view invoices, track orders, manage their loyalty points, and more."
- Read-only input showing `https://sanopos.com/portal/<slug>`
- Copy button (uses `navigator.clipboard.writeText`, shows a "Copied!" toast on success)
- The slug comes from `useAuth()` → `employee.tenant_slug` (already available in the auth context)

No new route, no new API call.

---

### 2. Storefront header — "My Account" icon
**File:** `frontend/src/pages/storefront/StorefrontLayout.jsx`

Add a user/person icon button to the right side of the storefront header, between the category nav and the cart icon. On mobile it sits inside the icon group alongside the cart.

- Links to `/portal/${tenantSlug}/login`
- Same SVG icon style as the existing cart icon (outline, `h-6 w-6`, `strokeWidth={1.5}`)
- `aria-label="My Account"`
- Uses React Router `<Link>` (already imported)

---

### 3. Storefront footer — "My Account" text link
**File:** `frontend/src/pages/storefront/StorefrontLayout.jsx`

Add a "My Account" text link to the existing footer alongside "Powered by SanoPOS".

- Links to `/portal/${tenantSlug}/login`
- Same muted style as the existing footer text (`text-xs text-gray-400 hover:text-gray-600`)

---

### 4. Receipt email — portal CTA
**File:** `backend/utils/receiptEmail.js`  
**Call site:** `backend/routes/email.js`

Add an optional `portalUrl` parameter to `buildReceiptEmailHtml(sale, items, payments, template, currencySymbol, portalUrl)`.

When `portalUrl` is provided, render a CTA block above the footer:

```html
<tr><td style="padding:16px 0;text-align:center;border-top:1px solid #eee;">
  <a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;border-radius:6px;font-size:13px;text-decoration:none;font-weight:600;">
    View your account
  </a>
  <div style="margin-top:6px;font-size:11px;color:#888;">Track orders, view invoices &amp; manage your loyalty points</div>
</td></tr>
```

**Call site changes in `email.js`:**
- The tenant slug is already available via `req.tenantSlug` (set by `resolveTenant`)
- Build `portalUrl` as `` `${FRONTEND_URL}/portal/${req.tenantSlug}` `` and pass to `buildReceiptEmailHtml`
- `FRONTEND_URL` already used elsewhere in the backend as `process.env.FRONTEND_URL || "https://sanopos.com"`

---

### 5. Customers list — portal status + invite link
**File:** `frontend/src/pages/redesign/CustomersRedesign.jsx`

Two additions:

**A. Portal status badge in the customer table**
- Add a "Portal" column to the customer list table
- Show a green "Active" badge if `customer.portal_enabled_at` is set, grey "—" if not
- Requires the existing `GET /api/customers` response to include `portal_enabled_at` — check if it's already returned; if not, add it to the SELECT in `backend/routes/customers.js`

**B. Copy invite link button in the customer detail panel**
- In the customer detail side panel (Profile tab), add a small "Copy portal invite link" button
- On click: copies `https://sanopos.com/portal/<slug>/signup` to clipboard and shows toast "Invite link copied!"
- The slug comes from `useAuth()` → `employee.tenant_slug`
- No API call needed — pure frontend clipboard action

---

## Data Flow

```
Tenant opens Settings → sees portal URL → copies and shares with customers
                                                        ↓
Customer opens storefront → sees "My Account" in header/footer → clicks → portal login/signup
                                                        ↓
Customer completes purchase → receives receipt email → sees "View your account" CTA → portal
                                                        ↓
Tenant views Customers list → sees portal status column → copies invite link for offline customers
```

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/pages/redesign/CompanySettingsRedesign.jsx` | Add Customer Portal card with URL + copy button |
| `frontend/src/pages/storefront/StorefrontLayout.jsx` | Add "My Account" icon in header + link in footer |
| `backend/utils/receiptEmail.js` | Add optional `portalUrl` param → renders CTA block |
| `backend/routes/email.js` | Pass `portalUrl` to both `buildReceiptEmailHtml` call sites |
| `backend/routes/customers.js` | Add `portal_enabled_at` to SELECT if not already present |
| `frontend/src/pages/redesign/CustomersRedesign.jsx` | Add portal badge column + copy invite link button |

---

## No Migration Required

All data (`portal_enabled_at`) already exists on the `customers` table (added in migration v31/M8). No schema changes needed.
