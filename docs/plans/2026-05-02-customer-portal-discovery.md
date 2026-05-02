# Customer Portal Discovery Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Surface the customer portal URL in 4 places — settings page, storefront header/footer, receipt email, and customer list — so both tenants and customers can discover it.

**Architecture:** Pure frontend + one backend change. The portal already exists at `/portal/:slug`; we're just adding links and a settings card. The only backend change is adding an optional `portalUrl` parameter to `buildReceiptEmailHtml()` and threading it through the two call sites in `email.js`.

**Tech Stack:** React 19 + Tailwind v4 (frontend), Node.js + Express v5 (backend). No new routes, no migrations.

---

## Task 1: Settings page — Customer Portal card

**Files:**
- Modify: `frontend/src/pages/redesign/CompanySettingsRedesign.jsx`

### Context
`CompanySettingsRedesign.jsx` uses `PageShell` + `SectionCard` from `ui/primitives.jsx`. The tenant slug is available via `useAuth()` → `session.tenant_slug` (read from `authStore.readSession()`). `useAuth()` is already imported. The slug is also on `employee.tenant_slug` if exposed — check which field is available at the top of the file before writing code.

### Step 1: Find where to insert the new card
Search for the last `</SectionCard>` or `</div>` closing the last settings section in `CompanySettingsRedesign.jsx`. The new card goes after it, before the closing `</PageShell>` (or equivalent wrapper).

### Step 2: Add the portal URL card

Add this JSX block after the last existing `SectionCard`:

```jsx
{/* Customer Portal */}
<SectionCard>
  <div className="space-y-3">
    <div>
      <h3 className="text-sm font-semibold text-(--ui-text)">Customer Portal</h3>
      <p className="text-xs text-(--ui-text-muted) mt-1">
        Share this link with your customers so they can view invoices, track orders, and manage their loyalty points.
      </p>
    </div>
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={`${window.location.origin}/portal/${session?.tenant_slug || ""}`}
        className="grow text-xs bg-(--ui-bg) border border-(--ui-border) rounded px-3 py-2 text-(--ui-text) font-mono"
      />
      <Button
        tone="default"
        size="sm"
        onClick={() => {
          navigator.clipboard.writeText(`${window.location.origin}/portal/${session?.tenant_slug || ""}`);
          success("Portal link copied!");
        }}
      >
        Copy
      </Button>
    </div>
  </div>
</SectionCard>
```

**Notes:**
- `session` comes from `useAuth()` — check if it's already destructured at the top of the component. If not, add `const { session } = useAuth();`
- `success` is from `useToast()` — check if already destructured. If not, add `const { success } = useToast();`
- `window.location.origin` gives `https://sanopos.com` in production and `http://localhost:5173` in dev — correct for both environments
- `Button` and `SectionCard` are already imported from `ui/primitives.jsx` in this file

### Step 3: Verify visually
Start the frontend dev server (`npm run dev` in `frontend/`). Navigate to `/settings` (or wherever `CompanySettingsRedesign` is mounted — check `appRoutes.jsx` for the path). Confirm the card renders, the URL shows the correct slug, and clicking "Copy" shows the toast.

### Step 4: Commit
```bash
git add frontend/src/pages/redesign/CompanySettingsRedesign.jsx
git commit -m "feat: add customer portal URL card to settings page"
```

---

## Task 2: Storefront header — "My Account" icon button

**Files:**
- Modify: `frontend/src/pages/storefront/StorefrontLayout.jsx`

### Context
The storefront header already has a cart icon button at line ~135. The "My Account" icon goes immediately before it in the same `<div className="flex items-center gap-3">` container. `tenantSlug` is available from `useParams()` (already imported and used). The storefront uses raw `fetch()` and plain Tailwind — no `api.js`, no `ui/primitives`.

### Step 1: Add the user icon button in the desktop/mobile header

In `StorefrontLayout.jsx`, find this block (around line 133):
```jsx
{/* Cart + Mobile menu */}
<div className="flex items-center gap-3">
  {/* Cart icon */}
  <Link
    to={`/store/${tenantSlug}/cart`}
```

Insert the following **before** the cart `<Link>`:

```jsx
{/* My Account */}
<Link
  to={`/portal/${tenantSlug}/login`}
  className="p-2 text-gray-700 hover:text-indigo-600 transition-colors"
  aria-label="My Account"
>
  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
  </svg>
</Link>
```

### Step 2: Add "My Account" to mobile menu

In the mobile menu section (around line 171), find the existing `<Link>` entries inside the mobile dropdown and add this entry **at the bottom** of the list:

