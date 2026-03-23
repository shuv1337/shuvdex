import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";

const SERVER_ENTRY = resolve(process.cwd(), "apps/mcp-server/dist/http.js");
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function waitForHealth(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolvePromise, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) {
          resolvePromise();
          return;
        }
      } catch {
        // retry until timeout
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for health at ${url}`));
        return;
      }
      setTimeout(attempt, 150);
    };
    void attempt();
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolvePromise(port);
      });
    });
    server.on("error", reject);
  });
}

async function startServer() {
  const root = makeTempDir("shuvdex-http-");
  const repoRoot = makeTempDir("shuvdex-http-repo-");
  const skillDir = join(repoRoot, "demo-skill");
  const scriptPath = join(skillDir, "echo.mcp.mjs");

  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "# Demo Skill\n\nSimple HTTP MCP test skill.\n", "utf-8");
  writeFileSync(
    join(skillDir, "capability.yaml"),
    [
      "id: skill.demo_http",
      "title: Demo HTTP Skill",
      "description: HTTP-exposed demo tool.",
      "version: 1.0.0",
      "visibility: public",
      "capabilities:",
      "  - id: skill.demo_http.echo",
      "    packageId: skill.demo_http",
      "    version: 1.0.0",
      "    kind: tool",
      "    title: Echo",
      "    description: Echo the supplied message.",
      "    enabled: true",
      "    visibility: public",
      "    executorRef:",
      "      executorType: module_runtime",
      `      target: ${scriptPath}`,
      "      timeoutMs: 2000",
      "    tool:",
      "      inputSchema:",
      "        type: object",
      "        required:",
      "          - message",
      "        properties:",
      "          message:",
      "            type: string",
      "      outputSchema:",
      "        type: object",
      "      sideEffectLevel: read",
      "",
    ].join("\n"),
    "utf-8",
  );
  writeFileSync(
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

  const port = await getFreePort();
  const child = spawn("node", [SERVER_ENTRY], {
    env: {
      ...process.env,
      MCP_HOST: "127.0.0.1",
      MCP_PORT: String(port),
      CAPABILITIES_DIR: join(root, "packages"),
      POLICY_DIR: join(root, "policy"),
      LOCAL_REPO_PATH: repoRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  let closed = false;
  child.on("close", (code) => {
    closed = true;
    stderr += `\n[process closed with code ${code}]`;
  });

  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`);
  } catch (error) {
    child.kill("SIGTERM");
    await new Promise<void>((resolvePromise) => {
      child.on("close", () => resolvePromise());
    });
    throw new Error(
      `Failed to start HTTP MCP server on port ${port}: ${error instanceof Error ? error.message : String(error)}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`,
    );
  }

  return {
    port,
    stdout: () => stdout,
    stderr: () => stderr,
    stop: async () => {
      if (closed) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolvePromise) => {
        child.on("close", () => resolvePromise());
      });
    },
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("HTTP MCP server", () => {
  it("serves health and handles initialize + tools/list over /mcp", { timeout: 15000 }, async () => {
    const server = await startServer();

    try {
      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.ok).toBe(true);
      const healthJson = (await health.json()) as Record<string, unknown>;
      expect(healthJson.status).toBe("ok");
      expect(healthJson.transport).toBe("streamable-http");
      expect(healthJson.packageCount).toBe(1);

      const init = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.1" },
          },
        }),
      });

      expect(init.ok).toBe(true);
      const initJson = (await init.json()) as Record<string, unknown>;
      expect(initJson).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
      });

      const tools = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      });

      expect(tools.ok).toBe(true);
      const toolsJson = (await tools.json()) as {
        result?: { tools?: Array<{ name?: string }> };
      };
      expect(toolsJson.result?.tools?.some((tool) => tool.name === "skill.demo_http.echo")).toBe(true);
    } finally {
      await server.stop();
    }
  });
});
