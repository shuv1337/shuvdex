import { Schema } from "effect";

export const CapabilityKind = Schema.Literal(
  "tool",
  "resource",
  "prompt",
  "module",
  "connector",
);
export type CapabilityKind = typeof CapabilityKind.Type;

export const CapabilityVisibility = Schema.Literal("public", "scoped", "private");
export type CapabilityVisibility = typeof CapabilityVisibility.Type;

export const CapabilityRiskLevel = Schema.Literal("low", "medium", "high");
export type CapabilityRiskLevel = typeof CapabilityRiskLevel.Type;

export const ExecutorType = Schema.Literal(
  "builtin",
  "mcp_proxy",
  "http_api",
  "module_runtime",
);
export type ExecutorType = typeof ExecutorType.Type;

export const JsonSchema = Schema.Unknown;
export type JsonSchema = typeof JsonSchema.Type;

export const AnnotationValue = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.Unknown),
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);
export type AnnotationValue = typeof AnnotationValue.Type;

export const AnnotationMap = Schema.Record({
  key: Schema.String,
  value: AnnotationValue,
});
export type AnnotationMap = typeof AnnotationMap.Type;

export const HttpParameterBinding = Schema.Struct({
  name: Schema.String,
  in: Schema.Literal("path", "query", "header", "cookie"),
  required: Schema.optional(Schema.Boolean),
  style: Schema.optional(Schema.String),
  explode: Schema.optional(Schema.Boolean),
  allowReserved: Schema.optional(Schema.Boolean),
  schema: Schema.optional(JsonSchema),
});
export type HttpParameterBinding = typeof HttpParameterBinding.Type;

export const HttpRequestBodyBinding = Schema.Struct({
  required: Schema.optional(Schema.Boolean),
  contentType: Schema.String,
  schema: Schema.optional(JsonSchema),
});
export type HttpRequestBodyBinding = typeof HttpRequestBodyBinding.Type;

export const HttpSecurityRequirement = Schema.Struct({
  schemeId: Schema.String,
  scopes: Schema.optional(Schema.Array(Schema.String)),
});
export type HttpSecurityRequirement = typeof HttpSecurityRequirement.Type;

export const HttpBinding = Schema.Struct({
  method: Schema.Literal("get", "post", "put", "patch", "delete", "head", "options"),
  baseUrl: Schema.String,
  pathTemplate: Schema.String,
  parameters: Schema.optional(Schema.Array(HttpParameterBinding)),
  requestBody: Schema.optional(HttpRequestBodyBinding),
  responseSchema: Schema.optional(JsonSchema),
  securityRequirements: Schema.optional(Schema.Array(HttpSecurityRequirement)),
});
export type HttpBinding = typeof HttpBinding.Type;

export const ExecutionBinding = Schema.Struct({
  executorType: ExecutorType,
  target: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  retryCount: Schema.optional(Schema.Number),
  streaming: Schema.optional(Schema.Boolean),
  credentialId: Schema.optional(Schema.String),
  httpBinding: Schema.optional(HttpBinding),
});
export type ExecutionBinding = typeof ExecutionBinding.Type;

export const CapabilityDependency = Schema.Struct({
  capabilityId: Schema.String,
  optional: Schema.optional(Schema.Boolean),
});
export type CapabilityDependency = typeof CapabilityDependency.Type;

export const ToolCapabilityConfig = Schema.Struct({
  inputSchema: Schema.optional(JsonSchema),
  outputSchema: Schema.optional(JsonSchema),
  sideEffectLevel: Schema.optional(
    Schema.Literal("read", "write", "admin", "external"),
  ),
  timeoutMs: Schema.optional(Schema.Number),
  streaming: Schema.optional(Schema.Boolean),
});
export type ToolCapabilityConfig = typeof ToolCapabilityConfig.Type;

export const ResourceCapabilityConfig = Schema.Struct({
  uri: Schema.String,
  mimeType: Schema.optional(Schema.String),
  templateParams: Schema.optional(Schema.Array(Schema.String)),
  cacheTtlMs: Schema.optional(Schema.Number),
  summary: Schema.optional(Schema.String),
  contents: Schema.optional(Schema.String),
});
export type ResourceCapabilityConfig = typeof ResourceCapabilityConfig.Type;

export const PromptArgument = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.optional(Schema.String),
  required: Schema.optional(Schema.Boolean),
});
export type PromptArgument = typeof PromptArgument.Type;

export const PromptMessage = Schema.Struct({
  role: Schema.Literal("user", "assistant"),
  content: Schema.NonEmptyString,
});
export type PromptMessage = typeof PromptMessage.Type;

