import { describe, it, expect } from "vitest";
import { Effect, Either } from "effect";
import { HostRegistry } from "../src/registry.js";
import type { HostConfig } from "../src/schema.js";

const makeConfig = (overrides: Partial<HostConfig> = {}): HostConfig => ({
  hostname: "test-host",
  connectionType: "ssh",
  port: 22,
  timeout: 30,
  ...overrides,
});

describe("HostRegistry", () => {
  describe("fromRecord", () => {
    it("creates registry from empty record", () => {
      const registry = HostRegistry.fromRecord({});
      expect(registry.size).toBe(0);
    });

    it("creates registry from single host", () => {
      const registry = HostRegistry.fromRecord({
        shuvtest: makeConfig({ hostname: "shuvtest" }),
      });
      expect(registry.size).toBe(1);
    });

    it("creates registry from multiple hosts", () => {
      const registry = HostRegistry.fromRecord({
        shuvtest: makeConfig({ hostname: "shuvtest" }),
        shuvbot: makeConfig({ hostname: "shuvbot" }),
        localhost: makeConfig({ hostname: "localhost", connectionType: "local" }),
      });
      expect(registry.size).toBe(3);
    });
  });

  describe("getAllHosts", () => {
    it("returns empty array for empty registry", () => {
      const registry = HostRegistry.fromRecord({});
      expect(registry.getAllHosts()).toEqual([]);
    });

    it("returns all hosts as [name, config] tuples", () => {
      const config1 = makeConfig({ hostname: "shuvtest" });
      const config2 = makeConfig({ hostname: "shuvbot" });
      const registry = HostRegistry.fromRecord({
        shuvtest: config1,
        shuvbot: config2,
      });

      const hosts = registry.getAllHosts();
      expect(hosts).toHaveLength(2);

      const names = hosts.map(([name]) => name);
      expect(names).toContain("shuvtest");
      expect(names).toContain("shuvbot");
    });

    it("preserves host configuration in returned tuples", () => {
      const config = makeConfig({
        hostname: "shuvtest",
        port: 2222,
        user: "shuv",
      });
      const registry = HostRegistry.fromRecord({ shuvtest: config });

      const hosts = registry.getAllHosts();
      const [name, returnedConfig] = hosts[0];
      expect(name).toBe("shuvtest");
      expect(returnedConfig).toEqual(config);
    });
  });

  describe("getHost", () => {
    it("returns config for existing host", async () => {
      const config = makeConfig({ hostname: "shuvtest", user: "shuv" });
      const registry = HostRegistry.fromRecord({ shuvtest: config });

      const result = await Effect.runPromise(registry.getHost("shuvtest"));
      expect(result).toEqual(config);
    });

    it("fails with HostNotFound for missing host", async () => {
      const registry = HostRegistry.fromRecord({});
      const result = await Effect.runPromise(
        registry.getHost("nonexistent").pipe(Effect.either),
      );

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("HostNotFound");
        expect(result.left.name).toBe("nonexistent");
      }
    });

    it("distinguishes between different hosts", async () => {
      const registry = HostRegistry.fromRecord({
        shuvtest: makeConfig({ hostname: "shuvtest", port: 22 }),
        shuvbot: makeConfig({ hostname: "shuvbot", port: 2222 }),
      });

      const test = await Effect.runPromise(registry.getHost("shuvtest"));
      const bot = await Effect.runPromise(registry.getHost("shuvbot"));

      expect(test.port).toBe(22);
      expect(bot.port).toBe(2222);
    });
  });

  describe("hasHost", () => {
    it("returns true for existing host", () => {
      const registry = HostRegistry.fromRecord({
        shuvtest: makeConfig(),
      });
      expect(registry.hasHost("shuvtest")).toBe(true);
    });

    it("returns false for missing host", () => {
      const registry = HostRegistry.fromRecord({});
      expect(registry.hasHost("nonexistent")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns 0 for empty registry", () => {
      const registry = HostRegistry.fromRecord({});
      expect(registry.size).toBe(0);
    });

    it("returns correct count", () => {
      const registry = HostRegistry.fromRecord({
        a: makeConfig(),
        b: makeConfig(),
        c: makeConfig(),
      });
      expect(registry.size).toBe(3);
    });
  });
});
