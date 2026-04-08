# Integrations Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified Integrations Hub with 5 marketplace/channel integrations + 12 courier adapters, all using per-tenant BYOK credentials.

**Architecture:** Extend existing `integration_settings` table with encryption for marketplace credentials. Each marketplace gets its own product/order mapping tables. Courier adapters follow the proven `BaseCourierAdapter` pattern from `services/couriers/`. Single `marketplace_integrations` feature flag gates the hub; individual integrations activate when tenant enters credentials. Unified frontend hub at `/settings/integrations`.

**Tech Stack:** Node.js/Express routes, AES-256-GCM encryption (generalized from `shopify/crypto.js`), pg-boss background worker, Zod validation, React + Tailwind hub UI.

**Design Doc:** `docs/plans/2026-04-07-integrations-hub-design.md`

---

## Phase 1: Foundation + Daraz + TCS + BlueEx + Trax

### Task 1: Generalize Crypto Module

**Files:**
- Create: `backend/services/crypto.js`
- Modify: `backend/routes/shopify/config.js` (update imports)
- Modify: `backend/shopify/crypto.js` (re-export from new module)

**Step 1: Create `backend/services/crypto.js`**

Extract and generalize from `backend/shopify/crypto.js`. The new module should:
- Read env var `INTEGRATION_SECRET_KEY`, fall back to `SHOPIFY_SECRET_KEY`
- Export `encryptSecret(plainText)` and `decryptSecret(storedText)`
- Same AES-256-GCM algorithm, same `enc:v1:` prefix format
- Export `maskSecret(value)` that shows last 4 chars only

```javascript
const crypto = require("crypto");

const ENC_PREFIX = "enc:v1";

function getKeyBuffer() {
  const raw = String(process.env.INTEGRATION_SECRET_KEY || process.env.SHOPIFY_SECRET_KEY || "").trim();
  if (!raw) throw new Error("INTEGRATION_SECRET_KEY or SHOPIFY_SECRET_KEY env var required");
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
  } catch {}
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function encryptSecret(plainText) {
  if (!plainText) return null;
  const value = String(plainText).trim();
  if (!value) return null;
  if (value.startsWith(ENC_PREFIX + ":")) return value; // already encrypted
  const key = getKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(storedText) {
  if (!storedText) return null;
  const stored = String(storedText).trim();
  if (!stored.startsWith(ENC_PREFIX + ":")) return stored; // plaintext fallback
  const key = getKeyBuffer();
  const parts = stored.split(":");
  if (parts.length < 5) throw new Error("Invalid encrypted format");
  const iv = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  const encrypted = Buffer.from(parts[4], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function maskSecret(value) {
  if (!value) return null;
  const plain = value.startsWith(ENC_PREFIX + ":") ? "••••" : String(value);
  if (plain.length <= 4) return "••••";
  return "••••" + plain.slice(-4);
}

module.exports = { encryptSecret, decryptSecret, maskSecret };
```

**Step 2: Update `backend/shopify/crypto.js` to delegate**

Keep existing exports for backward compat but delegate to the new module:

```javascript
const { encryptSecret, decryptSecret } = require("../services/crypto");

// Keep original function names for existing Shopify code
function encryptShopifySecret(plainText) { return encryptSecret(plainText); }
function decryptShopifySecret(storedText) { return decryptSecret(storedText); }

// ... keep logShopifyEvent as-is (Shopify-specific) ...

module.exports = { encryptShopifySecret, decryptShopifySecret, logShopifyEvent };
```

**Step 3: Run existing Shopify tests to verify no regression**

Run: `npx jest backend/tests/integration/pg-batch6-shopify.test.js`
Expected: All tests pass (crypto still works via delegation)

**Step 4: Commit**

```bash
git add backend/services/crypto.js backend/shopify/crypto.js
git commit -m "refactor: generalize crypto module for all integrations"
```

---

### Task 2: Database Migration v17 — Integration Tables

**Files:**
- Modify: `backend/migrate-pg.js` (add migration v17)
- Modify: `backend/schema-pg.sql` (add new tables + ALTER integration_settings + new courier seeds)

**Step 1: Add migration v17 to `backend/migrate-pg.js`**

Add to the MIGRATIONS array (after v16):

