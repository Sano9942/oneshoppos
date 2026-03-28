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
