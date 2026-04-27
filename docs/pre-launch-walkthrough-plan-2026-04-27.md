# Pre-Launch Walkthrough Plan — 2026-04-27

A live, end-to-end verification pass against production (`https://sanopos.com`) with Playwright + manual checks. Goal: catch what tests don't — UX breaks, layout issues, hidden gaps, "button does nothing" failures, real-world integration issues.

This is **not** an automated test suite. It's a guided walkthrough where the script drives the obvious clicks, pauses for CAPTCHA / email verification, and the operator (you) watches for anomalies. Findings get logged inline.

## Scope

This walkthrough covers **`general_retail` mode only** — the launch target. Mode-gated features (Restaurant, Appointments, Service Tickets, Projects/Contracts, Rentals, Rooms, Clinical) do not appear in retail tenants' UI and are explicitly **out of scope** (see "Out of Scope" section at the bottom). Super-admin panel walkthrough is also out of scope (internal team, separate auth, not part of merchant launch).

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

### 3.9 Shopify import smoke
- [ ] Setup → Import from Shopify/Square → click Shopify connect
- [ ] OAuth flow redirects to Shopify (or paste sandbox creds)
- [ ] Verify token persisted (encrypted) in tenant config
- [ ] Trigger product sync → verify a product lands in Inventory
- [ ] Trigger order pull (if Shopify orders seeded) → verify order in Orders
- [ ] `GET /api/integrations/shopify/health` returns OK

### 3.10 Courier shipment + tracking
- [ ] Courier Settings → enable one courier (Leopards or generic) with sandbox/test creds
- [ ] Orders → pick a fulfillable sale → Ship → choose courier → submit
- [ ] Verify: tracking number returned, label/AWB printable
- [ ] Refresh tracking → verify status fetched from courier API
- [ ] Verify courier webhook callback updates order status (use sandbox or simulate)

### 3.11 Receipt printer + cash drawer
- [ ] Printer Settings → "+ Printer" → configure network printer (TCP host:port) or USB
- [ ] Test print button → verify physical paper output
- [ ] POS → complete a cash sale → verify receipt prints automatically
- [ ] Verify cash drawer kicks open on cash payment
- [ ] Pull network cable mid-print → verify graceful failure (no crash, retry option)

### 3.12 CSV import preview validation
- [ ] Import Data → Products tab → upload sample CSV with: 1 valid row, 1 missing-required-field row, 1 duplicate-SKU row
- [ ] Verify preview screen flags the bad rows distinctly
- [ ] Fix the issues inline (or re-upload corrected) → import succeeds
- [ ] Verify imported products appear in Inventory with correct prices/taxes
- [ ] Repeat with Customers tab using a 5-row XLSX

### 3.13 Sandbox payment checkout end-to-end
- [ ] From cap-hit modal in 3.4 → click "Upgrade to Pro" → routes to /billing
- [ ] Click monthly Pro plan → "Pay Now" → redirects to SanoPay sandbox
- [ ] Complete sandbox payment with test card
- [ ] Verify webhook fires → tenant auto-upgrades to Pro
- [ ] Verify confirmation email arrives
- [ ] Verify `payment_records` row created with correct amount + status
- [ ] Verify Free-tier caps lifted (try adding 4th employee — succeeds)

