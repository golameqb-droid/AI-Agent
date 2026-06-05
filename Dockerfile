# ---------- Stage 1: build ----------
# Compiles TypeScript and the native SQLite module.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Build tools needed to compile better-sqlite3 (native module)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

# Reuse the already-installed (and already-compiled) dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json ./
COPY public ./public
COPY knowledge ./knowledge
COPY .env.example ./.env.example

# Persisted data lives here (mounted as a volume)
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
