import { it, layer } from "@effect/vitest";
import { describe, expect, beforeEach, afterEach } from "vitest";
import { Effect, Ref, Layer } from "effect";
import {
  SkillOps,
  SkillOpsLive,
  SkillCommandFailed,
  SkillRepoNotFound,
  SkillNotFound,
  SyncFailed,
  ChecksumMismatch,
  ActivationFailed,
  DriftCheckFailed,
  _resetLocalHashCmdCache,
  _buildRsyncSshCmd,
  _remoteHashCmd,
} from "../src/index.js";
import type { DriftReport, HostDriftInfo } from "../src/index.js";
import {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  CommandFailed,
} from "@codex-fleet/ssh";
import { GitOpsLive } from "@codex-fleet/git-ops";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCb } from "node:child_process";

/**
 * Test host configuration.
 */
const testHost: HostConfig = {
  hostname: "testhost",
  connectionType: "ssh",
  port: 22,
  user: "testuser",
  timeout: 30,
};

const testRepoPath = "~/repos/shuvbot-skills";
const testActiveDir = "~/.codex/skills";

/**
 * Combined test layer: mock SSH + test telemetry + GitOps + SkillOps backed by mock SSH.
 */
const GitOpsTestLayer = GitOpsLive.pipe(Layer.provide(SshExecutorTest));
const SkillOpsTestLayer = SkillOpsLive.pipe(
  Layer.provide(SshExecutorTest),
  Layer.provide(GitOpsTestLayer),
);
const TestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest, SkillOpsTestLayer);

describe("SkillOps", () => {
  layer(TestLayer)("listSkills", (it) => {
    it.effect("returns array of skill names from repo", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // First call: test -d (repo exists)
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // Second call: find directories
          {
            _tag: "result" as const,
            value: {
              stdout: "skill-a\nskill-b\nskill-c\n",
              stderr: "",
              exitCode: 0,
            },
          },
          // Third, fourth, fifth: symlink checks for each skill
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills).toHaveLength(3);
        // Skills are sorted alphabetically
        expect(skills[0]).toEqual({ name: "skill-a", status: "active" });
        expect(skills[1]).toEqual({ name: "skill-b", status: "inactive" });
        expect(skills[2]).toEqual({ name: "skill-c", status: "active" });
      }),
    );

    it.effect("each skill has active/inactive status based on symlink", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories
          {
            _tag: "result" as const,
            value: { stdout: "my-skill\n", stderr: "", exitCode: 0 },
          },
          // symlink check - active
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills).toHaveLength(1);
        expect(skills[0].status).toBe("active");
      }),
    );

    it.effect("filters out .git directory", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories including .git
          {
            _tag: "result" as const,
            value: {
              stdout: ".git\nskill-real\n.github\nnode_modules\n",
              stderr: "",
              exitCode: 0,
            },
          },
          // symlink check for skill-real
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        // .git, .github, and node_modules should all be filtered
        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe("skill-real");
      }),
    );

    it.effect("filters out all non-skill directories (.git, .github, node_modules, etc.)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories including many filtered names
          {
            _tag: "result" as const,
            value: {
              stdout: ".git\n.github\n.vscode\n.idea\nnode_modules\n.DS_Store\n__pycache__\n.cache\n.turbo\nactual-skill\n",
              stderr: "",
              exitCode: 0,
            },
          },
          // symlink check for actual-skill
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills).toHaveLength(1);
        expect(skills[0].name).toBe("actual-skill");
      }),
    );

    it.effect("empty repo returns empty list, not error", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories - empty
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills).toEqual([]);
      }),
    );

    it.effect("empty repo with only filtered dirs returns empty list", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories - only filtered dirs
          {
            _tag: "result" as const,
            value: { stdout: ".git\nnode_modules\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills).toEqual([]);
      }),
    );

    it.effect("broken symlinks reported as inactive", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories
          {
            _tag: "result" as const,
            value: { stdout: "broken-skill\n", stderr: "", exitCode: 0 },
          },
          // symlink check - broken symlink (test -L passes but test -e fails)
          // So the combined check outputs "inactive"
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills).toHaveLength(1);
        expect(skills[0]).toEqual({ name: "broken-skill", status: "inactive" });
      }),
    );

    it.effect("fails with SkillRepoNotFound when repo path does not exist", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // test -d fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "test -d ~/repos/nonexistent && echo \"exists\"",
              exitCode: 1,
              stdout: "",
              stderr: "",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .listSkills(testHost, "~/repos/nonexistent", testActiveDir)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SkillRepoNotFound);
          const err = result.left as SkillRepoNotFound;
          expect(err.host).toBe("testhost");
          expect(err.path).toBe("~/repos/nonexistent");
        }
      }),
    );

    it.effect("skills are sorted alphabetically", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories in unsorted order
          {
            _tag: "result" as const,
            value: { stdout: "zebra\nalpha\nmedium\n", stderr: "", exitCode: 0 },
          },
          // symlink checks
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const skills = yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        expect(skills.map((s) => s.name)).toEqual(["alpha", "medium", "zebra"]);
      }),
    );

    it.effect("executes correct SSH commands", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories - empty
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        const callsAfter = yield* Ref.get(callsRef);
        // First call: directory existence check
        const dirCheck = callsAfter[countBefore];
        expect(dirCheck.command).toContain("test -d");
        expect(dirCheck.command).toContain(testRepoPath);
        expect(dirCheck.host).toEqual(testHost);

        // Second call: find directories
        const findCall = callsAfter[countBefore + 1];
        expect(findCall.command).toContain("find");
        expect(findCall.command).toContain(testRepoPath);
        expect(findCall.command).toContain("-maxdepth 1");
        expect(findCall.command).toContain("-type d");
      }),
    );
  });

  layer(TestLayer)("getSkillStatus", (it) => {
    it.effect("returns 'active' when symlink exists and is valid", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const status = yield* skillOps.getSkillStatus(testHost, "my-skill", testActiveDir);

        expect(status).toBe("active");
      }),
    );

    it.effect("returns 'inactive' when no symlink exists", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const status = yield* skillOps.getSkillStatus(testHost, "nonexistent", testActiveDir);

        expect(status).toBe("inactive");
      }),
    );

    it.effect("returns 'inactive' for broken symlinks", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // The combined test -L && test -e check fails for broken symlinks
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const status = yield* skillOps.getSkillStatus(testHost, "broken-skill", testActiveDir);

        expect(status).toBe("inactive");
      }),
    );

    it.effect("propagates SSH command failure as SkillCommandFailed (not silently inactive)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "test ...",
              exitCode: 1,
              stdout: "",
              stderr: "some error",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .getSkillStatus(testHost, "my-skill", testActiveDir)
          .pipe(Effect.either);

        // SSH/command failures should propagate, not be silently treated as inactive
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SkillCommandFailed);
          const err = result.left as SkillCommandFailed;
          expect(err.host).toBe("testhost");
        }
      }),
    );

    it.effect("checks the correct symlink path", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        yield* skillOps.getSkillStatus(testHost, "my-skill", testActiveDir);

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        expect(lastCall.command).toContain(`${testActiveDir}/my-skill`);
        expect(lastCall.command).toContain("test -L");
        expect(lastCall.command).toContain("test -e");
        expect(lastCall.host).toEqual(testHost);
      }),
    );
  });
});

