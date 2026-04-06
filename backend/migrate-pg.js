#!/usr/bin/env node
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
        ON CONFLICT DO NOTHING;

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

        -- Seed default loyalty tiers
        INSERT INTO loyalty_tiers (name, min_spend, points_multiplier, discount_percent, color, sort_order)
        VALUES
          ('Bronze', 0, 1.0, 0, '#CD7F32', 1),
          ('Silver', 25000, 1.5, 2, '#C0C0C0', 2),
          ('Gold', 75000, 2.0, 5, '#FFD700', 3),
          ('Platinum', 200000, 3.0, 8, '#E5E4E2', 4)
        ON CONFLICT DO NOTHING;

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
        ON CONFLICT DO NOTHING;

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
 * Run migrations against all active tenant schemas.
 * Each tenant schema has its own schema_version table.
 */
async function migrateAllTenants(db) {
  // Migrate public schema first
  await migrate(db);

  // Check if multi-tenant mode — look for tenants table
  try {
    const { rows: tenants } = await db.query(
      "SELECT id, slug FROM tenants WHERE status = 'active'"
    );
    if (!tenants.length) {
      console.log("[migrate-pg] No active tenants to migrate.");
      return;
    }
    for (const tenant of tenants) {
      const schema = `tenant_${tenant.slug}`;
      console.log(`[migrate-pg] Migrating tenant: ${tenant.slug} (${schema})`);
      // Create a scoped wrapper that sets search_path per query
      const scopedDb = {
        query: async (sql, params) => {
          const client = await db.pool.connect();
          try {
            await client.query(`SET search_path TO ${schema}, public`);
            return await client.query(sql, params);
          } finally {
            client.release();
          }
        },
        transaction: async (fn) => {
          const client = await db.pool.connect();
          try {
            await client.query(`SET search_path TO ${schema}, public`);
            await client.query("BEGIN");
            const wrappedClient = {
              query: (sql, params) => client.query(sql, params),
            };
            await fn(wrappedClient);
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        },
      };
      try {
        await migrate(scopedDb);
      } catch (err) {
        console.error(`[migrate-pg] tenant ${tenant.slug} FAILED:`, err.message);
      }
    }
  } catch {
    // tenants table doesn't exist — single-tenant mode, skip
    console.log("[migrate-pg] No tenants table found — single-tenant mode.");
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
