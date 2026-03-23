import { Effect, Layer, ManagedRuntime } from "effect";
import {
  CapabilityRegistry,
  makeCapabilityRegistryLive,
} from "@shuvdex/capability-registry";
import {
  ExecutionProviders,
  makeExecutionProvidersLive,
} from "@shuvdex/execution-providers";
import { makePolicyEngineLive, PolicyEngine } from "@shuvdex/policy-engine";
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

  const liveLayer = Layer.mergeAll(
    makeCapabilityRegistryLive(paths.capabilitiesDir),
    makePolicyEngineLive({ policyDir: paths.policyDir }),
    SkillIndexerLive,
    makeExecutionProvidersLive(),
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
    dispose: () => managedRuntime.dispose(),
  };
}
