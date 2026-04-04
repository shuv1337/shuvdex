# ============================================================
# Stage 1: Builder — install deps + compile everything
# ============================================================
FROM node:22-alpine AS builder
WORKDIR /app

# Install build tools needed for native addons (if any)
RUN apk add --no-cache python3 make g++

# Copy workspace manifest files first (layer-cache friendly)
COPY package.json package-lock.json turbo.json tsconfig.base.json tsconfig.json ./

# Copy all workspaces so npm ci can link them
COPY packages/ packages/
COPY apps/ apps/

# Install all deps (including devDependencies needed for build)
RUN npm ci

# Build every package + app via turbo
RUN npm run build

# ============================================================
# Stage 2: Production — MCP Server
# ============================================================
FROM node:22-alpine AS mcp-server
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user data directory before switching user
# Named volumes will be initialised with this ownership
RUN mkdir -p /data && chown -R node:node /data

# Copy workspace manifests + all node_modules (includes symlinks to packages/)
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules/ ./node_modules/

# Copy built packages (symlinked from node_modules)
COPY --from=builder /app/packages/ ./packages/

# Copy only the mcp-server app
COPY --from=builder /app/apps/mcp-server/ ./apps/mcp-server/

# Default runtime configuration — all overridable via env
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=3848
ENV SHUVDEX_MODE=production
ENV CAPABILITIES_DIR=/data/packages
ENV POLICY_DIR=/data/policy
ENV CREDENTIALS_DIR=/data/credentials
ENV CREDENTIAL_KEY_PATH=/data/.credential-key

USER node

EXPOSE 3848
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3848/health || exit 1

CMD ["node", "apps/mcp-server/dist/http.js"]

# ============================================================
# Stage 3: Production — API Server
# ============================================================
FROM node:22-alpine AS api-server
WORKDIR /app

ENV NODE_ENV=production

RUN mkdir -p /data && chown -R node:node /data

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/packages/ ./packages/
COPY --from=builder /app/apps/api/ ./apps/api/

ENV HOST=0.0.0.0
ENV PORT=3847
ENV SHUVDEX_MODE=production
ENV CAPABILITIES_DIR=/data/packages
ENV POLICY_DIR=/data/policy
ENV IMPORTS_DIR=/data/imports
ENV CREDENTIALS_DIR=/data/credentials
ENV CREDENTIAL_KEY_PATH=/data/.credential-key
ENV OPENAPI_ROOT=/data

USER node

EXPOSE 3847
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3847/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
