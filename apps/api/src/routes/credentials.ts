import { Hono } from "hono";
import { Effect, Runtime } from "effect";
import { CredentialStore } from "@shuvdex/credential-store";
import type { CredentialBinding, RedactedCredentialRecord } from "@shuvdex/credential-store";
import { randomBytes } from "node:crypto";
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

  // ---------------------------------------------------------------------------
  // Credential Binding routes — /api/credentials/bindings
  // ---------------------------------------------------------------------------

  app.get("/bindings", async (c) => {
    try {
      const bindings = await run(
        Effect.gen(function* () {
          const store = yield* CredentialStore;
          return yield* store.listBindings();
        }),
      );
      return c.json(bindings);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.post("/bindings", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

      if (!body["credentialId"] || typeof body["credentialId"] !== "string") {
        return c.json({ error: "credentialId is required" }, 400);
      }
      if (
        !body["credentialType"] ||
        ![
          "api_key",
          "oauth_client_credentials",
          "oauth_authorization_code",
          "bearer",
          "service_account",
        ].includes(body["credentialType"] as string)
      ) {
        return c.json(
          {
            error:
              "credentialType must be one of: api_key, oauth_client_credentials, oauth_authorization_code, bearer, service_account",
          },
          400,
        );
      }

      const now = new Date().toISOString();
      const bindingId =
        typeof body["bindingId"] === "string" && body["bindingId"]
          ? body["bindingId"]
          : `binding_${randomBytes(8).toString("hex")}`;

      const rotation =
        typeof body["rotation"] === "object" && body["rotation"] !== null
          ? (body["rotation"] as CredentialBinding["rotation"])
          : undefined;

      const binding: CredentialBinding = {
        bindingId,
        tenantId: typeof body["tenantId"] === "string" ? body["tenantId"] : undefined,
        environmentId:
          typeof body["environmentId"] === "string" ? body["environmentId"] : undefined,
        credentialId: body["credentialId"] as string,
        credentialType: body["credentialType"] as CredentialBinding["credentialType"],
        allowedPackages: Array.isArray(body["allowedPackages"])
          ? (body["allowedPackages"] as string[])
          : undefined,
        allowedCapabilities: Array.isArray(body["allowedCapabilities"])
          ? (body["allowedCapabilities"] as string[])
          : undefined,
        scopes: Array.isArray(body["scopes"]) ? (body["scopes"] as string[]) : undefined,
        rotation,
        createdAt: now,
        updatedAt: now,
      };

      const created = await run(
        Effect.gen(function* () {
          const store = yield* CredentialStore;
          return yield* store.upsertBinding(binding);
        }),
      );
      return c.json(created, 201);
    } catch (error) {
      return handleError(c, error);
    }
  });

  app.delete("/bindings/:bindingId", async (c) => {
    const bindingId = c.req.param("bindingId");
    try {
      await run(
        Effect.gen(function* () {
          const store = yield* CredentialStore;
          yield* store.deleteBinding(bindingId);
        }),
      );
      return c.json({ deleted: true });
    } catch (error) {
      return handleError(c, error);
    }
  });

  return app;
}