describe("SkillOps OTEL tracing", () => {
  layer(TestLayer)("span creation", (it) => {
    it.effect("creates span for listSkills", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories - empty
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const listSpan = spans.find((s) => s.name === "skill.listSkills");
        expect(listSpan).toBeDefined();
        expect(listSpan!.attributes.host).toBe("testhost");
        expect(listSpan!.attributes.operation).toBe("listSkills");
        expect(listSpan!.attributes.repoPath).toBe(testRepoPath);
        expect(listSpan!.status).toBe("ok");
      }),
    );

    it.effect("creates span for getSkillStatus", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const skillOps = yield* SkillOps;
        yield* skillOps.getSkillStatus(testHost, "my-skill", testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const statusSpan = spans.find((s) => s.name === "skill.getSkillStatus");
        expect(statusSpan).toBeDefined();
        expect(statusSpan!.attributes.host).toBe("testhost");
        expect(statusSpan!.attributes.operation).toBe("getSkillStatus");
        expect(statusSpan!.attributes.skillName).toBe("my-skill");
        expect(statusSpan!.status).toBe("ok");
      }),
    );

    it.effect("records skill count in listSkills span", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories
          {
            _tag: "result" as const,
            value: { stdout: "skill-a\nskill-b\n", stderr: "", exitCode: 0 },
          },
          // symlink checks
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.listSkills(testHost, testRepoPath, testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const listSpan = spans.find((s) => s.name === "skill.listSkills");
        expect(listSpan).toBeDefined();
        expect(listSpan!.attributes["skill.count"]).toBe(2);
      }),
    );

    it.effect("records skill status in getSkillStatus span", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.getSkillStatus(testHost, "my-skill", testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const statusSpan = spans.find((s) => s.name === "skill.getSkillStatus");
        expect(statusSpan).toBeDefined();
        expect(statusSpan!.attributes["skill.status"]).toBe("active");
      }),
    );

    it.effect("records error span when listSkills fails", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // test -d fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "test -d",
              exitCode: 1,
              stdout: "",
              stderr: "",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps
          .listSkills(testHost, "~/repos/nonexistent", testActiveDir)
          .pipe(Effect.either);

        const spans = yield* Ref.get(spansRef);
        const listSpan = spans.find((s) => s.name === "skill.listSkills");
        expect(listSpan).toBeDefined();
        expect(listSpan!.status).toBe("error");
      }),
    );
  });
});

describe("SkillCommandFailed error", () => {
  it("has correct _tag", () => {
    const err = new SkillCommandFailed({
      host: "h",
      command: "find /path",
      exitCode: 1,
      stderr: "error",
    });
    expect(err._tag).toBe("SkillCommandFailed");
    expect(err.host).toBe("h");
    expect(err.exitCode).toBe(1);
    expect(err.message).toContain("h");
    expect(err.message).toContain("1");
  });
});

describe("SkillRepoNotFound error", () => {
  it("has correct _tag and fields", () => {
    const err = new SkillRepoNotFound({
      host: "h",
      path: "/some/path",
    });
    expect(err._tag).toBe("SkillRepoNotFound");
    expect(err.host).toBe("h");
    expect(err.path).toBe("/some/path");
    expect(err.message).toContain("h");
    expect(err.message).toContain("/some/path");
  });
});

describe("SkillNotFound error", () => {
  it("has correct _tag and fields", () => {
    const err = new SkillNotFound({
      skillName: "my-skill",
      sourcePath: "/local/path/my-skill",
    });
    expect(err._tag).toBe("SkillNotFound");
    expect(err.skillName).toBe("my-skill");
    expect(err.sourcePath).toBe("/local/path/my-skill");
    expect(err.message).toContain("my-skill");
    expect(err.message).toContain("/local/path/my-skill");
  });
});

describe("SyncFailed error", () => {
  it("has correct _tag and fields", () => {
    const err = new SyncFailed({
      host: "h",
      skillName: "my-skill",
      cause: "rsync failed",
    });
    expect(err._tag).toBe("SyncFailed");
    expect(err.host).toBe("h");
    expect(err.skillName).toBe("my-skill");
    expect(err.cause).toBe("rsync failed");
    expect(err.message).toContain("h");
    expect(err.message).toContain("my-skill");
    expect(err.message).toContain("rsync failed");
  });
});

describe("ChecksumMismatch error", () => {
  it("has correct _tag and fields", () => {
    const err = new ChecksumMismatch({
      host: "h",
      skillName: "my-skill",
      mismatched: ["./file1.txt", "./file2.txt"],
    });
    expect(err._tag).toBe("ChecksumMismatch");
    expect(err.host).toBe("h");
    expect(err.skillName).toBe("my-skill");
    expect(err.mismatched).toEqual(["./file1.txt", "./file2.txt"]);
    expect(err.message).toContain("2 file(s) differ");
  });
});

describe("SkillOps syncSkill", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skill-ops-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  layer(TestLayer)("sync operations", (it) => {
    it.effect("fails with SkillNotFound when local skill directory does not exist", () =>
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .syncSkill(testHost, "nonexistent-skill", "/tmp/no-such-path", "/remote/repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SkillNotFound);
          const err = result.left as SkillNotFound;
          expect(err.skillName).toBe("nonexistent-skill");
          expect(err.sourcePath).toContain("nonexistent-skill");
        }
      }),
    );

    it.effect("calls mkdir -p on remote to ensure parent exists", () =>
      Effect.gen(function* () {
        // Create a local skill directory
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test-skill\n"));

        // Use localhost with a non-existent user so rsync fails immediately
        // (no DNS resolution delay, SSH auth fails fast with BatchMode=yes)
        const localhostHost: HostConfig = {
          hostname: "localhost",
          connectionType: "ssh",
          port: 22,
          user: "nonexistentuser99",
          timeout: 1,
        };

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // mkdir -p response
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // find ... | wc -l response (file count) - may not be reached
          {
            _tag: "result" as const,
            value: { stdout: "1\n", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;

        // rsync uses local execFile (not SSH executor) but will fail
        // because the user doesn't exist. We expect a SyncFailed error.
        const result = yield* skillOps
          .syncSkill(localhostHost, "test-skill", localRepo, "/remote/repo")
          .pipe(Effect.either);

        // Verify the mkdir SSH command was called before rsync attempt
        const callsAfter = yield* Ref.get(callsRef);
        const mkdirCall = callsAfter[countBefore];
        expect(mkdirCall).toBeDefined();
        expect(mkdirCall.command).toContain("mkdir -p");
        expect(mkdirCall.command).toContain("/remote/repo");

        // The overall result should be SyncFailed due to rsync failure
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SyncFailed);
        }
      }),
    );

    it.effect("includes host, skillName in SyncFailed error", () =>
      Effect.gen(function* () {
        // Create local skill dir
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "readme.md"), "hello\n"));

        // Use localhost with a non-existent user so rsync fails immediately
        const localhostHost: HostConfig = {
          hostname: "localhost",
          connectionType: "ssh",
          port: 22,
          user: "nonexistentuser99",
          timeout: 1,
        };

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // mkdir response
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .syncSkill(localhostHost, "test-skill", localRepo, "/remote/repo")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          const err = result.left as SyncFailed;
          expect(err._tag).toBe("SyncFailed");
          expect(err.host).toBe("localhost");
          expect(err.skillName).toBe("test-skill");
          expect(err.cause.length).toBeGreaterThan(0);
        }
      }),
    );
  });
});

/**
 * Helper to get sha256 checksums for a directory via shell command.
 * Uses portable detection: sha256sum on Linux, shasum -a 256 on macOS.
 * Returns the raw output of `find . -type f -exec <hash-cmd> {} | sort -k2`.
 */
