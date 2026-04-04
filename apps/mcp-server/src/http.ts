/**
 * @shuvdex/mcp-server — HTTP transport
 *
 * Serves the MCP Streamable-HTTP endpoint at `/mcp` with:
 * - Explicit CORS origin validation (no wildcard)
 * - Origin header enforcement per MCP HTTP spec (Nov 2025)
 * - Per-request token resolution (internal HMAC or external IdP JWTs)
 * - OAuth 2.1 Protected Resource Metadata (RFC 9728) at `/.well-known/oauth-protected-resource`
 * - OIDC discovery proxy at `/.well-known/openid-configuration`
 * - Session tracking via `mcp-session-id` header
 * - Sliding-window rate limiting (per-tenant + per-user)
 * - Proper 401 / 403 responses with `WWW-Authenticate` headers
 * - Localhost-only binding by default; 0.0.0.0 when DEPLOYED_MODE=true or MCP_HOST is set
 *
 * ## PKCE note
 * shuvdex is the **Resource Server**, not the Authorization Server.
 * PKCE is handled entirely by the IdP (Entra ID / Google Workspace).
 * shuvdex never participates in the authorization code flow; it only
 * validates Bearer tokens issued by the upstream AS.
 *
 * ## Environment variables
 * | Variable                  | Default           | Notes                                          |
 * |---------------------------|-------------------|------------------------------------------------|
 * | MCP_PORT / PORT           | 3848              | Listening port                                 |
 * | MCP_HOST                  | 127.0.0.1         | Override bind address                          |
 * | DEPLOYED_MODE             | —                 | Set to "true" to bind 0.0.0.0                  |
 * | TAILSCALE                 | —                 | Set to "true" to bind 0.0.0.0 (Tailscale peer) |
 * | SHUVDEX_MODE              | "development"     | Set to "production" to enforce auth + Origin   |
 * | GATEWAY_URL               | (derived)         | Public URL of this gateway (for OAuth metadata)|
 * | CORS_ALLOWED_ORIGINS      | (localhost)       | Comma-separated list of allowed Origins        |
 * | SESSION_TTL_MS            | 3600000           | Session TTL in ms (default: 1 hour)            |
 * | SESSION_MAX_PER_TENANT    | 50                | Max sessions per tenant                        |
 * | RATE_LIMIT_WINDOW_MS      | 60000             | Rate-limit window in ms (default: 1 minute)    |
 * | RATE_LIMIT_PER_TENANT     | 500               | Max requests per tenant per window             |
 * | RATE_LIMIT_PER_USER       | 100               | Max requests per user per window               |
 * | RATE_LIMIT_PER_CAPABILITY | 50                | Max requests per capability per window         |
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { createServer } from "./server.js";
import {
  loadServerRuntime,
  logEvent,
  type LoadedServerRuntime,
} from "./runtime.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { TokenClaims } from "@shuvdex/policy-engine";
import type { IdPConfig } from "@shuvdex/policy-engine";
import type { Tenant } from "@shuvdex/tenant-manager";
import {
  buildProtectedResourceMetadata,
  buildOIDCDiscoveryUrl,
  buildAuthChallenge,
} from "./oauth.js";
import { createSessionStore, type SessionStore } from "./session.js";
import { createRateLimiter } from "./rate-limiter.js";

// ---------------------------------------------------------------------------
// Configuration resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the bind address.
 *
 * - If `MCP_HOST` is set explicitly, use it as-is (allows full override).
 * - If `DEPLOYED_MODE=true` or `TAILSCALE=true`, bind to 0.0.0.0 for network access.
 * - Otherwise default to 127.0.0.1 (localhost only — safe for dev workstations).
 */
function resolveHost(): string {
  if (process.env["MCP_HOST"]) return process.env["MCP_HOST"];
  const isDeployed =
    process.env["DEPLOYED_MODE"] === "true" || process.env["TAILSCALE"] === "true";
  return isDeployed ? "0.0.0.0" : "127.0.0.1";
}

const PORT = Number(process.env["MCP_PORT"] ?? process.env["PORT"] ?? 3848);
const HOST = resolveHost();