```javascript
{
  version: 17,
  description: "integrations hub — extend integration_settings, add marketplace mapping tables, seed new couriers",
  up: async (client) => {
    // Extend integration_settings
    await client.query(`
      ALTER TABLE integration_settings
        ADD COLUMN IF NOT EXISTS display_name TEXT,
        ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'marketplace',
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS oauth_token TEXT,
        ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,
        ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
        ADD COLUMN IF NOT EXISTS config_json TEXT DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS last_error TEXT,
        ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN DEFAULT false
    `);

    // Daraz mapping tables
    await client.query(`
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
    `);

    // Facebook/Instagram mapping tables
    await client.query(`
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
        source TEXT DEFAULT 'facebook',
        fb_status TEXT,
        last_synced_at TIMESTAMPTZ
      );
    `);

    // WhatsApp tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_conversations (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        wa_conversation_id TEXT,
        phone_number TEXT NOT NULL,
        last_message_at TIMESTAMPTZ,
        status TEXT DEFAULT 'active',
        web_order_id INTEGER REFERENCES web_orders(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        message_type TEXT DEFAULT 'text',
        content TEXT,
        wa_message_id TEXT UNIQUE,
        status TEXT DEFAULT 'sent',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Google Merchant feed log
    await client.query(`
      CREATE TABLE IF NOT EXISTS google_merchant_feed_log (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        gmc_offer_id TEXT,
        feed_status TEXT DEFAULT 'pending',
        disapproval_reason TEXT,
        last_pushed_at TIMESTAMPTZ,
        last_checked_at TIMESTAMPTZ
      );
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_daraz_product_map_product ON daraz_product_map(product_id);
      CREATE INDEX IF NOT EXISTS idx_daraz_order_map_web_order ON daraz_order_map(web_order_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_product_map_product ON facebook_product_map(product_id);
      CREATE INDEX IF NOT EXISTS idx_facebook_order_map_web_order ON facebook_order_map(web_order_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_customer ON whatsapp_conversations(customer_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_phone ON whatsapp_conversations(phone_number);
      CREATE INDEX IF NOT EXISTS idx_google_merchant_feed_product ON google_merchant_feed_log(product_id);
    `);

    // Seed new couriers
    await client.query(`
      INSERT INTO courier_integrations (name, adapter_key, tracking_url_template) VALUES
        ('Pakistan Post', 'pakpost', 'https://ep.gov.pk/track/{tracking}'),
        ('DHL Express', 'dhl', 'https://www.dhl.com/pk-en/home/tracking.html?tracking-id={tracking}'),
        ('FedEx', 'fedex', 'https://www.fedex.com/fedextrack/?trknbr={tracking}')
      ON CONFLICT DO NOTHING
    `);
  },
},
```

**Step 2: Update `backend/schema-pg.sql`**

Add the new tables after the existing `integration_settings` table definition (around line 1387). Add the ALTER columns to the `integration_settings` CREATE TABLE definition. Add the 3 new courier seeds to the existing `INSERT INTO courier_integrations` block.

**Step 3: Commit**

```bash
git add backend/migrate-pg.js backend/schema-pg.sql
git commit -m "feat: migration v17 — integrations hub tables + new courier seeds"
```

---

### Task 3: Feature Flag — `marketplace_integrations`

**Files:**
- Modify: `backend/middleware/feature-flags.js` (add flag to defaults)

**Step 1: Add flag to `DEFAULT_FEATURE_FLAGS`**

In `backend/middleware/feature-flags.js`, add to the DEFAULT_FEATURE_FLAGS object (around line 47, before the closing `}`):

```javascript
  marketplace_integrations: true,
```

**Step 2: Commit**

```bash
git add backend/middleware/feature-flags.js
git commit -m "feat: add marketplace_integrations feature flag"
```

---

### Task 4: Integration Hub API — Credentials + Hub Status

**Files:**
- Create: `backend/routes/integrations/index.js`
- Create: `backend/routes/integrations/hub.js`
- Create: `backend/routes/integrations/credentials.js`
- Create: `backend/schemas/integrations.js`
- Modify: `backend/routes/registerAllRoutes.js` (mount new routes)

**Step 1: Create Zod schemas — `backend/schemas/integrations.js`**

```javascript
const { z } = require("zod");

const connectProviderSchema = z.object({
  provider: z.string().min(1),
  store_url: z.string().url().optional(),
  api_key: z.string().min(1).optional(),
  api_secret: z.string().min(1).optional(),
  oauth_token: z.string().min(1).optional(),
  oauth_refresh_token: z.string().optional(),
  config_json: z.string().optional(),
});

const disconnectProviderSchema = z.object({
  provider: z.string().min(1),
});

module.exports = { connectProviderSchema, disconnectProviderSchema };
```

**Step 2: Create hub status endpoint — `backend/routes/integrations/hub.js`**

This returns the status of all integrations for the tenant's hub UI:

```javascript
module.exports = function registerHubRoutes(router, deps) {
  const { db, requirePerm, requireFeature, decryptSecret, maskSecret } = deps;

  // GET /api/integrations/hub — all integration statuses
  router.get(
    "/hub",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        // Marketplace/channel integrations
        const { rows: integrations } = await db.query(
          "SELECT provider, display_name, category, is_active, last_sync_at, last_error, sync_enabled FROM integration_settings ORDER BY provider"
        );

        // Courier integrations
        const { rows: couriers } = await db.query(
          "SELECT id, name, adapter_key, enabled, api_key FROM courier_integrations ORDER BY name"
        );

        // Shopify connection
        const { rows: shopifyRows } = await db.query(
          "SELECT id, shop_domain, is_active, last_sync_at, last_error FROM shopify_connections WHERE is_active = true LIMIT 1"
        );

        const channels = integrations.map((i) => ({
          ...i,
          has_credentials: !!i.is_active,
        }));

        const courierList = couriers.map((c) => ({
          id: c.id,
          name: c.name,
          adapter_key: c.adapter_key,
          enabled: c.enabled,
          has_credentials: !!c.api_key,
        }));

        res.json({
          channels,
          couriers: courierList,
          shopify: shopifyRows[0] || null,
          woocommerce: integrations.find((i) => i.provider === "woocommerce") || null,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
```

**Step 3: Create credentials management — `backend/routes/integrations/credentials.js`**

Generic connect/disconnect/test for marketplace integrations:

```javascript
module.exports = function registerCredentialRoutes(router, deps) {
  const { db, requirePerm, requireFeature, encryptSecret, decryptSecret, maskSecret } = deps;
  const { validate } = deps;
  const { connectProviderSchema, disconnectProviderSchema } = require("../../schemas/integrations");

  // POST /api/integrations/connect — save encrypted credentials
  router.post(
    "/connect",
    requirePerm("all_access"),
    requireFeature("marketplace_integrations"),
    validate(connectProviderSchema),
    async (req, res) => {
      try {
        const { provider, store_url, api_key, api_secret, oauth_token, oauth_refresh_token, config_json } = req.body;

        const encKey = api_key ? encryptSecret(api_key) : null;
        const encSecret = api_secret ? encryptSecret(api_secret) : null;
        const encOauth = oauth_token ? encryptSecret(oauth_token) : null;
        const encRefresh = oauth_refresh_token ? encryptSecret(oauth_refresh_token) : null;

        await db.query(
          `INSERT INTO integration_settings (provider, store_url, api_key, api_secret, oauth_token, oauth_refresh_token, config_json, is_active, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
           ON CONFLICT (provider) DO UPDATE SET
             store_url = COALESCE(EXCLUDED.store_url, integration_settings.store_url),
             api_key = COALESCE(EXCLUDED.api_key, integration_settings.api_key),
             api_secret = COALESCE(EXCLUDED.api_secret, integration_settings.api_secret),
             oauth_token = COALESCE(EXCLUDED.oauth_token, integration_settings.oauth_token),
             oauth_refresh_token = COALESCE(EXCLUDED.oauth_refresh_token, integration_settings.oauth_refresh_token),
             config_json = COALESCE(EXCLUDED.config_json, integration_settings.config_json),
             is_active = true,
             last_error = NULL,
             updated_at = NOW()`,
          [provider, store_url || null, encKey, encSecret, encOauth, encRefresh, config_json || "{}"]
        );

        res.json({ connected: true, provider });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/disconnect — remove credentials
  router.post(
    "/disconnect",
    requirePerm("all_access"),
    requireFeature("marketplace_integrations"),
    validate(disconnectProviderSchema),
    async (req, res) => {
      try {
        const { provider } = req.body;
        await db.query(
          "UPDATE integration_settings SET is_active = false, api_key = NULL, api_secret = NULL, oauth_token = NULL, oauth_refresh_token = NULL, updated_at = NOW() WHERE provider = $1",
          [provider]
        );
        res.json({ disconnected: true, provider });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/test — test connection for a provider
  router.post(
    "/test",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const { provider } = req.body;
        const { rows: [config] } = await db.query(
          "SELECT * FROM integration_settings WHERE provider = $1",
          [provider]
        );
        if (!config) return res.status(404).json({ error: "Integration not configured" });

        // Decrypt credentials for testing
        const apiKey = config.api_key ? decryptSecret(config.api_key) : null;
        const apiSecret = config.api_secret ? decryptSecret(config.api_secret) : null;

        // Provider-specific test logic will be added per integration
        // For now, just verify credentials exist
        if (!apiKey && !config.oauth_token) {
          return res.json({ success: false, error: "No credentials configured" });
        }

        res.json({ success: true, provider });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // GET /api/integrations/:provider/status — get masked credentials + status
  router.get(
    "/:provider/status",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const { provider } = req.params;
        const { rows: [config] } = await db.query(
          "SELECT provider, display_name, category, store_url, is_active, last_sync_at, last_error, sync_enabled, api_key, config_json FROM integration_settings WHERE provider = $1",
          [provider]
        );
        if (!config) return res.json({ connected: false, provider });

        res.json({
          connected: config.is_active,
          provider: config.provider,
          display_name: config.display_name,
          store_url: config.store_url,
          api_key_masked: maskSecret(config.api_key),
          last_sync_at: config.last_sync_at,
          last_error: config.last_error,
          sync_enabled: config.sync_enabled,
          config: config.config_json ? JSON.parse(config.config_json) : {},
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
```

**Step 4: Create router aggregator — `backend/routes/integrations/index.js`**

```javascript
const { Router } = require("express");

module.exports = function mountIntegrationRoutes(app, deps) {
  const router = Router();

  const { encryptSecret, decryptSecret, maskSecret } = require("../../services/crypto");
  const { validate } = deps;

  const integrationDeps = {
    ...deps,
    encryptSecret,
    decryptSecret,
    maskSecret,
    validate,
  };

  require("./hub")(router, integrationDeps);
  require("./credentials")(router, integrationDeps);

  app.use("/api/integrations", router);
};
```

**Step 5: Mount in `backend/routes/registerAllRoutes.js`**

Add after the existing Shopify/WooCommerce/Courier mount lines (around line 504):

```javascript
require("./integrations")(app, deps);
```

**Step 6: Commit**

```bash
git add backend/routes/integrations/ backend/schemas/integrations.js backend/routes/registerAllRoutes.js
git commit -m "feat: integrations hub API — hub status + credential management"
```

---

### Task 5: TCS Courier Adapter

**Files:**
- Create: `backend/services/couriers/tcs-adapter.js`
- Modify: `backend/services/couriers/index.js` (register adapter)

**Step 1: Create `backend/services/couriers/tcs-adapter.js`**

Reference: `backend/services/couriers/leopards-adapter.js` for pattern.

TCS API: REST-based, `POST` to book shipment, `GET` to track. Credentials: `api_key` (client ID) + `api_secret` (client secret). Base URL varies by environment.

```javascript
const BaseCourierAdapter = require("./base-adapter");

class TCSAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://apis.tcscourier.com";
    const url = `${baseUrl}/production/v1/cod/create-order`;

    const payload = {
      userName: this.config.api_key,
      password: this.config.api_secret,
      costCenterCode: this.config.config_json?.cost_center || "",
      consigneeName: receiver.name,
      consigneeAddress: receiver.address,
      consigneeMobNo: receiver.phone,
      consigneeCityName: receiver.city,
      weight: options.weight || 0.5,
      pieces: options.pieces || 1,
      codAmount: options.cod_amount || 0,
      customerReferenceNo: String(order.id),
      services: options.cod_amount > 0 ? "COD" : "O",
      productDetails: `Order #${order.id}`,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`TCS API error: ${res.status}`);
    const data = await res.json();

    if (data.returnStatus?.status === "FAIL") {
      throw new Error(data.returnStatus?.message || "TCS booking failed");
    }

    return {
      tracking_number: data.bookingReply?.consignmentNo || null,
      label_url: data.bookingReply?.labelUrl || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://apis.tcscourier.com";
    const url = `${baseUrl}/production/v1/track?consignmentNo=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: {
        "X-IBM-Client-Id": this.config.api_key,
      },
    });

    if (!res.ok) throw new Error(`TCS tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.trackingDetail?.currentStatus || "unknown",
      events: (data.trackingDetail?.trackingEvents || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.dateTime,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    return { success: false, message: "Contact TCS support to cancel shipments" };
  }
}

module.exports = TCSAdapter;
```

**Step 2: Register in `backend/services/couriers/index.js`**

Add to imports and ADAPTERS map:

```javascript
const TCSAdapter = require("./tcs-adapter");

const ADAPTERS = {
  generic: GenericAdapter,
  leopards: LeopardsAdapter,
  tcs: TCSAdapter,
};
```

**Step 3: Commit**

```bash
git add backend/services/couriers/tcs-adapter.js backend/services/couriers/index.js
git commit -m "feat: add TCS courier adapter"
```

---

### Task 6: BlueEx Courier Adapter

**Files:**
- Create: `backend/services/couriers/blueex-adapter.js`
- Modify: `backend/services/couriers/index.js` (register)

**Step 1: Create `backend/services/couriers/blueex-adapter.js`**

BlueEx API: REST-based. Credentials: `api_key` (trader ID) + `api_secret` (token).

```javascript
const BaseCourierAdapter = require("./base-adapter");

class BlueExAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://bilogia.blue-ex.com/api";
    const url = `${baseUrl}/logistic/order/add`;

    const payload = {
      trader_id: this.config.api_key,
      customer_name: receiver.name,
      customer_address: receiver.address,
      customer_phone: receiver.phone,
      customer_city: receiver.city,
      weight: options.weight || 0.5,
      product_value: options.cod_amount || 0,
      shipping_type: options.cod_amount > 0 ? "COD" : "Prepaid",
      item_description: `Order #${order.id}`,
      reference_no: String(order.id),
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.api_secret}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`BlueEx API error: ${res.status}`);
    const data = await res.json();

    if (data.status === "error") {
      throw new Error(data.message || "BlueEx booking failed");
    }

    return {
      tracking_number: data.cn_number || data.tracking_number || null,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://bilogia.blue-ex.com/api";
    const url = `${baseUrl}/logistic/tracking/${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.config.api_secret}` },
    });

    if (!res.ok) throw new Error(`BlueEx tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.current_status || "unknown",
      events: (data.tracking_history || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.date,
        description: e.remarks,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://bilogia.blue-ex.com/api";
    const url = `${baseUrl}/logistic/order/cancel`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.api_secret}`,
        },
        body: JSON.stringify({ cn_number: trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `BlueEx cancel error: ${res.status}` };
      const data = await res.json();
      return { success: data.status === "success", message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = BlueExAdapter;
```

**Step 2: Register in `backend/services/couriers/index.js`**

Add import and entry:

```javascript
const BlueExAdapter = require("./blueex-adapter");
// Add to ADAPTERS: blueex: BlueExAdapter,
```

**Step 3: Commit**

```bash
git add backend/services/couriers/blueex-adapter.js backend/services/couriers/index.js
git commit -m "feat: add BlueEx courier adapter"
```

---

### Task 7: Trax/Sonic Courier Adapter

**Files:**
- Create: `backend/services/couriers/trax-adapter.js`
- Modify: `backend/services/couriers/index.js` (register)

**Step 1: Create `backend/services/couriers/trax-adapter.js`**

Trax (now Sonic) API: REST-based. Credentials: `api_key` (auth token).

```javascript
const BaseCourierAdapter = require("./base-adapter");

class TraxAdapter extends BaseCourierAdapter {
  async bookShipment(order, sender, receiver, options = {}) {
    const baseUrl = this.config.api_base_url || "https://sonic.pk/api";
    const url = `${baseUrl}/shipment/book`;

    const payload = {
      consignee_name: receiver.name,
      consignee_address: receiver.address,
      consignee_phone: receiver.phone,
      consignee_city: receiver.city,
      weight: options.weight || 0.5,
      pieces: options.pieces || 1,
      cod_amount: options.cod_amount || 0,
      order_id: String(order.id),
      service_type: options.cod_amount > 0 ? "COD" : "Non COD",
      item_description: `Order #${order.id}`,
      shipper_name: sender.name,
      shipper_phone: sender.phone,
      shipper_address: sender.address,
      shipper_city: sender.city,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.config.api_key,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`Trax API error: ${res.status}`);
    const data = await res.json();

    if (!data.tracking_number) {
      throw new Error(data.message || data.error || "Trax booking failed");
    }

    return {
      tracking_number: data.tracking_number,
      label_url: data.label_url || null,
      raw: data,
    };
  }

  async getTracking(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://sonic.pk/api";
    const url = `${baseUrl}/shipment/track?tracking_number=${encodeURIComponent(trackingNumber)}`;

    const res = await fetch(url, {
      headers: { Authorization: this.config.api_key },
    });

    if (!res.ok) throw new Error(`Trax tracking error: ${res.status}`);
    const data = await res.json();

    return {
      status: data.status || "unknown",
      events: (data.tracking_history || []).map((e) => ({
        status: e.status,
        location: e.location,
        timestamp: e.date_time,
        description: e.description,
      })),
    };
  }

  async cancelShipment(trackingNumber) {
    const baseUrl = this.config.api_base_url || "https://sonic.pk/api";
    const url = `${baseUrl}/shipment/cancel`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.config.api_key,
        },
        body: JSON.stringify({ tracking_number: trackingNumber }),
      });

      if (!res.ok) return { success: false, message: `Trax cancel error: ${res.status}` };
      const data = await res.json();
      return { success: !!data.success, message: data.message };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }
}

