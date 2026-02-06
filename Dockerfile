# ============================================
# Stage 1: Build Dependencies & Compile
# ============================================
FROM node:22-alpine AS builder

# Install build dependencies + pnpm (single layer)
RUN apk update && \
    apk add --no-cache --force-broken-world python3 make g++ && \
    npm install -g pnpm@9.15.9 && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package manifests for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/collector/package.json ./apps/collector/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/

# Install ALL dependencies (dev + prod) for building
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build all packages (skip lint/typecheck for faster builds)
RUN SKIP_ENV_VALIDATION=1 ESLINT_NO_DEV_ERRORS=true NEXT_TELEMETRY_DISABLED=1 \
    pnpm --filter @clashmaster/shared build && \
    pnpm --filter @clashmaster/collector build && \
    pnpm --filter @clashmaster/web build

# Deploy collector with only production dependencies
RUN pnpm deploy --filter=@clashmaster/collector --prod /tmp/collector-prod

# Clean up unnecessary files in Next.js standalone
RUN find /app/apps/web/.next/standalone -type f -name "*.map" -delete 2>/dev/null || true && \
    find /app/apps/web/.next/standalone -type f -name "*.ts" -delete 2>/dev/null || true && \
    find /app/apps/web/.next/standalone -type f -name "*.d.ts" -delete 2>/dev/null || true

# ============================================
# Stage 2: Production Runtime (Ultra-Slim)
# ============================================
FROM node:22-alpine AS runtime

# No additional packages needed
RUN rm -rf /var/cache/apk/* /tmp/*

WORKDIR /app

# Environment variables
ENV NODE_ENV=production \
    WEB_PORT=3000 \
    API_PORT=3001 \
    COLLECTOR_WS_PORT=3002 \
    DB_PATH=/app/data/stats.db

# Create data directory
RUN mkdir -p /app/data

# ===== Web Application (Next.js Standalone) =====
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# ===== Collector Application =====
COPY --from=builder /app/apps/collector/dist ./apps/collector/dist
COPY --from=builder /app/apps/collector/package.json ./apps/collector/package.json
COPY --from=builder /tmp/collector-prod/node_modules ./apps/collector/node_modules

# ===== Shared Package (Built Output Only) =====
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json

# ===== Optimization: Remove unused Sharp bindings =====
# Keep only Alpine/musl version, remove Debian/glibc version
RUN rm -rf /app/node_modules/.pnpm/@img+sharp-libvips-linux-x64@* 2>/dev/null || true && \
    rm -rf /app/node_modules/.pnpm/@img+sharp-linux-x64@* 2>/dev/null || true && \
    find /app/node_modules -name "*.node" -type f | grep -v "linuxmusl" | xargs rm -f 2>/dev/null || true

# ===== Remove TypeScript from production (not needed at runtime) =====
RUN rm -rf /app/node_modules/.pnpm/typescript@* 2>/dev/null || true

# Expose ports
EXPOSE 3000 3001 3002

# Data volume
VOLUME ["/app/data"]

# Health check using Node.js (no wget needed)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3001/health || exit 1

# Startup command
CMD ["sh", "-c", "node apps/collector/dist/index.js & node apps/web/server.js"]
