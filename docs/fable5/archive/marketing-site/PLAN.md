# Marketing Site — Phase 1 Plan (Audit + IA + Design + SEO)

> Status: **APPROVED 2026-07-07** — Phase 2 building on `feat/marketing-site`. Companion file: [COPY-DECK.md](./COPY-DECK.md) (full written copy for every page).
> Date: 2026-07-07 · Codebase at v122 (main @ 6335a93)
>
> **Approved decisions (§13)**: (1) IA + copy deck + design direction approved as-is; (2) starter rows: filter client-side AND deactivate in prod (`UPDATE plan_pricing SET is_active=false WHERE plan='starter'`); (3) demo CTA = `demo@sanopos.com` via Cloudflare Email Routing → sanomerchandise@gmail.com; (4) OG images: per-family variants (11 images); (5) prerender approach confirmed (runtime Seo + build-time static shells + sitemap/robots).

---

## 1. Scope recap (decisions already made — not re-litigated)

- Full marketing site: home + 10 industry-family pages + pricing + "why SanoPOS / compare".
- Global-neutral English positioning; Pakistan strengths (FBR, couriers, foodpanda/Careem, PKR) live in a dedicated **localization/compliance section**, not the headline.
- Same brand as the app: Square design system (`--ui-*` tokens, `ui/primitives.jsx`), light-only.
- Plan → approval → build. Build happens on `feat/marketing-site`, branch push only, never main.

---

## 2. Verified feature inventory (feature → proof table)

Every claim in the copy deck traces to one of these rows. Verified directly against source on 2026-07-07.

### Platform spine (all industries)

| Sellable claim | Proof in code |
|---|---|
| 23 industry presets, 10 vertical modes | `backend/config/industry-config.js` (`INDUSTRY_PRESETS`, 23 keys), `backend/config/mode-registry.js` (10 modes) |
| POS: barcode/SKU/price search, split payments, returns, parked sales, shifts, PIN re-auth, F-key shortcuts | `pos_search_config` per preset; `pages/redesign/pos/POSContext.jsx` (8 domain hooks); CLAUDE.md POS shortcut map |
| Offline sale queue (keeps selling through outages) | `frontend/src/utils/offlineQueue.js` (IndexedDB, sale/return/check_in/field_order) |
| Multi-outlet: transfers, outlet stock, outlet pricing/visibility, price books | `MULTI_OUTLET_SEED_FLAGS` in `services/retail-flag-preset.js` (5 flags flipped at 1→2 outlets) |
| Customer portal, per-industry tabs | `PORTAL_ENABLED_TABS_BY_PRESET` in `industry-config.js`; routes in `frontend/src/routes/publicRoutes.jsx` (`/portal/:tenantSlug`) |
| Public booking page w/ per-industry vocabulary | `public_booking_labels` per preset; `/book/:tenantSlug` route (`PublicBookingPage`) |
| Embedded storefront + anonymous cart + checkout | `/store/:tenantSlug` routes; `services/storefront-cart.js`, `services/quote.js` |
| Loyalty, gift cards, wallet | `phase2g_loyalty`, `phase2g_gift_cards` flags (retail/restaurant/salon seed bundles) |
| Staff: roles/permissions, attendance kiosk, cash shifts, commissions | `middleware/permissions.js` role defaults; `/kiosk` route; `phase2_commissions` (commissions mode); `services/commission-calc.js` |
| Accounting in-app (P&L, journals, AP/AR) | `routes/tier4/` accounting (feature flag `accounting_core`) |
| Reports layer + AI insights chat | `routes/reports/`, `routes/insights.js`, `routes/insights-ai.js` (`ai_insights`, needs `ANTHROPIC_API_KEY` — **still absent on Railway**, so AI chat must NOT be a headline claim; keep it out of copy or mark internal-only until the key is set) |
| Marketing: SMS campaigns, customer segments | `sms_campaigns` + `phase5_sms_providers` flags; `services/marketing.js`, `services/sms.js` |
| Integrations: Shopify, WooCommerce, Daraz, Meta/Facebook, WhatsApp, Google Merchant | `routes/shopify/`, `routes/woocommerce.js`, `routes/integrations/` + `services/marketplace/` |
| Hardware: USB barcode, ESC/POS thermal, network TCP/IP printers | `services/printer.js` (`printToNetwork`) |
| PWA install (tablet/phone/desktop) | `manifest.webmanifest`, `sw.js`, `PwaInstallPrompt.jsx` |
| Free plan + Pro w/ 45-day trial | `SignupPage.jsx` ("Free plan — 1 outlet, 3 employees, 100 products"); `middleware/plan-limits.js` |