module.exports = TraxAdapter;
```

**Step 2: Register in `backend/services/couriers/index.js`**

Add import and entry:

```javascript
const TraxAdapter = require("./trax-adapter");
// Add to ADAPTERS: trax: TraxAdapter,
```

**Step 3: Commit**

```bash
git add backend/services/couriers/trax-adapter.js backend/services/couriers/index.js
git commit -m "feat: add Trax/Sonic courier adapter"
```

---

### Task 8: Daraz Marketplace Client

**Files:**
- Create: `backend/services/marketplace/base-marketplace.js`
- Create: `backend/services/marketplace/daraz-client.js`

**Step 1: Create base marketplace class — `backend/services/marketplace/base-marketplace.js`**

```javascript
class BaseMarketplace {
  constructor(config) {
    this.config = config;
  }

  async testConnection() {
    throw new Error("Not implemented");
  }

  async syncProducts(products) {
    // Push local products to marketplace
    throw new Error("Not implemented");
  }

  async pullOrders(since) {
    // Pull new orders from marketplace
    throw new Error("Not implemented");
  }

  async pushInventory(updates) {
    // Push stock level changes
    throw new Error("Not implemented");
  }
}

module.exports = BaseMarketplace;
```

**Step 2: Create Daraz client — `backend/services/marketplace/daraz-client.js`**

Daraz uses the Lazada Open Platform (LOP) API. All requests are signed with HMAC-SHA256.

```javascript
const crypto = require("crypto");
const BaseMarketplace = require("./base-marketplace");

