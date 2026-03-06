# Tenant Migrations

Place migration files here for the multi-tenant migration runner.

## File naming

`<version>-<description>.js` — e.g., `0067-add-loyalty-points.js`

## Module contract

Each file must export:

```js
module.exports = {
  version: 67,                          // integer, must be unique
  description: "Add loyalty points",    // short human-readable label
  async up(db, helpers) {
    // db = sqlite3.Database handle for the tenant
    // helpers = { run(sql, params), all(sql, params), get(sql, params) }
    await helpers.run("ALTER TABLE customers ADD COLUMN loyalty_points INTEGER DEFAULT 0");
  }
};
```

## Running

```bash
# All active tenants
node backend/tenant-migrate.js

# Specific tenant
node backend/tenant-migrate.js --tenant demo-shop

# Dry run (shows what would be applied)
node backend/tenant-migrate.js --dry-run
```

The runner also exposes `runMigrationsOnTenant()` for the admin API.
