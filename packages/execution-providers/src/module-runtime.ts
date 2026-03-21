import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { CapabilityDefinition } from "@codex-fleet/capability-registry";
import { recordError, withSpan } from "@codex-fleet/telemetry";
import type { ExecutionResult } from "./types.js";

interface ModuleRuntimeRequest {
  readonly capabilityId: string;
  readonly packageId: string;
  readonly version: string;
  readonly args: Record<string, unknown>;
}

function logExecution(event: Record<string, unknown>): void {
  process.stderr.write(`${JSON.stringify(event)}\n`);
}

function commandForTarget(target: string): { command: string; args: string[] } {
  const ext = path.extname(target).toLowerCase();
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return { command: process.execPath, args: [target] };
  }
  if (ext === ".py") {
    return { command: "python3", args: [target] };
  }
  return { command: target, args: [] };
}

function normalizeResult(stdout: string): ExecutionResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      payload: {
        ok: true,
      },
    } satisfies ExecutionResult;
  }

  const parsed = JSON.parse(trimmed) as ExecutionResult | Record<string, unknown>;
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "payload" in parsed
  ) {
    return parsed as ExecutionResult;
  }

  return {
    payload: parsed,
  } satisfies ExecutionResult;
}

export function executeModuleRuntime(
  capability: CapabilityDefinition,
  args: Record<string, unknown>,
): Effect.Effect<ExecutionResult> {
  const target = capability.executorRef?.target;
  if (!target) {
    return Effect.succeed({
      payload: {
        error: "module_runtime executor is missing target",
        capabilityId: capability.id,
      },
      isError: true,
    } satisfies ExecutionResult);
  }

  return withSpan("execution.module_runtime", {
    attributes: {
      capabilityId: capability.id,
      packageId: capability.packageId,
      executorType: capability.executorRef?.executorType ?? "module_runtime",
      target,
    },
  })(
    Effect.tryPromise({
      try: async () => {
        const resolvedTarget = path.resolve(target);
        if (!fs.existsSync(resolvedTarget)) {
          throw new Error(`module_runtime target does not exist: ${resolvedTarget}`);
        }

        const request: ModuleRuntimeRequest = {
          capabilityId: capability.id,
          packageId: capability.packageId,
          version: capability.version,
          args,
        };

        const { command, args: commandArgs } = commandForTarget(resolvedTarget);
        const timeoutMs = capability.executorRef?.timeoutMs ?? capability.tool?.timeoutMs ?? 20_000;
        const startTime = Date.now();

        logExecution({
          level: "info",
          event: "module_runtime.start",
          capabilityId: capability.id,
          packageId: capability.packageId,
          target: resolvedTarget,
          timeoutMs,
        });

        const result = await new Promise<ExecutionResult>((resolve, reject) => {
          const child = spawn(command, commandArgs, {
            cwd: path.dirname(resolvedTarget),
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
          });

          let stdout = "";
          let stderr = "";
          let settled = false;

          const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill("SIGKILL");
            reject(new Error(`module_runtime timed out after ${timeoutMs}ms`));
          }, timeoutMs);

          child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
          });
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
          });
          child.on("error", (error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(error);
          });
          child.on("close", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
              reject(new Error(stderr.trim() || `module_runtime exited with code ${code}`));
              return;
            }
            try {
              resolve(normalizeResult(stdout));
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new Error(String(error)),
              );
            }
          });

          child.stdin.write(JSON.stringify(request));
          child.stdin.end();
        });

        logExecution({
          level: "info",
          event: "module_runtime.success",
          capabilityId: capability.id,
          packageId: capability.packageId,
          target: resolvedTarget,
          durationMs: Date.now() - startTime,
          isError: result.isError === true,
        });

        return result;
      },
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    }).pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          logExecution({
            level: "error",
            event: "module_runtime.failure",
            capabilityId: capability.id,
            packageId: capability.packageId,
            target,
            error: error.message,
          });
        }).pipe(Effect.zipRight(recordError(error))),
      ),
      Effect.catchAll((error) =>
        Effect.succeed({
          payload: {
            error: error.message,
            capabilityId: capability.id,
            target,
          },
          isError: true,
        } satisfies ExecutionResult),
      ),
    ),
  );
}
