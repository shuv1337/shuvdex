/**
 * @shuvdex/mcp-server
 *
 * MCP server for the centralized capability gateway. On startup the server
 * loads capability packages from local storage, indexes local skills into
 * packages, and serves tools/resources/prompts from the resulting catalog.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { loadServerRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const runtime = await loadServerRuntime();
  const server = createServer(runtime.serverConfig);
  const transport = new StdioServerTransport();

  process.on("SIGINT", async () => {
    await server.close();
    await runtime.dispose();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    await runtime.dispose();
    process.exit(0);
  });

  await server.connect(transport);

  process.stdin.on("end", async () => {
    await server.close();
    await runtime.dispose();
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
