#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { makeCapabilityRegistryLive } from "../packages/capability-registry/dist/index.js";
import { makeCredentialStoreLive } from "../packages/credential-store/dist/index.js";
import { makeHttpExecutorLive } from "../packages/http-executor/dist/index.js";
import { makeOpenApiSourceLive, OpenApiSource } from "../packages/openapi-source/dist/index.js";

const repoRoot = path.resolve(process.argv[2] ?? process.cwd());
const capabilitiesRoot = path.resolve(process.argv[3] ?? path.join(repoRoot, ".capabilities"));
const packagesDir = path.join(capabilitiesRoot, "packages");
const credentialDir = path.join(capabilitiesRoot, "credentials");
const specPath = path.join(os.tmpdir(), `gitea-openapi-${Date.now()}.yaml`);

async function main() {
  const response = await fetch("https://docs.gitea.com/redocusaurus/plugin-redoc-1.yaml");
  if (!response.ok) throw new Error(`Failed to fetch Gitea spec: ${response.status}`);
  fs.writeFileSync(specPath, await response.text(), "utf-8");

  const registryLayer = makeCapabilityRegistryLive(packagesDir);
  const credentialLayer = makeCredentialStoreLive({ rootDir: credentialDir, keyPath: path.join(capabilitiesRoot, ".credential-key") });
  const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
  const openApiLayer = Layer.provide(makeOpenApiSourceLive({ rootDir: capabilitiesRoot }), Layer.mergeAll(registryLayer, credentialLayer, httpLayer));
  const managed = ManagedRuntime.make(Layer.mergeAll(registryLayer, credentialLayer, httpLayer, openApiLayer));

  try {
    const runtime = await managed.runtime();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const source = yield* OpenApiSource;
        return yield* source.compile({
          specUrl: specPath,
          title: "Gitea API",
          selectedServerUrl: "https://gitea.com/api/v1",
          operationFilter: {
            includeMethodsOnly: ["GET"],
            includePathPrefixes: ["/version"],
          },
        });
      }).pipe(Effect.provide(runtime)),
    );

    console.log(JSON.stringify({
      capabilitiesRoot,
      specPath,
      sourceId: result.record.sourceId,
      packageId: result.record.packageId,
      capabilityIds: result.package.capabilities.map((capability) => capability.id),
    }, null, 2));
  } finally {
    await managed.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
