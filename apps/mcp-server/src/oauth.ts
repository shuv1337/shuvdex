/**
 * @shuvdex/mcp-server — OAuth 2.1 / OIDC metadata helpers
 *
 * Implements the Resource Server side of the MCP OAuth 2.1 flow:
 *
 * - Protected Resource Metadata (RFC 9728) — `/.well-known/oauth-protected-resource`
 * - OIDC discovery URL builder — used to proxy `/.well-known/openid-configuration`
 * - `WWW-Authenticate` challenge builder — for incremental consent 401 / 403 responses
 *
 * ## Role clarification
 * shuvdex is the **Resource Server** (RS), not the Authorization Server (AS).
 * - The AS is Entra ID or Google Workspace (the IdP configured per tenant).
 * - PKCE is handled entirely by the IdP; shuvdex never sees the code verifier.
 * - shuvdex validates the Bearer token issued by the AS and enforces policy.
 *
 * ## Flow summary
 * 1. Client discovers resource metadata from `/.well-known/oauth-protected-resource`.
 * 2. Metadata points to the tenant's AS (Entra / Google).
 * 3. Client completes PKCE flow with the AS (shuvdex is not involved).
 * 4. Client presents the resulting Bearer token to `/mcp`.
 * 5. shuvdex validates the token and enforces capability-level policy.
 */
import type { Tenant } from "@shuvdex/tenant-manager";

// ---------------------------------------------------------------------------
// Protected Resource Metadata (RFC 9728)
// ---------------------------------------------------------------------------

/**
 * Protected Resource Metadata document per RFC 9728.
 *
 * Returned at `GET /.well-known/oauth-protected-resource` to tell MCP clients
 * which Authorization Server(s) can issue tokens for this resource.
 */
export interface ProtectedResourceMetadata {
  /** The resource URI (this gateway's base URL). */
  resource: string;
  /**
   * OAuth 2.0 Authorization Server metadata URLs for this resource.
   * Clients fetch `/.well-known/openid-configuration` (or `oauth-authorization-server`)
   * from each entry to discover the token endpoint.
   */
  authorization_servers: string[];
  /** Supported methods for delivering Bearer tokens. Always ["header"] for shuvdex. */
  bearer_methods_supported?: string[];
  /** OAuth scopes supported by this resource server. */
  scopes_supported?: string[];
}

/**
 * Build a Protected Resource Metadata document for the given tenant.
 *
 * The metadata points to the tenant's configured IdP (Entra ID or Google) as
 * the Authorization Server. Clients will use this to discover the token endpoint
 * and complete the PKCE flow before calling `/mcp`.
 *
 * @param gatewayUrl - The public base URL of this MCP gateway (e.g. `http://shuvdev:3848`)
 * @param tenant     - The resolved tenant whose IdP configuration to use
 */
export function buildProtectedResourceMetadata(
  gatewayUrl: string,
  tenant: Tenant,
): ProtectedResourceMetadata {
  const authServers: string[] = [];

  if (tenant.idpType === "entra" && tenant.idpConfig.entraId) {
    authServers.push(
      `https://login.microsoftonline.com/${tenant.idpConfig.entraId.tenantId}/v2.0`,
    );
  }

  if (tenant.idpType === "google") {
    authServers.push("https://accounts.google.com");
  }

  return {
    resource: gatewayUrl,
    authorization_servers: authServers,
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
}

// ---------------------------------------------------------------------------
// OIDC Discovery URL builder
// ---------------------------------------------------------------------------

/**
 * Build the OIDC discovery URL for the tenant's IdP.
 *
 * Used to proxy `GET /.well-known/openid-configuration` to the upstream IdP so
 * MCP clients can discover the authorization, token, and JWKS endpoints without
 * needing to know the tenant's IdP configuration.
 *
 * @param tenant - The resolved tenant
 * @returns The upstream OIDC discovery URL, or `null` if no IdP is configured
 */
export function buildOIDCDiscoveryUrl(tenant: Tenant): string | null {
  if (tenant.idpType === "entra" && tenant.idpConfig.entraId) {
    return (
      `https://login.microsoftonline.com/${tenant.idpConfig.entraId.tenantId}` +
      `/v2.0/.well-known/openid-configuration`
    );
  }
  if (tenant.idpType === "google") {
    return "https://accounts.google.com/.well-known/openid-configuration";
  }
  return null;
}

// ---------------------------------------------------------------------------
// WWW-Authenticate challenge builder
// ---------------------------------------------------------------------------

/**
 * Build a `WWW-Authenticate` Bearer challenge string for incremental consent.
 *
 * Used in:
 * - **401 Unauthorized** — missing or invalid token:
 *   ```
 *   Bearer realm="https://shuvdev:3848"
 *   ```
 * - **403 Forbidden (insufficient scope)** — valid token but missing scope:
 *   ```
 *   Bearer realm="...", scope="shuvdex:write",
 *          error="insufficient_scope", error_description="..."
 *   ```
 *
 * The `scope` and `description` parameters are for the incremental-consent case.
 * Pass an empty string for `scope` when building a plain 401 challenge.
 *
 * @param gatewayUrl  - The public gateway URL used as the realm
 * @param scope       - The scope(s) the client needs to obtain (space-separated)
 * @param description - Human-readable description of what additional access is needed
 */
export function buildAuthChallenge(
  gatewayUrl: string,
  scope: string,
  description: string,
): string {
  const parts = [`Bearer realm="${gatewayUrl}"`];
  if (scope) {
    parts.push(`scope="${scope}"`);
    parts.push(`error="insufficient_scope"`);
    parts.push(`error_description="${description}"`);
  }
  return parts.join(", ");
}
