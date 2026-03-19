import { Data } from "effect";

export class InvalidTokenError extends Data.TaggedError("InvalidTokenError")<{
  reason: string;
}> {}

export class PolicyNotFound extends Data.TaggedError("PolicyNotFound")<{
  policyId: string;
}> {}

export class PolicyEngineIOError extends Data.TaggedError("PolicyEngineIOError")<{
  path: string;
  cause: string;
}> {}
