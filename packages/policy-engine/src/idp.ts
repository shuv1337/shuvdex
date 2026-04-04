/**
 * Identity provider (IdP) token validation for the shuvdex policy engine.
 *
 * Supports:
 * - Microsoft Entra ID (formerly Azure AD) — RS256 via tenant JWKS endpoint
 * - Google Workspace OIDC — RS256 via Google's public certs endpoint
 *
 * JWKS fetchers are cached per-URL so repeated validations within the same
 * process don't re-fetch the key set on every request.
 */
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";

// ---------------------------------------------------------------------------
// Configuration types
// ---------------------------------------------------------------------------

/**
 * Maps IdP group names or object IDs to shuvdex policy scopes.
 * Example: `{ "sg-shuvdex-admins": ["*"], "sg-publishers": ["packages:write"] }`
 */
export type GroupMapping = Record<string, string[]>;

/** Microsoft Entra ID IdP configuration. */
export interface EntraIdConfig {
  /** Entra tenant ID (GUID or friendly name). */
  readonly tenantId: string;
  /** Expected `aud` claim value (application/client ID or URI). */
  readonly audience: string;
  /**
   * Optional mapping from Entra group object IDs (GUIDs) to shuvdex scopes.
   * Groups not present in this map are ignored for scope resolution.
   */
  readonly groupMapping?: GroupMapping;
}

/** Google Workspace OIDC IdP configuration. */
export interface GoogleConfig {
  /** Expected `aud` claim value (OAuth2 client ID). */
  readonly audience: string;
  /**
   * Restrict tokens to these hosted G Suite domains (the `hd` claim).
   * Leave empty/unset to allow any domain.
   */
  readonly allowedDomains?: string[];
}

/**
 * Unified IdP configuration, typically loaded from `POLICY_DIR/idp-config.json`.
 *
 * Either or both providers can be configured at the same time.
 * `resolveIdentity` auto-detects the provider from the token's `iss` claim.
 */
export interface IdPConfig {
  readonly entra?: EntraIdConfig;
  readonly google?: GoogleConfig;
}

// ---------------------------------------------------------------------------
// Normalized identity types
// ---------------------------------------------------------------------------

/** Identity resolved from a Microsoft Entra ID token. */
export interface EntraIdentity {
  readonly provider: "entra";
  /** Subject OID from `sub` or `oid` claim. */
  readonly subjectId: string;
  /** User email from `email` or `preferred_username` claim. */
  readonly email: string;
  /** Group object IDs from the `groups` claim. */
  readonly groups: string[];
  /** The tenant ID the token was issued for. */
  readonly tenantId: string;
}

/** Identity resolved from a Google Workspace OIDC token. */
export interface GoogleIdentity {
  readonly provider: "google";
  /** Subject from the `sub` claim. */
  readonly subjectId: string;
  /** User email from the `email` claim. */
  readonly email: string;
  /** Hosted G Suite domain from the `hd` claim. */
  readonly domain: string;
  /** Always empty — Google OIDC tokens do not carry group membership. */
  readonly groups: string[];
}

/** Union of all normalized identity shapes. */
export type NormalizedIdentity = EntraIdentity | GoogleIdentity;

// ---------------------------------------------------------------------------
// JWKS fetchers — one per distinct endpoint URL, cached for the process
// ---------------------------------------------------------------------------

const jwksFetchers = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwksFetcher(url: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksFetchers.get(url);
  if (existing !== undefined) return existing;
  const fetcher = createRemoteJWKSet(new URL(url));
  jwksFetchers.set(url, fetcher);
  return fetcher;
}

// ---------------------------------------------------------------------------
// Entra ID (Azure AD) validation
// ---------------------------------------------------------------------------

/**
 * Validates a Microsoft Entra ID JWT token using the tenant's JWKS endpoint.
 *
 * Validates:
 * - RS256 signature via `https://login.microsoftonline.com/{tenantId}/discovery/v2.0/keys`
 * - `iss` must equal `https://login.microsoftonline.com/{tenantId}/v2.0`
 * - `aud` must match `config.audience`
 * - `exp` and `nbf` are enforced by `jose`
 *
 * @param token  - Raw JWT string (without "Bearer " prefix)
 * @param config - Entra ID configuration
 * @throws If the token is invalid, expired, or fails claim validation
 */