/** "production" enables strict Origin validation and requires auth headers. */
const SHUVDEX_MODE = process.env["SHUVDEX_MODE"] ?? "development";
const IS_PRODUCTION = SHUVDEX_MODE === "production";

/** Session configuration */
const SESSION_TTL_MS = Number(
  process.env["SESSION_TTL_MS"] ?? 60 * 60 * 1000,
);
const SESSION_MAX_PER_TENANT = Number(
  process.env["SESSION_MAX_PER_TENANT"] ?? 50,
);

/** Rate-limit configuration */
const RATE_LIMIT_WINDOW_MS = Number(
  process.env["RATE_LIMIT_WINDOW_MS"] ?? 60 * 1000,
);
const RATE_LIMIT_PER_TENANT = Number(
  process.env["RATE_LIMIT_PER_TENANT"] ?? 500,
);
const RATE_LIMIT_PER_USER = Number(process.env["RATE_LIMIT_PER_USER"] ?? 100);
const RATE_LIMIT_PER_CAPABILITY = Number(
  process.env["RATE_LIMIT_PER_CAPABILITY"] ?? 50,
);

// ---------------------------------------------------------------------------
// CORS origin validation
// ---------------------------------------------------------------------------

/**
 * Build the set of allowed CORS origins.
 *
 * - In production: must be set via `CORS_ALLOWED_ORIGINS` (comma-separated).
 * - In development: defaults to common localhost variations.
 */
function resolveAllowedOrigins(): Set<string> {
  const configured = process.env["CORS_ALLOWED_ORIGINS"]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return new Set(configured);
  }

  // Development defaults — permissive localhost set
  return new Set([
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
    "http://shuvdev:5173",
    "http://shuvdev:3000",
  ]);
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();

/**
 * Validate a request Origin header against the allowlist.
 *
 * Returns true when:
 * - The origin is explicitly listed in ALLOWED_ORIGINS, OR
 * - In development mode, the origin is any localhost/127.0.0.1 variant.
 */