class DarazClient extends BaseMarketplace {
  constructor(config) {
    super(config);
    this.baseUrl = config.store_url || "https://api.daraz.pk/rest";
    this.appKey = config.api_key;
    this.appSecret = config.api_secret;
    this.accessToken = config.oauth_token;
  }

  // Lazada Open Platform signature
  _sign(apiPath, params) {
    const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
    const signStr = apiPath + sorted;
    return crypto.createHmac("sha256", this.appSecret).update(signStr).digest("hex").toUpperCase();
  }

  async _request(apiPath, params = {}) {
    const commonParams = {
      app_key: this.appKey,
      timestamp: Date.now(),
      sign_method: "sha256",
      access_token: this.accessToken || "",
      ...params,
    };
    commonParams.sign = this._sign(apiPath, commonParams);

    const qs = Object.entries(commonParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const url = `${this.baseUrl}${apiPath}?${qs}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Daraz API error: ${res.status}`);
    const data = await res.json();

    if (data.code && data.code !== "0") {
      throw new Error(data.message || `Daraz error: ${data.code}`);
    }
    return data;
  }

  async testConnection() {
    try {
      const data = await this._request("/seller/get");
      return { success: true, seller: data.data?.name || "Connected" };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async pullOrders(since) {
    const params = {
      created_after: since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      sort_by: "created_at",
      sort_direction: "ASC",
      limit: 100,
      offset: 0,
    };

    const data = await this._request("/orders/get", params);
    const orders = data.data?.orders || [];

    // Get order items for each order
    const results = [];
    for (const order of orders) {
      const itemData = await this._request("/order/items/get", { order_id: order.order_id });
      results.push({
        external_order_id: String(order.order_id),
        external_order_number: order.order_number,
        status: order.statuses?.[0] || "pending",
        customer: {
          name: `${order.address_shipping?.first_name || ""} ${order.address_shipping?.last_name || ""}`.trim(),
          phone: order.address_shipping?.phone,
          address: order.address_shipping?.address1,
          city: order.address_shipping?.city,
        },
        items: (itemData.data || []).map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: Number(item.quantity || 1),
          price: Number(item.item_price || 0),
          daraz_item_id: String(item.order_item_id),
        })),
        total: Number(order.price || 0),
        payment_method: order.payment_method,
        created_at: order.created_at,
      });
    }

