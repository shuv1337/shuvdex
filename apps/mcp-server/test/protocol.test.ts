/**
 * MCP Server Protocol Tests
 *
 * Covers initialization and dynamic tool advertisement for the capability gateway.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

const samplePackage = {
  id: "sample.echo",
  version: "1.0.0",
  title: "Sample Echo",
  description: "Sample capability package used in protocol tests.",
  builtIn: false,
  enabled: true,
  tags: ["gateway"],
  source: { type: "generated" as const },
  capabilities: [
    {
      id: "echo",
      packageId: "sample.echo",
      version: "1.0.0",
      kind: "tool" as const,
      title: "Echo",
      description: "Return the supplied message.",
      enabled: true,
      visibility: "public" as const,
      tags: ["gateway"],
      subjectScopes: ["admin"],
      riskLevel: "low" as const,
      executorRef: { executorType: "module_runtime" as const },
      tool: {
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Message to echo back to the caller.",
            },
          },
          required: ["message"],
        },
        outputSchema: { type: "object" },
        sideEffectLevel: "read" as const,
      },
    },
  ],
};

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

  describe("initialization", () => {
    it("returns valid server capabilities", () => {
      const serverCapabilities = client.getServerCapabilities();
      expect(serverCapabilities).toBeDefined();
      expect(serverCapabilities?.tools).toBeDefined();
    });

    it("returns server info with name and version", () => {
      const info = client.getServerVersion();
      expect(info).toBeDefined();
      expect(info?.name).toBe("codex-fleet");
      expect(info?.version).toBe("0.0.0");
    });

    it("completes initialization within 5 seconds", async () => {
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

  describe("tools/list", () => {
    it("does not advertise a tools/list method for an empty catalog", async () => {
      await expect(client.listTools()).rejects.toThrow(/Method not found/);
    });

    it("registers dynamically supplied capability tools", async () => {
      await cleanup();

      const server = createServer({ capabilities: [samplePackage] });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      client = new Client({ name: "test-client", version: "0.0.1" });
      await client.connect(clientTransport);

      cleanup = async () => {
        await client.close();
        await server.close();
      };

      const response = await client.listTools();
      expect(response.tools).toHaveLength(1);

      const tool = response.tools[0];
      expect(tool?.name).toBe("echo");
      expect(tool?.description).toBe("Return the supplied message.");
      expect(tool?.inputSchema.type).toBe("object");
      expect(
        ((tool?.inputSchema as Record<string, unknown>).required ?? []) as string[],
      ).toContain("message");
    });
  });
});
