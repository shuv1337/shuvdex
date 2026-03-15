import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer, Ref } from "effect";
import { HostRegistry } from "@codex-fleet/core";
import type { HostConfig } from "@codex-fleet/core";
import {
  SshExecutorTest,
  MockSshResponses,
} from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { SkillOpsLive } from "@codex-fleet/skill-ops";
import { runPull } from "../src/commands/pull.js";
import { runSync } from "../src/commands/sync.js";
import { runActivate } from "../src/commands/activate.js";
import { runDeactivate } from "../src/commands/deactivate.js";
import { runRollback } from "../src/commands/rollback.js";
import { runTag } from "../src/commands/tag.js";
import { validateHostFilters } from "../src/commands/validate-hosts.js";

/**
 * Test host configurations.
 */
const host1: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 30,
};

const host2: HostConfig = {
  hostname: "shuvbot",
  connectionType: "ssh",
  port: 22,
  timeout: 30,
};

const testRegistry = HostRegistry.fromRecord({
  shuvtest: host1,
  shuvbot: host2,
});

const repoPath = "~/repos/shuvbot-skills";
const activeDir = "~/.codex/skills";

/**
 * Test layers.
 */
const BaseTestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest);

const GitTestLayer = Layer.mergeAll(
  SshExecutorTest,
  TelemetryTest,
  Layer.provideMerge(GitOpsLive, SshExecutorTest),
);

const SkillTestLayer = Layer.mergeAll(
  SshExecutorTest,
  TelemetryTest,
  Layer.provideMerge(
    SkillOpsLive,
    Layer.provideMerge(GitOpsLive, SshExecutorTest),
  ),
);

// --- validateHostFilters ---

describe("validateHostFilters", () => {
  it("returns undefined when no filter is given", () => {
    const result = validateHostFilters(testRegistry, undefined);
    expect(result).toBeUndefined();
  });

  it("returns undefined when empty filter is given", () => {
    const result = validateHostFilters(testRegistry, []);
    expect(result).toBeUndefined();
  });

  it("returns undefined when all hosts are known", () => {
    const result = validateHostFilters(testRegistry, ["shuvtest", "shuvbot"]);
    expect(result).toBeUndefined();
  });

  it("returns error for a single unknown host", () => {
    const result = validateHostFilters(testRegistry, ["nonexistent"]);
    expect(result).toBeDefined();
    expect(result!.unknownHosts).toEqual(["nonexistent"]);
    expect(result!.message).toContain("nonexistent");
  });

  it("returns error listing multiple unknown hosts", () => {
    const result = validateHostFilters(testRegistry, [
      "shuvtest",
      "foo",
      "bar",
    ]);
    expect(result).toBeDefined();
    expect(result!.unknownHosts).toEqual(["foo", "bar"]);
    expect(result!.message).toContain("foo");
    expect(result!.message).toContain("bar");
  });

  it("error message lists available hosts", () => {
    const result = validateHostFilters(testRegistry, ["unknown"]);
    expect(result).toBeDefined();
    expect(result!.message).toContain("shuvtest");
    expect(result!.message).toContain("shuvbot");
  });
});

// --- pull with unknown host ---

layer(GitTestLayer)("fleet pull with unknown host filter", (it) => {
  it.effect("fails with unknownHosts error for unknown host", () =>
    Effect.gen(function* () {
      const result = yield* runPull(testRegistry, repoPath, ["nonexistent"]);
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["nonexistent"]);
    }),
  );

  it.effect("fails with unknownHosts error for mix of known and unknown", () =>
    Effect.gen(function* () {
      const result = yield* runPull(testRegistry, repoPath, [
        "shuvtest",
        "badhost",
      ]);
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["badhost"]);
    }),
  );
});

// --- rollback with unknown host ---

layer(GitTestLayer)("fleet rollback with unknown host filter", (it) => {
  it.effect("fails with unknownHosts error for unknown host", () =>
    Effect.gen(function* () {
      const result = yield* runRollback(testRegistry, "main", repoPath, [
        "nonexistent",
      ]);
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["nonexistent"]);
    }),
  );
});

// --- tag with unknown host ---

layer(GitTestLayer)("fleet tag with unknown host filter", (it) => {
  it.effect("fails with unknownHosts error for unknown host", () =>
    Effect.gen(function* () {
      const result = yield* runTag(testRegistry, "v1.0", repoPath, [
        "nonexistent",
      ]);
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["nonexistent"]);
    }),
  );
});

// --- sync with unknown host ---

layer(SkillTestLayer)("fleet sync with unknown host filter", (it) => {
  it.effect("fails with unknownHosts error for unknown host", () =>
    Effect.gen(function* () {
      const result = yield* runSync(
        testRegistry,
        "test-skill",
        "/tmp/test-repo",
        repoPath,
        ["nonexistent"],
      );
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["nonexistent"]);
    }),
  );
});

// --- activate with unknown host ---

layer(SkillTestLayer)("fleet activate with unknown host filter", (it) => {
  it.effect("fails with unknownHosts error for unknown host", () =>
    Effect.gen(function* () {
      const result = yield* runActivate(
        testRegistry,
        "test-skill",
        repoPath,
        activeDir,
        ["nonexistent"],
      );
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["nonexistent"]);
    }),
  );
});

// --- deactivate with unknown host ---

layer(SkillTestLayer)("fleet deactivate with unknown host filter", (it) => {
  it.effect("fails with unknownHosts error for unknown host", () =>
    Effect.gen(function* () {
      const result = yield* runDeactivate(
        testRegistry,
        "test-skill",
        activeDir,
        ["nonexistent"],
      );
      expect(result.allSucceeded).toBe(false);
      expect(result.hosts).toHaveLength(0);
      expect(result.unknownHosts).toEqual(["nonexistent"]);
    }),
  );
});

// --- CLI integration: exit code 1 for unknown hosts ---

describe("CLI exit code for unknown hosts", () => {
  // We test this via the run() function at the CLI level to confirm exit 1
  // is returned for unknown host filters.
  // These will be tested after implementation is complete.
});
