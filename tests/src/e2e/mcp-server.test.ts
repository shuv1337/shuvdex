/**
 * E2E tests for the live shuvdex MCP server.
 *
 * These tests hit the running MCP server at http://shuvdev:3848 via HTTP,
 * exercising the full stack: HTTP transport → MCP protocol → capability
 * registry → policy engine → execution providers → tool executors.
 *
 * Prerequisites:
 *   - shuvdex-mcp.service running on shuvdev:3848
 *   - Capabilities seeded (.capabilities/packages/)
 *
 * Run with:
 *   npx vitest run tests/src/e2e/mcp-server.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";

// ---------------------------------------------------------------------------
// MCP HTTP Client Helpers
// ---------------------------------------------------------------------------

const MCP_URL = process.env["MCP_URL"] ?? "http://shuvdev:3848/mcp";
const HEALTH_URL = process.env["HEALTH_URL"] ?? "http://shuvdev:3848/health";

/** Send a JSON-RPC request to the MCP server and return the parsed response. */
async function mcpRequest(
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<{ sessionId: string; body: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["mcp-session-id"] = sessionId;
  }

  const res = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const returnedSessionId =
    res.headers.get("mcp-session-id") ?? sessionId ?? "";

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    // SSE — collect the last JSON event
    const text = await res.text();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice(6));
    const lastEvent = events[events.length - 1];
    return {
      sessionId: returnedSessionId,
      body: lastEvent ? JSON.parse(lastEvent) : {},
    };
  }

  const body = (await res.json()) as Record<string, unknown>;
  return { sessionId: returnedSessionId, body };
}

/** Initialize a session and return the session ID. */
async function initSession(): Promise<string> {
  const { sessionId } = await mcpRequest("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "shuvdex-e2e-tests", version: "1.0.0" },
  });
  return sessionId;
}

/** List all available tools in the session. */
async function listTools(
  sessionId: string,
): Promise<{ name: string; description?: string }[]> {
  const { body } = await mcpRequest("tools/list", {}, sessionId);
  const result = body.result as { tools: { name: string; description?: string }[] } | undefined;
  return result?.tools ?? [];
}

/** Call a tool and return the result. */
async function callTool(
  sessionId: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}> {
  const { body } = await mcpRequest(
    "tools/call",
    { name, arguments: args },
    sessionId,
  );
  return body.result as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
}

