import { Effect, Layer, ManagedRuntime } from "effect";
import {
  CapabilityRegistry,
  makeCapabilityRegistryLive,
} from "@shuvdex/capability-registry";
import {
  ExecutionProviders,
  makeExecutionProvidersLive,
} from "@shuvdex/execution-providers";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeMcpProxyLive } from "@shuvdex/mcp-proxy";
import { makePolicyEngineLive, PolicyEngine } from "@shuvdex/policy-engine";
import type { PolicyEngineService } from "@shuvdex/policy-engine";
import { SkillIndexer, SkillIndexerLive } from "@shuvdex/skill-indexer";
import type { ServerConfig } from "./server.js";
import * as path from "node:path";

export interface ResolvedServerPaths {
  readonly capabilitiesDir: string;
  readonly policyDir: string;
  readonly localRepoPath: string;
}

export interface LoadedServerRuntime {
  readonly serverConfig: ServerConfig;
  readonly paths: ResolvedServerPaths;
  readonly indexFailures: ReadonlyArray<{
    readonly skillName: string;
    readonly sourcePath: string;
    readonly message: string;
  }>;
  readonly indexedArtifactCount: number;
  readonly packageCount: number;
  readonly startupDurationMs: number;
  /**
   * Direct handle to the policy engine for per-request token resolution.
   * Exposes `verifyToken`, `resolveExternalToken`, and `defaultClaims` so the
   * HTTP layer can resolve caller identity without depending on the full
   * Effect runtime context.
   */
  readonly policyEngine: Pick<
    PolicyEngineService,
    "verifyToken" | "resolveExternalToken" | "defaultClaims"
  >;
  readonly dispose: () => Promise<void>;
}

export function logEvent(event: Record<string, unknown>): void {
  process.stderr.write(
    `${JSON.stringify({
      service: "shuvdex-mcp-server",
      timestamp: new Date().toISOString(),
      ...event,
    })}\n`,
  );
}

export function resolveServerPaths(cwd = process.cwd()): ResolvedServerPaths {
  return {
    capabilitiesDir: process.env["CAPABILITIES_DIR"]
      ? path.resolve(process.env["CAPABILITIES_DIR"])
      : path.resolve(cwd, ".capabilities", "packages"),
    policyDir: process.env["POLICY_DIR"]
      ? path.resolve(process.env["POLICY_DIR"])
      : path.resolve(cwd, ".capabilities", "policy"),
    localRepoPath: process.env["LOCAL_REPO_PATH"]
      ? path.resolve(process.env["LOCAL_REPO_PATH"])
      : cwd,
  };
}

export async function loadServerRuntime(
  cwd = process.cwd(),
): Promise<LoadedServerRuntime> {
  const startedAt = Date.now();
  const paths = resolveServerPaths(cwd);

  const credentialStoreRootDir = process.env["CREDENTIALS_DIR"]
    ? path.resolve(process.env["CREDENTIALS_DIR"])
    : path.resolve(cwd, ".capabilities", "credentials");
  const credentialKeyPath = process.env["CREDENTIAL_KEY_PATH"]
    ? path.resolve(process.env["CREDENTIAL_KEY_PATH"])
    : path.resolve(cwd, ".capabilities", ".credential-key");

  const capabilityRegistryLayer = makeCapabilityRegistryLive(paths.capabilitiesDir);
  const credentialStoreLayer = makeCredentialStoreLive({
    rootDir: credentialStoreRootDir,
    keyPath: credentialKeyPath,
  });

  const mcpProxyRootDir = process.env["MCP_PROXY_DIR"]
    ? path.resolve(process.env["MCP_PROXY_DIR"])
    : path.resolve(cwd, ".capabilities", "mcp-proxy");
  const mcpProxyLayer = Layer.provide(
    makeMcpProxyLive({ rootDir: mcpProxyRootDir }),
    credentialStoreLayer,
  );

  const httpExecutorLayer = Layer.provide(makeHttpExecutorLive(), credentialStoreLayer);
  const executionProvidersLayer = Layer.provide(
    makeExecutionProvidersLive(),
    Layer.merge(httpExecutorLayer, mcpProxyLayer),
  );
  const liveLayer = Layer.mergeAll(
    capabilityRegistryLayer,
    credentialStoreLayer,
    httpExecutorLayer,
    mcpProxyLayer,
    makePolicyEngineLive({ policyDir: paths.policyDir }),
    SkillIndexerLive,
    executionProvidersLayer,
  );

  const managedRuntime = ManagedRuntime.make(liveLayer);

  const { packages, failures, indexedArtifactCount } = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilityRegistry = yield* CapabilityRegistry;
      const indexer = yield* SkillIndexer;
      const indexed = yield* indexer.indexRepository(paths.localRepoPath);

      for (const artifact of indexed.artifacts) {
        const existing = yield* Effect.either(
          capabilityRegistry.getPackage(artifact.package.id),
        );
        if (
          existing._tag === "Right" &&
          existing.right.source?.type === "imported_archive"
        ) {
          continue;
        }
        yield* capabilityRegistry.upsertPackage(artifact.package);
      }

      return {
        indexedArtifactCount: indexed.artifacts.length,
        failures: indexed.failures,
        packages: yield* capabilityRegistry.listPackages(),
      };
    }).pipe(Effect.provide(liveLayer)),
  );

  const policy = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* PolicyEngine;
    }).pipe(Effect.provide(liveLayer)),
  );

  const executors = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ExecutionProviders;
    }).pipe(Effect.provide(liveLayer)),
  );

  const startupDurationMs = Date.now() - startedAt;

  logEvent({
    event: "runtime.loaded",
    capabilitiesDir: paths.capabilitiesDir,
    policyDir: paths.policyDir,
    localRepoPath: paths.localRepoPath,
    indexedArtifactCount,
    packageCount: packages.length,
    indexFailureCount: failures.length,
    startupDurationMs,
  });

  for (const failure of failures) {
    logEvent({
      level: "warn",
      event: "runtime.index_failure",
      skillName: failure.skillName,
      sourcePath: failure.sourcePath,
      error: failure.message,
    });
  }

  return {
    serverConfig: {
      capabilities: packages,
      claims: policy.defaultClaims(),
      policy,
      executors,
    },
    paths,
    indexFailures: failures,
    indexedArtifactCount,
    packageCount: packages.length,
    startupDurationMs,
    policyEngine: policy,
    dispose: () => managedRuntime.dispose(),
  };
}
