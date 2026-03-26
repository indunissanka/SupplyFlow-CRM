# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

# Install all deps (including devDependencies for TypeScript compiler)
RUN npm ci

COPY src/ ./src/
COPY public/ ./public/
COPY tsconfig.json ./
COPY tsconfig.analytics.json ./

# Compile TypeScript → dist/
RUN npx tsc

# Build analytics UI if source exists
RUN [ -f public/analytics/app.ts ] && npx tsc -p tsconfig.analytics.json || true

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Production dependencies only
RUN npm ci --omit=dev

# Copy compiled output and frontend from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Create uploads directory for file attachments
RUN mkdir -p uploads

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
