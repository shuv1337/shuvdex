import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { makeHttpExecutorLive, HttpExecutor } from "../src/index.js";
import { makeCredentialStoreLive, CredentialStore } from "@shuvdex/credential-store";

describe("HttpExecutor", () => {
  let server: ReturnType<typeof createServer>;
  let baseUrl = "";
  let requests: Array<{ method?: string; url?: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];

  beforeEach(async () => {
    requests = [];
    server = createServer((req, res) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        requests.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.setHeader("content-type", "application/json");
        res.setHeader("set-cookie", "secret=1");
        res.end(JSON.stringify({ ok: true, echoUrl: req.url, echoBody: body }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it("executes http_api requests with nested args and credential injection", async () => {
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "http-executor-creds-"));
    const credentialLayer = makeCredentialStoreLive({
      rootDir: credsDir,
      keyPath: path.join(credsDir, ".key"),
    });
    const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* CredentialStore;
        yield* store.upsertCredential({
          credentialId: "cred-1",
          description: "fixture",
          scheme: { type: "api_key", in: "header", name: "x-api-key", value: "secret-key" },
        });

        const http = yield* HttpExecutor;
        return yield* http.executeHttp(
          {
            id: "openapi.test.getThing",
            packageId: "openapi.test",
            version: "1.0.0",
            kind: "tool",
            title: "Get thing",
            description: "Get thing",
            enabled: true,
            visibility: "public",
            executorRef: {
              executorType: "http_api",
              timeoutMs: 5_000,
              credentialId: "cred-1",
              httpBinding: {
                method: "post",
                baseUrl,
                pathTemplate: "/items/{id}",
                requestBody: { contentType: "application/json" },
              },
            },
            tool: { inputSchema: { type: "object" }, outputSchema: { type: "object" }, sideEffectLevel: "write" },
          },
          {
            path: { id: "abc 123" },
            query: { page: 2, filter: { state: "open" } },
            headers: { "x-trace-id": "trace-1" },
            cookies: { session: "cookie-1" },
            body: { hello: "world" },
          },
        );
      }).pipe(Effect.provide(Layer.mergeAll(credentialLayer, httpLayer))),
    );

    fs.rmSync(credsDir, { recursive: true, force: true });

    expect(result.isError).toBe(false);
    expect(result.payload.status).toBe(200);
    expect(result.payload.headers["set-cookie"]).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/items/abc%20123");
    expect(requests[0]?.url).toContain("page=2");
    expect(requests[0]?.url).toContain("filter%5Bstate%5D=open");
    expect(requests[0]?.headers["x-api-key"]).toBe("secret-key");
    expect(requests[0]?.headers["x-trace-id"]).toBe("trace-1");
    expect(String(requests[0]?.headers["cookie"])).toContain("session=cookie-1");
    expect(JSON.parse(requests[0]?.body ?? "{}")).toEqual({ hello: "world" });
  });
});