```jsx
<Link
  to={`/portal/${tenantSlug}/login`}
  className="block px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
>
  My Account
</Link>
```

### Step 3: Verify visually
Navigate to `/store/<any-slug>` in the browser. Confirm the person icon appears next to the cart in the header. Click it — should navigate to `/portal/<slug>/login`. On mobile width, confirm "My Account" appears in the hamburger menu.

### Step 4: Commit
```bash
git add frontend/src/pages/storefront/StorefrontLayout.jsx
git commit -m "feat: add My Account link to storefront header and mobile menu"
```

---

## Task 3: Storefront footer — portal text link

**Files:**
- Modify: `frontend/src/pages/storefront/StorefrontLayout.jsx`

### Step 1: Update the footer

Find the footer section (around line 200):
```jsx
<footer className="bg-white border-t border-gray-200 mt-auto">
  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
      <p className="text-sm text-gray-500">
        {storeName}
      </p>
      <p className="text-xs text-gray-400">
        Powered by SanoPOS
      </p>
    </div>
  </div>
</footer>
```

Replace the inner `<div>` with:

```jsx
<div className="flex flex-col sm:flex-row items-center justify-between gap-4">
  <p className="text-sm text-gray-500">
    {storeName}
  </p>
  <div className="flex items-center gap-4">
    <Link
      to={`/portal/${tenantSlug}/login`}
      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
    >
      My Account
    </Link>
    <p className="text-xs text-gray-400">
      Powered by SanoPOS
    </p>
  </div>
</div>
```

### Step 2: Verify visually
Scroll to the bottom of the storefront. Confirm "My Account" link appears next to "Powered by SanoPOS". Click it — should navigate to `/portal/<slug>/login`.

### Step 3: Commit
```bash
git add frontend/src/pages/storefront/StorefrontLayout.jsx
git commit -m "feat: add My Account link to storefront footer"
```

---

## Task 4: Receipt email — portal CTA block

**Files:**
- Modify: `backend/utils/receiptEmail.js`
- Modify: `backend/routes/email.js`

### Context
`buildReceiptEmailHtml(sale, items, payments, template, currencySymbol)` is a pure HTML builder in `receiptEmail.js`. It's called in two places in `email.js` (lines ~174 and ~246). The tenant slug is available in `email.js` via `req.tenantSlug` (set by `resolveTenant` middleware). `FRONTEND_URL` is `process.env.FRONTEND_URL || "https://sanopos.com"`.

### Step 1: Add `portalUrl` param to `buildReceiptEmailHtml`

In `receiptEmail.js`, change the function signature at line 33:
```js
// Before:
function buildReceiptEmailHtml(sale, items, payments, template, currencySymbol = "$") {

// After:
function buildReceiptEmailHtml(sale, items, payments, template, currencySymbol = "$", portalUrl = null) {
```

### Step 2: Add the CTA block inside the HTML template

Find the `<!-- Footer -->` comment (around line 159) in `receiptEmail.js`:
```js
        <!-- Footer -->
        <tr><td style="padding-top:16px;border-top:1px solid #eee;text-align:center;font-size:12px;color:#888;">
          ${footerText}
        </td></tr>
```

Insert this block **before** the `<!-- Footer -->` comment:

```js
        <!-- Portal CTA -->
        ${portalUrl ? `
        <tr><td style="padding:16px 0;text-align:center;border-top:1px solid #eee;">
          <a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;border-radius:6px;font-size:13px;text-decoration:none;font-weight:600;">
            View your account
          </a>
          <div style="margin-top:6px;font-size:11px;color:#888;">Track orders, view invoices &amp; manage your loyalty points</div>
        </td></tr>` : ""}
```

### Step 3: Pass `portalUrl` at both call sites in `email.js`

In `email.js`, find both calls to `buildReceiptEmailHtml`. Before each call, build the portal URL:

```js
const portalUrl = req.tenantSlug
  ? `${process.env.FRONTEND_URL || "https://sanopos.com"}/portal/${req.tenantSlug}`
  : null;
```

Then pass it as the 6th argument:
```js
// Before:
const html = buildReceiptEmailHtml(sale, items, payments, template, currencySymbol);

// After:
const html = buildReceiptEmailHtml(sale, items, payments, template, currencySymbol, portalUrl);
```

Do this for **both** call sites (there are two in `email.js` — one for send-receipt-v2 and one for the legacy path).

### Step 4: Test manually
Use the POS to complete a sale with a customer email, then use "Send Receipt" to trigger the email. Check the received email for the "View your account" button. Alternatively, run the existing receipt email unit test:

