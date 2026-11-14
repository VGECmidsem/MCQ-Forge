# ---------- MCQForge production image ----------
# Multi-stage build: deps -> build -> slim runtime.
# The app is a Next.js server that needs PostgreSQL (DATABASE_URL).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Native modules used by PDF rendering / OCR need a few system libs.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder only: nothing connects during `next build` (the DB client is lazy).
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# Runtime libs for @napi-rs/canvas / pdf.js rendering.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
RUN mkdir -p public
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/src ./src
COPY --from=builder /app/assets ./assets

EXPOSE 3000
# Apply migrations then start the server. Safe to re-run on every deploy.
CMD ["sh", "-c", "node scripts/migrate.mjs && node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port ${PORT}"]
