/**
 * @codex-fleet/mcp-server
 *
 * MCP server for Codex Desktop integration with fleet skills management.
 * Uses stdio transport with line-delimited JSON-RPC.
 *
 * On startup the server loads host configuration from fleet.yaml (looked up
 * relative to the process working directory) and builds an Effect runtime
 * with live SSH, git-ops, skill-ops, and telemetry layers so that tools
 * can execute real fleet operations.
 */
import { Effect, Layer, ManagedRuntime } from "effect";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "@codex-fleet/core";
import { SshExecutorLive } from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { createServer } from "./server.js";
import type { ServerConfig } from "./server.js";
import * as path from "node:path";

/** Default skills-repo path on remote hosts. */
const DEFAULT_REPO_PATH = "~/repos/shuvbot-skills";

async function main(): Promise<void> {
  // --- Build the live service layer ---
  const liveLayer = Layer.mergeAll(SshExecutorLive, TelemetryLive).pipe(
    (base) => Layer.provideMerge(GitOpsLive, base),
    (base) => Layer.provideMerge(SkillOpsLive, base),
  );

  const managedRuntime = ManagedRuntime.make(liveLayer);

  // --- Attempt to load host configuration ---
  // If fleet.yaml is not found the server starts with stubs so that
  // protocol-level operations (initialize, tools/list) still work.
  const configPath = path.resolve(process.cwd(), "fleet.yaml");
  let serverConfig: ServerConfig | undefined;

  try {
    const registry = await Effect.runPromise(loadConfig(configPath));
    const runtime = await managedRuntime.runtime();

    serverConfig = {
      registry,
      repoPath: DEFAULT_REPO_PATH,
      runtime,
      localRepoPath: process.cwd(),
    };
  } catch {
    // Config not found – tools will return "Not implemented" stubs
  }

  const server = createServer(serverConfig);
  const transport = new StdioServerTransport();

  // Graceful shutdown on stdin EOF: the transport emits onclose
  // when stdin ends, and server.close() is called automatically.
  // We also handle process signals for clean exit.
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

  // Graceful shutdown on stdin EOF.
  // The StdioServerTransport does not listen for the stdin "end" event
  // itself, so we handle it here.  Without this, the ManagedRuntime keeps
  // the Node event loop alive and the process never exits when Codex
  // Desktop (or any client) closes the pipe.
  process.stdin.on("end", async () => {
    await server.close();
    await managedRuntime.dispose();
    process.exit(0);
  });

  // --- JSON-RPC error handling ---
  // The MCP SDK's StdioServerTransport forwards errors from its
  // ReadBuffer to onerror.  Two categories need distinct responses:
  //
  // 1. **Parse errors** (SyntaxError) – the line is not valid JSON at all.
  //    JSON-RPC 2.0 §5.1: respond with -32700 Parse error.
  //
  // 2. **Invalid Request** (ZodError) – the line is valid JSON but fails
  //    the JSONRPCMessageSchema union (e.g. `[]`, `{}`, `{"foo":"bar"}`).
  //    JSON-RPC 2.0 §5.1: respond with -32600 Invalid Request.
  //
  // We write directly to stdout (not transport.send) because the SDK's
  // JSONRPCMessage type doesn't allow `id: null`, but JSON-RPC 2.0 spec
  // requires `id: null` for errors where the request id is unknown.
  server.server.onerror = (error: Error) => {
    const isParseError =
      error instanceof SyntaxError ||
      error.message.includes("Expected") ||
      error.message.includes("JSON");

    // ZodError from the SDK's JSONRPCMessageSchema.parse() – valid JSON
    // that doesn't conform to any JSON-RPC message shape.
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