### 3.14 Mixed-rate tax sale correctness
- [ ] Inventory → create "Coffee Beans" with 17% GST
- [ ] Inventory → create "Snack Bar" with 5% GST
- [ ] POS → ring up 1× Coffee Beans (100) + 2× Snack Bar (50)
- [ ] Verify receipt shows two tax lines: 17 (17% of 100) + 5 (5% of 100) = 22 total tax
- [ ] Verify report (Sales Summary) shows correct tax breakdown by rate
- [ ] If FBR enabled (after 3.3): verify FBR payload preserves per-line tax rates

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
- [ ] **Shift auto-close worker** (`shift-auto-close-worker-boss.js`): verify registered + heartbeat updating; optionally seed a >36h-old open shift and confirm it closes
- [ ] **Retail digest worker** (`retail-digest-worker-boss.js`): verify registered; trigger manual run if endpoint exists, confirm digest email queued
- [ ] **ABC inventory worker** (`abc-worker-boss.js`): verify registered + heartbeat; verify Intelligence → ABC tab populates after run
- [ ] **Anomaly worker** (`anomaly-worker-boss.js`): verify registered; check Retail Risk page picks up anomalies
- [ ] **Subscription grace worker** (`subscription-grace-worker-boss.js`): verify registered + heartbeat (hourly); manually flip a tenant to grace and confirm transition
- [ ] **Reservation reminder worker** (`reservation-reminder-worker-boss.js`): verify registered; create a near-expiry reservation and confirm reminder fires

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

### 6.9 Dashboard JWT silent refresh
- [ ] Log into dashboard → leave open and idle past JWT expiry (or manually short-expire token in DevTools)
- [ ] Click any nav item that triggers an API call (e.g., Sales History)
- [ ] Verify: `AuthProvider.jsx` refresh interceptor swaps token transparently — no logout, no redirect to login
- [ ] If refresh fails, verify graceful redirect to login (not white screen)

### 6.10 Error boundary recovery UI
- [ ] Open POS → DevTools console → force a render error (e.g., `throw` in a child component, or break a context value temporarily)
- [ ] Verify: `ui/ErrorBoundary.jsx` catches it and renders the recovery card (NOT a white screen)
- [ ] Verify: "Try again" / "Reload" CTA works
- [ ] Verify: error reaches Sentry with tenant + employee context tagged

### 6.11 Timezone correctness on receipts and reports
- [ ] During Phase 1 wizard, set timezone to a non-UTC zone (e.g., `Asia/Karachi` UTC+5)
- [ ] Make a sale at a known wall-clock time
- [ ] Verify receipt timestamp shows local PK time, not UTC
- [ ] Verify Sales History date column shows local date
- [ ] Run Sales Summary report with date filter for "today" — verify date boundary respects PK midnight, not UTC midnight (especially relevant for sales between 19:00–23:59 PK)
- [ ] Spot-check FBR payload (if enabled): `invoice_datetime` should be local + offset, not bare UTC

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

### 7.10 Rate limit smoke
- [ ] Auth: attempt 21 logins with bad credentials in <15 min → verify 429 on the 21st with `Retry-After` header
- [ ] Auth: verify successful login resets the counter
- [ ] Webhook: blast 121 requests/min at `/api/webhooks/xpay` (sandbox) → verify 429 kicks in
- [ ] Global: confirm normal browsing never hits rate limit during full Phase 2 walkthrough

### 7.11 Upload security smoke
- [ ] Product image: rename `payload.exe` to `payload.jpg` and upload → verify reject (MIME sniff vs extension mismatch)
- [ ] Support ticket screenshot: upload an SVG with embedded `<script>` → verify either rejected or rendered safely (no script execution)
- [ ] Upload an oversized file (e.g., 50MB) → verify reject with clear error
- [ ] Upload zero-byte file → verify graceful handling

### 7.12 SEO and OG tag verification
- [ ] Inspect `<head>` of landing page (`/`) — verify title, meta description, OG image, OG title, favicon
- [ ] Inspect login page (`/login`) — at minimum: title, favicon, no-index if intentional
- [ ] Inspect signup page (`/signup`) — title, meta description
- [ ] Inspect public receipt (`/receipt/:invoiceNumber`) — at least title; ideally OG image for share previews
- [ ] Inspect public storefront (`/store/{slug}`) — full SEO set (title, description, OG image, JSON-LD product schema if shipped)
- [ ] Run a Twitter/Facebook share preview check on landing page URL

