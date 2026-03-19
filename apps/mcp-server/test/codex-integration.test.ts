/**
 * Codex Desktop integration tests for the centralized capability gateway.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const CODEX_CONFIG_PATH = resolve(PROJECT_ROOT, ".codex/config.toml");
const SERVER_ENTRY = resolve(PROJECT_ROOT, "apps/mcp-server/dist/index.js");

const tempDirs: string[] = [];

function parseCodexFleetConfig(toml: string): {
  command?: string;
  args?: string[];
} {
  const lines = toml.split("\n");
  let inSection = false;
  let command: string | undefined;
  let args: string[] | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed === "[mcp_servers.codex_fleet]";
      continue;
    }
    if (!inSection) continue;

    const cmdMatch = trimmed.match(/^command\s*=\s*"([^"]+)"/);
    if (cmdMatch) {
      command = cmdMatch[1];
      continue;
    }

    const argsMatch = trimmed.match(/^args\s*=\s*\[(.+)\]/);
    if (argsMatch) {
      args = argsMatch[1]
        .split(",")
        .map((segment) => segment.trim().replace(/^"|"$/g, ""));
    }
  }

  return { command, args };
}

function makeServerEnv(): NodeJS.ProcessEnv {
  const baseDir = mkdtempSync(resolve(tmpdir(), "codex-fleet-codex-"));
  tempDirs.push(baseDir);
  return {
    ...process.env,
    CAPABILITIES_DIR: resolve(baseDir, "packages"),
    POLICY_DIR: resolve(baseDir, "policy"),
  };
}

function spawnFromCodexConfig(
  command: string,
  args: string[],
  input: string,
  timeoutMs = 8000,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: PROJECT_ROOT,
      env: makeServerEnv(),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error("Server did not exit within timeout"));
      }
    }, timeoutMs);

    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise({ stdout, stderr, exitCode: code });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
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

describe("Codex Desktop integration discovery", () => {
  describe("config path", () => {
    it(".codex/config.toml exists in project root", () => {
      expect(existsSync(CODEX_CONFIG_PATH)).toBe(true);
    });

    it("config contains [mcp_servers.codex_fleet] section", () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      expect(content).toContain("[mcp_servers.codex_fleet]");
    });

    it("config specifies command and args for the stdio server", () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      expect(config.command).toBe("node");
      expect(config.args).toBeDefined();
      expect(config.args!.length).toBeGreaterThan(0);
      expect(config.args![0]).toContain("mcp-server");
    });

    it("referenced server entry point exists as a built artifact", () => {
      expect(existsSync(SERVER_ENTRY)).toBe(true);
    });
  });

  describe("server launch from config", () => {
    it("server starts and responds to initialize within 5 seconds", { timeout: 10000 }, async () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      const initRequest = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "codex-desktop", version: "1.0.0" },
        },
      });

      const { stdout, exitCode } = await spawnFromCodexConfig(
        config.command!,
        config.args!,
        initRequest + "\n",
        5000,
      );

      const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
      const response = JSON.parse(lines[0] ?? "");

      expect(lines.length).toBeGreaterThan(0);
      expect(response.id).toBe(1);
      expect(response.result.serverInfo.name).toBe("codex-fleet");
      expect(exitCode).toBe(0);
    });
  });

  describe("tools visible after initialization", () => {
    it("full Codex init sequence reports no tools/list method for an isolated empty server", { timeout: 10000 }, async () => {
      const content = readFileSync(CODEX_CONFIG_PATH, "utf-8");
      const config = parseCodexFleetConfig(content);

      const messages = [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "codex-desktop", version: "1.0.0" },
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

      const { stdout } = await spawnFromCodexConfig(
        config.command!,
        config.args!,
        messages.join("\n") + "\n",
        5000,
      );

      const toolsResponse = findMessageById(stdout, 2);

      expect(toolsResponse).toBeDefined();
      expect(toolsResponse?.error).toMatchObject({
        code: -32601,
        message: "Method not found",
      });
    });
  });
});
