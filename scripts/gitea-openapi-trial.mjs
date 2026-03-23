#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeCapabilityRegistryLive } from "@shuvdex/capability-registry";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeOpenApiSourceLive, OpenApiSource } from "@shuvdex/openapi-source";

const trialRoot = fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-gitea-trial-"));
const capabilitiesDir = path.join(trialRoot, "packages");
const credentialDir = path.join(trialRoot, "credentials");
const capabilitiesRoot = trialRoot;
const specPath = path.join(trialRoot, "gitea-openapi.yaml");

async function downloadSpec() {
  const response = await fetch("https://docs.gitea.com/redocusaurus/plugin-redoc-1.yaml");
  if (!response.ok) {
    throw new Error(`Failed to download Gitea spec: ${response.status}`);
  }
  const text = await response.text();
  fs.writeFileSync(specPath, text, "utf-8");
}

function makeRuntime() {
  const registryLayer = makeCapabilityRegistryLive(capabilitiesDir);
  const credentialLayer = makeCredentialStoreLive({
    rootDir: credentialDir,
    keyPath: path.join(trialRoot, ".credential-key"),
  });
  const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
  const openApiLayer = Layer.provide(
    makeOpenApiSourceLive({ rootDir: capabilitiesRoot }),
    Layer.mergeAll(registryLayer, credentialLayer, httpLayer),
  );
  return ManagedRuntime.make(Layer.mergeAll(registryLayer, credentialLayer, httpLayer, openApiLayer));
}

async function main() {
  await downloadSpec();
  const managed = makeRuntime();
  try {
    const runtime = await managed.runtime();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* OpenApiSource;
        const inspect = yield* source.inspect({
          specUrl: specPath,
          title: "Gitea API",
          selectedServerUrl: "https://gitea.com/api/v1",
          operationFilter: {
            includeMethodsOnly: ["GET"],
            includePathPrefixes: ["/version"],
          },
        });
        const compiled = yield* source.compile({
          specUrl: specPath,
          title: "Gitea API",
          selectedServerUrl: "https://gitea.com/api/v1",
          operationFilter: {
            includeMethodsOnly: ["GET"],
            includePathPrefixes: ["/version"],
          },
        });
        const probe = yield* source.testAuth(compiled.record.sourceId);
        return { inspect, compiled, probe };
      }).pipe(Effect.provide(runtime)),
    );

    const capability = result.compiled.package.capabilities[0];
    process.stdout.write(
      `${JSON.stringify(
        {
          trialRoot,
          specPath,
          inspect: {
            totalOperations: result.inspect.totalOperations,
            includedOperations: result.inspect.includedOperations,
            securitySchemes: result.inspect.securitySchemes,
            firstOperation: result.inspect.operations[0],
          },
          compiled: {
            sourceId: result.compiled.record.sourceId,
            packageId: result.compiled.record.packageId,
            capabilityCount: result.compiled.package.capabilities.length,
            firstCapabilityId: capability?.id,
            firstCapabilityPath: capability?.annotations?.["openapi.path"],
          },
          probe: result.probe,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await managed.dispose();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
