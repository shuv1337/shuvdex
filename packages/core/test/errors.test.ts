import { describe, it, expect } from "vitest";
import {
  ConfigNotFound,
  ConfigParseError,
  ConfigValidationError,
  HostNotFound,
} from "../src/errors.js";

describe("ConfigNotFound", () => {
  it("has correct _tag", () => {
    const error = new ConfigNotFound({ path: "/etc/fleet.yaml" });
    expect(error._tag).toBe("ConfigNotFound");
  });

  it("includes path in message", () => {
    const error = new ConfigNotFound({ path: "/etc/fleet.yaml" });
    expect(error.message).toContain("/etc/fleet.yaml");
  });

  it("stores path field", () => {
    const error = new ConfigNotFound({ path: "/tmp/config.yaml" });
    expect(error.path).toBe("/tmp/config.yaml");
  });
});

describe("ConfigParseError", () => {
  it("has correct _tag", () => {
    const error = new ConfigParseError({
      path: "/etc/fleet.yaml",
      cause: new Error("bad yaml"),
    });
    expect(error._tag).toBe("ConfigParseError");
  });

  it("includes path in message", () => {
    const error = new ConfigParseError({
      path: "/etc/fleet.yaml",
      cause: new Error("bad yaml"),
    });
    expect(error.message).toContain("/etc/fleet.yaml");
  });

  it("stores cause", () => {
    const cause = new Error("bad yaml");
    const error = new ConfigParseError({ path: "/etc/fleet.yaml", cause });
    expect(error.cause).toBe(cause);
  });
});

describe("ConfigValidationError", () => {
  it("has correct _tag", () => {
    const error = new ConfigValidationError({
      path: "/etc/fleet.yaml",
      issues: "hostname: expected string",
    });
    expect(error._tag).toBe("ConfigValidationError");
  });

  it("includes path in message", () => {
    const error = new ConfigValidationError({
      path: "/etc/fleet.yaml",
      issues: "hostname: expected string",
    });
    expect(error.message).toContain("/etc/fleet.yaml");
  });

  it("includes issues in message", () => {
    const error = new ConfigValidationError({
      path: "/etc/fleet.yaml",
      issues: "hostname: expected string",
    });
    expect(error.message).toContain("hostname: expected string");
  });
});

describe("HostNotFound", () => {
  it("has correct _tag", () => {
    const error = new HostNotFound({ name: "shuvtest" });
    expect(error._tag).toBe("HostNotFound");
  });

  it("includes host name in message", () => {
    const error = new HostNotFound({ name: "shuvtest" });
    expect(error.message).toContain("shuvtest");
  });

  it("stores name field", () => {
    const error = new HostNotFound({ name: "shuvbot" });
    expect(error.name).toBe("shuvbot");
  });
});
