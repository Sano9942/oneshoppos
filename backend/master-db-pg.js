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
  max_products           INTEGER DEFAULT 500,
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
  deleted_at             TIMESTAMPTZ
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
`;

let _db = null;

/**
 * Initialize master tables in public schema. Idempotent.
 * @param {object} db - The db-pg pool wrapper
 */
async function init(db) {
  _db = db;
  await db.query(MASTER_SCHEMA);
}

/**
 * Create a tenant + audit log entry in a single transaction.
 * Returns the new tenant id.
 */
async function createTenant({ slug, name, ownerEmail, timezone }) {
  const db = _getDb();
  return db.transaction(async (client) => {
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

    return tenantId;
  });
}

/**
 * Look up a tenant by slug. Returns the row or null.
 */
async function getTenantBySlug(slug) {
  const { rows } = await _getDb().query(
    "SELECT * FROM tenants WHERE slug = $1",
    [slug]
  );
  return rows[0] || null;
}

/**
 * Look up a tenant by id. Returns the row or null.
 */
async function getTenantById(id) {
  const { rows } = await _getDb().query(
    "SELECT * FROM tenants WHERE id = $1",
    [id]
  );
  return rows[0] || null;
}

/**
 * Direct query on the master (public schema) pool.
 * Use this for writes to public-schema tables like tenant_audit_log.
 */
function query(sql, params) {
  return _getDb().query(sql, params);
}

function _getDb() {
  if (!_db) throw new Error("[master-db-pg] Not initialized — call init(db) first");
  return _db;
}

module.exports = { init, createTenant, getTenantBySlug, getTenantById, query };