### Per industry family

| Family (presets) | Headline capabilities | Proof |
|---|---|---|
| **Retail & grocery** (general_retail, grocery, butcher, sweet_shop, textile) | 19-flag retail bundle (variant picker, price override, holds/layaway, label designer, inventory intelligence, weekly digest); PLU rapid-entry pad (grocery); weight/tare selling in kg/g/lb (butcher/sweet/textile `unit_vocabulary` + `WEIGHTED_UNITS`); scale-embedded barcode decoding; batch/expiry FEFO; production/recipes (carcass→cuts, mithai boxes); fabric roll (thaan) picker | `RETAIL_SEED_FLAGS`, `RETAIL_SUBTYPE_FLAGS`, `pos_search_config.show_plu/show_tare`, `services/embedded-barcode.js`, `services/batch-stock.js`, `services/kit-engine.js` |
| **Restaurants & cafes** (restaurant, cafe) | 13 restaurant flags: floor plans, KDS, QR ordering, 86 board, void/comp, pay-at-table, reservations, KDS analytics, day-parting, fire chits, seats, drive-thru, menu engineering; counter-mode POS (cafe); tabs/split checks; tip capture + pooling; online-order inbox; customer kiosk; delivery aggregator inbox (foodpanda/Careem) | `MODE_REGISTRY.restaurant` (13 flags), `services/restaurant-checks.js`, `services/tips.js`, `routes/restaurant-kiosk.js`, `services/aggregator-orders.js` (`AGGREGATOR_SOURCES = ["foodpanda","careem"]`, `delivery_aggregators` flag) |
| **Salons & spas** (salon) | Appointment calendar + staff scheduling; commission plans; session/facial packages & passes; waitlists on full slots; loyalty + gift cards + SMS bundle; public booking ("Book an appointment" / Stylist); walk-in performed-by assignment | modes `appointments`+`commissions`; `PRESET_EXTRA_FLAGS.salon` (`packages_passes`, `phase4_appointments_waitlists`); `SALON_SEED_FLAGS`; `public_booking_labels` |
| **Clinics** (clinic, dental_clinic, veterinary, physiotherapy) | Multi-visit treatment plans; charting presets (body / dental / vet_body); consent templates per specialty (anaesthesia, extraction, implant, euthanasia…); patient recalls; intake forms; vaccinations (vet); exercise handouts (physio); plan deposits via gateway pre-auth; patient portal ("My Treatments"); Clinical report group | mode `treatment_plans`; `clinical_config` per preset; `PRESET_EXTRA_FLAGS` (`clinical_recalls`, `custom_forms`, `vet_vaccinations`, `clinical_handouts`); `services/recall-service.js`, `services/treatment-plan-deposits.js` |
| **Gyms & fitness** (gym) | Recurring membership billing + renewal tracking; class timetable + waitlists; class/PT passes; liability waiver forms; member door check-in kiosk; member portal (memberships, class passes) | modes `subscriptions`+`appointments`; `PRESET_EXTRA_FLAGS.gym` (5 flags incl. `member_checkin`); `/member-checkin` public route; `services/subscriptions.js` |
| **Wholesale & distribution** (wholesale) | Credit limits + payment terms + on-account sales; AR aging + statements; field-rep mobile PWA (GPS+selfie check-in, order capture, offline queue); slab/tier trade schemes; manufacturer partner portal (secondary-sales visibility); backorders/partial fulfillment; van sales; MOQ + case-pack; customer-group catalog visibility | mode `wholesale`; `WHOLESALE_SEED_FLAGS` (6); `routes/field.js`, `services/geo.js`, `services/backorder.js`, `services/moq.js`, `services/product-visibility.js`, `/manufacturer-portal/:slug` routes |
| **Rentals** (car_rental, equipment_hire, furniture_rental, party_supplies) | Contract lifecycle (confirm → check-out → return → complete), late fees, availability calendar, condition inspections ON by default, deposits, invoice generation; optional online booking (opt-in) | mode `rentals`; `services/rental-service.js` (`computeLateFee`, status transitions); `PRESET_EXTRA_FLAGS` `rental_inspections`; `rental_online_booking` opt-in |
| **Hotels & lodging** (hotel, guesthouse, hostel) | Room inventory + rate calendar; booking lifecycle (confirm/check-in/check-out/no-show); guest folios + charge-to-room from POS; deposit pre-auth captured at checkout; channel sync (iCal); guest registration register; hostel beds (per-bed via parent room); public "Book a stay/room/bed" page | mode `room_management`; `services/room-service.js`, `services/room-deposits.js`; `PRESET_EXTRA_FLAGS` (`room_channel_sync`, `room_guest_registration`); `/book-room/:tenantSlug` |
| **Repair shops** (repair_shop) | Job-ticket workflow board (intake → in-progress → done), deposits, estimates, warranty tracking, invoice straight from ticket, customer portal "Repair Tickets" tab | mode `workflow_tickets`; `services/service-tickets.js` (`generateInvoiceFromTicket`); V06 estimates/warranty (v101–104, in prod) |
| **Photography & creative** (photography_studio) | Inquiry → lead capture (public inquiry page); quotations → projects → contracts → milestone invoicing; client questionnaires auto-attached; gallery proofing in client portal; session booking | modes `service_projects`+`appointments`; `/inquire/:tenantSlug` (`PublicInquiryPage`); `services/projects.js`, `services/contracts.js`, `services/project-billing.js`; `PortalGallery` route + `gallery` portal tab |

