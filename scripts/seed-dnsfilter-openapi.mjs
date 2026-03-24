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
const sourceId = "openapi.dnsfilter.api.source";
const packageId = "openapi.dnsfilter.api";
const credentialId = "dnsfilter-api-key";
const selectedServerUrl = "https://api.dnsfilter.com";
const specPath = path.join(os.tmpdir(), `dnsfilter-openapi-${Date.now()}.json`);

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

function resolveDnsfilterApiKey() {
  if (process.env.DNSFILTER_API_KEY) return process.env.DNSFILTER_API_KEY;

  const secretsPath = path.join(os.homedir(), ".config", "shiv", "secrets.json");
  if (fs.existsSync(secretsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(secretsPath, "utf-8"));
      const value = parsed?.dnsfilter?.apiKey;
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    } catch {
      // ignore malformed secrets.json here; fallback sources will be checked next
    }
  }

  for (const candidate of [
    path.join(os.homedir(), ".openclaw", "credentials", "dnsfilter.env"),
    path.join(os.homedir(), ".env"),
  ]) {
    const value = readEnvFileValue(candidate, "DNSFILTER_API_KEY");
    if (value) return value;
  }

  throw new Error("DNSFILTER_API_KEY not found in env, ~/.config/shiv/secrets.json, ~/.openclaw/credentials/dnsfilter.env, or ~/.env");
}

function customizeSpec(doc) {
  const next = structuredClone(doc);
  const getCurrentUser = next?.paths?.["/v1/current_user"]?.get;
  if (!getCurrentUser || typeof getCurrentUser !== "object") {
    throw new Error("DNSFilter OpenAPI spec does not contain GET /v1/current_user");
  }
  getCurrentUser.operationId = "currentUser";
  if (typeof getCurrentUser.summary !== "string" || getCurrentUser.summary === "Get") {
    getCurrentUser.summary = "Current user";
  }
  if (typeof getCurrentUser.description !== "string" || getCurrentUser.description.length === 0) {
    getCurrentUser.description = "Get the currently authenticated DNSFilter user";
  }
  return next;
}

async function fetchSpec() {
  const response = await fetch("https://api.dnsfilter.com/docs/api.json", {
    headers: { "user-agent": "shuvdex/seed-dnsfilter-openapi" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch DNSFilter spec: ${response.status}`);
  }
  const doc = customizeSpec(await response.json());
  fs.writeFileSync(specPath, `${JSON.stringify(doc, null, 2)}\n`, "utf-8");
  return doc;
}

async function main() {
  const apiKey = resolveDnsfilterApiKey();
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
        yield* credentialStore.upsertCredential({
          credentialId,
          scheme: {
            type: "custom_headers",
            headers: {
              Authorization: apiKey,
            },
          },
          description: "DNSFilter API key for authenticated OpenAPI capability certification",
          sourceId,
          packageId,
        });

        const source = yield* OpenApiSource;
        return yield* source.compile({
          sourceId,
          packageIdOverride: packageId,
          specUrl: specPath,
          title: "DNSFilter API",
          description: "Authenticated DNSFilter OpenAPI capability seed for current-user certification",
          selectedServerUrl,
          credentialId,
          operationFilter: {
            includeMethodsOnly: ["GET"],
            includePathPrefixes: ["/v1/current_user"],
          },
          defaultRiskLevel: "low",
          defaultTimeoutMs: 20_000,
        });
      }).pipe(Effect.provide(runtime)),
    );

    console.log(JSON.stringify({
      capabilitiesRoot,
      specPath,
      sourceId: compileResult.record.sourceId,
      packageId: compileResult.record.packageId,
      credentialId,
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
