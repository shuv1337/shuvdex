import { Effect, Layer, Ref, Schema } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  CapabilityDefinition,
  CapabilityPackage as CapabilityPackageSchema,
} from "./schema.js";
import type { CapabilityPackage } from "./schema.js";
import {
  CapabilityAlreadyExists,
  CapabilityNotFound,
  CapabilityPackageAlreadyExists,
  CapabilityPackageNotFound,
  CapabilityRegistryIOError,
  CapabilityRegistryValidationError,
  CannotRemoveBuiltInPackage,
} from "./errors.js";
import type {
  CapabilityFilter,
  CapabilityPackageFilter,
  CapabilityRegistryService,
  CreateCapabilityPackageInput,
  UpdateCapabilityPackageInput,
} from "./types.js";
import { CapabilityRegistry } from "./types.js";

function messageFromUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const filePathForPackage = (dir: string, packageId: string) =>
  path.join(dir, `${packageId}.yaml`);

function validatePackageConsistency(pkg: CapabilityPackage): string | null {
  const seen = new Set<string>();
  for (const capability of pkg.capabilities) {
    if (capability.packageId !== pkg.id) {
      return `Capability ${capability.id} must reference packageId ${pkg.id}`;
    }
    if (capability.version !== pkg.version) {
      return `Capability ${capability.id} must use package version ${pkg.version}`;
    }
    if (seen.has(capability.id)) {
      return `Duplicate capability id ${capability.id}`;
    }
    seen.add(capability.id);
    const payload =
      capability.kind === "tool"
        ? capability.tool
        : capability.kind === "resource"
          ? capability.resource
          : capability.kind === "prompt"
            ? capability.prompt
            : capability.kind === "module"
              ? capability.module
              : capability.connector;
    if (payload === undefined) {
      return `Capability ${capability.id} is missing ${capability.kind} configuration`;
    }
  }
  return null;
}

function readPackages(dir: string): CapabilityPackage[] {
  const packages: CapabilityPackage[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml") && !file.endsWith(".json")) {
      continue;
    }
    try {
      const absolute = path.join(dir, file);
      const raw = file.endsWith(".json")
        ? JSON.parse(fs.readFileSync(absolute, "utf-8"))
        : yamlParse(fs.readFileSync(absolute, "utf-8"));
      const decoded = Schema.decodeUnknownSync(CapabilityPackageSchema)(raw);
      packages.push(decoded);
    } catch {
      // ignore malformed package files during load
    }
  }
  return packages;
}

function writePackage(dir: string, pkg: CapabilityPackage): void {
  fs.writeFileSync(filePathForPackage(dir, pkg.id), yamlStringify(pkg), "utf-8");
}

const decodePackage = (
  input: unknown,
  nameHint?: string,
): Effect.Effect<CapabilityPackage, CapabilityRegistryValidationError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(CapabilityPackageSchema)(input),
    catch: (cause) =>
      new CapabilityRegistryValidationError({
        name: nameHint,
        issues: messageFromUnknown(cause),
      }),
  });

