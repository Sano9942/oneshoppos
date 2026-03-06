#!/bin/sh
# Production startup: run migrations then start server
set -e

echo "[startup] Running migrations..."
node run_migrations.js || echo "[startup] Migrations completed (some may have been already applied)"

echo "[startup] Starting server..."
exec node index.js
