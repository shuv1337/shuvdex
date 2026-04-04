import { Context, Effect } from "effect";
import type { CredentialNotFound, CredentialStoreIOError, CredentialStoreValidationError } from "./errors.js";

export type CredentialScheme =
  | { readonly type: "api_key"; readonly in: "header" | "query" | "cookie"; readonly name: string; readonly value: string }
  | { readonly type: "bearer"; readonly token: string }
  | { readonly type: "basic"; readonly username: string; readonly password: string }
  | { readonly type: "custom_headers"; readonly headers: Record<string, string> }
  | { readonly type: "oauth2_client_credentials"; readonly tokenUrl: string; readonly clientId: string; readonly clientSecret: string; readonly scopes?: readonly string[] };

export interface CredentialRecord {
  readonly credentialId: string;
  readonly scheme: CredentialScheme;
  readonly description?: string;
  readonly sourceId?: string;
  readonly packageId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Credential Binding
// ---------------------------------------------------------------------------

/**
 * A CredentialBinding associates a credential with a set of allowed packages,
 * capabilities, and scopes. It is used by the proxy adapter to decide which
 * credential to apply when forwarding requests to upstream MCP servers.
 *
 * Bindings do NOT store secrets — they reference credentials by ID.
 */
export interface CredentialBinding {
  readonly bindingId: string;
  readonly tenantId?: string;
  readonly environmentId?: string;
  readonly credentialId: string;
  readonly credentialType:
    | "api_key"
    | "oauth_client_credentials"
    | "oauth_authorization_code"
    | "bearer"
    | "service_account";
  readonly allowedPackages?: ReadonlyArray<string>;
  readonly allowedCapabilities?: ReadonlyArray<string>;
  readonly scopes?: ReadonlyArray<string>;
  readonly rotation?: {
    readonly lastRotated?: string;
    readonly rotationIntervalDays?: number;
    readonly nextRotation?: string;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AuthMaterial {
  readonly headers?: Record<string, string>;
  readonly queryParams?: Record<string, string>;
  readonly cookies?: Record<string, string>;
}

export interface RedactedCredentialRecord {
  readonly credentialId: string;
  readonly description?: string;
  readonly sourceId?: string;
  readonly packageId?: string;
  readonly schemeType: CredentialScheme["type"];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CredentialStoreService {
  readonly listCredentials: () => Effect.Effect<ReadonlyArray<RedactedCredentialRecord>, unknown>;
  readonly upsertCredential: (
    record: Omit<CredentialRecord, "createdAt" | "updatedAt"> &
      Partial<Pick<CredentialRecord, "createdAt" | "updatedAt">>,
  ) => Effect.Effect<CredentialRecord, unknown>;
  readonly getCredential: (
    credentialId: string,
  ) => Effect.Effect<CredentialRecord, unknown>;
  readonly deleteCredential: (
    credentialId: string,
  ) => Effect.Effect<void, unknown>;
  readonly resolveAuthMaterial: (
    credentialId: string,
  ) => Effect.Effect<AuthMaterial, unknown>;

  // -------------------------------------------------------------------------
  // Credential Binding methods
  // -------------------------------------------------------------------------

  /** List all credential bindings. */
  readonly listBindings: () => Effect.Effect<ReadonlyArray<CredentialBinding>, unknown>;

  /**
   * Create or replace a credential binding by bindingId.
   * The caller is responsible for providing createdAt / updatedAt timestamps.
   */
  readonly upsertBinding: (
    binding: CredentialBinding,
  ) => Effect.Effect<CredentialBinding, unknown>;

  /** Delete a binding by ID. Silently succeeds if the binding does not exist. */
  readonly deleteBinding: (
    bindingId: string,
  ) => Effect.Effect<void, unknown>;

  /**
   * Resolve the first binding that matches the given credentialId,
   * optionally scoped to a tenantId.  Returns null when no match is found.
   *
   * Emits a console.warn when rotation is overdue according to the binding's
   * rotation schedule.
   */
  readonly resolveBinding: (
    credentialId: string,
    tenantId?: string,
  ) => Effect.Effect<CredentialBinding | null, unknown>;
}

export class CredentialStore extends Context.Tag("CredentialStore")<
  CredentialStore,
  CredentialStoreService
>() {}
