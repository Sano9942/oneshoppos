// backend/tests/helpers/seedSchema-pg.js
// Wraps schema-pg.sql for test use — runs the full DDL in a given Postgres client/connection.
const fs = require("fs");
const path = require("path");
const SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, "../../schema-pg.sql"), "utf8"
);

async function seedSchema(client) {
  await client.query(SCHEMA_SQL);
}

module.exports = { seedSchema };
