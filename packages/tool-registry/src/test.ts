/**
 * In-memory test layer for the tool registry.
 *
 * Shares the core CRUD logic with the live layer (_makeCoreOps), but
 * replaces file I/O with no-ops so tests never touch the file system.
 *
 * Exposes MockToolStore so tests can pre-populate the registry and inspect
 * its contents directly via Ref.
 */
import { Context, Effect, Layer, Ref } from "effect";
import { ToolRegistry } from "./types.js";
import type { ToolDefinition as ToolDefinitionType } from "./schema.js";
import { _makeCoreOps } from "./live.js";
import type { ToolRegistryIOError, ToolValidationError } from "./errors.js";

/**
 * Tag for the in-memory tool store reference.
 *
 * Exposed so tests can:
 * - Pre-populate the registry before running operations
 * - Inspect the current registry state after running operations
 *
 * Example:
 * ```typescript
 * const store = yield* MockToolStore;
 * yield* Ref.update(store, (s) => new Map(s).set("my_tool", toolDef));
 * ```
 */
export class MockToolStore extends Context.Tag("MockToolStore")<
  MockToolStore,
  Ref.Ref<Map<string, ToolDefinitionType>>
>() {}

/**
 * In-memory tool registry test layer.
 *
 * - All CRUD operations work against an in-memory Map via Ref
 * - loadFromDirectory returns an empty array without reading any files
 * - saveToDirectory returns void without writing any files
 * - MockToolStore is provided for test setup and inspection
 */
export const ToolRegistryTest: Layer.Layer<
  ToolRegistry | MockToolStore
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const storeRef = yield* Ref.make(new Map<string, ToolDefinitionType>());

    const service = ToolRegistry.of({
      ..._makeCoreOps(storeRef),

      loadFromDirectory: (
        _dir: string,
      ): Effect.Effect<
        ToolDefinitionType[],
        ToolRegistryIOError | ToolValidationError
      > => Effect.succeed([] as ToolDefinitionType[]),

      saveToDirectory: (
        _dir: string,
      ): Effect.Effect<void, ToolRegistryIOError> => Effect.void,
    });

    return Layer.mergeAll(
      Layer.succeed(ToolRegistry, service),
      Layer.succeed(MockToolStore, storeRef),
    );
  }),
);