export function _makeCoreOps(
  storeRef: Ref.Ref<Map<string, CapabilityPackage>>,
): Omit<CapabilityRegistryService, "loadFromDirectory" | "saveToDirectory"> {
  return {
    listPackages(filter?: CapabilityPackageFilter) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        let values = Array.from(store.values());
        if (filter?.enabled !== undefined) {
          values = values.filter((item) => item.enabled === filter.enabled);
        }
        if (filter?.builtIn !== undefined) {
          values = values.filter((item) => item.builtIn === filter.builtIn);
        }
        if (filter?.tag) {
          values = values.filter((item) => item.tags?.includes(filter.tag!) ?? false);
        }
        return values.sort((a, b) => a.id.localeCompare(b.id));
      });
    },

    getPackage(packageId: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const pkg = store.get(packageId);
        if (pkg === undefined) {
          return yield* Effect.fail(new CapabilityPackageNotFound({ packageId }));
        }
        return pkg;
      });
    },

    createPackage(input: CreateCapabilityPackageInput) {
      return Effect.gen(function* () {
        const decoded = yield* decodePackage(input, input.id);
        const consistencyError = validatePackageConsistency(decoded);
        if (consistencyError) {
          return yield* Effect.fail(
            new CapabilityRegistryValidationError({ name: decoded.id, issues: consistencyError }),
          );
        }
        const store = yield* Ref.get(storeRef);
        if (store.has(decoded.id)) {
          return yield* Effect.fail(new CapabilityPackageAlreadyExists({ packageId: decoded.id }));
        }
        const now = new Date().toISOString();
        const created: CapabilityPackage = {
          ...decoded,
          createdAt: now,
          updatedAt: now,
        };
        yield* Ref.update(storeRef, (state) => new Map(state).set(created.id, created));
        return created;
      });
    },

    upsertPackage(input: CapabilityPackage) {
      return Effect.gen(function* () {
        const decoded = yield* decodePackage(input, input.id);
        const consistencyError = validatePackageConsistency(decoded);
        if (consistencyError) {
          return yield* Effect.fail(
            new CapabilityRegistryValidationError({ name: decoded.id, issues: consistencyError }),
          );
        }
        const store = yield* Ref.get(storeRef);
        const existing = store.get(decoded.id);
        const now = new Date().toISOString();
        const next: CapabilityPackage = {
          ...decoded,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        };
        yield* Ref.update(storeRef, (state) => new Map(state).set(next.id, next));
        return next;
      });
    },

    updatePackage(packageId: string, patch: UpdateCapabilityPackageInput) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(packageId);
        if (existing === undefined) {
          return yield* Effect.fail(new CapabilityPackageNotFound({ packageId }));
        }
        const next = yield* decodePackage({
          ...existing,
          ...patch,
          id: existing.id,
          builtIn: existing.builtIn,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString(),
        }, packageId);
        const consistencyError = validatePackageConsistency(next);
        if (consistencyError) {
          return yield* Effect.fail(
            new CapabilityRegistryValidationError({ name: packageId, issues: consistencyError }),
          );
        }
        yield* Ref.update(storeRef, (state) => new Map(state).set(packageId, next));
        return next;
      });
    },

    deletePackage(packageId: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const existing = store.get(packageId);
        if (existing === undefined) {
          return yield* Effect.fail(new CapabilityPackageNotFound({ packageId }));
        }
        if (existing.builtIn) {
          return yield* Effect.fail(new CannotRemoveBuiltInPackage({ packageId }));
        }
        yield* Ref.update(storeRef, (state) => {
          const next = new Map(state);
          next.delete(packageId);
          return next;
        });
      });
    },

    listCapabilities(filter?: CapabilityFilter) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        const capabilities = Array.from(store.values()).flatMap((pkg) =>
          pkg.capabilities
            .filter((capability) => pkg.enabled && capability.enabled)
            .filter((capability) =>
              filter?.packageId ? capability.packageId === filter.packageId : true,
            )
            .filter((capability) =>
              filter?.kind ? capability.kind === filter.kind : true,
            )
            .filter((capability) =>
              filter?.enabled !== undefined ? capability.enabled === filter.enabled : true,
            )
            .filter((capability) =>
              filter?.tag ? capability.tags?.includes(filter.tag!) ?? false : true,
            ),
        );
        return capabilities.sort((a, b) => a.id.localeCompare(b.id));
      });
    },

    getCapability(capabilityId: string) {
      return Effect.gen(function* () {
        const store = yield* Ref.get(storeRef);
        for (const pkg of store.values()) {
          const capability = pkg.capabilities.find((item) => item.id === capabilityId);
          if (capability) {
            return capability;
          }
        }
        return yield* Effect.fail(new CapabilityNotFound({ capabilityId }));
      });
    },

    enableCapability(capabilityId: string) {
      return toggleCapability(storeRef, capabilityId, true);
    },

    disableCapability(capabilityId: string) {
      return toggleCapability(storeRef, capabilityId, false);
    },
  };
}

const toggleCapability = (
  storeRef: Ref.Ref<Map<string, CapabilityPackage>>,
  capabilityId: string,
  enabled: boolean,
) =>
  Effect.gen(function* () {
    const store = yield* Ref.get(storeRef);
    for (const [packageId, pkg] of store.entries()) {
      const capability = pkg.capabilities.find((item) => item.id === capabilityId);
      if (!capability) {
        continue;
      }
      const nextPackage: CapabilityPackage = {
        ...pkg,
        updatedAt: new Date().toISOString(),
        capabilities: pkg.capabilities.map((item) =>
          item.id === capabilityId ? { ...item, enabled } : item,
        ),
      };
      yield* Ref.update(storeRef, (state) => new Map(state).set(packageId, nextPackage));
      return nextPackage.capabilities.find((item) => item.id === capabilityId)!;
    }
    return yield* Effect.fail(new CapabilityNotFound({ capabilityId }));
  });

