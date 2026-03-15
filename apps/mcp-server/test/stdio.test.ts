/**
 * MCP Server stdio Transport Tests
 *
 * Tests for VAL-MCP-012 (stdio transport compliance) and
 * VAL-MCP-015 (graceful shutdown on EOF).
 *
 * These tests spawn the MCP server as a child process and verify
 * line-delimited JSON-RPC over stdio.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../dist/index.js");

/**
 * Helper: spawn the MCP server, send input, collect stdout lines.
 */
function spawnServer(
  input: string,
  timeoutMs = 5000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
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
      resolve({ stdout, stderr, exitCode: code });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    // Write input and close stdin to signal EOF
    child.stdin!.write(input);
    child.stdin!.end();
  });
}

describe("MCP stdio transport", () => {
  // --- VAL-MCP-012: stdio Transport Compliance ---

  describe("VAL-MCP-012: line-delimited JSON", () => {
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

      // Filter non-empty lines
      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      expect(lines.length).toBeGreaterThan(0);

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    });

    it("no non-JSON content on stdout", async () => {
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

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed).toHaveProperty("jsonrpc", "2.0");
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

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      const initResponse = JSON.parse(lines[0]);

      expect(initResponse.id).toBe(1);
      expect(initResponse.result).toBeDefined();
      expect(initResponse.result.protocolVersion).toBeDefined();
      expect(initResponse.result.capabilities).toBeDefined();
      expect(initResponse.result.serverInfo).toBeDefined();
      expect(initResponse.result.serverInfo.name).toBe("codex-fleet");
    });

    it("tools/list returns 7 tools over stdio", async () => {
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

      const { stdout } = await spawnServer(
        messages.join("\n") + "\n",
      );

      const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
      // Find the tools/list response (id: 2)
      const toolsResponse = lines
        .map((l) => JSON.parse(l))
        .find((msg: Record<string, unknown>) => msg.id === 2);

      expect(toolsResponse).toBeDefined();
      expect(toolsResponse.result.tools).toHaveLength(7);
    });
  });

  // --- VAL-MCP-015: Server Graceful Shutdown ---

  describe("VAL-MCP-015: graceful shutdown", () => {
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

    it("exits cleanly with no input (immediate EOF)", async () => {
      const { exitCode } = await spawnServer("");
      expect(exitCode).toBe(0);
    });
  });
});
