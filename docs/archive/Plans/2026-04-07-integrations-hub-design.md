# Integrations Hub — Design Document

**Date:** 2026-04-07
**Status:** Approved
**Scope:** 5 marketplace/channel integrations + 12 new courier adapters + unified UI

---

## 1. Overview

Build a unified Integrations Hub that lets tenants self-service connect to marketplaces, social commerce channels, and couriers using their own API credentials (BYOK — Bring Your Own Key).

### What We're Building

| Category | Integrations | Count |
|----------|-------------|-------|
| **Marketplaces** | Daraz | 1 |
| **Storefronts** | Shopify (existing), WooCommerce (existing) | 2 (no work) |
| **Social Commerce** | Facebook Shop, Instagram Shopping (same Meta API) | 1 integration |
| **Messaging** | WhatsApp Business API | 1 |
| **Product Feeds** | Google Merchant Center | 1 |
| **Couriers** | TCS, BlueEx, Trax/Sonic, CallCourier, M&P, PostEx, Rider, Swyft, Bykea, Pakistan Post, DHL, FedEx | 12 new |
| **Couriers (existing)** | Leopards | 1 (no work) |

**Total new integrations:** 5 channels + 12 couriers = 17

---

## 2. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Credential model | Per-tenant BYOK | Zero liability, tenant signs up with each service directly |
| Sync depth | Level B — product push + order pull + inventory sync | Matches current Shopify level, ship fast, add fulfillment pushback later |
| Credential storage | `integration_settings` table with AES-256-GCM encryption | Reuse existing table + Shopify crypto module |
| Product/order mappings | Per-marketplace tables | Different ID formats per platform |
| Frontend UI | Unified Integrations Hub (`/settings/integrations`) | One page, categorized tabs, discover & manage all connections |
| Feature gating | Single `marketplace_integrations` flag + credential-based activation | Tenant self-gates by connecting or not |
| Courier depth | Ship & Track (book, track, cancel) | COD reconciliation deferred to future phase |
| Webhooks | Day one where platform supports, polling fallback | Proven pattern from Shopify/xPay webhooks |

---

## 3. Architecture

### 3.1 Backend Structure

```
backend/
├── routes/
│   ├── integrations/              # NEW — unified integration hub API
│   │   ├── index.js               # Router aggregator + dependency injection
│   │   ├── hub.js                 # GET /api/integrations/hub (all connection statuses)
│   │   ├── daraz.js               # Daraz: OAuth, product sync, order pull
│   │   ├── facebook.js            # Meta Commerce: FB Shop + Instagram Shopping
│   │   ├── whatsapp.js            # WhatsApp Business: messaging, order intake
│   │   ├── google-merchant.js     # Google Merchant: product feed push
│   │   └── credentials.js         # Generic connect/disconnect/test for all providers
│   ├── webhooks.js                # EXTEND — add /api/webhooks/daraz, /meta, /whatsapp
│   ├── shopify/                   # EXISTING — no changes, linked from hub
│   ├── woocommerce.js             # EXISTING — no changes, linked from hub
│   └── couriers.js                # EXISTING — no changes needed
├── services/
│   ├── crypto.js                  # GENERALIZED — rename from shopify/crypto.js
│   │                              #   encryptSecret(value) / decryptSecret(value)
│   │                              #   env var: INTEGRATION_SECRET_KEY (falls back to SHOPIFY_SECRET_KEY)
│   ├── couriers/
│   │   ├── base-adapter.js        # EXISTING — no changes
│   │   ├── index.js               # EXTEND — register 12 new adapters
│   │   ├── leopards-adapter.js    # EXISTING
│   │   ├── tcs-adapter.js         # NEW
│   │   ├── blueex-adapter.js      # NEW
│   │   ├── trax-adapter.js        # NEW
│   │   ├── callcourier-adapter.js # NEW
│   │   ├── mnp-adapter.js         # NEW
│   │   ├── postex-adapter.js      # NEW
│   │   ├── rider-adapter.js       # NEW
│   │   ├── swyft-adapter.js       # NEW
│   │   ├── bykea-adapter.js       # NEW
│   │   ├── pakpost-adapter.js     # NEW
│   │   ├── dhl-adapter.js         # NEW
│   │   └── fedex-adapter.js       # NEW
│   └── marketplace/               # NEW — marketplace client adapters
│       ├── base-marketplace.js    # Base class: connect, syncProducts, pullOrders, pushInventory
│       ├── daraz-client.js        # Lazada Open Platform API client
│       ├── meta-commerce.js       # Meta Commerce API (FB Shop + Instagram)
│       ├── whatsapp-client.js     # WhatsApp Business API client
│       └── google-merchant.js     # Google Content API client
├── schemas/
│   └── integrations.js            # NEW — Zod schemas for all integration endpoints
└── workers/
    └── marketplace-sync-worker-boss.js  # NEW — pg-boss worker for periodic order/inventory sync
```

