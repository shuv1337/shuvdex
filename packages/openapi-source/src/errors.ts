import { Data } from "effect";

export class OpenApiSourceNotFound extends Data.TaggedError("OpenApiSourceNotFound")<{ sourceId: string }> {}
export class OpenApiSourceIOError extends Data.TaggedError("OpenApiSourceIOError")<{ path: string; cause: string }> {}
export class OpenApiSourceValidationError extends Data.TaggedError("OpenApiSourceValidationError")<{ sourceId?: string; issues: string }> {}
export class OpenApiSourceFetchError extends Data.TaggedError("OpenApiSourceFetchError")<{ sourceId?: string; sourceUrl: string; cause: string }> {}

export type OpenApiSourceError = OpenApiSourceNotFound | OpenApiSourceIOError | OpenApiSourceValidationError | OpenApiSourceFetchError;
