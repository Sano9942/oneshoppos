# Pre-Launch Walkthrough Plan — 2026-04-27

A live, end-to-end verification pass against production (`https://sanopos.com`) with Playwright + manual checks. Goal: catch what tests don't — UX breaks, layout issues, hidden gaps, "button does nothing" failures, real-world integration issues.

This is **not** an automated test suite. It's a guided walkthrough where the script drives the obvious clicks, pauses for CAPTCHA / email verification, and the operator (you) watches for anomalies. Findings get logged inline.

## Why This Exists

Code tests verify correctness. Click-throughs verify experience. Specifically catches:

- Screen-size / layout breakage (sidebar collapses on mobile? modal too wide on iPad?)
- "Button does nothing" — click fires, no error, no success
- Loading states that never resolve
- Empty-state pages that look broken instead of inviting
- Missing CTAs (primary action hidden somewhere)
- Onboarding gotchas (where do I configure tax? Why is my first sale failing?)
- Cross-feature flow breaks (sale completes but doesn't show in reports)
- Hidden/broken integrations (clicking "Connect Daraz" → blank modal)

## Prerequisites

Source-of-truth references this plan was derived from:
- [docs/sanopos-retail-master-reference.md](sanopos-retail-master-reference.md)
- [docs/new-tenant-sidebar-reference.md](new-tenant-sidebar-reference.md)
- [docs/retail-targeted-code-audit-2026-04-27.md](retail-targeted-code-audit-2026-04-27.md)

Operator decisions before starting:
- [ ] Test email inbox chosen (recommend real Gmail you can read)
- [ ] Test tenant slug chosen (recommend `livetest1` so it's obvious in `/admin`)
- [ ] Turnstile strategy: (a) Cloudflare always-pass test keys via env swap, or (b) manual solve each run. Recommend **(b)** for first run.
- [ ] Browser mode: headed (recommended for first run) vs headless
- [ ] Time budget: ~3-4 hours total, split across multiple sittings

## Known Blockers and Their Workarounds

| Blocker | Workaround |
|---|---|
| Turnstile CAPTCHA on signup (PR 9) | Pause script, solve manually, resume. Or temporarily set Cloudflare always-pass test keys (`1x00000000000000000000AA` site / `1x0000000000000000000000000000000AA` secret) on Railway. |
| Email verification (PR 8) | Pause script, check inbox, paste verification token. |
| Sandbox payment gateway | `PAYMENT_GATEWAY=sandbox` is the current Railway setting. Free→Pro upgrade card will route to sandbox, not real charges. Acceptable for walkthrough. |
| Real production data | Test tenant writes to real Supabase, sends real Resend emails, uses real R2 bucket. Cleanup step (Phase 8) is critical. |

## Phase Plan

| Phase | Time | Outcome |
|---|---|---|
| 1. Signup + setup | ~5 min | Real tenant exists, dashboard reached |
| 2. Sidebar walkthrough | ~30-45 min | All ~60 nav items clicked, screenshots captured |
| 3. End-to-end flows | ~45-60 min | Cross-feature workflows verified |
| 4. Public surfaces | ~15-20 min | 6 customer-facing surfaces verified |
| 5. Worker-driven flows | ~20-30 min | Background behaviors confirmed |
| 6. Edge cases | ~30-45 min | Real-world conditions stress-tested |
| 7. Pre-launch decisions | varies | Operational readiness questions answered |
| 8. Cleanup | ~5 min | Test tenant deleted, schema cleaned |

---

## Phase 1 — Signup and Setup

Acceptance: a real tenant exists in production, you're logged in as admin, on the dashboard.

- [ ] Navigate to `https://sanopos.com`
- [ ] Verify landing page renders correctly (hero, features, pricing, login)
- [ ] Click "Sign up"
- [ ] Fill signup form: email, password, tenant slug, business name
- [ ] **Manual step**: solve Turnstile CAPTCHA
- [ ] Verify TOS checkbox blocks submit until checked
- [ ] Submit → "Check your email" screen renders (PR 8)
- [ ] **Manual step**: open email inbox, click verification link (or paste token)
- [ ] Land on Setup Wizard
- [ ] Verify only `general_retail` tile is clickable; other 21 tiles show "Coming soon"
- [ ] Pick `general_retail`
- [ ] Fill: outlet name, currency, country (PK), timezone, admin PIN
- [ ] Complete wizard → auto-login fires (PR 6)
- [ ] Land on dashboard

Findings to log:
- Email arrival latency (how many seconds until verification email arrives?)
- TOS checkbox UX — does it block submit gracefully?
- Wizard step transitions — any forms losing data on back/forward?
- Auto-login transition — does it feel instant or laggy?

---

## Phase 2 — Sidebar Walkthrough

Acceptance: all ~60 nav items have been clicked, page loads verified, primary CTAs tested, screenshots captured at 3 viewports.

For each item below: click → verify URL changes → wait for load → take desktop+tablet+mobile screenshots → try primary CTA (open form/modal) → close → log finding.

### Overview
- [ ] Dashboard — KPIs render, attention queue populates, onboarding checklist visible (7 steps), FBR prompt banner visible (PK)

### Commerce (14 items)
- [ ] POS (new tab) — full register UI loads, search works, F1 help opens
- [ ] Orders — empty state shows, "+" or filter works
- [ ] Fulfillment — empty state, no errors
- [ ] COD Settlements — empty state
- [ ] Parked Sales — empty state
- [ ] Holds & Layaway — empty state, "+ Hold" CTA opens form
- [ ] Customers — empty state, "+ Customer" opens form (3 tabs visible)
- [ ] Customer Groups — "+ Group" opens form
- [ ] Loyalty Tiers — pre-seeded tiers visible (Bronze/Silver/Gold), edit opens form
- [ ] Gift Cards — "+ Issue gift card" opens form
- [ ] Returns — search bar visible, look-up flow works
- [ ] Return Policies — "+ Policy" opens form
- [ ] Sales History — empty state, date filter works
- [ ] Cash Management — open shift CTA visible

### Inventory (10 items)
- [ ] Products — "+ Product" opens form (variants, attributes, images, taxes)
- [ ] Categories — tree view, drag-drop works
- [ ] Brands — "+ Brand" works
- [ ] Taxes — pre-seeded tax rates visible, "+ Rate" works
- [ ] Attribute Sets — "+ Set" works
- [ ] Promotions — "+ Promotion" form
- [ ] Price Lists — "+ List" form
- [ ] Review Moderation — empty state
- [ ] Smart Collections — "+ Collection" form
- [ ] Scheduled Changes — "+ Schedule" form

### Stock Control (8 items)
- [ ] Purchase Orders — "+ PO" opens form
- [ ] Inventory Audit — "+ Count" opens
- [ ] Stock Adjustments — "+ Adjustment" opens (reason codes required)
- [ ] Transfers — "+ Transfer" form
- [ ] Returned Stock — empty state
- [ ] Supplier Payables — empty state
- [ ] Reorder Alerts — empty state
- [ ] Intelligence — 4 sub-tabs (ABC, aging, cycle counts, reorder), all render

### Procurement (3 items)
- [ ] Suppliers — "+ Supplier" form
- [ ] Expenses — "+ Expense" form
- [ ] Approvals — empty state

### Insights (7 items)
- [ ] Reports — orchestrator with ~20 sub-tabs, each clickable
- [ ] Report Builder — drag-drop UI loads
- [ ] Accounting — P&L / Balance Sheet / Cash Flow tabs
- [ ] Chart of Accounts — pre-seeded COA tree visible
- [ ] Journal Entries — "+ Entry" form (multi-line, balanced check)
- [ ] Credit/Debit Notes — "+ Note" form
- [ ] Post-Dated Cheques — "+ Cheque" form

### Operations (7 items)
- [ ] Kiosk (new tab) — PIN entry UI, no auth required, outlet inferred from URL
- [ ] CRM — empty state
- [ ] Quotations — "+ Quotation" form
- [ ] Attendance — empty state, clock-in log empty
- [ ] HR — empty state
- [ ] Scheduling — calendar renders
- [ ] Notifications — inbox renders, unread count

### Setup (13 items)
- [ ] Employees — "+ Employee" form (role, PIN, password)
- [ ] Outlets — pre-seeded outlet from wizard visible, "+ Outlet" blocked on Free
- [ ] Company Profile — wizard data populated, edit works
- [ ] Integrations — 12 providers visible, marketplace tab shows Daraz/FB/WA/GM with new "Manual sync only" disclaimer
- [ ] Courier Settings — 13 pre-seeded couriers visible
- [ ] Barcode Templates — "+ Template" form
- [ ] Receipt Templates — "+ Template" form, v2 designer renders
- [ ] Printer Settings — "+ Printer" form, test print button
- [ ] Import Data — 5 tabs (products/customers/suppliers/expenses/payments), file picker works
- [ ] Import from Shopify/Square — landing page with OAuth buttons
- [ ] Backup & Restore — "Trigger backup" CTA, history list
- [ ] Outlet Tax Profiles — "+ Profile" form
- [ ] POS Layouts — "+ Layout" designer

### Marketing & Billing (3 items)
- [ ] Campaigns — "+ Campaign" form (audience filters)
- [ ] Inbox — empty state, thread list
- [ ] Customer Invoices — "+ Invoice" form

### Online Store (1 item)
- [ ] View Storefront (new tab) — public catalog renders

### Compliance (2 items at first)
- [ ] FBR Settings — form (NTN, STRN, token, province, environment)
- [ ] Tax Lookup — search bar, province filter

(After Phase 3.4 fills FBR Settings, "FBR Invoices" appears — verify it does)

### Admin (5 items)
- [ ] Administrator — admin shortcuts page
- [ ] Action History — empty state, date filter
- [ ] Retail Risk — empty state
- [ ] Billing — Free plan card visible, no trial countdown (PR 1), upgrade card shows monthly/annual toggle
- [ ] My Tickets — empty state

Findings to log per item:
- ✅ works as expected
- ⚠️ minor (cosmetic, missing label, awkward UX, but functional)
- 🔴 broken (white screen, 500 error, click does nothing, modal won't close)
- Screenshot path
- Notes

---

## Phase 3 — End-to-End Flows

These are cross-feature flows that exercise multiple subsystems. Bugs here are usually integration bugs, not UI bugs.

### 3.1 Sale-to-Report flow
- [ ] Inventory → create product "Test Coffee", price 100, stock 10
- [ ] POS → open shift if needed → scan/search "Test Coffee" → add 2 to cart
- [ ] Complete sale (cash payment) → receipt prints/displays
- [ ] Verify: Sales History shows the sale
- [ ] Verify: Reports → Sales Summary shows revenue 200
- [ ] Verify: Inventory → "Test Coffee" stock now 8
- [ ] Verify: Customer (if attached) → Order History shows the sale

### 3.2 Return-to-Restock flow
- [ ] Returns → look up the sale from 3.1 → return 1 unit → cash refund
- [ ] Verify: Sales History shows return-linked
- [ ] Verify: Inventory → "Test Coffee" stock back to 9
- [ ] Verify: Returned Stock page shows the unit
- [ ] Verify: Reports show negative revenue line

### 3.3 FBR enable + invoice queue
- [ ] FBR Settings → fill NTN, STRN, sandbox token, province, default HS code → save
- [ ] Verify: success message
- [ ] Verify: Compliance → "FBR Invoices" nav entry now appears
- [ ] Make another POS sale
- [ ] FBR Invoices → verify the new sale appears as `pending` then `posted`
- [ ] Click the posted invoice → IRN + QR code visible
- [ ] Re-print receipt → QR code rendered

### 3.4 Cap-hit flow (Free plan)
- [ ] Employees → add employees until 3 exist
- [ ] Try to add 4th → cap modal appears with "Upgrade to Pro" CTA
- [ ] Click upgrade CTA → routes to /billing
- [ ] Verify: PlanUsageBanner appears at 80% threshold
- [ ] (Skip actual checkout since PAYMENT_GATEWAY=sandbox)

### 3.5 Marketplace stub disclaimer
- [ ] Integrations → click Daraz → fill fake App Key/Secret/Token → save
- [ ] Verify: card now shows "Connected" badge + the new "Manual sync only — click Pull Orders to fetch new orders. Automatic background sync coming soon." caption
- [ ] Click "Pull Orders" → toast shows result (probably 0 synced since fake creds)
- [ ] Verify same for Facebook Shop, WhatsApp, Google Merchant

### 3.6 Onboarding checklist (PR 7)
- [ ] Dashboard → 7-step checklist visible
- [ ] Steps so far should be: outlet ✅, employee ✅, product ✅ (from 3.1), sale ✅ (from 3.1), customer (if attached), receipt print, FBR config ✅ (from 3.3)
- [ ] Verify each completed step shows checkmark; incomplete steps show CTA

### 3.7 Public receipt share
- [ ] Sales History → click any sale → "Share receipt" → copy URL
- [ ] Open URL in incognito window → public receipt renders without auth

### 3.8 Gift card public balance lookup
- [ ] Gift Cards → issue card "GC-001" with 500 balance
- [ ] Open `/gift-card/GC-001` in incognito → balance 500 visible

---

## Phase 4 — Public Surfaces

The 6 customer-facing surfaces. Should work without merchant auth.

- [ ] `/store/{slug}` — storefront. Browse → add to cart → checkout (anonymous)
- [ ] `/store/{slug}` — sign up as a customer → log in → portal
- [ ] `/portal/{slug}` — customer portal. 4 tabs: invoices, orders, loyalty, profile. All render.
- [ ] `/receipt/:invoiceNumber` — public receipt. Shareable. From Phase 3.7.
- [ ] `/gift-card/:code` — public gift card balance. From Phase 3.8.
- [ ] `/kiosk?tenant={slug}&outlet={id}` — employee clock-in. PIN flow works.
- [ ] `/customer-display` — POS-side customer-facing display. Open in second window, ring up sale, verify display updates.

Findings to log:
- Slow loads on public pages (no auth = should be fast)
- SEO meta tags / OG tags rendered correctly?
- Mobile rendering of storefront (most customers will be mobile)

---

## Phase 5 — Worker-Driven Flows

Background workers don't surface naturally in click-throughs. These need explicit triggers + waits.

- [ ] **Reservation expiry**: Holds & Layaway → create hold with 5-min expiry → wait → verify stock freed
- [ ] **Hold expiry**: same as above for `phase2g_holds`
- [ ] **Catalog scheduler**: Scheduled Changes → schedule a price flip 2 min from now → verify fired
- [ ] **FBR worker**: from Phase 3.3 — invoice transitions pending → posted within ~60s
- [ ] **Email worker**: trigger any email-emitting event (welcome, receipt, password reset) → check inbox
- [ ] **Marketplace sync worker**: it's a stub, but verify cron fires by checking `/api/admin/worker-status` → marketplace-sync `lastPollAt` updates every 10 min
- [ ] **Cleanup worker**: don't wait 24h, just verify `/api/admin/worker-status` shows it registered

Findings to log:
- Worker latency (how long until job runs?)
- Worker status endpoint accuracy

---

## Phase 6 — Edge Cases

Real-world conditions that catch unique bugs.

### 6.1 Mobile Safari pass
- [ ] Open `https://sanopos.com` on iPhone Safari (or Chrome DevTools iOS emulation)
- [ ] Login → verify cookies/localStorage work
- [ ] Sidebar navigation → verify mobile drawer opens
- [ ] POS → mobile tab-driven layout (Cart/Search/Pay) renders correctly
- [ ] PWA install prompt fires (or doesn't on iOS — by design)

### 6.2 Dark mode
- [ ] Profile dropdown → toggle dark mode
- [ ] Walk through 5 random pages → verify all respect theme
- [ ] POS specifically — uses hardcoded colors per CLAUDE.md, may not switch
- [ ] Public pages (storefront, receipt, kiosk) — what happens?

### 6.3 Offline POS
- [ ] POS open → DevTools → Offline mode
- [ ] Complete a sale offline → "queued" indicator should appear
- [ ] Reconnect → verify sale syncs

### 6.4 Session expired
- [ ] POS open → keep idle for >24h (or manually expire JWT in DevTools)
- [ ] Click checkout → POSSessionExpiredModal should appear
- [ ] PIN re-auth → pending sale auto-retries

### 6.5 Permission roles
- [ ] Create Cashier-role employee
- [ ] Log out → log in as Cashier
- [ ] Verify sidebar limited to: POS + Customers + Returns + Sales History + Cash Management (essentially)
- [ ] Try to access /reports directly → AccessDenied

### 6.6 Cross-tenant isolation
- [ ] Create `livetest2` tenant separately
- [ ] Verify `livetest1` data is NOT visible from `livetest2` admin (and vice versa)
- [ ] Try direct URL manipulation — does it leak?

### 6.7 Multi-outlet (Pro only — skip if testing on Free)
- [ ] Upgrade to Pro
- [ ] Outlets → "+ Outlet" → buy 2nd outlet via /billing/add-outlet
- [ ] Verify: 5 multi-outlet flags auto-flip ON in admin UI
- [ ] Verify: Customer Groups now has Price Book sub-page
- [ ] Verify: Products gain outlet visibility toggle
- [ ] Verify: `multi_outlet_flags_seeded` column flips true (check admin)

### 6.8 Audit-flagged inconsistencies
Test the 4 known gating leaks from `retail-targeted-code-audit-2026-04-27.md`:

- [ ] **Loyalty tiers ungated**: Disable `phase2g_loyalty` via admin → verify Loyalty Tiers nav still visible (audit said yes) → make sale → verify points NOT earned (loyalty ledger gated correctly)
- [ ] **phase2g_label_designer ghost flag**: Disable flag → verify Barcode Templates page still works (audit said no runtime gate)
- [ ] **phase2g_receipt_barcode_lookup ghost flag**: Disable flag → POS return-by-barcode lookup still works
- [ ] **phase5_payment_gateways ghost flag**: Disable flag → /billing upgrade card still functional (sandbox flow works regardless)

These should match the audit findings — if any behaves differently, that's a NEW finding.

---

## Phase 7 — Pre-Launch Operational Decisions

Not click-throughs — operational questions to answer before launch.

### 7.1 Browser compatibility
- [ ] Chrome desktop ✅ (assumed tested)
- [ ] Mobile Safari (iOS) — done in 6.1
- [ ] Android Chrome
- [ ] Edge desktop
- [ ] Firefox (low priority unless customer base demands)

### 7.2 Sentry hookup verification
- [ ] Trigger intentional error (e.g. malformed API call)
- [ ] Verify error appears in Sentry within ~30s
- [ ] Verify tenant slug + employee context tagged on the issue

### 7.3 R2 image upload + display
- [ ] Upload product image during 3.1
- [ ] Verify renders on: product list, product detail, POS, storefront, public receipt
- [ ] If `R2_PUBLIC_URL` unset, image proxies through Railway — confirm acceptable load time

### 7.4 Email deliverability
For each email type, check INBOX (not spam):
- [ ] Welcome email
- [ ] Email verification (PR 8)
- [ ] Receipt email
- [ ] Password reset
- [ ] Trial warning (Pro only — skip if testing Free)
- [ ] Support ticket reply notification

If any land in spam, DNS/SPF/DKIM/DMARC needs review before launch.

### 7.5 Payment gateway decision
Currently `PAYMENT_GATEWAY=sandbox`. Pick one:
- [ ] Decision A: launch with manual upgrades only — set `PAYMENT_GATEWAY=manual`
- [ ] Decision B: get xPay live merchant account — set `PAYMENT_GATEWAY=xpay` + `XPAY_API_KEY` + `XPAY_WEBHOOK_SECRET`
- [ ] Decision C: stay sandbox for soft launch (5-10 friendly testers, no real money)

### 7.6 Backup/restore actually works
- [ ] Trigger backup from 3.x → verify R2 file exists (`backups/tenant_{slug}/...sql.gz`)
- [ ] Restore to a different test tenant slug → verify data integrity

### 7.7 Terms / Privacy content review (PR 9)
- [ ] `/terms` content reviewed
- [ ] `/privacy` content reviewed
- [ ] Pakistan-relevant clauses (PECA, FBR retention)

### 7.8 Support widget verification
- [ ] Floating ? icon visible on authenticated pages
- [ ] Submit ticket with screenshot upload
- [ ] Verify R2 upload of screenshot works
- [ ] Admin replies to ticket → tenant sees in /my-tickets with notification

### 7.9 Worker monitoring sanity
- [ ] `/api/admin/worker-status` reachable (super-admin)
- [ ] All retail-relevant workers show `lastPollAt` updating
- [ ] No stuck queue depths

---

## Phase 8 — Cleanup

- [ ] Note all findings logged
- [ ] Super-admin → /admin/tenants → find `livetest1` (and `livetest2` if created) → Delete
- [ ] Verify orphan-schema-scan-worker cleans up the schema (or run manual `/api/admin/orphaned-schemas/cleanup`)
- [ ] Verify Resend has stopped sending emails to that tenant slug
- [ ] Verify R2 bucket has no leftover files for that tenant (optional, can be later)

---

## Findings Log

Date: 2026-04-27
Tenant slug: ___
Operator: ___

### Critical (🔴) — blocks launch
_None yet_

### Important (⚠️) — should fix before launch
_None yet_

### Cosmetic / minor (✅ with notes) — fix post-launch
_None yet_

### Pre-launch decisions made
- [ ] Payment gateway choice (Phase 7.5):
- [ ] Browser compatibility verdict:
- [ ] T&C content sign-off:

---

## Refresh Triggers

Refresh / re-run this walkthrough when:

- New retail-launch PR ships
- Major nav change in `nav-config.js`
- New mode added that gates a nav group
- Any Phase 7 decision changes (payment gateway swap, browser support pledge, T&C update)
- Quarterly cadence regardless, as a "is anything still wired up?" check
