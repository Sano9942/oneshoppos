# SanoPOS Retail Completeness Check - 2026-04-23

This file is the **current coverage-verification layer** for the retail truth set.

It answers a stricter question than the surface map or capability matrix:

- did the retail docs actually cover the live repo surfaces that matter?
- where were they understated, missing, or too loosely framed?
- which nearby surfaces were inspected and then intentionally excluded?

Use together with:
- [docs/sanopos-retail-surface-map.md](../sanopos-retail-surface-map.md) for inventory
- [docs/sanopos-retail-capability-matrix.md](../sanopos-retail-capability-matrix.md) for claim wording and maturity
- [docs/audits/sanopos-retail-gap-audit-2026-04-23.md](sanopos-retail-gap-audit-2026-04-23.md) for the historical "what the old report missed" explanation

## Scope and Method

**Scope**
- All 6 retail presets: `general_retail`, `grocery`, `wholesale`, `butcher`, `sweet_shop`, `textile`
- Retail-adjacent merchant operations and customer-facing surfaces that materially affect a retail tenant
- Nearby internal/platform/admin surfaces inspected when they shape the retail operating picture
- Mode-gated non-retail modules explicitly recorded as exclusions when encountered

**Evidence rules**
- Static-only pass
- No `CLAUDE.md` files used as evidence
- No broad test reruns; existing test files are used as proof references only

**Live source registries used**
- Frontend routes: [frontend/src/routes/appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx), [frontend/src/routes/publicRoutes.jsx](../../frontend/src/routes/publicRoutes.jsx), [frontend/src/routes/adminRoutes.jsx](../../frontend/src/routes/adminRoutes.jsx)
- Frontend navigation: [frontend/src/ui/nav-config.js](../../frontend/src/ui/nav-config.js)
- Backend mount graph: [backend/routes/registerAllRoutes.js](../../backend/routes/registerAllRoutes.js), [backend/routes/admin/index.js](../../backend/routes/admin/index.js), [backend/routes/tier4/index.js](../../backend/routes/tier4/index.js)
- Retail classification inputs: [backend/config/industry-config.js](../../backend/config/industry-config.js), [backend/config/mode-registry.js](../../backend/config/mode-registry.js), [backend/middleware/feature-flags.js](../../backend/middleware/feature-flags.js)
- Supporting inventory and proof: [backend/workers/](../../backend/workers/), [backend/migrate-pg.js](../../backend/migrate-pg.js), [frontend/tests/](../../frontend/tests/)

## Headline Verification

These counts were rechecked directly from the repo using the same patterns the docs claim:

| Surface | Verified count | Verification basis |
|---|---:|---|
| Retail presets | 6 | [backend/config/industry-config.js](../../backend/config/industry-config.js) |
| Redesign pages | 97 | `frontend/src/pages/redesign/*Redesign.jsx` |
| Top-level backend route files | 89 | `backend/routes/*.js` |
| Worker boss files | 18 | `backend/workers/*-boss.js` |
| Frontend test files | 68 | `frontend/tests/**/*.spec.js|*.test.js|*.test.jsx` |
| Default feature flags | 84 | `DEFAULT_FEATURE_FLAGS` in [backend/middleware/feature-flags.js](../../backend/middleware/feature-flags.js) |
| Current migration marker | v76 | `version: 76` in [backend/migrate-pg.js](../../backend/migrate-pg.js) |

**Result**
- The headline counts in the retail docs held up.
- The remaining work was not re-counting the big pillars; it was closing long-tail coverage gaps around public routes, hidden route entry points, and nearby engagement/portal surfaces.

## Coverage Ledger

`Pre-sync coverage` describes how the 2026-04-23 retail docs looked before this completeness check and sync.

