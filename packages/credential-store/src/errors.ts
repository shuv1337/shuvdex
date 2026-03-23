import { Data } from "effect";

export class CredentialNotFound extends Data.TaggedError("CredentialNotFound")<{
  credentialId: string;
}> {}

export class CredentialStoreIOError extends Data.TaggedError("CredentialStoreIOError")<{
  path: string;
  cause: string;
}> {}

export class CredentialStoreValidationError extends Data.TaggedError("CredentialStoreValidationError")<{
  credentialId?: string;
  issues: string;
}> {}

export type CredentialStoreError = CredentialNotFound | CredentialStoreIOError | CredentialStoreValidationError;
