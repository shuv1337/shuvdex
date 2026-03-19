/**
 * @codex-fleet/mcp-server
 *
 * MCP server for the centralized capability gateway. On startup the server
 * loads capability packages from local storage, indexes local skills into
 * packages, and serves tools/resources/prompts from the resulting catalog.
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CapabilityRegistry,
  makeCapabilityRegistryLive,
} from "@codex-fleet/capability-registry";
import {
  ExecutionProviders,
  makeExecutionProvidersLive,
} from "@codex-fleet/execution-providers";
import { makePolicyEngineLive, PolicyEngine } from "@codex-fleet/policy-engine";
import { SkillIndexer, SkillIndexerLive } from "@codex-fleet/skill-indexer";
import { createServer } from "./server.js";
import type { ServerConfig } from "./server.js";
import * as path from "node:path";

async function main(): Promise<void> {
  const capabilitiesDir = process.env["CAPABILITIES_DIR"]
    ? path.resolve(process.env["CAPABILITIES_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "packages");
  const policyDir = process.env["POLICY_DIR"]
    ? path.resolve(process.env["POLICY_DIR"])
    : path.resolve(process.cwd(), ".capabilities", "policy");

  const liveLayer = Layer.mergeAll(
    makeCapabilityRegistryLive(capabilitiesDir),
    makePolicyEngineLive({ policyDir }),
    SkillIndexerLive,
    makeExecutionProvidersLive(),
  );

  const managedRuntime = ManagedRuntime.make(liveLayer);

  const packages = await Effect.runPromise(
    Effect.gen(function* () {
      const capabilityRegistry = yield* CapabilityRegistry;
      const indexer = yield* SkillIndexer;
      const indexed = yield* indexer.indexRepository(process.cwd());
      for (const artifact of indexed.artifacts) {
        const existing = yield* Effect.either(capabilityRegistry.getPackage(artifact.package.id));
        if (existing._tag === "Right" && existing.right.source?.type === "imported_archive") {
          continue;
        }
        yield* capabilityRegistry.upsertPackage(artifact.package);
      }
      return yield* capabilityRegistry.listPackages();
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

  const serverConfig: ServerConfig = {
    capabilities: packages,
    claims: policy.defaultClaims(),
    policy,
    executors,
  };

  const server = createServer(serverConfig);
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await server.close();
    await managedRuntime.dispose();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    await managedRuntime.dispose();
    process.exit(0);
  });

  await server.connect(transport);

  process.stdin.on("end", async () => {
    await server.close();
    await managedRuntime.dispose();
    process.exit(0);
  });

  server.server.onerror = (error: Error) => {
    const isParseError =
      error instanceof SyntaxError ||
      error.message.includes("Expected") ||
      error.message.includes("JSON");

    const isInvalidRequest =
      !isParseError &&
      "issues" in error &&
      Array.isArray((error as Record<string, unknown>).issues);

    if (isParseError) {
      const errorResponse = JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${error.message}`,
        },
      });
      process.stdout.write(errorResponse + "\n");
    } else if (isInvalidRequest) {
      const errorResponse = JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message: "Invalid Request: payload is not a valid JSON-RPC 2.0 message",
        },
      });
      process.stdout.write(errorResponse + "\n");
    }
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
