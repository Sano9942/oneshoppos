#!/bin/sh
# Production startup: run migrations then start server
set -e

# Set timezone explicitly so datetime functions return correct local time
export TZ="${TZ:-Asia/Karachi}"

if [ -n "$DATABASE_URL" ]; then
  # ── Postgres mode ──
  echo "[startup] Postgres mode (DATABASE_URL set)"
  if [ "${SKIP_MIGRATIONS:-0}" = "1" ]; then
    echo "[startup] SKIP_MIGRATIONS=1 — skipping migrations."
  else
    echo "[startup] Running Postgres migrations..."
    # Deliberately non-fatal. A slow or unreachable database must degrade the
    # app, not stop it booting: with `set -e` a migration failure killed the
    # container before index.js ever ran, so Railway restarted straight into
    # the same failure and burned through restartPolicyMaxRetries. The server
    # binds before workers start, so it can serve health checks and read
    # traffic even when a migration sweep could not complete.
    node migrate-pg.js || echo "[startup] WARNING: migrations failed — starting server anyway."
  fi
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
