import { Layer, ManagedRuntime } from "effect";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HostRegistry } from "@codex-fleet/core";
import { SshExecutorLive } from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { TelemetryLive } from "@codex-fleet/telemetry";
import { createServer } from "../../../../../apps/mcp-server/dist/server.js";
import { readFileSync } from "node:fs";

const configPath = process.argv[2];

if (!configPath) {
  console.error("Usage: node custom-server.mjs <config.json>");
  process.exit(1);
}

const raw = readFileSync(configPath, "utf8");
const parsed = JSON.parse(raw);

const liveLayer = Layer.mergeAll(SshExecutorLive, TelemetryLive).pipe(
  (base) => Layer.provideMerge(GitOpsLive, base),
  (base) => Layer.provideMerge(SkillOpsLive, base),
);

const managedRuntime = ManagedRuntime.make(liveLayer);
const runtime = await managedRuntime.runtime();

const server = createServer({
  registry: HostRegistry.fromRecord(parsed.registry),
  repoPath: parsed.repoPath,
  runtime,
  localRepoPath: parsed.localRepoPath,
  activeDir: parsed.activeDir,
});

const transport = new StdioServerTransport();

const shutdown = async () => {
  await server.close();
  await managedRuntime.dispose();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(transport);

process.stdin.on("end", shutdown);

server.server.onerror = (error) => {
  const isParseError =
    error instanceof SyntaxError ||
    error.message.includes("Expected") ||
    error.message.includes("JSON");

  const isInvalidRequest =
    !isParseError &&
    "issues" in error &&
    Array.isArray(error.issues);

  if (isParseError) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${error.message}`,
        },
      }) + "\n",
    );
    return;
  }

  if (isInvalidRequest) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32600,
          message:
            "Invalid Request: payload is not a valid JSON-RPC 2.0 message",
        },
      }) + "\n",
    );
  }
};
