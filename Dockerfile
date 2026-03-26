FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Install production dependencies and verify express is present
RUN npm install --omit=dev && \
    ls node_modules/express || (echo "ERROR: express not installed" && exit 1)

# Install mongodump for backups
RUN apk add --no-cache mongodb-tools

# Copy pre-built compiled output, frontend, and scripts
COPY dist/ ./dist/
COPY public/ ./public/
COPY scripts/ ./scripts/
RUN sed -i 's/\r//' ./scripts/*.sh

# Create uploads and backups directories
RUN mkdir -p uploads backups

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