### 7.13 Backup data integrity
- [ ] Trigger backup from Backup & Restore page → wait for completion
- [ ] Verify R2 file exists (`backups/tenant_{slug}/backup_YYYYMMDD.sql.gz`)
- [ ] Note row counts for: products, customers, sales, sale_items, orders, inventory, employees on the source tenant
- [ ] Provision a fresh test tenant `livetest1-restore` → trigger restore from the backup
- [ ] Compare row counts for the same tables — must match exactly
- [ ] Spot-check 3 random sales: receipt detail, totals, tax lines preserved
- [ ] Spot-check 1 product image — does R2 link still resolve, or did backup miss media?

### 7.14 Decisions (commit yes/no before launch — don't default)
- [ ] **Performance baseline** — capture Lighthouse scores (dashboard, POS, storefront) + sale completion latency? Yes/No: ___
- [ ] **Accessibility smoke** — keyboard nav + dark-mode contrast + axe-core on landing? Yes/No: ___
- [ ] **AI insights chat** — `ai_insights` flag is OFF per `project-ai-deferred` memory; confirm explicitly out of scope? Yes/No: ___
- [ ] **PWA installed-mode** — test offline manifest + service worker update on installed PWA? Yes/No: ___
- [ ] **Audit finding #6 (loyalty tiers ungated nav)** — fix code gate before launch, or document leak? Decision: ___

---

## Phase 8 — Cleanup

- [ ] Note all findings logged
- [ ] Super-admin → /admin/tenants → find `livetest1` (and `livetest2` if created) → Delete
- [ ] Verify orphan-schema-scan-worker cleans up the schema (or run manual `/api/admin/orphaned-schemas/cleanup`)
- [ ] Verify Resend has stopped sending emails to that tenant slug
- [ ] Verify R2 bucket has no leftover files for that tenant (optional, can be later)

---

## Findings Log

Date started: 2026-04-27
Operator: Hassan (sanomerchandise@gmail.com)
Tenant slug used: `livetest1` (signup auto-derives slug from "Live Test 1" → `livetest1`)
Test inbox: `oneshop349@gmail.com`
Admin user: name `Hassan`, password `Danish11`, PIN `1234`
Plan: Free (1 outlet / 3 employees / 100 products caps)

### Resume instructions (for next sitting)

To pick up where Phase 2 Day 1 left off (Apr 28):

1. **Log in** at `https://sanopos.com/login`:
   - Store Code: `livetest1`
   - Username: `hassan`
   - Password: `Danish11`
