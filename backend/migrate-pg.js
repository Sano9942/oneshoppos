#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
/**
 * migrate-pg.js — Postgres schema migration runner.
 *
 * Replaces the SQLite-specific run_migrations.js for Postgres deployments.
 * Reads schema_version table to determine current version, then applies
 * any unapplied migrations in order.
 *
 * Usage:
 *   node backend/migrate-pg.js              # runs against DATABASE_URL
 *   DATABASE_URL=... node backend/migrate-pg.js
 *
 * Version 1 = initial schema from schema-pg.sql (idempotent — all CREATE IF NOT EXISTS).
 */

const fs = require("fs");
const path = require("path");

const SCHEMA_SQL_PATH = path.join(__dirname, "schema-pg.sql");

/**
 * Ordered list of migrations. Each entry:
 *   { version: number, description: string, up: async (client) => void }
 *
 * Version 1 applies the full schema-pg.sql — safe to re-run because every
 * statement uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: "Initial schema from schema-pg.sql",
    up: async (client) => {
      const sql = fs.readFileSync(SCHEMA_SQL_PATH, "utf8");
      await client.query(sql);
    },
  },
  {
    version: 2,
    description: "Add cash_denominations to company_profile",
    up: async (client) => {
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS cash_denominations TEXT DEFAULT '[5000,1000,500,100,50,20,10]'
      `);
    },
  },
  {
    version: 3,
    description: "Add password_hash, email to employees + password_reset_tokens table",
    up: async (client) => {
      await client.query(`
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS email TEXT;
        ALTER TABLE employees ADD COLUMN IF NOT EXISTS password_hash TEXT;

        -- email unique index (partial — only non-null values)
        CREATE UNIQUE INDEX IF NOT EXISTS employees_email_unique
          ON employees (email) WHERE email IS NOT NULL;

        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id          SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          token_hash  TEXT NOT NULL,
          expires_at  TIMESTAMPTZ NOT NULL,
          used_at     TIMESTAMPTZ
        );
      `);
    },
  },
  {
    version: 4,
    description: "Add onboarding_dismissed to company_profile + backup_log table",
    up: async (client) => {
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS onboarding_dismissed BOOLEAN DEFAULT false;

        CREATE TABLE IF NOT EXISTS backup_log (
          id SERIAL PRIMARY KEY,
          schema_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'success',
          size_bytes BIGINT DEFAULT 0,
          duration_ms INTEGER DEFAULT 0,
          error_message TEXT,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );
      `);
    },
  },
  {
    version: 5,
    description: "Add courier_integrations table + shipping columns on web_orders",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS courier_integrations (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          adapter_key TEXT NOT NULL DEFAULT 'generic',
          api_base_url TEXT,
          api_key TEXT,
          api_secret TEXT,
          tracking_url_template TEXT,
          enabled BOOLEAN DEFAULT false,
          config_json TEXT DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        );

        INSERT INTO courier_integrations (name, adapter_key, tracking_url_template) VALUES
          ('Leopards Courier', 'leopards', 'https://leopardscourier.com/tracking/track-your-order?id={tracking}'),
          ('TCS', 'tcs', 'https://www.tcsexpress.com/tracking?code={tracking}'),
          ('BlueEx', 'blueex', 'https://blue-ex.com/tracking/{tracking}'),
          ('Trax', 'trax', 'https://trax.pk/tracking/{tracking}'),
          ('PostEx', 'postex', 'https://postex.pk/tracking/{tracking}'),
          ('Rider', 'rider', 'https://rider.pk/tracking/{tracking}'),
          ('Call Courier', 'callcourier', 'https://callcourier.com.pk/tracking/{tracking}'),
          ('M&P', 'mnp', 'https://www.mulphico.com/tracking/{tracking}'),
          ('Bykea', 'bykea', ''),
          ('Swyft', 'swyft', 'https://swyft.pk/tracking/{tracking}')
        ON CONFLICT (adapter_key) DO NOTHING;

        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS courier_id INTEGER REFERENCES courier_integrations(id);
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
      `);
    },
  },
  {
    version: 6,
    description: "Add setup_token_expires_at to company_profile",
    up: async (client) => {
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS setup_token_expires_at TIMESTAMPTZ
      `);
    },
  },
  {
    version: 7,
    description: "Add billing tables and columns to master schema",
    up: async (client) => {
      // These tables only exist in public schema — skip if tenants table doesn't exist
      const { rows } = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants' LIMIT 1"
      );
      if (!rows.length) return;

      await client.query(`
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle TEXT;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'active';

        CREATE TABLE IF NOT EXISTS plan_pricing (
          id            SERIAL PRIMARY KEY,
          plan          TEXT NOT NULL,
          cycle         TEXT NOT NULL,
          price         NUMERIC(12,2) NOT NULL,
          currency_code TEXT DEFAULT 'PKR',
          is_active     BOOLEAN DEFAULT true,
          UNIQUE(plan, cycle)
        );

        INSERT INTO plan_pricing (plan, cycle, price) VALUES
          ('starter', 'monthly', 3000),
          ('starter', 'annual', 30000),
          ('pro', 'monthly', 8000),
          ('pro', 'annual', 80000)
        ON CONFLICT DO NOTHING;

        CREATE TABLE IF NOT EXISTS payment_records (
          id              SERIAL PRIMARY KEY,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          amount          NUMERIC(12,2) NOT NULL,
          currency_code   TEXT DEFAULT 'PKR',
          plan            TEXT NOT NULL,
          cycle           TEXT NOT NULL,
          period_start    TIMESTAMPTZ NOT NULL,
          period_end      TIMESTAMPTZ NOT NULL,
          payment_method  TEXT,
          reference_note  TEXT,
          recorded_by     TEXT,
          recorded_at     TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS upgrade_requests (
          id              SERIAL PRIMARY KEY,
          tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
          requested_plan  TEXT NOT NULL,
          requested_cycle TEXT NOT NULL,
          message         TEXT,
          status          TEXT DEFAULT 'pending',
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          resolved_at     TIMESTAMPTZ,
          resolved_by     TEXT
        );
      `);
    },
  },
  {
    version: 8,
    description: "Add support_tickets (tenant) + impersonation_sessions (master)",
    up: async (client) => {
      // support_tickets — tenant schema table
      await client.query(`
        CREATE TABLE IF NOT EXISTS support_tickets (
          id              SERIAL PRIMARY KEY,
          type            VARCHAR(20) NOT NULL DEFAULT 'bug',
          message         TEXT NOT NULL,
          page_url        TEXT,
          browser         TEXT,
          employee_id     INTEGER REFERENCES employees(id),
          screenshots     JSONB DEFAULT '[]',
          last_req_id     VARCHAR(64),
          status          VARCHAR(20) DEFAULT 'open',
          created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          resolved_at     TIMESTAMPTZ
        );
      `);

      // impersonation_sessions — only in public/master schema
      const { rows } = await client.query(
        "SELECT 1 FROM information_schema.tables WHERE table_name = 'tenants' LIMIT 1"
      );
      if (rows.length) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS impersonation_sessions (
            id              SERIAL PRIMARY KEY,
            super_admin_id  INTEGER NOT NULL,
            tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
            started_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            ended_at        TIMESTAMPTZ,
            pages_visited   JSONB DEFAULT '[]',
            actions_taken   INTEGER DEFAULT 0
          );
        `);
      }
    },
  },
  {
    version: 9,
    description:
      "FBR Digital Invoicing: category tax/HS inheritance, FBR queue, tax rate reference",
    up: async (client) => {
      // Categories: tax + HS code inheritance
      await client.query(
        `ALTER TABLE categories ADD COLUMN IF NOT EXISTS tax_id INTEGER REFERENCES taxes(id)`
      );
      await client.query(
        `ALTER TABLE categories ADD COLUMN IF NOT EXISTS hs_code TEXT`
      );

      // Taxes: FBR-specific breakdown fields
      await client.query(
        `ALTER TABLE taxes ADD COLUMN IF NOT EXISTS fbr_further_tax NUMERIC(8,4) DEFAULT 0`
      );
      await client.query(
        `ALTER TABLE taxes ADD COLUMN IF NOT EXISTS fbr_extra_tax NUMERIC(8,4) DEFAULT 0`
      );
      await client.query(
        `ALTER TABLE taxes ADD COLUMN IF NOT EXISTS fbr_fed_rate NUMERIC(8,4) DEFAULT 0`
      );

      // Company profile: FBR config
      await client.query(
        `ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_api_token TEXT`
      );
      await client.query(
        `ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_environment TEXT DEFAULT 'sandbox'`
      );
      await client.query(
        `ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_default_hs_code TEXT`
      );
      await client.query(
        `ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS fbr_province TEXT`
      );

      // Customers: buyer tax ID
      await client.query(
        `ALTER TABLE customers ADD COLUMN IF NOT EXISTS ntn_cnic TEXT`
      );

      // Sales: FBR tracking
      await client.query(
        `ALTER TABLE sales ADD COLUMN IF NOT EXISTS fbr_status TEXT DEFAULT 'not_applicable'`
      );
      await client.query(
        `ALTER TABLE sales ADD COLUMN IF NOT EXISTS fbr_irn TEXT`
      );
      await client.query(
        `ALTER TABLE sales ADD COLUMN IF NOT EXISTS fbr_qr_code TEXT`
      );

      // Returns: FBR tracking
      await client.query(
        `ALTER TABLE returns ADD COLUMN IF NOT EXISTS fbr_status TEXT DEFAULT 'not_applicable'`
      );
      await client.query(
        `ALTER TABLE returns ADD COLUMN IF NOT EXISTS fbr_irn TEXT`
      );

      // FBR invoice queue
      await client.query(`CREATE TABLE IF NOT EXISTS fbr_invoices (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER REFERENCES sales(id),
        return_id INTEGER REFERENCES returns(id),
        invoice_type TEXT NOT NULL,
        payload JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        fbr_irn TEXT,
        fbr_response JSONB,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 5,
        last_error TEXT,
        next_retry_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        posted_at TIMESTAMPTZ
      )`);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_fbr_invoices_status ON fbr_invoices(status, next_retry_at)`
      );

      // Tax rate suggestions (tenant schema)
      // NOTE: reference_id points to tax_rate_reference.id in the PUBLIC schema.
      // No FK constraint because cross-schema FKs break tenant isolation.
      await client.query(`CREATE TABLE IF NOT EXISTS tax_rate_suggestions (
        id SERIAL PRIMARY KEY,
        reference_id INTEGER NOT NULL,
        suggested_by_tenant TEXT,
        suggested_by_employee INTEGER,
        field_name TEXT NOT NULL,
        current_value NUMERIC(8,4),
        suggested_value NUMERIC(8,4) NOT NULL,
        source_reference TEXT,
        notes TEXT,
        status TEXT DEFAULT 'pending',
        reviewed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Feature flag
      await client.query(`INSERT INTO feature_flags (key, enabled, description)
        VALUES ('fbr_integration', false, 'FBR Digital Invoicing - real-time invoice posting to FBR API')
        ON CONFLICT (key) DO NOTHING`);

      // Tax rate reference — created in ALL schemas (IF NOT EXISTS is safe).
      // In tenant schemas it will be unused — the worker and lookup routes always
      // query the public schema explicitly.
      await client.query(`CREATE TABLE IF NOT EXISTS tax_rate_reference (
        id SERIAL PRIMARY KEY,
        hs_code TEXT NOT NULL,
        description_en TEXT NOT NULL,
        description_ur TEXT,
        federal_gst NUMERIC(8,4) DEFAULT 0,
        punjab_pra NUMERIC(8,4) DEFAULT 0,
        sindh_srb NUMERIC(8,4) DEFAULT 0,
        kpk_kpra NUMERIC(8,4) DEFAULT 0,
        balochistan_bra NUMERIC(8,4) DEFAULT 0,
        exemption_notes TEXT,
        last_updated DATE DEFAULT CURRENT_DATE
      )`);
    },
  },
  {
    version: 10,
    description: "Email queue for deferred/scheduled emails",
    async up(client) {
      await client.query(`CREATE TABLE IF NOT EXISTS email_queue (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        email_type TEXT NOT NULL,
        to_email TEXT NOT NULL,
        subject TEXT NOT NULL,
        html_body TEXT NOT NULL,
        from_address TEXT NOT NULL,
        send_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at TIMESTAMPTZ,
        error TEXT,
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_email_queue_pending
        ON email_queue(send_at) WHERE sent_at IS NULL AND attempts < max_attempts`);
    },
  },
  {
    version: 11,
    description: "payment_intents table for gateway checkout tracking",
    up: async (client) => {
      await client.query(`CREATE TABLE IF NOT EXISTS payment_intents (
        id              SERIAL PRIMARY KEY,
        tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
        amount          NUMERIC(12,2) NOT NULL,
        currency_code   TEXT DEFAULT 'PKR',
        plan            TEXT NOT NULL,
        cycle           TEXT NOT NULL,
        outlet_count    INTEGER DEFAULT 1,
        status          TEXT DEFAULT 'pending',
        gateway         TEXT NOT NULL,
        gateway_ref     TEXT,
        gateway_data    JSONB,
        return_url      TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        completed_at    TIMESTAMPTZ
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_payment_intents_gateway_ref ON payment_intents(gateway_ref) WHERE gateway_ref IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON payment_intents(tenant_id, status)`);
    },
  },
  {
    version: 12,
    description: "Super admin enhancements — activity log, security log, tenant notes, announcements, broadcast log, support replies",
    up: async (client) => {
      // Public schema tables
      await client.query(`CREATE TABLE IF NOT EXISTS admin_activity_log (
        id SERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_activity_log_created ON admin_activity_log(created_at DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_activity_log_action ON admin_activity_log(action)`);

      await client.query(`CREATE TABLE IF NOT EXISTS admin_security_log (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        email TEXT,
        ip_address TEXT,
        user_agent TEXT,
        details JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_admin_security_log_created ON admin_security_log(created_at DESC)`);

      await client.query(`CREATE TABLE IF NOT EXISTS tenant_notes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id),
        admin_email TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tenant_notes_tenant ON tenant_notes(tenant_id)`);

      await client.query(`CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        message TEXT NOT NULL,
        type TEXT DEFAULT 'info',
        active BOOLEAN DEFAULT true,
        starts_at TIMESTAMPTZ DEFAULT NOW(),
        ends_at TIMESTAMPTZ,
        created_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      await client.query(`CREATE TABLE IF NOT EXISTS broadcast_log (
        id SERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL,
        broadcast_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        recipient_count INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);

      // Per-tenant: support ticket reply columns (safe if table doesn't exist in this schema)
      try {
        await client.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_reply TEXT`);
        await client.query(`ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at TIMESTAMPTZ`);
      } catch (_) {
        // Table may not exist in public schema — ignore
      }
    },
  },
  {
    version: 13,
    description: "Performance indexes + return_items variant_id",
    up: async (client) => {
      // Performance indexes (Task 4, bug #4)
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_outlet_id ON sales (outlet_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_employee_id ON sales (employee_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales ("timestamp" DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_invoice_number ON sales (invoice_number)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_voided ON sales (voided) WHERE voided = false`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode) WHERE barcode IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products (sku) WHERE sku IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_products_deleted_at_active ON products (deleted_at) WHERE deleted_at IS NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers (mobile) WHERE mobile IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_customers_email ON customers (email) WHERE email IS NOT NULL`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_cash_shifts_outlet_status ON cash_shifts (outlet_id, status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_returns_original_sale_id ON returns (original_sale_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_returns_timestamp ON returns ("timestamp" DESC)`);

      // Return variant tracking (Task 7, bug #13)
      await client.query(`ALTER TABLE return_items ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id)`);
    },
  },
  {
    version: 14,
    description: "Make pin_code nullable — stop storing plaintext PINs",
    up: async (client) => {
      // Drop the NOT NULL and UNIQUE constraints on pin_code
      await client.query(`ALTER TABLE employees ALTER COLUMN pin_code DROP NOT NULL`);
      await client.query(`ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_pin_code_key`);
    },
  },
  {
    version: 15,
    description: "pg-boss worker migration — add pgboss_job_id to fbr_invoices for observability",
    up: async (client) => {
      await client.query(`ALTER TABLE fbr_invoices ADD COLUMN IF NOT EXISTS pgboss_job_id UUID`);
    },
  },
  {
    version: 16,
    description: "competitive features — 13 new tables, customer/product column additions, seed data",
    up: async (client) => {
      await client.query(`
        -- ── Customer Enhancements ────────────────────────────────────────────
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_blacklisted BOOLEAN DEFAULT false;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklist_reason TEXT;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS blacklisted_at TIMESTAMPTZ;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender TEXT;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_group_id INTEGER;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT[];
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_payment_method TEXT;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS preferred_contact TEXT;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS loyalty_tier_id INTEGER;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spend NUMERIC(12,2) DEFAULT 0;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS price_list_id INTEGER;

        -- ── Product Enhancements ─────────────────────────────────────────────
        ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bundle BOOLEAN DEFAULT false;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS avg_rating NUMERIC(3,2) DEFAULT 0;
        ALTER TABLE products ADD COLUMN IF NOT EXISTS review_count INTEGER DEFAULT 0;

        -- ── Customer Groups ──────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS customer_groups (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          discount_percent NUMERIC(4,2) DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- ── Loyalty Tiers ────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS loyalty_tiers (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          min_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
          points_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0,
          discount_percent NUMERIC(4,2) DEFAULT 0,
          benefits TEXT,
          color TEXT,
          sort_order INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Seed default loyalty tiers (idempotent on (name) post v79)
        INSERT INTO loyalty_tiers (name, min_spend, points_multiplier, discount_percent, color, sort_order)
        VALUES
          ('Bronze', 0, 1.0, 0, '#CD7F32', 1),
          ('Silver', 25000, 1.5, 2, '#C0C0C0', 2),
          ('Gold', 75000, 2.0, 5, '#FFD700', 3),
          ('Platinum', 200000, 3.0, 8, '#E5E4E2', 4)
        ON CONFLICT (name) DO NOTHING;

        -- ── Product Bundles ──────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS product_bundles (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          component_product_id INTEGER NOT NULL REFERENCES products(id),
          component_variant_id INTEGER REFERENCES product_variants(id),
          quantity INTEGER NOT NULL DEFAULT 1,
          UNIQUE(product_id, component_product_id, component_variant_id)
        );

        -- ── Price Lists ──────────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS price_lists (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT DEFAULT 'customer_group' CHECK(type IN ('customer_group','volume','promotional')),
          is_default BOOLEAN DEFAULT false,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS price_list_items (
          id SERIAL PRIMARY KEY,
          price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id),
          variant_id INTEGER REFERENCES product_variants(id),
          price NUMERIC(12,2) NOT NULL,
          min_qty INTEGER DEFAULT 1,
          UNIQUE(price_list_id, product_id, variant_id, min_qty)
        );

        -- ── Product Reviews ──────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS product_reviews (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          customer_id INTEGER REFERENCES customers(id),
          customer_name TEXT,
          rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
          title TEXT,
          body TEXT,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
          moderated_by INTEGER REFERENCES employees(id),
          moderated_at TIMESTAMPTZ,
          sale_id INTEGER REFERENCES sales(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- ── Credit & Debit Notes ─────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS credit_notes (
          id SERIAL PRIMARY KEY,
          note_number TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('sales','purchase')),
          customer_id INTEGER REFERENCES customers(id),
          supplier_id INTEGER REFERENCES suppliers(id),
          amount NUMERIC(12,2) NOT NULL,
          reason TEXT NOT NULL,
          reference_type TEXT,
          reference_id INTEGER,
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft','approved','applied','cancelled')),
          approved_by INTEGER REFERENCES employees(id),
          approved_at TIMESTAMPTZ,
          notes TEXT,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS debit_notes (
          id SERIAL PRIMARY KEY,
          note_number TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('sales','purchase')),
          customer_id INTEGER REFERENCES customers(id),
          supplier_id INTEGER REFERENCES suppliers(id),
          amount NUMERIC(12,2) NOT NULL,
          reason TEXT NOT NULL,
          reference_type TEXT,
          reference_id INTEGER,
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft','approved','applied','cancelled')),
          approved_by INTEGER REFERENCES employees(id),
          approved_at TIMESTAMPTZ,
          notes TEXT,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- ── Post-Dated Cheques ───────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS postdated_cheques (
          id SERIAL PRIMARY KEY,
          cheque_number TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('receivable','payable')),
          party_type TEXT NOT NULL CHECK(party_type IN ('customer','supplier')),
          party_id INTEGER NOT NULL,
          bank_name TEXT,
          amount NUMERIC(12,2) NOT NULL,
          issue_date DATE NOT NULL,
          maturity_date DATE NOT NULL,
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending','deposited','cleared','bounced','cancelled')),
          deposited_at TIMESTAMPTZ,
          cleared_at TIMESTAMPTZ,
          bounced_at TIMESTAMPTZ,
          notes TEXT,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- ── Chart of Accounts ────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS chart_of_accounts (
          id SERIAL PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')),
          sub_type TEXT,
          parent_id INTEGER REFERENCES chart_of_accounts(id),
          is_system BOOLEAN DEFAULT false,
          is_active BOOLEAN DEFAULT true,
          description TEXT,
          normal_balance TEXT CHECK(normal_balance IN ('debit','credit')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        -- Seed default Pakistan-standard chart of accounts
        INSERT INTO chart_of_accounts (code, name, type, sub_type, is_system, normal_balance) VALUES
          ('1000', 'Cash on Hand', 'asset', 'current_asset', true, 'debit'),
          ('1010', 'Bank Account', 'asset', 'current_asset', true, 'debit'),
          ('1100', 'Accounts Receivable', 'asset', 'current_asset', true, 'debit'),
          ('1200', 'Inventory', 'asset', 'current_asset', true, 'debit'),
          ('1300', 'Fixed Assets', 'asset', 'fixed_asset', true, 'debit'),
          ('2000', 'Accounts Payable', 'liability', 'current_liability', true, 'credit'),
          ('2100', 'Sales Tax Payable', 'liability', 'current_liability', true, 'credit'),
          ('2200', 'Other Payables', 'liability', 'current_liability', true, 'credit'),
          ('3000', 'Owner''s Equity', 'equity', 'equity', true, 'credit'),
          ('3100', 'Retained Earnings', 'equity', 'equity', true, 'credit'),
          ('4000', 'Sales Revenue', 'revenue', 'operating_revenue', true, 'credit'),
          ('4100', 'Service Revenue', 'revenue', 'operating_revenue', true, 'credit'),
          ('4200', 'Other Revenue', 'revenue', 'other_revenue', true, 'credit'),
          ('5000', 'Cost of Goods Sold', 'expense', 'cost_of_sales', true, 'debit'),
          ('5100', 'Salaries & Wages', 'expense', 'operating_expense', true, 'debit'),
          ('5200', 'Rent', 'expense', 'operating_expense', true, 'debit'),
          ('5300', 'Utilities', 'expense', 'operating_expense', true, 'debit'),
          ('5400', 'Marketing', 'expense', 'operating_expense', true, 'debit'),
          ('5500', 'Office Supplies', 'expense', 'operating_expense', true, 'debit'),
          ('5600', 'Depreciation', 'expense', 'operating_expense', true, 'debit'),
          ('5900', 'Other Expenses', 'expense', 'operating_expense', true, 'debit')
        ON CONFLICT (code) DO NOTHING;

        -- ── Journal Entries ──────────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS journal_entries (
          id SERIAL PRIMARY KEY,
          entry_number TEXT NOT NULL,
          entry_date DATE NOT NULL,
          description TEXT NOT NULL,
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft','posted','voided')),
          reference_type TEXT,
          reference_id INTEGER,
          posted_by INTEGER REFERENCES employees(id),
          posted_at TIMESTAMPTZ,
          voided_by INTEGER REFERENCES employees(id),
          voided_at TIMESTAMPTZ,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS journal_entry_lines (
          id SERIAL PRIMARY KEY,
          journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
          account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
          description TEXT,
          debit NUMERIC(12,2) DEFAULT 0,
          credit NUMERIC(12,2) DEFAULT 0,
          CHECK(debit >= 0 AND credit >= 0)
        );

        -- ── Stock Counts (Inventory Audit) ──────────────────────────────────
        CREATE TABLE IF NOT EXISTS stock_counts (
          id SERIAL PRIMARY KEY,
          count_number TEXT NOT NULL,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          status TEXT DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed','cancelled')),
          started_by INTEGER REFERENCES employees(id),
          started_at TIMESTAMPTZ DEFAULT NOW(),
          completed_by INTEGER REFERENCES employees(id),
          completed_at TIMESTAMPTZ,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS stock_count_items (
          id SERIAL PRIMARY KEY,
          stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id),
          variant_id INTEGER REFERENCES product_variants(id),
          system_qty INTEGER NOT NULL DEFAULT 0,
          counted_qty INTEGER DEFAULT 0,
          last_scanned_at TIMESTAMPTZ,
          UNIQUE(stock_count_id, product_id, variant_id)
        );

        -- ── Fulfillment (Pick/Pack/Dispatch) ─────────────────────────────────
        CREATE TABLE IF NOT EXISTS picklists (
          id SERIAL PRIMARY KEY,
          picklist_number TEXT NOT NULL,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          status TEXT DEFAULT 'pending' CHECK(status IN ('pending','picking','picked','packing','packed','dispatched','cancelled')),
          assigned_to INTEGER REFERENCES employees(id),
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          picked_at TIMESTAMPTZ,
          packed_at TIMESTAMPTZ,
          dispatched_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS picklist_items (
          id SERIAL PRIMARY KEY,
          picklist_id INTEGER NOT NULL REFERENCES picklists(id) ON DELETE CASCADE,
          web_order_id INTEGER NOT NULL REFERENCES web_orders(id),
          product_id INTEGER NOT NULL REFERENCES products(id),
          variant_id INTEGER REFERENCES product_variants(id),
          qty_to_pick INTEGER NOT NULL,
          qty_picked INTEGER DEFAULT 0,
          qty_packed INTEGER DEFAULT 0,
          barcode TEXT,
          allocation_id INTEGER,
          picked_at TIMESTAMPTZ,
          packed_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS loadsheets (
          id SERIAL PRIMARY KEY,
          loadsheet_number TEXT NOT NULL,
          courier_id INTEGER REFERENCES courier_integrations(id),
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          status TEXT DEFAULT 'draft' CHECK(status IN ('draft','finalized','handed_over')),
          total_orders INTEGER DEFAULT 0,
          total_cod NUMERIC(12,2) DEFAULT 0,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          finalized_at TIMESTAMPTZ,
          handed_over_at TIMESTAMPTZ,
          handed_over_to TEXT
        );

        CREATE TABLE IF NOT EXISTS loadsheet_orders (
          id SERIAL PRIMARY KEY,
          loadsheet_id INTEGER NOT NULL REFERENCES loadsheets(id) ON DELETE CASCADE,
          web_order_id INTEGER NOT NULL REFERENCES web_orders(id),
          tracking_number TEXT,
          is_cod BOOLEAN DEFAULT false,
          cod_amount NUMERIC(12,2) DEFAULT 0,
          UNIQUE(loadsheet_id, web_order_id)
        );

        -- Add FKs that reference newly created tables
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_customer_group_id_fkey') THEN
            ALTER TABLE customers ADD CONSTRAINT customers_customer_group_id_fkey FOREIGN KEY (customer_group_id) REFERENCES customer_groups(id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_loyalty_tier_id_fkey') THEN
            ALTER TABLE customers ADD CONSTRAINT customers_loyalty_tier_id_fkey FOREIGN KEY (loyalty_tier_id) REFERENCES loyalty_tiers(id);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_price_list_id_fkey') THEN
            ALTER TABLE customers ADD CONSTRAINT customers_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES price_lists(id);
          END IF;
        END $$;
      `);

      // Billing cycle additions — public schema only, safe to fail on tenant schemas
      try {
        await client.query(`
          INSERT INTO plan_pricing (plan, cycle, price, currency_code, is_active)
          VALUES
            ('pro', 'quarterly', 21600, 'PKR', true),
            ('pro', 'semi_annual', 40800, 'PKR', true)
          ON CONFLICT DO NOTHING
        `);
      } catch (_) {
        // Expected to fail on tenant schemas where plan_pricing doesn't exist
      }
    },
  },
  {
    version: 17,
    description: "integrations hub — extend integration_settings, add marketplace mapping tables, seed new couriers",
    up: async (client) => {
      // Create integration_settings if it doesn't exist (may not exist in older tenant schemas)
      await client.query(`
        CREATE TABLE IF NOT EXISTS integration_settings (
          id SERIAL PRIMARY KEY,
          provider TEXT NOT NULL UNIQUE,
          store_url TEXT,
          api_key TEXT,
          api_secret TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

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
      try {
        await client.query(`
          INSERT INTO courier_integrations (name, adapter_key, tracking_url_template) VALUES
            ('Pakistan Post', 'pakpost', 'https://ep.gov.pk/track/{tracking}'),
            ('DHL Express', 'dhl', 'https://www.dhl.com/pk-en/home/tracking.html?tracking-id={tracking}'),
            ('FedEx', 'fedex', 'https://www.fedex.com/fedextrack/?trknbr={tracking}')
          ON CONFLICT (adapter_key) DO NOTHING
        `);
      } catch (_) {
        // courier_integrations may not exist in all schemas
      }
    },
  },
  {
    version: 18,
    description: "Omnichannel — sales channels, reservations, allocations, storefront carts, customer addresses",
    up: async (client) => {
      // ── Sales Channels ────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS sales_channels (
          id SERIAL PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          type TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          is_public BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // Seed default channels
      await client.query(`
        INSERT INTO sales_channels (code, name, type) VALUES
          ('pos',         'Point of Sale',  'pos'),
          ('storefront',  'Online Store',   'online_store'),
          ('shopify',     'Shopify',        'online_store'),
          ('woocommerce', 'WooCommerce',    'online_store'),
          ('daraz',       'Daraz',          'marketplace'),
          ('facebook',    'Facebook',       'social'),
          ('instagram',   'Instagram',      'social'),
          ('whatsapp',    'WhatsApp',       'messaging')
        ON CONFLICT (code) DO NOTHING;
      `);

      // ── Channel Publications ──────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS channel_publications (
          id SERIAL PRIMARY KEY,
          channel_id INT NOT NULL REFERENCES sales_channels(id),
          product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          variant_id INT REFERENCES product_variants(id) ON DELETE CASCADE,
          is_published BOOLEAN DEFAULT TRUE,
          published_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_publications_unique
          ON channel_publications (channel_id, product_id, COALESCE(variant_id, 0));
        CREATE INDEX IF NOT EXISTS idx_channel_publications_product ON channel_publications(product_id);
        CREATE INDEX IF NOT EXISTS idx_channel_publications_channel ON channel_publications(channel_id);
      `);

      // ── Inventory Reservations ────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS inventory_reservations (
          id SERIAL PRIMARY KEY,
          reservation_key TEXT NOT NULL,
          channel_id INT REFERENCES sales_channels(id),
          web_order_id INT REFERENCES web_orders(id),
          product_id INT NOT NULL REFERENCES products(id),
          variant_id INT REFERENCES product_variants(id),
          outlet_id INT NOT NULL REFERENCES outlets(id),
          quantity INT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_inventory_reservations_key ON inventory_reservations(reservation_key);
        CREATE INDEX IF NOT EXISTS idx_inventory_reservations_outlet_product ON inventory_reservations(outlet_id, product_id);
        CREATE INDEX IF NOT EXISTS idx_inventory_reservations_status ON inventory_reservations(status) WHERE status = 'active';
      `);

      // ── Web Order Allocations ─────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS web_order_allocations (
          id SERIAL PRIMARY KEY,
          web_order_id INT NOT NULL REFERENCES web_orders(id) ON DELETE CASCADE,
          web_order_item_id INT REFERENCES web_order_items(id) ON DELETE CASCADE,
          fulfillment_outlet_id INT NOT NULL REFERENCES outlets(id),
          fulfillment_method TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          allocated_qty INT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_web_order_allocations_order ON web_order_allocations(web_order_id);
        CREATE INDEX IF NOT EXISTS idx_web_order_allocations_outlet ON web_order_allocations(fulfillment_outlet_id);
      `);

      // Ensure allocation_id column exists on picklist_items (table may pre-exist from v16 without it)
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'picklist_items' AND column_name = 'allocation_id'
          ) THEN
            ALTER TABLE picklist_items ADD COLUMN allocation_id INTEGER;
          END IF;
        END $$;
      `);

      // Add FK from picklist_items.allocation_id → web_order_allocations now that both tables exist
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'picklist_items_allocation_id_fkey' AND table_name = 'picklist_items'
          ) THEN
            ALTER TABLE picklist_items
              ADD CONSTRAINT picklist_items_allocation_id_fkey
              FOREIGN KEY (allocation_id) REFERENCES web_order_allocations(id);
          END IF;
        END $$;
      `);

      // ── Customer Addresses ────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_addresses (
          id SERIAL PRIMARY KEY,
          customer_id INT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          label TEXT,
          recipient_name TEXT,
          phone TEXT,
          address_line_1 TEXT,
          address_line_2 TEXT,
          city TEXT,
          province TEXT,
          postal_code TEXT,
          country_code TEXT DEFAULT 'PK',
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_customer_addresses_customer ON customer_addresses(customer_id);
      `);

      // ── Storefront Carts ──────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS storefront_carts (
          id SERIAL PRIMARY KEY,
          cart_token TEXT NOT NULL UNIQUE,
          customer_id INT REFERENCES customers(id),
          channel_id INT REFERENCES sales_channels(id),
          pickup_outlet_id INT REFERENCES outlets(id),
          delivery_method TEXT,
          currency TEXT DEFAULT 'PKR',
          quote_payload JSONB,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_storefront_carts_token ON storefront_carts(cart_token);
        CREATE INDEX IF NOT EXISTS idx_storefront_carts_customer ON storefront_carts(customer_id);
      `);

      // ── Storefront Cart Items ─────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS storefront_cart_items (
          id SERIAL PRIMARY KEY,
          cart_id INT NOT NULL REFERENCES storefront_carts(id) ON DELETE CASCADE,
          product_id INT NOT NULL REFERENCES products(id),
          variant_id INT REFERENCES product_variants(id),
          quantity INT NOT NULL DEFAULT 1,
          unit_price NUMERIC(12,2),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_storefront_cart_items_cart ON storefront_cart_items(cart_id);
      `);

      // ── web_orders column extensions ──────────────────────────────
      await client.query(`
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS channel_id INT REFERENCES sales_channels(id);
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS delivery_method TEXT;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS pickup_outlet_id INT REFERENCES outlets(id);
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS fulfillment_outlet_id INT REFERENCES outlets(id);
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_name_snapshot TEXT;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_phone_snapshot TEXT;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS customer_email_snapshot TEXT;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS shipping_address_json JSONB;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS pickup_ready_at TIMESTAMPTZ;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS curbside_arrived_at TIMESTAMPTZ;
        ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS public_order_token TEXT UNIQUE;
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_web_orders_channel ON web_orders(channel_id);
        CREATE INDEX IF NOT EXISTS idx_web_orders_public_token ON web_orders(public_order_token);
        CREATE INDEX IF NOT EXISTS idx_web_orders_delivery_method ON web_orders(delivery_method);
      `);

      // ── returns column extension ──────────────────────────────────
      await client.query(`
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS web_order_id INT REFERENCES web_orders(id);
        CREATE INDEX IF NOT EXISTS idx_returns_web_order ON returns(web_order_id) WHERE web_order_id IS NOT NULL;
      `);

      // ── Backfill: set channel_id on existing web_orders from source ─
      try {
        await client.query(`
          UPDATE web_orders wo
          SET channel_id = sc.id
          FROM sales_channels sc
          WHERE wo.source = sc.code
            AND wo.channel_id IS NULL;
        `);
      } catch (_) {
        // source column may not exist in all schemas
      }
    },
  },
  {
    version: 19,
    description: "Phase 2A — scheduling, pricing assignments, draft orders, approval policies, return policies, labor analytics",
    up: async (client) => {
      // -- Workforce scheduling --
      await client.query(`
        CREATE TABLE IF NOT EXISTS scheduled_shifts (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          shift_date DATE NOT NULL,
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          break_minutes INTEGER DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
          notes TEXT,
          created_by INTEGER REFERENCES employees(id),
          published_at TIMESTAMPTZ,
          publish_notification TEXT DEFAULT 'affected' CHECK (publish_notification IN ('affected','all','none')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // -- Outlet geofence fields --
      await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)`);
      await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)`);
      await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS geofence_radius_meters INTEGER`);

      // -- Leave request scheduling extensions --
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS partial_day BOOLEAN DEFAULT FALSE`);
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time TIME`);
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time TIME`);
      await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS schedule_impact_status TEXT`);

      // -- Price list assignments --
      await client.query(`
        CREATE TABLE IF NOT EXISTS price_list_assignments (
          id SERIAL PRIMARY KEY,
          price_list_id INTEGER NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL CHECK (scope_type IN ('outlet','channel','customer','customer_group')),
          scope_id INTEGER NOT NULL,
          priority INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          starts_at TIMESTAMPTZ,
          ends_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(price_list_id, scope_type, scope_id)
        )
      `);

      // -- Draft orders --
      await client.query(`
        CREATE TABLE IF NOT EXISTS draft_orders (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          customer_id INTEGER REFERENCES customers(id),
          created_by INTEGER NOT NULL REFERENCES employees(id),
          claimed_by INTEGER REFERENCES employees(id),
          claimed_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','completed','cancelled')),
          notes TEXT,
          subtotal NUMERIC(12,2) DEFAULT 0,
          tax_total NUMERIC(12,2) DEFAULT 0,
          discount_total NUMERIC(12,2) DEFAULT 0,
          total NUMERIC(12,2) DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS draft_order_items (
          id SERIAL PRIMARY KEY,
          draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id),
          variant_id INTEGER,
          product_name TEXT NOT NULL,
          quantity INTEGER NOT NULL DEFAULT 1,
          price NUMERIC(12,2) NOT NULL,
          discount NUMERIC(12,2) DEFAULT 0,
          effective_tax_rate NUMERIC(6,4) DEFAULT 0,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // -- Approval policies (generic, reusable) --
      await client.query(`
        CREATE TABLE IF NOT EXISTS approval_policies (
          id SERIAL PRIMARY KEY,
          action_type TEXT NOT NULL,
          outlet_id INTEGER REFERENCES outlets(id),
          role_id INTEGER REFERENCES roles(id),
          policy TEXT NOT NULL DEFAULT 'allowed' CHECK (policy IN ('allowed','denied','approval_required')),
          threshold_value NUMERIC(12,2),
          threshold_type TEXT CHECK (threshold_type IN ('amount','percent')),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(action_type, outlet_id, role_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS approval_events (
          id SERIAL PRIMARY KEY,
          policy_id INTEGER REFERENCES approval_policies(id),
          action_type TEXT NOT NULL,
          reference_type TEXT NOT NULL,
          reference_id INTEGER,
          requested_by INTEGER NOT NULL REFERENCES employees(id),
          approved_by INTEGER REFERENCES employees(id),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
          reason TEXT,
          metadata JSONB,
          outlet_id INTEGER REFERENCES outlets(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // -- Return policies and reasons --
      await client.query(`
        CREATE TABLE IF NOT EXISTS return_policies (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          return_window_days INTEGER,
          receipt_required BOOLEAN DEFAULT TRUE,
          restocking_fee_percent NUMERIC(5,2) DEFAULT 0,
          allowed_refund_methods TEXT[] DEFAULT '{cash,card,store_credit}',
          is_default BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS return_reasons (
          id SERIAL PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          requires_note BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // -- Return table extensions --
      await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS policy_id INTEGER REFERENCES return_policies(id)`);
      await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS policy_result TEXT`);
      await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS approval_event_id INTEGER REFERENCES approval_events(id)`);
      await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS processed_by_employee_id INTEGER REFERENCES employees(id)`);
      await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS approved_by_employee_id INTEGER REFERENCES employees(id)`);
      await client.query(`ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_reason_id INTEGER REFERENCES return_reasons(id)`);

      // -- Indexes --
      await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_outlet_date ON scheduled_shifts(outlet_id, shift_date)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_shifts_employee ON scheduled_shifts(employee_id, shift_date)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_draft_orders_outlet_status ON draft_orders(outlet_id, status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_draft_orders_claimed ON draft_orders(claimed_by) WHERE status = 'claimed'`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_price_list_assignments_scope ON price_list_assignments(scope_type, scope_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_events_ref ON approval_events(reference_type, reference_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_approval_policies_action ON approval_policies(action_type, outlet_id)`);
    },
  },
  {
    version: 20,
    description: "Phase 2B — smart collections, outlet visibility, outlet tax profiles, scheduled catalog changes, commissions, report builder, POS layouts, product affinities",
    up: async (client) => {
      // -- Smart collections --
      await client.query(`
        CREATE TABLE IF NOT EXISTS smart_collections (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          disjunctive BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          sort_order TEXT DEFAULT 'manual',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS smart_collection_rules (
          id SERIAL PRIMARY KEY,
          collection_id INTEGER NOT NULL REFERENCES smart_collections(id) ON DELETE CASCADE,
          field TEXT NOT NULL,
          operator TEXT NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_smart_collection_rules_collection ON smart_collection_rules(collection_id)`);

      // -- Outlet product visibility --
      await client.query(`
        CREATE TABLE IF NOT EXISTS outlet_product_visibility (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          is_visible BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(outlet_id, product_id)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_opv_outlet ON outlet_product_visibility(outlet_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_opv_product ON outlet_product_visibility(product_id)`);

      // -- Outlet tax profiles --
      await client.query(`
        CREATE TABLE IF NOT EXISTS outlet_tax_profiles (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(outlet_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS outlet_tax_profile_lines (
          id SERIAL PRIMARY KEY,
          profile_id INTEGER NOT NULL REFERENCES outlet_tax_profiles(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES categories(id),
          product_id INTEGER REFERENCES products(id),
          tax_id INTEGER NOT NULL REFERENCES taxes(id),
          priority INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_otpl_profile ON outlet_tax_profile_lines(profile_id)`);

      // -- Scheduled catalog changes --
      await client.query(`
        CREATE TABLE IF NOT EXISTS scheduled_catalog_changes (
          id SERIAL PRIMARY KEY,
          change_type TEXT NOT NULL CHECK (change_type IN ('price','visibility','status','tax')),
          entity_type TEXT NOT NULL CHECK (entity_type IN ('product','variant','collection','price_list')),
          entity_id INTEGER NOT NULL,
          field_name TEXT NOT NULL,
          old_value TEXT,
          new_value TEXT NOT NULL,
          scheduled_at TIMESTAMPTZ NOT NULL,
          applied_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','cancelled','failed')),
          created_by INTEGER REFERENCES employees(id),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_scc_status_scheduled ON scheduled_catalog_changes(status, scheduled_at) WHERE status = 'pending'`);

      // -- Commission plans --
      await client.query(`
        CREATE TABLE IF NOT EXISTS commission_plans (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          type TEXT NOT NULL DEFAULT 'percentage' CHECK (type IN ('percentage','fixed_per_sale','fixed_per_item','tiered')),
          is_active BOOLEAN DEFAULT TRUE,
          starts_at TIMESTAMPTZ,
          ends_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // -- Commission plan rules --
      await client.query(`
        CREATE TABLE IF NOT EXISTS commission_plan_rules (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES commission_plans(id) ON DELETE CASCADE,
          scope_type TEXT NOT NULL DEFAULT 'all' CHECK (scope_type IN ('all','category','product','brand')),
          scope_id INTEGER,
          rate NUMERIC(8,4) NOT NULL,
          min_threshold NUMERIC(12,2) DEFAULT 0,
          max_cap NUMERIC(12,2),
          priority INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_cpr_plan ON commission_plan_rules(plan_id)`);

      // -- Commission earnings --
      await client.query(`
        CREATE TABLE IF NOT EXISTS commission_earnings (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          sale_id INTEGER NOT NULL REFERENCES sales(id),
          plan_id INTEGER NOT NULL REFERENCES commission_plans(id),
          rule_id INTEGER REFERENCES commission_plan_rules(id),
          sale_amount NUMERIC(12,2) NOT NULL,
          commission_amount NUMERIC(12,2) NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','paid','reversed')),
          approved_at TIMESTAMPTZ,
          paid_at TIMESTAMPTZ,
          reversed_at TIMESTAMPTZ,
          reversal_reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ce_employee ON commission_earnings(employee_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ce_sale ON commission_earnings(sale_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ce_status ON commission_earnings(status)`);

      // -- Employee commission plan assignment --
      await client.query(`ALTER TABLE employees ADD COLUMN IF NOT EXISTS commission_plan_id INTEGER REFERENCES commission_plans(id)`);

      // -- Custom report definitions --
      await client.query(`
        CREATE TABLE IF NOT EXISTS custom_report_definitions (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          dataset TEXT NOT NULL,
          dimensions TEXT[] NOT NULL DEFAULT '{}',
          measures TEXT[] NOT NULL DEFAULT '{}',
          filters_json TEXT DEFAULT '{}',
          sort_by TEXT,
          sort_order TEXT DEFAULT 'desc',
          created_by INTEGER REFERENCES employees(id),
          is_shared BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // -- Custom report widgets --
      await client.query(`
        CREATE TABLE IF NOT EXISTS custom_report_widgets (
          id SERIAL PRIMARY KEY,
          definition_id INTEGER NOT NULL REFERENCES custom_report_definitions(id) ON DELETE CASCADE,
          widget_type TEXT NOT NULL DEFAULT 'table' CHECK (widget_type IN ('table','bar_chart','line_chart','pie_chart','metric_card')),
          title TEXT,
          config_json TEXT DEFAULT '{}',
          position INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_crw_definition ON custom_report_widgets(definition_id)`);

      // -- POS layouts --
      await client.query(`
        CREATE TABLE IF NOT EXISTS pos_layouts (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          scope_type TEXT NOT NULL DEFAULT 'global' CHECK (scope_type IN ('global','outlet','role','employee')),
          scope_id INTEGER,
          layout_json TEXT NOT NULL DEFAULT '[]',
          is_active BOOLEAN DEFAULT TRUE,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(scope_type, scope_id)
        )
      `);

      // -- Product affinities --
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_affinities (
          id SERIAL PRIMARY KEY,
          source_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          target_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          affinity_type TEXT NOT NULL DEFAULT 'frequently_bought_together' CHECK (affinity_type IN ('frequently_bought_together','complementary','upsell','cross_sell')),
          score NUMERIC(5,2) DEFAULT 1.0,
          is_manual BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(source_product_id, target_product_id, affinity_type)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_pa_source ON product_affinities(source_product_id)`);
    },
  },
  {
    version: 21,
    description: "Phase 3 — marketing campaigns, messaging inbox, customer invoicing, subscriptions",
    up: async (client) => {
      // ── Customer consent fields ──────────────────────────────────
      await client.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS email_consent BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS sms_consent BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS whatsapp_consent BOOLEAN DEFAULT false
      `);

      // ── Quotation → invoice linkage ──────────────────────────────
      await client.query(`
        ALTER TABLE quotations
          ADD COLUMN IF NOT EXISTS converted_invoice_id INTEGER
      `);

      // ── Marketing Templates ──────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketing_templates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'email',
          subject TEXT,
          body_html TEXT,
          body_text TEXT,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Marketing Campaigns ──────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketing_campaigns (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          channel TEXT NOT NULL DEFAULT 'email',
          template_id INTEGER REFERENCES marketing_templates(id),
          status TEXT NOT NULL DEFAULT 'draft',
          subject TEXT,
          body_html TEXT,
          scheduled_at TIMESTAMPTZ,
          sent_at TIMESTAMPTZ,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Campaign Audiences ───────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketing_campaign_audiences (
          id SERIAL PRIMARY KEY,
          campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
          filter_type TEXT NOT NULL,
          filter_value TEXT NOT NULL
        )
      `);

      // ── Campaign Deliveries ──────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS marketing_campaign_deliveries (
          id SERIAL PRIMARY KEY,
          campaign_id INTEGER NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          channel TEXT NOT NULL DEFAULT 'email',
          recipient TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          sent_at TIMESTAMPTZ,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Message Threads (generic inbox) ──────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_threads (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
          channel TEXT NOT NULL DEFAULT 'whatsapp',
          channel_identifier TEXT NOT NULL,
          subject TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          assigned_to INTEGER REFERENCES employees(id),
          unread_count INTEGER DEFAULT 0,
          last_message_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Message Entries ──────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS message_entries (
          id SERIAL PRIMARY KEY,
          thread_id INTEGER NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
          direction TEXT NOT NULL,
          content TEXT,
          message_type TEXT DEFAULT 'text',
          external_id TEXT,
          sender_type TEXT DEFAULT 'customer',
          sender_id INTEGER,
          status TEXT DEFAULT 'delivered',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Customer Invoices ────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_invoices (
          id SERIAL PRIMARY KEY,
          invoice_number TEXT UNIQUE,
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          quotation_id INTEGER REFERENCES quotations(id),
          outlet_id INTEGER REFERENCES outlets(id),
          employee_id INTEGER REFERENCES employees(id),
          status TEXT NOT NULL DEFAULT 'draft',
          subtotal NUMERIC(12,2) DEFAULT 0,
          tax_total NUMERIC(12,2) DEFAULT 0,
          discount_amount NUMERIC(12,2) DEFAULT 0,
          total_amount NUMERIC(12,2) DEFAULT 0,
          amount_paid NUMERIC(12,2) DEFAULT 0,
          balance_due NUMERIC(12,2) DEFAULT 0,
          due_date DATE,
          notes TEXT,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Customer Invoice Items ───────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_invoice_items (
          id SERIAL PRIMARY KEY,
          invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
          product_id INTEGER REFERENCES products(id),
          variant_id INTEGER REFERENCES product_variants(id),
          description TEXT NOT NULL,
          quantity NUMERIC(10,2) NOT NULL DEFAULT 1,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          tax_rate NUMERIC(8,4) DEFAULT 0,
          line_total NUMERIC(12,2) DEFAULT 0
        )
      `);

      // ── Customer Invoice Payments ────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_invoice_payments (
          id SERIAL PRIMARY KEY,
          invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
          amount NUMERIC(12,2) NOT NULL,
          payment_method TEXT NOT NULL DEFAULT 'cash',
          payment_type TEXT NOT NULL DEFAULT 'payment',
          reference TEXT,
          notes TEXT,
          recorded_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Customer Invoice Payment Links ───────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_invoice_payment_links (
          id SERIAL PRIMARY KEY,
          invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
          link_token TEXT NOT NULL UNIQUE,
          gateway_ref TEXT,
          amount NUMERIC(12,2) NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Customer Invoice Reminders ───────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_invoice_reminders (
          id SERIAL PRIMARY KEY,
          invoice_id INTEGER NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
          reminder_type TEXT NOT NULL DEFAULT 'before_due',
          days_offset INTEGER NOT NULL DEFAULT 0,
          channel TEXT NOT NULL DEFAULT 'email',
          sent_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Subscription Plans ───────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS subscription_plans (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          price NUMERIC(12,2) NOT NULL,
          currency TEXT DEFAULT 'PKR',
          billing_interval TEXT NOT NULL DEFAULT 'monthly',
          billing_interval_count INTEGER DEFAULT 1,
          trial_days INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Customer Subscriptions ───────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_subscriptions (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          status TEXT NOT NULL DEFAULT 'draft',
          current_period_start TIMESTAMPTZ,
          current_period_end TIMESTAMPTZ,
          trial_end TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          paused_at TIMESTAMPTZ,
          auto_charge BOOLEAN DEFAULT false,
          gateway_token TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Subscription Runs ────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS subscription_runs (
          id SERIAL PRIMARY KEY,
          subscription_id INTEGER NOT NULL REFERENCES customer_subscriptions(id) ON DELETE CASCADE,
          period_start TIMESTAMPTZ NOT NULL,
          period_end TIMESTAMPTZ NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          invoice_id INTEGER REFERENCES customer_invoices(id),
          charge_amount NUMERIC(12,2),
          charge_status TEXT,
          error TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ── Indexes ──────────────────────────────────────────────────
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_marketing_campaigns_status ON marketing_campaigns(status);
        CREATE INDEX IF NOT EXISTS idx_marketing_deliveries_campaign ON marketing_campaign_deliveries(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_marketing_deliveries_customer ON marketing_campaign_deliveries(customer_id);
        CREATE INDEX IF NOT EXISTS idx_message_threads_customer ON message_threads(customer_id);
        CREATE INDEX IF NOT EXISTS idx_message_threads_channel ON message_threads(channel, channel_identifier);
        CREATE INDEX IF NOT EXISTS idx_message_entries_thread ON message_entries(thread_id);
        CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer ON customer_invoices(customer_id);
        CREATE INDEX IF NOT EXISTS idx_customer_invoices_status ON customer_invoices(status);
        CREATE INDEX IF NOT EXISTS idx_customer_invoice_items_invoice ON customer_invoice_items(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_customer_invoice_payments_invoice ON customer_invoice_payments(invoice_id);
        CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_customer ON customer_subscriptions(customer_id);
        CREATE INDEX IF NOT EXISTS idx_customer_subscriptions_plan ON customer_subscriptions(plan_id);
        CREATE INDEX IF NOT EXISTS idx_subscription_runs_sub ON subscription_runs(subscription_id)
      `);

      // ── Seed feature flags ─────────────────────────────────────
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES
          ('marketing_campaigns', false),
          ('customer_messaging', false),
          ('customer_invoicing', false),
          ('payment_links', false),
          ('subscription_billing', false),
          ('sms_campaigns', false),
          ('subscription_autocharge', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 22,
    description: "Phase 4A — restaurant mode: floor plans, tables, sessions, seats, tabs, coursing, KDS, draft_orders context extension",
    up: async (client) => {
      // Floor plans
      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_floor_plans (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          name TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          layout_json JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_floor_sections (
          id SERIAL PRIMARY KEY,
          floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_tables (
          id SERIAL PRIMARY KEY,
          floor_plan_id INTEGER NOT NULL REFERENCES restaurant_floor_plans(id) ON DELETE CASCADE,
          section_id INTEGER REFERENCES restaurant_floor_sections(id) ON DELETE SET NULL,
          label TEXT NOT NULL,
          capacity INTEGER NOT NULL DEFAULT 4,
          shape TEXT DEFAULT 'square' CHECK (shape IN ('square','round','rectangle')),
          pos_x INTEGER DEFAULT 0,
          pos_y INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_tables_floor ON restaurant_tables(floor_plan_id)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
          id SERIAL PRIMARY KEY,
          table_id INTEGER NOT NULL REFERENCES restaurant_tables(id),
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          server_id INTEGER REFERENCES employees(id),
          guest_count INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'seated' CHECK (status IN ('seated','ordering','served','check_requested','closed')),
          seated_at TIMESTAMPTZ DEFAULT NOW(),
          closed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_table ON restaurant_table_sessions(table_id) WHERE status != 'closed'`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_outlet ON restaurant_table_sessions(outlet_id, status)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_check_seats (
          id SERIAL PRIMARY KEY,
          table_session_id INTEGER NOT NULL REFERENCES restaurant_table_sessions(id) ON DELETE CASCADE,
          draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
          seat_number INTEGER NOT NULL,
          label TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_check_seats_unique ON restaurant_check_seats(table_session_id, seat_number)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_check_adjustments (
          id SERIAL PRIMARY KEY,
          draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
          adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('service_charge','gratuity','rounding','discount')),
          label TEXT,
          amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          is_percentage BOOLEAN DEFAULT FALSE,
          percentage_value NUMERIC(6,4),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_check_adjustments_order ON restaurant_check_adjustments(draft_order_id)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_course_fires (
          id SERIAL PRIMARY KEY,
          draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id) ON DELETE CASCADE,
          course_name TEXT NOT NULL DEFAULT 'main',
          status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','fired','completed')),
          fired_at TIMESTAMPTZ,
          fired_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_course_fires_order ON restaurant_course_fires(draft_order_id)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_tabs (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          customer_id INTEGER REFERENCES customers(id),
          customer_name TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
          opened_by INTEGER REFERENCES employees(id),
          closed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_restaurant_tabs_outlet ON restaurant_tabs(outlet_id) WHERE status = 'open'`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_preauth_holds (
          id SERIAL PRIMARY KEY,
          tab_id INTEGER NOT NULL REFERENCES restaurant_tabs(id) ON DELETE CASCADE,
          gateway_ref TEXT,
          amount NUMERIC(12,2),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','captured','voided','expired')),
          provider TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // KDS
      await client.query(`
        CREATE TABLE IF NOT EXISTS kds_stations (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          name TEXT NOT NULL,
          station_role TEXT NOT NULL DEFAULT 'prep' CHECK (station_role IN ('prep','expo')),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_stations_outlet ON kds_stations(outlet_id)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS kds_station_routes (
          id SERIAL PRIMARY KEY,
          station_id INTEGER NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
          category_id INTEGER REFERENCES categories(id),
          match_all BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS kds_tickets (
          id SERIAL PRIMARY KEY,
          station_id INTEGER NOT NULL REFERENCES kds_stations(id),
          draft_order_id INTEGER NOT NULL REFERENCES draft_orders(id),
          table_label TEXT,
          seat_label TEXT,
          course_name TEXT DEFAULT 'main',
          status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','ready','bumped')),
          priority INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_tickets_station_status ON kds_tickets(station_id, status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_tickets_order ON kds_tickets(draft_order_id)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS kds_ticket_events (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK (event_type IN ('created','started','ready','bumped','recalled')),
          actor_id INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_kds_ticket_events_ticket ON kds_ticket_events(ticket_id)`);

      // Extend draft_orders
      await client.query(`
        ALTER TABLE draft_orders
          ADD COLUMN IF NOT EXISTS order_context TEXT DEFAULT 'retail',
          ADD COLUMN IF NOT EXISTS table_id INTEGER REFERENCES restaurant_tables(id),
          ADD COLUMN IF NOT EXISTS table_session_id INTEGER REFERENCES restaurant_table_sessions(id),
          ADD COLUMN IF NOT EXISTS tab_id INTEGER REFERENCES restaurant_tabs(id),
          ADD COLUMN IF NOT EXISTS seat_count INTEGER DEFAULT 0,
          ADD COLUMN IF NOT EXISTS dining_option TEXT,
          ADD COLUMN IF NOT EXISTS source_token_id TEXT
      `);

      // Extend draft_order_items with seat assignment
      await client.query(`
        ALTER TABLE draft_order_items
          ADD COLUMN IF NOT EXISTS seat_number INTEGER,
          ADD COLUMN IF NOT EXISTS course_name TEXT DEFAULT 'main',
          ADD COLUMN IF NOT EXISTS kitchen_status TEXT DEFAULT 'pending'
      `);

      // Seed feature flags
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES
          ('phase4_restaurant', false),
          ('phase4_restaurant_qr', false),
          ('phase4_restaurant_kds', false),
          ('phase4_restaurant_preauth', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 23,
    description: "Phase 4B — appointment booking: services, availability, appointments, reminders, waitlist, classes",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_services (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          duration_minutes INTEGER NOT NULL DEFAULT 30,
          padding_minutes INTEGER DEFAULT 0,
          price NUMERIC(12,2) DEFAULT 0,
          outlet_id INTEGER REFERENCES outlets(id),
          is_active BOOLEAN DEFAULT TRUE,
          requires_confirmation BOOLEAN DEFAULT FALSE,
          max_advance_days INTEGER DEFAULT 90,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_service_variants (
          id SERIAL PRIMARY KEY,
          service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL,
          price NUMERIC(12,2) DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_staff_assignments (
          id SERIAL PRIMARY KEY,
          service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          is_primary BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(service_id, employee_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_resources (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          name TEXT NOT NULL,
          resource_type TEXT DEFAULT 'room',
          capacity INTEGER DEFAULT 1,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_resource_assignments (
          id SERIAL PRIMARY KEY,
          service_id INTEGER NOT NULL REFERENCES booking_services(id) ON DELETE CASCADE,
          resource_id INTEGER NOT NULL REFERENCES booking_resources(id) ON DELETE CASCADE,
          UNIQUE(service_id, resource_id)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS booking_availability_rules (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER REFERENCES employees(id),
          outlet_id INTEGER REFERENCES outlets(id),
          service_id INTEGER REFERENCES booking_services(id),
          day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_availability_rules_employee ON booking_availability_rules(employee_id, day_of_week)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointment_blocks (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER REFERENCES employees(id),
          outlet_id INTEGER REFERENCES outlets(id),
          block_type TEXT NOT NULL DEFAULT 'unavailable' CHECK (block_type IN ('unavailable','break','closure')),
          start_at TIMESTAMPTZ NOT NULL,
          end_at TIMESTAMPTZ NOT NULL,
          reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_appointment_blocks_employee ON appointment_blocks(employee_id, start_at, end_at)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointments (
          id SERIAL PRIMARY KEY,
          service_id INTEGER NOT NULL REFERENCES booking_services(id),
          variant_id INTEGER REFERENCES booking_service_variants(id),
          customer_id INTEGER REFERENCES customers(id),
          employee_id INTEGER REFERENCES employees(id),
          resource_id INTEGER REFERENCES booking_resources(id),
          outlet_id INTEGER REFERENCES outlets(id),
          status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','in_progress','completed','cancelled','no_show')),
          start_at TIMESTAMPTZ NOT NULL,
          end_at TIMESTAMPTZ NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          customer_email TEXT,
          notes TEXT,
          source TEXT DEFAULT 'admin' CHECK (source IN ('admin','public','import')),
          cancelled_at TIMESTAMPTZ,
          cancellation_reason TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_employee_time ON appointments(employee_id, start_at, end_at) WHERE status NOT IN ('cancelled','no_show')`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_customer ON appointments(customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointment_segments (
          id SERIAL PRIMARY KEY,
          appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
          service_id INTEGER NOT NULL REFERENCES booking_services(id),
          employee_id INTEGER REFERENCES employees(id),
          start_at TIMESTAMPTZ NOT NULL,
          end_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointment_reminders (
          id SERIAL PRIMARY KEY,
          appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
          reminder_type TEXT NOT NULL DEFAULT 'before' CHECK (reminder_type IN ('before','followup')),
          minutes_before INTEGER NOT NULL DEFAULT 60,
          channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms')),
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
          scheduled_for TIMESTAMPTZ NOT NULL,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_appointment_reminders_scheduled ON appointment_reminders(scheduled_for) WHERE status = 'pending'`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS appointment_waitlist_entries (
          id SERIAL PRIMARY KEY,
          service_id INTEGER NOT NULL REFERENCES booking_services(id),
          customer_id INTEGER REFERENCES customers(id),
          employee_id INTEGER REFERENCES employees(id),
          preferred_date DATE,
          preferred_time_start TIME,
          preferred_time_end TIME,
          status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','booked','expired')),
          customer_name TEXT,
          customer_phone TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS class_sessions (
          id SERIAL PRIMARY KEY,
          service_id INTEGER NOT NULL REFERENCES booking_services(id),
          employee_id INTEGER REFERENCES employees(id),
          outlet_id INTEGER REFERENCES outlets(id),
          start_at TIMESTAMPTZ NOT NULL,
          end_at TIMESTAMPTZ NOT NULL,
          max_capacity INTEGER NOT NULL DEFAULT 10,
          status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS class_session_bookings (
          id SERIAL PRIMARY KEY,
          class_session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
          customer_id INTEGER REFERENCES customers(id),
          appointment_id INTEGER REFERENCES appointments(id),
          status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','no_show')),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS calendar_sync_accounts (
          id SERIAL PRIMARY KEY,
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          provider TEXT NOT NULL DEFAULT 'google',
          access_token TEXT,
          refresh_token TEXT,
          token_expires_at TIMESTAMPTZ,
          calendar_id TEXT,
          sync_enabled BOOLEAN DEFAULT FALSE,
          last_synced_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Seed feature flags
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES
          ('phase4_appointments', false),
          ('phase4_appointments_waitlists', false),
          ('phase4_appointments_classes', false),
          ('phase4_google_calendar_sync', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },

  // ── v24: Phase 4C — Service Workspace ──────────────────────────────
  {
    version: 24,
    description: "Phase 4C — Service workspace: projects, contracts, billing extensions",
    up: async (client) => {
      // service_projects
      await client.query(`
        CREATE TABLE IF NOT EXISTS service_projects (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER REFERENCES customers(id),
          outlet_id INTEGER REFERENCES outlets(id),
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','on_hold','completed','cancelled')),
          start_date DATE,
          target_end_date DATE,
          actual_end_date DATE,
          budget NUMERIC(12,2),
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_projects_customer ON service_projects(customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_projects_status ON service_projects(status)`);

      // project_contacts
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_contacts (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
          customer_id INTEGER REFERENCES customers(id),
          name TEXT NOT NULL,
          email TEXT,
          phone TEXT,
          role TEXT DEFAULT 'client',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // project_milestones
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_milestones (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          description TEXT,
          due_date DATE,
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','skipped')),
          sort_order INTEGER DEFAULT 0,
          amount NUMERIC(12,2),
          invoice_on_completion BOOLEAN DEFAULT FALSE,
          completed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id)`);

      // project_activities
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_activities (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES employees(id),
          activity_type TEXT NOT NULL CHECK (activity_type IN ('note','status_change','milestone_update','file_upload','invoice_created','payment_received')),
          description TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_project_activities_project ON project_activities(project_id)`);

      // contract_templates
      await client.query(`
        CREATE TABLE IF NOT EXISTS contract_templates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          body_html TEXT NOT NULL DEFAULT '',
          variables JSONB DEFAULT '[]',
          is_active BOOLEAN DEFAULT TRUE,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // contracts
      await client.query(`
        CREATE TABLE IF NOT EXISTS contracts (
          id SERIAL PRIMARY KEY,
          project_id INTEGER REFERENCES service_projects(id),
          customer_id INTEGER REFERENCES customers(id),
          template_id INTEGER REFERENCES contract_templates(id),
          title TEXT NOT NULL,
          body_html TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','viewed','signed','countersigned','expired','cancelled')),
          sent_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ,
          signed_at TIMESTAMPTZ,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_contracts_customer ON contracts(customer_id)`);

      // contract_signers
      await client.query(`
        CREATE TABLE IF NOT EXISTS contract_signers (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          email TEXT,
          role TEXT DEFAULT 'signer',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','declined')),
          signed_at TIMESTAMPTZ,
          signature_data TEXT,
          ip_address TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // contract_events
      await client.query(`
        CREATE TABLE IF NOT EXISTS contract_events (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
          event_type TEXT NOT NULL CHECK (event_type IN ('created','sent','viewed','signed','countersigned','expired','cancelled')),
          actor TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_contract_events_contract ON contract_events(contract_id)`);

      // project_files
      await client.query(`
        CREATE TABLE IF NOT EXISTS project_files (
          id SERIAL PRIMARY KEY,
          project_id INTEGER NOT NULL REFERENCES service_projects(id) ON DELETE CASCADE,
          file_name TEXT NOT NULL,
          file_url TEXT NOT NULL,
          file_size INTEGER,
          mime_type TEXT,
          uploaded_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id)`);

      // Extend quotations for project billing
      await client.query(`ALTER TABLE quotations ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES service_projects(id)`);
      await client.query(`ALTER TABLE quotations ADD COLUMN IF NOT EXISTS estimate_status TEXT DEFAULT 'draft' CHECK (estimate_status IN ('draft','sent','approved','rejected'))`);
      await client.query(`ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE quotations ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES employees(id)`);

      // Extend customer_invoices for project billing
      await client.query(`ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES service_projects(id)`);
      await client.query(`ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS milestone_id INTEGER REFERENCES project_milestones(id)`);
      await client.query(`ALTER TABLE customer_invoices ADD COLUMN IF NOT EXISTS invoice_kind TEXT DEFAULT 'standard' CHECK (invoice_kind IN ('standard','milestone','retainer','final'))`);

      // Extend customer_subscriptions for project billing
      await client.query(`ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES service_projects(id)`);
      await client.query(`ALTER TABLE customer_subscriptions ADD COLUMN IF NOT EXISTS billing_template_id INTEGER`);

      // Seed feature flags
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES
          ('phase4_service_projects', false),
          ('phase4_service_contracts', false),
          ('phase4_contract_ai', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },

  // ── v25: Phase 5 — Pakistan Integration Depth ─────────────────────
  {
    version: 25,
    description: "Phase 5 — shipping automation, COD reconciliation, payment expansion, SMS providers",
    up: async (client) => {
      // ── Shipping Automation ───────────────────────────────────────

      // order_shipments — durable shipment record per booking attempt
      await client.query(`
        CREATE TABLE IF NOT EXISTS order_shipments (
          id SERIAL PRIMARY KEY,
          web_order_id INTEGER REFERENCES web_orders(id),
          courier_id INTEGER REFERENCES courier_integrations(id),
          tracking_number TEXT,
          label_url TEXT,
          booking_ref TEXT,
          booking_payload JSONB,
          booking_response JSONB,
          status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','booked','in_transit','delivered','cancelled','failed')),
          shipping_cost NUMERIC(12,2),
          booked_at TIMESTAMPTZ,
          cancelled_at TIMESTAMPTZ,
          delivered_at TIMESTAMPTZ,
          last_tracking_refresh_at TIMESTAMPTZ,
          last_tracking_payload JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_shipments_order ON order_shipments(web_order_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_order_shipments_tracking ON order_shipments(tracking_number)`);

      // shipment_tracking_events — tracking event log
      await client.query(`
        CREATE TABLE IF NOT EXISTS shipment_tracking_events (
          id SERIAL PRIMARY KEY,
          shipment_id INTEGER NOT NULL REFERENCES order_shipments(id) ON DELETE CASCADE,
          event_status TEXT,
          event_description TEXT,
          event_location TEXT,
          event_timestamp TIMESTAMPTZ,
          raw_payload JSONB,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_shipment_events_shipment ON shipment_tracking_events(shipment_id)`);

      // Extend courier_integrations with capability flags and config
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS supports_booking BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS supports_tracking BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS supports_cancellation BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS supports_labels BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS provider_category TEXT DEFAULT 'domestic'`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS flat_shipping_rate NUMERIC(10,2)`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS encrypted_config_json TEXT`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS last_healthcheck_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE courier_integrations ADD COLUMN IF NOT EXISTS last_healthcheck_status TEXT`);

      // Seed capability flags for couriers with real adapter implementations
      await client.query(`
        UPDATE courier_integrations SET
          supports_booking = true,
          supports_tracking = true
        WHERE adapter_key IN ('leopards','tcs','blueex','trax','postex','callcourier','mnp','rider','swyft','dhl','fedex')
      `);
      await client.query(`
        UPDATE courier_integrations SET provider_category = 'international'
        WHERE adapter_key IN ('dhl','fedex')
      `);

      // Extend web_orders with shipment reference
      await client.query(`ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS active_shipment_id INTEGER REFERENCES order_shipments(id)`);
      await client.query(`ALTER TABLE web_orders ADD COLUMN IF NOT EXISTS shipping_provider_status TEXT`);

      // ── COD Reconciliation ────────────────────────────────────────

      // cod_settlement_batches — imported courier remittance batches
      await client.query(`
        CREATE TABLE IF NOT EXISTS cod_settlement_batches (
          id SERIAL PRIMARY KEY,
          courier_id INTEGER REFERENCES courier_integrations(id),
          batch_ref TEXT,
          import_source TEXT DEFAULT 'csv' CHECK (import_source IN ('csv','manual','api')),
          total_lines INTEGER DEFAULT 0,
          total_amount NUMERIC(12,2) DEFAULT 0,
          matched_count INTEGER DEFAULT 0,
          matched_amount NUMERIC(12,2) DEFAULT 0,
          unmatched_count INTEGER DEFAULT 0,
          short_amount NUMERIC(12,2) DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'imported' CHECK (status IN ('imported','matching','review','approved','rejected')),
          imported_by INTEGER REFERENCES employees(id),
          approved_by INTEGER REFERENCES employees(id),
          imported_at TIMESTAMPTZ DEFAULT NOW(),
          approved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // cod_settlement_lines — individual remittance lines
      await client.query(`
        CREATE TABLE IF NOT EXISTS cod_settlement_lines (
          id SERIAL PRIMARY KEY,
          batch_id INTEGER NOT NULL REFERENCES cod_settlement_batches(id) ON DELETE CASCADE,
          courier_tracking_number TEXT,
          courier_order_ref TEXT,
          remitted_amount NUMERIC(12,2),
          courier_fee NUMERIC(12,2),
          match_status TEXT NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('unmatched','matched','short','over','duplicate')),
          matched_order_id INTEGER REFERENCES web_orders(id),
          matched_loadsheet_order_id INTEGER,
          expected_amount NUMERIC(12,2),
          difference NUMERIC(12,2),
          resolution_note TEXT,
          resolved_by INTEGER REFERENCES employees(id),
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_cod_lines_batch ON cod_settlement_lines(batch_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_cod_lines_tracking ON cod_settlement_lines(courier_tracking_number)`);

      // Extend loadsheets with reconciliation state
      await client.query(`ALTER TABLE loadsheets ADD COLUMN IF NOT EXISTS reconciliation_status TEXT DEFAULT 'pending'`);
      await client.query(`ALTER TABLE loadsheets ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE loadsheets ADD COLUMN IF NOT EXISTS reconciled_by INTEGER REFERENCES employees(id)`);
      await client.query(`ALTER TABLE loadsheets ADD COLUMN IF NOT EXISTS expected_cod NUMERIC(12,2)`);
      await client.query(`ALTER TABLE loadsheets ADD COLUMN IF NOT EXISTS received_cod NUMERIC(12,2)`);
      await client.query(`ALTER TABLE loadsheets ADD COLUMN IF NOT EXISTS cod_difference NUMERIC(12,2)`);

      // ── Payment Expansion ─────────────────────────────────────────

      // payment_webhook_events — idempotent webhook log
      await client.query(`
        CREATE TABLE IF NOT EXISTS payment_webhook_events (
          id SERIAL PRIMARY KEY,
          provider TEXT NOT NULL,
          event_id TEXT NOT NULL,
          event_type TEXT,
          payment_context TEXT CHECK (payment_context IN ('billing','invoice','storefront')),
          context_ref TEXT,
          raw_payload JSONB,
          processed_at TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_webhook_events_unique ON payment_webhook_events(provider, event_id)`);

      // storefront_payment_sessions — storefront checkout payment tracking
      await client.query(`
        CREATE TABLE IF NOT EXISTS storefront_payment_sessions (
          id SERIAL PRIMARY KEY,
          web_order_id INTEGER REFERENCES web_orders(id),
          provider TEXT NOT NULL,
          provider_ref TEXT,
          amount NUMERIC(12,2),
          currency_code TEXT DEFAULT 'PKR',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','expired')),
          return_url TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ
        )
      `);

      // Extend payment_intents
      await client.query(`ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider TEXT`);
      await client.query(`ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS provider_status TEXT`);
      await client.query(`ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS last_event_at TIMESTAMPTZ`);

      // Extend customer_invoice_payment_links
      await client.query(`ALTER TABLE customer_invoice_payment_links ADD COLUMN IF NOT EXISTS provider TEXT`);
      await client.query(`ALTER TABLE customer_invoice_payment_links ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE customer_invoice_payment_links ADD COLUMN IF NOT EXISTS raw_completion_payload JSONB`);

      // Extend web_order_transactions
      await client.query(`ALTER TABLE web_order_transactions ADD COLUMN IF NOT EXISTS provider_ref TEXT`);
      await client.query(`ALTER TABLE web_order_transactions ADD COLUMN IF NOT EXISTS payment_context TEXT`);
      await client.query(`ALTER TABLE web_order_transactions ADD COLUMN IF NOT EXISTS webhook_event_id INTEGER`);

      // ── SMS Provider ──────────────────────────────────────────────

      // sms_provider_messages — SMS delivery log
      await client.query(`
        CREATE TABLE IF NOT EXISTS sms_provider_messages (
          id SERIAL PRIMARY KEY,
          provider TEXT NOT NULL,
          recipient_phone TEXT NOT NULL,
          message_type TEXT DEFAULT 'transactional' CHECK (message_type IN ('transactional','marketing')),
          message_body TEXT,
          provider_ref TEXT,
          delivery_status TEXT NOT NULL DEFAULT 'queued' CHECK (delivery_status IN ('queued','sent','delivered','failed')),
          failure_reason TEXT,
          cost NUMERIC(8,4),
          sent_at TIMESTAMPTZ,
          delivered_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_ref ON sms_provider_messages(provider_ref)`);

      // ── Feature Flags ─────────────────────────────────────────────

      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES
          ('phase5_shipping_automation', false),
          ('phase5_cod_reconciliation', false),
          ('phase5_payment_gateways', false),
          ('phase5_sms_providers', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 26,
    description: "Backfill missing Phase 2 feature flags (never seeded by earlier migrations)",
    up: async (client) => {
      await client.query(`
        INSERT INTO feature_flags (key, enabled, description) VALUES
          ('phase2_scheduling', false, 'Employee shift scheduling'),
          ('phase2_outlet_pricing', false, 'Per-outlet price list assignments'),
          ('phase2_draft_orders', false, 'Draft orders / quotes from POS'),
          ('phase2_pos_approvals', false, 'POS approval policies'),
          ('phase2_returns_policy', false, 'Configurable return policies'),
          ('phase2_smart_collections', false, 'Smart product collections'),
          ('phase2_outlet_visibility', false, 'Per-outlet product visibility'),
          ('phase2_outlet_tax', false, 'Per-outlet tax profiles'),
          ('phase2_scheduled_changes', false, 'Scheduled catalog changes'),
          ('phase2_commissions', false, 'Sales commission plans'),
          ('phase2_report_builder', false, 'Custom report builder'),
          ('phase2_pos_layouts', false, 'Customizable POS layouts'),
          ('phase2_item_suggestions', false, 'AI item suggestions at POS')
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 27,
    description: "Add voided + void_reason columns to supplier_payments (void-payment endpoint)",
    up: async (client) => {
      await client.query(`
        ALTER TABLE supplier_payments
          ADD COLUMN IF NOT EXISTS voided BOOLEAN DEFAULT false
      `);
      await client.query(`
        ALTER TABLE supplier_payments
          ADD COLUMN IF NOT EXISTS void_reason TEXT
      `);
    },
  },
  {
    version: 28,
    description: "Partial UNIQUE index on draft_orders.source_token_id for QR lookup",
    up: async (client) => {
      // Enforces one-token-to-one-check and speeds up the public menu
      // lookup at routes/public-restaurant.js. Partial index skips NULLs
      // so non-restaurant draft orders (retail/takeout/delivery) don't
      // trigger the constraint. Safe on live tenants because no existing
      // row has a non-NULL source_token_id (the column was added in v22
      // but never populated until this fix).
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_draft_orders_source_token
          ON draft_orders(source_token_id)
          WHERE source_token_id IS NOT NULL
      `);
    },
  },
  {
    version: 29,
    description: "Add kds_ticket_items junction — fixes Phase 4 C3 read-side fan-out",
    up: async (client) => {
      // Phase 4 C3 revised fix. Commit 3155263 collapsed sendToKitchen's
      // per-item INSERT loop into per-(station, course) groups — write side
      // correct — but getTickets still joins draft_order_items by
      // (draft_order_id, course_name) with no station filter, so each
      // station's ticket still shows every item in that course. Adding a
      // junction table lets getTickets join ticket → item via explicit
      // routing, restoring one-ticket = one-station's-portion semantics.
      //
      // Safe on live tenants: kds_tickets is empty on all 3 live tenants
      // (verified 2026-04-11) so the FK add has nothing to conflict with.
      await client.query(`
        CREATE TABLE IF NOT EXISTS kds_ticket_items (
          ticket_id INTEGER NOT NULL REFERENCES kds_tickets(id) ON DELETE CASCADE,
          draft_order_item_id INTEGER NOT NULL REFERENCES draft_order_items(id) ON DELETE CASCADE,
          PRIMARY KEY (ticket_id, draft_order_item_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_kds_ticket_items_item
          ON kds_ticket_items(draft_order_item_id)
      `);
    },
  },
  {
    version: 30,
    description: "Add products.created_at TIMESTAMPTZ for smart-collections sort hygiene",
    up: async (client) => {
      // Backs the smart-collections `created_at_desc` sort alias with a
      // real column. Before v30, routes/smart-collections.js aliased the
      // alias to `p.id DESC` as a workaround because the column didn't
      // exist. Per drive-by decision D2: backfill all existing rows with
      // NOW() rather than interpolating from id order. Existing rows tie
      // on timestamp and fall back to `p.id DESC` for deterministic
      // ordering; new rows after v30 get proper chronological sort.
      // ALTER TABLE ADD COLUMN DEFAULT NOW() is O(1) metadata-only on
      // Postgres 11+ (Supabase runs 15+) — no table rewrite.
      await client.query(`
        ALTER TABLE products
          ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
      `);
      await client.query(`
        UPDATE products SET created_at = NOW() WHERE created_at IS NULL
      `);
    },
  },
  {
    version: 31,
    description: "Tenant preset engine — industry columns on company_profile + tenant_modes table",
    up: async (client) => {
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS industry_type TEXT DEFAULT 'general_retail',
          ADD COLUMN IF NOT EXISTS business_model TEXT DEFAULT 'buy_sell',
          ADD COLUMN IF NOT EXISTS country_code TEXT DEFAULT 'PK',
          ADD COLUMN IF NOT EXISTS industry_preset_version INTEGER DEFAULT 1
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS tenant_modes (
          mode TEXT NOT NULL PRIMARY KEY,
          enabled BOOLEAN DEFAULT true,
          enabled_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    },
  },
  {
    version: 32,
    description: "M2 — service_tickets + ticket_activities tables, subscription cancel_reason + grace_period_end",
    up: async (client) => {
      // ── Workflow Tickets ──────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS service_tickets (
          id SERIAL PRIMARY KEY,
          ticket_number TEXT NOT NULL UNIQUE,
          customer_id INTEGER REFERENCES customers(id),
          outlet_id INTEGER REFERENCES outlets(id),
          created_by INTEGER NOT NULL REFERENCES employees(id),
          assigned_to INTEGER REFERENCES employees(id),
          status TEXT NOT NULL DEFAULT 'intake'
            CHECK (status IN ('intake','approved','in_progress','on_hold','completed','invoiced','cancelled')),
          title TEXT NOT NULL,
          description TEXT,
          notes TEXT,
          deposit_amount NUMERIC(12,2) DEFAULT 0,
          deposit_paid_at TIMESTAMPTZ,
          deposit_method TEXT,
          final_invoice_id INTEGER REFERENCES customer_invoices(id),
          expected_completion DATE,
          actual_completion TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_tickets_customer ON service_tickets(customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_tickets_status ON service_tickets(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_service_tickets_assigned ON service_tickets(assigned_to)`);

      await client.query(`
        CREATE TABLE IF NOT EXISTS service_ticket_activities (
          id SERIAL PRIMARY KEY,
          ticket_id INTEGER NOT NULL REFERENCES service_tickets(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES employees(id),
          activity_type TEXT NOT NULL
            CHECK (activity_type IN ('note','status_change','assignment','deposit_recorded','invoice_generated')),
          description TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_ticket_activities_ticket ON service_ticket_activities(ticket_id)`);

      // ── Subscription Billing Polish ───────────────────────────────
      await client.query(`
        ALTER TABLE customer_subscriptions
          ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
          ADD COLUMN IF NOT EXISTS grace_period_end TIMESTAMPTZ
      `);

      // ── Feature flag ──────────────────────────────────────────────
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES ('phase4_workflow_tickets', true)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 33,
    description: "M4 — clinic patient extension columns on customers",
    up: async (client) => {
      await client.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS blood_group VARCHAR(5),
          ADD COLUMN IF NOT EXISTS allergies TEXT,
          ADD COLUMN IF NOT EXISTS medical_notes TEXT,
          ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT,
          ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT,
          ADD COLUMN IF NOT EXISTS insurance_id TEXT
      `);
    },
  },
  {
    version: 34,
    description: "M5 — decimal quantity support + gross/tare weight columns on sale_items",
    up: async (client) => {
      // Widen quantity to NUMERIC(10,3) for weight/length-based selling.
      // Lossless cast — existing integer values widen cleanly. Brief ACCESS
      // EXCLUSIVE lock; no table rewrite in PG 12+.
      await client.query(`
        ALTER TABLE sale_items
          ALTER COLUMN quantity TYPE NUMERIC(10,3) USING quantity::numeric
      `);
      // Gross/tare columns preserve audit trail for weighted sales.
      // Nullable — non-weighted rows leave them NULL.
      await client.query(`
        ALTER TABLE sale_items
          ADD COLUMN IF NOT EXISTS gross_weight NUMERIC(10,3),
          ADD COLUMN IF NOT EXISTS tare_weight NUMERIC(10,3) DEFAULT 0
      `);
    },
  },
  {
    // Originally authored as a duplicate "version: 32" (collision with M2's v32).
    // The migration runner's `pending.filter(v > currentVersion)` skipped this
    // block because M2 v32 already bumped schema_version. Re-numbered to v35
    // so the SanoPay gateway_ref columns actually get applied in production.
    // Idempotent — uses ADD COLUMN IF NOT EXISTS.
    version: 35,
    description: "SanoPay sandbox — gateway_ref on sale_payments + returns for payment tracing",
    up: async (client) => {
      await client.query(`
        ALTER TABLE sale_payments
          ADD COLUMN IF NOT EXISTS gateway_ref TEXT
      `);
      await client.query(`
        ALTER TABLE returns
          ADD COLUMN IF NOT EXISTS gateway_refund_ref TEXT
      `);
    },
  },
  {
    version: 36,
    description: "M7 — rentals mode (items, assets, contracts, lines, activities) + phase4_rentals feature flag",
    up: async (client) => {
      // ── Rental item types (the "what" you can rent) ───────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS rental_items (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT,
          description TEXT,
          outlet_id INTEGER REFERENCES outlets(id),
          total_quantity INTEGER NOT NULL DEFAULT 1,
          daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
          hourly_rate NUMERIC(12,2),
          weekly_rate NUMERIC(12,2),
          deposit_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          payment_policy TEXT NOT NULL DEFAULT 'upfront'
            CHECK (payment_policy IN ('upfront','on_return')),
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_items_outlet ON rental_items(outlet_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_items_active ON rental_items(is_active)`);

      // ── Optional per-unit asset tracking (serial numbers) ─────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS rental_assets (
          id SERIAL PRIMARY KEY,
          rental_item_id INTEGER NOT NULL REFERENCES rental_items(id) ON DELETE CASCADE,
          serial_number TEXT,
          label TEXT,
          status TEXT NOT NULL DEFAULT 'available'
            CHECK (status IN ('available','rented','maintenance','retired')),
          condition_notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_assets_item ON rental_assets(rental_item_id)`);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_assets_serial
          ON rental_assets(rental_item_id, serial_number)
          WHERE serial_number IS NOT NULL
      `);

      // ── Rental contracts (the core rental document) ───────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS rental_contracts (
          id SERIAL PRIMARY KEY,
          contract_number TEXT NOT NULL UNIQUE,
          customer_id INTEGER REFERENCES customers(id),
          outlet_id INTEGER REFERENCES outlets(id),
          created_by INTEGER NOT NULL REFERENCES employees(id),
          status TEXT NOT NULL DEFAULT 'reserved'
            CHECK (status IN ('reserved','confirmed','checked_out','returned','completed','invoiced','cancelled')),
          rental_start TIMESTAMPTZ NOT NULL,
          rental_end TIMESTAMPTZ,
          expected_return TIMESTAMPTZ NOT NULL,
          actual_checkin TIMESTAMPTZ,
          actual_return TIMESTAMPTZ,
          deposit_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_method TEXT,
          deposit_paid_at TIMESTAMPTZ,
          payment_policy TEXT NOT NULL DEFAULT 'upfront'
            CHECK (payment_policy IN ('upfront','on_return')),
          rental_fee_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          late_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
          late_fee_overridden BOOLEAN NOT NULL DEFAULT FALSE,
          discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
          final_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          invoice_id INTEGER REFERENCES customer_invoices(id),
          overdue_email_sent_at TIMESTAMPTZ,
          cancellation_reason TEXT,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_contracts_status ON rental_contracts(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_contracts_customer ON rental_contracts(customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_contracts_outlet ON rental_contracts(outlet_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rental_contracts_overdue
          ON rental_contracts(expected_return)
          WHERE status = 'checked_out'
      `);

      // ── Contract line items (one row per item in a contract) ──────
      await client.query(`
        CREATE TABLE IF NOT EXISTS rental_contract_lines (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
          rental_item_id INTEGER NOT NULL REFERENCES rental_items(id),
          rental_asset_id INTEGER REFERENCES rental_assets(id),
          quantity INTEGER NOT NULL DEFAULT 1,
          rate_type TEXT NOT NULL DEFAULT 'daily'
            CHECK (rate_type IN ('hourly','daily','weekly')),
          rate_snapshot NUMERIC(12,2) NOT NULL,
          duration_value NUMERIC(10,2) NOT NULL DEFAULT 1,
          line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_contract_lines_contract ON rental_contract_lines(contract_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rental_contract_lines_asset
          ON rental_contract_lines(rental_asset_id)
          WHERE rental_asset_id IS NOT NULL
      `);

      // ── Contract audit trail ──────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS rental_contract_activities (
          id SERIAL PRIMARY KEY,
          contract_id INTEGER NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES employees(id),
          activity_type TEXT NOT NULL
            CHECK (activity_type IN ('status_change','note','deposit_recorded','late_fee_applied','invoice_generated','overdue_alert_sent','checkin','return')),
          description TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rental_contract_activities_contract ON rental_contract_activities(contract_id)`);

      // ── Feature flag ──────────────────────────────────────────────
      // Seeded as FALSE — mode-gated flag, flipped ON only when a rental
      // preset is selected during setup or via company-profile industry edit.
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES ('phase4_rentals', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 37,
    description: "M8 — customer portal auth (customers columns + OTP/reset/refresh tables)",
    up: async (client) => {
      // Extend customers with portal auth columns.
      await client.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS portal_password_hash TEXT,
          ADD COLUMN IF NOT EXISTS portal_enabled_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS portal_tokens_revoked_before TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS portal_last_login_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS portal_email_verified_at TIMESTAMPTZ
      `);

      // Partial unique index — only enforced once a customer has enabled portal access.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS customers_portal_email_unique
          ON customers (LOWER(email))
          WHERE portal_enabled_at IS NOT NULL AND email IS NOT NULL AND deleted_at IS NULL
      `);

      // One-time passcodes (login, reset, verify) — short-lived, hashed.
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_portal_otps (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          purpose TEXT NOT NULL CHECK (purpose IN ('login','password_reset','email_verify')),
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          ip TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS customer_portal_otps_lookup
          ON customer_portal_otps (LOWER(email), purpose, expires_at)
      `);

      // Password-reset tokens — long, single-use.
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_portal_reset_tokens (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Refresh tokens — SHA-256 hashed, revocable, UA/IP trail for session management.
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_portal_refresh_tokens (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_used_at TIMESTAMPTZ,
          user_agent TEXT,
          ip TEXT
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS customer_portal_refresh_tokens_customer
          ON customer_portal_refresh_tokens (customer_id) WHERE revoked_at IS NULL
      `);

      // Broaden the appointments.source CHECK to include 'portal'. Idempotent:
      // drop-if-exists then re-add. Safe because we never change the values,
      // only the allowed set.
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_name = 'appointments' AND constraint_name = 'appointments_source_check'
          ) THEN
            ALTER TABLE appointments DROP CONSTRAINT appointments_source_check;
          END IF;
        END$$;
      `);
      await client.query(`
        ALTER TABLE appointments
          ADD CONSTRAINT appointments_source_check
          CHECK (source IN ('admin','public','import','portal'))
      `);
    },
  },
  {
    version: 38,
    description: "M9 — room management mode (types, rooms, bookings, folios, lines, rate overrides) + phase4_room_management flag + sales.folio_id",
    up: async (client) => {
      // ── Room types (the "Deluxe Room", "Standard Twin" catalog) ───
      await client.query(`
        CREATE TABLE IF NOT EXISTS room_types (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER REFERENCES outlets(id),
          name TEXT NOT NULL,
          description TEXT,
          capacity INTEGER NOT NULL DEFAULT 2,
          base_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_required NUMERIC(12,2) NOT NULL DEFAULT 0,
          amenities JSONB NOT NULL DEFAULT '[]'::jsonb,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_room_types_outlet ON room_types(outlet_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_room_types_active ON room_types(is_active)`);

      // ── Rooms (physical units — "Room 201", "Room 202") ───────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS rooms (
          id SERIAL PRIMARY KEY,
          room_type_id INTEGER REFERENCES room_types(id),
          outlet_id INTEGER REFERENCES outlets(id),
          room_number TEXT NOT NULL,
          floor TEXT,
          occupancy_status TEXT NOT NULL DEFAULT 'vacant'
            CHECK (occupancy_status IN ('vacant','occupied','reserved')),
          housekeeping_status TEXT NOT NULL DEFAULT 'clean'
            CHECK (housekeeping_status IN ('clean','dirty','inspected','out_of_order')),
          notes TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (outlet_id, room_number)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rooms_outlet ON rooms(outlet_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_rooms_active ON rooms(is_active)`);

      // ── Per-date rate overrides (weekend, seasonal, holiday) ──────
      await client.query(`
        CREATE TABLE IF NOT EXISTS room_rate_overrides (
          id SERIAL PRIMARY KEY,
          room_type_id INTEGER NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
          from_date DATE NOT NULL,
          to_date DATE NOT NULL,
          rate NUMERIC(12,2) NOT NULL,
          label TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          CHECK (from_date <= to_date)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_room_rate_overrides_range
          ON room_rate_overrides(room_type_id, from_date, to_date)
      `);

      // ── Bookings / reservations ───────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS room_bookings (
          id SERIAL PRIMARY KEY,
          booking_number TEXT NOT NULL UNIQUE,
          customer_id INTEGER REFERENCES customers(id),
          outlet_id INTEGER REFERENCES outlets(id),
          created_by INTEGER REFERENCES employees(id),
          room_id INTEGER REFERENCES rooms(id),
          room_type_id INTEGER REFERENCES room_types(id),
          status TEXT NOT NULL DEFAULT 'reserved'
            CHECK (status IN ('reserved','confirmed','checked_in','checked_out','completed','invoiced','cancelled','no_show')),
          check_in_date DATE NOT NULL,
          check_out_date DATE NOT NULL,
          actual_checkin TIMESTAMPTZ,
          actual_checkout TIMESTAMPTZ,
          nights INTEGER NOT NULL,
          rate_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_method TEXT,
          deposit_payment_intent_id TEXT,
          deposit_status TEXT NOT NULL DEFAULT 'pending'
            CHECK (deposit_status IN ('pending','authorized','captured','released','failed')),
          notes TEXT,
          cancellation_reason TEXT,
          overdue_email_sent_at TIMESTAMPTZ,
          invoice_id INTEGER REFERENCES customer_invoices(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          CHECK (check_out_date > check_in_date)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_room_bookings_dates ON room_bookings(room_id, check_in_date, check_out_date)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_room_bookings_status ON room_bookings(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_room_bookings_customer ON room_bookings(customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_room_bookings_outlet ON room_bookings(outlet_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_room_bookings_overdue
          ON room_bookings(check_out_date)
          WHERE status = 'checked_in'
      `);

      // ── Guest folios (running tab during stay) ────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS guest_folios (
          id SERIAL PRIMARY KEY,
          booking_id INTEGER NOT NULL REFERENCES room_bookings(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','settled','voided')),
          room_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          pos_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
          grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          settled_at TIMESTAMPTZ,
          invoice_id INTEGER REFERENCES customer_invoices(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_guest_folios_booking ON guest_folios(booking_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_guest_folios_status ON guest_folios(status)`);

      // ── Folio line items ──────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS folio_lines (
          id SERIAL PRIMARY KEY,
          folio_id INTEGER NOT NULL REFERENCES guest_folios(id) ON DELETE CASCADE,
          line_type TEXT NOT NULL
            CHECK (line_type IN ('room_night','pos_sale','manual_charge','discount','tax')),
          description TEXT NOT NULL,
          quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          sale_id INTEGER REFERENCES sales(id),
          added_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_folio_lines_folio ON folio_lines(folio_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_folio_lines_sale
          ON folio_lines(sale_id)
          WHERE sale_id IS NOT NULL
      `);

      // ── POS -> folio link on sales ────────────────────────────────
      await client.query(`
        ALTER TABLE sales
          ADD COLUMN IF NOT EXISTS folio_id INTEGER REFERENCES guest_folios(id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sales_folio_id
          ON sales(folio_id) WHERE folio_id IS NOT NULL
      `);

      // ── Feature flag ──────────────────────────────────────────────
      // Mode-gated flag, flipped ON only when a hotel/guesthouse/hostel
      // preset is selected during setup or via industry edit.
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES ('phase4_room_management', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 39,
    description: "M10 — treatment_plans mode (patient subjects, plans, sessions, chart, labs, consent, documents, folios) + phase4_treatment_plans flag",
    up: async (client) => {
      // ── Pets / dependents — generic subject sub-entity of customer ──
      await client.query(`
        CREATE TABLE IF NOT EXISTS patient_subjects (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          subject_type TEXT NOT NULL DEFAULT 'self'
            CHECK (subject_type IN ('self','dependent','pet')),
          name TEXT NOT NULL,
          species TEXT,
          breed TEXT,
          dob DATE,
          sex TEXT,
          weight_kg NUMERIC(10,2),
          identifier TEXT,
          photo_url TEXT,
          notes TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_patient_subjects_customer
          ON patient_subjects(customer_id)
          WHERE is_active = TRUE
      `);

      // ── Treatment plans (the durable multi-visit record) ──────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS treatment_plans (
          id SERIAL PRIMARY KEY,
          plan_number TEXT NOT NULL UNIQUE,
          customer_id INTEGER NOT NULL REFERENCES customers(id),
          subject_id INTEGER REFERENCES patient_subjects(id),
          outlet_id INTEGER REFERENCES outlets(id),
          created_by INTEGER NOT NULL REFERENCES employees(id),
          provider_id INTEGER REFERENCES employees(id),
          title TEXT NOT NULL,
          diagnosis_code TEXT,
          diagnosis_notes TEXT,
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft','active','on_hold','completed','discontinued','invoiced')),
          start_date DATE,
          expected_end_date DATE,
          actual_end_date DATE,
          total_sessions_planned INTEGER NOT NULL DEFAULT 1,
          sessions_completed INTEGER NOT NULL DEFAULT 0,
          estimated_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_method TEXT,
          deposit_paid_at TIMESTAMPTZ,
          deposit_payment_intent_id TEXT,
          deposit_status TEXT
            CHECK (deposit_status IS NULL OR deposit_status IN ('pending','authorized','captured','released','failed')),
          final_invoice_id INTEGER REFERENCES customer_invoices(id),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_plans_status ON treatment_plans(status)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_plans_customer ON treatment_plans(customer_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_plans_subject ON treatment_plans(subject_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_plans_provider ON treatment_plans(provider_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_treatment_plans_overdue
          ON treatment_plans(expected_end_date)
          WHERE status = 'active'
      `);

      // ── Treatment sessions (a visit within a plan) ────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS treatment_sessions (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
          session_number INTEGER NOT NULL,
          appointment_id INTEGER,
          provider_id INTEGER REFERENCES employees(id),
          scheduled_at TIMESTAMPTZ,
          actual_start_at TIMESTAMPTZ,
          actual_end_at TIMESTAMPTZ,
          status TEXT NOT NULL DEFAULT 'scheduled'
            CHECK (status IN ('scheduled','in_progress','completed','no_show','cancelled')),
          chief_complaint TEXT,
          soap_subjective TEXT,
          soap_objective TEXT,
          soap_assessment TEXT,
          soap_plan TEXT,
          next_session_notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (plan_id, session_number)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_sessions_plan ON treatment_sessions(plan_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_treatment_sessions_appointment
          ON treatment_sessions(appointment_id)
          WHERE appointment_id IS NOT NULL
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_sessions_status_scheduled ON treatment_sessions(status, scheduled_at)`);

      // ── Vital signs per session ───────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS vital_signs (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE CASCADE,
          measured_at TIMESTAMPTZ DEFAULT NOW(),
          blood_pressure_sys INTEGER,
          blood_pressure_dia INTEGER,
          heart_rate INTEGER,
          respiratory_rate INTEGER,
          temperature_c NUMERIC(5,2),
          oxygen_saturation NUMERIC(5,2),
          weight_kg NUMERIC(6,2),
          height_cm NUMERIC(6,2),
          pain_score INTEGER CHECK (pain_score IS NULL OR (pain_score >= 0 AND pain_score <= 10)),
          custom_vitals JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_vital_signs_session ON vital_signs(session_id)`);

      // ── Prescriptions (captured during a session) ─────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS prescriptions (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE CASCADE,
          plan_id INTEGER REFERENCES treatment_plans(id),
          medication_name TEXT NOT NULL,
          strength TEXT,
          dosage TEXT,
          frequency TEXT,
          duration TEXT,
          instructions TEXT,
          refills_remaining INTEGER NOT NULL DEFAULT 0,
          prescribed_at TIMESTAMPTZ DEFAULT NOW(),
          prescriber_id INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_prescriptions_session ON prescriptions(session_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_prescriptions_plan ON prescriptions(plan_id)`);

      // ── Chart areas (catalog of chartable anatomy) ────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS chart_areas (
          id SERIAL PRIMARY KEY,
          preset_key TEXT NOT NULL,
          area_code TEXT NOT NULL,
          display_name TEXT NOT NULL,
          parent_area_code TEXT,
          svg_path TEXT,
          display_order INTEGER NOT NULL DEFAULT 0,
          UNIQUE (preset_key, area_code)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_chart_areas_preset ON chart_areas(preset_key)`);

      // Seed chart_areas:
      //   dental_adult    — Universal numbering 1-32
      //   dental_primary  — Universal letters A-T
      //   body            — 15 physio regions (feet split out from legs)
      //   vet_body_canine — 15 simplified dog body regions
      //   vet_body_feline — 15 simplified cat body regions (same macro anatomy)
      const seedAreas = [];
      // Dental adult (Universal 1-32): 1-16 upper (right to left), 17-32 lower (left to right)
      const upperQuadRight = [1, 2, 3, 4, 5, 6, 7, 8];
      const upperQuadLeft = [9, 10, 11, 12, 13, 14, 15, 16];
      const lowerQuadLeft = [17, 18, 19, 20, 21, 22, 23, 24];
      const lowerQuadRight = [25, 26, 27, 28, 29, 30, 31, 32];
      for (const n of upperQuadRight) seedAreas.push(["dental_adult", String(n), `Tooth ${n}`, "upper_right", n]);
      for (const n of upperQuadLeft) seedAreas.push(["dental_adult", String(n), `Tooth ${n}`, "upper_left", n]);
      for (const n of lowerQuadLeft) seedAreas.push(["dental_adult", String(n), `Tooth ${n}`, "lower_left", n]);
      for (const n of lowerQuadRight) seedAreas.push(["dental_adult", String(n), `Tooth ${n}`, "lower_right", n]);
      // Dental primary (Universal A-T): A-E upper right, F-J upper left, K-O lower left, P-T lower right
      const primaryLetters = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T"];
      primaryLetters.forEach((ltr, idx) => {
        const quad = idx < 5 ? "upper_right_primary"
                    : idx < 10 ? "upper_left_primary"
                    : idx < 15 ? "lower_left_primary"
                    : "lower_right_primary";
        seedAreas.push(["dental_primary", ltr, `Tooth ${ltr}`, quad, 100 + idx]);
      });
      // Body regions — 15 physio regions
      const bodyRegions = [
        ["head", "Head"],
        ["neck", "Neck"],
        ["shoulder_left", "Left Shoulder"],
        ["shoulder_right", "Right Shoulder"],
        ["arm_left", "Left Arm"],
        ["arm_right", "Right Arm"],
        ["torso_anterior", "Torso (Anterior)"],
        ["torso_posterior", "Torso (Posterior)"],
        ["hip_left", "Left Hip"],
        ["hip_right", "Right Hip"],
        ["leg_left", "Left Leg"],
        ["leg_right", "Right Leg"],
        ["foot_left", "Left Foot"],
        ["foot_right", "Right Foot"],
        ["spine", "Spine"],
      ];
      bodyRegions.forEach(([code, name], idx) => {
        seedAreas.push(["body", code, name, null, idx]);
      });
      // Vet body — canine (15 regions)
      const vetCanineRegions = [
        ["head", "Head"],
        ["ears", "Ears"],
        ["neck", "Neck"],
        ["thorax", "Thorax"],
        ["abdomen", "Abdomen"],
        ["back", "Back"],
        ["tail", "Tail"],
        ["forelimb_left", "Left Forelimb"],
        ["forelimb_right", "Right Forelimb"],
        ["hindlimb_left", "Left Hindlimb"],
        ["hindlimb_right", "Right Hindlimb"],
        ["paw_front_left", "Front Left Paw"],
        ["paw_front_right", "Front Right Paw"],
        ["paw_rear_left", "Rear Left Paw"],
        ["paw_rear_right", "Rear Right Paw"],
      ];
      vetCanineRegions.forEach(([code, name], idx) => {
        seedAreas.push(["vet_body_canine", code, name, null, idx]);
      });
      // Vet body — feline (same 15 regions; species differentiation happens
      // in patient_subjects.species, not in chart code)
      vetCanineRegions.forEach(([code, name], idx) => {
        seedAreas.push(["vet_body_feline", code, name, null, idx]);
      });

      for (const [preset, code, name, parent, order] of seedAreas) {
        await client.query(
          `INSERT INTO chart_areas (preset_key, area_code, display_name, parent_area_code, display_order)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (preset_key, area_code) DO NOTHING`,
          [preset, code, name, parent, order]
        );
      }

      // ── Session chart entries ─────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS session_chart_entries (
          id SERIAL PRIMARY KEY,
          session_id INTEGER NOT NULL REFERENCES treatment_sessions(id) ON DELETE CASCADE,
          area_code TEXT NOT NULL,
          condition_code TEXT NOT NULL
            CHECK (condition_code IN ('healthy','caries','restoration','extraction','crown','root_canal','missing','implant','mobility','plaque','gingivitis','custom')),
          severity TEXT CHECK (severity IS NULL OR severity IN ('mild','moderate','severe')),
          notes TEXT,
          color_marker TEXT,
          treated_in_session_id INTEGER REFERENCES treatment_sessions(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_session_chart_entries_session ON session_chart_entries(session_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_session_chart_entries_treated
          ON session_chart_entries(treated_in_session_id)
          WHERE treated_in_session_id IS NOT NULL
      `);

      // ── Lab orders ────────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS lab_orders (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
          session_id INTEGER REFERENCES treatment_sessions(id),
          order_number TEXT NOT NULL,
          lab_vendor TEXT,
          test_name TEXT NOT NULL,
          test_code TEXT,
          status TEXT NOT NULL DEFAULT 'ordered'
            CHECK (status IN ('ordered','in_transit','received','completed','cancelled')),
          ordered_at TIMESTAMPTZ DEFAULT NOW(),
          result_received_at TIMESTAMPTZ,
          result_summary TEXT,
          result_document_id INTEGER,
          cost NUMERIC(12,2) NOT NULL DEFAULT 0,
          ordered_by INTEGER REFERENCES employees(id),
          notes TEXT,
          shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (order_number)
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_orders_plan ON lab_orders(plan_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_lab_orders_status ON lab_orders(status)`);

      // ── Consent forms ─────────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS consent_forms (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
          session_id INTEGER REFERENCES treatment_sessions(id),
          form_template_key TEXT NOT NULL,
          title TEXT NOT NULL,
          body_markdown TEXT NOT NULL,
          signed_by_name TEXT NOT NULL,
          signed_by_relation TEXT NOT NULL DEFAULT 'self'
            CHECK (signed_by_relation IN ('self','parent','guardian','owner','next_of_kin')),
          signature_image_url TEXT,
          signed_at TIMESTAMPTZ DEFAULT NOW(),
          witnessed_by_id INTEGER REFERENCES employees(id),
          document_pdf_url TEXT,
          ip_address TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_consent_forms_plan ON consent_forms(plan_id)`);

      // ── Clinical documents (R2-backed attachments) ────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS clinical_documents (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
          session_id INTEGER REFERENCES treatment_sessions(id),
          document_type TEXT NOT NULL
            CHECK (document_type IN ('lab_report','imaging_xray','imaging_ct','imaging_mri','photo','referral_letter','discharge_summary','other')),
          title TEXT NOT NULL,
          file_url TEXT NOT NULL,
          file_mime TEXT,
          file_size_bytes BIGINT,
          uploaded_by INTEGER REFERENCES employees(id),
          uploaded_at TIMESTAMPTZ DEFAULT NOW(),
          notes TEXT,
          shared_with_patient BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_clinical_documents_plan ON clinical_documents(plan_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_clinical_documents_session
          ON clinical_documents(session_id)
          WHERE session_id IS NOT NULL
      `);

      // Add the FK from lab_orders.result_document_id now that clinical_documents exists
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'lab_orders_result_document_fk'
          ) THEN
            ALTER TABLE lab_orders
              ADD CONSTRAINT lab_orders_result_document_fk
              FOREIGN KEY (result_document_id) REFERENCES clinical_documents(id);
          END IF;
        END $$
      `);

      // ── Treatment folios (running tab per plan) ───────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS treatment_folios (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','settled','voided')),
          session_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          pos_charge_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          tax_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          deposit_applied NUMERIC(12,2) NOT NULL DEFAULT 0,
          grand_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          settled_at TIMESTAMPTZ,
          invoice_id INTEGER REFERENCES customer_invoices(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_folios_plan ON treatment_folios(plan_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_folios_status ON treatment_folios(status)`);

      // ── Treatment folio lines ─────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS treatment_folio_lines (
          id SERIAL PRIMARY KEY,
          folio_id INTEGER NOT NULL REFERENCES treatment_folios(id) ON DELETE CASCADE,
          line_type TEXT NOT NULL
            CHECK (line_type IN ('session_fee','pos_sale','lab_cost','manual_charge','discount','tax')),
          description TEXT NOT NULL,
          quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
          unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
          line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          session_id INTEGER REFERENCES treatment_sessions(id),
          sale_id INTEGER REFERENCES sales(id),
          added_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_folio_lines_folio ON treatment_folio_lines(folio_id)`);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_treatment_folio_lines_sale
          ON treatment_folio_lines(sale_id)
          WHERE sale_id IS NOT NULL
      `);

      // ── Plan activity log ─────────────────────────────────────────
      await client.query(`
        CREATE TABLE IF NOT EXISTS treatment_plan_activities (
          id SERIAL PRIMARY KEY,
          plan_id INTEGER NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
          actor_id INTEGER REFERENCES employees(id),
          activity_type TEXT NOT NULL
            CHECK (activity_type IN ('status_change','note','deposit_recorded','session_completed','consent_signed','lab_ordered','document_uploaded','invoice_generated')),
          description TEXT,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_treatment_plan_activities_plan ON treatment_plan_activities(plan_id)`);

      // ── Column additions to existing tables ───────────────────────
      await client.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS diagnosis_history JSONB NOT NULL DEFAULT '[]'::jsonb
      `);
      await client.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS current_medications JSONB NOT NULL DEFAULT '[]'::jsonb
      `);
      await client.query(`
        ALTER TABLE customers
          ADD COLUMN IF NOT EXISTS primary_provider_id INTEGER REFERENCES employees(id)
      `);

      await client.query(`
        ALTER TABLE appointments
          ADD COLUMN IF NOT EXISTS treatment_plan_id INTEGER REFERENCES treatment_plans(id)
      `);
      await client.query(`
        ALTER TABLE appointments
          ADD COLUMN IF NOT EXISTS treatment_session_id INTEGER REFERENCES treatment_sessions(id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_appointments_treatment_plan
          ON appointments(treatment_plan_id)
          WHERE treatment_plan_id IS NOT NULL
      `);

      // Back-fill the FK on treatment_sessions.appointment_id now that both tables exist
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'treatment_sessions_appointment_fk'
          ) THEN
            ALTER TABLE treatment_sessions
              ADD CONSTRAINT treatment_sessions_appointment_fk
              FOREIGN KEY (appointment_id) REFERENCES appointments(id);
          END IF;
        END $$
      `);

      await client.query(`
        ALTER TABLE sales
          ADD COLUMN IF NOT EXISTS treatment_folio_id INTEGER REFERENCES treatment_folios(id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sales_treatment_folio_id
          ON sales(treatment_folio_id)
          WHERE treatment_folio_id IS NOT NULL
      `);

      // ── Feature flag ──────────────────────────────────────────────
      // Mode-gated flag, flipped ON only when a clinical preset is selected.
      await client.query(`
        INSERT INTO feature_flags (key, enabled) VALUES ('phase4_treatment_plans', false)
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 44,
    description:
      "Mode-gate backfill — seed tenant_modes for tenants currently using restaurant / appointments / service_projects / workflow_tickets / subscriptions before flag defaults flip to false",
    up: async (client) => {
      // For existing tenants: if a phase4 flag is currently enabled (row exists
      // and is true, OR row is missing — previously defaulted true), insert the
      // matching tenant_modes row so the flag keeps resolving true after the
      // default flip. Pairs with the feature-flags.js default change to false.
      //
      // Flag → mode mapping (source of truth: backend/config/mode-registry.js):
      //   phase4_restaurant            → restaurant
      //   phase4_restaurant_kds        → restaurant
      //   phase4_appointments          → appointments
      //   phase4_service_projects      → service_projects
      //   phase4_service_contracts     → service_projects
      //   phase4_workflow_tickets      → workflow_tickets
      //   subscription_billing         → subscriptions
      const flagToMode = [
        ["phase4_restaurant", "restaurant"],
        ["phase4_restaurant_kds", "restaurant"],
        ["phase4_appointments", "appointments"],
        ["phase4_service_projects", "service_projects"],
        ["phase4_service_contracts", "service_projects"],
        ["phase4_workflow_tickets", "workflow_tickets"],
        ["subscription_billing", "subscriptions"],
      ];

      for (const [flag, mode] of flagToMode) {
        // Treat missing row as "enabled" (matches previous default=true behavior)
        const { rows } = await client.query(
          "SELECT enabled FROM feature_flags WHERE key = $1",
          [flag]
        );
        const wasEnabled = rows.length === 0 ? true : rows[0].enabled === true;
        if (wasEnabled) {
          await client.query(
            `INSERT INTO tenant_modes (mode, enabled) VALUES ($1, true)
             ON CONFLICT (mode) DO NOTHING`,
            [mode]
          );
          // Also ensure the flag is explicitly true in the DB (not relying on
          // the code default anymore — it just flipped to false).
          await client.query(
            `INSERT INTO feature_flags (key, enabled) VALUES ($1, true)
             ON CONFLICT (key) DO UPDATE SET enabled = true`,
            [flag]
          );
        }
      }
    },
  },
  {
    version: 45,
    description:
      "Widen weighted-quantity columns to NUMERIC(10,3) — outlet_stock, return_items, stock_adjustments",
    up: async (client) => {
      // Lossless cast — existing integer values widen cleanly. Brief ACCESS
      // EXCLUSIVE lock; no table rewrite in PG 12+. Mirrors M5's v34 pattern
      // which already widened sale_items.quantity.
      await client.query(`
        ALTER TABLE outlet_stock
          ALTER COLUMN quantity TYPE NUMERIC(10,3) USING quantity::numeric
      `);
      await client.query(`
        ALTER TABLE return_items
          ALTER COLUMN quantity TYPE NUMERIC(10,3) USING quantity::numeric
      `);
      await client.query(`
        ALTER TABLE stock_adjustments
          ALTER COLUMN quantity_change TYPE NUMERIC(10,3) USING quantity_change::numeric
      `);
      await client.query(`
        ALTER TABLE product_variants
          ALTER COLUMN stock TYPE NUMERIC(10,3) USING stock::numeric
      `);
    },
  },
  {
    version: 46,
    description:
      "Treatment plan templates — clone-to-create for recurring clinical plans (A7)",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS treatment_plan_templates (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          default_title TEXT,
          default_diagnosis_code TEXT,
          default_diagnosis_notes TEXT,
          default_sessions_planned INTEGER NOT NULL DEFAULT 1,
          default_estimated_total NUMERIC(12,2) NOT NULL DEFAULT 0,
          default_notes TEXT,
          default_activities JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by INTEGER REFERENCES employees(id),
          is_archived BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_treatment_plan_templates_archived
         ON treatment_plan_templates(is_archived)`
      );
    },
  },
  {
    version: 47,
    description:
      "Appointments + booking services deposit columns — mirror room_bookings deposit schema for public booking deposit flow (M6 gap)",
    up: async (client) => {
      // Per-service deposit policy configured by admin (require_deposit +
      // deposit_amount). Controls whether the public booking page asks for a
      // deposit before confirming the appointment.
      await client.query(`
        ALTER TABLE booking_services
          ADD COLUMN IF NOT EXISTS require_deposit BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) DEFAULT 0
      `);
      // Per-appointment deposit tracking.
      await client.query(`
        ALTER TABLE appointments
          ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS deposit_collected NUMERIC(12,2) DEFAULT 0,
          ADD COLUMN IF NOT EXISTS deposit_method TEXT,
          ADD COLUMN IF NOT EXISTS deposit_payment_intent_id TEXT,
          ADD COLUMN IF NOT EXISTS deposit_status TEXT
            CHECK (deposit_status IS NULL OR deposit_status IN
                   ('pending','authorized','captured','released','failed'))
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_appointments_deposit_intent
          ON appointments(deposit_payment_intent_id)
          WHERE deposit_payment_intent_id IS NOT NULL
      `);
    },
  },
  {
    version: 48,
    description:
      "Tax-inclusive room rates — room_types.tax_inclusive flag (M9 Option A)",
    up: async (client) => {
      await client.query(`
        ALTER TABLE room_types
          ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN NOT NULL DEFAULT false
      `);
    },
  },
  {
    version: 49,
    description:
      "Walk-in service staff assignment on POS — sale_items.staff_id (for car wash, tailoring, etc.)",
    up: async (client) => {
      await client.query(`
        ALTER TABLE sale_items
          ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES employees(id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sale_items_staff_id
          ON sale_items(staff_id)
          WHERE staff_id IS NOT NULL
      `);
    },
  },
  {
    version: 50,
    description:
      "Public-schema infra_cache table — keyed snapshots written by background workers (e.g. orphaned-schemas), served on demand without re-running expensive cross-schema introspection (Phase 1.1 Tier 1)",
    up: async (client) => {
      // Public schema only. Explicit schema qualifier means this is a no-op
      // when the migration runs inside a tenant search_path — IF NOT EXISTS
      // makes the second-onward call cheap.
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.infra_cache (
          cache_key TEXT PRIMARY KEY,
          payload JSONB NOT NULL,
          computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          duration_ms INTEGER
        )
      `);
    },
  },
  {
    version: 51,
    description:
      "Phase 2.1 A1 — split-bill extensions: draft_orders.split_parent_id + split_strategy; 'merged' added to status CHECK",
    up: async (client) => {
      await client.query(`
        ALTER TABLE draft_orders
          ADD COLUMN IF NOT EXISTS split_parent_id INTEGER REFERENCES draft_orders(id),
          ADD COLUMN IF NOT EXISTS split_strategy TEXT
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_draft_orders_split_parent
          ON draft_orders(split_parent_id)
          WHERE split_parent_id IS NOT NULL
      `);
      // Widen existing status CHECK to include 'merged'. Drop-and-recreate
      // because ADD CONSTRAINT IF NOT EXISTS isn't supported and the constraint
      // name is deterministic (draft_orders_status_check) from the inline
      // CHECK in schema-pg.sql.
      await client.query(`
        ALTER TABLE draft_orders DROP CONSTRAINT IF EXISTS draft_orders_status_check
      `);
      await client.query(`
        ALTER TABLE draft_orders
          ADD CONSTRAINT draft_orders_status_check
          CHECK (status IN ('open','claimed','completed','cancelled','merged'))
      `);
    },
  },
  {
    version: 52,
    description:
      "Phase 2.1 A2 — first-class modifiers: modifier_groups, modifier_options, product_modifier_group_links, draft_order_item_modifiers, sale_item_modifiers",
    up: async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS modifier_groups (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER REFERENCES outlets(id),
          name TEXT NOT NULL,
          selection_type TEXT NOT NULL CHECK (selection_type IN ('single','multi')),
          min_select INTEGER NOT NULL DEFAULT 0,
          max_select INTEGER,
          is_required BOOLEAN NOT NULL DEFAULT FALSE,
          display_order INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS modifier_options (
          id SERIAL PRIMARY KEY,
          group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          price_delta NUMERIC(12,2) NOT NULL DEFAULT 0,
          is_default BOOLEAN DEFAULT FALSE,
          display_order INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT TRUE
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_modifier_options_group ON modifier_options(group_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_modifier_group_links (
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          group_id INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
          display_order INTEGER DEFAULT 0,
          PRIMARY KEY (product_id, group_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS draft_order_item_modifiers (
          id SERIAL PRIMARY KEY,
          draft_order_item_id INTEGER NOT NULL REFERENCES draft_order_items(id) ON DELETE CASCADE,
          option_id INTEGER NOT NULL REFERENCES modifier_options(id),
          option_name_snapshot TEXT NOT NULL,
          price_delta_snapshot NUMERIC(12,2) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_doim_item ON draft_order_item_modifiers(draft_order_item_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS sale_item_modifiers (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          sale_item_id INTEGER NOT NULL,
          option_id INTEGER REFERENCES modifier_options(id),
          option_name_snapshot TEXT NOT NULL,
          price_delta_snapshot NUMERIC(12,2) NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sim_sale ON sale_item_modifiers(sale_id)
      `);
    },
  },
  {
    version: 53,
    description:
      "Phase 2.1 A3 — course timing controls: restaurant_course_fires.hold_until + expedite + sequence",
    up: async (client) => {
      await client.query(`
        ALTER TABLE restaurant_course_fires
          ADD COLUMN IF NOT EXISTS hold_until TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS expedite BOOLEAN NOT NULL DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS sequence INTEGER
      `);
      // Index for the worker sweep: status='held' + hold_until <= NOW().
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_course_fires_held_until
          ON restaurant_course_fires(hold_until)
          WHERE status = 'held' AND hold_until IS NOT NULL
      `);
    },
  },
  {
    version: 54,
    description:
      "Phase 2.1 B1 — KDS routing rules: kds_station_routes gains priority, product_id, modifier_group_id, station_role_filter; CHECK exactly one match column non-null; idx_ksr_lookup",
    up: async (client) => {
      await client.query(`
        ALTER TABLE kds_station_routes
          ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0,
          ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id),
          ADD COLUMN IF NOT EXISTS modifier_group_id INTEGER REFERENCES modifier_groups(id),
          ADD COLUMN IF NOT EXISTS station_role_filter TEXT,
          ADD COLUMN IF NOT EXISTS outlet_id INTEGER REFERENCES outlets(id)
      `);
      // Backfill outlet_id from the station so idx_ksr_lookup has something to
      // scan by. New rows go through the route handler which stamps outlet_id
      // explicitly, but legacy rows predate the column.
      await client.query(`
        UPDATE kds_station_routes sr
           SET outlet_id = ks.outlet_id
          FROM kds_stations ks
         WHERE sr.station_id = ks.id AND sr.outlet_id IS NULL
      `);
      // Exactly-one CHECK: product_id > modifier_group_id > category_id > match_all.
      // Drop-and-recreate because CHECK constraints don't support IF NOT EXISTS
      // and re-running the migration should converge. station_role_filter is
      // orthogonal — it refines a match but doesn't count as one.
      await client.query(`
        ALTER TABLE kds_station_routes
          DROP CONSTRAINT IF EXISTS kds_station_routes_exactly_one_match
      `);
      await client.query(`
        ALTER TABLE kds_station_routes
          ADD CONSTRAINT kds_station_routes_exactly_one_match CHECK (
            (CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN modifier_group_id IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN category_id IS NOT NULL THEN 1 ELSE 0 END
             + CASE WHEN match_all = true THEN 1 ELSE 0 END) = 1
          )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ksr_lookup
          ON kds_station_routes(outlet_id, priority DESC)
      `);
    },
  },
  {
    version: 55,
    description:
      "Phase 2.1 B2 — online ordering inbox: web_orders acceptance columns + draft_orders.source_channel + 'online' order_context",
    up: async (client) => {
      await client.query(`
        ALTER TABLE web_orders
          ADD COLUMN IF NOT EXISTS converted_draft_order_id INTEGER REFERENCES draft_orders(id),
          ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS accepted_by INTEGER REFERENCES employees(id),
          ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS reject_reason TEXT
      `);
      await client.query(`
        ALTER TABLE draft_orders
          ADD COLUMN IF NOT EXISTS source_channel TEXT DEFAULT 'pos'
      `);
      // Widen order_context CHECK to include 'online'. Drop-and-recreate
      // because CHECK constraints don't support IF NOT EXISTS. The old
      // constraint name is deterministic from the inline CHECK in
      // schema-pg.sql (see ALTER TABLE draft_orders … ADD COLUMN IF NOT
      // EXISTS order_context TEXT DEFAULT 'retail' CHECK (…)).
      await client.query(`
        ALTER TABLE draft_orders DROP CONSTRAINT IF EXISTS draft_orders_order_context_check
      `);
      await client.query(`
        ALTER TABLE draft_orders
          ADD CONSTRAINT draft_orders_order_context_check
          CHECK (order_context IN ('retail','dine_in','takeout','delivery','bar','online'))
      `);
      // Partial index for the inbox query — only unconverted rows, and
      // the two filters the service uses (source + order_status).
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_web_orders_unconverted
          ON web_orders(source, order_status)
          WHERE converted_draft_order_id IS NULL
      `);
    },
  },
  {
    version: 56,
    description:
      "Phase 2.1 C1 — tip capture: restaurant_check_adjustments gains tip_category + recipient_employee_id; new tip_captures table for per-sale server attribution",
    up: async (client) => {
      // Adjustments already model gratuity as a check-line item; the new
      // columns let us classify *how* the tip is paid (cash in hand vs card
      // on the bill vs pooled at end-of-shift) and attribute a direct tip to
      // a specific server. Both nullable so legacy rows stay valid.
      await client.query(`
        ALTER TABLE restaurant_check_adjustments
          ADD COLUMN IF NOT EXISTS tip_category TEXT,
          ADD COLUMN IF NOT EXISTS recipient_employee_id INTEGER REFERENCES employees(id)
      `);
      await client.query(`
        ALTER TABLE restaurant_check_adjustments
          DROP CONSTRAINT IF EXISTS restaurant_check_adjustments_tip_category_check
      `);
      await client.query(`
        ALTER TABLE restaurant_check_adjustments
          ADD CONSTRAINT restaurant_check_adjustments_tip_category_check
          CHECK (tip_category IS NULL OR tip_category IN ('cash','card','pooled','direct'))
      `);

      // tip_captures is the per-sale ledger. One row per checked-out sale
      // that carried a tip — pulled from the gratuity adjustment at sale
      // time, attributed to the table session's server. pool_id is NULL
      // until the shift's tip pool closes and stamps it.
      await client.query(`
        CREATE TABLE IF NOT EXISTS tip_captures (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          draft_order_id INTEGER,
          outlet_id INTEGER REFERENCES outlets(id),
          server_id INTEGER REFERENCES employees(id),
          tip_amount NUMERIC(12,2) NOT NULL,
          tip_method TEXT NOT NULL CHECK (tip_method IN ('cash','card','split')),
          pool_id INTEGER,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tip_captures_pool ON tip_captures(pool_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_tip_captures_server ON tip_captures(server_id)`);
    },
  },
  {
    version: 57,
    description:
      "Phase 2.1 C2 — tip pooling: tip_pools + distribution_rules + payouts; commission_earnings.earning_type bridges tips into payroll",
    up: async (client) => {
      // Distribution rules first — pools FK into them. Each outlet can have
      // multiple named strategies; one is_default per outlet (enforced by
      // partial unique index).
      await client.query(`
        CREATE TABLE IF NOT EXISTS tip_pool_distribution_rules (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER REFERENCES outlets(id),
          name TEXT NOT NULL,
          strategy TEXT NOT NULL CHECK (strategy IN ('equal_share','hours_weighted','role_weighted','points')),
          config_jsonb JSONB DEFAULT '{}'::jsonb,
          is_default BOOLEAN DEFAULT FALSE,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tpdr_default_per_outlet
          ON tip_pool_distribution_rules(outlet_id)
          WHERE is_default = TRUE AND is_active = TRUE
      `);

      // Pools — one per outlet/business_date open at a time. status flow:
      // open → closed → distributed (or voided from either closed/distributed).
      await client.query(`
        CREATE TABLE IF NOT EXISTS tip_pools (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          business_date DATE NOT NULL,
          opened_at TIMESTAMPTZ DEFAULT NOW(),
          closed_at TIMESTAMPTZ,
          total_tips NUMERIC(12,2) NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','distributed','voided')),
          closed_by INTEGER REFERENCES employees(id),
          distribution_rule_id INTEGER REFERENCES tip_pool_distribution_rules(id),
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tip_pools_outlet_date
          ON tip_pools(outlet_id, business_date)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tip_pools_open
          ON tip_pools(outlet_id) WHERE status = 'open'
      `);

      // Backfill the FK from tip_captures → tip_pools now that the table
      // exists. The v56 column was created without REFERENCES so v56 could
      // run before v57; this hardens it.
      await client.query(`
        ALTER TABLE tip_captures
          DROP CONSTRAINT IF EXISTS tip_captures_pool_id_fkey
      `);
      await client.query(`
        ALTER TABLE tip_captures
          ADD CONSTRAINT tip_captures_pool_id_fkey
          FOREIGN KEY (pool_id) REFERENCES tip_pools(id) ON DELETE SET NULL
      `);

      // Payouts — one row per employee per pool. commission_earning_id is
      // the bridge into payroll: payroll reads commission_earnings, which
      // for tips has earning_type='tip' and sale_id NULL.
      await client.query(`
        CREATE TABLE IF NOT EXISTS tip_pool_payouts (
          id SERIAL PRIMARY KEY,
          pool_id INTEGER NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
          employee_id INTEGER NOT NULL REFERENCES employees(id),
          hours_worked NUMERIC(8,2) NOT NULL DEFAULT 0,
          weight NUMERIC(12,4) NOT NULL DEFAULT 0,
          payout_amount NUMERIC(12,2) NOT NULL,
          paid_at TIMESTAMPTZ,
          commission_earning_id INTEGER REFERENCES commission_earnings(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tip_pool_payouts_pool
          ON tip_pool_payouts(pool_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tip_pool_payouts_employee
          ON tip_pool_payouts(employee_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tip_pool_payouts_unpaid
          ON tip_pool_payouts(employee_id) WHERE paid_at IS NULL
      `);

      // commission_earnings extension — earning_type discriminates tips from
      // commissions; sale_id loosened so tip rows (not tied to a sale) can
      // live here too. The CHECK keeps existing data valid (defaults to
      // 'commission').
      await client.query(`
        ALTER TABLE commission_earnings
          ADD COLUMN IF NOT EXISTS earning_type TEXT NOT NULL DEFAULT 'commission'
      `);
      await client.query(`
        ALTER TABLE commission_earnings
          DROP CONSTRAINT IF EXISTS commission_earnings_earning_type_check
      `);
      await client.query(`
        ALTER TABLE commission_earnings
          ADD CONSTRAINT commission_earnings_earning_type_check
          CHECK (earning_type IN ('commission','tip'))
      `);
      await client.query(`
        ALTER TABLE commission_earnings ALTER COLUMN sale_id DROP NOT NULL
      `);
      // plan_id is also NOT NULL in legacy schema, but tip rows have no plan.
      // Drop the constraint so tip rows can pass NULL.
      await client.query(`
        ALTER TABLE commission_earnings ALTER COLUMN plan_id DROP NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_ce_type_status
          ON commission_earnings(earning_type, status)
      `);
    },
  },
  {
    version: 58,
    description:
      "Phase 2-R Wave A — 86'd items + seat_number on sales + drive-thru order_context + 10 restaurant feature flags",
    up: async (client) => {
      // 2-R.1: sold-out columns on products + variants
      await client.query(`
        ALTER TABLE products
          ADD COLUMN IF NOT EXISTS is_sold_out BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS sold_out_since TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS sold_out_until TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS sold_out_reason TEXT
      `);
      await client.query(`
        ALTER TABLE product_variants
          ADD COLUMN IF NOT EXISTS is_sold_out BOOLEAN NOT NULL DEFAULT false,
          ADD COLUMN IF NOT EXISTS sold_out_since TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS sold_out_until TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS sold_out_reason TEXT
      `);

      // 2-R.8: seat_number on sale_items
      await client.query(`
        ALTER TABLE sale_items
          ADD COLUMN IF NOT EXISTS seat_number INTEGER
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sale_items_sale_seat
          ON sale_items(sale_id, seat_number)
      `);

      // 2-R.9: extend draft_orders.order_context CHECK to include 'drive_thru'
      await client.query(`
        ALTER TABLE draft_orders DROP CONSTRAINT IF EXISTS draft_orders_order_context_check
      `);
      await client.query(`
        ALTER TABLE draft_orders ADD CONSTRAINT draft_orders_order_context_check
          CHECK (order_context IN ('retail','dine_in','takeout','delivery','bar','online','drive_thru'))
      `);

      // Seed 10 new feature flags. Default false; later statement flips on
      // for restaurant-mode tenants (mirrors v44 pattern).
      const FLAGS = [
        'phase4_restaurant_86',
        'phase4_restaurant_void_comp',
        'phase4_restaurant_pay_at_table',
        'phase4_restaurant_reservations',
        'phase4_restaurant_kds_analytics',
        'phase4_restaurant_day_parting',
        'phase4_restaurant_fire_chits',
        'phase4_restaurant_seats',
        'phase4_restaurant_drive_thru',
        'phase4_restaurant_menu_engineering',
      ];
      for (const key of FLAGS) {
        await client.query(
          `INSERT INTO feature_flags (key, enabled, description, updated_at)
           VALUES ($1, false, $2, NOW())
           ON CONFLICT (key) DO NOTHING`,
          [key, `Phase 2-R restaurant flag: ${key}`]
        );
      }

      // Auto-enable these flags for tenants already in restaurant mode.
      const { rows } = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'tenant_modes'`
      );
      if (rows.length) {
        const { rows: modeRows } = await client.query(
          `SELECT 1 FROM tenant_modes WHERE mode = 'restaurant' AND enabled = true`
        );
        if (modeRows.length) {
          for (const key of FLAGS) {
            await client.query(
              `INSERT INTO feature_flags (key, enabled, description, updated_at)
               VALUES ($1, true, $2, NOW())
               ON CONFLICT (key) DO UPDATE SET enabled = true, updated_at = NOW()`,
              [key, `Phase 2-R restaurant flag: ${key}`]
            );
          }
        }
      }
    },
  },
  {
    version: 59,
    description:
      "Phase 2-R Wave B — sale_item_adjustments + void_reason_codes + menu_schedules + kds_stations.printer_id + balance_strategy + printer_config.purpose",
    up: async (client) => {
      // 2-R.2: Adjustments table (void / comp / discount with audit trail)
      await client.query(`
        CREATE TABLE IF NOT EXISTS sale_item_adjustments (
          id SERIAL PRIMARY KEY,
          sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
          adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('void','comp','discount')),
          reason_code TEXT NOT NULL,
          reason_note TEXT,
          amount NUMERIC(12,2) NOT NULL,
          manager_employee_id INTEGER REFERENCES employees(id),
          manager_pin_verified_at TIMESTAMPTZ,
          created_by_employee_id INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_sale_item_adjustments_sale ON sale_item_adjustments(sale_id)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_sale_item_adjustments_type ON sale_item_adjustments(adjustment_type, created_at)`
      );

      // 2-R.2: Reason codes (seeded defaults, tenant-customizable)
      await client.query(`
        CREATE TABLE IF NOT EXISTS void_reason_codes (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          label TEXT NOT NULL,
          adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('void','comp','both')),
          is_active BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER NOT NULL DEFAULT 0
        )
      `);
      const SEED_REASONS = [
        ["spilled", "Spilled / dropped", "void", 10],
        ["wrong_order", "Wrong order", "both", 20],
        ["customer_change", "Customer changed mind", "void", 30],
        ["kitchen_error", "Kitchen error", "both", 40],
        ["vip_comp", "VIP / manager comp", "comp", 50],
        ["manager_comp", "Manager discretion", "comp", 60],
        ["training", "Training / test order", "both", 70],
        ["allergy", "Allergy / dietary issue", "both", 80],
        ["quality", "Quality complaint", "comp", 90],
        ["other", "Other", "both", 100],
      ];
      for (const [code, label, type, sort] of SEED_REASONS) {
        await client.query(
          `INSERT INTO void_reason_codes (code, label, adjustment_type, sort_order)
           VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
          [code, label, type, sort]
        );
      }

      // 2-R.6: Menu schedules (day-parting)
      await client.query(`
        CREATE TABLE IF NOT EXISTS menu_schedules (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          outlet_id INTEGER REFERENCES outlets(id) ON DELETE CASCADE,
          day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week <= 6),
          start_time TIME NOT NULL,
          end_time TIME NOT NULL,
          timezone TEXT,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS menu_schedule_products (
          schedule_id INTEGER NOT NULL REFERENCES menu_schedules(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          PRIMARY KEY (schedule_id, product_id)
        )
      `);
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_menu_schedule_products_product ON menu_schedule_products(product_id)`
      );

      // 2-R.6: outlets.timezone for day-parting (falls back to company_profile.timezone when NULL)
      await client.query(`ALTER TABLE outlets ADD COLUMN IF NOT EXISTS timezone TEXT`);

      // 2-R.7: kds_stations printer_id + balance_strategy + target_prep_seconds + last_assigned_at
      await client.query(`
        ALTER TABLE kds_stations
          ADD COLUMN IF NOT EXISTS printer_id INTEGER REFERENCES printer_config(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS balance_strategy TEXT NOT NULL DEFAULT 'priority',
          ADD COLUMN IF NOT EXISTS target_prep_seconds INTEGER,
          ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ
      `);
      await client.query(
        `ALTER TABLE kds_stations DROP CONSTRAINT IF EXISTS kds_stations_balance_strategy_check`
      );
      await client.query(
        `ALTER TABLE kds_stations ADD CONSTRAINT kds_stations_balance_strategy_check CHECK (balance_strategy IN ('priority','round_robin','least_loaded'))`
      );

      // 2-R.7: printer_config.purpose for fire-chit vs guest-bill vs receipt routing
      await client.query(
        `ALTER TABLE printer_config ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'receipt'`
      );
      await client.query(
        `ALTER TABLE printer_config DROP CONSTRAINT IF EXISTS printer_config_purpose_check`
      );
      await client.query(
        `ALTER TABLE printer_config ADD CONSTRAINT printer_config_purpose_check CHECK (purpose IN ('receipt','fire_chit','guest_bill','expo'))`
      );
    },
  },
  {
    version: 60,
    description:
      "Phase 2-R Wave C — kds_tickets timing columns + kds_station_load_snapshots",
    up: async (client) => {
      // 2-R.5: timing columns on kds_tickets. prep_seconds is a plain INTEGER
      // populated by the service layer when a ticket transitions to 'bumped'
      // (bumped_at - fired_at); a generated column would complicate idempotent
      // re-runs and a recall flow that must preserve history.
      await client.query(`
        ALTER TABLE kds_tickets
          ADD COLUMN IF NOT EXISTS fired_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS bumped_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS prep_seconds INTEGER
      `);

      // Backfill fired_at = created_at for rows already past 'new' so historical
      // rows show up in prep-time analytics rather than being silently skipped.
      await client.query(`
        UPDATE kds_tickets
        SET fired_at = created_at
        WHERE fired_at IS NULL
          AND status IN ('in_progress','ready','bumped')
      `);

      // Indexes tuned for analytics SELECTs (p50/p95 + date range).
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_kds_tickets_station_bumped
          ON kds_tickets(station_id, bumped_at)
          WHERE bumped_at IS NOT NULL
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_kds_tickets_fired_at
          ON kds_tickets(fired_at)
          WHERE fired_at IS NOT NULL
      `);

      // 2-R.5: 15-min load snapshots for trend lines on the analytics tab.
      await client.query(`
        CREATE TABLE IF NOT EXISTS kds_station_load_snapshots (
          id SERIAL PRIMARY KEY,
          station_id INTEGER NOT NULL REFERENCES kds_stations(id) ON DELETE CASCADE,
          recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          open_tickets INTEGER NOT NULL,
          avg_prep_seconds INTEGER
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_kds_load_snapshots_station_time
          ON kds_station_load_snapshots(station_id, recorded_at DESC)
      `);
    },
  },
  {
    version: 61,
    description:
      "Phase 2-R Wave D — restaurant_payment_sessions + reservations + waitlist_entries + dirty status",
    up: async (client) => {
      // Extend restaurant_table_sessions status to include 'dirty' — the
      // transient state between check-paid and bussed. Wave A's plan called
      // this out but v58 missed it; adding it here keeps the table session
      // CHECK aligned with the pay-at-table flow that hands tables to busser.
      // IF EXISTS guards a legacy tenant whose session table was never created.
      const { rows: hasTable } = await client.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'restaurant_table_sessions'`
      );
      if (hasTable.length) {
        await client.query(`
          ALTER TABLE restaurant_table_sessions
            DROP CONSTRAINT IF EXISTS restaurant_table_sessions_status_check
        `);
        await client.query(`
          ALTER TABLE restaurant_table_sessions
            ADD CONSTRAINT restaurant_table_sessions_status_check
            CHECK (status IN ('seated','ordering','served','check_requested','closed','dirty'))
        `);
      }

      // 2-R.3: Pay-at-table session — mirrors storefront_payment_sessions pattern.
      // draft_order_id + table_session_id both nullable because legacy/cancelled
      // sessions can outlive their source rows, and the sale_id links back once
      // the sandbox webhook flips status to 'paid'.
      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_payment_sessions (
          id SERIAL PRIMARY KEY,
          draft_order_id INTEGER REFERENCES draft_orders(id) ON DELETE SET NULL,
          table_session_id INTEGER REFERENCES restaurant_table_sessions(id) ON DELETE SET NULL,
          token TEXT UNIQUE NOT NULL,
          gateway TEXT NOT NULL DEFAULT 'sandbox',
          gateway_ref TEXT,
          amount NUMERIC(12,2) NOT NULL,
          tip_amount NUMERIC(12,2) DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','processing','paid','failed','expired')),
          webhook_payload JSONB,
          paid_at TIMESTAMPTZ,
          expires_at TIMESTAMPTZ NOT NULL,
          created_by_employee_id INTEGER REFERENCES employees(id),
          sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rps_status_expires
          ON restaurant_payment_sessions(status, expires_at)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rps_table_session
          ON restaurant_payment_sessions(table_session_id)
          WHERE status = 'pending'
      `);

      // 2-R.4: Reservations.
      await client.query(`
        CREATE TABLE IF NOT EXISTS reservations (
          id SERIAL PRIMARY KEY,
          customer_name TEXT NOT NULL,
          phone TEXT,
          email TEXT,
          party_size INTEGER NOT NULL CHECK (party_size > 0),
          reservation_start TIMESTAMPTZ NOT NULL,
          reservation_end TIMESTAMPTZ,
          outlet_id INTEGER REFERENCES outlets(id) ON DELETE CASCADE,
          table_id INTEGER REFERENCES restaurant_tables(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending','confirmed','seated','completed','no_show','cancelled','waitlisted')),
          notes TEXT,
          source TEXT DEFAULT 'staff',
          sms_confirmed_at TIMESTAMPTZ,
          sms_reminder_sent_at TIMESTAMPTZ,
          token TEXT UNIQUE,
          created_by_employee_id INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_start
          ON reservations(reservation_start)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_status
          ON reservations(status, reservation_start)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_reservations_table
          ON reservations(table_id, reservation_start)
          WHERE table_id IS NOT NULL
      `);

      // 2-R.4: Waitlist.
      await client.query(`
        CREATE TABLE IF NOT EXISTS waitlist_entries (
          id SERIAL PRIMARY KEY,
          customer_name TEXT NOT NULL,
          phone TEXT,
          party_size INTEGER NOT NULL CHECK (party_size > 0),
          outlet_id INTEGER REFERENCES outlets(id) ON DELETE CASCADE,
          quoted_wait_minutes INTEGER,
          status TEXT NOT NULL DEFAULT 'waiting'
            CHECK (status IN ('waiting','notified','seated','removed')),
          position INTEGER,
          notified_at TIMESTAMPTZ,
          seated_at TIMESTAMPTZ,
          removed_at TIMESTAMPTZ,
          notes TEXT,
          created_by_employee_id INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_waitlist_status_position
          ON waitlist_entries(status, position)
          WHERE status IN ('waiting','notified')
      `);
    },
  },
  {
    version: 62,
    description:
      "Phase 2-G Wave 1 — gift_card_transactions + loyalty_transactions ledgers (shaped like customer_wallet_ledger) + phase2g_* feature flag seeds",
    up: async (client) => {
      // Gift card ledger — mirrors customer_wallet_ledger shape.
      // The 'credit'/'debit' enum matches wallet ledger so future reporting
      // can UNION across both without schema wrangling.
      await client.query(`
        CREATE TABLE IF NOT EXISTS gift_card_transactions (
          id SERIAL PRIMARY KEY,
          gift_card_id INTEGER NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('credit','debit')),
          amount NUMERIC(12,2) NOT NULL,
          reference_type TEXT,
          reference_id INTEGER,
          note TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gift_card_transactions_gift_card
          ON gift_card_transactions(gift_card_id, created_at DESC)
      `);

      // Loyalty ledger — points-based (INTEGER) rather than money-based.
      // Enum widens to earn/redeem/adjust/expire because loyalty has more
      // lifecycle states than a pure wallet (expire is critical for tier logic).
      await client.query(`
        CREATE TABLE IF NOT EXISTS loyalty_transactions (
          id SERIAL PRIMARY KEY,
          customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          type TEXT NOT NULL CHECK (type IN ('earn','redeem','adjust','expire')),
          points INTEGER NOT NULL,
          reference_type TEXT,
          reference_id INTEGER,
          note TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_customer
          ON loyalty_transactions(customer_id, created_at DESC)
      `);

      // Seed all phase2g_* feature flags (default false). Each subsequent
      // wave just flips a flag on — no new migrations needed for flag
      // registration.
      await client.query(`
        INSERT INTO feature_flags (key, enabled, description) VALUES
          ('phase2g_omni_input', false, '2-G.0 scan-first omni-input on /pos'),
          ('phase2g_variant_picker', false, '2-G.1 matrix variant grid modal'),
          ('phase2g_gift_cards', false, '2-G.2 gift cards as first-class tender'),
          ('phase2g_loyalty', false, '2-G.3 loyalty earn/redeem + tier auto-apply'),
          ('phase2g_price_books', false, '2-G.4 customer-group price books'),
          ('phase2g_price_override', false, '2-G.5 manager price override with PIN'),
          ('phase2g_serialized_inventory', false, '2-G.6 serialized inventory end-to-end'),
          ('phase2g_per_line_restock', false, '2-G.7 per-line restock toggle + reasons'),
          ('phase2g_inventory_intelligence', false, '2-G.8 inventory-intelligence hub'),
          ('phase2g_receipt_barcode_lookup', false, '2-G.11 receipt barcode + return lookup'),
          ('phase2g_label_designer', false, 'Parallel track — ZPL/TSPL/EPL label designer')
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 63,
    description:
      "Phase 2-G Wave 2 — gift_cards.card_type/activation_status, gift_card_ranges, price_lists.customer_group_id, products.is_gift_card_sku",
    up: async (client) => {
      // 2-G.2: gift card additions. card_type distinguishes digital/physical
      // so the issue flow + activation UI can branch on a single column.
      // activation_status tracks the physical-card lifecycle (pre_printed →
      // active → depleted). The existing `status` column stays for backward
      // compat; new code reads activation_status instead.
      await client.query(
        `ALTER TABLE gift_cards
           ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT 'digital'
             CHECK (card_type IN ('digital','physical'))`
      );
      await client.query(
        `ALTER TABLE gift_cards
           ADD COLUMN IF NOT EXISTS activation_status TEXT NOT NULL DEFAULT 'active'
             CHECK (activation_status IN ('pre_printed','issued','active','depleted'))`
      );
      await client.query(
        `ALTER TABLE gift_cards
           ADD COLUMN IF NOT EXISTS issued_to_customer_id INTEGER REFERENCES customers(id)`
      );
      await client.query(
        `ALTER TABLE gift_cards
           ADD COLUMN IF NOT EXISTS issued_to_email TEXT`
      );
      await client.query(
        `ALTER TABLE gift_cards
           ADD COLUMN IF NOT EXISTS issued_from_sale_id INTEGER REFERENCES sales(id)`
      );

      // 2-G.2: physical card-range registration. Admins record prefix +
      // numeric range of pre-printed cards before any POS activation.
      await client.query(`
        CREATE TABLE IF NOT EXISTS gift_card_ranges (
          id SERIAL PRIMARY KEY,
          prefix TEXT NOT NULL,
          range_start BIGINT NOT NULL,
          range_end BIGINT NOT NULL,
          face_value NUMERIC(12,2) NOT NULL,
          notes TEXT,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          CHECK (range_end >= range_start)
        )
      `);

      // 2-G.2: products flag for gift-card SKUs. When a cart line's product
      // has is_gift_card_sku=true, sale completion generates the card.
      await client.query(
        `ALTER TABLE products
           ADD COLUMN IF NOT EXISTS is_gift_card_sku BOOLEAN NOT NULL DEFAULT false`
      );

      // 2-G.4: attach customer_group_id to price_lists so group-scoped
      // per-product overrides piggyback on existing price-list infra
      // (instead of a duplicate price_books table).
      await client.query(
        `ALTER TABLE price_lists
           ADD COLUMN IF NOT EXISTS customer_group_id INTEGER REFERENCES customer_groups(id)`
      );
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_price_lists_customer_group
          ON price_lists(customer_group_id)
          WHERE customer_group_id IS NOT NULL
      `);

      // 2-G.3: loyalty earn/redeem rates per tenant. Replaces the
      // hardcoded LOYALTY_EARN_RATE=1 (1pt per PKR 100) and
      // LOYALTY_REDEEM_RATE=10 (100pts = PKR 10) constants in the POS
      // hook. Stored on company_profile because loyalty is a
      // tenant-wide setting, not per-tier.
      await client.query(
        `ALTER TABLE company_profile
           ADD COLUMN IF NOT EXISTS loyalty_earn_rate NUMERIC(8,4) NOT NULL DEFAULT 1`
      );
      await client.query(
        `ALTER TABLE company_profile
           ADD COLUMN IF NOT EXISTS loyalty_redeem_rate NUMERIC(8,4) NOT NULL DEFAULT 10`
      );
    },
  },
  {
    version: 64,
    description:
      "Phase 2-G Wave 3 — 2-G.5 manager price override: override_reasons lookup + sale_items override columns + override_price permission seed",
    up: async (client) => {
      // 2-G.5: lookup table for cashier-facing override reason codes. Keeps
      // reason labels editable per tenant without changing the backend enum.
      await client.query(`
        CREATE TABLE IF NOT EXISTS override_reasons (
          id SERIAL PRIMARY KEY,
          code TEXT NOT NULL UNIQUE,
          label TEXT NOT NULL,
          is_active BOOLEAN NOT NULL DEFAULT true,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        INSERT INTO override_reasons (code, label, sort_order) VALUES
          ('price_match', 'Price match', 10),
          ('damaged_item', 'Damaged item', 20),
          ('loyalty_gesture', 'Loyalty gesture', 30),
          ('manager_discretion', 'Manager discretion', 40)
        ON CONFLICT (code) DO NOTHING
      `);

      // 2-G.5: per-line override audit columns on sale_items. price_at_sale
      // remains authoritative (the final charged price); price_override_amount
      // captures the ORIGINAL list price so reporting can compute the delta.
      // The approval_event_id links back to the manager PIN approval so the
      // cashier-wise override report can trace each override to its approver.
      await client.query(
        `ALTER TABLE sale_items
           ADD COLUMN IF NOT EXISTS price_override_amount NUMERIC(12,2)`
      );
      await client.query(
        `ALTER TABLE sale_items
           ADD COLUMN IF NOT EXISTS price_override_reason_id INTEGER REFERENCES override_reasons(id)`
      );
      await client.query(
        `ALTER TABLE sale_items
           ADD COLUMN IF NOT EXISTS price_override_approved_by INTEGER REFERENCES employees(id)`
      );
      await client.query(
        `ALTER TABLE sale_items
           ADD COLUMN IF NOT EXISTS price_override_approved_at TIMESTAMPTZ`
      );
      await client.query(
        `ALTER TABLE sale_items
           ADD COLUMN IF NOT EXISTS price_override_approval_event_id INTEGER REFERENCES approval_events(id)`
      );
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sale_items_price_override
          ON sale_items(price_override_approved_by, price_override_approved_at)
          WHERE price_override_amount IS NOT NULL
      `);

      // 2-G.5: seed override_price permission onto the Manager role. The
      // back-seed also runs at boot via ensureDefaultRolePermissions, but
      // doing it here means the permission is usable the instant the
      // migration finishes (no restart required for existing tenants).
      const { rows: mgrRoles } = await client.query(
        "SELECT id FROM roles WHERE name = 'Manager'"
      );
      for (const r of mgrRoles) {
        await client.query(
          "INSERT INTO role_permissions (role_id, permission) VALUES ($1, 'override_price') ON CONFLICT DO NOTHING",
          [r.id]
        );
      }
    },
  },
  {
    version: 65,
    description:
      "Phase 2-G Wave 3 — 2-G.1 variant_outlet_stock table + backfill from product_variants.stock into the primary outlet",
    up: async (client) => {
      // 2-G.1: per-variant per-outlet stock. product_variants.stock stays as
      // a cross-outlet rollup (kept in sync by sales/returns) for backwards
      // compat; new code prefers variant_outlet_stock for per-outlet reads
      // and deducts. Both are updated in the same transaction on sale lines
      // that carry a variant_id.
      await client.query(`
        CREATE TABLE IF NOT EXISTS variant_outlet_stock (
          id SERIAL PRIMARY KEY,
          variant_id INTEGER NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          quantity NUMERIC(10,3) NOT NULL DEFAULT 0,
          UNIQUE(variant_id, outlet_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_variant_outlet_stock_variant
          ON variant_outlet_stock(variant_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_variant_outlet_stock_outlet
          ON variant_outlet_stock(outlet_id)
      `);

      // Backfill: seed one variant_outlet_stock row per existing variant at
      // the tenant's primary outlet (lowest id). Uses ON CONFLICT DO NOTHING
      // so re-runs are idempotent and don't clobber already-seeded rows.
      // When no outlet exists, the backfill is a no-op (the tenant has
      // nothing to migrate yet).
      await client.query(`
        INSERT INTO variant_outlet_stock (variant_id, outlet_id, quantity)
        SELECT pv.id,
               (SELECT id FROM outlets ORDER BY id LIMIT 1) AS outlet_id,
               COALESCE(pv.stock, 0)
          FROM product_variants pv
         WHERE (SELECT id FROM outlets ORDER BY id LIMIT 1) IS NOT NULL
        ON CONFLICT (variant_id, outlet_id) DO NOTHING
      `);
    },
  },
  {
    version: 66,
    description:
      "Phase 2-G Wave 3 — 2-G.1 follow-up: variant_id on inventory_transfers + stock_adjustments so variant-aware moves/corrections stay in sync with variant_outlet_stock",
    up: async (client) => {
      // 2-G.1 follow-up: let tenants move + adjust stock at the variant
      // granularity. Without this, the matrix view drifts whenever an admin
      // does a stock correction (damage, recount, transfer between stores).
      // variant_id is nullable — pre-existing product-level rows stay as is.
      await client.query(
        `ALTER TABLE inventory_transfers
           ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id)`
      );
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_inventory_transfers_variant
          ON inventory_transfers(variant_id)
          WHERE variant_id IS NOT NULL
      `);
      await client.query(
        `ALTER TABLE stock_adjustments
           ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id)`
      );
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_stock_adjustments_variant
          ON stock_adjustments(variant_id)
          WHERE variant_id IS NOT NULL
      `);
    },
  },
  {
    version: 67,
    description:
      "Phase 2-G Wave 3 — 2-G.6 serialized inventory: extend product_serial_numbers (variant + warranty + grn), products.serial_required + default_warranty_months, sale_item_serials bridge, backfill bridge from legacy sale_id",
    up: async (client) => {
      // 2-G.6: serialized items end-to-end. Extend the existing serials table
      // with variant_id (serialized items can be variant-specific, e.g. the
      // blue 128GB iPhone vs the black 256GB), warranty dates (computed on
      // sale), and grn_id (traceability from the receive point).
      await client.query(
        `ALTER TABLE product_serial_numbers
           ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES product_variants(id)`
      );
      await client.query(
        `ALTER TABLE product_serial_numbers
           ADD COLUMN IF NOT EXISTS warranty_months INTEGER`
      );
      await client.query(
        `ALTER TABLE product_serial_numbers
           ADD COLUMN IF NOT EXISTS warranty_start_date DATE`
      );
      await client.query(
        `ALTER TABLE product_serial_numbers
           ADD COLUMN IF NOT EXISTS warranty_end_date DATE`
      );
      await client.query(
        `ALTER TABLE product_serial_numbers
           ADD COLUMN IF NOT EXISTS grn_id INTEGER REFERENCES goods_received_notes(id)`
      );
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_product_serial_numbers_status_product
          ON product_serial_numbers(status, product_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_product_serial_numbers_variant
          ON product_serial_numbers(variant_id)
          WHERE variant_id IS NOT NULL
      `);

      // 2-G.6: per-product opt-in flag + default warranty length so GRN
      // receive can pre-populate warranty_months without the cashier
      // having to enter it manually. Existing products default false/NULL
      // so no behavior change until a tenant explicitly enables serials.
      await client.query(
        `ALTER TABLE products
           ADD COLUMN IF NOT EXISTS serial_required BOOLEAN NOT NULL DEFAULT false`
      );
      await client.query(
        `ALTER TABLE products
           ADD COLUMN IF NOT EXISTS default_warranty_months INTEGER`
      );

      // 2-G.6: bridge table for qty-aware serialization. Scanning 3 serials
      // on a line of quantity=3 creates 3 bridge rows; the legacy sale_id
      // column on product_serial_numbers cannot express that because it's
      // a single FK per serial. We keep sale_id populated in parallel as a
      // deprecation cushion — drop in Phase 3.
      await client.query(`
        CREATE TABLE IF NOT EXISTS sale_item_serials (
          id SERIAL PRIMARY KEY,
          sale_item_id INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
          serial_id INTEGER NOT NULL REFERENCES product_serial_numbers(id),
          UNIQUE(sale_item_id, serial_id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sale_item_serials_sale_item
          ON sale_item_serials(sale_item_id)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_sale_item_serials_serial
          ON sale_item_serials(serial_id)
      `);

      // 2-G.6: backfill the bridge from existing sold serials. For every
      // serial that already has sale_id set, find a sale_items row with the
      // same sale_id + product_id and insert a bridge row. Uses NOT EXISTS
      // guard so re-runs stay idempotent.
      await client.query(`
        INSERT INTO sale_item_serials (sale_item_id, serial_id)
        SELECT si.id, psn.id
          FROM product_serial_numbers psn
          JOIN sale_items si
            ON si.sale_id = psn.sale_id
           AND si.product_id = psn.product_id
         WHERE psn.sale_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sale_item_serials sis WHERE sis.serial_id = psn.id
           )
      `);
    },
  },
  {
    version: 68,
    description:
      "Phase 2-G Wave 3 — 2-G.7 per-line restock toggle + reason codes: return_items.restock_flag/reason_code_id, seed default return_reasons",
    up: async (client) => {
      // 2-G.7: per-line restock control. Default true keeps existing behavior
      // (all returned items go back to stock) — tenant flips the flag off
      // per-line to log damaged/scrapped units. reason_code_id defaults to
      // the return-level reason in the application layer; the column stays
      // nullable so seed data + old code paths still insert cleanly.
      await client.query(
        `ALTER TABLE return_items
           ADD COLUMN IF NOT EXISTS restock_flag BOOLEAN NOT NULL DEFAULT true`
      );
      await client.query(
        `ALTER TABLE return_items
           ADD COLUMN IF NOT EXISTS reason_code_id INTEGER REFERENCES return_reasons(id)`
      );
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_return_items_restock_flag
          ON return_items(restock_flag)
          WHERE restock_flag = false
      `);

      // 2-G.7: seed default reason codes. The return_reasons table ships
      // empty in public schema; without seed data the per-line dropdown has
      // nothing to populate. ON CONFLICT DO NOTHING makes this idempotent +
      // safe for tenants that already curated their own reasons.
      await client.query(`
        INSERT INTO return_reasons (code, label, sort_order) VALUES
          ('damaged', 'Damaged', 10),
          ('defective', 'Defective', 20),
          ('wrong_item', 'Wrong item', 30),
          ('customer_changed_mind', 'Customer changed mind', 40),
          ('sizing_issue', 'Sizing issue', 50),
          ('other', 'Other', 60)
        ON CONFLICT (code) DO NOTHING
      `);
    },
  },
  {
    version: 69,
    description:
      "Schema hygiene sweep — idempotent backfill of returns columns (doc-sync for existing tenants, applies cleanly for fresh) + product_serial_numbers.status CHECK",
    up: async (client) => {
      // Post-Wave-3 cleanup item 1 of 2: the `returns` table picked up 7
      // columns across earlier migrations (v8 web_order_id, v15 phase 2
      // policy fields) that never made it back into schema-pg.sql. Existing
      // tenants already have these columns — the IF NOT EXISTS guards make
      // this migration a no-op for them. The real value is for fresh test
      // schemas + new tenant provisioning where schema-pg.sql alone was
      // missing the columns, causing POST /api/returns to 500 on isolated
      // integration test schemas.
      await client.query(`
        ALTER TABLE returns
          ADD COLUMN IF NOT EXISTS web_order_id INTEGER,
          ADD COLUMN IF NOT EXISTS policy_id INTEGER,
          ADD COLUMN IF NOT EXISTS policy_result TEXT,
          ADD COLUMN IF NOT EXISTS approval_event_id INTEGER,
          ADD COLUMN IF NOT EXISTS processed_by_employee_id INTEGER REFERENCES employees(id),
          ADD COLUMN IF NOT EXISTS approved_by_employee_id INTEGER REFERENCES employees(id),
          ADD COLUMN IF NOT EXISTS return_reason_id INTEGER REFERENCES return_reasons(id)
      `);

      // Post-Wave-3 cleanup item 2 of 2: enforce the status domain on
      // product_serial_numbers. Audit (April 2026, all tenant schemas) found
      // zero rows → constraint applies cleanly as VALIDATED. If the
      // constraint already exists (reruns, or freshly-provisioned tenants
      // whose schema-pg.sql already has it), skip — catch the 42710
      // duplicate_object code.
      //
      // Why SAVEPOINT: catching a Postgres error inside a transaction without
      // a SAVEPOINT leaves the transaction poisoned (every subsequent
      // statement fails with 25P02 'current transaction is aborted'). The JS
      // try/catch only swallows the exception object, not the transaction
      // state. SAVEPOINT scopes the rollback to just the failed statement so
      // the outer migration tx can continue and the schema_version INSERT
      // can commit. This was the bug that parked livetest1 at v68 in
      // production (Apr 28 2026).
      await client.query("SAVEPOINT v69_psn_status_check");
      try {
        await client.query(`
          ALTER TABLE product_serial_numbers
            ADD CONSTRAINT product_serial_numbers_status_check
            CHECK (status IN ('available','sold','returned','warranty_claim','damaged'))
        `);
        await client.query("RELEASE SAVEPOINT v69_psn_status_check");
      } catch (err) {
        if (err.code !== "42710") throw err;
        await client.query("ROLLBACK TO SAVEPOINT v69_psn_status_check");
      }
    },
  },
  {
    version: 70,
    description:
      "Phase 2-G.8 Inventory Intelligence Hub — product_abc_class + cycle_count_schedules + cycle_count_sessions + lead-time / safety-stock columns + tenant defaults on company_profile",
    up: async (client) => {
      // 2-G.8: per-product ABC rollup, refreshed nightly by abc-worker-boss.
      // variant_id is reserved for the post-per-variant-GRN follow-up wave;
      // day-one rows always have variant_id = NULL. COALESCE(variant_id, 0)
      // in the unique index keeps the NULL rows distinct from future per-
      // variant rows.
      await client.query(`
        CREATE TABLE IF NOT EXISTS product_abc_class (
          id SERIAL PRIMARY KEY,
          product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          variant_id INTEGER REFERENCES product_variants(id) ON DELETE CASCADE,
          rank CHAR(1) CHECK (rank IN ('A','B','C')),
          revenue_contribution_pct NUMERIC(6,4),
          units_sold NUMERIC(12,3) DEFAULT 0,
          units_received NUMERIC(12,3) DEFAULT 0,
          sell_through_rate NUMERIC(6,4),
          gross_margin NUMERIC(12,2) DEFAULT 0,
          avg_inventory_value NUMERIC(12,2) DEFAULT 0,
          gmroi NUMERIC(8,4),
          daily_velocity NUMERIC(10,4) DEFAULT 0,
          days_since_last_sale INTEGER,
          window_days INTEGER NOT NULL,
          computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_product_abc_class_unique
          ON product_abc_class(product_id, COALESCE(variant_id, 0))
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_product_abc_class_rank
          ON product_abc_class(rank)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_product_abc_class_dead
          ON product_abc_class(days_since_last_sale)
          WHERE days_since_last_sale >= 90
      `);

      // 2-G.8: cycle count scheduling primitives. cycle_count_schedules
      // defines recurring counts filtered by JSONB criteria (outlet,
      // category, brand, supplier, abc_rank). cycle_count_sessions wraps the
      // existing stock_counts primitive so the UI reuses the stock-count
      // screen for entry while variance rollup is tracked per session.
      await client.query(`
        CREATE TABLE IF NOT EXISTS cycle_count_schedules (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          filter_criteria JSONB NOT NULL DEFAULT '{}',
          recurrence TEXT NOT NULL CHECK (recurrence IN ('weekly','monthly','quarterly')),
          next_due_date DATE NOT NULL,
          last_run_at TIMESTAMPTZ,
          is_active BOOLEAN DEFAULT TRUE,
          created_by INTEGER REFERENCES employees(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS cycle_count_sessions (
          id SERIAL PRIMARY KEY,
          schedule_id INTEGER REFERENCES cycle_count_schedules(id) ON DELETE SET NULL,
          stock_count_id INTEGER NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
          started_at TIMESTAMPTZ DEFAULT NOW(),
          completed_at TIMESTAMPTZ,
          variance_units INTEGER DEFAULT 0,
          variance_value NUMERIC(12,2) DEFAULT 0,
          assigned_to INTEGER REFERENCES employees(id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cycle_count_sessions_schedule
          ON cycle_count_sessions(schedule_id)
      `);
      // Partial unique index — only one OPEN session per schedule at a time.
      // Closed sessions (completed_at IS NOT NULL) never conflict.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_cycle_count_sessions_one_open
          ON cycle_count_sessions(schedule_id)
          WHERE completed_at IS NULL
      `);

      // 2-G.8: lead-time resolution chain (product override → supplier
      // default → tenant default → hardcoded 7d). safety_stock_days lives on
      // the product row only (never inherited from supplier per design).
      await client.query(`
        ALTER TABLE suppliers
          ADD COLUMN IF NOT EXISTS default_lead_time_days INTEGER DEFAULT 7
      `);
      await client.query(`
        ALTER TABLE products
          ADD COLUMN IF NOT EXISTS lead_time_days_override INTEGER,
          ADD COLUMN IF NOT EXISTS safety_stock_days INTEGER DEFAULT 3
      `);

      // 2-G.8: tenant-wide defaults on company_profile (single-row). Matches
      // the existing pattern (loyalty_earn_rate, margin_threshold_pct, etc.)
      // rather than introducing a new generic KV settings store.
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS abc_window_days INTEGER NOT NULL DEFAULT 90,
          ADD COLUMN IF NOT EXISTS tenant_default_lead_time_days INTEGER NOT NULL DEFAULT 7,
          ADD COLUMN IF NOT EXISTS tenant_default_safety_stock_days INTEGER NOT NULL DEFAULT 3
      `);
    },
  },
  {
    version: 71,
    description:
      "Phase 2-G.9 Layaway / hold / special-order — holds + hold_items + hold_payments + phase2g_holds flag",
    up: async (client) => {
      // 2-G.9: holds is the entry row; hold_items carries the cart snapshot;
      // hold_payments is the ledger of deposits/part-payments (dedicated table
      // rather than sale_payments because sale_payments.sale_id is NOT NULL
      // and we have no sale until the hold is completed). Stock is held via
      // inventory_reservations with reference_type='hold' — no schema change
      // needed there.
      await client.query(`
        CREATE TABLE IF NOT EXISTS holds (
          id SERIAL PRIMARY KEY,
          hold_number TEXT UNIQUE NOT NULL,
          customer_id INTEGER REFERENCES customers(id),
          customer_phone TEXT,
          customer_name TEXT,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active','paid','completed','forfeit','cancelled')),
          total_amount NUMERIC(12,2) NOT NULL,
          deposit_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
          balance_due NUMERIC(12,2) NOT NULL,
          hold_until TIMESTAMPTZ,
          notes TEXT,
          created_by INTEGER REFERENCES employees(id),
          completed_sale_id INTEGER REFERENCES sales(id),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_holds_outlet_status ON holds(outlet_id, status)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_holds_hold_until ON holds(hold_until) WHERE status = 'active'
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS hold_items (
          id SERIAL PRIMARY KEY,
          hold_id INTEGER NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES products(id),
          variant_id INTEGER REFERENCES product_variants(id),
          quantity NUMERIC(10,3) NOT NULL,
          price_at_hold NUMERIC(12,2) NOT NULL
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_hold_items_hold ON hold_items(hold_id)
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS hold_payments (
          id SERIAL PRIMARY KEY,
          hold_id INTEGER NOT NULL REFERENCES holds(id) ON DELETE CASCADE,
          amount NUMERIC(12,2) NOT NULL,
          method TEXT NOT NULL,
          gateway_ref TEXT,
          paid_at TIMESTAMPTZ DEFAULT NOW(),
          recorded_by INTEGER REFERENCES employees(id)
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_hold_payments_hold ON hold_payments(hold_id)
      `);

      await client.query(`
        INSERT INTO feature_flags (key, enabled, description)
          VALUES ('phase2g_holds', FALSE, '2-G.9 layaway/hold/special-order')
          ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 72,
    description:
      "Phase 2-G.13 Per-device Quick Grid — widen pos_layouts.scope_type to include 'device' + pos_device_registry sidecar",
    up: async (client) => {
      // 2-G.13: extend pos_layouts scope_type with a fifth value. scope_id
      // continues to carry an INTEGER (the surrogate device id from the
      // sidecar registry), preserving the existing UNIQUE(scope_type, scope_id).
      await client.query(`
        ALTER TABLE pos_layouts DROP CONSTRAINT IF EXISTS pos_layouts_scope_type_check
      `);
      await client.query(`
        ALTER TABLE pos_layouts
          ADD CONSTRAINT pos_layouts_scope_type_check
          CHECK (scope_type IN ('global','outlet','role','employee','device'))
      `);

      // Device registry — maps browser-generated UUIDs to surrogate serial ids
      // so the admin UI has a human-readable device list. last_seen lets a
      // future cleanup sweep orphan devices idle > 90 days.
      await client.query(`
        CREATE TABLE IF NOT EXISTS pos_device_registry (
          id SERIAL PRIMARY KEY,
          device_uuid TEXT UNIQUE NOT NULL,
          outlet_id INTEGER REFERENCES outlets(id),
          label TEXT,
          last_seen TIMESTAMPTZ DEFAULT NOW(),
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pos_device_registry_outlet
          ON pos_device_registry(outlet_id)
      `);
    },
  },
  {
    version: 73,
    description:
      "Phase 2-G.17 Anti-theft & shrinkage — no-sale tracking, anomaly flags, risk thresholds",
    up: async (client) => {
      // Seedable reason codes for no-sale drawer kicks.
      await client.query(`
        CREATE TABLE IF NOT EXISTS no_sale_reasons (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          label TEXT NOT NULL,
          is_active BOOLEAN DEFAULT TRUE,
          sort_order INT DEFAULT 0
        )
      `);
      await client.query(`
        INSERT INTO no_sale_reasons (code, label, sort_order) VALUES
          ('give_change', 'Give change', 1),
          ('count_cash',  'Count cash',  2),
          ('training',    'Training',    3),
          ('other',       'Other',       9)
        ON CONFLICT (code) DO NOTHING
      `);

      // Per-event audit log for every no-sale drawer kick.
      await client.query(`
        CREATE TABLE IF NOT EXISTS no_sale_events (
          id SERIAL PRIMARY KEY,
          employee_id INT NOT NULL REFERENCES employees(id),
          outlet_id INT REFERENCES outlets(id),
          shift_id INT REFERENCES cash_shifts(id),
          reason_code TEXT REFERENCES no_sale_reasons(code),
          note TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_no_sale_events_employee_created
          ON no_sale_events(employee_id, created_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_no_sale_events_outlet_created
          ON no_sale_events(outlet_id, created_at DESC)
      `);

      // Anomaly flags produced by the nightly worker.
      await client.query(`
        CREATE TABLE IF NOT EXISTS retail_anomaly_flags (
          id SERIAL PRIMARY KEY,
          employee_id INT NOT NULL REFERENCES employees(id),
          outlet_id INT REFERENCES outlets(id),
          metric TEXT NOT NULL,
          value NUMERIC(8,4) NOT NULL,
          peer_mean NUMERIC(8,4) NOT NULL,
          peer_stddev NUMERIC(8,4) NOT NULL,
          z_score NUMERIC(6,2) NOT NULL,
          period_start DATE NOT NULL,
          period_end DATE NOT NULL,
          flagged_at TIMESTAMPTZ DEFAULT NOW(),
          reviewed_by INT REFERENCES employees(id),
          reviewed_at TIMESTAMPTZ,
          review_note TEXT
        )
      `);
      // Dedupe key: same employee + metric + window cannot flag twice.
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_anomaly_flags_employee_metric_period
          ON retail_anomaly_flags(employee_id, metric, period_start, period_end)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_anomaly_flags_employee
          ON retail_anomaly_flags(employee_id, flagged_at DESC)
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_anomaly_flags_unreviewed
          ON retail_anomaly_flags(flagged_at DESC)
          WHERE reviewed_at IS NULL
      `);

      // Tenant-level risk thresholds (single-row table, id=1).
      await client.query(`
        CREATE TABLE IF NOT EXISTS risk_controls_config (
          id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
          refund_approval_threshold NUMERIC(12,2) DEFAULT 5000,
          variance_approval_threshold NUMERIC(12,2) DEFAULT 500,
          anomaly_z_score_threshold NUMERIC(4,2) DEFAULT 2.0,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await client.query(`
        INSERT INTO risk_controls_config (id) VALUES (1)
        ON CONFLICT (id) DO NOTHING
      `);

      // Seed umbrella feature flag (default OFF).
      await client.query(`
        INSERT INTO feature_flags (key, enabled, description)
          VALUES ('phase2g_risk_controls', FALSE,
                  '2-G.17 anti-theft: no-sale tracking, refund threshold, anomaly detection, shift variance')
          ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 74,
    description:
      "Phase 2-G.15 Refund idempotency — partial unique index on returns(original_sale_id, idempotency_key)",
    up: async (client) => {
      // Idempotency column + partial unique index: a client-supplied key lets
      // the server reject an accidental double-submit (network retry, double
      // click). NULL keys are always allowed — legacy callers keep working.
      await client.query(`
        ALTER TABLE returns
          ADD COLUMN IF NOT EXISTS idempotency_key TEXT
      `);
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_sale_idempotency
          ON returns(original_sale_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
      `);
    },
  },
  {
    version: 75,
    description:
      "Phase 2-G.16 Merchant home — employees.home_page preference + retail_weekly_digest flag",
    up: async (client) => {
      // Per-employee "land here on login" preference. Nullable so existing
      // employees keep the default /dashboard landing.
      await client.query(`
        ALTER TABLE employees
          ADD COLUMN IF NOT EXISTS home_page TEXT
      `);
      // Opt-in weekly digest email for retail tenants — off by default.
      await client.query(`
        INSERT INTO feature_flags (key, enabled, description)
          VALUES ('retail_weekly_digest', FALSE,
                  '2-G.16 weekly digest email to merchant owners (Monday 08:00 local)')
          ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 76,
    description:
      "Phase 2-G Bucket F polish — receipt template designer (logo, paper width, toggles) + shift auto-close + offline returns flag",
    up: async (client) => {
      // Receipt designer v2: extend receipt_templates with designer fields.
      //   paper_width = roll character width (32=58mm, 42=80mm, 48=80mm-wide).
      //   show_tax_breakdown / show_fbr / show_qr default TRUE so existing
      //   tenants keep today's layout on the first render after upgrade.
      await client.query(`
        ALTER TABLE receipt_templates
          ADD COLUMN IF NOT EXISTS logo_url TEXT,
          ADD COLUMN IF NOT EXISTS paper_width INTEGER DEFAULT 48,
          ADD COLUMN IF NOT EXISTS show_tax_breakdown BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS show_fbr BOOLEAN DEFAULT TRUE,
          ADD COLUMN IF NOT EXISTS show_qr BOOLEAN DEFAULT TRUE
      `);

      // Shift auto-close: track closing method + audit trail for forced closes.
      await client.query(`
        ALTER TABLE cash_shifts
          ADD COLUMN IF NOT EXISTS closing_method TEXT DEFAULT 'manual',
          ADD COLUMN IF NOT EXISTS closing_note TEXT,
          ADD COLUMN IF NOT EXISTS auto_closed_at TIMESTAMPTZ
      `);

      // Per-tenant auto-close threshold (hours). 36h default = overnight
      // retail tolerance without punishing legitimate 24h outlets.
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS shift_auto_close_hours INTEGER DEFAULT 36
      `);

      // Bucket F feature flags. receipt_designer_v2 is ON by default
      // (additive UI with safe defaults); worker + offline refunds start OFF.
      await client.query(`
        INSERT INTO feature_flags (key, enabled, description) VALUES
          ('receipt_designer_v2', TRUE,
           'Bucket F: logo upload, paper width, per-template show/hide toggles, QR on receipt'),
          ('shift_auto_close', FALSE,
           'Bucket F: background worker force-closes shifts older than tenant threshold'),
          ('offline_returns', FALSE,
           'Bucket F: queue partial refunds in IndexedDB while offline')
        ON CONFLICT (key) DO NOTHING
      `);
    },
  },
  {
    version: 77,
    description:
      "Retail launch — company_profile flags for multi-outlet seed/test-receipt/FBR banner; tenants email verification columns",
    up: async (client) => {
      // Tenant-schema columns: PR 5 (multi-outlet auto-enable), PR 7 (test
      // receipt printed marker + dismissable FBR banner). All nullable / safe
      // defaults so existing tenants keep current behavior.
      await client.query(`
        ALTER TABLE company_profile
          ADD COLUMN IF NOT EXISTS multi_outlet_flags_seeded BOOLEAN DEFAULT false,
          ADD COLUMN IF NOT EXISTS test_receipt_printed_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS fbr_banner_dismissed BOOLEAN DEFAULT false
      `);
    },
  },
  {
    version: 78,
    description:
      "Retail launch PR 8 — public.tenants email verification columns",
    up: async (client) => {
      // Public-schema only. Idempotent ALTER works under both contexts:
      //   - public migrate: targets public.tenants directly
      //   - per-tenant migrate: search_path includes public, so the same
      //     ALTER hits the same public.tenants row; IF NOT EXISTS makes it
      //     a no-op on the second pass.
      await client.query(`
        ALTER TABLE tenants
          ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS email_verification_token TEXT
      `);
      // Backfill existing tenants as already-verified so they aren't blocked
      // from /api/setup/complete after this ships. New signups will get NULL
      // until they click the verify link.
      await client.query(`
        UPDATE tenants
           SET email_verified_at = COALESCE(email_verified_at, created_at)
         WHERE email_verified_at IS NULL
      `);
    },
  },
  {
    version: 79,
    description:
      "Loyalty tiers — dedupe + UNIQUE(name) (fixes ON CONFLICT no-op bug)",
    up: async (client) => {
      // Background: the original loyalty_tiers seed in schema-pg.sql + the v34
      // migration both used `ON CONFLICT DO NOTHING` without a target column.
      // The table had no UNIQUE on `name`, so PostgreSQL never matched a
      // conflict — every re-run inserted fresh duplicate rows. Tenants
      // provisioned with the old DDL accumulated 8-12 dup rows when setup
      // retried (see Phase 2 walkthrough finding from 2026-04-27).
      //
      // This migration:
      //   1. Reassigns customers.loyalty_tier_id from any non-canonical
      //      duplicate row to the canonical (lowest id) row of the same name,
      //      preserving the FK reference.
      //   2. Deletes the duplicate rows (keeps lowest id per name).
      //   3. Adds the UNIQUE(name) constraint that should have been there
      //      from day one.
      //
      // Idempotent: on a clean tenant the UPDATE and DELETE are no-ops,
      // and the DO block guards the ALTER so re-runs don't fail.
      //
      // Public schema also has loyalty_tiers (created by v34's CREATE TABLE
      // IF NOT EXISTS running under search_path=public). It's empty/unused
      // for production, so the dedup is a no-op there.

      // Skip if the table doesn't exist in this schema (defensive)
      const { rows: tableExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'loyalty_tiers'
      `);
      if (!tableExists.length) return;

      // 1. Reassign customers from duplicate tiers to the canonical row.
      //    Guarded — public schema may have loyalty_tiers but not customers.
      const { rows: customersExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'customers'
      `);
      if (customersExists.length) {
        await client.query(`
          WITH canonical AS (
            SELECT name, MIN(id) AS keep_id FROM loyalty_tiers GROUP BY name
          )
          UPDATE customers c
             SET loyalty_tier_id = can.keep_id
            FROM loyalty_tiers t
            JOIN canonical can ON can.name = t.name
           WHERE c.loyalty_tier_id = t.id
             AND t.id <> can.keep_id
        `);
      }

      // 2. Delete duplicate rows (keep lowest id per name)
      await client.query(`
        DELETE FROM loyalty_tiers
         WHERE id NOT IN (SELECT MIN(id) FROM loyalty_tiers GROUP BY name)
      `);

      // 3. Add UNIQUE(name) constraint if not already present
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = 'loyalty_tiers_name_key'
               AND conrelid = 'loyalty_tiers'::regclass
          ) THEN
            ALTER TABLE loyalty_tiers
              ADD CONSTRAINT loyalty_tiers_name_key UNIQUE (name);
          END IF;
        END $$
      `);
    },
  },
  {
    version: 80,
    description:
      "Chart of accounts — dedupe + UNIQUE(code) (same ON CONFLICT no-op bug class as v79)",
    up: async (client) => {
      // Background: identical bug to loyalty_tiers (v79). The chart_of_accounts
      // seed in schema-pg.sql + the v9 migration both used `ON CONFLICT DO NOTHING`
      // without a target column. The table had no UNIQUE on `code`, so the
      // conflict target defaulted to the PRIMARY KEY (id, SERIAL) — which never
      // collides. Every re-run inserted fresh duplicate rows. Tenants
      // provisioned with the old DDL accumulated 3× duplicate rows for every
      // system account (~63 rows for the 21 default accounts) — discovered
      // during Phase 2 Day 2 walkthrough on 2026-04-28.
      //
      // Why critical: the rows have is_system=true → locked from UI deletion.
      // Journal entries reference one of N duplicates ambiguously; reports
      // sum across only the joined copy. Real accounting integrity risk.
      //
      // This migration:
      //   1. Reassigns journal_entry_lines.account_id from non-canonical
      //      duplicate rows to the canonical (lowest id) row of the same code.
      //   2. Reassigns chart_of_accounts.parent_id (self-FK) the same way.
      //   3. Deletes duplicate rows (keeps lowest id per code).
      //   4. Adds the UNIQUE(code) constraint that should have been there
      //      from day one.
      //
      // Idempotent: on a clean tenant the UPDATEs and DELETE are no-ops,
      // and the DO block guards the ALTER so re-runs don't fail.

      // Skip if the table doesn't exist in this schema (defensive)
      const { rows: tableExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'chart_of_accounts'
      `);
      if (!tableExists.length) return;

      // 1. Reassign journal_entry_lines.account_id to the canonical row.
      //    Guarded — table may not exist in every schema state.
      const { rows: jelExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'journal_entry_lines'
      `);
      if (jelExists.length) {
        await client.query(`
          WITH canonical AS (
            SELECT code, MIN(id) AS keep_id FROM chart_of_accounts GROUP BY code
          )
          UPDATE journal_entry_lines jel
             SET account_id = can.keep_id
            FROM chart_of_accounts a
            JOIN canonical can ON can.code = a.code
           WHERE jel.account_id = a.id
             AND a.id <> can.keep_id
        `);
      }

      // 2. Reassign chart_of_accounts.parent_id (self-FK) to the canonical row.
      await client.query(`
        WITH canonical AS (
          SELECT code, MIN(id) AS keep_id FROM chart_of_accounts GROUP BY code
        )
        UPDATE chart_of_accounts c
           SET parent_id = can.keep_id
          FROM chart_of_accounts p
          JOIN canonical can ON can.code = p.code
         WHERE c.parent_id = p.id
           AND p.id <> can.keep_id
      `);

      // 3. Delete duplicate rows (keep lowest id per code)
      await client.query(`
        DELETE FROM chart_of_accounts
         WHERE id NOT IN (SELECT MIN(id) FROM chart_of_accounts GROUP BY code)
      `);

      // 4. Add UNIQUE(code) constraint if not already present
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = 'chart_of_accounts_code_key'
               AND conrelid = 'chart_of_accounts'::regclass
          ) THEN
            ALTER TABLE chart_of_accounts
              ADD CONSTRAINT chart_of_accounts_code_key UNIQUE (code);
          END IF;
        END $$
      `);
    },
  },
  {
    version: 81,
    description:
      "Courier integrations — dedupe + UNIQUE(adapter_key) (same ON CONFLICT no-op bug class as v79/v80)",
    up: async (client) => {
      // Background: third instance of the same bug class as v79 (loyalty_tiers)
      // and v80 (chart_of_accounts). The courier_integrations seed in
      // schema-pg.sql + the v5 migration (10 couriers) + the v17 migration
      // (3 more couriers) all used `ON CONFLICT DO NOTHING` without a target
      // column. The table had no UNIQUE on `adapter_key`, so the conflict
      // target defaulted to the PRIMARY KEY (id, SERIAL) — which never
      // collides. Fresh tenants got 3x duplicate rows for all 13 system
      // couriers (39 rows). Discovered during Phase 2 Day 2 walkthrough on
      // 2026-04-28.
      //
      // Why this matters: Courier Settings UI shows 39 cards for 13 unique
      // couriers — confusing and error-prone (which one to enable?). If a
      // user enables one duplicate, web_orders.courier_id may FK to a
      // different copy than other workflows expect.
      //
      // This migration:
      //   1. Reassigns FK references (web_orders.courier_id, loadsheets,
      //      order_shipments, cod_settlement_batches) from non-canonical
      //      duplicate rows to the canonical (lowest id) row of the same
      //      adapter_key.
      //   2. Deletes duplicate rows (keeps lowest id per adapter_key).
      //   3. Adds the UNIQUE(adapter_key) constraint.
      //
      // Idempotent: on a clean tenant the UPDATEs and DELETE are no-ops,
      // and the DO block guards the ALTER so re-runs don't fail.

      // Skip if the table doesn't exist in this schema (defensive)
      const { rows: tableExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'courier_integrations'
      `);
      if (!tableExists.length) return;

      // 1. Reassign FK references from duplicate rows to the canonical row.
      //    Each table is guarded — older schema states may not have all of them.
      const fkTables = [
        "web_orders",
        "loadsheets",
        "order_shipments",
        "cod_settlement_batches",
      ];
      for (const tbl of fkTables) {
        const { rows: refExists } = await client.query(
          `
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = $1
            AND column_name = 'courier_id'
        `,
          [tbl]
        );
        if (!refExists.length) continue;
        await client.query(`
          WITH canonical AS (
            SELECT adapter_key, MIN(id) AS keep_id
              FROM courier_integrations GROUP BY adapter_key
          )
          UPDATE ${tbl} t
             SET courier_id = can.keep_id
            FROM courier_integrations c
            JOIN canonical can ON can.adapter_key = c.adapter_key
           WHERE t.courier_id = c.id
             AND c.id <> can.keep_id
        `);
      }

      // 2. Delete duplicate rows (keep lowest id per adapter_key)
      await client.query(`
        DELETE FROM courier_integrations
         WHERE id NOT IN (
           SELECT MIN(id) FROM courier_integrations GROUP BY adapter_key
         )
      `);

      // 3. Add UNIQUE(adapter_key) constraint if not already present
      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
             WHERE conname = 'courier_integrations_adapter_key_key'
               AND conrelid = 'courier_integrations'::regclass
          ) THEN
            ALTER TABLE courier_integrations
              ADD CONSTRAINT courier_integrations_adapter_key_key UNIQUE (adapter_key);
          END IF;
        END $$
      `);
    },
  },
  {
    version: 82,
    description:
      "products.sku partial UNIQUE index — DB-level guard for Phase 3.12 import dup-SKU fix (F10)",
    up: async (client) => {
      // Phase 3.12 walkthrough surfaced that /api/import/products silently
      // accepted duplicate SKUs, both within a single uploaded file and against
      // existing products. C2 (commit 6c30a23) fixed the import-layer
      // validators (F8/F9), but products.sku has no DB-level guard, so any
      // direct INSERT (POS Add Product, single-product API POST, future
      // integrations) could still create dups.
      //
      // Adds a partial UNIQUE INDEX on products(sku) WHERE sku IS NOT NULL.
      // Partial because livetest1 production has 6 of 6 sample products with
      // sku=NULL — a full UNIQUE constraint would reject any second NULL.
      // Postgres treats partial UNIQUE WHERE NOT NULL as "many NULLs allowed,
      // non-NULLs must be unique" — exactly what we want.
      //
      // Safety: if existing data already has dup non-NULL SKUs (legacy tenant
      // state), CREATE UNIQUE INDEX would fail. Wrap in a SAVEPOINT so the
      // failure doesn't poison the whole migration transaction (same lesson
      // as v69). Log a structured warning and continue — new imports remain
      // protected by app-level F8/F9.

      // Skip if the table doesn't exist in this schema (public schema runs
      // migrations too — only tenant schemas have a `products` table)
      const { rows: tableExists } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'products'
      `);
      if (!tableExists.length) return;

      // Skip if the index already exists (idempotency)
      const { rows: indexExists } = await client.query(`
        SELECT 1 FROM pg_indexes
         WHERE schemaname = current_schema()
           AND indexname  = 'products_sku_unique'
      `);
      if (indexExists.length) return;

      // Probe for existing duplicates first so we can log a clear warning
      // instead of an opaque "could not create unique index" error.
      const { rows: dupRows } = await client.query(`
        SELECT sku, COUNT(*)::int AS n
          FROM products
         WHERE sku IS NOT NULL
         GROUP BY sku
        HAVING COUNT(*) > 1
         LIMIT 10
      `);
      if (dupRows.length) {
        console.warn(
          `[migrate-pg v82] Skipping products_sku_unique index in schema "${
            (await client.query("SELECT current_schema()")).rows[0].current_schema
          }" — found ${dupRows.length} duplicate non-NULL SKU group(s): ${dupRows
            .map((r) => `"${r.sku}" (×${r.n})`)
            .join(", ")}. Resolve dups manually then re-run migrate-pg.`
        );
        return;
      }

      await client.query(
        "CREATE UNIQUE INDEX products_sku_unique ON products (sku) WHERE sku IS NOT NULL"
      );
    },
  },
  {
    version: 83,
    description:
      "P8 — tax_mode + per-line tax snapshot on sales/sale_items (3.14 mixed-rate fix)",
    up: async (client) => {
      // Phase 3.14 walkthrough on livetest1 proved that mixed-rate tax sales
      // are broken end-to-end: cart UI computes tax at render time but
      // nothing tax-related is persisted on the sale row. This migration
      // adds:
      //   1. company_profile.tax_mode  ('none' | 'inclusive' | 'exclusive')
      //   2. sale_items.tax_rate_at_sale + tax_amount_at_sale + hs_code_at_sale
      //      + was_backfilled (per-line snapshot at sale-write time)
      //   3. sales.subtotal + tax_total + tax_inclusive (per-sale aggregate)
      //   4. Auto-detect tax_mode for existing tenants from products.gst
      //   5. Best-effort backfill of historical sale_items + sales aggregates
      //
      // Each step is in its own SAVEPOINT block so a single failure (e.g.
      // missing parent table on the public schema) doesn't poison the whole
      // migration transaction.

      // Step 1 — company_profile.tax_mode
      try {
        await client.query("SAVEPOINT v83_company_profile");
        const { rows: cpExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'company_profile'
        `);
        if (cpExists.length) {
          await client.query(`
            ALTER TABLE company_profile
              ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'none'
                CHECK (tax_mode IN ('none', 'inclusive', 'exclusive'))
          `);
        }
        await client.query("RELEASE SAVEPOINT v83_company_profile");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v83_company_profile");
        console.warn(`[migrate-pg v83] company_profile.tax_mode skipped: ${err.message}`);
      }

      // Step 2 — sale_items snapshot columns
      try {
        await client.query("SAVEPOINT v83_sale_items");
        const { rows: siExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'sale_items'
        `);
        if (siExists.length) {
          await client.query(`
            ALTER TABLE sale_items
              ADD COLUMN IF NOT EXISTS tax_rate_at_sale  NUMERIC(8,4),
              ADD COLUMN IF NOT EXISTS tax_amount_at_sale NUMERIC(12,2),
              ADD COLUMN IF NOT EXISTS hs_code_at_sale    TEXT,
              ADD COLUMN IF NOT EXISTS was_backfilled     BOOLEAN NOT NULL DEFAULT false
          `);
        }
        await client.query("RELEASE SAVEPOINT v83_sale_items");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v83_sale_items");
        console.warn(`[migrate-pg v83] sale_items snapshot columns skipped: ${err.message}`);
      }

      // Step 3 — sales aggregate columns
      try {
        await client.query("SAVEPOINT v83_sales");
        const { rows: salesExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'sales'
        `);
        if (salesExists.length) {
          await client.query(`
            ALTER TABLE sales
              ADD COLUMN IF NOT EXISTS subtotal      NUMERIC(12,2),
              ADD COLUMN IF NOT EXISTS tax_total     NUMERIC(12,2),
              ADD COLUMN IF NOT EXISTS tax_inclusive BOOLEAN
          `);
        }
        await client.query("RELEASE SAVEPOINT v83_sales");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v83_sales");
        console.warn(`[migrate-pg v83] sales aggregate columns skipped: ${err.message}`);
      }

      // Step 4 — auto-detect tax_mode for existing tenants
      try {
        await client.query("SAVEPOINT v83_auto_detect");
        const { rows: cpExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'company_profile'
        `);
        const { rows: pExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'products'
        `);
        if (cpExists.length && pExists.length) {
          await client.query(`
            UPDATE company_profile
               SET tax_mode = 'inclusive'
             WHERE id = 1
               AND tax_mode = 'none'
               AND EXISTS (SELECT 1 FROM products WHERE gst IS NOT NULL AND gst > 0)
          `);
        }
        await client.query("RELEASE SAVEPOINT v83_auto_detect");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v83_auto_detect");
        console.warn(`[migrate-pg v83] auto-detect tax_mode skipped: ${err.message}`);
      }

      // Step 5 — backfill sale_items snapshot (only NULL rows, idempotent)
      try {
        await client.query("SAVEPOINT v83_backfill_items");
        const { rows: siExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'sale_items'
        `);
        const { rows: pExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'products'
        `);
        if (siExists.length && pExists.length) {
          await client.query(`
            UPDATE sale_items si
               SET tax_rate_at_sale  = COALESCE(p.gst, 0),
                   tax_amount_at_sale = ROUND(
                     (si.price_at_sale * si.quantity * COALESCE(p.gst, 0) / 100.0)::numeric,
                     2
                   ),
                   hs_code_at_sale    = NULL,
                   was_backfilled     = true
              FROM products p
             WHERE si.product_id = p.id
               AND si.tax_rate_at_sale IS NULL
          `);
        }
        await client.query("RELEASE SAVEPOINT v83_backfill_items");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v83_backfill_items");
        console.warn(`[migrate-pg v83] sale_items backfill skipped: ${err.message}`);
      }

      // Step 6 — backfill sales aggregates (only NULL rows, idempotent)
      try {
        await client.query("SAVEPOINT v83_backfill_sales");
        const { rows: salesExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'sales'
        `);
        const { rows: siExists } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'sale_items'
        `);
        if (salesExists.length && siExists.length) {
          await client.query(`
            UPDATE sales s
               SET subtotal      = COALESCE(agg.subtotal, 0),
                   tax_total     = COALESCE(agg.tax_total, 0),
                   tax_inclusive = false
              FROM (
                SELECT sale_id,
                       SUM(price_at_sale * quantity)        AS subtotal,
                       SUM(COALESCE(tax_amount_at_sale, 0)) AS tax_total
                  FROM sale_items
                 GROUP BY sale_id
              ) agg
             WHERE s.id = agg.sale_id
               AND (s.subtotal IS NULL OR s.tax_total IS NULL)
          `);
        }
        await client.query("RELEASE SAVEPOINT v83_backfill_sales");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v83_backfill_sales");
        console.warn(`[migrate-pg v83] sales aggregate backfill skipped: ${err.message}`);
      }
    },
  },
  {
    version: 84,
    description:
      "P33 — backup_log column union: every documented INSERT site must succeed",
    up: async (client) => {
      // Phase 7.13 walkthrough proved every backup_log INSERT in the codebase
      // referenced columns that don't exist in production:
      //   - production columns: (action NOT NULL, filename, size_bytes, performed_by, note, created_at)
      //   - migration v4 + schema-pg.sql shape: (schema_name, status, size_bytes, duration_ms, error_message)
      //   - admin INSERT (system.js): (filename, size_bytes, url, created_at)
      //   - 5 tenant INSERTs (barcode-expenses.js): (schema_name, status, size_bytes, duration_ms, error_message)
      // Every INSERT was wrapped in silent try/catch, so the actual R2 .dump
      // upload happened but the audit row was lost — admin/tenant dashboards
      // saw "no backups". Confirmed live on 2026-04-30 (table empty despite
      // a successful backup yesterday).
      //
      // Fix: union all columns so every INSERT site works. Drop NOT NULL on
      // action so prod-shape rows that don't supply it (i.e. all current
      // INSERTs) succeed.
      //
      // backup_log lives only in the public schema — skip when migrating
      // a tenant schema. Tenant schemas don't have a backup_log table.
      try {
        await client.query("SAVEPOINT v84_backup_log_union");
        const { rows: bl } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'backup_log'
        `);
        if (bl.length) {
          await client.query(`
            ALTER TABLE backup_log
              ADD COLUMN IF NOT EXISTS action        TEXT,
              ADD COLUMN IF NOT EXISTS filename      TEXT,
              ADD COLUMN IF NOT EXISTS size_bytes    BIGINT,
              ADD COLUMN IF NOT EXISTS performed_by  TEXT,
              ADD COLUMN IF NOT EXISTS note          TEXT,
              ADD COLUMN IF NOT EXISTS url           TEXT,
              ADD COLUMN IF NOT EXISTS schema_name   TEXT,
              ADD COLUMN IF NOT EXISTS status        TEXT,
              ADD COLUMN IF NOT EXISTS duration_ms   INTEGER,
              ADD COLUMN IF NOT EXISTS error_message TEXT,
              ADD COLUMN IF NOT EXISTS tenant_slug   TEXT
          `);
          // Drop NOT NULL on action (production has it, the migration v4
          // shape doesn't have action at all). Either way, INSERTs that
          // omit action must succeed.
          await client.query(`
            ALTER TABLE backup_log ALTER COLUMN action DROP NOT NULL
          `);
        }
        await client.query("RELEASE SAVEPOINT v84_backup_log_union");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v84_backup_log_union");
        console.warn(`[migrate-pg v84] backup_log union skipped: ${err.message}`);
      }
    },
  },
  {
    version: 85,
    description:
      "Customer order kiosk — restaurant_kiosk_slots table + draft_orders.submitted_at + 'kiosk_counter' order_context",
    up: async (client) => {
      // Counter-mode kiosks need a stable per-outlet bookmark URL while the
      // draft order behind it rotates per customer. The slot row holds the
      // stable token; current_draft_order_id swings to a fresh draft on each
      // /menu hit when the previous one is null. See
      // docs/plans/2026-05-06-order-kiosk-design.md "Counter-mode tablet URL
      // stability" for the full rationale.
      await client.query(`
        CREATE TABLE IF NOT EXISTS restaurant_kiosk_slots (
          id SERIAL PRIMARY KEY,
          outlet_id INTEGER NOT NULL REFERENCES outlets(id),
          slot_token TEXT NOT NULL UNIQUE,
          label TEXT,
          current_draft_order_id INTEGER REFERENCES draft_orders(id),
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_restaurant_kiosk_slots_outlet_active
          ON restaurant_kiosk_slots(outlet_id) WHERE revoked_at IS NULL;
      `);

      // submitted_at marks the moment a customer hit "Place Order" on the
      // kiosk surface. Counter-mode submissions also write a web_orders row
      // (so the existing inbox accept flow handles them); stamping this is
      // belt-and-braces. Table-mode submissions only stamp this column —
      // they don't insert a web_orders row, the server fires from Checks.
      await client.query(`
        ALTER TABLE draft_orders
          ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
      `);

      // Widen order_context CHECK to include 'kiosk_counter'. Drop+recreate
      // because IF NOT EXISTS doesn't update an existing constraint.
      await client.query(`
        ALTER TABLE draft_orders DROP CONSTRAINT IF EXISTS draft_orders_order_context_check;
        ALTER TABLE draft_orders ADD CONSTRAINT draft_orders_order_context_check
          CHECK (order_context IN ('retail','dine_in','takeout','delivery','bar','online','drive_thru','kiosk_counter'));
      `);

      // Counter-mode kiosk drafts have no logged-in employee at mint time
      // (the customer is anonymous). Existing rows always carry a
      // created_by, so this is safe — it only loosens the schema for the
      // new kiosk path.
      await client.query(`
        ALTER TABLE draft_orders ALTER COLUMN created_by DROP NOT NULL;
      `);
    },
  },
  {
    version: 86,
    description:
      "Legal consent tracking — tos_version, privacy_version, consent_at, consent_ip on public.tenants",
    up: async (client) => {
      // Capture which version of the Terms / Privacy Policy a tenant agreed
      // to at signup, plus when and from what IP. Required for defensible
      // proof-of-consent if the documents are ever challenged. Lives on
      // public.tenants only — tenant schemas don't carry this.
      try {
        await client.query("SAVEPOINT v86_consent_columns");
        const { rows: t } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'tenants'
        `);
        if (t.length) {
          await client.query(`
            ALTER TABLE tenants
              ADD COLUMN IF NOT EXISTS tos_version     TEXT,
              ADD COLUMN IF NOT EXISTS privacy_version TEXT,
              ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
              ADD COLUMN IF NOT EXISTS consent_ip      TEXT
          `);
        }
        await client.query("RELEASE SAVEPOINT v86_consent_columns");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v86_consent_columns");
        console.warn(`[migrate-pg v86] consent columns skipped: ${err.message}`);
      }
    },
  },
  {
    version: 87,
    description:
      "Tier 0 wholesale foundation — ar_aging_buckets column on company_profile + backfill wholesale mode/flag for existing wholesale tenants",
    up: async (client) => {
      // Per-tenant migration. company_profile lives in tenant schemas only;
      // skip cleanly when running against the public schema (which does not
      // have it).
      const { rows: cp } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'company_profile'
      `);
      if (!cp.length) return;

      // 1. ar_aging_buckets — configurable AR aging buckets, JSONB array.
      //    Default [30,60,90] = convention 0-30 / 31-60 / 61-90 / 90+.
      //    Consumed by GET /api/reports/ar-aging (Tier 0 item 0.3).
      try {
        await client.query("SAVEPOINT v87_ar_buckets");
        await client.query(`
          ALTER TABLE company_profile
            ADD COLUMN IF NOT EXISTS ar_aging_buckets JSONB NOT NULL DEFAULT '[30, 60, 90]'::jsonb
        `);
        await client.query("RELEASE SAVEPOINT v87_ar_buckets");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v87_ar_buckets");
        console.warn(`[migrate-pg v87] ar_aging_buckets skipped: ${err.message}`);
      }

      // 2. Backfill: if this tenant is industry_type='wholesale', seed the
      //    wholesale mode row + wholesale_credit_controls flag. Mirrors the
      //    v44 mode-gate backfill pattern. Idempotent.
      try {
        await client.query("SAVEPOINT v87_wholesale_backfill");
        const { rows: profile } = await client.query(
          "SELECT industry_type FROM company_profile WHERE id = 1"
        );
        if (profile[0]?.industry_type === "wholesale") {
          const { rows: tm } = await client.query(`
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'tenant_modes'
          `);
          if (tm.length) {
            await client.query(
              `INSERT INTO tenant_modes (mode, enabled) VALUES ('wholesale', true)
               ON CONFLICT (mode) DO NOTHING`
            );
          }
          const { rows: ff } = await client.query(`
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = current_schema() AND table_name = 'feature_flags'
          `);
          if (ff.length) {
            await client.query(
              `INSERT INTO feature_flags (key, enabled) VALUES ('wholesale_credit_controls', true)
               ON CONFLICT (key) DO UPDATE SET enabled = true`
            );
          }
        }
        await client.query("RELEASE SAVEPOINT v87_wholesale_backfill");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v87_wholesale_backfill");
        console.warn(`[migrate-pg v87] wholesale backfill skipped: ${err.message}`);
      }
    },
  },
  {
    version: 88,
    description:
      "Tier 0.1 wholesale — customer credit limit + block mode + payment terms; sales.customer_invoice_id link for on-account sales",
    up: async (client) => {
      // Per-tenant migration. All tables involved live in tenant schemas.
      const { rows: cust } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'customers'
      `);
      if (!cust.length) return;

      // 1. Credit fields on customers
      try {
        await client.query("SAVEPOINT v88_customers_credit");
        await client.query(`
          ALTER TABLE customers
            ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS credit_block_mode TEXT NOT NULL DEFAULT 'warn',
            ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 0
        `);
        // CHECK constraint added separately so it can be retried independently
        // and skipped if it already exists. NOT VALID first to avoid scanning
        // existing rows (defaults guarantee compliance).
        try {
          await client.query(`
            ALTER TABLE customers
              ADD CONSTRAINT customers_credit_block_mode_check
              CHECK (credit_block_mode IN ('off','warn','hard'))
          `);
        } catch (e) {
          if (!String(e.message || "").match(/already exists|duplicate/i)) throw e;
        }
        await client.query("RELEASE SAVEPOINT v88_customers_credit");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v88_customers_credit");
        console.warn(`[migrate-pg v88] customers credit columns skipped: ${err.message}`);
      }

      // 2. customer_invoice_id link on sales
      try {
        await client.query("SAVEPOINT v88_sales_invoice_link");
        const { rows: salesT } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'sales'
        `);
        if (salesT.length) {
          await client.query(`
            ALTER TABLE sales
              ADD COLUMN IF NOT EXISTS customer_invoice_id INTEGER REFERENCES customer_invoices(id)
          `);
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sales_customer_invoice_id
              ON sales(customer_invoice_id)
          `);
        }
        await client.query("RELEASE SAVEPOINT v88_sales_invoice_link");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v88_sales_invoice_link");
        console.warn(`[migrate-pg v88] sales invoice link skipped: ${err.message}`);
      }
    },
  },
  {
    version: 89,
    description:
      "Tier 0.1 wholesale — backfill override_credit_limit perm onto Manager role for existing tenants (role_permissions only seeds at tenant creation, not on subsequent boots)",
    up: async (client) => {
      const { rows: rolesT } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'roles'
      `);
      if (!rolesT.length) return;

      try {
        await client.query("SAVEPOINT v89_override_credit_limit_perm");
        const { rows: [manager] } = await client.query(
          "SELECT id FROM roles WHERE name = 'Manager' LIMIT 1"
        );
        if (manager?.id) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission)
             VALUES ($1, 'override_credit_limit')
             ON CONFLICT DO NOTHING`,
            [manager.id]
          );
        }
        await client.query("RELEASE SAVEPOINT v89_override_credit_limit_perm");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v89_override_credit_limit_perm");
        console.warn(`[migrate-pg v89] override_credit_limit backfill skipped: ${err.message}`);
      }
    },
  },
  {
    version: 90,
    description:
      "Tier 1.1 wholesale field sales — employee_type classification, customer geocoding (lat/lng), company_profile.field_geofence_meters, field_rep_routes + field_visits tables, Field Rep role, wholesale_field_sales flag, manage_field_sales perm backfill",
    up: async (client) => {
      // Per-tenant migration. All tables live in tenant schemas.
      const { rows: emp } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'employees'
      `);
      if (!emp.length) return;

      // 1. employees.employee_type classification
      try {
        await client.query("SAVEPOINT v90_employee_type");
        await client.query(`
          ALTER TABLE employees
            ADD COLUMN IF NOT EXISTS employee_type TEXT NOT NULL DEFAULT 'in_store'
        `);
        try {
          await client.query(`
            ALTER TABLE employees
              ADD CONSTRAINT employees_employee_type_check
              CHECK (employee_type IN ('in_store','field_rep'))
          `);
        } catch (e) {
          if (!String(e.message || "").match(/already exists|duplicate/i)) throw e;
        }
        await client.query("RELEASE SAVEPOINT v90_employee_type");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_employee_type");
        console.warn(`[migrate-pg v90] employee_type column skipped: ${err.message}`);
      }

      // 2. company_profile.field_geofence_meters (tenant-tunable radius)
      try {
        await client.query("SAVEPOINT v90_field_geofence");
        const { rows: cp } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'company_profile'
        `);
        if (cp.length) {
          await client.query(`
            ALTER TABLE company_profile
              ADD COLUMN IF NOT EXISTS field_geofence_meters INTEGER NOT NULL DEFAULT 500
          `);
        }
        await client.query("RELEASE SAVEPOINT v90_field_geofence");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_field_geofence");
        console.warn(`[migrate-pg v90] field_geofence_meters skipped: ${err.message}`);
      }

      // 3. customers.lat / customers.lng (NULL until rep geo-tags on first visit)
      try {
        await client.query("SAVEPOINT v90_customers_geo");
        const { rows: cust } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'customers'
        `);
        if (cust.length) {
          await client.query(`
            ALTER TABLE customers
              ADD COLUMN IF NOT EXISTS lat NUMERIC(9,6),
              ADD COLUMN IF NOT EXISTS lng NUMERIC(9,6)
          `);
        }
        await client.query("RELEASE SAVEPOINT v90_customers_geo");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_customers_geo");
        console.warn(`[migrate-pg v90] customers lat/lng skipped: ${err.message}`);
      }

      // 4. field_rep_routes — weekly beat plan
      try {
        await client.query("SAVEPOINT v90_field_rep_routes");
        await client.query(`
          CREATE TABLE IF NOT EXISTS field_rep_routes (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
            day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
            customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
            visit_order SMALLINT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (employee_id, day_of_week, visit_order)
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_field_rep_routes_employee_dow
            ON field_rep_routes (employee_id, day_of_week, visit_order)
        `);
        await client.query("RELEASE SAVEPOINT v90_field_rep_routes");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_field_rep_routes");
        console.warn(`[migrate-pg v90] field_rep_routes skipped: ${err.message}`);
      }

      // 5. field_visits — actual visit log with GPS + selfie + outcome
      try {
        await client.query("SAVEPOINT v90_field_visits");
        await client.query(`
          CREATE TABLE IF NOT EXISTS field_visits (
            id SERIAL PRIMARY KEY,
            employee_id INTEGER NOT NULL REFERENCES employees(id),
            customer_id INTEGER NOT NULL REFERENCES customers(id),
            outlet_id INTEGER REFERENCES outlets(id),
            planned_at TIMESTAMPTZ,
            checked_in_at TIMESTAMPTZ,
            gps_lat NUMERIC(9,6),
            gps_lng NUMERIC(9,6),
            gps_accuracy_m INTEGER,
            gps_distance_m INTEGER,
            gps_flagged BOOLEAN DEFAULT false,
            selfie_url TEXT,
            status TEXT NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned','checked_in','ordered','no_stock_needed','shop_closed','owner_away')),
            client_uuid TEXT UNIQUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_field_visits_employee_date
            ON field_visits (employee_id, checked_in_at DESC)
        `);
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_field_visits_customer
            ON field_visits (customer_id, checked_in_at DESC)
        `);
        await client.query("RELEASE SAVEPOINT v90_field_visits");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_field_visits");
        console.warn(`[migrate-pg v90] field_visits skipped: ${err.message}`);
      }

      // 6. Field Rep role + manage_field_sales perm backfill
      try {
        await client.query("SAVEPOINT v90_field_role");
        const { rows: rolesT } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'roles'
        `);
        if (rolesT.length) {
          await client.query(
            `INSERT INTO roles (name) VALUES ('Field Rep') ON CONFLICT (name) DO NOTHING`
          );
          const { rows: [fieldRep] } = await client.query(
            "SELECT id FROM roles WHERE name = 'Field Rep' LIMIT 1"
          );
          if (fieldRep?.id) {
            await client.query(
              `INSERT INTO role_permissions (role_id, permission)
               VALUES ($1, 'manage_field_sales')
               ON CONFLICT DO NOTHING`,
              [fieldRep.id]
            );
          }
          // Backfill Manager so existing tenants gain field-sales access
          const { rows: [manager] } = await client.query(
            "SELECT id FROM roles WHERE name = 'Manager' LIMIT 1"
          );
          if (manager?.id) {
            await client.query(
              `INSERT INTO role_permissions (role_id, permission)
               VALUES ($1, 'manage_field_sales')
               ON CONFLICT DO NOTHING`,
              [manager.id]
            );
          }
        }
        await client.query("RELEASE SAVEPOINT v90_field_role");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_field_role");
        console.warn(`[migrate-pg v90] Field Rep role / perm backfill skipped: ${err.message}`);
      }

      // 7. wholesale_field_sales feature flag — default OFF
      try {
        await client.query("SAVEPOINT v90_field_flag");
        const { rows: ffT } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'feature_flags'
        `);
        if (ffT.length) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled, description)
             VALUES ('wholesale_field_sales', false,
               'Tier 1.1 wholesale — field rep mobile app: route, GPS+selfie check-in, visit log')
             ON CONFLICT (key) DO NOTHING`
          );
        }
        await client.query("RELEASE SAVEPOINT v90_field_flag");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v90_field_flag");
        console.warn(`[migrate-pg v90] wholesale_field_sales flag skipped: ${err.message}`);
      }
    },
  },
  {
    version: 91,
    description:
      "Tier 1.1 wholesale hotfix — re-run Field Rep role + manage_field_sales backfill for tenants where v90 sub-step 6 rolled back due to roles_id sequence collision",
    up: async (client) => {
      const { rows: rolesT } = await client.query(`
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = current_schema() AND table_name = 'roles'
      `);
      if (!rolesT.length) return;

      // Reset the roles_id_seq to MAX(id) before inserting. Sequence collision
      // is the v90 failure mode — earlier rolled-back inserts had advanced
      // nextval() past existing ids, causing roles_pkey conflicts.
      try {
        await client.query("SAVEPOINT v91_seq_reset");
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('roles', 'id'),
            COALESCE((SELECT MAX(id) FROM roles), 0) + 1,
            false
          )
        `);
        await client.query("RELEASE SAVEPOINT v91_seq_reset");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v91_seq_reset");
        console.warn(`[migrate-pg v91] sequence reset skipped: ${err.message}`);
      }

      // Insert Field Rep role (its own savepoint — failure here must not block
      // the Manager perm backfill that follows).
      try {
        await client.query("SAVEPOINT v91_field_rep_role");
        await client.query(
          `INSERT INTO roles (name) VALUES ('Field Rep') ON CONFLICT (name) DO NOTHING`
        );
        const { rows: [fieldRep] } = await client.query(
          "SELECT id FROM roles WHERE name = 'Field Rep' LIMIT 1"
        );
        if (fieldRep?.id) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission)
             VALUES ($1, 'manage_field_sales')
             ON CONFLICT DO NOTHING`,
            [fieldRep.id]
          );
        }
        await client.query("RELEASE SAVEPOINT v91_field_rep_role");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v91_field_rep_role");
        console.warn(`[migrate-pg v91] Field Rep role skipped: ${err.message}`);
      }

      // Backfill Manager.manage_field_sales independently — this is the part
      // that v90 silently dropped, so it must succeed even if the role insert
      // above failed for some other reason.
      try {
        await client.query("SAVEPOINT v91_manager_perm");
        const { rows: [manager] } = await client.query(
          "SELECT id FROM roles WHERE name = 'Manager' LIMIT 1"
        );
        if (manager?.id) {
          await client.query(
            `INSERT INTO role_permissions (role_id, permission)
             VALUES ($1, 'manage_field_sales')
             ON CONFLICT DO NOTHING`,
            [manager.id]
          );
        }
        await client.query("RELEASE SAVEPOINT v91_manager_perm");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v91_manager_perm");
        console.warn(`[migrate-pg v91] Manager perm backfill skipped: ${err.message}`);
      }
    },
  },
  {
    version: 92,
    description:
      "Tier 1.2 wholesale field sales — sales.field_visit_id FK linking a sale back to the field_visit that produced it",
    up: async (client) => {
      // Only run inside tenant schemas that have both tables. Skips public.
      const { rows: tables } = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name IN ('sales', 'field_visits')
      `);
      if (tables.length < 2) return;

      try {
        await client.query("SAVEPOINT v92_field_visit_fk");
        await client.query(
          `ALTER TABLE sales
             ADD COLUMN IF NOT EXISTS field_visit_id INTEGER REFERENCES field_visits(id)`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_sales_field_visit
             ON sales (field_visit_id)
             WHERE field_visit_id IS NOT NULL`
        );
        await client.query("RELEASE SAVEPOINT v92_field_visit_fk");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v92_field_visit_fk");
        console.warn(`[migrate-pg v92] sales.field_visit_id skipped: ${err.message}`);
      }
    },
  },
  {
    version: 93,
    description:
      "Tier 1.3 wholesale schemes — extend promotions with slab_percent type + tier_rules JSONB; add sale_promotion_applications audit table; wholesale_schemes flag",
    up: async (client) => {
      // 1. Extend the promotions.type CHECK to allow 'slab_percent' (volume
      //    slabs: qty_from-qty_to → discount %). Existing types unchanged.
      try {
        await client.query("SAVEPOINT v93_promo_type_check");
        const { rows: pT } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'promotions'
        `);
        if (pT.length) {
          await client.query(
            `ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_type_check`
          );
          await client.query(
            `ALTER TABLE promotions ADD CONSTRAINT promotions_type_check
               CHECK(type IN ('percent','fixed','threshold_percent','threshold_fixed','bxgy','slab_percent'))`
          );
        }
        await client.query("RELEASE SAVEPOINT v93_promo_type_check");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v93_promo_type_check");
        console.warn(`[migrate-pg v93] promotions type check skipped: ${err.message}`);
      }

      // 2. Add promotions.tier_rules JSONB. Shape (for slab_percent):
      //    [{"qty_from": 10, "qty_to": 49, "value": 3},
      //     {"qty_from": 50, "qty_to": 99, "value": 5},
      //     {"qty_from": 100, "qty_to": null, "value": 8}]
      //    NULL for non-slab types.
      try {
        await client.query("SAVEPOINT v93_promo_tier_rules");
        await client.query(
          `ALTER TABLE promotions ADD COLUMN IF NOT EXISTS tier_rules JSONB`
        );
        await client.query(
          `ALTER TABLE promotions ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brands(id)`
        );
        await client.query(
          `ALTER TABLE promotions ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0`
        );
        await client.query("RELEASE SAVEPOINT v93_promo_tier_rules");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v93_promo_tier_rules");
        console.warn(`[migrate-pg v93] promotions columns skipped: ${err.message}`);
      }

      // 3. sale_promotion_applications — audit trail. Each row = one applied
      //    promotion on one sale. Frozen snapshot of promo name + tier value
      //    at apply time so promo edits/deletes don't rewrite history.
      try {
        await client.query("SAVEPOINT v93_promo_applications");
        await client.query(`
          CREATE TABLE IF NOT EXISTS sale_promotion_applications (
            id SERIAL PRIMARY KEY,
            sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
            promotion_id INTEGER REFERENCES promotions(id) ON DELETE SET NULL,
            promotion_name_snapshot TEXT NOT NULL,
            promotion_type_snapshot TEXT NOT NULL,
            qty_qualifying NUMERIC(10,3),
            discount_value NUMERIC(12,2) NOT NULL,
            tier_snapshot JSONB,
            created_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_sale_promo_apps_sale ON sale_promotion_applications(sale_id)`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_sale_promo_apps_promo ON sale_promotion_applications(promotion_id) WHERE promotion_id IS NOT NULL`
        );
        await client.query("RELEASE SAVEPOINT v93_promo_applications");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v93_promo_applications");
        console.warn(`[migrate-pg v93] sale_promotion_applications skipped: ${err.message}`);
      }

      // 4. wholesale_schemes feature flag — default OFF. When ON the
      //    PromotionsRedesign UI exposes the slab-tier editor + brand
      //    scope. When OFF, owners see the existing promotions UI only.
      try {
        await client.query("SAVEPOINT v93_schemes_flag");
        const { rows: ffT } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'feature_flags'
        `);
        if (ffT.length) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled, description)
             VALUES ('wholesale_schemes', false,
               'Tier 1.3 wholesale — slab-tier volume discounts + brand-scoped schemes on promotions')
             ON CONFLICT (key) DO NOTHING`
          );
        }
        await client.query("RELEASE SAVEPOINT v93_schemes_flag");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v93_schemes_flag");
        console.warn(`[migrate-pg v93] wholesale_schemes flag skipped: ${err.message}`);
      }
    },
  },
  {
    version: 94,
    description:
      "Tier 1.4 wholesale secondary sales — manufacturer_partners + brand mapping + refresh tokens + wholesale_secondary_sales flag",
    up: async (client) => {
      // 1. manufacturer_partners — directory of manufacturer accounts that
      //    monitor secondary sales of their brand SKUs through this distributor.
      //    NOT the same as customers: manufacturers don't buy from us, they
      //    monitor onward sales of their brand. Separate auth scope = "manufacturer".
      try {
        await client.query("SAVEPOINT v94_partners_table");
        await client.query(`
          CREATE TABLE IF NOT EXISTS manufacturer_partners (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            contact_name TEXT,
            email TEXT NOT NULL,
            password_hash TEXT,
            status TEXT NOT NULL DEFAULT 'invited'
              CHECK (status IN ('invited','active','suspended')),
            signup_token TEXT,
            signup_token_expires_at TIMESTAMPTZ,
            portal_tokens_revoked_before TIMESTAMPTZ,
            last_login_at TIMESTAMPTZ,
            email_verified_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
          )
        `);
        await client.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS manufacturer_partners_email_unique
             ON manufacturer_partners (LOWER(email))`
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_manufacturer_partners_status
             ON manufacturer_partners (status)`
        );
        await client.query("RELEASE SAVEPOINT v94_partners_table");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v94_partners_table");
        console.warn(`[migrate-pg v94] manufacturer_partners skipped: ${err.message}`);
      }

      // 2. manufacturer_partner_brands — N:N join. One partner can monitor
      //    multiple brands; one brand can be monitored by multiple partners
      //    (rare but allowed — e.g. parent + subsidiary access).
      try {
        await client.query("SAVEPOINT v94_partner_brands");
        await client.query(`
          CREATE TABLE IF NOT EXISTS manufacturer_partner_brands (
            manufacturer_partner_id INTEGER NOT NULL
              REFERENCES manufacturer_partners(id) ON DELETE CASCADE,
            brand_id INTEGER NOT NULL
              REFERENCES brands(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (manufacturer_partner_id, brand_id)
          )
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_mfg_partner_brands_brand
             ON manufacturer_partner_brands (brand_id)`
        );
        await client.query("RELEASE SAVEPOINT v94_partner_brands");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v94_partner_brands");
        console.warn(`[migrate-pg v94] manufacturer_partner_brands skipped: ${err.message}`);
      }

      // 3. manufacturer_portal_refresh_tokens — mirrors customer_portal_refresh_tokens
      //    shape. Refresh tokens stored as SHA-256 hash; raw token only in httpOnly cookie.
      try {
        await client.query("SAVEPOINT v94_refresh_tokens");
        await client.query(`
          CREATE TABLE IF NOT EXISTS manufacturer_portal_refresh_tokens (
            id SERIAL PRIMARY KEY,
            manufacturer_partner_id INTEGER NOT NULL
              REFERENCES manufacturer_partners(id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            revoked_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            last_used_at TIMESTAMPTZ,
            user_agent TEXT,
            ip TEXT
          )
        `);
        await client.query(
          `CREATE INDEX IF NOT EXISTS idx_mfg_portal_refresh_partner
             ON manufacturer_portal_refresh_tokens (manufacturer_partner_id)
             WHERE revoked_at IS NULL`
        );
        await client.query("RELEASE SAVEPOINT v94_refresh_tokens");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v94_refresh_tokens");
        console.warn(`[migrate-pg v94] manufacturer_portal_refresh_tokens skipped: ${err.message}`);
      }

      // 4. wholesale_secondary_sales feature flag — default OFF.
      //    When ON, distributor sees /settings/manufacturer-partners admin UI
      //    and manufacturer portal becomes reachable for invited partners.
      try {
        await client.query("SAVEPOINT v94_secondary_flag");
        const { rows: ffT } = await client.query(`
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = current_schema() AND table_name = 'feature_flags'
        `);
        if (ffT.length) {
          await client.query(
            `INSERT INTO feature_flags (key, enabled, description)
             VALUES ('wholesale_secondary_sales', false,
               'Tier 1.4 wholesale — manufacturer-partner portal for secondary sales visibility')
             ON CONFLICT (key) DO NOTHING`
          );
        }
        await client.query("RELEASE SAVEPOINT v94_secondary_flag");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v94_secondary_flag");
        console.warn(`[migrate-pg v94] wholesale_secondary_sales flag skipped: ${err.message}`);
      }
    },
  },
  {
    version: 95,
    description:
      "Tier 2.2 wholesale MOQ — products.min_order_qty + products.order_increment for portal + field-rep enforcement",
    up: async (client) => {
      // min_order_qty: smallest qty acceptable on a single line. 0 = no minimum
      // (current behavior; safe default for the entire installed base).
      try {
        await client.query("SAVEPOINT v95_min_order_qty");
        await client.query(
          `ALTER TABLE products
             ADD COLUMN IF NOT EXISTS min_order_qty INTEGER NOT NULL DEFAULT 0`
        );
        await client.query(
          `ALTER TABLE products
             DROP CONSTRAINT IF EXISTS products_min_order_qty_nonneg`
        );
        await client.query(
          `ALTER TABLE products
             ADD CONSTRAINT products_min_order_qty_nonneg CHECK (min_order_qty >= 0)`
        );
        await client.query("RELEASE SAVEPOINT v95_min_order_qty");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v95_min_order_qty");
        console.warn(`[migrate-pg v95] min_order_qty skipped: ${err.message}`);
      }

      // order_increment: case-pack multiple. 1 = no rule (current behavior).
      // Values > 1 mean cart qty must be a multiple of this. min_order_qty
      // and order_increment are independent — you can have a min of 6 and an
      // increment of 12 (then valid qtys are 12, 24, 36...).
      try {
        await client.query("SAVEPOINT v95_order_increment");
        await client.query(
          `ALTER TABLE products
             ADD COLUMN IF NOT EXISTS order_increment INTEGER NOT NULL DEFAULT 1`
        );
        await client.query(
          `ALTER TABLE products
             DROP CONSTRAINT IF EXISTS products_order_increment_positive`
        );
        await client.query(
          `ALTER TABLE products
             ADD CONSTRAINT products_order_increment_positive CHECK (order_increment >= 1)`
        );
        await client.query("RELEASE SAVEPOINT v95_order_increment");
      } catch (err) {
        await client.query("ROLLBACK TO SAVEPOINT v95_order_increment");
        console.warn(`[migrate-pg v95] order_increment skipped: ${err.message}`);
      }
    },
  },
];

async function migrate(db) {
  // Ensure schema_version table exists (bootstrap)
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get current version
  const { rows } = await db.query(
    "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1"
  );
  const currentVersion = rows[0]?.version || 0;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion);

  if (pending.length === 0) {
    console.log(`[migrate-pg] Schema is up to date (version ${currentVersion}).`);
    return currentVersion;
  }

  console.log(
    `[migrate-pg] Current version: ${currentVersion}, applying ${pending.length} migration(s)...`
  );

  for (const m of pending) {
    console.log(`[migrate-pg]   v${m.version}: ${m.description}`);
    await db.transaction(async (client) => {
      await m.up(client);
      await client.query(
        "INSERT INTO schema_version (version) VALUES ($1) ON CONFLICT DO NOTHING",
        [m.version]
      );
    });
    console.log(`[migrate-pg]   v${m.version}: applied`);
  }

  const finalVersion = pending[pending.length - 1].version;
  console.log(`[migrate-pg] Migration complete. Schema version: ${finalVersion}`);
  return finalVersion;
}

/**
 * Build a db-like wrapper that pins every query/transaction to `schema`.
 * Wraps SET LOCAL search_path inside BEGIN/COMMIT so Supavisor transaction
 * pooling can't split the SET and the query across different backends.
 */
