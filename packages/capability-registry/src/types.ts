import { Context, Effect } from "effect";
import type {
  CapabilityDefinition,
  CapabilityPackage,
  CapabilityKind,
} from "./schema.js";
import type {
  CapabilityAlreadyExists,
  CapabilityNotFound,
  CapabilityPackageAlreadyExists,
  CapabilityPackageNotFound,
  CapabilityRegistryIOError,
  CapabilityRegistryValidationError,
  CannotRemoveBuiltInPackage,
} from "./errors.js";

export type { CapabilityDefinition, CapabilityPackage } from "./schema.js";

export interface CapabilityPackageFilter {
  readonly enabled?: boolean;
  readonly builtIn?: boolean;
  readonly tag?: string;
}

export interface CapabilityFilter {
  readonly kind?: CapabilityKind;
  readonly enabled?: boolean;
  readonly packageId?: string;
  readonly tag?: string;
}

export type CreateCapabilityPackageInput = Omit<
  CapabilityPackage,
  "createdAt" | "updatedAt"
>;

export type UpdateCapabilityPackageInput = Partial<
  Omit<CapabilityPackage, "id" | "builtIn" | "createdAt" | "updatedAt">
>;

export interface CapabilityRegistryService {
  readonly listPackages: (
    filter?: CapabilityPackageFilter,
  ) => Effect.Effect<CapabilityPackage[]>;
  readonly getPackage: (
    packageId: string,
  ) => Effect.Effect<CapabilityPackage, CapabilityPackageNotFound>;
  readonly createPackage: (
    input: CreateCapabilityPackageInput,
  ) => Effect.Effect<
    CapabilityPackage,
    | CapabilityPackageAlreadyExists
    | CapabilityRegistryValidationError
    | CapabilityRegistryIOError
  >;
  readonly upsertPackage: (
    input: CapabilityPackage,
  ) => Effect.Effect<
    CapabilityPackage,
    CapabilityRegistryValidationError | CapabilityRegistryIOError
  >;
  readonly updatePackage: (
    packageId: string,
    patch: UpdateCapabilityPackageInput,
  ) => Effect.Effect<
    CapabilityPackage,
    | CapabilityPackageNotFound
    | CapabilityRegistryValidationError
    | CapabilityRegistryIOError
  >;
  readonly deletePackage: (
    packageId: string,
  ) => Effect.Effect<
    void,
    CapabilityPackageNotFound | CannotRemoveBuiltInPackage | CapabilityRegistryIOError
  >;
  readonly listCapabilities: (
    filter?: CapabilityFilter,
  ) => Effect.Effect<CapabilityDefinition[]>;
  readonly getCapability: (
    capabilityId: string,
  ) => Effect.Effect<CapabilityDefinition, CapabilityNotFound>;
  readonly enableCapability: (
    capabilityId: string,
  ) => Effect.Effect<CapabilityDefinition, CapabilityNotFound | CapabilityRegistryIOError>;
  readonly disableCapability: (
    capabilityId: string,
  ) => Effect.Effect<CapabilityDefinition, CapabilityNotFound | CapabilityRegistryIOError>;
  readonly loadFromDirectory: (
    dir: string,
  ) => Effect.Effect<
    CapabilityPackage[],
    CapabilityRegistryIOError | CapabilityRegistryValidationError
  >;
  readonly saveToDirectory: (
    dir: string,
  ) => Effect.Effect<void, CapabilityRegistryIOError>;
}

export class CapabilityRegistry extends Context.Tag("CapabilityRegistry")<
  CapabilityRegistry,
  CapabilityRegistryService
>() {}
