import { describe, it, expect } from "vitest";
import { Schema, Effect, Either } from "effect";
import { HostConfig, ConnectionType } from "../src/schema.js";

describe("ConnectionType", () => {
  it("accepts 'ssh'", () => {
    const result = Schema.decodeUnknownSync(ConnectionType)("ssh");
    expect(result).toBe("ssh");
  });

  it("accepts 'local'", () => {
    const result = Schema.decodeUnknownSync(ConnectionType)("local");
    expect(result).toBe("local");
  });

  it("rejects invalid connection types", () => {
    expect(() =>
      Schema.decodeUnknownSync(ConnectionType)("invalid"),
    ).toThrow();
  });
});

describe("HostConfig", () => {
  describe("valid configurations", () => {
    it("accepts minimal config with only hostname", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
      });
      expect(result.hostname).toBe("shuvtest");
    });

    it("applies default connectionType of 'ssh'", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
      });
      expect(result.connectionType).toBe("ssh");
    });

    it("applies default port of 22", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
      });
      expect(result.port).toBe(22);
    });

    it("applies default timeout of 30", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
      });
      expect(result.timeout).toBe(30);
    });

    it("leaves user undefined when not provided", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
      });
      expect(result.user).toBeUndefined();
    });

    it("leaves keyPath undefined when not provided", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
      });
      expect(result.keyPath).toBeUndefined();
    });

    it("accepts full configuration with all fields", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
        connectionType: "ssh",
        port: 2222,
        user: "shuv",
        keyPath: "/home/shuv/.ssh/id_ed25519",
        timeout: 60,
      });
      expect(result).toEqual({
        hostname: "shuvtest",
        connectionType: "ssh",
        port: 2222,
        user: "shuv",
        keyPath: "/home/shuv/.ssh/id_ed25519",
        timeout: 60,
      });
    });

    it("accepts connectionType 'local'", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "localhost",
        connectionType: "local",
      });
      expect(result.connectionType).toBe("local");
    });

    it("overrides default port", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
        port: 2222,
      });
      expect(result.port).toBe(2222);
    });

    it("overrides default timeout", () => {
      const result = Schema.decodeUnknownSync(HostConfig)({
        hostname: "shuvtest",
        timeout: 120,
      });
      expect(result.timeout).toBe(120);
    });
  });

  describe("validation errors", () => {
    it("rejects missing hostname", () => {
      expect(() => Schema.decodeUnknownSync(HostConfig)({})).toThrow();
    });

    it("rejects empty hostname", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({ hostname: "" }),
      ).toThrow();
    });

    it("rejects non-string hostname", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({ hostname: 123 }),
      ).toThrow();
    });

    it("rejects invalid connectionType", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          connectionType: "ftp",
        }),
      ).toThrow();
    });

    it("rejects port below 1", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          port: 0,
        }),
      ).toThrow();
    });

    it("rejects port above 65535", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          port: 70000,
        }),
      ).toThrow();
    });

    it("rejects non-integer port", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          port: 22.5,
        }),
      ).toThrow();
    });

    it("rejects negative timeout", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          timeout: -1,
        }),
      ).toThrow();
    });

    it("rejects zero timeout", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          timeout: 0,
        }),
      ).toThrow();
    });

    it("rejects empty user string", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          user: "",
        }),
      ).toThrow();
    });

    it("rejects empty keyPath string", () => {
      expect(() =>
        Schema.decodeUnknownSync(HostConfig)({
          hostname: "test",
          keyPath: "",
        }),
      ).toThrow();
    });

    it("provides field path in validation errors", () => {
      const result = Schema.decodeUnknownEither(HostConfig)({
        hostname: 123,
      });
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const message = result.left.message;
        expect(message).toContain("hostname");
      }
    });

    it("provides field path for invalid port", () => {
      const result = Schema.decodeUnknownEither(HostConfig)({
        hostname: "test",
        port: -1,
      });
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        const message = result.left.message;
        expect(message).toContain("port");
      }
    });
  });

  describe("Effect-based decoding", () => {
    it("succeeds with valid input", async () => {
      const result = await Effect.runPromise(
        Schema.decodeUnknown(HostConfig)({ hostname: "test" }),
      );
      expect(result.hostname).toBe("test");
      expect(result.port).toBe(22);
    });

    it("fails with ParseError for invalid input", async () => {
      const result = await Effect.runPromise(
        Schema.decodeUnknown(HostConfig)({}).pipe(Effect.either),
      );
      expect(Either.isLeft(result)).toBe(true);
    });
  });
});
