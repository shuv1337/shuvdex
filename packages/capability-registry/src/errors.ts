import { Data } from "effect";

export class CapabilityPackageNotFound extends Data.TaggedError("CapabilityPackageNotFound")<{
  packageId: string;
}> {}

export class CapabilityAlreadyExists extends Data.TaggedError("CapabilityAlreadyExists")<{
  capabilityId: string;
}> {}

export class CapabilityNotFound extends Data.TaggedError("CapabilityNotFound")<{
  capabilityId: string;
}> {}

export class CapabilityPackageAlreadyExists extends Data.TaggedError("CapabilityPackageAlreadyExists")<{
  packageId: string;
}> {}

export class CannotRemoveBuiltInPackage extends Data.TaggedError("CannotRemoveBuiltInPackage")<{
  packageId: string;
}> {}

export class CapabilityRegistryValidationError extends Data.TaggedError("CapabilityRegistryValidationError")<{
  name?: string;
  issues: string;
}> {}

export class CapabilityRegistryIOError extends Data.TaggedError("CapabilityRegistryIOError")<{
  path: string;
  cause: string;
}> {}

export type CapabilityRegistryError =
  | CapabilityPackageNotFound
  | CapabilityAlreadyExists
  | CapabilityNotFound
  | CapabilityPackageAlreadyExists
  | CannotRemoveBuiltInPackage
  | CapabilityRegistryValidationError
  | CapabilityRegistryIOError;
