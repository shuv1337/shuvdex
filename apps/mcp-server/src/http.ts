import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import { createServer } from "./server.js";
import {
  loadServerRuntime,
  logEvent,
  type LoadedServerRuntime,
} from "./runtime.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const PORT = Number(process.env["MCP_PORT"] ?? process.env["PORT"] ?? 3848);
const HOST = process.env["MCP_HOST"] ?? "0.0.0.0";

async function main(): Promise<void> {
  const runtime = await loadServerRuntime();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
      maxAge: 600,
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "shuvdex-mcp-server",
      transport: "streamable-http",
      version: "0.0.0",
      host: HOST,
      port: PORT,
      capabilitiesDir: runtime.paths.capabilitiesDir,
      policyDir: runtime.paths.policyDir,
      localRepoPath: runtime.paths.localRepoPath,
      packageCount: runtime.packageCount,
      indexedArtifactCount: runtime.indexedArtifactCount,
      indexFailureCount: runtime.indexFailures.length,
      startupDurationMs: runtime.startupDurationMs,
    }),
  );

  app.all("/mcp", async (c) => {
    const requestId = randomUUID();
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = createServer(runtime.serverConfig);
    const startedAt = Date.now();

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(c.req.raw);

      logRequest({
        runtime,
        requestId,
        method: c.req.method,
        path: "/mcp",
        status: response.status,
        durationMs: Date.now() - startedAt,
      });

      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logRequest({
        runtime,
        requestId,
        method: c.req.method,
        path: "/mcp",
        status: 500,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
            data: { requestId, error: message },
          },
          id: null,
        },
        500,
      );
    } finally {
      await Promise.allSettled([transport.close(), server.close()]);
    }
  });

  app.notFound((c) =>
    c.json(
      {
        error: "Not found",
        service: "shuvdex-mcp-server",
      },
      404,
    ),
  );

  serve(
    {
      fetch: app.fetch,
      port: PORT,
      hostname: HOST,
    },
    (info) => {
      logEvent({
        event: "http.listening",
        host: HOST,
        port: info.port,
        mcpUrl: `http://${HOST}:${info.port}/mcp`,
        healthUrl: `http://${HOST}:${info.port}/health`,
        packageCount: runtime.packageCount,
      });
    },
  );

  const shutdown = async (signal: string): Promise<void> => {
    logEvent({ event: "http.shutdown", signal, host: HOST, port: PORT });
    await runtime.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

function logRequest(input: {
  runtime: LoadedServerRuntime;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  error?: string;
}): void {
  logEvent({
    event: input.error ? "http.request_error" : "http.request",
    requestId: input.requestId,
    method: input.method,
    path: input.path,
    status: input.status,
    durationMs: input.durationMs,
    packageCount: input.runtime.packageCount,
    indexedArtifactCount: input.runtime.indexedArtifactCount,
    ...(input.error ? { error: input.error } : {}),
  });
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logEvent({ event: "http.fatal", error: message });
  process.exit(1);
});