export function makeCapabilityRegistryLive(
  packagesDir?: string,
): Layer.Layer<CapabilityRegistry> {
  const dir =
    packagesDir ??
    fs.mkdtempSync(path.join(os.tmpdir(), "codex-fleet-capabilities-"));
  fs.mkdirSync(dir, { recursive: true });

  const storeRef = Ref.unsafeMake(
    new Map(readPackages(dir).map((pkg) => [pkg.id, pkg] as const)),
  );
  const core = _makeCoreOps(storeRef);

  const persistPackage = (pkg: CapabilityPackage) =>
    Effect.try({
      try: () => writePackage(dir, pkg),
      catch: (cause) =>
        new CapabilityRegistryIOError({ path: dir, cause: String(cause) }),
    });

  const findPackageForCapability = (capabilityId: string) =>
    Effect.gen(function* () {
      const store = yield* Ref.get(storeRef);
      for (const pkg of store.values()) {
        if (pkg.capabilities.some((capability) => capability.id === capabilityId)) {
          return pkg;
        }
      }
      return yield* Effect.fail(new CapabilityNotFound({ capabilityId }));
    });

  const service: CapabilityRegistryService = {
    ...core,
    createPackage: (input) =>
      core.createPackage(input).pipe(Effect.tap((pkg) => persistPackage(pkg))),
    upsertPackage: (input) =>
      core.upsertPackage(input).pipe(Effect.tap((pkg) => persistPackage(pkg))),
    updatePackage: (packageId, patch) =>
      core.updatePackage(packageId, patch).pipe(
        Effect.tap((pkg) => persistPackage(pkg)),
      ),
    deletePackage: (packageId) =>
      core.deletePackage(packageId).pipe(
        Effect.tap(() =>
          Effect.try({
            try: () => fs.rmSync(filePathForPackage(dir, packageId), { force: true }),
            catch: (cause) =>
              new CapabilityRegistryIOError({ path: dir, cause: String(cause) }),
          }),
        ),
      ),
    enableCapability: (capabilityId) =>
      core.enableCapability(capabilityId).pipe(
        Effect.flatMap((capability) =>
          findPackageForCapability(capability.id).pipe(
            Effect.flatMap((pkg) => persistPackage(pkg)),
            Effect.as(capability),
          ),
        ),
      ),
    disableCapability: (capabilityId) =>
      core.disableCapability(capabilityId).pipe(
        Effect.flatMap((capability) =>
          findPackageForCapability(capability.id).pipe(
            Effect.flatMap((pkg) => persistPackage(pkg)),
            Effect.as(capability),
          ),
        ),
      ),
    loadFromDirectory: (loadDir) =>
      Effect.gen(function* () {
        const loaded = yield* Effect.try({
          try: () => readPackages(loadDir),
          catch: (cause) =>
            new CapabilityRegistryIOError({ path: loadDir, cause: String(cause) }),
        });
        for (const pkg of loaded) {
          yield* core.upsertPackage(pkg);
        }
        return loaded;
      }),
    saveToDirectory: (saveDir) =>
      Effect.gen(function* () {
        yield* Effect.try({
          try: () => fs.mkdirSync(saveDir, { recursive: true }),
          catch: (cause) =>
            new CapabilityRegistryIOError({ path: saveDir, cause: String(cause) }),
        });
        const packages = yield* core.listPackages();
        for (const pkg of packages) {
          yield* Effect.try({
            try: () => writePackage(saveDir, pkg),
            catch: (cause) =>
              new CapabilityRegistryIOError({ path: saveDir, cause: String(cause) }),
          });
        }
      }),
  };

  return Layer.succeed(CapabilityRegistry, service);
}

export const CapabilityRegistryLive: Layer.Layer<CapabilityRegistry> =
  makeCapabilityRegistryLive();