### 3.2 Frontend Structure

```
frontend/src/
├── pages/redesign/
│   └── IntegrationsHubRedesign.jsx    # NEW — unified hub page
│       ├── Tab: Marketplaces          # Daraz, Shopify, WooCommerce
│       ├── Tab: Social Commerce       # Facebook Shop, Instagram Shopping
│       ├── Tab: Messaging             # WhatsApp Business
│       ├── Tab: Product Feeds         # Google Merchant Center
│       └── Tab: Couriers              # All 13 couriers (existing page content)
├── routes/
│   └── appRoutes.jsx                  # ADD /settings/integrations route
└── ui/
    └── nav-config.js                  # ADD Integrations Hub nav entry under Settings
```

### 3.3 Database Schema Changes (Migration v17)

```sql
-- ── Extend integration_settings with encryption + more fields ──

ALTER TABLE integration_settings
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'marketplace',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS oauth_token TEXT,          -- encrypted
  ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,  -- encrypted
  ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,       -- encrypted
  ADD COLUMN IF NOT EXISTS config_json TEXT DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN DEFAULT false;

-- Drop UNIQUE on provider (allow multiple connections per provider if needed)
-- Actually keep UNIQUE — one connection per marketplace per tenant is fine for now

-- ── Daraz Mapping Tables ──

CREATE TABLE IF NOT EXISTS daraz_product_map (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  daraz_item_id TEXT NOT NULL,
  daraz_sku TEXT,
  last_synced_at TIMESTAMPTZ,
  UNIQUE(daraz_item_id)
);

CREATE TABLE IF NOT EXISTS daraz_order_map (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id) ON DELETE CASCADE,
  daraz_order_id TEXT NOT NULL UNIQUE,
  daraz_order_number TEXT,
  daraz_status TEXT,
  last_synced_at TIMESTAMPTZ
);

-- ── Facebook/Instagram Mapping Tables ──

CREATE TABLE IF NOT EXISTS facebook_product_map (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  fb_product_id TEXT NOT NULL,
  fb_catalog_id TEXT,
  ig_product_id TEXT,
  last_synced_at TIMESTAMPTZ,
  UNIQUE(fb_product_id)
);

CREATE TABLE IF NOT EXISTS facebook_order_map (
  id SERIAL PRIMARY KEY,
  web_order_id INTEGER REFERENCES web_orders(id) ON DELETE CASCADE,
  fb_order_id TEXT NOT NULL UNIQUE,
  source TEXT DEFAULT 'facebook',  -- 'facebook' or 'instagram'
  fb_status TEXT,
  last_synced_at TIMESTAMPTZ
);

-- ── WhatsApp Conversations ──

CREATE TABLE IF NOT EXISTS whatsapp_conversations (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  wa_conversation_id TEXT,
  phone_number TEXT NOT NULL,
  last_message_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',  -- active, closed
  web_order_id INTEGER REFERENCES web_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,  -- 'inbound' or 'outbound'
  message_type TEXT DEFAULT 'text',  -- text, image, order, template
  content TEXT,
  wa_message_id TEXT UNIQUE,
  status TEXT DEFAULT 'sent',  -- sent, delivered, read, failed
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── Google Merchant Feed Log ──

CREATE TABLE IF NOT EXISTS google_merchant_feed_log (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  gmc_offer_id TEXT,
  feed_status TEXT DEFAULT 'pending',  -- pending, approved, disapproved, warning
  disapproval_reason TEXT,
  last_pushed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ
);

-- ── Indexes ──

CREATE INDEX IF NOT EXISTS idx_daraz_product_map_product ON daraz_product_map(product_id);
CREATE INDEX IF NOT EXISTS idx_daraz_order_map_web_order ON daraz_order_map(web_order_id);
CREATE INDEX IF NOT EXISTS idx_facebook_product_map_product ON facebook_product_map(product_id);
CREATE INDEX IF NOT EXISTS idx_facebook_order_map_web_order ON facebook_order_map(web_order_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_customer ON whatsapp_conversations(customer_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_phone ON whatsapp_conversations(phone_number);
CREATE INDEX IF NOT EXISTS idx_google_merchant_feed_product ON google_merchant_feed_log(product_id);
```

