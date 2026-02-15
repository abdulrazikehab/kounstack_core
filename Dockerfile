# Multi-stage build for production
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files for both root and app
COPY package*.json ./
COPY apps/app-core/package*.json ./apps/app-core/

# Install dependencies
RUN npm ci

# Copy Prisma schema and generate client
COPY apps/app-core/prisma ./apps/app-core/prisma/
WORKDIR /app/apps/app-core
RUN npx prisma generate

# Copy source code
WORKDIR /app
COPY . .

# Build the application
# We need to build specific app-core, assuming strict structure or using nx/turbo if available
# But here we try simple tsc or nest build if standard.
# Since we don't have full repo context on build tools, we assume 'nest build app-core' works 
# OR we just run the build script inside app-core if it has one.
# Inspecting package.json in core (via list_dir earlier) implies it is a nest app.
RUN npx nest build app-core

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files (root and app)
COPY package*.json ./
COPY apps/app-core/package*.json ./apps/app-core/

# Install only production dependencies
# Need to be careful with monorepo structure. 
# We'll install dependencies in root or app-core as needed.
RUN npm ci --only=production && npm cache clean --force

# Copy Prisma schema and generate client in production
COPY apps/app-core/prisma ./apps/app-core/prisma/
WORKDIR /app/apps/app-core
RUN npx prisma generate

# Copy built application from builder stage
WORKDIR /app
COPY --from=builder /app/dist/apps/app-core ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 3000

# Health check (assuming /health or /api/health exists, or just check port)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "dist/main.js"]