const getLocalChecksums = (dir: string): Promise<string> =>
  new Promise((resolve, reject) => {
    execFileCb(
      "bash",
      [
        "-c",
        `cd ${dir} && HASH_CMD=$(command -v sha256sum >/dev/null 2>&1 && echo "sha256sum" || echo "shasum -a 256") && find . -type f -exec $HASH_CMD {} \\; | sort -k2`,
      ],
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });

describe("SkillOps verifySync", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skill-ops-verify-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  layer(TestLayer)("verify operations", (it) => {
    it.effect("returns match=true when all checksums match", () =>
      Effect.gen(function* () {
        // Create local skill directory with files
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test-skill\n"));
        yield* Effect.promise(() => writeFile(join(skillDir, "run.sh"), "#!/bin/bash\necho hi\n"));

        // Get actual local checksums
        const localOutput = yield* Effect.promise(() => getLocalChecksums(skillDir));

        // Mock remote SSH to return identical checksums
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: localOutput, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.verifySync(
          testHost,
          "test-skill",
          localRepo,
          "/remote/repo",
        );

        expect(result.match).toBe(true);
        expect(result.host).toBe("testhost");
        expect(result.skillName).toBe("test-skill");
        expect(result.filesChecked).toBe(2);
        expect(result.mismatched).toEqual([]);
      }),
    );

    it.effect("returns match=false when checksums differ", () =>
      Effect.gen(function* () {
        // Create local skill directory
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test-skill\n"));

        // Get actual local checksums
        const localOutput = yield* Effect.promise(() => getLocalChecksums(skillDir));

        // Modify the checksum to simulate mismatch
        const fakeRemote = localOutput.replace(/^[a-f0-9]{64}/, "0".repeat(64));

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: fakeRemote, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.verifySync(
          testHost,
          "test-skill",
          localRepo,
          "/remote/repo",
        );

        expect(result.match).toBe(false);
        expect(result.mismatched.length).toBeGreaterThan(0);
        expect(result.mismatched).toContain("./config.yaml");
      }),
    );

    it.effect("detects extra files on remote", () =>
      Effect.gen(function* () {
        // Create local skill directory with one file
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test-skill\n"));

        // Get actual local checksums
        const localOutput = yield* Effect.promise(() => getLocalChecksums(skillDir));

        // Remote has extra file
        const extraLine = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890  ./extra-file.txt";
        const remoteOutput = `${localOutput.trim()}\n${extraLine}\n`;

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: remoteOutput, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.verifySync(
          testHost,
          "test-skill",
          localRepo,
          "/remote/repo",
        );

        expect(result.match).toBe(false);
        expect(result.mismatched).toContain("./extra-file.txt");
      }),
    );

    it.effect("detects missing files on remote", () =>
      Effect.gen(function* () {
        // Create local skill directory with two files
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test-skill\n"));
        yield* Effect.promise(() => writeFile(join(skillDir, "run.sh"), "#!/bin/bash\n"));

        // Remote only has one of the two files with a fake hash
        const fakeHash = "a".repeat(64);
        const remoteOutput = `${fakeHash}  ./config.yaml\n`;

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: remoteOutput, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.verifySync(
          testHost,
          "test-skill",
          localRepo,
          "/remote/repo",
        );

        expect(result.match).toBe(false);
        // run.sh is missing on remote, config.yaml has wrong hash
        expect(result.mismatched.length).toBeGreaterThanOrEqual(1);
        expect(result.mismatched).toContain("./run.sh");
      }),
    );

    it.effect("handles empty skill directory", () =>
      Effect.gen(function* () {
        // Create empty local skill directory
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "empty-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.verifySync(
          testHost,
          "empty-skill",
          localRepo,
          "/remote/repo",
        );

        expect(result.match).toBe(true);
        expect(result.filesChecked).toBe(0);
        expect(result.mismatched).toEqual([]);
      }),
    );

    it.effect("verifies correct SSH commands are sent for remote checksums", () =>
      Effect.gen(function* () {
        // Create local skill directory
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "test\n"));

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        yield* skillOps.verifySync(testHost, "test-skill", localRepo, "/remote/repo");

        const callsAfter = yield* Ref.get(callsRef);
        const remoteCall = callsAfter[countBefore];
        expect(remoteCall).toBeDefined();
        expect(remoteCall.command).toContain("cd /remote/repo/test-skill");
        // Portable: uses command -v detection for sha256sum / shasum
        expect(remoteCall.command).toContain("HASH_CMD=");
        expect(remoteCall.command).toContain("sha256sum");
        expect(remoteCall.command).toContain("sort -k2");
        expect(remoteCall.host).toEqual(testHost);
      }),
    );
  });
});

describe("SkillOps sync OTEL tracing", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "skill-ops-trace-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  layer(TestLayer)("span creation", (it) => {
    it.effect("creates span for syncSkill (even on failure)", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const skillOps = yield* SkillOps;
        yield* skillOps
          .syncSkill(testHost, "nonexistent", "/no/such/path", "/remote")
          .pipe(Effect.either);

        const spans = yield* Ref.get(spansRef);
        const syncSpan = spans.find((s) => s.name === "skill.syncSkill");
        expect(syncSpan).toBeDefined();
        expect(syncSpan!.attributes.host).toBe("testhost");
        expect(syncSpan!.attributes.operation).toBe("syncSkill");
        expect(syncSpan!.attributes.skillName).toBe("nonexistent");
        expect(syncSpan!.status).toBe("error");
      }),
    );

    it.effect("creates span for verifySync", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        // Create local skill directory
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "test\n"));

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.verifySync(testHost, "test-skill", localRepo, "/remote/repo");

        const spans = yield* Ref.get(spansRef);
        const verifySpan = spans.find((s) => s.name === "skill.verifySync");
        expect(verifySpan).toBeDefined();
        expect(verifySpan!.attributes.host).toBe("testhost");
        expect(verifySpan!.attributes.operation).toBe("verifySync");
        expect(verifySpan!.attributes.skillName).toBe("test-skill");
        expect(verifySpan!.status).toBe("ok");
      }),
    );

    it.effect("records checksumMatch and filesChecked in verifySync span", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        // Create local skill directory with a file
        const localRepo = tmpDir;
        const skillDir = join(localRepo, "test-skill");
        yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
        yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test-skill\n"));

        // Get real local checksums to mock the remote response
        const localOutput = yield* Effect.promise(() => getLocalChecksums(skillDir));

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: localOutput, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.verifySync(testHost, "test-skill", localRepo, "/remote/repo");

        const spans = yield* Ref.get(spansRef);
        const verifySpan = spans.find((s) => s.name === "skill.verifySync");
        expect(verifySpan).toBeDefined();
        expect(verifySpan!.attributes["skill.checksumMatch"]).toBe(true);
        expect(verifySpan!.attributes["skill.filesChecked"]).toBe(1);
      }),
    );
  });
});

