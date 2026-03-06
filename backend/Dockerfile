# Stage 1: Build native dependencies (sqlite3 needs python3/make/g++)
FROM node:22-alpine AS builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image (no build tools)
FROM node:22-alpine
RUN apk add --no-cache sqlite
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .
RUN chmod +x start.sh
ENV NODE_ENV=production PORT=5000
EXPOSE 5000
CMD ["sh", "start.sh"]
