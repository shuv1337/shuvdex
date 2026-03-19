import { Data } from "effect";

export class ArchiveValidationError extends Data.TaggedError("ArchiveValidationError")<{
  message: string;
}> {}

export class ImportConflictError extends Data.TaggedError("ImportConflictError")<{
  packageId: string;
  reason: string;
}> {}

export type SkillImporterError = ArchiveValidationError | ImportConflictError;