describe("SkillOps activateSkill", () => {
  layer(TestLayer)("activation operations", (it) => {
    it.effect("creates symlink in active dir pointing to skill repo path", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: test -L && test -e → inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p activeDir
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove broken symlink (test -L fails, || true succeeds)
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.activateSkill(
          testHost,
          "my-skill",
          testRepoPath,
          testActiveDir,
        );

        expect(result.host).toBe("testhost");
        expect(result.skillName).toBe("my-skill");
        expect(result.alreadyInState).toBe(false);
        expect(result.status).toBe("active");

        // Verify the ln -s command was called with correct paths
        const callsAfter = yield* Ref.get(callsRef);
        const lnCall = callsAfter[countBefore + 3]; // 4th call is ln -s
        expect(lnCall).toBeDefined();
        expect(lnCall.command).toContain("ln -s");
        expect(lnCall.command).toContain(`${testRepoPath}/my-skill`);
        expect(lnCall.command).toContain(`${testActiveDir}/my-skill`);
      }),
    );

    it.effect("already-active activation returns success with alreadyInState=true (idempotent)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: already active
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          // readSymlinkTarget: returns the correct target path
          {
            _tag: "result" as const,
            value: { stdout: `${testRepoPath}/my-skill\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.activateSkill(
          testHost,
          "my-skill",
          testRepoPath,
          testActiveDir,
        );

        expect(result.host).toBe("testhost");
        expect(result.skillName).toBe("my-skill");
        expect(result.alreadyInState).toBe(true);
        expect(result.status).toBe("active");
      }),
    );

    it.effect("ensures active directory exists before creating symlink", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p activeDir
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove broken symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(testHost, "my-skill", testRepoPath, testActiveDir);

        const callsAfter = yield* Ref.get(callsRef);
        // 2nd call should be mkdir -p
        const mkdirCall = callsAfter[countBefore + 1];
        expect(mkdirCall).toBeDefined();
        expect(mkdirCall.command).toContain("mkdir -p");
        expect(mkdirCall.command).toContain(testActiveDir);
      }),
    );

    it.effect("removes broken symlink before creating new one", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive (broken symlink returns inactive)
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove broken symlink: test -L succeeds, rm succeeds
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(testHost, "my-skill", testRepoPath, testActiveDir);

        const callsAfter = yield* Ref.get(callsRef);
        // 3rd call should be test -L && rm || true
        const cleanupCall = callsAfter[countBefore + 2];
        expect(cleanupCall).toBeDefined();
        expect(cleanupCall.command).toContain("test -L");
        expect(cleanupCall.command).toContain("rm");
      }),
    );

    it.effect("fails with ActivationFailed when ln -s command fails", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove broken symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "ln -s ...",
              exitCode: 1,
              stdout: "",
              stderr: "permission denied",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .activateSkill(testHost, "my-skill", testRepoPath, testActiveDir)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ActivationFailed);
          const err = result.left as ActivationFailed;
          expect(err.host).toBe("testhost");
          expect(err.skillName).toBe("my-skill");
          expect(err.operation).toBe("activate");
          expect(err.cause).toContain("permission denied");
        }
      }),
    );

    it.effect("fails with ActivationFailed when mkdir -p fails", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "mkdir -p ...",
              exitCode: 1,
              stdout: "",
              stderr: "read-only file system",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .activateSkill(testHost, "my-skill", testRepoPath, testActiveDir)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ActivationFailed);
          const err = result.left as ActivationFailed;
          expect(err.operation).toBe("activate");
          expect(err.cause).toContain("read-only file system");
        }
      }),
    );
  });
});

describe("SkillOps deactivateSkill", () => {
  layer(TestLayer)("deactivation operations", (it) => {
    it.effect("removes symlink and leaves repo files intact", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink exists: test -L → exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // rm symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.deactivateSkill(
          testHost,
          "my-skill",
          testActiveDir,
        );

        expect(result.host).toBe("testhost");
        expect(result.skillName).toBe("my-skill");
        expect(result.alreadyInState).toBe(false);
        expect(result.status).toBe("inactive");

        // Verify rm was called on the symlink path (not the repo files)
        const callsAfter = yield* Ref.get(callsRef);
        const rmCall = callsAfter[countBefore + 1]; // 2nd call is rm
        expect(rmCall).toBeDefined();
        expect(rmCall.command).toContain("rm");
        expect(rmCall.command).toContain(`${testActiveDir}/my-skill`);
        // Should NOT contain recursive flag — only removing symlink
        expect(rmCall.command).not.toContain("-r");
        expect(rmCall.command).not.toContain("-rf");
      }),
    );

    it.effect("already-inactive deactivation returns success with alreadyInState=true (idempotent)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink exists: absent
          {
            _tag: "result" as const,
            value: { stdout: "absent\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.deactivateSkill(
          testHost,
          "my-skill",
          testActiveDir,
        );

        expect(result.host).toBe("testhost");
        expect(result.skillName).toBe("my-skill");
        expect(result.alreadyInState).toBe(true);
        expect(result.status).toBe("inactive");
      }),
    );

    it.effect("removes broken symlinks (test -L succeeds but test -e fails)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink exists: test -L → exists (even if broken)
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // rm symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.deactivateSkill(
          testHost,
          "broken-skill",
          testActiveDir,
        );

        expect(result.alreadyInState).toBe(false);
        expect(result.status).toBe("inactive");
      }),
    );

    it.effect("fails with ActivationFailed when rm command fails", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink exists: exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // rm fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "rm ...",
              exitCode: 1,
              stdout: "",
              stderr: "operation not permitted",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .deactivateSkill(testHost, "my-skill", testActiveDir)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ActivationFailed);
          const err = result.left as ActivationFailed;
          expect(err.host).toBe("testhost");
          expect(err.skillName).toBe("my-skill");
          expect(err.operation).toBe("deactivate");
          expect(err.cause).toContain("operation not permitted");
        }
      }),
    );

    it.effect("propagates SSH failure on symlink check as ActivationFailed (not silently inactive)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink existence fails with CommandFailed
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "test -L ...",
              exitCode: 255,
              stdout: "",
              stderr: "connection reset",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        // SSH/command failures should NOT be silently treated as "absent"
        const result = yield* skillOps
          .deactivateSkill(testHost, "my-skill", testActiveDir)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(ActivationFailed);
          const err = result.left as ActivationFailed;
          expect(err.host).toBe("testhost");
          expect(err.operation).toBe("deactivate");
          expect(err.cause).toContain("connection reset");
        }
      }),
    );

    it.effect("checks the correct symlink path", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check: absent
          {
            _tag: "result" as const,
            value: { stdout: "absent\n", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(testHost, "my-skill", testActiveDir);

        const callsAfter = yield* Ref.get(callsRef);
        const checkCall = callsAfter[countBefore];
        expect(checkCall).toBeDefined();
        expect(checkCall.command).toContain("test -L");
        expect(checkCall.command).toContain(`${testActiveDir}/my-skill`);
      }),
    );
  });
});

describe("ActivationFailed error", () => {
  it("has correct _tag and fields", () => {
    const err = new ActivationFailed({
      host: "h",
      skillName: "my-skill",
      operation: "activate",
      cause: "permission denied",
    });
    expect(err._tag).toBe("ActivationFailed");
    expect(err.host).toBe("h");
    expect(err.skillName).toBe("my-skill");
    expect(err.operation).toBe("activate");
    expect(err.cause).toBe("permission denied");
    expect(err.message).toContain("activate");
    expect(err.message).toContain("my-skill");
    expect(err.message).toContain("h");
    expect(err.message).toContain("permission denied");
  });

  it("has correct message for deactivate operation", () => {
    const err = new ActivationFailed({
      host: "testhost",
      skillName: "test-skill",
      operation: "deactivate",
      cause: "not permitted",
    });
    expect(err.message).toContain("deactivate");
    expect(err.message).toContain("test-skill");
    expect(err.message).toContain("testhost");
  });
});

describe("SkillOps activation OTEL tracing", () => {
  layer(TestLayer)("span creation", (it) => {
    it.effect("creates span for activateSkill", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove broken symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(testHost, "my-skill", testRepoPath, testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const activateSpan = spans.find((s) => s.name === "skill.activateSkill");
        expect(activateSpan).toBeDefined();
        expect(activateSpan!.attributes.host).toBe("testhost");
        expect(activateSpan!.attributes.operation).toBe("activateSkill");
        expect(activateSpan!.attributes.skillName).toBe("my-skill");
        expect(activateSpan!.status).toBe("ok");
      }),
    );

    it.effect("records alreadyActive=true when skill is already active with correct target", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: active
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          // readSymlinkTarget: correct target path
          {
            _tag: "result" as const,
            value: { stdout: `${testRepoPath}/my-skill\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(testHost, "my-skill", testRepoPath, testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const activateSpan = spans.find((s) => s.name === "skill.activateSkill");
        expect(activateSpan).toBeDefined();
        expect(activateSpan!.attributes["skill.alreadyActive"]).toBe(true);
      }),
    );

    it.effect("records activated=true when skill was newly activated", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove broken symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(testHost, "my-skill", testRepoPath, testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const activateSpan = spans.find((s) => s.name === "skill.activateSkill");
        expect(activateSpan).toBeDefined();
        expect(activateSpan!.attributes["skill.alreadyActive"]).toBe(false);
        expect(activateSpan!.attributes["skill.activated"]).toBe(true);
      }),
    );

    it.effect("creates span for deactivateSkill", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink: exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // rm
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(testHost, "my-skill", testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const deactivateSpan = spans.find((s) => s.name === "skill.deactivateSkill");
        expect(deactivateSpan).toBeDefined();
        expect(deactivateSpan!.attributes.host).toBe("testhost");
        expect(deactivateSpan!.attributes.operation).toBe("deactivateSkill");
        expect(deactivateSpan!.attributes.skillName).toBe("my-skill");
        expect(deactivateSpan!.status).toBe("ok");
      }),
    );

    it.effect("records alreadyInactive=true when skill is already inactive", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink: absent
          {
            _tag: "result" as const,
            value: { stdout: "absent\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.deactivateSkill(testHost, "my-skill", testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const deactivateSpan = spans.find((s) => s.name === "skill.deactivateSkill");
        expect(deactivateSpan).toBeDefined();
        expect(deactivateSpan!.attributes["skill.alreadyInactive"]).toBe(true);
      }),
    );

    it.effect("records error span when activation fails", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: inactive
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "mkdir -p ...",
              exitCode: 1,
              stdout: "",
              stderr: "permission denied",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps
          .activateSkill(testHost, "my-skill", testRepoPath, testActiveDir)
          .pipe(Effect.either);

        const spans = yield* Ref.get(spansRef);
        const activateSpan = spans.find((s) => s.name === "skill.activateSkill");
        expect(activateSpan).toBeDefined();
        expect(activateSpan!.status).toBe("error");
      }),
    );

    it.effect("records error span when deactivation fails", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // check symlink: exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // rm fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "rm ...",
              exitCode: 1,
              stdout: "",
              stderr: "not permitted",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps
          .deactivateSkill(testHost, "my-skill", testActiveDir)
          .pipe(Effect.either);

        const spans = yield* Ref.get(spansRef);
        const deactivateSpan = spans.find((s) => s.name === "skill.deactivateSkill");
        expect(deactivateSpan).toBeDefined();
        expect(deactivateSpan!.status).toBe("error");
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────────
// Drift detection tests
// ──────────────────────────────────────────────────────────────

/**
 * Multiple test host configurations for drift detection.
 */
const hostA: HostConfig = {
  hostname: "host-a",
  connectionType: "ssh",
  port: 22,
  user: "user",
  timeout: 30,
};
const hostB: HostConfig = {
  hostname: "host-b",
  connectionType: "ssh",
  port: 22,
  user: "user",
  timeout: 30,
};
const hostC: HostConfig = {
  hostname: "host-c",
  connectionType: "ssh",
  port: 22,
  user: "user",
  timeout: 30,
};

const allHosts: ReadonlyArray<readonly [string, HostConfig]> = [
  ["host-a", hostA],
  ["host-b", hostB],
  ["host-c", hostC],
];

const repoPath = "~/repos/shuvbot-skills";
const refSha = "a".repeat(40);
const driftedSha = "b".repeat(40);
const aheadSha = "c".repeat(40);

describe("SkillOps checkDrift", () => {
  layer(TestLayer)("drift detection", (it) => {
    it.effect("returns all hosts in_sync when all HEADs match reference", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference): cd ... && git rev-parse HEAD
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-c
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        expect(report.referenceSha).toBe(refSha);
        expect(report.referenceHost).toBe("host-a");
        expect(report.hasDrift).toBe(false);
        expect(report.driftedCount).toBe(0);
        expect(report.inSyncCount).toBe(3);
        expect(report.unreachableCount).toBe(0);
        expect(report.hosts).toHaveLength(3);

        for (const h of report.hosts) {
          expect(h.status).toBe("in_sync");
          expect(h.sha).toBe(refSha);
        }
      }),
    );

    it.effect("reports per-host drift status when a host has different HEAD", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Responses are consumed FIFO: host-a getHead, then host-b getHead
        // + rev-list (grouped), then host-c getHead
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (drifted)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // 3. git rev-list for host-b: 2 behind, 0 ahead
          {
            _tag: "result" as const,
            value: { stdout: "2\t0\n", stderr: "", exitCode: 0 },
          },
          // 4. getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        expect(report.hasDrift).toBe(true);
        expect(report.driftedCount).toBe(1);
        expect(report.inSyncCount).toBe(2);
        expect(report.unreachableCount).toBe(0);

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.sha).toBe(driftedSha);
        expect(hostBResult.direction).toBe("behind");
        expect(hostBResult.behind).toBe(2);
        expect(hostBResult.ahead).toBe(0);
      }),
    );

    it.effect("drifted hosts include SHA and direction (ahead)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (ahead)
          {
            _tag: "result" as const,
            value: { stdout: `${aheadSha}\n`, stderr: "", exitCode: 0 },
          },
          // 3. git rev-list for host-b: 0 behind, 3 ahead
          {
            _tag: "result" as const,
            value: { stdout: "0\t3\n", stderr: "", exitCode: 0 },
          },
          // 4. getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.sha).toBe(aheadSha);
        expect(hostBResult.direction).toBe("ahead");
        expect(hostBResult.ahead).toBe(3);
        expect(hostBResult.behind).toBe(0);
      }),
    );

    it.effect("reports diverged direction when host is both ahead and behind", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (diverged)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // 3. git rev-list for host-b: 1 behind, 2 ahead (diverged)
          {
            _tag: "result" as const,
            value: { stdout: "1\t2\n", stderr: "", exitCode: 0 },
          },
          // 4. getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.direction).toBe("diverged");
        expect(hostBResult.ahead).toBe(2);
        expect(hostBResult.behind).toBe(1);
      }),
    );

    it.effect("unreachable host does not fail entire operation", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b (unreachable)
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "host-b",
              command: "cd ~/repos/shuvbot-skills && git rev-parse HEAD",
              exitCode: 255,
              stdout: "",
              stderr: "ssh: connect to host host-b port 22: Connection refused",
            }),
          },
          // getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        expect(report.hasDrift).toBe(false);
        expect(report.unreachableCount).toBe(1);
        expect(report.inSyncCount).toBe(2);
        expect(report.driftedCount).toBe(0);

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("unreachable");
        expect(hostBResult.sha).toBeUndefined();
        expect(hostBResult.error).toBeDefined();
        expect(hostBResult.error!.length).toBeGreaterThan(0);
      }),
    );

    it.effect("multiple hosts drifted with different SHAs", () =>
      Effect.gen(function* () {
        const shaBehind = "d".repeat(40);

        const responsesRef = yield* MockSshResponses;
        // Responses are consumed FIFO: host-a getHead, then host-b (getHead + rev-list),
        // then host-c (getHead + rev-list)
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (drifted ahead)
          {
            _tag: "result" as const,
            value: { stdout: `${aheadSha}\n`, stderr: "", exitCode: 0 },
          },
          // 3. git rev-list for host-b: ahead
          {
            _tag: "result" as const,
            value: { stdout: "0\t5\n", stderr: "", exitCode: 0 },
          },
          // 4. getHead for host-c (drifted behind)
          {
            _tag: "result" as const,
            value: { stdout: `${shaBehind}\n`, stderr: "", exitCode: 0 },
          },
          // 5. git rev-list for host-c: behind
          {
            _tag: "result" as const,
            value: { stdout: "3\t0\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        expect(report.hasDrift).toBe(true);
        expect(report.driftedCount).toBe(2);
        expect(report.inSyncCount).toBe(1);

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.direction).toBe("ahead");
        expect(hostBResult.ahead).toBe(5);

        const hostCResult = report.hosts.find((h) => h.host === "host-c")!;
        expect(hostCResult.direction).toBe("behind");
        expect(hostCResult.behind).toBe(3);
      }),
    );

    it.effect("fails with DriftCheckFailed when reference host is unreachable", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference, fails)
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "host-a",
              command: "cd ~/repos/shuvbot-skills && git rev-parse HEAD",
              exitCode: 255,
              stdout: "",
              stderr: "Connection refused",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .checkDrift(allHosts, repoPath, "host-a")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(DriftCheckFailed);
          const err = result.left as DriftCheckFailed;
          expect(err.referenceHost).toBe("host-a");
          expect(err.cause.length).toBeGreaterThan(0);
        }
      }),
    );

    it.effect("fails with DriftCheckFailed when reference host not in hosts list", () =>
      Effect.gen(function* () {
        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .checkDrift(allHosts, repoPath, "nonexistent-host")
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(DriftCheckFailed);
          const err = result.left as DriftCheckFailed;
          expect(err.referenceHost).toBe("nonexistent-host");
          expect(err.cause).toContain("not found");
        }
      }),
    );

    it.effect("reference host is reported as in_sync in the result", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-c
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const refHost = report.hosts.find((h) => h.host === "host-a")!;
        expect(refHost.status).toBe("in_sync");
        expect(refHost.sha).toBe(refSha);
      }),
    );

    it.effect("handles rev-list failure gracefully (reports as diverged with undefined counts)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (drifted)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // 3. git rev-list fails for host-b (e.g., shallow clone, missing ancestry)
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "host-b",
              command: "git rev-list ...",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: bad revision",
            }),
          },
          // 4. getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        // Even though rev-list failed, drift should still be detected
        expect(report.hasDrift).toBe(true);

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.sha).toBe(driftedSha);
        // Fallback to diverged with undefined counts (missing refs)
        expect(hostBResult.direction).toBe("diverged");
        expect(hostBResult.ahead).toBeUndefined();
        expect(hostBResult.behind).toBeUndefined();
      }),
    );

    it.effect("works with single host (reference only)", () =>
      Effect.gen(function* () {
        const singleHost: ReadonlyArray<readonly [string, HostConfig]> = [
          ["host-a", hostA],
        ];

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(singleHost, repoPath, "host-a");

        expect(report.hasDrift).toBe(false);
        expect(report.hosts).toHaveLength(1);
        expect(report.hosts[0].status).toBe("in_sync");
        expect(report.inSyncCount).toBe(1);
        expect(report.driftedCount).toBe(0);
        expect(report.unreachableCount).toBe(0);
      }),
    );

    it.effect("mixed unreachable and drifted hosts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        // Responses consumed FIFO: host-a getHead, host-b getHead (error),
        // host-c getHead + rev-list
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (unreachable)
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "host-b",
              command: "...",
              exitCode: 255,
              stdout: "",
              stderr: "Connection timed out",
            }),
          },
          // 3. getHead for host-c (drifted)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // 4. git rev-list for host-c
          {
            _tag: "result" as const,
            value: { stdout: "4\t0\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        expect(report.hasDrift).toBe(true);
        expect(report.driftedCount).toBe(1);
        expect(report.unreachableCount).toBe(1);
        expect(report.inSyncCount).toBe(1);

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("unreachable");

        const hostCResult = report.hosts.find((h) => h.host === "host-c")!;
        expect(hostCResult.status).toBe("drifted");
        expect(hostCResult.direction).toBe("behind");
        expect(hostCResult.behind).toBe(4);
      }),
    );
  });
});

