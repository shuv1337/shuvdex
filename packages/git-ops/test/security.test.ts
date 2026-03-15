import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Ref, Layer } from "effect";
import {
  GitOps,
  GitOpsLive,
  AuthError,
} from "../src/index.js";
import {
  SshExecutorTest,
  MockSshResponses,
  RecordedSshCalls,
  CommandFailed,
} from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
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

const testRepoPath = "~/repos/test-repo";

/**
 * Combined test layer: mock SSH + test telemetry + GitOps backed by mock SSH.
 */
const GitOpsTestLayer = GitOpsLive.pipe(Layer.provide(SshExecutorTest));
const TestLayer = Layer.mergeAll(SshExecutorTest, TelemetryTest, GitOpsTestLayer);

// ---------------------------------------------------------------------------
// Shell injection prevention in createTag
// ---------------------------------------------------------------------------
describe("createTag shell injection prevention", () => {
  layer(TestLayer)("metacharacters in tag name", (it) => {
    it.effect("escapes shell metacharacters in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0; rm -rf /");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // The dangerous characters must be inside single quotes so the shell
        // treats them as literal text, not as operators
        expect(lastCall.command).toContain("'v1.0; rm -rf /'");
      }),
    );

    it.effect("escapes backticks in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "`whoami`");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // The backticks must be inside single quotes
        expect(lastCall.command).toContain("'`whoami`'");
      }),
    );

    it.effect("escapes $() command substitution in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "$(whoami)");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // The $() must be inside single quotes
        expect(lastCall.command).toContain("'$(whoami)'");
      }),
    );

    it.effect("handles spaces in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "my tag name");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // The tag name should be passed as a single quoted argument
        expect(lastCall.command).toContain("'my tag name'");
      }),
    );

    it.effect("handles leading dash in tag name (flag injection)", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "--delete");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Leading dash must be handled with -- separator so git doesn't
        // treat it as a flag, AND it should be quoted
        expect(cmd).toContain("git tag --");
        expect(cmd).toContain("'--delete'");
      }),
    );

    it.effect("escapes single quotes in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "it's-a-tag");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        // Single quotes within the tag name must be properly escaped
        // using the '\'' idiom (end quote, escaped quote, reopen quote)
        const cmd = lastCall.command;
        expect(cmd).toContain("'it'\\''s-a-tag'");
      }),
    );

    it.effect("escapes double quotes in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, 'tag"name');

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Double quotes inside single quotes are safe
        expect(cmd).toContain("'tag\"name'");
      }),
    );

    it.effect("escapes pipe in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1|cat /etc/passwd");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Pipe must be inside single quotes
        expect(cmd).toContain("'v1|cat /etc/passwd'");
      }),
    );

    it.effect("escapes ampersand in tag name", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1&&echo hacked");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // && must be inside single quotes
        expect(cmd).toContain("'v1&&echo hacked'");
      }),
    );
  });

  layer(TestLayer)("metacharacters in ref argument", (it) => {
    it.effect("escapes shell metacharacters in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0", "abc123; rm -rf /");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // The ref must be properly single-quoted so injection characters are literal
        expect(cmd).toContain("'abc123; rm -rf /'");
      }),
    );

    it.effect("handles leading dash in ref (flag injection)", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0", "--amend");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Leading dash in ref must use -- separator AND be quoted
        expect(cmd).toContain("git tag --");
        expect(cmd).toContain("'--amend'");
      }),
    );

    it.effect("handles spaces in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.createTag(testHost, testRepoPath, "v1.0", "abc 123");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Spaces in ref must be properly quoted
        expect(cmd).toContain("'abc 123'");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Shell injection prevention in checkoutRef
// ---------------------------------------------------------------------------
describe("checkoutRef shell injection prevention", () => {
  layer(TestLayer)("metacharacters in ref", (it) => {
    it.effect("escapes shell metacharacters in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "main; rm -rf /");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // The ref must be properly single-quoted so injection is literal
        expect(cmd).toContain("'main; rm -rf /'");
      }),
    );

    it.effect("escapes backticks in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "`whoami`");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Backticks must be inside single quotes
        expect(cmd).toContain("'`whoami`'");
      }),
    );

    it.effect("escapes $() command substitution in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "$(id)");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // $() must be inside single quotes
        expect(cmd).toContain("'$(id)'");
      }),
    );

    it.effect("handles spaces in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "my branch");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Spaces must be properly quoted
        expect(cmd).toContain("'my branch'");
      }),
    );

    it.effect("handles leading dash in ref (flag injection)", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "--force");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Must use -- separator AND quote the ref
        expect(cmd).toContain("git checkout --");
        expect(cmd).toContain("'--force'");
      }),
    );

    it.effect("handles pipe in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "main|cat /etc/passwd");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Pipe must be inside single quotes
        expect(cmd).toContain("'main|cat /etc/passwd'");
      }),
    );

    it.effect("handles newline in ref", () =>
      Effect.gen(function* () {
        const callsRef = yield* RecordedSshCalls;
        const callsBefore = yield* Ref.get(callsRef);
        const countBefore = callsBefore.length;

        const gitOps = yield* GitOps;
        yield* gitOps.checkoutRef(testHost, testRepoPath, "main\necho hacked");

        const callsAfter = yield* Ref.get(callsRef);
        const lastCall = callsAfter[countBefore];
        const cmd = lastCall.command;
        // Newline must be inside single quotes
        expect(cmd).toContain("'main\necho hacked'");
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// AuthError credential redaction
// ---------------------------------------------------------------------------
describe("AuthError credential redaction", () => {
  it("redacts credentials from URL in stderr", () => {
    const err = new AuthError({
      host: "testhost",
      stderr: "fatal: Authentication failed for 'https://user:s3cret@github.com/org/repo.git'\n",
    });
    // The stderr field must NOT contain the password
    expect(err.stderr).not.toContain("s3cret");
    // But it should still be useful for debugging
    expect(err.stderr).toContain("github.com");
  });

  it("redacts credentials from multiple URLs in stderr", () => {
    const err = new AuthError({
      host: "testhost",
      stderr: [
        "remote: Invalid credentials",
        "fatal: Authentication failed for 'https://admin:p@ssw0rd@git.example.com/repo.git'",
        "Also tried https://token:ghp_secret123@github.com/org/repo.git",
      ].join("\n"),
    });
    expect(err.stderr).not.toContain("p@ssw0rd");
    expect(err.stderr).not.toContain("ghp_secret123");
    expect(err.stderr).toContain("git.example.com");
    expect(err.stderr).toContain("github.com");
  });

  it("preserves non-credential URLs in stderr", () => {
    const err = new AuthError({
      host: "testhost",
      stderr: "fatal: Could not read from remote repository.\nPlease make sure you have the correct access rights.\n",
    });
    // No URLs with credentials, so stderr should be unchanged
    expect(err.stderr).toContain("Could not read from remote repository");
  });

  it("does not expose credentials in message getter", () => {
    const err = new AuthError({
      host: "testhost",
      stderr: "fatal: Authentication failed for 'https://user:secret@host.com/repo.git'\n",
    });
    expect(err.message).not.toContain("secret");
    expect(err.message).not.toContain("user:");
  });

  it("redacts token-style credentials from stderr", () => {
    const err = new AuthError({
      host: "testhost",
      stderr: "fatal: Authentication failed for 'https://x-access-token:ghs_abcdef12345@github.com/org/repo.git'\n",
    });
    expect(err.stderr).not.toContain("ghs_abcdef12345");
    expect(err.stderr).toContain("github.com");
  });

  layer(TestLayer)("AuthError from execGit redacts credentials", (it) => {
    it.effect("redacts credentials when AuthError is produced from git command", () =>
      Effect.gen(function* () {
        const responsesRef = yield* MockSshResponses;
        yield* Ref.set(responsesRef, [
          {
            _tag: "error" as const,
            value: new CommandFailed({
              host: "testhost",
              command: "cd ~/repos/test-repo && git pull origin",
              exitCode: 128,
              stdout: "",
              stderr: "fatal: Authentication failed for 'https://user:mysecretpassword@github.com/org/repo.git'\n",
            }),
          },
        ]);

        const gitOps = yield* GitOps;
        const result = yield* gitOps
          .pull(testHost, testRepoPath)
          .pipe(Effect.either);

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(AuthError);
          const err = result.left as AuthError;
          // Must NOT contain the password
          expect(err.stderr).not.toContain("mysecretpassword");
          // Should still contain useful debugging info
          expect(err.stderr).toContain("github.com");
          expect(err.stderr).toContain("Authentication failed");
        }
      }),
    );
  });
});