### 3.4 Courier Adapter Seeds (add to courier_integrations)

```sql
-- Add missing couriers to pre-seeded list
INSERT INTO courier_integrations (name, adapter_key, tracking_url_template) VALUES
  ('Pakistan Post', 'pakpost', 'https://ep.gov.pk/track/{tracking}'),
  ('DHL Express', 'dhl', 'https://www.dhl.com/pk-en/home/tracking.html?tracking-id={tracking}'),
  ('FedEx', 'fedex', 'https://www.fedex.com/fedextrack/?trknbr={tracking}')
ON CONFLICT DO NOTHING;
```

---

## 4. Integration Details

### 4.1 Daraz (Lazada Open Platform API)

| Aspect | Detail |
|--------|--------|
| Auth | OAuth 2.0 — tenant gets App Key + App Secret from Daraz Seller Center |
| Base URL | `https://api.daraz.pk/rest` |
| Product sync | Push catalog via `/products/create`, `/products/update` |
| Order pull | `GET /orders/get` + `/orders/items/get` |
| Inventory sync | `POST /products/stocks/update` (SKU-based) |
| Webhooks | Push notifications for order status changes |
| Webhook endpoint | `POST /api/webhooks/daraz` (signature-verified) |

### 4.2 Facebook Shop + Instagram Shopping (Meta Commerce API)

| Aspect | Detail |
|--------|--------|
| Auth | OAuth 2.0 via Facebook Login — tenant connects FB Page + Catalog |
| API | Meta Commerce API (Graph API v19+) |
| Product sync | Push to FB Catalog via Catalog Batch API |
| Order pull | Commerce Orders API (`GET /{commerce_account}/orders`) |
| Instagram | Same catalog — products synced to FB automatically appear on IG Shopping |
| Webhooks | Webhook subscriptions for order updates |
| Webhook endpoint | `POST /api/webhooks/meta` (signature-verified with App Secret) |

### 4.3 WhatsApp Business API

| Aspect | Detail |
|--------|--------|
| Auth | Via BSP (Twilio, 360dialog, or Meta Cloud API directly) |
| API | WhatsApp Business Cloud API |
| Capabilities | Receive orders via message, send order confirmations, tracking updates |
| Webhook endpoint | `POST /api/webhooks/whatsapp` (signature-verified) |
| Cost note | Tenant pays Meta per-conversation (~$0.01-0.05/msg) |
| UI warning | Banner in settings: "WhatsApp Business has per-message costs billed by Meta" |

### 4.4 Google Merchant Center (Content API for Shopping)

