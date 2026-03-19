import { Context, Effect, Layer, Ref } from "effect";
import { CapabilityRegistry } from "./types.js";
import type { CapabilityPackage } from "./schema.js";
import { _makeCoreOps } from "./live.js";
import type {
  CapabilityRegistryIOError,
  CapabilityRegistryValidationError,
} from "./errors.js";

export class MockCapabilityStore extends Context.Tag("MockCapabilityStore")<
  MockCapabilityStore,
  Ref.Ref<Map<string, CapabilityPackage>>
>() {}

export const CapabilityRegistryTest: Layer.Layer<
  CapabilityRegistry | MockCapabilityStore
> = Layer.unwrapEffect(
  Effect.gen(function* () {
    const storeRef = yield* Ref.make(new Map<string, CapabilityPackage>());
    const core = _makeCoreOps(storeRef);
    return Layer.mergeAll(
      Layer.succeed(
        CapabilityRegistry,
        CapabilityRegistry.of({
          ...core,
          loadFromDirectory: (
            _dir: string,
          ): Effect.Effect<
            CapabilityPackage[],
            CapabilityRegistryIOError | CapabilityRegistryValidationError
          > => Effect.succeed([]),
          saveToDirectory: (_dir: string): Effect.Effect<void, CapabilityRegistryIOError> =>
            Effect.void,
        }),
      ),
      Layer.succeed(MockCapabilityStore, storeRef),
    );
  }),
);
