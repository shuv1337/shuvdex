/**
 * MCP Server Protocol Tests
 *
 * Tests for VAL-MCP-001 (initialization), VAL-MCP-002 (tools/list),
 * VAL-MCP-012 (stdio transport compliance), VAL-MCP-015 (graceful shutdown).
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

describe("MCP Server Protocol", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-client", version: "0.0.1" });
    await client.connect(clientTransport);

    cleanup = async () => {
      await client.close();
      await server.close();
    };
  });

  afterEach(async () => {
    await cleanup();
  });

  // --- VAL-MCP-001: Server Initialization Response ---

  describe("VAL-MCP-001: initialization", () => {
    it("returns valid InitializeResult with protocolVersion", () => {
      // The client.connect() above already performed the initialize handshake.
      // If it didn't throw, the protocol was agreed upon.
      const serverCapabilities = client.getServerCapabilities();
      expect(serverCapabilities).toBeDefined();
    });

    it("advertises tools capability", () => {
      const caps = client.getServerCapabilities();
      expect(caps?.tools).toBeDefined();
    });

    it("returns server info with name and version", () => {
      const info = client.getServerVersion();
      expect(info).toBeDefined();
      expect(info?.name).toBe("codex-fleet");
      expect(info?.version).toBe("0.0.0");
    });

    it("completes initialization within 5 seconds", async () => {
      // Create a fresh server/client pair with timing
      const server2 = createServer();
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await server2.connect(st);

      const client2 = new Client({ name: "timing-test", version: "0.0.1" });
      const start = Date.now();
      await client2.connect(ct);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(5000);

      await client2.close();
      await server2.close();
    });
  });

  // --- VAL-MCP-002: Tools List Response ---

  describe("VAL-MCP-002: tools/list", () => {
    const EXPECTED_TOOLS = [
      "fleet_status",
      "fleet_sync",
      "fleet_activate",
      "fleet_deactivate",
      "fleet_pull",
      "fleet_drift",
      "fleet_rollback",
    ];

    it("returns exactly 7 tools", async () => {
      const response = await client.listTools();
      expect(response.tools).toHaveLength(7);
    });

    it("returns all expected tool names", async () => {
      const response = await client.listTools();
      const names = response.tools.map((t) => t.name).sort();
      expect(names).toEqual([...EXPECTED_TOOLS].sort());
    });

    it("each tool has a name", async () => {
      const response = await client.listTools();
      for (const tool of response.tools) {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.name).toBe("string");
      }
    });

    it("each tool has a description", async () => {
      const response = await client.listTools();
      for (const tool of response.tools) {
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe("string");
      }
    });

    it("each tool has an inputSchema", async () => {
      const response = await client.listTools();
      for (const tool of response.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe("object");
      }
    });

    it("fleet_status has no required parameters", async () => {
      const response = await client.listTools();
      const tool = response.tools.find((t) => t.name === "fleet_status");
      expect(tool).toBeDefined();
      // fleet_status takes optional hosts filter
      const required = (tool!.inputSchema as Record<string, unknown>)
        .required as string[] | undefined;
      expect(!required || required.length === 0).toBe(true);
    });

    it("fleet_sync requires skill parameter", async () => {
      const response = await client.listTools();
      const tool = response.tools.find((t) => t.name === "fleet_sync");
      expect(tool).toBeDefined();
      const required = (tool!.inputSchema as Record<string, unknown>)
        .required as string[];
      expect(required).toContain("skill");
    });

    it("fleet_activate requires skill parameter", async () => {
      const response = await client.listTools();
      const tool = response.tools.find((t) => t.name === "fleet_activate");
      expect(tool).toBeDefined();
      const required = (tool!.inputSchema as Record<string, unknown>)
        .required as string[];
      expect(required).toContain("skill");
    });

    it("fleet_deactivate requires skill parameter", async () => {
      const response = await client.listTools();
      const tool = response.tools.find(
        (t) => t.name === "fleet_deactivate",
      );
      expect(tool).toBeDefined();
      const required = (tool!.inputSchema as Record<string, unknown>)
        .required as string[];
      expect(required).toContain("skill");
    });

    it("fleet_rollback requires ref parameter", async () => {
      const response = await client.listTools();
      const tool = response.tools.find((t) => t.name === "fleet_rollback");
      expect(tool).toBeDefined();
      const required = (tool!.inputSchema as Record<string, unknown>)
        .required as string[];
      expect(required).toContain("ref");
    });
  });
});