function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // In development, also accept any localhost origin dynamically
  if (!IS_PRODUCTION) {
    try {
      const url = new URL(origin);
      return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
      return false;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Gateway URL (OAuth resource identifier)
// ---------------------------------------------------------------------------

/**
 * Resolve the public gateway URL used as the OAuth resource identifier.
 *
 * Configured via `GATEWAY_URL`; falls back to `http://{HOST}:{PORT}`.
 * When HOST is 0.0.0.0 (all-interface bind), substitutes `localhost` for the
 * URL so the resource identifier is usable by clients.
 */
function resolveGatewayUrl(): string {
  if (process.env["GATEWAY_URL"]) return process.env["GATEWAY_URL"];
  const hostname = HOST === "0.0.0.0" ? "localhost" : HOST;
  return `http://${hostname}:${PORT}`;
}

// ---------------------------------------------------------------------------
// IdP config reader (for well-known endpoint construction)
// ---------------------------------------------------------------------------

/**
 * Read the IdP configuration from the policy directory.
 *
 * Returns an empty object `{}` if the file does not exist or cannot be parsed,
 * so well-known endpoints can still respond gracefully.
 */
function readIdpConfig(policyDir: string): IdPConfig {
  try {
    const configPath = path.join(policyDir, "idp-config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8")) as IdPConfig;
  } catch {
    return {};
  }
}

/**
 * Build a minimal synthetic `Tenant` from the loaded IdP config so the
 * oauth.ts helper functions can be used without a full tenant-manager setup.
 *
 * Returns `null` when no IdP is configured.
 */
function syntheticTenantFromIdpConfig(idpConfig: IdPConfig): Tenant | null {
  const now = new Date().toISOString();
  if (idpConfig.entra) {
    return {
      tenantId: idpConfig.entra.tenantId,
      name: "shuvdex",
      status: "active",
      tier: "standard",
      idpType: "entra",
      idpConfig: { entraId: idpConfig.entra },
      owner: { name: "shuvdex", email: "" },
      maxConnectors: 5,
      maxUsers: 50,
      createdAt: now,
      updatedAt: now,
    };
  }
  if (idpConfig.google) {
    return {
      tenantId: "google-workspace",
      name: "shuvdex",
      status: "active",
      tier: "standard",
      idpType: "google",
      idpConfig: { googleWorkspace: idpConfig.google },
      owner: { name: "shuvdex", email: "" },
      maxConnectors: 5,
      maxUsers: 50,
      createdAt: now,
      updatedAt: now,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-request token resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the caller's `TokenClaims` from an HTTP request.
 *
 * Resolution order:
 * 1. `Authorization: Bearer <token>` header present → resolve via policy engine
 *    (`resolveExternalToken` handles both internal HMAC and external IdP JWTs).
 * 2. No auth header in development mode → use `defaultClaims()` (full access).
 * 3. No auth header in production mode → return `null` (caller must reject with 401).
 */
async function resolveRequestClaims(
  runtime: LoadedServerRuntime,
  authHeader: string | undefined,
): Promise<TokenClaims | null> {
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      const claims = await Effect.runPromise(
        runtime.policyEngine.resolveExternalToken(token),
      ).catch(() => null);
      return claims;
    }
  }

  if (!IS_PRODUCTION) {
    // Development mode: allow unauthenticated requests with default claims
    return runtime.policyEngine.defaultClaims();
  }

  // Production mode: no auth header → reject
  return null;
}

// ---------------------------------------------------------------------------
// Scope validation helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the caller's claims include at least one of the required scopes.
 *
 * A claims object with `scopes: ["*"]` passes all scope checks.
 */
function hasScope(
  claims: TokenClaims,
  ...requiredScopes: string[]
): boolean {
  if (claims.scopes.includes("*")) return true;
  return requiredScopes.some((s) => claims.scopes.includes(s));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const runtime = await loadServerRuntime();
  const gatewayUrl = resolveGatewayUrl();
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Session store — tracks caller sessions across /mcp requests
  // -------------------------------------------------------------------------
  const sessionStore: SessionStore = createSessionStore({
    maxSessionsPerTenant: SESSION_MAX_PER_TENANT,
    defaultTtlMs: SESSION_TTL_MS,
  });

  // -------------------------------------------------------------------------
  // Rate limiter — sliding window per tenant + per user
  // -------------------------------------------------------------------------
  const rateLimiter = createRateLimiter({
    maxPerTenant: RATE_LIMIT_PER_TENANT,
    maxPerUser: RATE_LIMIT_PER_USER,
    maxPerCapability: RATE_LIMIT_PER_CAPABILITY,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });

  // -------------------------------------------------------------------------
  // CORS — explicit origin allowlist, never wildcard
  // -------------------------------------------------------------------------
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin) {
          // No Origin header — permit (non-browser MCP clients, CLI tools, etc.)
          return "";
        }
        return isOriginAllowed(origin) ? origin : "";
      },
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: [
        "mcp-session-id",
        "mcp-protocol-version",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ],
      maxAge: 600,
    }),
  );

  // -------------------------------------------------------------------------
  // Health — always public, no auth required
  // -------------------------------------------------------------------------
  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "shuvdex-mcp-server",
      transport: "streamable-http",
      version: "0.0.0",
      host: HOST,
      port: PORT,
      mode: SHUVDEX_MODE,
      gatewayUrl,
      capabilitiesDir: runtime.paths.capabilitiesDir,
      policyDir: runtime.paths.policyDir,
      localRepoPath: runtime.paths.localRepoPath,
      packageCount: runtime.packageCount,
      indexedArtifactCount: runtime.indexedArtifactCount,
      indexFailureCount: runtime.indexFailures.length,
      startupDurationMs: runtime.startupDurationMs,
      activeSessions: sessionStore.list().length,
    }),
  );

  // -------------------------------------------------------------------------
  // OAuth 2.1: Protected Resource Metadata (RFC 9728)
  //
  // GET /.well-known/oauth-protected-resource
  //
  // Tells MCP clients which Authorization Server(s) can issue tokens for this
  // resource.  MCP clients use this to discover the IdP before starting PKCE.
  //
  // PKCE is handled by the IdP (Entra ID / Google Workspace); shuvdex is the
  // Resource Server and is not involved in the authorization code flow.
  // -------------------------------------------------------------------------
  app.get("/.well-known/oauth-protected-resource", (c) => {
    const idpConfig = readIdpConfig(runtime.paths.policyDir);
    const tenant = syntheticTenantFromIdpConfig(idpConfig);

    const metadata =
      tenant !== null
        ? buildProtectedResourceMetadata(gatewayUrl, tenant)
        : {
            resource: gatewayUrl,
            authorization_servers: [] as string[],
            bearer_methods_supported: ["header"],
            scopes_supported: [
              "openid",
              "profile",
              "email",
              "shuvdex:read",
              "shuvdex:write",
              "shuvdex:admin",
            ],
          };

    logEvent({
      event: "oauth.prm_served",
      gatewayUrl,
      authServerCount: metadata.authorization_servers.length,
    });

    return c.json(metadata);
  });

  // -------------------------------------------------------------------------
  // OAuth 2.1: OIDC Discovery Proxy
  //
  // GET /.well-known/openid-configuration
  //
  // Proxies to the tenant's upstream IdP OIDC discovery document so MCP clients
  // can discover the authorization endpoint, token endpoint, and JWKS URI
  // without needing to know the tenant's IdP configuration directly.
  // -------------------------------------------------------------------------
  app.get("/.well-known/openid-configuration", async (c) => {
    const idpConfig = readIdpConfig(runtime.paths.policyDir);
    const tenant = syntheticTenantFromIdpConfig(idpConfig);

    if (!tenant) {
      return c.json(
        {
          error: "no_idp_configured",
          error_description:
            "No IdP is configured for this gateway. Set up idp-config.json in the policy directory.",
        },
        404,
      );
    }

    const discoveryUrl = buildOIDCDiscoveryUrl(tenant);
    if (!discoveryUrl) {
      return c.json(
        { error: "no_discovery_url", error_description: "Cannot build OIDC discovery URL for tenant." },
        404,
      );
    }

    try {
      const upstream = await fetch(discoveryUrl, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5_000),
      });
      if (!upstream.ok) {
        return c.json(
          {
            error: "upstream_error",
            error_description: `IdP discovery returned HTTP ${upstream.status}`,
          },
          502,
        );
      }
      const data: unknown = await upstream.json();
      logEvent({ event: "oauth.oidc_proxy", discoveryUrl, status: upstream.status });
      return c.json(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logEvent({ event: "oauth.oidc_proxy_error", discoveryUrl, error: message });
      return c.json(
        { error: "proxy_error", error_description: `Failed to fetch OIDC discovery: ${message}` },
        502,
      );
    }
  });

  // -------------------------------------------------------------------------
  // /mcp — MCP Streamable-HTTP endpoint
  // -------------------------------------------------------------------------
  app.all("/mcp", async (c) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    const method = c.req.method;

    // -----------------------------------------------------------------------
    // Origin header validation (MCP spec Nov 2025 — DNS rebinding protection)
    //
    // In production mode: require a valid Origin header on state-mutating
    // requests (POST, DELETE). GET and OPTIONS are exempt.
    // In development mode: log a warning but allow through.
    // -----------------------------------------------------------------------
    const origin = c.req.header("Origin");
    const isStateMutating = method === "POST" || method === "DELETE";

    if (isStateMutating) {
      if (origin) {
        if (!isOriginAllowed(origin)) {
          logRequest({
            runtime,
            requestId,
            method,
            path: "/mcp",
            status: 403,
            durationMs: Date.now() - startedAt,
            error: `Rejected origin: ${origin}`,
          });
          return c.json(
            {
              jsonrpc: "2.0",
              error: { code: -32600, message: "Forbidden: origin not allowed" },
              id: null,
            },
            403,
          );
        }
      } else if (IS_PRODUCTION) {
        // Production: require Origin on POST/DELETE (no Origin = potential DNS rebinding)
        logRequest({
          runtime,
          requestId,
          method,
          path: "/mcp",
          status: 403,
          durationMs: Date.now() - startedAt,
          error: "Missing Origin header in production mode",
        });
        return c.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Forbidden: Origin header required in production mode",
            },
            id: null,
          },
          403,
        );
      }
    }

    // -----------------------------------------------------------------------
    // Per-request token resolution
    //
    // 401: Missing or invalid token → WWW-Authenticate with realm
    // 403: Valid token but insufficient scope → WWW-Authenticate with scope
    // -----------------------------------------------------------------------
    const authHeader = c.req.header("Authorization");
    const claims = await resolveRequestClaims(runtime, authHeader);

    if (claims === null) {
      const wwwAuth = buildAuthChallenge(gatewayUrl, "", "");
      logRequest({
        runtime,
        requestId,
        method,
        path: "/mcp",
        status: 401,
        durationMs: Date.now() - startedAt,
        error: "Unauthorized: no valid auth token",
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Unauthorized: valid Bearer token required" },
          id: null,
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": wwwAuth,
          },
        },
      );
    }

    // -----------------------------------------------------------------------
    // Minimum scope check — callers must have at least read access.
    //
    // This is an HTTP-level gate for clients that may have a valid token but
    // insufficient scope (e.g. a service token issued before shuvdex:read was
    // required).  Fine-grained per-capability scope enforcement happens inside
    // server.ts via `authorizeCapability`.
    //
    // Incremental consent: return 403 with WWW-Authenticate specifying the
    // needed scope so clients can re-initiate PKCE to upgrade their token.
    // -----------------------------------------------------------------------
    const hasReadAccess = hasScope(
      claims,
      "*",
      "capabilities:read",
      "shuvdex:read",
      "shuvdex:write",
      "shuvdex:admin",
    );
    if (!hasReadAccess) {
      const wwwAuth = buildAuthChallenge(
        gatewayUrl,
        "shuvdex:read",
        "Read scope required to access MCP capabilities",
      );
      logRequest({
        runtime,
        requestId,
        method,
        path: "/mcp",
        status: 403,
        durationMs: Date.now() - startedAt,
        error: "Forbidden: insufficient scope (shuvdex:read required)",
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Forbidden: shuvdex:read scope required" },
          id: null,
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": wwwAuth,
          },
        },
      );
    }

    // -----------------------------------------------------------------------
    // Session management
    //
    // First POST (no mcp-session-id header): create a new session.
    // Subsequent requests: look up the existing session, return 404 if expired.
    // DELETE: destroy the session.
    // -----------------------------------------------------------------------
    const sessionIdHeader = c.req.header("mcp-session-id");
    let sessionId: string | undefined;

    if (sessionIdHeader) {
      const existing = sessionStore.get(sessionIdHeader);
      if (!existing) {
        // Session expired or never existed
        logRequest({
          runtime,
          requestId,
          method,
          path: "/mcp",
          status: 404,
          durationMs: Date.now() - startedAt,
          error: `Session not found or expired: ${sessionIdHeader}`,
        });
        return c.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: "Session expired or not found — please re-initialize",
            },
            id: null,
          },
          404,
        );
      }
      sessionStore.touch(sessionIdHeader);
      sessionId = sessionIdHeader;

      // Handle session close on DELETE
      if (method === "DELETE") {
        sessionStore.destroy(sessionIdHeader);
        logEvent({
          event: "session.destroyed",
          sessionId: sessionIdHeader,
          subjectId: claims.subjectId,
        });
      }
    } else if (method === "POST") {
      // First request — create a new session after token validation
      const now = Date.now();
      const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
      const protocolVersion =
        c.req.header("mcp-protocol-version") ?? "2024-11-05";

      const session = sessionStore.create({
        actor: {
          subjectId: claims.subjectId,
          provider: claims.keyId.startsWith("external-")
            ? claims.keyId.slice("external-".length)
            : undefined,
        },
        protocolVersion,
        negotiatedCapabilities: [],
        disclosedCapabilityIds: [],
        authContext: {
          tokenJti: claims.jti,
          scopes: [...claims.scopes],
          idpProvider: claims.keyId.startsWith("external-")
            ? claims.keyId.slice("external-".length)
            : undefined,
        },
        expiresAt,
      });

      sessionId = session.sessionId;

      logEvent({
        event: "session.created",
        sessionId,
        subjectId: claims.subjectId,
        protocolVersion,
        expiresAt,
      });
    }

    // -----------------------------------------------------------------------
    // Rate limiting — apply per-user limit; tenant limit applied when available
    //
    // Returns 429 with Retry-After header when the limit is exceeded.
    // Adds X-RateLimit-* headers to every response that passes.
    // -----------------------------------------------------------------------
    const userKey = claims.subjectId;
    const userAllowed = rateLimiter.user.check(userKey);
    const userRemaining = rateLimiter.user.remaining(userKey);
    const userResetAt = rateLimiter.user.resetAt(userKey);

    if (!userAllowed) {
      const retryAfter = Math.max(1, userResetAt - Math.floor(Date.now() / 1000));
      logRequest({
        runtime,
        requestId,
        method,
        path: "/mcp",
        status: 429,
        durationMs: Date.now() - startedAt,
        error: `Rate limit exceeded for user ${userKey}`,
      });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32600, message: "Too many requests — rate limit exceeded" },
          id: null,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "X-RateLimit-Limit": String(rateLimiter.user.max),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(userResetAt),
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    // -----------------------------------------------------------------------
    // MCP request handling
    // -----------------------------------------------------------------------
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    // Build per-request server config with the resolved claims
    const server = createServer({ ...runtime.serverConfig, claims });

    try {
      await server.connect(transport);
      const mcpResponse = await transport.handleRequest(c.req.raw);

      // Attach session ID + rate-limit headers to the MCP response
      const responseHeaders = new Headers(mcpResponse.headers);
      if (sessionId) {
        responseHeaders.set("mcp-session-id", sessionId);
      }
      responseHeaders.set("X-RateLimit-Limit", String(rateLimiter.user.max));
      responseHeaders.set("X-RateLimit-Remaining", String(userRemaining));
      responseHeaders.set("X-RateLimit-Reset", String(userResetAt));

      logRequest({
        runtime,
        requestId,
        method,
        path: "/mcp",
        status: mcpResponse.status,
        durationMs: Date.now() - startedAt,
        sessionId,
      });

      return new Response(mcpResponse.body, {
        status: mcpResponse.status,
        statusText: mcpResponse.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logRequest({
        runtime,
        requestId,
        method,
        path: "/mcp",
        status: 500,
        durationMs: Date.now() - startedAt,
        error: message,
        sessionId,
      });
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
            data: { requestId, error: message },
          },
          id: null,
        },
        500,
      );
    } finally {
      await Promise.allSettled([transport.close(), server.close()]);
    }
  });

  app.notFound((c) =>
    c.json(
      {
        error: "Not found",
        service: "shuvdex-mcp-server",
      },
      404,
    ),
  );

  serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: HOST,
    },
    (info) => {
      logEvent({
        event: "http.listening",
        host: HOST,
        port: info.port,
        mode: SHUVDEX_MODE,
        gatewayUrl,
        mcpUrl: `http://${HOST}:${info.port}/mcp`,
        healthUrl: `http://${HOST}:${info.port}/health`,
        oauthPrmUrl: `http://${HOST}:${info.port}/.well-known/oauth-protected-resource`,
        packageCount: runtime.packageCount,
        sessionMaxPerTenant: SESSION_MAX_PER_TENANT,
        rateLimitPerUser: RATE_LIMIT_PER_USER,
        rateLimitWindowMs: RATE_LIMIT_WINDOW_MS,
      });
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    const pruned = sessionStore.prune();
    logEvent({ event: "http.shutdown", signal, host: HOST, port: PORT, sessionsPruned: pruned });
    await runtime.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

function logRequest(input: {
  runtime: LoadedServerRuntime;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
  sessionId?: string;
}): void {
  logEvent({
    event: input.error ? "http.request_error" : "http.request",
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: input.durationMs,
    packageCount: input.runtime.packageCount,
    indexedArtifactCount: input.runtime.indexedArtifactCount,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.error ? { error: input.error } : {}),
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logEvent({ event: "http.fatal", error: message });
  process.exit(1);
});
