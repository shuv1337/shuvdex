import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Effect, Either } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadConfig } from "../src/config-loader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shuvdex-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeYaml(filename: string, content: string): string {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("loadConfig", () => {
  describe("missing config file", () => {
    it("returns ConfigNotFound for nonexistent file", async () => {
      const result = await Effect.runPromise(
        loadConfig("/nonexistent/path/config.yaml").pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ConfigNotFound");
        expect(result.left.path).toBe("/nonexistent/path/config.yaml");
      }
    });
  });

  describe("invalid YAML", () => {
    it("returns ConfigParseError for malformed YAML", async () => {
      const filePath = writeYaml("bad.yaml", ":\n  :\n  : invalid: [");
      const result = await Effect.runPromise(
        loadConfig(filePath).pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        // YAML parser may or may not throw on all malformed input;
        // some malformed input may parse to unexpected structures
        // which would be caught by validation
        expect(
          result.left._tag === "ConfigParseError" ||
            result.left._tag === "ConfigValidationError",
        ).toBe(true);
      }
    });
  });

  describe("missing hosts key", () => {
    it("returns ConfigValidationError for YAML without hosts key", async () => {
      const filePath = writeYaml(
        "no-hosts.yaml",
        "settings:\n  debug: true\n",
      );
      const result = await Effect.runPromise(
        loadConfig(filePath).pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ConfigValidationError");
      }
    });
  });

  describe("invalid host entries", () => {
    it("returns ConfigValidationError for host missing hostname", async () => {
      const filePath = writeYaml(
        "missing-hostname.yaml",
        `hosts:
  shuvtest:
    port: 22
`,
      );
      const result = await Effect.runPromise(
        loadConfig(filePath).pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ConfigValidationError");
        expect(result.left.issues).toContain("shuvtest");
      }
    });

    it("returns ConfigValidationError for invalid port", async () => {
      const filePath = writeYaml(
        "bad-port.yaml",
        `hosts:
  shuvtest:
    hostname: shuvtest
    port: 99999
`,
      );
      const result = await Effect.runPromise(
        loadConfig(filePath).pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ConfigValidationError");
      }
    });

    it("returns ConfigValidationError for invalid connectionType", async () => {
      const filePath = writeYaml(
        "bad-conn.yaml",
        `hosts:
  shuvtest:
    hostname: shuvtest
    connectionType: ftp
`,
      );
      const result = await Effect.runPromise(
        loadConfig(filePath).pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ConfigValidationError");
      }
    });

    it("includes field path in validation error", async () => {
      const filePath = writeYaml(
        "bad-field.yaml",
        `hosts:
  myhost:
    hostname: 123
`,
      );
      const result = await Effect.runPromise(
        loadConfig(filePath).pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("ConfigValidationError");
        expect(result.left.issues).toContain("myhost");
      }
    });
  });

  describe("valid configurations", () => {
    it("loads minimal config with one host", async () => {
      const filePath = writeYaml(
        "minimal.yaml",
        `hosts:
  shuvtest:
    hostname: shuvtest
`,
      );
      const registry = await Effect.runPromise(loadConfig(filePath));

      expect(registry.size).toBe(1);
      expect(registry.hasHost("shuvtest")).toBe(true);

      const host = await Effect.runPromise(registry.getHost("shuvtest"));
      expect(host.hostname).toBe("shuvtest");
      expect(host.port).toBe(22);
      expect(host.connectionType).toBe("ssh");
      expect(host.timeout).toBe(30);
    });

    it("loads config with multiple hosts", async () => {
      const filePath = writeYaml(
        "multi.yaml",
        `hosts:
  shuvtest:
    hostname: shuvtest
    user: shuv
  shuvbot:
    hostname: shuvbot
    port: 2222
    user: shuv
    keyPath: /home/shuv/.ssh/id_ed25519
  localhost:
    hostname: localhost
    connectionType: local
`,
      );
      const registry = await Effect.runPromise(loadConfig(filePath));

      expect(registry.size).toBe(3);

      const hosts = registry.getAllHosts();
      const names = hosts.map(([name]) => name);
      expect(names).toContain("shuvtest");
      expect(names).toContain("shuvbot");
      expect(names).toContain("localhost");
    });

    it("applies default values correctly", async () => {
      const filePath = writeYaml(
        "defaults.yaml",
        `hosts:
  myhost:
    hostname: myhost.example.com
`,
      );
      const registry = await Effect.runPromise(loadConfig(filePath));
      const host = await Effect.runPromise(registry.getHost("myhost"));

      expect(host.connectionType).toBe("ssh");
      expect(host.port).toBe(22);
      expect(host.timeout).toBe(30);
      expect(host.user).toBeUndefined();
      expect(host.keyPath).toBeUndefined();
    });

    it("preserves explicit values over defaults", async () => {
      const filePath = writeYaml(
        "explicit.yaml",
        `hosts:
  custom:
    hostname: custom.example.com
    connectionType: local
    port: 2222
    user: admin
    keyPath: /root/.ssh/id_rsa
    timeout: 120
`,
      );
      const registry = await Effect.runPromise(loadConfig(filePath));
      const host = await Effect.runPromise(registry.getHost("custom"));

      expect(host.hostname).toBe("custom.example.com");
      expect(host.connectionType).toBe("local");
      expect(host.port).toBe(2222);
      expect(host.user).toBe("admin");
      expect(host.keyPath).toBe("/root/.ssh/id_rsa");
      expect(host.timeout).toBe(120);
    });

    it("handles empty hosts map", async () => {
      const filePath = writeYaml(
        "empty-hosts.yaml",
        `hosts: {}
`,
      );
      const registry = await Effect.runPromise(loadConfig(filePath));
      expect(registry.size).toBe(0);
      expect(registry.getAllHosts()).toEqual([]);
    });
  });
});
