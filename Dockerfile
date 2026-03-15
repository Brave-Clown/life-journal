FROM node:18-alpine

WORKDIR /app

# Create a user matching TrueNAS 'apps' user (UID 568, GID 568)
RUN addgroup -g 568 -S journal && \
    adduser -u 568 -S -G journal -h /app journal

# Copy package files and install
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY server.js .
COPY public ./public

# Create data directory owned by journal user
RUN mkdir -p /app/data/entries && chown -R journal:journal /app

# Switch to non-root user
USER journal

# Expose port
EXPOSE 49182

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:49182/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
