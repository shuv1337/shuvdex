import { it, layer } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Effect, Layer } from "effect";
import { GitOps, GitOpsLive } from "../src/index.js";
import { SshExecutor, SshExecutorLive } from "@codex-fleet/ssh";
import { TelemetryTest } from "@codex-fleet/telemetry";
import type { HostConfig } from "@codex-fleet/core";

/**
 * Host config pointing to shuvtest (Linux) for integration tests.
 */
const shuvtestHost: HostConfig = {
  hostname: "shuvtest",
  connectionType: "ssh",
  port: 22,
  timeout: 10,
};

/**
 * The git repository path on test hosts.
 */
const repoPath = "~/repos/shuvbot-skills";

/**
 * Live SSH executor + test telemetry + GitOps for integration tests.
 *
 * GitOpsLive requires SshExecutor, so we provide SshExecutorLive to it,
 * then merge all layers so tests can access both GitOps and SshExecutor.
 */
const GitOpsIntegration = GitOpsLive.pipe(Layer.provide(SshExecutorLive));
const IntegrationLayer = Layer.mergeAll(SshExecutorLive, TelemetryTest, GitOpsIntegration);

describe("GitOps Live (integration)", () => {
  layer(IntegrationLayer)("read operations on shuvtest", (it) => {
    it.effect("getHead returns a valid 40-char hex SHA", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const sha = yield* gitOps.getHead(shuvtestHost, repoPath);

        expect(sha).toHaveLength(40);
        expect(sha).toMatch(/^[0-9a-f]{40}$/);
      }),
    );

    it.effect("getBranch returns a non-empty branch name", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);

        expect(branch).toBeTruthy();
        expect(typeof branch).toBe("string");
        // Should be either a branch name or "HEAD" for detached
        expect(branch.length).toBeGreaterThan(0);
      }),
    );

    it.effect("isDirty returns a boolean", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const dirty = yield* gitOps.isDirty(shuvtestHost, repoPath);

        expect(typeof dirty).toBe("boolean");
      }),
    );

    it.effect("listTags returns an array of strings", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const tags = yield* gitOps.listTags(shuvtestHost, repoPath);

        expect(Array.isArray(tags)).toBe(true);
        for (const tag of tags) {
          expect(typeof tag).toBe("string");
          expect(tag.length).toBeGreaterThan(0);
        }
      }),
    );

    it.effect("getHead result matches direct SSH git rev-parse HEAD", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const sha = yield* gitOps.getHead(shuvtestHost, repoPath);

        // Also verify via direct SSH command
        const ssh = yield* SshExecutor;
        const directResult = yield* ssh.executeCommand(
          shuvtestHost,
          `cd ${repoPath} && git rev-parse HEAD`,
        );
        const directSha = directResult.stdout.trim();

        expect(sha).toBe(directSha);
      }),
    );

    it.effect("getBranch result matches direct SSH git branch check", () =>
      Effect.gen(function* () {
        const gitOps = yield* GitOps;
        const branch = yield* gitOps.getBranch(shuvtestHost, repoPath);

        // Verify via direct SSH command
        const ssh = yield* SshExecutor;
        const directResult = yield* ssh
          .executeCommand(
            shuvtestHost,
            `cd ${repoPath} && git symbolic-ref --short HEAD`,
          )
          .pipe(
            Effect.catchTag("CommandFailed", () =>
              Effect.succeed({ stdout: "HEAD\n", stderr: "", exitCode: 0 }),
            ),
          );
        const directBranch = directResult.stdout.trim();

        expect(branch).toBe(directBranch);
      }),
    );
  });
});
