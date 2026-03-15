/**
 * @codex-fleet/mcp-server
 *
 * MCP server for Codex Desktop integration with fleet skills management.
 * Uses stdio transport with line-delimited JSON-RPC.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  // Graceful shutdown on stdin EOF: the transport emits onclose
  // when stdin ends, and server.close() is called automatically.
  // We also handle process signals for clean exit.
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });

  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
