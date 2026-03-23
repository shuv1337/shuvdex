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
}

export class CredentialStore extends Context.Tag("CredentialStore")<
  CredentialStore,
  CredentialStoreService
>() {}