| Aspect | Detail |
|--------|--------|
| Auth | OAuth 2.0 via Google — tenant connects Google account |
| API | Content API for Shopping v2.1 |
| Product sync | Push product feed via `products.insert` / `products.update` |
| Order pull | N/A — Google Merchant doesn't process orders directly |
| Webhooks | N/A — pull-based, periodic feed status check |
| Sync worker | Background job checks feed approval status every 6 hours |

### 4.5 Courier Adapters (12 new)

Each adapter extends `BaseCourierAdapter` and implements:

```javascript
class TCSAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options) → { tracking_number, label_url, ... }
  async getTracking(trackingNumber) → { status, events[] }
  async cancelShipment(trackingNumber) → { success, message? }
}
```

| Courier | API Style | Webhook Support |
|---------|-----------|-----------------|
| TCS | REST | Polling only |
| BlueEx | REST | Webhook callback |
| Trax/Sonic | REST | Webhook callback |
| CallCourier | REST/SOAP | Polling only |
| M&P Express | REST | Polling only |
| PostEx | REST | Webhook callback |
| Rider | REST | Webhook callback |
| Swyft | REST | Webhook callback |
| Bykea | REST | Polling only |
| Pakistan Post | REST (limited) | Polling only |
| DHL | REST (DHL Express API) | Webhook callback |
| FedEx | REST (FedEx API) | Webhook callback |

---

## 5. Unified Integrations Hub UI

### Layout

```
/settings/integrations
┌─────────────────────────────────────────────────────────┐
│ Integrations Hub                                         │
├──────────┬──────────────┬──────────┬──────────┬─────────┤
│ All (17) │ Marketplaces │ Social   │ Messaging│ Couriers│
│          │ & Stores (3) │ Commerce │ (1)      │ (13)    │
│          │              │ (1)      │          │         │
├──────────┴──────────────┴──────────┴──────────┴─────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ 🟢 Shopify   │  │ 🟢 WooCom.  │  │ ⚪ Daraz     │   │
│  │ Connected    │  │ Connected    │  │ Not Connected│   │
│  │ [Manage]     │  │ [Manage]     │  │ [Connect]    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │ ⚪ FB Shop   │  │ ⚪ WhatsApp  │                     │
│  │ Not Connected│  │ Not Connected│                     │
│  │ [Connect]    │  │ [Connect]    │                     │
│  └──────────────┘  └──────────────┘                     │
│                                                          │
│  Couriers  ─────────────────────────────────────────     │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ...          │
│  │ TCS │ │BlueX│ │Trax │ │Leop.│ │M&P  │              │
│  │ ⚪  │ │ ⚪  │ │ ⚪  │ │ 🟢  │ │ ⚪  │              │
│  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘              │
└─────────────────────────────────────────────────────────┘
```

### Integration Card States
- **Not Connected** (gray) — shows "Connect" button
- **Connected** (green) — shows last sync time, "Manage" button, "Disconnect" option
- **Error** (red) — shows error message, "Reconnect" / "Test Connection" button
- **Syncing** (blue pulse) — shows sync progress

### Connect Flow (per integration)
1. Tenant clicks "Connect" on a card
2. Modal opens with:
   - Integration description + link to get API credentials
   - Input fields for API key / secret / store URL (varies per integration)
   - "Test Connection" button
3. On successful test → save encrypted credentials → card turns green
4. For OAuth integrations (Daraz, Facebook, Google) → redirect to platform's OAuth consent page → callback saves tokens

---

## 6. Security

- All API keys/secrets/tokens encrypted with AES-256-GCM before storage
- Generalized crypto module (`services/crypto.js`) extracted from `shopify/crypto.js`
- Environment variable: `INTEGRATION_SECRET_KEY` (falls back to `SHOPIFY_SECRET_KEY` for backward compat)
- Webhook endpoints verify signatures (HMAC-SHA256 for Daraz, App Secret for Meta, etc.)
- Webhook routes mounted BEFORE tenant middleware (same as Shopify/xPay pattern)
- OAuth tokens auto-refreshed when expired (refresh token stored encrypted)
- WhatsApp cost warning displayed prominently before connection