describe("DriftCheckFailed error", () => {
  it("has correct _tag and fields", () => {
    const err = new DriftCheckFailed({
      referenceHost: "host-a",
      cause: "Connection refused",
    });
    expect(err._tag).toBe("DriftCheckFailed");
    expect(err.referenceHost).toBe("host-a");
    expect(err.cause).toBe("Connection refused");
    expect(err.message).toContain("host-a");
    expect(err.message).toContain("Connection refused");
  });
});

describe("SkillOps checkDrift OTEL tracing", () => {
  layer(TestLayer)("span creation", (it) => {
    it.effect("creates span for checkDrift with correct attributes", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-c
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const spans = yield* Ref.get(spansRef);
        const driftSpan = spans.find((s) => s.name === "skill.checkDrift");
        expect(driftSpan).toBeDefined();
        expect(driftSpan!.attributes.operation).toBe("checkDrift");
        expect(driftSpan!.attributes.referenceHost).toBe("host-a");
        expect(driftSpan!.attributes.repoPath).toBe(repoPath);
        expect(driftSpan!.attributes.hostCount).toBe(3);
        expect(driftSpan!.status).toBe("ok");
      }),
    );

    it.effect("records drift summary in span attributes", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // 1. getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // 2. getHead for host-b (drifted)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // 3. rev-list for host-b
          {
            _tag: "result" as const,
            value: { stdout: "1\t0\n", stderr: "", exitCode: 0 },
          },
          // 4. getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const spans = yield* Ref.get(spansRef);
        const driftSpan = spans.find((s) => s.name === "skill.checkDrift");
        expect(driftSpan).toBeDefined();
        expect(driftSpan!.attributes["drift.referenceSha"]).toBe(refSha);
        expect(driftSpan!.attributes["drift.driftedCount"]).toBe(1);
        expect(driftSpan!.attributes["drift.inSyncCount"]).toBe(2);
        expect(driftSpan!.attributes["drift.unreachableCount"]).toBe(0);
        expect(driftSpan!.attributes["drift.hasDrift"]).toBe(true);
      }),
    );

    it.effect("records error span when drift check fails", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference, fails)
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "host-a",
              command: "...",
              exitCode: 255,
              stdout: "",
              stderr: "Connection refused",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps
          .checkDrift(allHosts, repoPath, "host-a")
          .pipe(Effect.either);

        const spans = yield* Ref.get(spansRef);
        const driftSpan = spans.find((s) => s.name === "skill.checkDrift");
        expect(driftSpan).toBeDefined();
        expect(driftSpan!.status).toBe("error");
      }),
    );
  });
});

