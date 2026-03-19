/**
 * MCP Server stdio Transport Tests
 *
 * Verifies line-delimited JSON-RPC and clean startup/shutdown for the gateway.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../dist/index.js");

const tempDirs: string[] = [];

function makeServerEnv(): NodeJS.ProcessEnv {
  const baseDir = mkdtempSync(resolve(tmpdir(), "codex-fleet-mcp-"));
  tempDirs.push(baseDir);
  return {
    ...process.env,
    CAPABILITIES_DIR: resolve(baseDir, "packages"),
    POLICY_DIR: resolve(baseDir, "policy"),
  };
}

function spawnServer(
  input: string,
  timeoutMs = 5000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("node", [SERVER_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      env: makeServerEnv(),
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Server did not exit within timeout"));
    }, timeoutMs);

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: code });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin!.write(input);
    child.stdin!.end();
  });
}

function findMessageById(stdout: string, id: number): Record<string, unknown> | undefined {
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((message) => message.id === id);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("MCP stdio transport", () => {
  describe("line-delimited JSON", () => {
    it("each line of stdout is valid JSON", async () => {
      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      });

      const { stdout } = await spawnServer(initRequest + "\n");
      const lines = stdout.split("\n").filter((line) => line.trim().length > 0);

      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it("initialize response contains valid result", async () => {
      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      });

      const { stdout } = await spawnServer(initRequest + "\n");
      const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
      const initResponse = JSON.parse(lines[0] ?? "");

      expect(initResponse.id).toBe(1);
      expect(initResponse.result.serverInfo.name).toBe("codex-fleet");
      expect(initResponse.result.capabilities).toBeDefined();
    });

    it("tools/list is absent for an isolated empty server", async () => {
      const messages = [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0.0.1" },
          },
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      ];

      const { stdout } = await spawnServer(messages.join("\n") + "\n");
      const toolsResponse = findMessageById(stdout, 2);

      expect(toolsResponse).toBeDefined();
      expect(toolsResponse?.error).toMatchObject({
        code: -32601,
        message: "Method not found",
      });
    });
  });

  describe("graceful shutdown", () => {
    it("exits cleanly on stdin EOF with code 0", async () => {
      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0.0.1" },
        },
      });

      const { exitCode } = await spawnServer(initRequest + "\n");
      expect(exitCode).toBe(0);
    });

    it("exits cleanly with no input", async () => {
      const { exitCode } = await spawnServer("");
      expect(exitCode).toBe(0);
    });
  });
});