export const PromptCapabilityConfig = Schema.Struct({
  arguments: Schema.optional(Schema.Array(PromptArgument)),
  attachedResourceIds: Schema.optional(Schema.Array(Schema.String)),
  toolAllowlist: Schema.optional(Schema.Array(Schema.String)),
  preferredDisclosure: Schema.optional(
    Schema.Array(Schema.Literal("summary", "resource", "prompt", "tool")),
  ),
  messages: Schema.optional(Schema.Array(PromptMessage)),
});
export type PromptCapabilityConfig = typeof PromptCapabilityConfig.Type;

export const ModuleCapabilityConfig = Schema.Struct({
  operations: Schema.Array(Schema.String),
  guard: Schema.optional(Schema.String),
});
export type ModuleCapabilityConfig = typeof ModuleCapabilityConfig.Type;

export const ConnectorCapabilityConfig = Schema.Struct({
  sourceType: Schema.Literal("mcp", "rest"),
  endpoint: Schema.optional(Schema.String),
  toolIds: Schema.optional(Schema.Array(Schema.String)),
});
export type ConnectorCapabilityConfig = typeof ConnectorCapabilityConfig.Type;

export const Provenance = Schema.Struct({
  sourceFile: Schema.optional(Schema.String),
  sourceSection: Schema.optional(Schema.String),
  generatedFrom: Schema.optional(Schema.String),
  derivedBy: Schema.optional(Schema.Literal("compiler", "openapi", "import", "manual")),
});
export type Provenance = typeof Provenance.Type;

export const CertificationStatus = Schema.Struct({
  status: Schema.Literal("untested", "passing", "failing", "stale"),
  lastTestedAt: Schema.optional(Schema.String),
  testedHosts: Schema.optional(Schema.Array(Schema.String)),
  notes: Schema.optional(Schema.String),
});
export type CertificationStatus = typeof CertificationStatus.Type;

export const CapabilityDefinition = Schema.Struct({
  id: Schema.NonEmptyString,
  packageId: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  kind: CapabilityKind,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  tags: Schema.optional(Schema.Array(Schema.String)),
  riskLevel: Schema.optional(CapabilityRiskLevel),
  subjectScopes: Schema.optional(Schema.Array(Schema.String)),
  hostTags: Schema.optional(Schema.Array(Schema.String)),
  clientTags: Schema.optional(Schema.Array(Schema.String)),
  executorRef: Schema.optional(ExecutionBinding),
  sourceRef: Schema.optional(Schema.String),
  dependsOn: Schema.optional(Schema.Array(CapabilityDependency)),
  annotations: Schema.optional(AnnotationMap),
  provenance: Schema.optional(Provenance),
  certification: Schema.optional(CertificationStatus),
  enabled: Schema.Boolean,
  visibility: CapabilityVisibility,
  tool: Schema.optional(ToolCapabilityConfig),
  resource: Schema.optional(ResourceCapabilityConfig),
  prompt: Schema.optional(PromptCapabilityConfig),
  module: Schema.optional(ModuleCapabilityConfig),
  connector: Schema.optional(ConnectorCapabilityConfig),
});
export type CapabilityDefinition = typeof CapabilityDefinition.Type;

export const PackageSource = Schema.Struct({
  type: Schema.Literal(
    "builtin",
    "skill",
    "manifest",
    "connector",
    "generated",
    "imported_archive",
    "openapi",
  ),
  path: Schema.optional(Schema.String),
  skillName: Schema.optional(Schema.String),
  archiveName: Schema.optional(Schema.String),
  importedAt: Schema.optional(Schema.String),
  checksum: Schema.optional(Schema.String),
  importMode: Schema.optional(Schema.String),
  sourceId: Schema.optional(Schema.String),
  specUrl: Schema.optional(Schema.String),
  selectedServerUrl: Schema.optional(Schema.String),
  specChecksum: Schema.optional(Schema.String),
  credentialId: Schema.optional(Schema.String),
  lastSyncedAt: Schema.optional(Schema.String),
  operationCount: Schema.optional(Schema.Number),
});
export type PackageSource = typeof PackageSource.Type;

export const PackageLink = Schema.Struct({
  packageId: Schema.NonEmptyString,
  relation: Schema.Literal("composes_with", "depends_on", "documents", "augments"),
  reason: Schema.optional(Schema.String),
  capabilityIds: Schema.optional(Schema.Array(Schema.String)),
});
export type PackageLink = typeof PackageLink.Type;

export const CapabilityPackage = Schema.Struct({
  id: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  builtIn: Schema.Boolean,
  enabled: Schema.Boolean,
  tags: Schema.optional(Schema.Array(Schema.String)),
  source: Schema.optional(PackageSource),
  sourceRef: Schema.optional(Schema.String),
  annotations: Schema.optional(AnnotationMap),
  linkedPackages: Schema.optional(Schema.Array(PackageLink)),
  capabilities: Schema.Array(CapabilityDefinition),
  assets: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});
export type CapabilityPackage = typeof CapabilityPackage.Type;