### Localization / compliance section (Pakistan)

| Claim | Proof |
|---|---|
| FBR Digital Invoicing: real-time IRN + QR, retry queue w/ backoff, HS-code inheritance | `routes/fbr.js`, `services/fbr.js`, `workers/fbr-worker-boss.js`, `category-tree.js:resolveInheritedField` |
| HS-code tax lookup | `routes/tax-lookup.js`, `tax_rate_reference` table |
| 13 courier integrations (Leopards, TCS, BlueEx, Trax, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, PakPost, DHL, FedEx) | `backend/services/couriers/` — 13 named adapters verified by glob |
| foodpanda / Careem order inbox | `services/aggregator-orders.js` (**caveat**: V03 open gates — real signature headers + live test order still pending; copy says "connect foodpanda & Careem", which is what the product does, but we do NOT claim certified partnership) |
| COD reconciliation, loadsheets, dispatch | `phase5_cod_reconciliation`, `phase5_shipping_automation`, `routes/fulfillment.js` |
| PKR pricing, Asia/Karachi, WhatsApp receipt share | `plan_pricing` rows (PKR), `wa.me` share in POS receipt modal |

### Claims we must NOT make (checked and rejected)

- **AI insights chat** — code exists but `ANTHROPIC_API_KEY` is not on Railway; feature is dead in prod. Excluded from copy.
- **Online card payments for subscriptions** — `payment-gateway.js` xPay adapter is env-gated and not enabled; billing is manual-admin today. Pricing page says "pay by bank transfer / contact us", not "pay by card".
- **Certified foodpanda/Careem partner** — integration is inbound-webhook based, not a certified marketplace listing.
- **Dark mode** — removed in the Square reskin. Site is light-only like the app.
- No "coming soon" items anywhere (per your rule) — everything on the site is live at v122.

---

## 3. Audit of current landing + variants

**Currently served at `/`**: `LandingPagePreview.jsx` via `HomeRedirect` (`routes/publicRoutes.jsx:117`). Single long page: hero (Unsplash hotlink), 6 "core systems" cards, devices, POS depth, business types, customer tools, comparison tables, stats, feature groups, steps. Solid content skeleton but: Pakistan-first headline, Unsplash hotlinked imagery (external requests, generic stock), single page only, no per-industry depth, `index.html` meta says "Modern POS for Pakistan".