    return results;
  }

  async syncProducts(products) {
    // Daraz uses XML payload for product creation
    const results = [];
    for (const product of products) {
      try {
        const payload = JSON.stringify({
          Request: {
            Product: {
              PrimaryCategory: product.category_id || 1,
              SPUId: "",
              AssociatedSku: "",
              Skus: {
                Sku: [{
                  SellerSku: product.sku || product.barcode || `SP-${product.id}`,
                  quantity: product.stock || 0,
                  price: product.price,
                  special_price: product.sale_price || product.price,
                  package_weight: product.weight || "0.5",
                  package_length: "10",
                  package_width: "10",
                  package_height: "10",
                }],
              },
              Attributes: {
                name: product.name,
                description: product.description || product.name,
                brand: product.brand || "Unbranded",
              },
            },
          },
        });

        const data = await this._request("/product/create", { payload });
        results.push({ product_id: product.id, success: true, daraz_item_id: data.data?.item_id });
      } catch (err) {
        results.push({ product_id: product.id, success: false, error: err.message });
      }
    }
    return results;
  }

  async pushInventory(updates) {
    // updates: [{ sku, quantity }]
    const skuPayload = updates.map((u) => ({
      SellerSku: u.sku,
      Quantity: u.quantity,
    }));

    const payload = JSON.stringify({
      Request: { Product: { Skus: { Sku: skuPayload } } },
    });

    return this._request("/product/stock/sellable/update", { payload });
  }
}

