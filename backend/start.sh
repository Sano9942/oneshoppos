#!/bin/sh
# Production startup: run migrations then start server
set -e

# Ensure the data directory exists
mkdir -p "${DATA_DIR:-/data}"

# Symlink both legacy DB names to the volume path so all migrations
# (which hardcode __dirname/oneshop.db or __dirname/sanopos.db) write
# to the same persistent file as the server reads.
DB_FILE="${DATA_DIR:-/data}/sanopos.db"
ln -sf "$DB_FILE" /app/oneshop.db
ln -sf "$DB_FILE" /app/sanopos.db

echo "[startup] DB path: $DB_FILE"
echo "[startup] Running migrations..."
node run_migrations.js || echo "[startup] Migrations completed (some may have been already applied)"

echo "[startup] Starting server..."
exec node index.js