// ──────────────────────────────────────────────────────────────
// Portability tests: portable hash detection & keyed-host rsync
// ──────────────────────────────────────────────────────────────

describe("_buildRsyncSshCmd (unit)", () => {
  it("includes -i keyPath when host has keyPath configured", () => {
    const host: HostConfig = {
      hostname: "keyed-host",
      connectionType: "ssh",
      port: 22,
      user: "deploy",
      keyPath: "/home/deploy/.ssh/fleet_key",
      timeout: 30,
    };
    const cmd = _buildRsyncSshCmd(host);
    expect(cmd).toContain("-i /home/deploy/.ssh/fleet_key");
    expect(cmd).toContain("-o ConnectTimeout=30");
    expect(cmd).toContain("-o BatchMode=yes");
    expect(cmd).not.toContain("-p ");
  });

  it("does NOT include -i when host has no keyPath", () => {
    const host: HostConfig = {
      hostname: "standard-host",
      connectionType: "ssh",
      port: 22,
      user: "testuser",
      timeout: 30,
    };
    const cmd = _buildRsyncSshCmd(host);
    expect(cmd).not.toContain("-i ");
    expect(cmd).toContain("-o ConnectTimeout=30");
  });

  it("includes both -p port and -i keyPath for keyed host with custom port", () => {
    const host: HostConfig = {
      hostname: "keyed-host-alt",
      connectionType: "ssh",
      port: 2222,
      user: "admin",
      keyPath: "/root/.ssh/id_ed25519",
      timeout: 15,
    };
    const cmd = _buildRsyncSshCmd(host);
    expect(cmd).toContain("-p 2222");
    expect(cmd).toContain("-i /root/.ssh/id_ed25519");
    expect(cmd).toContain("-o ConnectTimeout=15");
  });

  it("includes -p for non-standard port without keyPath", () => {
    const host: HostConfig = {
      hostname: "custom-port-host",
      connectionType: "ssh",
      port: 2200,
      user: "user",
      timeout: 10,
    };
    const cmd = _buildRsyncSshCmd(host);
    expect(cmd).toContain("-p 2200");
    expect(cmd).not.toContain("-i ");
  });

  it("omits -p for standard port 22", () => {
    const host: HostConfig = {
      hostname: "standard",
      connectionType: "ssh",
      port: 22,
      user: "user",
      timeout: 30,
    };
    const cmd = _buildRsyncSshCmd(host);
    expect(cmd).not.toContain("-p ");
  });
});

