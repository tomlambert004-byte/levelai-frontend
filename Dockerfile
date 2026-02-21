# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Install libc6-compat + OpenSSL for Prisma engine compatibility
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Generate Prisma client (needs schema + node_modules)
COPY prisma ./prisma
RUN npx prisma generate

# ── Stage 2: Build the Next.js app ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# OpenSSL needed for Prisma during build
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .

# Clerk publishable key is needed at build time for page pre-rendering.
# This is a PUBLIC key (safe to embed in client bundles).
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Run ONLY next build — prisma generate already ran in deps stage.
# prisma migrate deploy runs at container startup (needs live DB connection).
RUN npx next build

# ── Stage 3: Production runner ───────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# OpenSSL for Prisma runtime
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Don't run as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install prisma CLI for runtime migrations
RUN npm install -g prisma@5

# Copy only what's needed to run
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

# Standalone output includes a minimal server + bundled deps
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Cloud Run sets PORT env var (default 8080)
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"
EXPOSE 8080

# Run migrations (if DB configured) then start server
CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then prisma migrate deploy --schema=./prisma/schema.prisma; fi && node server.js"]
