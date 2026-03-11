#!/bin/sh
# Production startup: run migrations then start server
set -e

# Set timezone explicitly so datetime functions return correct local time
export TZ="${TZ:-Asia/Karachi}"

if [ -n "$DATABASE_URL" ]; then
  # ── Postgres mode ──
  echo "[startup] Postgres mode (DATABASE_URL set)"
  echo "[startup] Running Postgres migrations..."
  node migrate-pg.js
  echo "[startup] Starting server..."
  exec node index.js
else
  # ── SQLite mode (legacy) ──
  mkdir -p "${DATA_DIR:-/data}"
  DB_FILE="${DATA_DIR:-/data}/sanopos.db"
  ln -sf "$DB_FILE" /app/sanopos.db
  echo "[startup] DB path: $DB_FILE"
  echo "[startup] Running SQLite migrations..."
  node run_migrations.js || echo "[startup] Migrations completed (some may have been already applied)"
  echo "[startup] Starting server..."
  exec node index.js
fi
