import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Layer, ManagedRuntime, Runtime } from "effect";
import { makeCapabilityRegistryLive } from "@shuvdex/capability-registry";
import { makeCredentialStoreLive } from "@shuvdex/credential-store";
import { makeHttpExecutorLive } from "@shuvdex/http-executor";
import { makeOpenApiSourceLive } from "@shuvdex/openapi-source";
import { credentialsRouter } from "../src/routes/credentials.js";
import { openapiSourcesRouter } from "../src/routes/openapi-sources.js";

function makeApp(rootDir: string) {
  const packagesDir = path.join(rootDir, "packages");
  const capabilitiesRoot = rootDir;
  const registryLayer = makeCapabilityRegistryLive(packagesDir);
  const credentialLayer = makeCredentialStoreLive({ rootDir: path.join(rootDir, "credentials"), keyPath: path.join(rootDir, ".credential-key") });
  const httpLayer = Layer.provide(makeHttpExecutorLive(), credentialLayer);
  const liveLayer = Layer.mergeAll(
    registryLayer,
    credentialLayer,
    httpLayer,
    Layer.provide(makeOpenApiSourceLive({ rootDir: capabilitiesRoot }), Layer.mergeAll(registryLayer, credentialLayer, httpLayer)),
  );
  const managed = ManagedRuntime.make(liveLayer);
  return managed.runtime().then((runtime) => {
    const app = new Hono();
    app.route("/api/credentials", credentialsRouter(runtime as Runtime.Runtime<never>));
    app.route("/api/sources/openapi", openapiSourcesRouter(runtime as Runtime.Runtime<never>));
    return { app, managed };
  });
}

describe("dnsfilter authenticated openapi routes", () => {
  it("compiles and probes an authenticated current-user capability", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "dnsfilter-openapi-routes-"));
    const specPath = path.join(rootDir, "dnsfilter-openapi.json");
    fs.writeFileSync(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "DNSFilter API", version: "1.0.0" },
      servers: [{ url: "https://api.dnsfilter.test" }],
      paths: {
        "/v1/current_user": {
          get: {
            operationId: "currentUser",
            summary: "Current user",
            security: [{ header_authorization: [] }],
            responses: {
              "200": { description: "ok" },
            },
          },
        },
      },
    }, null, 2));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://api.dnsfilter.test/v1/current_user") {
        const auth = new Headers(init?.headers).get("authorization");
        if (auth === "secret-jwt") {
          return new Response(JSON.stringify({ id: 344479, email: "kyle@latitudes.io" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input as never, init);
    };

    const { app, managed } = await makeApp(rootDir);
    try {
      const credRes = await app.request("http://localhost/api/credentials", {
        method: "POST",
        body: JSON.stringify({
          credentialId: "dnsfilter-api-key",
          scheme: { type: "custom_headers", headers: { Authorization: "secret-jwt" } },
          description: "dnsfilter test credential",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(credRes.status).toBe(201);

      const createRes = await app.request("http://localhost/api/sources/openapi", {
        method: "POST",
        body: JSON.stringify({
          sourceId: "openapi.dnsfilter.api.source",
          specUrl: specPath,
          title: "DNSFilter API",
          selectedServerUrl: "https://api.dnsfilter.test",
          credentialId: "dnsfilter-api-key",
          operationFilter: {
            includeMethodsOnly: ["GET"],
            includePathPrefixes: ["/v1/current_user"],
          },
        }),
        headers: { "content-type": "application/json" },
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.record.packageId).toBe("openapi.dnsfilter.api");
      expect(created.package.capabilities).toHaveLength(1);
      expect(created.package.capabilities[0].id).toBe("openapi.dnsfilter.api.currentUser");

      const testAuthRes = await app.request("http://localhost/api/sources/openapi/openapi.dnsfilter.api.source/test-auth", {
        method: "POST",
      });
      expect(testAuthRes.status).toBe(200);
      const testAuth = await testAuthRes.json();
      expect(testAuth.ok).toBe(true);
      expect(testAuth.status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
      await managed.dispose();
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