2. You should land on the dashboard. State on `livetest1`:
   - 5 products / 500 units / Rs 1,330,000 retail
   - 1 active shift opened (#1 Main Store, opened by Hassan, Rs 5,000 float — opened during Day-1 diagnosis of the POS hang)
   - 4 loyalty tiers (Bronze/Silver/Gold/Platinum) — was 12 before today's manual dedup
3. Continue **Phase 2 — Sidebar walkthrough**. About **10 of ~60 nav items** walked on Day 1. Remaining: Gift Cards, Returns, Sales History (rest of Commerce); all of Inventory / Stock Control / Procurement / Insights / Operations / Setup; Service Tickets; Online Store; Compliance; Admin.
4. **Cleanup at the very end (Phase 8)**: super-admin → `/admin/tenants` → delete `livetest1` AND `live_test_1` (the broken half-tenant from the first attempt; it failed v69 migration on the latest deploy and is harmless but should be purged).

### Phase 1 — completed 2026-04-27

What ran clean (✅):

| Check | Result |
|---|---|
| Landing page render (hero, features, pricing, CTAs) | ✅ |
| Signup form fields (Store Name / Your Name / Email / Password) | ✅ |
| Cloudflare Turnstile — invisible auto-pass on clean session | ✅ |
| Cloudflare Turnstile — interactive checkbox fallback when CF heuristics flag the session | ✅ (real users get invisible; this only fires for repeat submitters / VPN / automation) |
| TOS gating — submit disabled until checked | ✅ |
| "Check your email" screen (PR 8) | ✅ |
| Email arrival latency | ✅ ~1 minute or faster (Gmail showed "0 minutes ago") |
| Email deliverability — inbox, not spam (DKIM/SPF/DMARC pass) | ✅ |
| HTML email render — branded, "Hi Hassan," personalization, clear CTA | ✅ |
| Verify-email exchanges email-token for setup-session token | ✅ (good security pattern) |
| Setup wizard — 5 steps render, progress indicator, Back/Next nav | ✅ |
| Mode tile counts — 1 enabled (Retail Store), 22 "Coming soon" | ✅ |
| Tile selection state (blue border + tinted fill) | ✅ |
| PK localization — country=Pakistan, timezone=Asia/Karachi, currency=Rs/PKR, denominations seeded, +92 phone placeholder, GST 17% default tax | ✅ |
| Live timezone clock | ✅ |
| Setup completion → sample seed data created | ✅ 5 products, 500 units (Fix #1 + #2) |
| Login → context-select → dashboard | ✅ |
| Multi-viewport layout (desktop 1440 / tablet 820 / mobile 390) | ✅ no overflow at any size |

Findings filed during Phase 1 — all addressed in commit `d517d56` and follow-up commit:

### Critical (🔴) — fixed, on production

1. **`/api/setup/complete` returned 500 — every new tenant signup blocked.** Root cause: `seedPresetData` inserted `products(is_active)` but the schema column is `status TEXT DEFAULT 'active'`. Catch block claimed "non-fatal" but the parent transaction was already aborted, so every subsequent INSERT (admin user, outlet, role permissions, receipt template) failed with `current transaction is aborted, commands ignored until end of transaction block`.
   - Fix: drop the bad column from `backend/seeds/preset-seed-data.js`.
2. **Aborted transaction not rolled back.** The "non-fatal" catch had no SAVEPOINT/ROLLBACK, so a seed bug poisoned the entire setup transaction.
   - Fix: wrap the seed call in a `SAVEPOINT seed_data` in `backend/routes/setup.js`. Future seed failures now don't poison setup.
3. **Raw Postgres error string leaked into the wizard UI** (users saw `current transaction is aborted, commands ignored until end of transaction block` verbatim).
   - Fix: sanitize the 500 response in `setup.js` to a generic message; log full error server-side.

### Important (⚠️) — fixed, on production

4. **Setup wizard Step 1 — `Next` not disabled when no business type selected.** User could advance with no implicit pick (silently auto-defaulted). Fine today since retail is the only enabled tile but breaks once more modes ship.
   - Fix: `industry_type` initial state = empty string; `validateStep()` blocks step 1 advance; Next button disabled with opacity-50 styling until a tile is clicked.
5. **Data loss between signup and wizard Step 2.** Store Name entered at signup was empty in Step 2 (Store Identity).
   - Fix: extended `GET /api/setup/status` to return `store_name` / `admin_name` / `admin_email`; wizard pre-fills on mount. Email also pre-fills.
6. **Same data loss on Step 5.** Full Name entered at signup ("Hassan") was empty in the Admin Account step.
   - Fix: same `/api/setup/status` extension covers admin_name pre-fill.
7. **Fiscal Year defaulted to January even for Pakistan.** PK fiscal year is July–June; should auto-localize.
   - Fix: `fiscal_year_start` field added to country packs (PK: `07-01`, AU: `07-01`, IN: `04-01`); wizard hydrates from selected country pack on mount and on country change.
8. **Slug naming — "Live Test 1" produced `live_test_1` (snake_case underscores)**, not the cleaner `livetest1`.
   - Fix: slug regex now strips all non-alphanumerics (`[^a-z0-9]/g → ""`) instead of replacing with underscores. "Live Test 1" → `livetest1`. Forward-looking — existing tenants unaffected.
9. **Signup form has no tenant slug field — by design (out of scope for fix per operator decision).** Slug is auto-derived from store name. The "Check your email" screen does show `Your store code is: <slug>` so users see what they got.
10. **Turnstile console pollution — Cloudflare iframe emits ~10 TrustedHTML/TrustedScript CSP violations** that are noise inside CF's sandboxed iframe (not actionable on our side).
    - Fix: Sentry config updated with `denyUrls` for `challenges.cloudflare.com` + `about:srcdoc` and `ignoreErrors` for the Trusted Types messages.
11. **PR 6 auto-login fallback to `/login`** instead of `/dashboard` after setup completes. Root cause: `loadCompanyProfile` middleware populates the cache with a placeholder `{ timezone: "UTC" }` (no `setup_complete` field), kicks off a fire-and-forget DB load, then immediately checks `!entry.profile.setup_complete` → `undefined` → 503 `SETUP_REQUIRED`. Race condition. Same race also bites the first authenticated request after any backend restart.
    - Fix (separate commit): in `backend/middleware/tenant-auth.js`, AWAIT the company-profile load on cold-cache start; periodic refresh stays async. Also exposes `invalidateCompanyProfileCache(tenantId)` and calls it from `setup.js` after the setup transaction commits, so the wizard's mount-time `/api/setup/status` (which warms the cache with `setup_complete=false`) doesn't strand the auto-login behind the 5-min TTL.

### Side observations (not bugs, just noted)

- The `live_test_1` half-tenant from the first failed signup is in master DB with `setup_complete=false` and a partial schema. **v69 migration ran during the post-fix Railway boot and failed on it** (transaction-aborted during migration too). Not blocking — backend logs the per-tenant failure and continues. Will be deleted in Phase 8 cleanup.
- Default Tax (GST 17%) auto-detected from country pack and pre-filled in Step 3 with a "DEFAULT TAX (AUTO-DETECTED FOR YOUR COUNTRY)" panel. Nice UX.
- "Approaching plan limit" banner fires immediately on dashboard for Free tier (1 of 1 outlets used) — correct behavior.

### Important (⚠️) — should fix before launch
_None outstanding — all Phase 1 items fixed and deployed_

### Cosmetic / minor (✅ with notes) — fix post-launch
_None outstanding from Phase 1_

### Pre-launch decisions made
- [ ] Payment gateway choice (Phase 7.5):
- [ ] Browser compatibility verdict:
- [ ] T&C content sign-off:

---

### Phase 2 — Day 1 (2026-04-28)

**Items walked**: ~10 of ~60 nav items.
- ✅ Overview / Dashboard
- ✅ Commerce: POS (originally 🔴 — fixed today), Orders, Fulfillment, COD Settlements, Parked Sales, Holds & Layaway, Customers, Customer Groups, Loyalty Tiers (originally 🔴 — fixed today), Cash Management (used to open shift during POS diagnosis)

**Five fixes shipped today (all on production):**

| # | Fix | Commit | How verified |
|---|---|---|---|
| 1 | POS infinite Loading on new-tab open — POSRoute gated on `presetLoaded` from PresetContext, but PresetContext only fetched inside `AppLayoutRedesign`. POS opens in a new tab outside AppLayout → preset never loaded. Moved bootstrap into `PresetProvider` itself. | `60ad6f4` | POS renders end-to-end |
| 2 | PresetProvider race — useEffect fired before AuthProvider's fetch interceptor was patched, returning 401 from `/api/context/bootstrap` and falling back to `general_retail` preset (silent breakage for clinic/restaurant tenants on direct /pos nav). Gated on `useAuth().isBootstrapping=false`. | `6afdd70` | `/api/context/bootstrap` returns 200 |
| 3 | No tax marked `is_default`. Provisioner inserted "Default Tax" 0% without `is_default`; setup-complete fell back to country-pack default (GST 17% PK) and inserted that as a second row also non-default. New model per merchant request: provisioner seeds 0% Default Tax with `is_default=true`; wizard Step 3 no longer auto-prefills the country-pack tax — merchants opt in. | `520d3e5` | Vercel + Railway both redeployed; deployed bundle has the new "Optional: Add a tax" copy |
| 4 | Loyalty tiers seeded 3× (12 rows for 4 tiers). `ON CONFLICT DO NOTHING` was a no-op because no UNIQUE on `name`. Provisioner runs `schema-pg.sql` AND migration v34 each seed once → fresh tenant always got 8+ rows. Added UNIQUE in `schema-pg.sql`, fixed `ON CONFLICT (name)` in both seed sites, added migration **v79** that dedupes existing rows + adds the constraint (idempotent via DO block, FK-safe via UPDATE-then-DELETE-then-ADD). | `2044e9e` + manual SQL on `tenant_livetest1` (because livetest1's migration loop is stuck at v69 — see side-finding) | API returns 4 rows; `loyalty_tiers_name_key` constraint visible in `pg_constraint` |
| 5 | POS bootstrap fired 4 phantom 503s. `useCart`/`POSContext` called `/api/pos-layouts`, `/api/price-list-assignments`, `/api/pos/suggestions`, `/api/pos-devices/register` unconditionally; `requireFeature()` returns 503 when the corresponding phase-2 flag is off. Silent `.catch()` blocks swallowed the errors but Sentry / Network tab still saw them. Gated each useEffect on the relevant flag. | `58e6c9d` | Network tab shows zero requests to those endpoints on POS bootstrap |

**Side-finding (low priority — log only):**

- **livetest1's tenant migration loop is stuck at v69** ("Schema hygiene sweep — idempotent backfill of returns columns + product_serial_numbers.status CHECK"). It aborts with `current transaction is aborted, commands ignored until end of transaction block` because of a partial schema state from yesterday's first failed signup. **Future migrations cannot apply to this tenant** — that's why fix #4's v79 had to be applied manually. **Not a launch blocker** (livetest1 is a test tenant getting nuked in Phase 8). Worth investigating before onboarding any real existing tenants — should make v69 idempotent against the broken state.

**Resume next sitting:**
- Continue Phase 2 walk from Commerce / Gift Cards.
- Pause every ~15 items for spot-check.
- 1 open shift remaining on `livetest1` (Main Store, Hassan) — gets nuked in Phase 8 anyway.

---

### Phase 2 — Day 2 (2026-04-28)

**Items walked**: 50 of ~50 nav items — **walkthrough complete**.

Groups covered: Commerce remaining (3) → Inventory (8) → Stock Control (8) → Procurement (3) → Insights (6) → Operations (6) → Setup (11) → Online Store (1) → Compliance (2) → Admin (5). Service Tickets verified correctly hidden for retail mode (Day-1 brief was outdated — it never surfaced).

**Three fixes shipped today (all on production):**

| # | Fix | Commit | How verified |
|---|---|---|---|
| 1 | **Chart of Accounts triplicate seeds — same root-cause class as v79 loyalty-tiers fix.** All 21 system accounts appeared 3× (63 rows). `chart_of_accounts.code` had no UNIQUE; bare `ON CONFLICT DO NOTHING` no-op'd. 3 INSERT sites all fired during provisioning. v80 dedupe + UNIQUE(code) + 3 ON CONFLICT (code) fixes. FK-safe via UPDATE-then-DELETE on `journal_entry_lines.account_id` and self-FK `parent_id`. | `cd6f4bd` | UI shows each account once (63 → 21 rows verified live) |
| 2 | **Courier integrations triplicate seeds — third instance of same root-cause class.** 13 system couriers × 3 = 39 rows. `adapter_key` had no UNIQUE. v81 dedupe + UNIQUE(adapter_key) + 3 ON CONFLICT (adapter_key) fixes. FK-safe via UPDATE-then-DELETE on `web_orders`, `loadsheets`, `order_shipments`, `cod_settlement_batches`. **Cross-table audit confirmed couriers is the LAST vulnerable seed table** (chart_areas 97/97, role_permissions 22/22, void_reason_codes 10/10, return_reasons 6/6, no_sale_reasons 4/4, override_reasons 4/4 all clean; loyalty/CoA already fixed). | `593062a` | UI shows each courier once (39 → 13 rows verified live) |
| 3 | **Duplicate page headers on 3 tier-2 pages** (Approvals, Barcode Templates, Receipt Templates). Each Redesign wrapper used `<PageShell title=… subtitle=…>` AROUND a legacy component that ALSO rendered its own `<h1>` + subtitle. Stripped the inner `<h1>` from each legacy file; preserved action buttons via `flex justify-end`. | `00dad32` | /approvals after Vercel redeploy — header rendered exactly once |

For livetest1 specifically, fixes #1 and #2 also required manual SQL because its migration loop is still stuck at v69 (Day-1 side-finding).

**⚠️ Outstanding medium issues (functional, not yet fixed):**

| Page | Issue |
|---|---|
| Insights → Accounting | `GET /api/accounting/cashflow/daily?from=…&to=…` returns **400** on page load. Possible feature-flag gap or validation bug. |
| Stock Control → Inventory Audit | Page is **largely blank below the title** — no KPIs, no table, no empty state. Half-finished. Plus breadcrumb says "Stock Counts" while title is "Inventory Audit". |
| Online Store → Storefront | Empty state copy says "Try adjusting your search or filters" but real issue is products aren't published (need rows in `channel_publications`). Misleading copy + no clear path from Inventory to publish. UX trap for new tenants who see 5 sample products in Inventory but empty storefront. |
| Admin → Billing | "BEST VALUE" pill is on Annual (17% off, save PKR 16k) but the **Quarterly** card is pre-selected with a green border. Default cycle should match the recommended pill. |

**⚠️ Polish bundle (16+ low-severity items, all bundleable into one cleanup commit):**

- **Lowercase-leading subtitles** on 9 pages: Brands, Taxes, Attribute Sets, Promotions, Purchase Orders, Stock Adjustments, Transfers, Returned Stock, Supplier Payables. Sources: [BrandsRedesign.jsx:103](frontend/src/pages/redesign/BrandsRedesign.jsx#L103), [TaxesRedesign.jsx:105](frontend/src/pages/redesign/TaxesRedesign.jsx#L105), [AttributeSetsRedesign.jsx:176](frontend/src/pages/redesign/AttributeSetsRedesign.jsx#L176), [PromotionsRedesign.jsx:312](frontend/src/pages/redesign/PromotionsRedesign.jsx#L312) + 5 others.
- **Subtitles missing trailing period** on ~10 pages.
- **Nav-vs-title mismatches** on 6 pages: Inventory Audit / "Stock Counts", HR / "HR Management", Company Profile / "Company Settings", Barcode Templates / "Barcode Label Designer", Backup / "Backup & Restore", Tax Lookup / "Tax Rate Lookup". Plus FBR breadcrumb shows "Fbr" instead of "FBR" and Chart of Accounts breadcrumb shows "Chart Of Accounts".
- **Layout drift on older pages** (no KPIs / outline-style CTAs / bare HTML forms / no subtitles): Price Lists, Review Moderation, Inventory Audit, Printer Settings.
- **CTA color drift** — at least 5 different button styles across primary CTAs: green-fill (correct), green-outline (Print Labels), blue (New Template / Add Custom Courier / Apply / Save Settings), purple/violet (Receipt Templates New Template), white-outline (Refresh).
- **Stock display `100.000`** — trailing zeros from v45 NUMERIC(10,3) widening; should trim when fractional == 0.
- **"GST %" hardcoded label** on Add Product → Pricing section (country-coupled to PK).
- **"outlet #1" ID leak** in Notifications body text — should resolve to outlet name.
- **Login bootstrap 401** — single `/api/context/bootstrap` 401 during login redirect (different code path from Day-1 fix `6afdd70`; harmless noise but Sentry sees it).
- **Reports subtitle** missing space ("acrosssales" → "across sales") + lists "restaurant" reports for retail tenants (subtitle should be retail-mode-aware).
- **Revenue Forecast chart warning** — Recharts/EChart wrapper has width(-1)/height(-1) sizing race (chart still renders).
- **Post-Dated Cheques silent 503s** on bootstrap (3 endpoints) — same fix-pattern as Day-1 fix #5 (`58e6c9d`).
- **Action History** action/entity columns blank for login events — could be by design but visually odd.

**Withdrawn finding (verified not a bug):**
- **Returns "Original sale id (optional)" UI label** — git/code check confirmed [routes/returns.js](backend/routes/returns.js#L153) treats `original_sale_id` as nullable (handles web-order returns + no-receipt returns). UI label is correct. The OpenAPI doc string at lines 27/37 is the stale one and CLAUDE.md was quoting it. **Doc fix** candidate, not UX bug.

**Pre-launch verifications still pending (defer to Phase 8):**
- Sign up a fresh test tenant and confirm provisioner inserts Default Tax 0% with `is_default=true` (Day-1 fix #3 verification on livetest1 was inconclusive — that tenant has pre-fix residue).
- Investigate making v69 migration idempotent against the partial-schema state before onboarding any real existing tenants. Not a launch blocker (livetest1 gets nuked in Phase 8) but a hidden trap.

**Key takeaway:** the same provisioner-loop bug class showed up 3 times in 2 days (loyalty v79, CoA v80, couriers v81). The audit confirms no other seed tables are vulnerable. But this points to a need for **a unit test that runs the provisioner end-to-end and asserts no duplicate seed rows** — would have caught all three at PR time.

---

## Out of Scope

The following are deliberately excluded from this walkthrough — confirmed out of scope for the retail launch. Do not pad the walkthrough with them; they should be revisited in their own dedicated walkthrough when those modes/features ship.

| Area | Why out of scope |
|---|---|
| Restaurant nav group (Floor Plan, Checks, KDS, Modifiers, Tip Pools, etc.) | Mode-gated; not enabled in `general_retail` tenants |
| Appointments / Bookings nav group | Mode-gated; non-retail |
| Service Tickets nav group | Mode-gated; non-retail |
| Projects & Contracts nav group | Mode-gated; non-retail |
| Rentals nav group | Mode-gated; non-retail |
| Rooms (hotel/lodging) nav group | Mode-gated; non-retail |
| Clinical (Treatment Plans, Lab Orders) nav group | Mode-gated; non-retail |
| Public booking pages (`/book/:slug`, `/reserve/:slug`) | Surface only when bookings module is enabled |
| Public restaurant QR pages (`/menu/:token`, `/pay/:token`) | Surface only when restaurant module is enabled |
| Subscriptions nav (`/subscriptions`) | Mode-gated (`requiredMode: subscriptions`) — not in `general_retail`. Surfaces in gym preset only. |
| Commissions nav (`/commissions`) | Mode-gated (`requiredMode: commissions`) — not in `general_retail`. Surfaces in salon/services preset only. |
| Mode-gated workers (rental-overdue, room-overdue, treatment-plan, kds-load-snapshot, course-release, booking-reminder) | Don't run for retail tenants |
| Super-admin panel walkthrough (10 admin pages) | Internal team surface, separate auth, not part of merchant launch |
| SMS campaign provider integration | `phase5_sms_providers` flag — no provider creds wired; post-launch |
| Marketplace background sync (Daraz, Meta, WhatsApp, Google Merchant) | Stubbed; "manual sync only" disclaimer is the launch story |
| Multi-day offline POS | Best-effort by design; document in support FAQ |
| AI Insights chat (`/api/insights/ask`) | Per `project-ai-deferred` memory — AI expansion deferred, no customer demand |

---

## Refresh Triggers

Refresh / re-run this walkthrough when:

- New retail-launch PR ships
- Major nav change in `nav-config.js`
- New mode added that gates a nav group
- Any Phase 7 decision changes (payment gateway swap, browser support pledge, T&C update)
- Quarterly cadence regardless, as a "is anything still wired up?" check