describe("_remoteHashCmd (unit)", () => {
  it("produces portable hash command with HASH_CMD detection", () => {
    const cmd = _remoteHashCmd("/remote/path/skill-a");
    expect(cmd).toContain("cd /remote/path/skill-a");
    expect(cmd).toContain("HASH_CMD=");
    expect(cmd).toContain("command -v sha256sum");
    expect(cmd).toContain("shasum -a 256");
    expect(cmd).toContain("$HASH_CMD");
    expect(cmd).toContain("sort -k2");
  });

  it("uses the provided directory path", () => {
    const cmd = _remoteHashCmd("/some/other/dir");
    expect(cmd).toContain("cd /some/other/dir");
  });
});

describe("SkillOps portability", () => {
  describe("verifySync portable hash command", () => {
    let tmpDir: string;

    beforeEach(async () => {
      _resetLocalHashCmdCache();
      tmpDir = await mkdtemp(join(tmpdir(), "skill-ops-portable-"));
    });

    afterEach(async () => {
      _resetLocalHashCmdCache();
      await rm(tmpDir, { recursive: true, force: true });
    });

    layer(TestLayer)("remote command uses portable detection", (it) => {
      it.effect("remote checksum command uses 'command -v' to detect hash tool", () =>
        Effect.gen(function* () {
          // Create local skill directory
          const localRepo = tmpDir;
          const skillDir = join(localRepo, "test-skill");
          yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
          yield* Effect.promise(() => writeFile(join(skillDir, "file.txt"), "content\n"));

          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: "", stderr: "", exitCode: 0 },
            },
          ]);

          const callsRef = yield* RecordedSshCalls;
          const callsBefore = yield* Ref.get(callsRef);
          const countBefore = callsBefore.length;

          const skillOps = yield* SkillOps;
          yield* skillOps.verifySync(testHost, "test-skill", localRepo, "/remote/repo");

          const callsAfter = yield* Ref.get(callsRef);
          const remoteCmd = callsAfter[countBefore];
          expect(remoteCmd).toBeDefined();

          // The remote command must use portable detection via HASH_CMD
          expect(remoteCmd.command).toContain("HASH_CMD=");
          expect(remoteCmd.command).toContain("command -v sha256sum");
          // Fallback to shasum -a 256 for macOS
          expect(remoteCmd.command).toContain("shasum -a 256");
          expect(remoteCmd.command).toContain("$HASH_CMD");
        }),
      );

      it.effect("local hash detection runs successfully and produces valid checksums", () =>
        Effect.gen(function* () {
          // Create local skill directory with a known file
          const localRepo = tmpDir;
          const skillDir = join(localRepo, "hash-test");
          yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
          yield* Effect.promise(() => writeFile(join(skillDir, "hello.txt"), "hello world\n"));

          // Get local checksums using our portable helper
          const localOutput = yield* Effect.promise(() => getLocalChecksums(skillDir));
          // Output should contain a 64-char hex hash followed by the file path
          expect(localOutput).toMatch(/^[a-f0-9]{64}\s+\.\/hello\.txt/);

          // Mock remote to return matching checksums
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: localOutput, stderr: "", exitCode: 0 },
            },
          ]);

          const skillOps = yield* SkillOps;
          const result = yield* skillOps.verifySync(
            testHost,
            "hash-test",
            localRepo,
            "/remote/repo",
          );

          expect(result.match).toBe(true);
          expect(result.filesChecked).toBe(1);
          expect(result.mismatched).toEqual([]);
        }),
      );

      it.effect("verifySync works when remote host uses shasum -a 256 output format", () =>
        Effect.gen(function* () {
          // Create local skill directory
          const localRepo = tmpDir;
          const skillDir = join(localRepo, "macos-skill");
          yield* Effect.promise(() => mkdir(skillDir, { recursive: true }));
          yield* Effect.promise(() => writeFile(join(skillDir, "config.yaml"), "name: test\n"));

          // Get the actual local checksums
          const localOutput = yield* Effect.promise(() => getLocalChecksums(skillDir));

          // shasum -a 256 produces the same output format as sha256sum:
          // <64-char-hex>  <path>
          // So mock the remote to return the same output (which would be produced
          // by either sha256sum or shasum -a 256)
          const responsesRef = yield* MockSshResponses;
          yield* Ref.set(responsesRef, [
            {
              _tag: "result" as const,
              value: { stdout: localOutput, stderr: "", exitCode: 0 },
            },
          ]);

          const skillOps = yield* SkillOps;
          const result = yield* skillOps.verifySync(
            testHost,
            "macos-skill",
            localRepo,
            "/remote/repo",
          );

          expect(result.match).toBe(true);
          expect(result.filesChecked).toBe(1);
        }),
      );
    });
  });

});

