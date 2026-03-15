/**
 * MCP Server factory.
 *
 * Creates an McpServer instance with all 7 fleet tools registered.
 * Tool handlers are stubs for now — real implementations will be added
 * in subsequent features (mcp-status-sync-tools, mcp-activation-tools, etc.).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

/**
 * Optional hosts filter schema, shared across several tools.
 */
const hostsFilter = {
  hosts: z
    .array(z.string())
    .optional()
    .describe("Subset of host names to target (defaults to all)"),
};

/**
 * Creates and returns a configured McpServer with all 7 fleet tools.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "codex-fleet", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );

  // --- fleet_status ---
  server.tool(
    "fleet_status",
    "Get fleet status: connectivity, HEAD commit, branch, and dirty state for each host.",
    hostsFilter,
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_sync ---
  server.tool(
    "fleet_sync",
    "Sync a skill from local repository to remote hosts.",
    {
      skill: z.string().describe("Name of the skill directory to sync"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_activate ---
  server.tool(
    "fleet_activate",
    "Activate a skill on remote hosts by creating a symlink in the active skills directory.",
    {
      skill: z.string().describe("Name of the skill to activate"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_deactivate ---
  server.tool(
    "fleet_deactivate",
    "Deactivate a skill on remote hosts by removing its activation symlink.",
    {
      skill: z.string().describe("Name of the skill to deactivate"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_pull ---
  server.tool(
    "fleet_pull",
    "Pull latest changes from the remote origin on each host's skills repository.",
    hostsFilter,
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_drift ---
  server.tool(
    "fleet_drift",
    "Detect commit drift across fleet hosts by comparing HEAD commits to a reference.",
    {
      referenceHost: z
        .string()
        .optional()
        .describe(
          "Host to use as the reference (defaults to first configured host)",
        ),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  // --- fleet_rollback ---
  server.tool(
    "fleet_rollback",
    "Rollback hosts to a specific git ref (branch, tag, or SHA).",
    {
      ref: z.string().describe("Git ref to checkout (branch, tag, or SHA)"),
      ...hostsFilter,
    },
    async () => ({
      content: [
        { type: "text", text: JSON.stringify({ error: "Not implemented" }) },
      ],
      isError: true,
    }),
  );

  return server;
}