module.exports = DarazClient;
```

**Step 3: Commit**

```bash
git add backend/services/marketplace/
git commit -m "feat: add base marketplace class + Daraz API client"
```

---

### Task 9: Daraz Integration Routes

**Files:**
- Create: `backend/routes/integrations/daraz.js`
- Modify: `backend/routes/integrations/index.js` (register)
- Modify: `backend/routes/webhooks.js` (add Daraz webhook)

**Step 1: Create `backend/routes/integrations/daraz.js`**

```javascript
module.exports = function registerDarazRoutes(router, deps) {
  const { db, requirePerm, requireFeature, decryptSecret } = deps;
  const DarazClient = require("../../services/marketplace/daraz-client");

  async function getDarazClient() {
    const { rows: [config] } = await db.query(
      "SELECT * FROM integration_settings WHERE provider = 'daraz' AND is_active = true"
    );
    if (!config) throw new Error("Daraz not connected");
    return new DarazClient({
      api_key: decryptSecret(config.api_key),
      api_secret: decryptSecret(config.api_secret),
      oauth_token: config.oauth_token ? decryptSecret(config.oauth_token) : null,
      store_url: config.store_url,
    });
  }

  // POST /api/integrations/daraz/test — test Daraz connection
  router.post(
    "/daraz/test",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();
        const result = await client.testConnection();
        res.json(result);
      } catch (err) {
        res.json({ success: false, error: err.message });
      }
    }
  );

  // POST /api/integrations/daraz/sync-products — push products to Daraz
  router.post(
    "/daraz/sync-products",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();
        const { product_ids } = req.body || {};

        let whereClause = "WHERE is_active = true";
        const params = [];
        if (product_ids?.length) {
          whereClause += ` AND id = ANY($1)`;
          params.push(product_ids);
        }

        const { rows: products } = await db.query(
          `SELECT id, name, sku, barcode, price, description, stock FROM products ${whereClause} LIMIT 100`,
          params
        );

        const results = await client.syncProducts(products);

        // Save mappings for successful syncs
        for (const r of results.filter((r) => r.success && r.daraz_item_id)) {
          await db.query(
            `INSERT INTO daraz_product_map (product_id, daraz_item_id, last_synced_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (daraz_item_id) DO UPDATE SET last_synced_at = NOW()`,
            [r.product_id, r.daraz_item_id]
          );
        }

        res.json({
          synced: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
          details: results,
        });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/daraz/pull-orders — pull orders from Daraz
  router.post(
    "/daraz/pull-orders",
    requirePerm("manage_orders"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();
        const { since } = req.body || {};
        const orders = await client.pullOrders(since);

        let imported = 0;
        let skipped = 0;

        for (const order of orders) {
          // Check if already imported
          const { rows: existing } = await db.query(
            "SELECT id FROM daraz_order_map WHERE daraz_order_id = $1",
            [order.external_order_id]
          );
          if (existing.length > 0) { skipped++; continue; }

          // Create web_order
          const { rows: [webOrder] } = await db.query(
            `INSERT INTO web_orders (source, external_order_id, external_order_number, fulfillment_status, raw_payload, created_at)
             VALUES ('daraz', $1, $2, 'unfulfilled', $3, $4)
             RETURNING id`,
            [order.external_order_id, order.external_order_number, JSON.stringify(order), order.created_at || new Date()]
          );

          // Save mapping
          await db.query(
            `INSERT INTO daraz_order_map (web_order_id, daraz_order_id, daraz_order_number, daraz_status, last_synced_at)
             VALUES ($1, $2, $3, $4, NOW())`,
            [webOrder.id, order.external_order_id, order.external_order_number, order.status]
          );

          imported++;
        }

        // Update last_sync_at
        await db.query(
          "UPDATE integration_settings SET last_sync_at = NOW() WHERE provider = 'daraz'",
        );

        res.json({ imported, skipped, total: orders.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  // POST /api/integrations/daraz/push-inventory — sync stock levels to Daraz
  router.post(
    "/daraz/push-inventory",
    requirePerm("manage_inventory"),
    requireFeature("marketplace_integrations"),
    async (req, res) => {
      try {
        const client = await getDarazClient();

        // Get all mapped products with their current stock
        const { rows: mapped } = await db.query(
          `SELECT dpm.daraz_sku, p.stock, p.sku
           FROM daraz_product_map dpm
           JOIN products p ON p.id = dpm.product_id
           WHERE dpm.daraz_sku IS NOT NULL`
        );

        if (mapped.length === 0) return res.json({ updated: 0, message: "No mapped products" });

        const updates = mapped.map((m) => ({
          sku: m.daraz_sku || m.sku,
          quantity: m.stock || 0,
        }));

        await client.pushInventory(updates);

        res.json({ updated: updates.length });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );
};
```

**Step 2: Register in `backend/routes/integrations/index.js`**

Add after the credentials require:

```javascript
require("./daraz")(router, integrationDeps);
```

**Step 3: Add Daraz webhook to `backend/routes/webhooks.js`**

Add a new endpoint for Daraz push notifications. Daraz sends order status webhooks. Add after the existing xPay webhook:

```javascript
// POST /api/webhooks/daraz — Daraz order status push notifications
app.post("/api/webhooks/daraz", express.json(), async (req, res) => {
  try {
    const { trade_order_id, status, timestamp } = req.body || {};
    if (!trade_order_id) return res.status(400).json({ error: "Missing order ID" });

    // Log to external_sync_events for processing
    // Tenant is resolved from daraz_order_map
    console.log(`[Daraz Webhook] Order ${trade_order_id} status: ${status}`);

    res.json({ success: true });
  } catch (err) {
    console.error("[Daraz Webhook] Error:", err.message);
    res.status(500).json({ error: "Internal error" });
  }
});
```

**Step 4: Commit**

```bash
git add backend/routes/integrations/daraz.js backend/routes/integrations/index.js backend/routes/webhooks.js
git commit -m "feat: Daraz integration — product sync, order pull, inventory push, webhook"
```

---

### Task 10: Integrations Hub Frontend

**Files:**
- Create: `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`
- Modify: `frontend/src/routes/appRoutes.jsx` (add route)
- Modify: `frontend/src/ui/nav-config.js` (add nav entry)

**Step 1: Create `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`**

This is the unified integrations hub UI. It shows all available integrations in categorized tabs with connect/disconnect/test actions.

Key UI elements:
- Tab bar: All | Marketplaces & Stores | Social Commerce | Messaging | Product Feeds | Couriers
- Integration cards with status indicators (connected/disconnected/error)
- Connect modal with per-provider credential fields
- Test Connection button
- Last sync time display

The component should:
- Fetch hub status from `GET /api/integrations/hub`
- Show integration cards grouped by category
- Connect modal uses `POST /api/integrations/connect` with provider-specific fields
- Disconnect uses `POST /api/integrations/disconnect`
- Test uses `POST /api/integrations/test`
- Link to existing pages for Shopify (`/integrations/shopify`) and WooCommerce (`/integrations/woocommerce`)
- Embed courier settings inline (or link to `/courier-settings`)

Provider-specific credential fields:

| Provider | Fields |
|----------|--------|
| `daraz` | App Key, App Secret, Access Token (from Seller Center) |
| `facebook` | (OAuth — Connect with Facebook button) |
| `whatsapp` | API Token, Phone Number ID, Business Account ID |
| `google_merchant` | (OAuth — Connect with Google button) |

Build this as a standard Redesign page following existing patterns:
- Use `PageShell` from `ui/primitives.jsx`
- Use `api.get()` / `api.post()` from `api.js`
- Use `useToast()` for success/error notifications
- Use Tailwind v4 for styling
- Dark mode compatible (use CSS variables)

**This is a significant UI component. The implementing engineer should reference `CourierSettingsRedesign.jsx` and `ShopifyIntegrationRedesign.jsx` (via the Shopify route) as patterns for the connect/manage flow.**

**Step 2: Add route to `frontend/src/routes/appRoutes.jsx`**

Add lazy import at top:

```javascript
const IntegrationsHubRedesign = lazy(() => import("../pages/redesign/IntegrationsHubRedesign"));
```

Add route (near the other integration routes, around line 128):

```javascript
<Route path="/settings/integrations" element={perm("manage_inventory", <IntegrationsHubRedesign />)} />
```

**Step 3: Update `frontend/src/ui/nav-config.js`**

Replace the separate Shopify, WooCommerce, and Delivery Couriers entries with a single Integrations Hub entry. In the Setup group (around line 129):

Replace:
```javascript
{ name: "Shopify Integration", path: "/integrations/shopify", icon: Plug, requiredPerm: "manage_inventory" },
{ name: "WooCommerce", path: "/integrations/woocommerce", icon: ShoppingBag, requiredPerm: "manage_inventory" },
```
and
```javascript
{ name: "Delivery Couriers", path: "/courier-settings", icon: Truck, requiredPerm: "all_access" },
```

With:
```javascript
{ name: "Integrations", path: "/settings/integrations", icon: Plug, requiredPerm: "manage_inventory", requiredFlag: "marketplace_integrations" },
```

Keep the old routes working (don't remove them from appRoutes.jsx) — they'll be accessible from within the hub.

**Step 4: Commit**

```bash
git add frontend/src/pages/redesign/IntegrationsHubRedesign.jsx frontend/src/routes/appRoutes.jsx frontend/src/ui/nav-config.js
git commit -m "feat: Integrations Hub UI — unified page with all channels + couriers"
```

---

## Phase 2: Facebook/Instagram Shop + CallCourier + M&P + PostEx

### Task 11: Meta Commerce Client (Facebook Shop + Instagram Shopping)

**Files:**
- Create: `backend/services/marketplace/meta-commerce.js`

**Step 1: Create `backend/services/marketplace/meta-commerce.js`**

Meta Commerce API covers both Facebook Shop and Instagram Shopping via the same catalog and orders API. Uses OAuth 2.0 (Facebook Login).

```javascript
const BaseMarketplace = require("./base-marketplace");

class MetaCommerceClient extends BaseMarketplace {
  constructor(config) {
    super(config);
    this.accessToken = config.oauth_token;
    this.catalogId = config.config_json?.catalog_id;
    this.commerceAccountId = config.config_json?.commerce_account_id;
    this.baseUrl = "https://graph.facebook.com/v19.0";
  }

  async _request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}access_token=${this.accessToken}`;

    const opts = { method, headers: {} };
    if (body) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }

    const res = await fetch(fullUrl, opts);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Meta API error: ${res.status}`);
    }
    return res.json();
  }

  async testConnection() {
    try {
      const data = await this._request("/me?fields=id,name");
      return { success: true, name: data.name };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async syncProducts(products) {
    if (!this.catalogId) throw new Error("Catalog ID not configured");

    const results = [];
    for (const product of products) {
      try {
        const data = await this._request(`/${this.catalogId}/products`, "POST", {
          retailer_id: product.sku || product.barcode || `SP-${product.id}`,
          name: product.name,
          description: product.description || product.name,
          price: `${Math.round((product.price || 0) * 100)} PKR`,
          currency: "PKR",
          availability: (product.stock || 0) > 0 ? "in stock" : "out of stock",
          url: product.url || "",
          image_url: product.image_url || "",
          brand: product.brand || "",
        });
        results.push({ product_id: product.id, success: true, fb_product_id: data.id });
      } catch (err) {
        results.push({ product_id: product.id, success: false, error: err.message });
      }
    }
    return results;
  }

  async pullOrders(since) {
    if (!this.commerceAccountId) throw new Error("Commerce Account ID not configured");

    const sinceTs = since ? new Date(since).getTime() / 1000 : Date.now() / 1000 - 86400;
    const data = await this._request(
      `/${this.commerceAccountId}/orders?state=FB_PROCESSING&updated_after=${Math.floor(sinceTs)}&fields=id,order_status,created,channel,ship_by_date,items{id,product_name,quantity,price_per_unit,retailer_id}`
    );

    return (data.data || []).map((order) => ({
      external_order_id: order.id,
      external_order_number: order.id,
      status: order.order_status?.state || "pending",
      source: order.channel === "INSTAGRAM" ? "instagram" : "facebook",
      items: (order.items?.data || []).map((item) => ({
        name: item.product_name,
        quantity: Number(item.quantity || 1),
        price: Number(item.price_per_unit?.amount || 0) / 100,
        sku: item.retailer_id,
        fb_item_id: item.id,
      })),
      total: (order.items?.data || []).reduce((sum, i) => sum + (Number(i.price_per_unit?.amount || 0) / 100) * Number(i.quantity || 1), 0),
      created_at: order.created,
    }));
  }

  async pushInventory(updates) {
    if (!this.catalogId) throw new Error("Catalog ID not configured");

    const batch = updates.map((u) => ({
      method: "UPDATE",
      retailer_id: u.sku,
      data: { availability: u.quantity > 0 ? "in stock" : "out of stock", inventory: u.quantity },
    }));

    return this._request(`/${this.catalogId}/items_batch`, "POST", { requests: batch });
  }
}

module.exports = MetaCommerceClient;
```

**Step 2: Commit**

```bash
git add backend/services/marketplace/meta-commerce.js
git commit -m "feat: Meta Commerce client — Facebook Shop + Instagram Shopping"
```

---

### Task 12: Facebook/Instagram Integration Routes

**Files:**
- Create: `backend/routes/integrations/facebook.js`
- Modify: `backend/routes/integrations/index.js` (register)

**Step 1: Create `backend/routes/integrations/facebook.js`**

Follow the same pattern as `daraz.js` — test, sync-products, pull-orders, push-inventory. Use `MetaCommerceClient`. Save mappings to `facebook_product_map` and `facebook_order_map`. The `source` field in `facebook_order_map` distinguishes Facebook vs Instagram orders.

Key endpoints:
- `POST /api/integrations/facebook/test`
- `POST /api/integrations/facebook/sync-products`
- `POST /api/integrations/facebook/pull-orders`
- `POST /api/integrations/facebook/push-inventory`

**Step 2: Register in `backend/routes/integrations/index.js`**

```javascript
require("./facebook")(router, integrationDeps);
```

**Step 3: Add Meta webhook to `backend/routes/webhooks.js`**

```javascript
// POST /api/webhooks/meta — Facebook/Instagram order webhooks
// GET /api/webhooks/meta — webhook verification (hub.challenge)
```

**Step 4: Commit**

```bash
git add backend/routes/integrations/facebook.js backend/routes/integrations/index.js backend/routes/webhooks.js
git commit -m "feat: Facebook/Instagram Shop integration routes + webhook"
```

---

### Task 13: CallCourier Adapter

**Files:**
- Create: `backend/services/couriers/callcourier-adapter.js`
- Modify: `backend/services/couriers/index.js`

Follow Leopards adapter pattern. CallCourier API uses REST. Credentials: `api_key` (login ID) + `api_secret` (password). Key endpoints: book shipment, track, cancel.

**Commit:** `feat: add CallCourier adapter`

---

### Task 14: M&P Express Adapter

**Files:**
- Create: `backend/services/couriers/mnp-adapter.js`
- Modify: `backend/services/couriers/index.js`

Follow same pattern. M&P API REST-based. Credentials: `api_key` + `api_secret`.

**Commit:** `feat: add M&P Express courier adapter`

---

### Task 15: PostEx Adapter

**Files:**
- Create: `backend/services/couriers/postex-adapter.js`
- Modify: `backend/services/couriers/index.js`

PostEx has a modern REST API. Known for instant COD settlement. Credentials: `api_key` (token).

**Commit:** `feat: add PostEx courier adapter`

---

## Phase 3: WhatsApp Business + Rider + Swyft + Bykea

### Task 16: WhatsApp Business Client

**Files:**
- Create: `backend/services/marketplace/whatsapp-client.js`

WhatsApp Cloud API (Meta). Not a marketplace but a messaging/order channel. Capabilities:
- Receive messages (order intent)
- Send template messages (order confirmation, tracking updates)
- Catalog sharing

Credentials: `api_key` (permanent token), `config_json.phone_number_id`, `config_json.business_account_id`.

**Commit:** `feat: add WhatsApp Business API client`

---

### Task 17: WhatsApp Integration Routes

**Files:**
- Create: `backend/routes/integrations/whatsapp.js`
- Modify: `backend/routes/integrations/index.js`
- Modify: `backend/routes/webhooks.js` (add WhatsApp webhook)

Key endpoints:
- `POST /api/integrations/whatsapp/test` — verify token + phone number
- `POST /api/integrations/whatsapp/send-template` — send order confirmation / tracking update
- `GET /api/integrations/whatsapp/conversations` — list conversations
- `POST /api/webhooks/whatsapp` — receive messages
- `GET /api/webhooks/whatsapp` — webhook verification (hub.verify_token)

Save messages to `whatsapp_messages` table. Link conversations to customers via phone number match.

**Commit:** `feat: WhatsApp Business integration routes + webhook`

---

### Task 18: Rider Adapter

**Files:**
- Create: `backend/services/couriers/rider-adapter.js`
- Modify: `backend/services/couriers/index.js`

**Commit:** `feat: add Rider courier adapter`

---

### Task 19: Swyft Adapter

**Files:**
- Create: `backend/services/couriers/swyft-adapter.js`
- Modify: `backend/services/couriers/index.js`

**Commit:** `feat: add Swyft courier adapter`

---

### Task 20: Bykea Adapter

**Files:**
- Create: `backend/services/couriers/bykea-adapter.js`
- Modify: `backend/services/couriers/index.js`

Bykea is hyperlocal (within-city). May have limited API. If no public API, implement as GenericAdapter subclass with manual tracking entry.

**Commit:** `feat: add Bykea courier adapter`

---

## Phase 4: Google Merchant Center + Pakistan Post + DHL + FedEx

### Task 21: Google Merchant Center Client

**Files:**
- Create: `backend/services/marketplace/google-merchant.js`

Google Content API for Shopping v2.1. OAuth 2.0 via Google. Product feed push only (no order pull — Google Shopping sends users to your site, doesn't process orders).

Key methods:
- `testConnection()` — verify OAuth token
- `syncProducts(products)` — push product feed
- `checkFeedStatus()` — check approval/disapproval status

Save feed status to `google_merchant_feed_log`.

**Commit:** `feat: add Google Merchant Center client`

---

### Task 22: Google Merchant Integration Routes

**Files:**
- Create: `backend/routes/integrations/google-merchant.js`
- Modify: `backend/routes/integrations/index.js`

Key endpoints:
- `POST /api/integrations/google-merchant/test`
- `POST /api/integrations/google-merchant/sync-products`
- `GET /api/integrations/google-merchant/feed-status` — check which products are approved/disapproved
- No webhooks (pull-based only)

**Commit:** `feat: Google Merchant Center integration routes`

---

### Task 23: Pakistan Post Adapter

**Files:**
- Create: `backend/services/couriers/pakpost-adapter.js`
- Modify: `backend/services/couriers/index.js`

Pakistan Post has a limited tracking API. May need to implement as GenericAdapter subclass with tracking URL only.

**Commit:** `feat: add Pakistan Post courier adapter`

---

### Task 24: DHL Express Adapter

**Files:**
- Create: `backend/services/couriers/dhl-adapter.js`
- Modify: `backend/services/couriers/index.js`

DHL Express API is well-documented (MyDHL API). REST-based, OAuth2.

**Commit:** `feat: add DHL Express courier adapter`

---

### Task 25: FedEx Adapter

**Files:**
- Create: `backend/services/couriers/fedex-adapter.js`
- Modify: `backend/services/couriers/index.js`

FedEx Ship API. REST-based, OAuth2. Well-documented.

**Commit:** `feat: add FedEx courier adapter`

---

### Task 26: Marketplace Sync Background Worker

**Files:**
- Create: `backend/workers/marketplace-sync-worker-boss.js`
- Modify: `backend/boot/workers.js` (start worker)

pg-boss backed worker that:
- Processes pending `external_sync_events` for all marketplace integrations
- Polls Daraz/Facebook/WhatsApp for new orders (every 10 min) for tenants without webhooks
- Checks Google Merchant feed status (every 6 hours)
- Refreshes expiring OAuth tokens

Follow the pattern in `workers/fbr-worker-boss.js`.

Env var: `MARKETPLACE_SYNC_WORKER_ENABLED=1`
Heartbeat: `global.__marketplaceSyncWorkerStatus`

**Commit:** `feat: marketplace sync background worker (pg-boss)`

---

### Task 27: Update Hub UI for All Phases

**Files:**
- Modify: `frontend/src/pages/redesign/IntegrationsHubRedesign.jsx`

Ensure the hub UI shows all integrations from all phases:
- Marketplaces tab: Daraz, Shopify, WooCommerce
- Social Commerce tab: Facebook Shop, Instagram Shopping
- Messaging tab: WhatsApp Business (with cost warning banner)
- Product Feeds tab: Google Merchant Center
- Couriers tab: All 13 couriers

Each card should show:
- Connection status
- Last sync time
- Quick actions (sync, pull orders, test connection)
- Link to detailed management page for complex integrations (Shopify, Daraz)

**Commit:** `feat: update Integrations Hub UI for all channels + couriers`

---

### Task 28: Update Documentation

**Files:**
- Modify: `CLAUDE.md` (add integrations section)
- Modify: `DOMAIN-MAP.md` (add new routes)
- Modify: `DB-RELATIONSHIPS.md` (add new tables)
- Modify: `backend/CLAUDE.md` (add integration patterns)

Update all documentation to reflect the new integrations infrastructure.

**Commit:** `docs: update CLAUDE.md + domain map + DB relationships for integrations hub`

---

## Summary

| Phase | Tasks | New Files | Commits |
|-------|-------|-----------|---------|
| **Phase 1** | Tasks 1-10 | ~15 files | 10 |
| **Phase 2** | Tasks 11-15 | ~5 files | 5 |
| **Phase 3** | Tasks 16-20 | ~5 files | 5 |
| **Phase 4** | Tasks 21-28 | ~8 files | 8 |
| **Total** | 28 tasks | ~33 files | 28 commits |

### Key Integration Points
- All marketplace credentials stored in `integration_settings` (encrypted)
- All courier credentials stored in `courier_integrations` (existing)
- All marketplace orders flow into `web_orders` table with `source` field
- All sync events tracked in `external_sync_events` (existing)
- Single feature flag: `marketplace_integrations`
- Single worker: `marketplace-sync-worker-boss.js`
- Single hub UI: `/settings/integrations`