/** Parse the JSON text from a tool call result. Returns raw text as { _raw } if not valid JSON. */
function parseToolResult(result: {
  content: { type: string; text: string }[];
  isError?: boolean;
}): Record<string, unknown> {
  const text = result.content?.[0]?.text;
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP Server E2E", () => {
  // --------------------------------------------------
  // Health check
  // --------------------------------------------------
  describe("health", () => {
    it("returns healthy status", async () => {
      const res = await fetch(HEALTH_URL);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.service).toBe("shuvdex-mcp-server");
      expect(typeof body.packageCount).toBe("number");
      expect((body.packageCount as number)).toBeGreaterThanOrEqual(5);
    });
  });

  // --------------------------------------------------
  // Session lifecycle
  // --------------------------------------------------
  describe("session", () => {
    it("initializes and returns a session ID", async () => {
      const sessionId = await initSession();
      expect(sessionId).toBeTruthy();
      expect(typeof sessionId).toBe("string");
    });
  });

  // --------------------------------------------------
  // Tool discovery
  // --------------------------------------------------
  describe("tools/list", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("returns a non-empty list of tools", async () => {
      const tools = await listTools(sessionId);
      expect(tools.length).toBeGreaterThanOrEqual(5);
    });

    it("includes the echo tool", async () => {
      const tools = await listTools(sessionId);
      const echo = tools.find(
        (t) => t.name === "skill.module_runtime_template.echo",
      );
      expect(echo).toBeDefined();
      expect(echo!.description).toBeTruthy();
    });

    it("includes OpenAPI tools", async () => {
      const tools = await listTools(sessionId);
      const gitea = tools.find(
        (t) => t.name === "openapi.gitea.api.getVersion",
      );
      expect(gitea).toBeDefined();
    });

    it("includes the new phase-4 capability tools", async () => {
      const tools = await listTools(sessionId);
      const names = tools.map((t) => t.name);
      expect(names).toContain("skill.upload.file");
      expect(names).toContain("skill.model_usage.query");
      expect(names).toContain("skill.ccusage.aggregate");
    });
  });

  // --------------------------------------------------
  // Echo tool (module_runtime executor)
  // --------------------------------------------------
  describe("skill.module_runtime_template.echo", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("echoes a message back", async () => {
      const result = await callTool(sessionId, "skill.module_runtime_template.echo", {
        message: "e2e test message",
      });
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.echoed).toBe("e2e test message");
    });

    it("returns error for missing message", async () => {
      const result = await callTool(sessionId, "skill.module_runtime_template.echo", {});
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(payload.error ?? payload._raw).toBeTruthy();
    });

    it("handles special characters", async () => {
      const msg = 'hello "world" & <test> 🚀';
      const result = await callTool(sessionId, "skill.module_runtime_template.echo", {
        message: msg,
      });
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.echoed).toBe(msg);
    });
  });

  // --------------------------------------------------
  // Upload tool (module_runtime executor)
  // --------------------------------------------------
  describe("skill.upload.file", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("uploads base64 content", async () => {
      const content = Buffer.from("e2e upload test " + Date.now()).toString("base64");
      const filename = `e2e-test-${Date.now()}.txt`;
      const result = await callTool(sessionId, "skill.upload.file", {
        contentBase64: content,
        filename,
      });
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.url).toBe(`https://files.shuv.me/${filename}`);
      expect(payload.filename).toBe(filename);
      expect(typeof payload.bytes).toBe("number");
      expect(typeof payload.durationMs).toBe("number");

      // Clean up — remove the test file
      try {
        const { execSync } = await import("node:child_process");
        execSync(`ssh vps rm -f ~/repos/ltc-files/data/upload/${filename}`, { timeout: 5000 });
      } catch { /* best effort cleanup */ }
    });

    it("rejects missing filename", async () => {
      const result = await callTool(sessionId, "skill.upload.file", {
        contentBase64: Buffer.from("test").toString("base64"),
      });
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(payload.error ?? payload._raw).toBeTruthy();
    });

    it("rejects path traversal in filename", async () => {
      const result = await callTool(sessionId, "skill.upload.file", {
        contentBase64: Buffer.from("test").toString("base64"),
        filename: "../../../etc/passwd",
      });
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(String(payload.error)).toMatch(/invalid|path|filename/i);
    });

    it("rejects missing content source", async () => {
      const result = await callTool(sessionId, "skill.upload.file", {
        filename: "test.txt",
      });
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(payload.error).toBeTruthy();
    });
  });

  // --------------------------------------------------
  // Model Usage tool (module_runtime executor)
  // --------------------------------------------------
  describe("skill.model_usage.query", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("returns a structured response (even if codexbar is missing)", async () => {
      const result = await callTool(sessionId, "skill.model_usage.query", {
        provider: "codex",
        mode: "summary",
      });
      // May succeed or fail depending on codexbar availability
      const payload = parseToolResult(result);
      expect(payload.capability).toBe("skill.model_usage.query");
      if (result.isError) {
        expect(typeof payload.error).toBe("string");
      } else {
        expect(payload.provider).toBe("codex");
        expect(payload.mode).toBe("summary");
      }
    });

    it("rejects invalid provider", async () => {
      const result = await callTool(sessionId, "skill.model_usage.query", {
        provider: "invalid_provider",
        mode: "all",
      });
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(String(payload.error)).toMatch(/invalid/i);
    });

    it("rejects invalid mode", async () => {
      const result = await callTool(sessionId, "skill.model_usage.query", {
        provider: "codex",
        mode: "invalid_mode",
      });
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(String(payload.error)).toMatch(/invalid/i);
    });
  });

  // --------------------------------------------------
  // CCUsage tool (module_runtime executor)
  // --------------------------------------------------
  describe("skill.ccusage.aggregate", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("returns a summary with duration", async () => {
      const result = await callTool(sessionId, "skill.ccusage.aggregate", {
        days: 7,
        mode: "summary",
      });
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.period).toBe("last 7 days");
      expect(typeof payload.totalCost).toBe("number");
      expect(typeof payload.durationMs).toBe("number");
      expect(payload.capability).toBe("skill.ccusage.aggregate");
      expect(Array.isArray(payload.sources)).toBe(true);
    });

    it("returns all-time data when days is 0", async () => {
      const result = await callTool(sessionId, "skill.ccusage.aggregate", {
        days: 0,
        mode: "summary",
      });
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.period).toBe("all time");
    });

    it("supports models mode", async () => {
      const result = await callTool(sessionId, "skill.ccusage.aggregate", {
        days: 30,
        mode: "models",
      });
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(Array.isArray(payload.models)).toBe(true);
    });

    it("rejects invalid mode", async () => {
      const result = await callTool(sessionId, "skill.ccusage.aggregate", {
        mode: "invalid",
      });
      expect(result.isError).toBe(true);
      const payload = parseToolResult(result);
      expect(String(payload.error)).toMatch(/invalid/i);
    });
  });

  // --------------------------------------------------
  // Gitea OpenAPI tool (http_api executor)
  // --------------------------------------------------
  describe("openapi.gitea.api.getVersion", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("returns the Gitea version", async () => {
      const result = await callTool(sessionId, "openapi.gitea.api.getVersion");
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.status).toBe(200);
      const data = payload.data as Record<string, unknown>;
      expect(typeof data.version).toBe("string");
      expect((data.version as string).length).toBeGreaterThan(0);
    });
  });

  // --------------------------------------------------
  // DNSFilter OpenAPI tool (http_api executor, authenticated)
  // --------------------------------------------------
  describe("openapi.dnsfilter.api.currentUser", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("returns a user response with status 200", async () => {
      const result = await callTool(
        sessionId,
        "openapi.dnsfilter.api.currentUser",
      );
      expect(result.isError).toBeFalsy();
      const payload = parseToolResult(result);
      expect(payload.status).toBe(200);
      const data = payload.data as Record<string, unknown>;
      expect(data).toBeTruthy();
    });
  });

  // --------------------------------------------------
  // Error handling and edge cases
  // --------------------------------------------------
  describe("error handling", () => {
    let sessionId: string;

    beforeAll(async () => {
      sessionId = await initSession();
    });

    it("returns error for non-existent tool", async () => {
      const { body } = await mcpRequest(
        "tools/call",
        { name: "nonexistent.tool", arguments: {} },
        sessionId,
      );
      // Server may return JSON-RPC error or an isError result
      const result = body.result as { isError?: boolean; content?: { text: string }[] } | undefined;
      const hasError = body.error != null || result?.isError === true ||
        (result?.content?.[0]?.text ?? "").toLowerCase().includes("error");
      expect(hasError).toBe(true);
    });

    it("returns error for invalid session ID", async () => {
      const res = await fetch(MCP_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "mcp-session-id": "invalid-session-id-that-does-not-exist",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        }),
      });
      // Should reject with 4xx
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  // --------------------------------------------------
  // Audit trail verification
  // --------------------------------------------------
  describe("audit trail", () => {
    it("records tool calls in the audit log", async () => {
      const sessionId = await initSession();

      // Make a tool call
      await callTool(sessionId, "skill.module_runtime_template.echo", {
        message: "audit trail test",
      });

      // Check audit via the API
      const auditRes = await fetch("http://shuvdev:3847/api/audit?limit=5", {
        headers: { "Content-Type": "application/json" },
      });
      expect(auditRes.status).toBe(200);
      const auditBody = (await auditRes.json()) as {
        events: { action: string; target?: { id?: string } }[];
      };
      expect(auditBody.events.length).toBeGreaterThan(0);

      // Find our echo call in recent events
      const echoEvent = auditBody.events.find(
        (e) =>
          e.action === "tool_call" &&
          e.target?.id === "skill.module_runtime_template.echo",
      );
      expect(echoEvent).toBeDefined();
    });
  });
});
