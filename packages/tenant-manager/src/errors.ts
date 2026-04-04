import { Data } from "effect";

export class TenantNotFound extends Data.TaggedError("TenantNotFound")<{
  tenantId: string;
}> {}

export class EnvironmentNotFound extends Data.TaggedError("EnvironmentNotFound")<{
  environmentId: string;
}> {}

export class GatewayNotFound extends Data.TaggedError("GatewayNotFound")<{
  gatewayId: string;
}> {}

export class PolicyTemplateNotFound extends Data.TaggedError("PolicyTemplateNotFound")<{
  templateId: string;
}> {}

export class TenantManagerIOError extends Data.TaggedError("TenantManagerIOError")<{
  path: string;
  cause: string;
}> {}

export type TenantManagerError =
  | TenantNotFound
  | EnvironmentNotFound
  | GatewayNotFound
  | PolicyTemplateNotFound
  | TenantManagerIOError;
