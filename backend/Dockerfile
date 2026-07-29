# Stage 1: Install dependencies.
# python3/make/g++ used to be required here to compile sqlite3 from source.
# sqlite3 is gone (Postgres-only since the archive), and nothing left needs a
# native build: bcryptjs is pure JS and sharp ships prebuilt musl binaries
# (@img/sharp-linuxmusl-x64). If a future dependency does need to compile, the
# build fails loudly here rather than shipping a broken image — restore
# `RUN apk add --no-cache python3 make g++` on the line below.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image (no build tools)
FROM node:22-alpine
# postgresql17-client provides pg_dump / pg_restore for the /api/admin/backup
# and /api/backup/download endpoints. Match Supabase server major version (17).
# sqlite CLI dropped with the sqlite3 dependency — no active code path reads or
# writes a SQLite database; the archives under backend/archive/ are historical.
RUN apk add --no-cache tzdata postgresql17-client
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN chmod +x start.sh
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["sh", "start.sh"]
