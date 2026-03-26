FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Production dependencies only
RUN npm ci --omit=dev

# Copy pre-built compiled output and frontend
COPY dist/ ./dist/
COPY public/ ./public/

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + process.env.PORT + '/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

CMD ["node", "dist/server.js"]
