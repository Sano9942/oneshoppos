# 11 — Growth & consumer surface

**Covers:** growth surface — where the comparison doc's headline Square gaps cluster: website/storefront, marketing automations, review collection, payment links, wallet passes, AI cataloging — plus the marketplace-integration wiring that's supposed to power multichannel growth. Mostly P1 (build/extend), unlike the wiring-first plans.
**Modes/flags in scope:** `marketing_campaigns` (default true), `sms_campaigns`/`phase5_sms_providers` (seeded retail/restaurant), `marketplace_integrations` (default true), `payment_links` (default **false**, seeded false — `migrate-pg.js:1845`), `ai_insights` (dead — fixed in plan 00)
**Surfaces touched:** storefront · customer portal · admin · marketplace webhooks · email/SMS delivery
**Branch strategy:** new consumer-facing screens are exactly where the `redesign/square` collision bites. Recommendation: P0/wiring fixes off `main`; defer any *new* storefront/website-builder UI until the redesign merges, or build it directly on `redesign/square` if execution starts after the redesign is approved — decide at execution kickoff, per-feature.

---

## Call-path map + verification checklist

| Flow | Screen / component | API call | Route → service | "Wired correctly = …" | Status |
|---|---|---|---|---|---|
| Storefront browse → cart → checkout | `pages/storefront/` (`/store/:tenantSlug`) | `storefront.js` (pre-tenant-middleware) | `storefront-cart.js` → `quote.js` → `reservation.js`/`allocation.js` | anonymous cart; visibility+MOQ enforced; order lands in `web_orders` + inbox | ☐ |
| Order status / arrive | `StorefrontOrderStatus` | `POST /api/storefront/orders/:token/arrive` | `storefront.js` | pickup arrive flow updates order | ☐ |
| Product reviews | storefront PDP + `ReviewModerationRedesign` | `POST /api/products/:id/reviews` (public, `reviewLimiter`) → `GET/PUT/DELETE /api/reviews*` | `products.js:1584-1735` | submit → pending → moderate → avg_rating recalc → approved shows on PDP | ☐ |
| Email campaign | `MarketingCampaignsRedesign` | `/api/marketing/*` | `services/marketing.js` (`resolveAudience`, `enqueueCampaignSend`) | audience filters resolve; send enqueues per-recipient email jobs | ☐ |
| SMS campaign | same + provider config | `/api/integrations/:provider/send-test-sms` | `services/sms.js` adapters | provider configured → test SMS → campaign channel works | ☐ |
| Messaging inbox | `MessagingInboxRedesign` | `/api/messaging` | `services/messaging.js` | WhatsApp inbound → thread; reply outbound; unread counts | ☐ |
| Integrations hub | `IntegrationsHubRedesign` | `GET /api/integrations/hub`, `POST /api/integrations/{connect,disconnect,test}` | `integrations/index.js` (mounts router at `/api/integrations` — `index.js:22`) → `hub.js`, `credentials.js` | statuses aggregate; connect stores AES-GCM creds; note `/test` is DB-only, never calls the live API | ☐ |
| Daraz/Meta/Google sync | hub per-channel pages | `integrations/{daraz,facebook,google-merchant}.js` | `services/marketplace/*` | manual product sync / order pull works per adapter | ☐ |
| Marketplace webhooks | — | `POST /api/webhooks/{daraz,meta,whatsapp}` (pre-tenant-middleware, **not signature-verified** except xpay) | `webhooks.js` | inbound order/message lands; dead-letter on failure | ☐ |
| Background marketplace sync | (worker) | — | `marketplace-sync-worker-boss.js` | **currently a stub — see D1** | ☐ |
| Payment link on invoice | `CustomerInvoicesRedesign` | `POST /api/customer-invoices/:id/payment-link` (`customer-invoices.js:348`, flag `payment_links`) | gateway | link → hosted checkout → webhook marks paid (SanoPay sandbox per [[sanopay_sandbox]]) | ☐ |
| Shopify / WooCommerce | dedicated pages | `shopify/*`, `woocommerce.js` | — | connect → import → stock sync → order webhook (HMAC) round-trips | ☐ |

## Defects (P0) — confirmed broken wiring

