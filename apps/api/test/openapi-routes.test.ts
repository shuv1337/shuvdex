import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createServer } from "node:http";
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

describe("openapi + credential routes", () => {
  it("creates credentials and manages openapi source lifecycle", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "openapi-routes-"));
    const upstream = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      if ((req.headers["x-api-key"] as string | undefined) === "top-secret") {
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.statusCode = 401;
        res.end(JSON.stringify({ ok: false }));
      }
    });
    await new Promise<void>((resolve) => upstream.listen(0, resolve));
    const upstreamPort = (upstream.address() as import("node:net").AddressInfo).port;

    const specPath = path.join(rootDir, "fixture-openapi.json");
    fs.writeFileSync(specPath, JSON.stringify({
      openapi: "3.1.0",
      info: { title: "Fixture API", version: "1.0.0" },
      servers: [{ url: `http://127.0.0.1:${upstreamPort}` }],
      paths: {
        "/items/{id}": {
          get: {
            operationId: "getItem",
            summary: "Get item",
            parameters: [
              { name: "id", in: "path", required: true, schema: { type: "string" } },
              { name: "page", in: "query", schema: { type: "integer" } }
            ],
            responses: { "200": { description: "ok" } }
          }
        }
      }
    }, null, 2));

    const { app, managed } = await makeApp(rootDir);
    try {
      const credRes = await app.request("http://localhost/api/credentials", {
        method: "POST",
        body: JSON.stringify({
          credentialId: "fixture-cred",
          scheme: { type: "api_key", in: "header", name: "x-api-key", value: "top-secret" },
          description: "fixture",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(credRes.status).toBe(201);

      const inspectRes = await app.request("http://localhost/api/sources/openapi/inspect", {
        method: "POST",
        body: JSON.stringify({
          specUrl: specPath,
          title: "Fixture API",
          selectedServerUrl: `http://127.0.0.1:${upstreamPort}`,
          credentialId: "fixture-cred",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(inspectRes.status).toBe(200);
      const inspect = await inspectRes.json();
      expect(inspect.includedOperations).toBe(1);

      const createRes = await app.request("http://localhost/api/sources/openapi", {
        method: "POST",
        body: JSON.stringify({
          specUrl: specPath,
          title: "Fixture API",
          selectedServerUrl: `http://127.0.0.1:${upstreamPort}`,
          credentialId: "fixture-cred",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(createRes.status).toBe(201);
      const created = await createRes.json();
      expect(created.record.packageId).toBe("openapi.fixture.api");

      const listRes = await app.request("http://localhost/api/sources/openapi");
      expect(listRes.status).toBe(200);
      const list = await listRes.json();
      expect(list).toHaveLength(1);

      const sourceId = created.record.sourceId;
      const refreshRes = await app.request(`http://localhost/api/sources/openapi/${sourceId}/refresh`, { method: "POST" });
      expect(refreshRes.status).toBe(200);
      const testAuthRes = await app.request(`http://localhost/api/sources/openapi/${sourceId}/test-auth`, { method: "POST" });
      expect(testAuthRes.status).toBe(200);
      const testAuth = await testAuthRes.json();
      expect(testAuth.ok).toBe(true);
      expect(testAuth.status).toBe(200);

      const deleteRes = await app.request(`http://localhost/api/sources/openapi/${sourceId}`, { method: "DELETE" });
      expect(deleteRes.status).toBe(200);
    } finally {
      await managed.dispose();
      await new Promise<void>((resolve, reject) => upstream.close((err) => err ? reject(err) : resolve()));
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
