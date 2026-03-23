import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Hono } from "hono";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CapabilityRegistry, makeCapabilityRegistryLive } from "@shuvdex/capability-registry";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeSkillImporterLive } from "@shuvdex/skill-importer";
import { SkillIndexerLive } from "@shuvdex/skill-indexer";
import { packagesRouter } from "../../../apps/api/src/routes/packages.js";
import { createServer } from "../src/server.js";
import { makeExecutionProvidersLive, ExecutionProviders } from "../../../packages/execution-providers/src/index.js";

const SKILL_SOURCE = "/home/shuv/repos/shuvbot-skills/youtube-transcript";

function makeApp(localRepoPath: string, packagesDir: string, importsDir: string) {
  const registryLayer = makeCapabilityRegistryLive(packagesDir);
  const liveLayer = Layer.mergeAll(
    registryLayer,
    Layer.provide(makeSkillImporterLive({ importsDir }), registryLayer),
    SkillIndexerLive,
  );
  const managed = ManagedRuntime.make(liveLayer);

  return managed.runtime().then((runtime) => {
    const app = new Hono();
    app.route("/api/packages", packagesRouter(runtime as never, localRepoPath, importsDir));
    return { app, managed, runtime };
  });
}

describe("imported module_runtime tools", () => {
  it("imports youtube-transcript and executes its MCP tool via the server", async () => {
    const localRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-e2e-local-"));
    const packagesDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-e2e-packages-"));
    const importsDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-e2e-imports-"));
    const archivePath = path.join(os.tmpdir(), `youtube-transcript-${Date.now()}.zip`);
    execFileSync("zip", ["-qr", archivePath, ".", "-x", "node_modules/*"], { cwd: SKILL_SOURCE });

    const { app, managed } = await makeApp(localRepoPath, packagesDir, importsDir);
    let executionRuntime: ManagedRuntime.ManagedRuntime<any> | undefined;

    try {
      const form = new FormData();
      form.set("file", new File([fs.readFileSync(archivePath)], "youtube-transcript.zip"));
      const importResponse = await app.request("http://localhost/api/packages/import", {
        method: "POST",
        body: form,
      });
      expect(importResponse.status).toBe(200);
      const importBody = await importResponse.json();
      expect(importBody.package.id).toBe("skill.youtube_transcript");

      const managedRoot = path.join(importsDir, "skill.youtube_transcript", "1.0.0");
      execFileSync("npm", ["install", "--omit=dev"], { cwd: managedRoot, stdio: "ignore" });

      const registryLayer = makeCapabilityRegistryLive(packagesDir);
      const credentialLayer = makeCredentialStoreLive({ rootDir: path.join(packagesDir, "..", "credentials"), keyPath: path.join(packagesDir, "..", ".credential-key") });
      const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
      const providersLayer = Layer.provide(makeExecutionProvidersLive(), httpLayer);
      executionRuntime = ManagedRuntime.make(Layer.mergeAll(registryLayer, credentialLayer, httpLayer, providersLayer));
      const runtime = await executionRuntime.runtime();
      const executors = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* ExecutionProviders;
        }).pipe(Effect.provide(runtime)),
      );

      const packages = await Effect.runPromise(
        Effect.gen(function* () {
          const registry = yield* CapabilityRegistry;
          return yield* registry.listPackages();
        }).pipe(Effect.provide(runtime)),
      );
      const importedPackage = packages.find((pkg) => pkg.id === "skill.youtube_transcript");
      expect(importedPackage).toBeDefined();

      const server = createServer({ capabilities: importedPackage ? [importedPackage] : [], executors });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "imported-tool-client", version: "0.0.1" });
      await client.connect(clientTransport);

      try {
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain("skill.youtube_transcript.fetch_transcript");

        const result = await client.callTool({
          name: "skill.youtube_transcript.fetch_transcript",
          arguments: { video: "dQw4w9WgXcQ" },
        });
        expect(result.isError).not.toBe(true);
        const payload = JSON.parse((result.content[0] as { text: string }).text);
        expect(payload.videoId).toBe("dQw4w9WgXcQ");
        expect(payload.entryCount).toBeGreaterThan(0);
        expect(payload.text).toContain("[");
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      if (executionRuntime) {
        await executionRuntime.dispose();
      }
      await managed.dispose();
      fs.rmSync(localRepoPath, { recursive: true, force: true });
      fs.rmSync(packagesDir, { recursive: true, force: true });
      fs.rmSync(importsDir, { recursive: true, force: true });
      fs.rmSync(archivePath, { force: true });
    }
  }, 120000);
});