**Dead code found (10 files, ~all confirmed unreferenced or preview-only):**

| File | Status | Verdict |
|---|---|---|
| `pages/LandingPage.jsx` | Not imported by any route (grep: only a stale CLAUDE.md mention) | **Delete** |
| `pages/LandingEditorial.jsx` (`/preview/landing-v2`) | Preview-only | **Delete** — steal: stat strip, numbered industry index |
| `pages/LandingBrutalist.jsx` | Preview-only | **Delete** — steal: "spec sheet" table (runtime/offline/hardware/integrations rows) → becomes the home-page "Under the hood" section |
| `pages/LandingLuxury.jsx` | Preview-only, **stale claims** ("Retail-only at public launch", "Coming soon: Salon/Clinic/Restaurant…") | **Delete** |
| `pages/LandingShowroom.jsx` | Preview-only, dark theme (off-brand now) | **Delete** — steal: product-first CSS-built dashboard mockup hero + kicker/title/bullets feature-block anatomy |
| `pages/LandingBazaar.jsx`, `LandingTruckart.jsx`, `LandingY2k.jsx`, `LandingScrapbook.jsx` | Preview-only novelty themes | **Delete** |
| `pages/LandingPagePreview.jsx` | Current `/` — replaced by new home | **Delete** after new home ships (same commit) |

Also delete the 9 preview routes (`/landing-preview` + 8 × `/preview/landing-*`) and their lazy imports from `publicRoutes.jsx`. Net effect: publicRoutes gets *smaller*.

**Note**: the variants' number claims ("67+ report tabs", "90+ features", "11-segment RFM") are unverified — the new copy deck uses only counts verified in §2 (23 presets, 10 modes, 13 couriers).

---

## 4. Information architecture

```
/                          Home
/industries                Index (all 10 families, links + preset chips)
/industries/retail         Retail & Grocery  (retail, grocery, butcher, sweet shop, textile)
/industries/restaurants    Restaurants & Cafes
/industries/salons         Salons & Spas
/industries/clinics        Clinics (medical · dental · veterinary · physiotherapy)
/industries/gyms           Gyms & Fitness Studios
/industries/wholesale      Wholesale & Distribution
/industries/rentals        Rentals (car · equipment · furniture · events)
/industries/hotels         Hotels, Guesthouses & Hostels
/industries/repair-shops   Repair & Service Shops
/industries/photographers  Photography & Creative Studios
/pricing                   Pricing (live from /api/billing/pricing)
/why-sanopos               Why SanoPOS / compare
(existing, unchanged)      /signup /login /terms /privacy
```

**Implementation shape** (Phase 2): `frontend/src/pages/marketing/`
- `MarketingLayout.jsx` — shared nav (logo, Industries dropdown, Pricing, Why SanoPOS, Sign in, **Start free** pill) + footer (industry links, product links, legal, localization note). One lazy chunk.
- `HomePage.jsx`, `PricingPage.jsx`, `WhySanoPosPage.jsx`, `IndustriesIndexPage.jsx` — one lazy chunk each.
- `IndustryPage.jsx` — **single template** driven by `content/industries.js` (per-family copy objects from the copy deck). One template chunk + one content chunk shared by all 10 industry routes (content is text — small).
- `Seo.jsx` — tiny runtime helper (sets `document.title` + meta/OG/JSON-LD via DOM). No new deps.
- `HomeRedirect` keeps its current auth-redirect behavior but renders the new `HomePage`.

---

## 5. Copy deck

Written out in full — headlines, subheads, every feature block, CTAs, meta titles/descriptions, FAQs — in **[COPY-DECK.md](./COPY-DECK.md)**. Positioning summary:

- **Master narrative**: "One system that becomes *your* system." SanoPOS reshapes itself per industry — vocabulary, POS layout, dashboard, reports, customer portal all follow the preset. That's the real differentiator the code supports (23 presets / 10 modes), and no competitor angle needs inventing.
- **Home H1**: *"The point of sale that speaks your industry's language."*
- Global-neutral voice; Pakistan appears once on home ("Built global. Localized deep.") and in the footer, with full detail on `/why-sanopos`.