function makeScopedDb(db, schema) {
  return {
    pool: db.pool,
    query: async (sql, params) => {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO ${schema}, public`);
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    transaction: async (fn) => {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL search_path TO ${schema}, public`);
        const wrappedClient = {
          query: (sql, params) => client.query(sql, params),
        };
        const result = await fn(wrappedClient);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Run migrations against all active tenant schemas.
 * Each tenant schema has its own schema_version table.
 */
async function migrateAllTenants(db) {
  // Build a search_path-pinned wrapper for the public-schema migration run.
  // Same Supavisor leak applies here: raw pool.query() can land on a backend
  // whose search_path was left set to a tenant schema by an earlier request,
  // so schema_version etc. could resolve to the wrong table.
  // Each query/transaction wraps SET LOCAL search_path inside BEGIN/COMMIT.
  const publicDb = makeScopedDb(db, "public");

  // Migrate public schema first
  await migrate(publicDb);

  // Check if multi-tenant mode — look for tenants table.
  // publicDb above is already pinned to public via SET LOCAL search_path,
  // so an unqualified `FROM tenants` here cannot resolve to a tenant schema's
  // own tenants table (livetest1 / livetestauto both carry one).
  let tenants;
  try {
    const result = await publicDb.query(
      "SELECT id, slug FROM tenants WHERE status = 'active'"
    );
    tenants = result.rows;
    if (!tenants.length) {
      console.log("[migrate-pg] No active tenants to migrate.");
      return;
    }
    for (const tenant of tenants) {
      const schema = `tenant_${tenant.slug}`;
      console.log(`[migrate-pg] Migrating tenant: ${tenant.slug} (${schema})`);
      const scopedDb = makeScopedDb(db, schema);
      try {
        await migrate(scopedDb);
      } catch (err) {
        console.error(`[migrate-pg] tenant ${tenant.slug} FAILED:`, err.message);
      }
    }
  } catch (err) {
    // tenants table doesn't exist — single-tenant mode, skip
    if (String(err.message || "").includes("does not exist")) {
      console.log("[migrate-pg] No tenants table found — single-tenant mode.");
      return;
    }
    throw err;
  }
}

// CLI entry point
if (require.main === module) {
  const db = require("./db-pg");
  migrateAllTenants(db)
    .then(() => db.end())
    .catch((err) => {
      console.error("[migrate-pg] FATAL:", err.message);
      process.exit(1);
    });
}

module.exports = { migrate, MIGRATIONS };