// ──────────────────────────────────────────────────────────────
// Regression tests: edge case fixes
// ──────────────────────────────────────────────────────────────

describe("Regression: discovery propagates errors instead of silently treating as inactive", () => {
  layer(TestLayer)("listSkills error propagation", (it) => {
    it.effect("SSH failure during symlink check propagates (not silently inactive)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // repo exists
          {
            _tag: "result" as const,
            value: { stdout: "exists\n", stderr: "", exitCode: 0 },
          },
          // list directories
          {
            _tag: "result" as const,
            value: { stdout: "my-skill\n", stderr: "", exitCode: 0 },
          },
          // symlink check for my-skill fails with SSH connection error
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "test -L ...",
              exitCode: 255,
              stdout: "",
              stderr: "ssh: connect to host testhost port 22: Connection refused",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .listSkills(testHost, testRepoPath, testActiveDir)
          .pipe(Effect.either);

        // SSH errors during symlink checking must NOT be silently treated
        // as inactive skills. They must propagate as SkillCommandFailed.
        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SkillCommandFailed);
        }
      }),
    );

    it.effect("getSkillStatus propagates connection failure (not silently inactive)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // SSH connection completely fails
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "test -L ... && test -e ...",
              exitCode: 255,
              stdout: "",
              stderr: "Connection timed out",
            }),
          },
        ]);

        const skillOps = yield* SkillOps;
        const result = yield* skillOps
          .getSkillStatus(testHost, "my-skill", testActiveDir)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(SkillCommandFailed);
        }
      }),
    );

    it.effect("broken symlinks still correctly reported as inactive (not an error)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // The command succeeds, but test -e fails for broken symlink
          // → outputs "inactive"
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const status = yield* skillOps.getSkillStatus(testHost, "broken-skill", testActiveDir);

        // Broken symlinks should still be inactive (not an error)
        expect(status).toBe("inactive");
      }),
    );

    it.effect("missing symlinks still correctly reported as inactive (not an error)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "result" as const,
            value: { stdout: "inactive\n", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const status = yield* skillOps.getSkillStatus(testHost, "nonexistent", testActiveDir);

        expect(status).toBe("inactive");
      }),
    );
  });
});

describe("Regression: activateSkill verifies symlink target path matches", () => {
  layer(TestLayer)("wrong-target symlink repointing", (it) => {
    it.effect("repoints symlink when target points to wrong path", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: active (symlink exists and target is valid)
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          // readSymlinkTarget: returns WRONG target path
          {
            _tag: "result" as const,
            value: { stdout: "/old/repo/path/my-skill\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p activeDir
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove existing wrong-target symlink
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s with correct target
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.activateSkill(
          testHost,
          "my-skill",
          testRepoPath,
          testActiveDir,
        );

        // Should NOT be treated as "already in state" since target was wrong
        expect(result.alreadyInState).toBe(false);
        expect(result.status).toBe("active");

        // Verify the ln -s command was called with the correct new target
        const callsAfter = yield* Ref.get(callsRef);
        const lnCall = callsAfter[countBefore + 4]; // 5th call is ln -s
        expect(lnCall).toBeDefined();
        expect(lnCall.command).toContain("ln -s");
        expect(lnCall.command).toContain(`${testRepoPath}/my-skill`);
        expect(lnCall.command).toContain(`${testActiveDir}/my-skill`);
      }),
    );

    it.effect("does not repoint when symlink target matches expected path", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: active
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          // readSymlinkTarget: returns correct target path
          {
            _tag: "result" as const,
            value: { stdout: `${testRepoPath}/my-skill\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const skillOps = yield* SkillOps;
        const result = yield* skillOps.activateSkill(
          testHost,
          "my-skill",
          testRepoPath,
          testActiveDir,
        );

        // Correct target — treated as idempotent
        expect(result.alreadyInState).toBe(true);
        expect(result.status).toBe("active");

        // Only 2 SSH calls: checkSymlink + readSymlinkTarget (no mkdir, rm, or ln)
        const callsAfter = yield* Ref.get(callsRef);
        expect(callsAfter.length - countBefore).toBe(2);
      }),
    );

    it.effect("records repointed span attribute when wrong-target is repointed", () =>
      Effect.gen(function* () {
        const spansRef = yield* CollectedSpans;
        yield* Ref.set(spansRef, []);

        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // checkSymlink: active
          {
            _tag: "result" as const,
            value: { stdout: "active\n", stderr: "", exitCode: 0 },
          },
          // readSymlinkTarget: wrong target
          {
            _tag: "result" as const,
            value: { stdout: "/wrong/path/my-skill\n", stderr: "", exitCode: 0 },
          },
          // mkdir -p
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // remove existing
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
          // ln -s
          {
            _tag: "result" as const,
            value: { stdout: "", stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        yield* skillOps.activateSkill(testHost, "my-skill", testRepoPath, testActiveDir);

        const spans = yield* Ref.get(spansRef);
        const activateSpan = spans.find((s) => s.name === "skill.activateSkill");
        expect(activateSpan).toBeDefined();
        expect(activateSpan!.attributes["skill.repointed"]).toBe(true);
        expect(activateSpan!.attributes["skill.previousTarget"]).toBe("/wrong/path/my-skill");
      }),
    );
  });
});

describe("Regression: drift counts handle missing refs gracefully", () => {
  layer(TestLayer)("missing ref handling", (it) => {
    it.effect("rev-list failure yields undefined ahead/behind (not misleading zeros)", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b (different SHA)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // git rev-list fails (missing ref, shallow clone, etc.)
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "host-b",
              command: "git rev-list ...",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Invalid symmetric difference expression",
            }),
          },
          // getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        expect(report.hasDrift).toBe(true);

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.sha).toBe(driftedSha);
        expect(hostBResult.direction).toBe("diverged");
        // Missing refs → undefined counts, not misleading 0
        expect(hostBResult.ahead).toBeUndefined();
        expect(hostBResult.behind).toBeUndefined();
      }),
    );

    it.effect("valid rev-list still produces numeric counts", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b (drifted)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // git rev-list succeeds: 3 behind, 1 ahead
          {
            _tag: "result" as const,
            value: { stdout: "3\t1\n", stderr: "", exitCode: 0 },
          },
          // getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.direction).toBe("diverged");
        // Valid counts from rev-list
        expect(hostBResult.behind).toBe(3);
        expect(hostBResult.ahead).toBe(1);
      }),
    );

    it.effect("garbled rev-list output treated as missing refs", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          // getHead for host-a (reference)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
          // getHead for host-b (drifted)
          {
            _tag: "result" as const,
            value: { stdout: `${driftedSha}\n`, stderr: "", exitCode: 0 },
          },
          // git rev-list returns garbled output
          {
            _tag: "result" as const,
            value: { stdout: "not-a-number\tgarbage\n", stderr: "", exitCode: 0 },
          },
          // getHead for host-c (in sync)
          {
            _tag: "result" as const,
            value: { stdout: `${refSha}\n`, stderr: "", exitCode: 0 },
          },
        ]);

        const skillOps = yield* SkillOps;
        const report = yield* skillOps.checkDrift(allHosts, repoPath, "host-a");

        const hostBResult = report.hosts.find((h) => h.host === "host-b")!;
        expect(hostBResult.status).toBe("drifted");
        expect(hostBResult.direction).toBe("diverged");
        // Garbled output → undefined counts (same as missing refs)
        expect(hostBResult.ahead).toBeUndefined();
        expect(hostBResult.behind).toBeUndefined();
      }),
    );
  });
});
