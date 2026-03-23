import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CredentialStore } from "@shuvdex/credential-store";
import type { RedactedCredentialRecord } from "@shuvdex/credential-store";
import { handleError } from "../middleware/error-handler.js";

function redacted(record: RedactedCredentialRecord) {
  return record;
}

export function credentialsRouter(runtime: Runtime.Runtime<CredentialStore>): Hono {
  const run = Runtime.runPromise(runtime);
  const app = new Hono();

  app.get("/", async (c) => {
    try {
      const credentials = await run(
        Effect.gen(function* () {
          const store = yield* CredentialStore;
          return yield* store.listCredentials();
        }),
      );
      return c.json(credentials.map(redacted));
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const credential = await run(
        Effect.gen(function* () {
          const store = yield* CredentialStore;
          return yield* store.upsertCredential({
            credentialId: String(body["credentialId"] ?? ""),
            scheme: body["scheme"] as never,
            description: typeof body["description"] === "string" ? body["description"] : undefined,
            sourceId: typeof body["sourceId"] === "string" ? body["sourceId"] : undefined,
            packageId: typeof body["packageId"] === "string" ? body["packageId"] : undefined,
          });
        }),
      );
      return c.json({
        credentialId: credential.credentialId,
        description: credential.description,
        sourceId: credential.sourceId,
        packageId: credential.packageId,
        schemeType: credential.scheme.type,
        createdAt: credential.createdAt,
        updatedAt: credential.updatedAt,
      }, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/:credentialId", async (c) => {
    const credentialId = c.req.param("credentialId");
    try {
      await run(
        Effect.gen(function* () {
          const store = yield* CredentialStore;
          yield* store.deleteCredential(credentialId);
        }),
      );
      return c.json({ deleted: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
