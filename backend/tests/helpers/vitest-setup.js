// Vitest setup file — runs once per worker fork before any test imports.
// Loads backend/.env so DATABASE_URL and other secrets are available to
// tests that require db-pg.js, master-db-pg.js, tenant-db-manager-pg.js, etc.
//
// Before DB-4 item 6, db-pg.js loaded dotenv at module require time, which
// was convenient but re-injected MULTI_TENANT after tests intentionally
// deleted it (Decision II trap). After item 6, dotenv lives at script
// entrypoints, and this setup file is the test-runner entrypoint equivalent.
//
// Tests that need to delete env vars (e.g. MULTI_TENANT) must do so inside
// their own beforeAll after createTestApp() has already triggered all its
// requires. This setup file runs BEFORE any beforeAll, so it does not
// compete with test-level env manipulation.

// Prefer backend/.env.test when present so local dev can point tests at a
// local Postgres while backend/.env keeps pointing at production Supabase.
// Falls back to backend/.env when .env.test doesn't exist.
const path = require("path");
const fs = require("fs");
const envTest = path.resolve(__dirname, "..", "..", ".env.test");
const envMain = path.resolve(__dirname, "..", "..", ".env");
require("dotenv").config({
  path: fs.existsSync(envTest) ? envTest : envMain,
});