---

## 7. Sync Architecture

### Event-Driven (reuse existing `external_sync_events` table)

```
Outbound (POS → Marketplace):
  Product created/updated → external_sync_events(direction='outbound', entity_type='product')
  Stock changed (sale/return/adjustment) → external_sync_events(direction='outbound', entity_type='inventory')

Inbound (Marketplace → POS):
  Webhook received → external_sync_events(direction='inbound', entity_type='order')
  Polling job finds new order → same

Worker processes events:
  pending → processed (success) or failed → retry (up to 4 attempts, exponential backoff)
```

### Background Worker

Single `marketplace-sync-worker-boss.js` (pg-boss backed) handles:
- Processing pending `external_sync_events` for all integrations
- Periodic polling for integrations without webhooks (every 5-10 min)
- Google Merchant feed status checks (every 6 hours)
- OAuth token refresh for expiring tokens

---

## 8. Build Phases

### Phase 1: Daraz + TCS + BlueEx + Trax/Sonic
- Generalize crypto module
- Extend `integration_settings` table (migration v17)
- Build Daraz client + routes + mapping tables
- Build 3 courier adapters (TCS, BlueEx, Trax)
- Build Integrations Hub UI (foundation)
- Add `marketplace_integrations` feature flag

### Phase 2: Facebook/Instagram Shop + CallCourier + M&P + PostEx
- Build Meta Commerce client (covers both FB + IG)
- Build 3 courier adapters
- Extend hub UI with Social Commerce tab

### Phase 3: WhatsApp Business + Rider + Swyft + Bykea
- Build WhatsApp Business client
- Build 3 courier adapters
- Extend hub UI with Messaging tab
- Add cost warning banner for WhatsApp

### Phase 4: Google Merchant Center + Pakistan Post + DHL + FedEx
- Build Google Merchant client
- Build 3 courier adapters (including international)
- Extend hub UI with Product Feeds tab
- Add feed status monitoring

### Phase 5 (Future): Enhancements
- Fulfillment status pushback to all marketplaces
- COD reconciliation for couriers
- Multi-channel inventory reservation
- Aggregated cross-channel analytics

---

## 9. What Tenants Need to Do

| Integration | Tenant Action |
|-------------|--------------|
| Daraz | Register on Daraz Seller Center → create app → get App Key + App Secret |
| Facebook Shop | Have a Facebook Page + Business Manager → authorize SanoPOS app |
| Instagram Shopping | Same as Facebook (one Meta integration covers both) |
| WhatsApp Business | Register WhatsApp Business account via BSP or Meta Cloud API → get API token |
| Google Merchant | Have a Google Merchant Center account → authorize SanoPOS app |
| Couriers (all) | Sign up with courier → get API key/secret from their developer portal |

---

## 10. Files Changed (Summary)

### New Files (~25)
- `backend/routes/integrations/` — 6 files (index, hub, daraz, facebook, whatsapp, google-merchant, credentials)
- `backend/services/marketplace/` — 5 files (base, daraz, meta, whatsapp, google)
- `backend/services/crypto.js` — 1 file (generalized from shopify)
- `backend/services/couriers/*-adapter.js` — 12 files
- `backend/schemas/integrations.js` — 1 file
- `backend/workers/marketplace-sync-worker-boss.js` — 1 file
- `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx` — 1 file

### Modified Files (~8)
- `backend/schema-pg.sql` — new tables + seeds
- `backend/migrate-pg.js` — migration v17
- `backend/routes/registerAllRoutes.js` — mount new routes
- `backend/services/couriers/index.js` — register new adapters
- `backend/routes/webhooks.js` — add daraz/meta/whatsapp endpoints
- `backend/boot/workers.js` — start marketplace sync worker
- `backend/middleware/feature-flags.js` — add `marketplace_integrations` flag
- `frontend/src/routes/appRoutes.jsx` — add hub route
- `frontend/src/ui/nav-config.js` — add nav entry
