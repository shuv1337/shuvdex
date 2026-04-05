#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeCapabilityRegistryLive } from "../packages/capability-registry/dist/index.js";
import { CredentialStore, makeCredentialStoreLive } from "../packages/credential-store/dist/index.js";
import { makeHttpExecutorLive } from "../packages/http-executor/dist/index.js";
import { makeOpenApiSourceLive, OpenApiSource } from "../packages/openapi-source/dist/index.js";

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const capabilitiesRoot = path.resolve(process.argv[3] ?? path.join(repoRoot, ".capabilities"));
const packagesDir = path.join(capabilitiesRoot, "packages");
const credentialDir = path.join(capabilitiesRoot, "credentials");
const credentialKeyPath = path.join(capabilitiesRoot, ".credential-key");
const sourceId = "openapi.hetzner.api.source";
const packageId = "openapi.hetzner.api";
const credentialId = "hetzner-api-token";
const selectedServerUrl = "https://api.hetzner.cloud/v1";
const specUrl = "https://docs.hetzner.cloud/cloud.spec.json";
const specPath = path.join(os.tmpdir(), `hetzner-openapi-${Date.now()}.json`);

function parseEnvValue(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFileValue(filePath, key) {
  if (!fs.existsSync(filePath)) return undefined;
  const text = fs.readFileSync(filePath, "utf-8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    if (match[1] === key) return parseEnvValue(match[2]);
  }
  return undefined;
}

function resolveHetznerApiToken() {
  // Check environment variable first
  if (process.env.HETZNER_API_TOKEN?.trim()) {
    return process.env.HETZNER_API_TOKEN.trim();
  }

  // Check secrets.json
  const secretsPath = path.join(os.homedir(), ".config", "shiv", "secrets.json");
  if (fs.existsSync(secretsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
      const value = parsed?.hetzner?.apiToken;
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    } catch {
      // ignore malformed secrets.json
    }
  }

  // Check credential files
  for (const candidate of [
    path.join(os.homedir(), ".openclaw", "credentials", "hetzner.env"),
    path.join(os.homedir(), ".env"),
  ]) {
    const value = readEnvFileValue(candidate, "HETZNER_API_TOKEN");
    if (value) return value;
  }

  // Return null if not found - credential will be created with placeholder
  return null;
}

async function fetchSpec() {
  const response = await fetch(specUrl, {
    headers: { "user-agent": "shuvdex/seed-hetzner-openapi" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Hetzner spec: ${response.status}`);
  }
  const doc = await response.json();
  fs.writeFileSync(specPath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  return doc;
}

async function main() {
  const apiToken = resolveHetznerApiToken();
  
  if (!apiToken) {
    console.error("Warning: HETZNER_API_TOKEN not found. Creating credential with placeholder token.");
    console.error("Set HETZNER_API_TOKEN environment variable or add to ~/.config/shiv/secrets.json to enable live API calls.");
  }

  await fetchSpec();

  const registryLayer = makeCapabilityRegistryLive(packagesDir);
  const credentialLayer = makeCredentialStoreLive({ rootDir: credentialDir, keyPath: credentialKeyPath });
  const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
  const openApiLayer = Layer.provide(makeOpenApiSourceLive({ rootDir: capabilitiesRoot }), Layer.mergeAll(registryLayer, credentialLayer, httpLayer));
  const managed = ManagedRuntime.make(Layer.mergeAll(registryLayer, credentialLayer, httpLayer, openApiLayer));

  try {
    const runtime = await managed.runtime();
    const compileResult = await Effect.runPromise(
      Effect.gen(function* () {
        const credentialStore = yield* CredentialStore;
        
        // Create credential - use real token if available, otherwise placeholder
        yield* credentialStore.upsertCredential({
          credentialId,
          scheme: {
            type: "custom_headers",
            headers: {
              Authorization: apiToken ? `Bearer ${apiToken}` : "Bearer PLACEHOLDER_TOKEN",
            },
          },
          description: apiToken 
            ? "Hetzner Cloud API token for authenticated OpenAPI capability certification"
            : "Hetzner Cloud API token (PLACEHOLDER - set HETZNER_API_TOKEN env var for live calls)",
          sourceId,
          packageId,
        });

        const source = yield* OpenApiSource;
        return yield* source.compile({
          sourceId,
          packageIdOverride: packageId,
          specUrl: specPath,
          title: "Hetzner Cloud API",
          description: "Hetzner Cloud OpenAPI capability for managing servers, SSH keys, images, and other cloud resources",
          selectedServerUrl,
          credentialId,
          operationFilter: {
            includeMethodsOnly: ["GET"],
            includePathPrefixes: [
              "/servers",
              "/ssh_keys",
              "/images",
              "/locations",
              "/datacenters",
              "/floating_ips",
              "/volumes",
              "/networks",
              "/firewalls",
            ],
          },
          defaultRiskLevel: "low",
          defaultTimeoutMs: 30_000,
        });
      }).pipe(Effect.provide(runtime)),
    );

    console.log(JSON.stringify({
      capabilitiesRoot,
      specPath,
      sourceId: compileResult.record.sourceId,
      packageId: compileResult.record.packageId,
      credentialId,
      apiTokenConfigured: !!apiToken,
      capabilityCount: compileResult.package.capabilities.length,
      capabilityIds: compileResult.package.capabilities.map((capability) => capability.id),
    }, null, 2));
  } finally {
    await managed.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
