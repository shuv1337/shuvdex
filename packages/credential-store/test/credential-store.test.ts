import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { makeCredentialStoreLive, CredentialStore } from "../src/index.js";

describe("CredentialStore", () => {
  it("encrypts persisted credentials and resolves auth material", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "credential-store-test-"));
    const layer = makeCredentialStoreLive({ rootDir, keyPath: path.join(rootDir, ".key") });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* CredentialStore;
        yield* store.upsertCredential({
          credentialId: "cred-1",
          scheme: { type: "bearer", token: "super-secret-token" },
          description: "Test credential",
        });
        const listed = yield* store.listCredentials();
        const auth = yield* store.resolveAuthMaterial("cred-1");
        return { listed, auth };
      }).pipe(Effect.provide(layer)),
    );

    const savedFiles = fs.readdirSync(rootDir).filter((file) => file.endsWith(".enc"));
    expect(savedFiles).toHaveLength(1);
    const persisted = fs.readFileSync(path.join(rootDir, savedFiles[0]!), "utf-8");
    expect(persisted).not.toContain("super-secret-token");
    expect(result.listed[0]?.schemeType).toBe("bearer");
    expect(result.auth.headers?.Authorization).toBe("Bearer super-secret-token");

    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
