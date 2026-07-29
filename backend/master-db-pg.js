// backend/master-db-pg.js
// Master DB for Postgres — tenant registry lives in the `public` schema.
// Unlike the SQLite version, no separate DB file — just tables in the shared pool.

const MASTER_SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id                     SERIAL PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  owner_email            TEXT NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'active',
  plan                   TEXT NOT NULL DEFAULT 'free',
  timezone               TEXT NOT NULL DEFAULT 'UTC',
  max_employees          INTEGER DEFAULT 3,
  max_outlets            INTEGER DEFAULT 1,
  max_products           INTEGER DEFAULT 100,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  trial_ends_at          TIMESTAMPTZ,
  billing_cycle          TEXT,
  plan_expires_at        TIMESTAMPTZ,
  grace_ends_at          TIMESTAMPTZ,
  payment_status         TEXT DEFAULT 'active',
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  suspended_at           TIMESTAMPTZ,
  deleted_at             TIMESTAMPTZ,
  email_verified_at      TIMESTAMPTZ,
  email_verification_token TEXT,
  tos_version            TEXT,
  privacy_version        TEXT,
  consent_at             TIMESTAMPTZ,
  consent_ip             TEXT
);

CREATE TABLE IF NOT EXISTS super_admins (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES tenants(id),
  action     TEXT NOT NULL,
  details    TEXT,
  actor      TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER NOT NULL PRIMARY KEY,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tenant_refresh_tokens (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER NOT NULL REFERENCES tenants(id),
  employee_id INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS payment_intents (
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
);
CREATE INDEX IF NOT EXISTS idx_payment_intents_gateway_ref ON payment_intents(gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_intents_tenant ON payment_intents(tenant_id, status);

CREATE TABLE IF NOT EXISTS impersonation_sessions (
  id              SERIAL PRIMARY KEY,
  super_admin_id  INTEGER NOT NULL,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  started_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ended_at        TIMESTAMPTZ,
  pages_visited   JSONB DEFAULT '[]',
  actions_taken   INTEGER DEFAULT 0,
  token_jti       TEXT,
  revoked_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_jti
  ON impersonation_sessions(token_jti) WHERE token_jti IS NOT NULL;
`;

let _db = null;

/**
 * Initialize master tables in public schema. Idempotent.
 * @param {object} db - The db-pg pool wrapper
 */
async function init(db) {
  _db = db;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO public");
    await client.query(MASTER_SCHEMA);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Create a tenant + audit log entry in a single transaction.
 * Returns the new tenant id.
 */
async function createTenant({ slug, name, ownerEmail, timezone }) {
  const db = _getDb();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO public");
    const { rows } = await client.query(
      `INSERT INTO tenants (slug, name, owner_email, timezone)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [slug, name, ownerEmail, timezone || "UTC"]
    );
    const tenantId = rows[0].id;

    await client.query(
      `INSERT INTO tenant_audit_log (tenant_id, action, details, actor)
       VALUES ($1, 'created', $2, 'system')`,
      [tenantId, JSON.stringify({ slug, timezone, provisioned_at: new Date().toISOString() })]
    );

    await client.query("COMMIT");
    return tenantId;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Look up a tenant by slug. Returns the row or null.
 */
async function getTenantBySlug(slug) {
  const { rows } = await query("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return rows[0] || null;
}

/**
 * Look up a tenant by id. Returns the row or null.
 */
async function getTenantById(id) {
  const { rows } = await query("SELECT * FROM tenants WHERE id = $1", [id]);
  return rows[0] || null;
}

/**
 * Direct query on the master (public schema) pool.
 * Wraps SET + query in a transaction so Supavisor transaction-mode pooling
 * pins both statements to the same backend connection — otherwise the SET
 * lands on one backend and the SELECT lands on another that still has a
 * stale tenant search_path, causing phantom "not found" lookups.
 */
async function query(sql, params) {
  const db = _getDb();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO public");
    const result = await client.query(sql, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run several master-schema statements as one atomic unit.
 *
 * This module shipped without it, so every multi-statement master write was a
 * run of independent autocommits — each `query()` above opens and commits its
 * own transaction. The billing webhook was the expensive case: it marked a
 * payment intent completed, then activated the tenant, then recorded the
 * payment, as three separate commits. A failure after the first left a tenant
 * that had paid and could not use the product, and the handler's own
 * idempotency guard ("intent already completed → return Already processed")
 * meant every subsequent retry short-circuited before the activation it still
 * needed. Permanently stuck, from one badly-timed error.
 *
 * The callback receives a client whose search_path is pinned to public for the
 * whole transaction, which also removes the reason `query()` wraps single
 * statements: with one BEGIN around the batch, the SET and every statement are
 * guaranteed the same backend under Supavisor transaction-mode pooling.
 *
 * Mirrors the tenant-side contract (`db-pg.js`, `tenant-db-manager-pg.js`) so
 * `masterDb.transaction(fn)` reads the same as `deps.db.transaction(fn)`.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>} whatever fn returns
 * @template T
 */
async function transaction(fn) {
  const db = _getDb();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO public");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function _getDb() {
  if (!_db) throw new Error("[master-db-pg] Not initialized — call init(db) first");
  return _db;
}

module.exports = { init, createTenant, getTenantBySlug, getTenantById, query, transaction };