---

## 6. Design direction

- **Extend the app's Square system** — import `ui/tokens.css`, reuse `Button`/`Badge` primitives where sensible. Marketing pages add a `marketing.css` layer with *additive* tokens only (`--mk-display-*` sizes); no changes to `tokens.css` itself, so zero app-side risk.
- **Type scale** (Inter Variable — already bundled via `@fontsource-variable/inter`, no external font requests): display 64/56/44px (desktop/tablet/mobile) at `font-weight 640, letter-spacing -0.02em`; section H2 32px; kicker 13px uppercase muted; body 16–17px/1.6.
- **Look**: white canvas, hairline `--ui-border` cards, black pill CTAs, `--ui-link` blue only for text links, pale status-token chips as industry accents. Flat, no shadows (drawer shadow only). Same as the app = the screenshot sections blend seamlessly.
- **Imagery = real product screenshots, not stock**: current landing hotlinks Unsplash (external requests, generic). Replace with WebP screenshots from the `golv_*` tenants inside a lightweight CSS "browser frame" component. Lucide icons (existing dep) for feature bullets. No illustration system, no new deps.
- **Steal list** (from §3): Showroom's product-first hero mockup → we use a *real* screenshot instead of CSS-built; Brutalist's spec-sheet table → "Under the hood" home section; Editorial's stat strip → verified-numbers strip (23 presets · 10 modes · 13 couriers · 45-day trial).

## 7. SEO plan (Vite SPA — stated explicitly)

**The problem**: this is a client-rendered SPA. Google executes JS and will index runtime meta fine, but **social scrapers (WhatsApp/Facebook/LinkedIn/Twitter) do not run JS** — today every URL shares the one static `index.html` OG block. Also `public/` has **no robots.txt and no sitemap.xml** today.

**Recommendation — two layers, no SSR framework migration:**

1. **Runtime `<Seo>` component** (per page): sets `document.title`, meta description, canonical, OG tags, JSON-LD. Covers Google/Bing. Zero deps (~40 lines of DOM code, react-helmet not needed).
2. **Build-time static-shell prerender** (the part that needs your OK): a small post-build Node script (`frontend/scripts/prerender-meta.mjs`, run in `npm run build`) copies `dist/index.html` to `dist/<route>/index.html` for each of the 14 marketing routes and rewrites `<title>`/meta/OG/canonical/JSON-LD per route from one config file, and emits `sitemap.xml` + `robots.txt`. Vercel serves filesystem matches **before** rewrites, so `/industries/retail` gets its own shell with correct OG while the SPA hydrates normally. No SSR, no framework change, no runtime cost, fully deterministic.
   - Verdict: **prerendering (this lightweight form) is needed** for correct social previews; full SSR/SSG is not.

**Per-page meta** (exact strings in COPY-DECK.md): unique title ≤60 chars, description ≤155, OG title/description/image. **JSON-LD**: `Organization` + `SoftwareApplication` (home), `Service` + `BreadcrumbList` (industry pages), `FAQPage` (pricing + industries with FAQs), `AggregateOffer` deliberately omitted (PKR-only pricing would look odd in global snippets). `index.html` base meta gets rewritten to the new global-neutral home copy. OG images: one branded default + optional per-family variants (Phase 2 stretch — default-only is acceptable to ship).

## 8. Pricing page mechanics

**Recommendation: live** from `GET /api/billing/pricing` (public, no auth — verified `routes/billing.js:46`) with a hardcoded fallback if the fetch fails. The endpoint returns per-cycle price, `monthly_equivalent`, `discount_percent`, `savings`, `currency_code` — render currency from `currency_code`, never hardcode a symbol (global-neutral rule).

**⚠ Anomaly found (needs your decision)**: production `plan_pricing` still contains **active `starter` rows** (PKR 3,000/mo, 30,000/yr) alongside `pro`, but signup only offers Free/Pro and memory says Starter was removed. Options: (a) I filter to `free`+`pro` client-side and you deactivate the rows later, or (b) you approve `UPDATE plan_pricing SET is_active=false WHERE plan='starter'` as part of Phase 2 (prod data change — your call). **Plan assumes (a) plus your decision on (b).**