| Surface | Source | Pre-sync coverage | Verdict | Reason | Doc action |
|---|---|---|---|---|---|
| Retail presets, headline counts, and retail-mode boundaries | [industry-config.js](../../backend/config/industry-config.js), [mode-registry.js](../../backend/config/mode-registry.js), [feature-flags.js](../../backend/middleware/feature-flags.js) | Surface map + matrix | covered correctly | The retail preset set, counts, and non-retail mode exclusions matched live code | Kept as the baseline and re-cross-linked from all 4 docs |
| Core POS, returns, shifts, pricing, inventory, reports, omnichannel, FBR, billing, support, and admin breadth | Route registries plus existing map/matrix evidence trails | Surface map + matrix | covered correctly | The main retail operating picture was already present and materially accurate | No structural rewrite needed; only targeted corrections |
| Public storefront pages under `/store/:tenantSlug/*` | [publicRoutes.jsx](../../frontend/src/routes/publicRoutes.jsx), [frontend/src/pages/storefront/](../../frontend/src/pages/storefront/), [backend/routes/storefront.js](../../backend/routes/storefront.js) | Matrix only; surface-map frontend treatment was thin | covered but understated | Storefront capability existed in the matrix, but the public page layer was not explicit enough in inventory | Added public/customer-facing surfaces to the surface map |
| Retail portal shell and preset-aware retail tabs | [publicRoutes.jsx](../../frontend/src/routes/publicRoutes.jsx), [frontend/src/pages/portal/PortalLayout.jsx](../../frontend/src/pages/portal/PortalLayout.jsx), [backend/routes/customer-portal/data.js](../../backend/routes/customer-portal/data.js), [industry-config.js](../../backend/config/industry-config.js) | Folder-level mention only | covered but understated | The docs mentioned the portal, but not the fact that retail presets only expose a retail-relevant subset of tabs | Clarified portal tab scope in the surface map and kept the matrix row bounded to retail follow-through |
| Standalone report deep-links | [frontend/src/routes/appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx), [frontend/src/pages/ReportsRoute.jsx](../../frontend/src/pages/ReportsRoute.jsx) | Reports capability present, deep-link layer not called out | covered but understated | Hidden/non-sidebar report entry points were real surfaces even though they reuse the reports shell | Added deep-link note to the surface map |
| Public gift-card balance lookup | [frontend/src/pages/GiftCardBalancePage.jsx](../../frontend/src/pages/GiftCardBalancePage.jsx), [backend/routes/gift-cards-public.js](../../backend/routes/gift-cards-public.js) | Backend route mentioned; frontend public page absent | covered but understated | The customer-facing balance check existed, but the docs treated gift cards mostly as an admin/POS surface | Added the public lookup page to the matrix and to the inventory framing |
| Customer invoicing backend route and gate shape | [backend/routes/customer-invoices.js](../../backend/routes/customer-invoices.js), [frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx](../../frontend/src/pages/redesign/CustomerInvoicesRedesign.jsx) | Capability row present, backend inventory omitted, gate labeled `plan/tier` | covered but understated | The feature is real, but the route inventory and gate label were off | Added `customer-invoices.js` to the surface map and corrected the matrix gate to `feature-flag` |
| Notifications route ownership and gate | [backend/routes/tier4/notifications.js](../../backend/routes/tier4/notifications.js), [backend/routes/barcode-expenses.js](../../backend/routes/barcode-expenses.js), [frontend/src/pages/redesign/NotificationsRedesign.jsx](../../frontend/src/pages/redesign/NotificationsRedesign.jsx) | Capability row present, gate labeled `plan/tier` | covered but understated | Notifications are feature-flagged, and their route ownership is split across two live modules | Corrected the matrix gate and kept the split ownership visible |
| Review moderation and product-review control | [frontend/src/pages/redesign/ReviewModerationRedesign.jsx](../../frontend/src/pages/redesign/ReviewModerationRedesign.jsx), review endpoints inside [backend/routes/products.js](../../backend/routes/products.js) | Not documented in retail inventory | missing | A real retail-adjacent storefront quality-control surface lived inside shared product/storefront code and was missed | Added it to the surface map inventory, but kept it out of the top-tier capability matrix |
| Public receipt page and receipt API | [frontend/src/pages/ReceiptPublicPage.jsx](../../frontend/src/pages/ReceiptPublicPage.jsx), [backend/routes/receipts.js](../../backend/routes/receipts.js), [frontend/tests/public-pages.spec.js](../../frontend/tests/public-pages.spec.js) | Backend route only; no explicit capability row | missing | Shareable digital receipt behavior is a real customer-facing retail surface, not just a helper behind printing | Added it into the receipt capability row and the public/customer-facing inventory |
| Marketing campaigns | [frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx](../../frontend/src/pages/redesign/MarketingCampaignsRedesign.jsx), [backend/routes/marketing.js](../../backend/routes/marketing.js), [frontend/tests/smoke/marketing-messaging.smoke.spec.js](../../frontend/tests/smoke/marketing-messaging.smoke.spec.js) | Surface-map frontend page only; backend route and claim layer missing | missing | The repo has full route/UI/test evidence for campaign creation, audience preview, and scheduling | Added backend inventory coverage and a bounded capability row |
| Messaging inbox | [frontend/src/pages/redesign/MessagingInboxRedesign.jsx](../../frontend/src/pages/redesign/MessagingInboxRedesign.jsx), [backend/routes/messaging.js](../../backend/routes/messaging.js), [frontend/tests/smoke/marketing-messaging.smoke.spec.js](../../frontend/tests/smoke/marketing-messaging.smoke.spec.js) | Surface-map frontend page only; backend route and claim layer missing | missing | Customer-thread inbox behavior is live and materially part of merchant follow-up operations | Added backend inventory coverage and a bounded capability row |
| AI insights, offline continuity, kiosk foundations, and scheduling maturity bounds | Existing matrix rows plus [frontend/tests/smoke/workforce.smoke.spec.js](../../frontend/tests/smoke/workforce.smoke.spec.js) and related code paths | Matrix already bounded | covered correctly | The current wording already keeps these from being oversold under static-only evidence | Left bounded wording in place |
| Super-admin oversight and support operations | [frontend/src/routes/adminRoutes.jsx](../../frontend/src/routes/adminRoutes.jsx), [backend/routes/admin/](../../backend/routes/admin/) | Surface map + matrix | covered correctly | Admin breadth was intentionally included and correctly framed as internal-only platform breadth | No claim expansion needed |
| Restaurant mode routes and shells | [appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx), [nav-config.js](../../frontend/src/ui/nav-config.js), [mode-registry.js](../../backend/config/mode-registry.js), [backend/routes/restaurant.js](../../backend/routes/restaurant.js) | Out-of-scope section | excluded after verification | These surfaces are real, but they are mode-gated non-retail modules | Kept excluded from retail claims |
| Appointments, projects/contracts, rentals, rooms, and treatment plans | [appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx), [mode-registry.js](../../backend/config/mode-registry.js), related route modules | Out-of-scope section | excluded after verification | These are adjacent verticals, not retail capability claims | Kept excluded from retail claims |
| Non-retail portal tabs: appointments, subscriptions, contracts, stays, treatments, tickets | [industry-config.js](../../backend/config/industry-config.js), [backend/routes/customer-portal/data.js](../../backend/routes/customer-portal/data.js), [frontend/src/pages/portal/](../../frontend/src/pages/portal/) | Portal mentioned at folder level without tab split | excluded after verification | They share the same portal shell, but they are preset-gated non-retail tabs | Clarified the retail-tab subset and kept the rest excluded |
| Public booking, reservation, restaurant menu, and pay-at-table pages | [publicRoutes.jsx](../../frontend/src/routes/publicRoutes.jsx), [backend/routes/public-bookings.js](../../backend/routes/public-bookings.js), [backend/routes/public-reservations.js](../../backend/routes/public-reservations.js), [backend/routes/public-restaurant.js](../../backend/routes/public-restaurant.js) | Not promoted into retail docs | excluded after verification | These are live public routes, but they belong to restaurant/appointments breadth rather than retail truth | Left out of retail claims |
| Subscriptions mode routes and membership flows | [appRoutes.jsx](../../frontend/src/routes/appRoutes.jsx), [nav-config.js](../../frontend/src/ui/nav-config.js), [mode-registry.js](../../backend/config/mode-registry.js) | Not promoted into retail docs | excluded after verification | Subscription billing exists nearby in the repo but remains a separate mode, not part of the retail preset set | Left out of retail claims |

