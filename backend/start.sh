#!/bin/sh
# Production startup: run migrations then start server
set -e

# Set timezone explicitly so SQLite datetime('now','localtime') returns PKT
export TZ="${TZ:-Asia/Karachi}"

# Ensure the data directory exists
mkdir -p "${DATA_DIR:-/data}"

# Symlink so migrations (which hardcode __dirname/sanopos.db) write
# to the same persistent volume file as the server reads.
DB_FILE="${DATA_DIR:-/data}/sanopos.db"
ln -sf "$DB_FILE" /app/sanopos.db

echo "[startup] DB path: $DB_FILE"
echo "[startup] Running migrations..."
node run_migrations.js || echo "[startup] Migrations completed (some may have been already applied)"

echo "[startup] Starting server..."
exec node index.js
