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
  "host_runner",
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

export const ExecutionBinding = Schema.Struct({
  executorType: ExecutorType,
  target: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  retryCount: Schema.optional(Schema.Number),
  streaming: Schema.optional(Schema.Boolean),
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
  ),
  path: Schema.optional(Schema.String),
  skillName: Schema.optional(Schema.String),
  archiveName: Schema.optional(Schema.String),
  importedAt: Schema.optional(Schema.String),
  checksum: Schema.optional(Schema.String),
  importMode: Schema.optional(Schema.String),
});
export type PackageSource = typeof PackageSource.Type;

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
  capabilities: Schema.Array(CapabilityDefinition),
  assets: Schema.optional(Schema.Array(Schema.String)),
  dependencies: Schema.optional(Schema.Array(Schema.String)),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});
export type CapabilityPackage = typeof CapabilityPackage.Type;