- **Marketplace background sync is decorative** — `workers/marketplace-sync-worker-boss.js:63,69,107` contain literal comments "Actual polling would call DarazClient.pullOrders here" / "MetaCommerceClient.pullOrders here" / "GoogleMerchantClient.checkFeedStatus here": the 10-min order-poll and 6-h feed-check jobs schedule, log, and heartbeat but never call the adapters. Tenants connecting Daraz/Meta/Google get *manual* sync only while the admin worker-status dashboard shows the worker green. · surfaces: marketplace channels, admin monitoring · fix sketch: wire the three client calls inside `withTenantContext()`, or stop scheduling the jobs and mark the hub "manual sync" honestly.

*(Comparison-doc correction logged while auditing: "Product reviews ❌" in §6 is wrong — a full review pipeline exists: public submit `products.js:1607`, moderation queue/approve/delete `products.js:1661-1735`, storefront display `storefront.js:254-328`, admin page `ReviewModerationRedesign`. The real gap is Google Reviews collection, a separate row. Update the comparison doc during execution.)*

## Feature-parity gaps (P1)
> Ranked per comparison doc §11.

- **Website builder** — ❌ §6 (themes, custom domain, SEO): biggest structural gap; current `storefront.js` is headless · reuse: storefront API as the data layer; theme = config-driven layout on the existing `/store/:slug` page before attempting a real builder. Large — needs its own design pass (pause-list: new capability).
- **Marketing automations** — ❌ §8 (welcome/birthday/win-back/abandoned-cart) · reuse: `marketing.js` audience filters already include `birth_month`, `last_purchase_days` — an automation = saved audience + trigger schedule on pg-boss + existing campaign send. Medium effort, highest retention value.
- **Standalone payment links / buy-buttons / QR** — 🟡 §7 · reuse: generalize `customer-invoices.js:348` link generation into "charge for anything" (amount + description, no invoice required). Also flip the `payment_links` seed story (default false today — see 00 P2).
- **Google Reviews collection** — ❌ §8: post-sale review-request email/SMS with review link · reuse: receipt email hook + campaign infra. Low effort.
- **Apple/Google Wallet loyalty passes** — ❌ §8: `.pkpass` on existing loyalty ledger · low-medium.
- **Abandoned-cart recovery** — ❌ §6: `storefront_carts` table already has timestamps/expiry · reuse: cleanup-worker pattern + email template. Fold into marketing automations.
- **AI catalog tooling** — ❌ §3: item descriptions/photos via `ANTHROPIC_API_KEY` · reuse: `insights-ai.js` client plumbing. Medium.
- **Receipt feedback capture** — ❌ §8: rating link on public receipt page → feeds review pipeline (which exists). Low.

## Polish & consistency (P2)
- Marketplace webhook signature verification (Meta/WhatsApp/Daraz POST handlers rate-limited but unverified) — security-adjacent: **pause-list, propose don't implement**.
- Hub `/test` endpoint is DB-only — label it "saved" not "connection verified", or make it call the adapter's `testConnection()`.
- `google_merchant` (DB key) vs `/google-merchant/` (URL) naming trap — add a comment/constant.

## Confirm during execution
- Whether any real tenant has marketplace credentials configured (Supabase read-only check) before prioritizing D1.
- WhatsApp campaign channel: `whatsapp-client.js` sync methods are intentional no-ops — confirm campaign send path uses `sendTemplate` and not the no-op surface.
- Storefront currency uses `config.currency_symbol || "Rs"` not `useCurrency` — consistent with tenant currency setting?

## Cross-surface lens (mandatory)
- **Stock** → storefront reservation/allocation vs POS decrement (01 owns).
- **Pricing/tax** → storefront `quote.js` vs POS (01 owns; P13 regression class).
- **Email/SMS** → campaigns share `email_queue` + SMS adapters with transactional sends — a campaign burst must not starve receipts/password resets (queue priority check).
- **Payments** → payment links share gateway webhook routing with billing/rooms/treatments intents.

## Verification bar (execution)
- Test tenant: `general_retail` with storefront enabled + SanoPay sandbox ([[sanopay_sandbox]]).
- Walkthrough: storefront browse→cart→checkout→order in inbox; review submit→moderate→display; campaign to 2-customer audience delivers; payment link paid via sandbox webhook; hub connect/disconnect round-trip.
- Done = checklist ☑ + D1 fixed (or explicitly descoped to "manual sync" honestly) + P1s that get approved built one at a time.
