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

  // --- JSON-RPC parse error handling ---
  // The MCP SDK's StdioServerTransport forwards JSON parse errors to
  // onerror but does NOT send a JSON-RPC error response back to the
  // client.  We intercept those errors here and write a proper -32700
  // ParseError response to stdout so clients receive actionable feedback
  // and the server continues processing subsequent messages.
  //
  // We write directly to stdout (not transport.send) because the SDK's
  // JSONRPCMessage type doesn't allow `id: null`, but JSON-RPC 2.0 spec
  // requires `id: null` for parse errors where the request id is unknown.
  server.server.onerror = (error: Error) => {
    const isParseError =
      error instanceof SyntaxError ||
      error.message.includes("Expected") ||
      error.message.includes("JSON");

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
    }
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