Free tier is static copy (1 outlet · 3 employees · 100 products — verified against `SignupPage.jsx`). Pro column shows cycle toggle (monthly/quarterly/semi-annual/annual) with live discount %. 45-day trial stated. Payment reality: manual/bank-transfer + admin activation (gateway not enabled) — copy says "activate from your dashboard; pay by bank transfer", no card claims.

## 9. CTAs

- **Start free** → `/signup` (Turnstile-gated, verified). **Sign in** → `/login`.
- **Book a demo — recommendation: `mailto:demo@sanopos.com`** (with subject prefill). Rationale: `POST /api/support/tickets` requires tenant auth, so a public demo form needs a new backend endpoint — not worth it for launch. Requires one config task: add a `demo@sanopos.com` forward in Cloudflare Email Routing (falls back to `sanomerchandise@gmail.com` if you prefer that address directly — say which). A public demo-request endpoint can be a post-launch follow-up.

## 10. Screenshot production

- Use the **local** `golv_*` fleet (Owner / 1234, `localhost:5173`, all @v122 — verified `docs/fable5/go-live/TEST-TENANTS.md`).
- Step 1: seed believable demo data per tenant via API scripts (products with images optional, a day of sales, bookings/contracts/plans per vertical) — a `tools/marketing-seed/` script set, local DB only.
- Step 2: Playwright capture script (`frontend/tools/marketing-shots.mjs`, not a test spec) logs in per tenant and captures a fixed shot list at 1440×900 (+ 390×844 for the field-rep/portal mobile shots) → `frontend/src/assets/marketing/*.webp`, width-capped ~1600px, converted via `sharp`-less pipeline (Playwright emits PNG; convert with `cwebp` or accept PNG→ Vite asset — decided in Phase 2, WebP preferred).
- Shot list (one hero shot per family + 1–2 secondary): retail POS grid + inventory intelligence; grocery PLU pad; restaurant floor plan + KDS; salon calendar; dental chart + treatment plan; gym class timetable + member check-in kiosk; wholesale AR aging + field-rep PWA (mobile); rentals contract timeline; hotel rooms board + folio; repair ticket board; photography project + client gallery; portal + public booking (shared).

## 11. Performance budget

- Every marketing page is its own lazy chunk under `publicRoutes.jsx` (same pattern as today); shared `MarketingLayout` chunk; **zero new npm dependencies**.
- App bundle and login path untouched — additions are new lazy routes only; deleting 9 variant routes actually removes ~9 chunks.
- Images: local WebP, explicit width/height (no CLS), `loading="lazy"` below the fold, hero preloaded. No external requests (Unsplash hotlinks gone; fonts already self-hosted).
- Verification gate (Phase 2): every page checked at 1440px + 390px via preview tools; console clean; meta present; `npm run build` chunk report compared before/after.

## 12. Phase 2 build order

1. Branch `feat/marketing-site` off main.
2. Seed + screenshot scripts → capture assets (local tenants).
3. `MarketingLayout` + `Seo` + tokens → `HomePage` → `IndustryPage` template + 10 content entries → `PricingPage` → `WhySanoPosPage` → `IndustriesIndexPage`.
4. Rewire `HomeRedirect`; delete 10 dead files + 9 preview routes; update `index.html` base meta.
5. Prerender script + sitemap/robots; wire into build.
6. Verify: all pages desktop+mobile, signup+login E2E locally, build-size diff, no console errors.
7. Commit in coherent chunks; push **branch only**; report with screenshots of every page.

## 13. Decisions I need from you (then I build)

1. **Approve IA + copy deck + design direction** (or mark edits inline in COPY-DECK.md).
2. **Starter rows**: filter-only (a) or also deactivate in prod DB (b)?
3. **Demo CTA address**: `demo@sanopos.com` (needs Cloudflare routing rule) or direct `sanomerchandise@gmail.com`?
4. **OG images**: default-only at launch, or per-family variants (adds a design chore)?
5. Confirm prerender approach (§7.2) — build-time static shells + sitemap/robots.
