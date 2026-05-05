# SanoPOS Live Signup Test

Date: 2026-05-06

## Scope

Live signup test on `https://sanopos.com` using the production public signup flow.

## Account

- Signup URL: `https://sanopos.com/signup?plan=free`
- Plan: Free
- Store name: `SanoPOS Live Test 1778021564659`
- Owner name: `Test Owner`
- Email: `sano9942uae@hotmail.com`
- Store code: `sanoposlivetest1778021564659`
- Login password: `TestPass564659!`
- Admin PIN: `1234`

This is a test tenant, so credentials are recorded here for continuity.

## Steps Completed

1. Opened the live signup page in a visible Chrome window.
2. Confirmed the actual production form fields rendered as:
   - Store Name
   - Your Name
   - Email
   - Password
   - Terms of Service / Privacy Policy checkbox
   - Create Store button
3. Filled the signup form with the account details above.
4. Confirmed the `Create Store` button became enabled.
5. Submitted the signup form.
6. Captured the signup API result:
   - Status: `200`
   - Response: `ok: true`
   - `verification_required: true`
   - Message: `Store created. Please check your email to verify your address.`
7. Confirmed the live page showed the email verification screen:
   - `Check your email`
   - Confirmation link sent to `sano9942uae@hotmail.com`
   - Store code shown as `sanoposlivetest1778021564659`
8. User confirmed the verification email was received.
9. Opened the verification link from email.
   - Link token was used live but is intentionally not recorded here.
   - Tenant query value: `sanoposlivetest1778021564659`
10. Verification page showed:
   - `Email verified`
   - `Email verified. Redirecting to setup...`
11. Redirect landed on setup wizard:
   - URL: `/setup?token=[REDACTED]&tenant=sanoposlivetest1778021564659`
   - Step: `Step 1 of 5`
   - Section: `Business Type`
   - Enabled choices observed: `Retail Store`, `Restaurant / Cafe`, `Cafe / Quick Service`
   - Disabled/coming soon choices observed for grocery, wholesale, butcher, sweet shop, textile, services, rentals, hospitality, and clinical presets.
12. Selected business type: `Restaurant / Cafe`.
13. Continued to setup Step 2:
   - Step: `Step 2 of 5`
   - Section: `Store Identity`
   - Store name prefilled: `SanoPOS Live Test 1778021564659`
   - Country default: `Pakistan`
   - Email prefilled: `sano9942uae@hotmail.com`
   - Blank fields observed: `City`, `Phone`
14. Filled Step 2:
   - City: `Lahore`
   - Phone: `+92 300 1234567`
15. Continued to setup Step 3:
   - Step: `Step 3 of 5`
   - Section: `Time & Currency`
   - Timezone default: `Asia/Karachi`
   - Currency symbol default: `Rs`
   - Currency code default: `PKR`
   - Fiscal year start default: `July`
   - Tax registration choices observed: `No, not registered`, `Yes, registered`
16. Selected tax registration status: `No, not registered`.
17. Continued to setup Step 4:
   - Step: `Step 4 of 5`
   - Section: `First Outlet`
   - Outlet name default: `Main Store`
   - Address field observed blank with placeholder `123 Main Street, City`
18. Filled Step 4:
   - Outlet name: `Main Store`
   - Address: `123 Test Food Street, Lahore`
19. Continued to setup Step 5:
   - Step: `Step 5 of 5`
   - Section: `Admin Account`
   - Full name prefilled: `Test Owner`
   - Required blank fields: `PIN (4-6 digits)`, `Confirm PIN`
20. Filled Step 5:
   - Full name: `Test Owner`
   - PIN: entered for the live test; not recorded in this document.
21. Submitted `Complete Setup`.
22. Captured setup API result:
   - Endpoint: `https://api.sanopos.com/api/setup/complete?tenant=sanoposlivetest1778021564659`
   - Status: `200`
   - Response: `success: true`
   - Employee: `Test Owner`
   - Permissions: `all_access`
   - Tenant slug: `sanoposlivetest1778021564659`
   - JWT/token returned by API; token value intentionally not recorded.
23. Browser redirected to `/dashboard`.
24. Immediate post-redirect page state showed `Loading session...`.
25. After waiting briefly, dashboard loaded successfully.
26. Auth/session state observed:
   - `authSession` present in local storage.
   - `currentEmployee` present in local storage.
   - Logged-in employee: `Test Owner`
27. Dashboard state observed:
   - Sidebar visible.
   - Header/user role showed `Administrator`.
   - Restaurant-specific navigation visible:
     - `Floor Plan`
     - `Checks`
     - `86'd Items`
     - `Modifiers`
     - `Menu Schedules`
     - `Reservations`
     - `Waitlist`
     - `Online Inbox`
     - `Void/Comp Reasons`
     - `KDS`
     - `Tip Pools`
     - `Order Kiosks`
   - Dashboard onboarding showed `Get started with SanoPOS`, `2 of 5 steps complete`.
   - Dashboard warned `Approaching plan limit` for `1 of 1 outlets`.
   - Shift warning visible: checkout blocked until a shift is opened.

## Next Step

Continue dashboard/onboarding validation from the authenticated tenant dashboard.
