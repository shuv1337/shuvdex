import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import {
  SkillOps,
  SkillOpsLive,
  SkillCommandFailed,
  SkillRepoNotFound,
} from "../src/index.js";
import {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  CommandFailed,
} from "@codex-fleet/ssh";
import { TelemetryTest, CollectedSpans } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

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
 * Combined test layer: mock SSH + test telemetry + SkillOps backed by mock SSH.
 */
const SkillOpsTestLayer = SkillOpsLive.pipe(Layer.provide(SshExecutorTest));
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

    it.effect("returns 'inactive' when SSH command fails", () =>
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
        const status = yield* skillOps.getSkillStatus(testHost, "my-skill", testActiveDir);

        // Should gracefully default to inactive, not error
        expect(status).toBe("inactive");
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
