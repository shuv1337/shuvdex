/**
 * Test SSH executor layer with configurable mock responses.
 *
 * Allows tests to define expected command results or errors
 * without making actual SSH connections.
 */
import { Context, Effect, Layer, Ref } from "effect";
import { SshExecutor } from "./types.js";
import type { CommandResult, ExecuteCommandOptions } from "./types.js";
import type { HostConfig } from "@codex-fleet/core";
import type { ConnectionFailed, ConnectionTimeout, CommandFailed, CommandTimeout } from "./errors.js";

/**
 * A mock response entry - either a successful result or an error.
 */
export type MockResponse =
  | { readonly _tag: "result"; readonly value: CommandResult }
  | {
      readonly _tag: "error";
      readonly value: ConnectionFailed | ConnectionTimeout | CommandFailed | CommandTimeout;
    };

/**
 * Recorded call to the mock SSH executor.
 */
export interface RecordedCall {
  readonly host: HostConfig;
  readonly command: string;
  readonly options?: ExecuteCommandOptions;
}

/**
 * Tag for the mock responses ref.
 */
export class MockSshResponses extends Context.Tag("MockSshResponses")<
  MockSshResponses,
  Ref.Ref<Array<MockResponse>>
>() {}

/**
 * Tag for recorded SSH calls.
 */
export class RecordedSshCalls extends Context.Tag("RecordedSshCalls")<
  RecordedSshCalls,
  Ref.Ref<Array<RecordedCall>>
>() {}

/**
 * Creates a test SSH executor layer that returns pre-configured responses.
 *
 * Responses are consumed in order (FIFO). If no responses remain,
 * the executor returns a default success result.
 */
export const SshExecutorTest: Layer.Layer<
  SshExecutor | MockSshResponses | RecordedSshCalls
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const responsesRef = yield* Ref.make<Array<MockResponse>>([]);
    const callsRef = yield* Ref.make<Array<RecordedCall>>([]);

    const service = SshExecutor.of({
      executeCommand: (
        host: HostConfig,
        command: string,
        options?: ExecuteCommandOptions,
      ) =>
        Effect.gen(function* () {
          // Record the call
          yield* Ref.update(callsRef, (calls) => [
            ...calls,
            { host, command, options },
          ]);

          // Get the next response
          const responses = yield* Ref.get(responsesRef);

          if (responses.length === 0) {
            // Default: return empty success
            return { stdout: "", stderr: "", exitCode: 0 } as CommandResult;
          }

          // Pop first response
          const [response, ...rest] = responses;
          yield* Ref.set(responsesRef, rest);

          if (response._tag === "error") {
            return yield* Effect.fail(response.value);
          }

          return response.value;
        }),
    });

    return Layer.mergeAll(
      Layer.succeed(SshExecutor, service),
      Layer.succeed(MockSshResponses, responsesRef),
      Layer.succeed(RecordedSshCalls, callsRef),
    );
  }),
);