export async function validateEntraToken(
  token: string,
  config: EntraIdConfig,
): Promise<EntraIdentity> {
  const jwksUrl = `https://login.microsoftonline.com/${config.tenantId}/discovery/v2.0/keys`;
  const expectedIssuer = `https://login.microsoftonline.com/${config.tenantId}/v2.0`;

  const { payload } = await jwtVerify(token, getJwksFetcher(jwksUrl), {
    issuer: expectedIssuer,
    audience: config.audience,
    algorithms: ["RS256"],
  });

  const subjectId = typeof payload.sub === "string" ? payload.sub
    : typeof payload.oid === "string" ? payload.oid
    : "";
  const email = typeof payload.email === "string" ? payload.email
    : typeof payload.preferred_username === "string" ? payload.preferred_username
    : "";
  const groups: string[] = Array.isArray(payload.groups)
    ? (payload.groups as string[]).filter((g): g is string => typeof g === "string")
    : [];

  return { provider: "entra", subjectId, email, groups, tenantId: config.tenantId };
}

// ---------------------------------------------------------------------------
// Google Workspace OIDC validation
// ---------------------------------------------------------------------------

const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"] as const;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Validates a Google Workspace OIDC token using Google's public certs.
 *
 * Validates:
 * - RS256 signature via `https://www.googleapis.com/oauth2/v3/certs`
 * - `iss` must be `accounts.google.com` or `https://accounts.google.com`
 * - `aud` must match `config.audience`
 * - `exp` enforced by `jose`
 * - `hd` (hosted domain) must be in `config.allowedDomains` when set
 *
 * @param token  - Raw JWT string (without "Bearer " prefix)
 * @param config - Google Workspace configuration
 * @throws If the token is invalid, expired, or the domain is not allowed
 */
export async function validateGoogleToken(
  token: string,
  config: GoogleConfig,
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(token, getJwksFetcher(GOOGLE_JWKS_URL), {
    issuer: [...GOOGLE_ISSUERS],
    audience: config.audience,
    algorithms: ["RS256"],
  });

  const hd = typeof payload.hd === "string" ? payload.hd : "";
  if (config.allowedDomains && config.allowedDomains.length > 0 && !config.allowedDomains.includes(hd)) {
    throw new Error(
      `Google Workspace token domain "${hd}" is not in the configured allowedDomains`,
    );
  }

  const subjectId = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";

  return { provider: "google", subjectId, email, domain: hd, groups: [] };
}

// ---------------------------------------------------------------------------
// Unified resolver
// ---------------------------------------------------------------------------

/**
 * Resolve an external IdP JWT to a normalized identity by auto-detecting the
 * provider from the token's `iss` claim.
 *
 * Resolution order:
 * 1. Decode the JWT header/payload without verification to read `iss`.
 * 2. Match `iss` against configured Entra tenant issuer URL.
 * 3. Match `iss` against known Google issuer values.
 * 4. Throw if no configured provider matches.
 *
 * @param token  - Raw JWT string from the Authorization header (Bearer-stripped)
 * @param config - Combined IdP configuration
 * @throws If the token cannot be decoded, no provider matches, or validation fails
 */
export async function resolveIdentity(
  token: string,
  config: IdPConfig,
): Promise<NormalizedIdentity> {
  let issuer: string;
  try {
    const decoded = decodeJwt(token);
    issuer = typeof decoded.iss === "string" ? decoded.iss : "";
  } catch (cause) {
    throw new Error(`Cannot decode JWT to determine issuer: ${String(cause)}`);
  }

  if (config.entra) {
    const expectedIssuer = `https://login.microsoftonline.com/${config.entra.tenantId}/v2.0`;
    if (issuer === expectedIssuer) {
      return validateEntraToken(token, config.entra);
    }
  }

  if (config.google && (GOOGLE_ISSUERS as readonly string[]).includes(issuer)) {
    return validateGoogleToken(token, config.google);
  }

  throw new Error(`No IdP configured for token issuer: "${issuer}"`);
}