## Sync Applied

This completeness pass resulted in these documentation changes:

- Added this file as the verification layer
- Updated [docs/sanopos-retail-surface-map.md](../sanopos-retail-surface-map.md) to explicitly include:
  - public/customer-facing retail surfaces
  - report deep-links
  - missing backend routes for `customer-invoices`, `marketing`, and `messaging`
  - `ReviewModerationRedesign`
  - explicit non-retail portal-tab exclusions
- Updated [docs/sanopos-retail-capability-matrix.md](../sanopos-retail-capability-matrix.md) to:
  - correct gate labels where live code disagreed with prior wording
  - add public receipt behavior to the receipt capability
  - add customer-facing gift-card lookup to the gift-card capability
  - add a bounded capability row for marketing + messaging follow-up
- Updated [docs/audits/sanopos-retail-gap-audit-2026-04-23.md](sanopos-retail-gap-audit-2026-04-23.md) so it remains the historical correction layer while this file becomes the current verification source

## Conclusions

- The existing retail docs were structurally strong on the main retail pillars.
- The biggest remaining weaknesses were not core POS/inventory/reporting omissions; they were long-tail coverage gaps around public/customer-facing routes, engagement tooling, and precise gate framing.
- No major retail pillar was found to be wholly fabricated or wrongly included.
- Static-only evidence supports **high structural confidence**, but not a claim that every workflow has been end-to-end executed.

## Confidence Limits

- This was a static verification pass, not a live execution audit.
- Existing tests improve confidence where present, but do not prove full production readiness by themselves.
- Hidden behaviors can still exist inside shared modules or unexercised code branches, especially where a shared route file carries both retail and non-retail logic.
- Future refreshes should update all 4 layers together: surface map, capability matrix, historical gap audit, and this completeness check.