```bash
cd backend && npx vitest run tests/unit/utils.test.js
```

Confirm all existing tests still pass (the new param is optional with a `null` default).

### Step 5: Commit
```bash
git add backend/utils/receiptEmail.js backend/routes/email.js
git commit -m "feat: add portal CTA to customer receipt emails"
```

---

## Task 5: Customer list — portal status badge

**Files:**
- Modify: `frontend/src/pages/redesign/CustomersRedesign.jsx`

### Context
`GET /api/customers` returns `c.*` which includes `portal_enabled_at` — no backend change needed. The customers page renders a table of customers. Find the table headers and rows — look for a `<th>` / `<td>` pattern or a `map()` over customers. `portal_enabled_at` will be a timestamp string if set, or `null` if not.

### Step 1: Add a "Portal" column header

Find the table header row in `CustomersRedesign.jsx`. Add a `<th>` for the portal column:

```jsx
<th className="px-3 py-2 text-left text-xs font-medium text-(--ui-text-muted) uppercase tracking-wide">
  Portal
</th>
```

Place it after the existing columns (before the Actions column if one exists).

### Step 2: Add the portal status cell in each row

In the `customers.map(...)` table body, add a `<td>` matching the new column:

```jsx
<td className="px-3 py-2 whitespace-nowrap">
  {customer.portal_enabled_at ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
      Active
    </span>
  ) : (
    <span className="text-xs text-(--ui-text-muted)">—</span>
  )}
</td>
```

### Step 3: Verify visually
Navigate to the Customers page. Confirm the "Portal" column appears. Customers who have activated the portal show "Active" badge; others show "—".

### Step 4: Commit
```bash
git add frontend/src/pages/redesign/CustomersRedesign.jsx
git commit -m "feat: add portal status badge to customer list"
```

---

## Task 6: Customer detail — copy invite link button

**Files:**
- Modify: `frontend/src/pages/redesign/CustomersRedesign.jsx`

### Context
The customer detail panel in `CustomersRedesign.jsx` has a Profile tab (and possibly other tabs). Find where name, email, mobile are displayed in the detail panel — the "Copy invite link" button goes at the bottom of the Profile tab content.

The portal signup URL is `${window.location.origin}/portal/${tenantSlug}/signup`. The tenant slug comes from `useAuth()` → `session.tenant_slug`. `useToast()` is needed for the copy toast.

### Step 1: Ensure `session` and `success` are available

At the top of `CustomersRedesign.jsx`, confirm `useAuth` is imported and `session` is destructured. Confirm `useToast` is imported and `success` is destructured. Add if missing:

```js
const { session } = useAuth();
const { success } = useToast();
```

### Step 2: Add the copy invite link button in the customer detail Profile tab

Find the customer detail Profile section. Add this button at the bottom of the profile info:

```jsx
<div className="pt-3 border-t border-(--ui-border)">
  <p className="text-xs text-(--ui-text-muted) mb-2">
    {selectedCustomer.portal_enabled_at
      ? "This customer has activated their portal account."
      : "This customer hasn't set up a portal account yet."}
  </p>
  <button
    type="button"
    onClick={() => {
      navigator.clipboard.writeText(
        `${window.location.origin}/portal/${session?.tenant_slug || ""}/signup`
      );
      success("Invite link copied!");
    }}
    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
  >
    Copy portal invite link
  </button>
</div>
```

### Step 3: Verify visually
Click on a customer in the list to open the detail panel. Scroll to the Profile tab. Confirm the invite link section appears with the correct message (active vs not activated). Click "Copy portal invite link" — paste it somewhere to verify it's `http://localhost:5173/portal/<slug>/signup` in dev.

### Step 4: Commit
```bash
git add frontend/src/pages/redesign/CustomersRedesign.jsx
git commit -m "feat: add portal invite link copy button to customer detail panel"
```

---

## Final Verification Checklist

- [ ] Settings page shows portal URL with working copy button
- [ ] Storefront header shows person icon that links to portal login
- [ ] Storefront mobile menu has "My Account" link
- [ ] Storefront footer has "My Account" text link
- [ ] Receipt email includes "View your account" button (test by sending a receipt)
- [ ] Customer list has "Portal" column with Active/— status
- [ ] Customer detail profile tab has "Copy portal invite link" button
- [ ] `npx vitest run backend/tests/unit/utils.test.js` passes (receipt email tests)
- [ ] No TypeScript/ESLint errors in modified frontend files
