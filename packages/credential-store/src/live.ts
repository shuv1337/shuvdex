import { randomBytes } from "node:crypto";
import { Effect, Layer, Ref } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CredentialStore,
  type CredentialStoreService,
  type CredentialRecord,
  type CredentialBinding,
  type RedactedCredentialRecord,
  type CredentialScheme,
  type AuthMaterial,
} from "./types.js";
import {
  CredentialNotFound,
  CredentialStoreIOError,
  CredentialStoreValidationError,
} from "./errors.js";
import { decryptJson, encryptJson } from "./crypto.js";

export interface CredentialStoreConfig {
  readonly rootDir?: string;
  readonly keyPath?: string;
  readonly tokenCacheTtlMs?: number;
}

interface PersistedCredentialBlob {
  readonly version: 1;
  readonly record: CredentialRecord;
}

function credentialFilePath(rootDir: string, credentialId: string): string {
  return path.join(rootDir, `${credentialId}.json.enc`);
}

function readOrCreateKey(keyPath: string): string {
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, "utf-8").trim();
  }
  const secret = randomBytes(32).toString("base64url");
  fs.writeFileSync(keyPath, secret, { mode: 0o600, encoding: "utf-8" });
  return secret;
}

function credentialSummary(record: CredentialRecord): RedactedCredentialRecord {
  return {
    credentialId: record.credentialId,
    description: record.description,
    sourceId: record.sourceId,
    packageId: record.packageId,
    schemeType: record.scheme.type,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function loadCredentialFiles(rootDir: string, secret: string): CredentialRecord[] {
  if (!fs.existsSync(rootDir)) return [];
  const records: CredentialRecord[] = [];
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json.enc")) continue;
    try {
      const payload = fs.readFileSync(path.join(rootDir, entry.name), "utf-8");
      const parsed = decryptJson<PersistedCredentialBlob>(secret, payload);
      if (parsed.version === 1) {
        records.push(parsed.record);
      }
    } catch {
      // ignore malformed credential blobs at startup
    }
  }
  return records.sort((a, b) => a.credentialId.localeCompare(b.credentialId));
}

async function fetchOAuth2Token(record: CredentialRecord): Promise<string> {
  if (record.scheme.type !== "oauth2_client_credentials") {
    throw new Error("Not an OAuth2 client-credentials credential");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: record.scheme.clientId,
    client_secret: record.scheme.clientSecret,
  });
  if (record.scheme.scopes?.length) {
    body.set("scope", record.scheme.scopes.join(" "));
  }

  const response = await fetch(record.scheme.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`OAuth2 token request failed with status ${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("OAuth2 token response missing access_token");
  }
  return payload.access_token;
}

function materialFromScheme(scheme: CredentialScheme): AuthMaterial {
  switch (scheme.type) {
    case "api_key":
      if (scheme.in === "header") return { headers: { [scheme.name]: scheme.value } };
      if (scheme.in === "query") return { queryParams: { [scheme.name]: scheme.value } };
      return { cookies: { [scheme.name]: scheme.value } };
    case "bearer":
      return { headers: { Authorization: `Bearer ${scheme.token}` } };
    case "basic":
      return {
        headers: {
          Authorization: `Basic ${Buffer.from(`${scheme.username}:${scheme.password}`, "utf-8").toString("base64")}`,
        },
      };
    case "custom_headers":
      return { headers: { ...scheme.headers } };
    case "oauth2_client_credentials":
      return {};
  }
}

export function makeCredentialStoreLive(
  config?: CredentialStoreConfig,
): Layer.Layer<CredentialStore> {
  const rootDir = config?.rootDir ?? path.resolve(process.cwd(), ".capabilities", "credentials");
  const keyPath = config?.keyPath ?? path.resolve(process.cwd(), ".capabilities", ".credential-key");
  fs.mkdirSync(rootDir, { recursive: true });
  const secret = readOrCreateKey(keyPath);
  const recordsRef = Ref.unsafeMake(
    new Map(loadCredentialFiles(rootDir, secret).map((record) => [record.credentialId, record] as const)),
  );
  const tokenCache = new Map<string, { token: string; expiresAt: number }>();

  // ---------------------------------------------------------------------------
  // Binding helpers
  // ---------------------------------------------------------------------------

  const bindingsDir = path.join(rootDir, "bindings");
  fs.mkdirSync(bindingsDir, { recursive: true });

  function loadBindingFiles(): CredentialBinding[] {
    if (!fs.existsSync(bindingsDir)) return [];
    const results: CredentialBinding[] = [];
    for (const entry of fs.readdirSync(bindingsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(bindingsDir, entry.name), "utf-8");
        results.push(JSON.parse(raw) as CredentialBinding);
      } catch {
        // ignore malformed binding files at startup
      }
    }
    return results.sort((a, b) => a.bindingId.localeCompare(b.bindingId));
  }

  const bindingsRef = Ref.unsafeMake(
    new Map(loadBindingFiles().map((b) => [b.bindingId, b] as const)),
  );

  function bindingFilePath(bindingId: string): string {
    return path.join(bindingsDir, `${bindingId}.json`);
  }

  function persistBinding(binding: CredentialBinding) {
    return Effect.try({
      try: () => {
        fs.writeFileSync(bindingFilePath(binding.bindingId), JSON.stringify(binding, null, 2), "utf-8");
      },
      catch: (cause) => new CredentialStoreIOError({ path: bindingsDir, cause: String(cause) }),
    });
  }

  function checkRotationOverdue(binding: CredentialBinding): void {
    const { rotation } = binding;
    if (!rotation?.lastRotated || !rotation?.rotationIntervalDays) return;
    const lastRotatedMs = new Date(rotation.lastRotated).getTime();
    if (!Number.isFinite(lastRotatedMs)) return;
    const intervalMs = rotation.rotationIntervalDays * 24 * 60 * 60 * 1000;
    const nextDue = lastRotatedMs + intervalMs;
    if (Date.now() > nextDue) {
      process.stderr.write(
        `[credential-store] WARNING: Binding '${binding.bindingId}' (credential '${binding.credentialId}') ` +
          `rotation overdue since ${new Date(nextDue).toISOString()}\n`,
      );
    }
  }

  const persist = (record: CredentialRecord) =>
    Effect.try({
      try: () => {
        const blob: PersistedCredentialBlob = { version: 1, record };
        fs.writeFileSync(
          credentialFilePath(rootDir, record.credentialId),
          encryptJson(secret, blob),
          "utf-8",
        );
      },
      catch: (cause) => new CredentialStoreIOError({ path: rootDir, cause: String(cause) }),
    });

  // ---------------------------------------------------------------------------
  // Service implementation
  // ---------------------------------------------------------------------------

  const service: CredentialStoreService = {
    listCredentials: () =>
      Ref.get(recordsRef).pipe(
        Effect.map((records) =>
          Array.from(records.values())
            .sort((a, b) => a.credentialId.localeCompare(b.credentialId))
            .map(credentialSummary),
        ),
      ) as Effect.Effect<ReadonlyArray<RedactedCredentialRecord>, never>,
    upsertCredential: (input) =>
      Effect.gen(function* () {
        if (!input.credentialId) {
          return yield* Effect.fail(
            new CredentialStoreValidationError({ issues: "credentialId is required" }),
          );
        }
        if (!input.scheme) {
          return yield* Effect.fail(
            new CredentialStoreValidationError({
              credentialId: input.credentialId,
              issues: "scheme is required",
            }),
          );
        }
        const now = new Date().toISOString();
        const existing = (yield* Ref.get(recordsRef)).get(input.credentialId);
        const record: CredentialRecord = {
          credentialId: input.credentialId,
          scheme: input.scheme,
          description: input.description,
          sourceId: input.sourceId,
          packageId: input.packageId,
          createdAt: input.createdAt ?? existing?.createdAt ?? now,
          updatedAt: input.updatedAt ?? now,
        };
        yield* Ref.update(recordsRef, (state) => new Map(state).set(record.credentialId, record));
        yield* persist(record);
        return record;
      }) as Effect.Effect<CredentialRecord, CredentialStoreIOError | CredentialStoreValidationError>,
    getCredential: (credentialId) =>
      Effect.gen(function* () {
        const record = (yield* Ref.get(recordsRef)).get(credentialId);
        if (!record) {
          return yield* Effect.fail(new CredentialNotFound({ credentialId }));
        }
        return record;
      }) as Effect.Effect<CredentialRecord, CredentialNotFound>,
    deleteCredential: (credentialId) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(recordsRef)).get(credentialId);
        if (!existing) {
          return yield* Effect.fail(new CredentialNotFound({ credentialId }));
        }
        yield* Ref.update(recordsRef, (state) => {
          const next = new Map(state);
          next.delete(credentialId);
          return next;
        });
        tokenCache.delete(credentialId);
        yield* Effect.try({
          try: () => fs.rmSync(credentialFilePath(rootDir, credentialId), { force: true }),
          catch: (cause) => new CredentialStoreIOError({ path: rootDir, cause: String(cause) }),
        });
      }) as Effect.Effect<void, CredentialNotFound | CredentialStoreIOError>,
    // -------------------------------------------------------------------------
    // Binding methods
    // -------------------------------------------------------------------------

    listBindings: () =>
      Ref.get(bindingsRef).pipe(
        Effect.map((bindings) =>
          Array.from(bindings.values()).sort((a, b) => a.bindingId.localeCompare(b.bindingId)),
        ),
      ) as Effect.Effect<ReadonlyArray<CredentialBinding>, never>,

    upsertBinding: (binding) =>
      Effect.gen(function* () {
        if (!binding.bindingId) {
          return yield* Effect.fail(
            new CredentialStoreValidationError({ issues: "bindingId is required" }),
          );
        }
        if (!binding.credentialId) {
          return yield* Effect.fail(
            new CredentialStoreValidationError({
              credentialId: binding.credentialId,
              issues: "credentialId is required",
            }),
          );
        }
        yield* Ref.update(bindingsRef, (state) => new Map(state).set(binding.bindingId, binding));
        yield* persistBinding(binding);
        return binding;
      }) as Effect.Effect<CredentialBinding, CredentialStoreIOError | CredentialStoreValidationError>,

    deleteBinding: (bindingId) =>
      Effect.gen(function* () {
        yield* Ref.update(bindingsRef, (state) => {
          const next = new Map(state);
          next.delete(bindingId);
          return next;
        });
        yield* Effect.try({
          try: () => fs.rmSync(bindingFilePath(bindingId), { force: true }),
          catch: (cause) => new CredentialStoreIOError({ path: bindingsDir, cause: String(cause) }),
        });
      }) as Effect.Effect<void, CredentialStoreIOError>,

    resolveBinding: (credentialId, tenantId) =>
      Ref.get(bindingsRef).pipe(
        Effect.map((bindings) => {
          const candidates = Array.from(bindings.values()).filter(
            (b) =>
              b.credentialId === credentialId &&
              (tenantId === undefined || b.tenantId === tenantId),
          );
          const match = candidates[0] ?? null;
          if (match) checkRotationOverdue(match);
          return match;
        }),
      ) as Effect.Effect<CredentialBinding | null, never>,

    resolveAuthMaterial: (credentialId) =>
      Effect.gen(function* () {
        const record = yield* service.getCredential(credentialId);
        if (record.scheme.type !== "oauth2_client_credentials") {
          return materialFromScheme(record.scheme);
        }
        const cached = tokenCache.get(credentialId);
        const now = Date.now();
        if (cached && cached.expiresAt - 5_000 > now) {
          return { headers: { Authorization: `Bearer ${cached.token}` } };
        }
        const token = yield* Effect.tryPromise({
          try: () => fetchOAuth2Token(record),
          catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
        });
        tokenCache.set(credentialId, {
          token,
          expiresAt: now + (config?.tokenCacheTtlMs ?? 55 * 60 * 1000),
        });
        return { headers: { Authorization: `Bearer ${token}` } };
      }) as Effect.Effect<AuthMaterial, CredentialNotFound | CredentialStoreIOError | Error>,
  };

  return Layer.succeed(CredentialStore, service);
}

export const CredentialStoreLive = makeCredentialStoreLive();
