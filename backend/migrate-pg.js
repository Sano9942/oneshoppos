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
          ON CONFLICT DO NOTHING
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
