/**
 * MCP Server Protocol Tests
 *
 * Covers initialization and dynamic tool advertisement for the capability gateway.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { makeExecutionProvidersLive, ExecutionProviders } from "../../../packages/execution-providers/src/index.js";
import { makeHttpExecutorLive } from "../../../packages/http-executor/src/index.js";
import { makeCredentialStoreLive } from "../../../packages/credential-store/src/index.js";
import { Effect, Layer, ManagedRuntime } from "effect";

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

async function makeExecutors() {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-creds-"));
  const credentialLayer = makeCredentialStoreLive({ rootDir: credsDir, keyPath: path.join(credsDir, ".key") });
  const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
  const providersLayer = Layer.provide(makeExecutionProvidersLive(), httpLayer);
  const managedRuntime = ManagedRuntime.make(
    Layer.mergeAll(
      credentialLayer,
      httpLayer,
      providersLayer,
    ),
  );
  const runtime = await managedRuntime.runtime();
  const executors = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* ExecutionProviders;
    }).pipe(Effect.provide(runtime)),
  );
  return { executors, managedRuntime, credsDir };
}

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
      expect(info?.name).toBe("shuvdex");
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

    it("executes module_runtime-backed tools", async () => {
      await cleanup();

      const scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tool-runtime-"));
      const scriptPath = path.join(scriptDir, "tool.mjs");
      fs.writeFileSync(
        scriptPath,
        [
          'let input = "";',
          'process.stdin.setEncoding("utf8");',
          'process.stdin.on("data", (chunk) => { input += chunk; });',
          'process.stdin.on("end", () => {',
          '  const request = JSON.parse(input || "{}");',
          '  process.stdout.write(JSON.stringify({ payload: { echoed: request.args.message } }));',
          '});',
        ].join("\n"),
        "utf-8",
      );

      const { executors, managedRuntime } = await makeExecutors();
      const packageWithExecutable = {
        ...samplePackage,
        source: { type: "generated" as const, path: scriptDir },
        capabilities: [
          {
            ...samplePackage.capabilities[0],
            executorRef: {
              executorType: "module_runtime" as const,
              target: scriptPath,
              timeoutMs: 2_000,
            },
          },
        ],
      };

      const server = createServer({ capabilities: [packageWithExecutable], executors });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      client = new Client({ name: "test-client", version: "0.0.1" });
      await client.connect(clientTransport);

      cleanup = async () => {
        await client.close();
        await server.close();
        await managedRuntime.dispose();
        fs.rmSync(scriptDir, { recursive: true, force: true });
      };

      const result = await client.callTool({ name: "echo", arguments: { message: "hi" } });
      expect(result.isError).not.toBe(true);
      expect(result.content[0]?.type).toBe("text");
      expect((result.content[0] as { text?: string }).text).toContain("hi");
    });

    it("executes http_api-backed tools", async () => {
      await cleanup();

      const seen: string[] = [];
      const httpServer = createHttpServer((req, res) => {
        seen.push(req.url ?? "");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, path: req.url }));
      });
      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
      const httpPort = (httpServer.address() as import("node:net").AddressInfo).port;

      const { executors, managedRuntime } = await makeExecutors();
      const httpPackage = {
        id: "sample.http",
        version: "1.0.0",
        title: "Sample HTTP",
        description: "Sample HTTP capability package.",
        builtIn: false,
        enabled: true,
        tags: ["gateway"],
        source: { type: "openapi" as const },
        capabilities: [
          {
            id: "sample.http.getThing",
            packageId: "sample.http",
            version: "1.0.0",
            kind: "tool" as const,
            title: "Get Thing",
            description: "Fetch thing.",
            enabled: true,
            visibility: "public" as const,
            subjectScopes: ["sample.http.read"],
            riskLevel: "low" as const,
            executorRef: {
              executorType: "http_api" as const,
              timeoutMs: 2_000,
              httpBinding: {
                method: "get",
                baseUrl: `http://127.0.0.1:${httpPort}`,
                pathTemplate: "/things/{id}",
              },
            },
            tool: {
              inputSchema: {
                type: "object",
                properties: {
                  path: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
                  query: { type: "object", properties: { page: { type: "number" } } },
                },
              },
              outputSchema: { type: "object" },
              sideEffectLevel: "read" as const,
            },
          },
        ],
      };

      const server = createServer({ capabilities: [httpPackage], executors });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      client = new Client({ name: "http-client", version: "0.0.1" });
      await client.connect(clientTransport);

      cleanup = async () => {
        await client.close();
        await server.close();
        await managedRuntime.dispose();
        await new Promise<void>((resolve, reject) => httpServer.close((err) => err ? reject(err) : resolve()));
      };

      const result = await client.callTool({ name: "sample.http.getThing", arguments: { path: { id: "abc" }, query: { page: 3 } } });
      expect(result.isError).not.toBe(true);
      expect(seen[0]).toContain("/things/abc?page=3");
    });
  });

  describe("resources/read", () => {
    it("reads text and binary resources from sourceRef when contents are omitted", async () => {
      await cleanup();

      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-resource-test-"));
      const markdownPath = path.join(dir, "guide.md");
      const imagePath = path.join(dir, "banner.png");
      fs.writeFileSync(markdownPath, "# Guide\n\nHello from disk.\n", "utf-8");
      fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

      const server = createServer({
        capabilities: [
          {
            id: "sample.resources",
            version: "1.0.0",
            title: "Sample Resources",
            description: "Sample resource package.",
            builtIn: false,
            enabled: true,
            source: { type: "generated", path: dir },
            capabilities: [
              {
                id: "sample.resources.guide",
                packageId: "sample.resources",
                version: "1.0.0",
                kind: "resource",
                title: "Guide",
                description: "Guide resource",
                enabled: true,
                visibility: "public",
                resource: {
                  uri: "skill://sample/guide.md",
                  mimeType: "text/markdown",
                },
                sourceRef: markdownPath,
              },
              {
                id: "sample.resources.banner",
                packageId: "sample.resources",
                version: "1.0.0",
                kind: "resource",
                title: "Banner",
                description: "Banner image",
                enabled: true,
                visibility: "public",
                resource: {
                  uri: "skill://sample/banner.png",
                  mimeType: "image/png",
                },
                sourceRef: imagePath,
              },
            ],
          },
        ],
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      client = new Client({ name: "resource-client", version: "0.0.1" });
      await client.connect(clientTransport);

      cleanup = async () => {
        await client.close();
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
      };

      const textResponse = await client.readResource({ uri: "skill://sample/guide.md" });
      const imageResponse = await client.readResource({ uri: "skill://sample/banner.png" });

      expect(textResponse.contents[0]?.text).toContain("Hello from disk.");
      expect(imageResponse.contents[0]?.blob).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
    });

    it("rejects sourceRef paths outside allowed package roots", async () => {
      await cleanup();

      const allowedDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-allowed-"));
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-outside-"));
      const outsidePath = path.join(outsideDir, "secret.txt");
      fs.writeFileSync(outsidePath, "super-secret", "utf-8");

      const server = createServer({
        capabilities: [
          {
            id: "sample.resources",
            version: "1.0.0",
            title: "Sample Resources",
            description: "Sample resource package.",
            builtIn: false,
            enabled: true,
            source: { type: "generated", path: allowedDir },
            capabilities: [
              {
                id: "sample.resources.secret",
                packageId: "sample.resources",
                version: "1.0.0",
                kind: "resource",
                title: "Secret",
                description: "Secret resource",
                enabled: true,
                visibility: "public",
                resource: {
                  uri: "skill://sample/secret.txt",
                  mimeType: "text/plain",
                },
                sourceRef: outsidePath,
              },
            ],
          },
        ],
      });
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);

      client = new Client({ name: "resource-client", version: "0.0.1" });
      await client.connect(clientTransport);

      cleanup = async () => {
        await client.close();
        await server.close();
        fs.rmSync(allowedDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
      };

      await expect(
        client.readResource({ uri: "skill://sample/secret.txt" }),
      ).rejects.toThrow(/outside allowed package roots/);
    });
  });
});
