/**
 * @module server
 *
 * MCP server factory that turns CapabilityPackages into MCP primitives.
 *
 * ## Registration flow
 * CapabilityPackages (compiled from skills, OpenAPI specs, or upstream MCP servers)
 * are flattened into individual capabilities, then each enabled, non-private capability
 * is registered as an MCP tool, resource, or prompt based on its `kind`.
 *
 * ## Policy integration
 * Every MCP operation (tool call, resource read, prompt get) passes through
 * `authorize()` before execution. Decisions and outcomes are recorded via
 * `auditRuntime()` for observability and compliance.
 *
 * ## Execution dispatch
 * Tool calls are dispatched through `executeTool()` →
 * `ExecutionProvidersService.executeTool()`, which routes to the correct executor
 * (module_runtime, http_api, or mcp_proxy) based on the capability's executorRef.
 *
 * ## Schema conversion
 * Capabilities define input schemas as JSON Schema (the portable format).
 * The MCP SDK requires Zod schemas for tool registration.
 * `jsonSchemaToZodShape()` bridges this gap at registration time.
 *
 * ## Source ref security
 * Resource capabilities may reference local files via `sourceRef`.
 * `allowedSourceRoots()` and `isSourceRefAllowed()` restrict file reads
 * to directories within registered capability package roots, preventing
 * path traversal outside skill/package boundaries.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type {
  CapabilityDefinitionType,
  CapabilityPackageType,
} from "@shuvdex/capability-registry";
import type {
  AuditEvent,
  PolicyEngineService,
  TokenClaims,
} from "@shuvdex/policy-engine";
import {
  generateCorrelationId,
} from "@shuvdex/policy-engine";
import type { RuntimeAuditInput } from "@shuvdex/policy-engine";
import type { ExecutionProvidersService } from "@shuvdex/execution-providers";

export interface ServerConfig {
  readonly capabilities?: ReadonlyArray<CapabilityPackageType>;
  readonly claims?: TokenClaims;
  readonly policy?: Pick<
    PolicyEngineService,
    "authorizeCapability" | "recordAuditEvent" | "defaultClaims" | "audit"
  >;
  readonly executors?: Pick<ExecutionProvidersService, "executeTool">;
}

function json(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true as const } : {}),
  };
}

function isTextLike(mimeType: string | undefined): boolean {
  return Boolean(
    mimeType?.startsWith("text/") ||
      mimeType === "application/json" ||
      mimeType === "image/svg+xml",
  );
}

function allowedSourceRoots(config: ServerConfig | undefined): string[] {
  const packageRoots = capabilityPackages(config)
    .map((pkg) => pkg.source?.path)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => path.resolve(value));

  return Array.from(new Set(packageRoots));
}

function isSourceRefAllowed(config: ServerConfig | undefined, sourceRef: string): boolean {
  const resolved = path.resolve(sourceRef);
  return allowedSourceRoots(config).some((root) => {
    const relative = path.relative(root, resolved);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}

/**
 * Resolve the payload for a resource capability using three strategies (in order):
 * 1. **Inline contents** — if `capability.resource.contents` is set, use it directly
 * 2. **sourceRef file** — read the file from disk (text or base64 blob), guarded by
 *    `isSourceRefAllowed()` to prevent path traversal
 * 3. **Summary fallback** — return the resource summary or capability description
 */
function resourcePayload(
  capability: CapabilityDefinitionType,
  config: ServerConfig | undefined,
) {
  if (capability.resource?.contents !== undefined) {
    return { text: capability.resource.contents };
  }
  if (capability.sourceRef && fs.existsSync(capability.sourceRef)) {
    if (!isSourceRefAllowed(config, capability.sourceRef)) {
      throw new Error(`Resource sourceRef is outside allowed package roots: ${capability.sourceRef}`);
    }
    if (isTextLike(capability.resource?.mimeType)) {
      return { text: fs.readFileSync(capability.sourceRef, "utf-8") };
    }
    return { blob: fs.readFileSync(capability.sourceRef).toString("base64") };
  }
  return { text: capability.resource?.summary ?? capability.description };
}

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) =>
    typeof args[key] === "string" ? String(args[key]) : "",
  );
}

/**
 * Convert a JSON Schema `properties` object into a Zod shape for MCP SDK registration.
 *
 * This bridge exists because capabilities define their input as JSON Schema
 * (portable, language-agnostic) but the MCP SDK's `registerTool()` requires
 * Zod schemas. Supports string, number/integer, boolean, and array types;
 * everything else falls back to `z.any()`.
 */
function jsonSchemaToZodShape(
  schema: Record<string, unknown> | undefined,
): Record<string, z.ZodTypeAny> {
  const properties =
    schema &&
    typeof schema === "object" &&
    "properties" in schema &&
    typeof schema.properties === "object" &&
    schema.properties !== null
      ? (schema.properties as Record<string, Record<string, unknown>>)
      : {};
  const required = Array.isArray(schema?.required) ? (schema.required as string[]) : [];

  const fieldFor = (definition: Record<string, unknown> | undefined): z.ZodTypeAny => {
    const type = definition?.type;
    if (type === "string") return z.string();
    if (type === "number" || type === "integer") return z.number();
    if (type === "boolean") return z.boolean();
    if (type === "array") {
      const itemType =
        definition?.items &&
        typeof definition.items === "object" &&
        definition.items !== null
          ? fieldFor(definition.items as Record<string, unknown>)
          : z.any();
      return z.array(itemType);
    }
    return z.any();
  };

  return Object.fromEntries(
    Object.entries(properties).map(([name, definition]) => {
      const field = fieldFor(definition);
      return [name, required.includes(name) ? field : field.optional()];
    }),
  );
}

async function authorize(
  config: ServerConfig | undefined,
  capability: CapabilityDefinitionType,
): Promise<{ allowed: boolean; reason: string }> {
  if (!config?.policy) {
    return { allowed: true, reason: "No policy engine configured" };
  }
  const claims = config.claims ?? config.policy.defaultClaims();
  const decision = await Effect.runPromise(
    config.policy.authorizeCapability(claims, capability),
  );
  return { allowed: decision.allowed, reason: decision.reason };
}

/**
 * Record a legacy-shape AuditEvent (kept for backward compat).  New call
 * sites should use auditRuntime() for richer structured records.
 */
async function audit(
  config: ServerConfig | undefined,
  event: Omit<AuditEvent, "id" | "timestamp">,
): Promise<void> {
  if (!config?.policy) return;
  await Effect.runPromise(
    config.policy.recordAuditEvent({
      id: `${Date.now()}-${event.action}-${event.capabilityId ?? "list"}`,
      timestamp: new Date().toISOString(),
      ...event,
    }),
  ).catch(() => undefined);
}

/**
 * Record a rich RuntimeAuditRecord through the AuditService.
 * Falls back silently when no policy engine is configured.
 */
async function auditRuntime(
  config: ServerConfig | undefined,
  input: RuntimeAuditInput,
): Promise<void> {
  if (!config?.policy?.audit) return;
  await Effect.runPromise(
    config.policy.audit.recordRuntimeEvent(input),
  ).catch(() => undefined);
}

async function executeTool(
  config: ServerConfig | undefined,
  capability: CapabilityDefinitionType,
  args: Record<string, unknown>,
) {
  if (!config?.executors) {
    return json(
      {
        error: "Tool execution is not configured",
        capabilityId: capability.id,
      },
      true,
    );
  }

  const result = await Effect.runPromise(
    config.executors.executeTool(capability, args),
  );
  return json(result.payload, result.isError === true);
}

function capabilityPackages(config?: ServerConfig): CapabilityPackageType[] {
  return config?.capabilities ? [...config.capabilities] : [];
}

/**
 * Create an MCP server instance from the given configuration.
 *
 * Iterates all capabilities from all packages and registers each enabled,
 * non-private capability as one of three MCP primitive types:
 *
 * - **Tools** — registered with a Zod schema (converted from JSON Schema),
 *   authorized and audited on each call, dispatched via executeTool()
 * - **Resources** — registered with URI and mime type, authorized on read,
 *   payload resolved via resourcePayload()
 * - **Prompts** — registered with argument schema, authorized on get,
 *   message templates interpolated with caller arguments
 *
 * Each handler follows the same pattern:
 * 1. Generate correlation ID
 * 2. Authorize via policy engine
 * 3. Execute / resolve payload
 * 4. Audit the outcome (success or failure)
 */
export function createServer(config?: ServerConfig): McpServer {
  const server = new McpServer(
    {
      name: "shuvdex",
      version: "0.0.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  const packages = capabilityPackages(config);
  const capabilities = packages.flatMap((pkg) => pkg.capabilities);

  for (const capability of capabilities) {
    if (!capability.enabled || capability.visibility === "private") {
      continue;
    }

    if (capability.kind === "tool" && capability.tool) {
      const schema =
        capability.tool.inputSchema &&
        typeof capability.tool.inputSchema === "object" &&
        capability.tool.inputSchema !== null
          ? jsonSchemaToZodShape(
              capability.tool.inputSchema as Record<string, unknown>,
            )
          : {};

      server.registerTool(
        capability.id,
        {
          title: capability.title,
          description: capability.description,
          inputSchema: schema,
        },
        async (args) => {
          const correlationId = generateCorrelationId();
          const startMs = Date.now();
          const subjectId = config?.claims?.subjectId ?? "local-stdio";

          const decision = await authorize(config, capability);
          if (!decision.allowed) {
            await auditRuntime(config, {
              actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
              action: "tool_call",
              actionClass: "external",
              target: { type: "tool", id: capability.id, name: capability.title },
              packageRef: { packageId: capability.packageId, capabilityId: capability.id },
              decision: "deny",
              decisionReason: decision.reason,
              correlationId,
              outcome: {
                status: "error",
                latencyMs: Date.now() - startMs,
                errorClass: "AuthorizationDenied",
                errorMessage: decision.reason,
              },
            });
            return json({ error: decision.reason }, true);
          }

          const result = await executeTool(config, capability, args ?? {});
          const latencyMs = Date.now() - startMs;

          await auditRuntime(config, {
            actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
            action: "tool_call",
            actionClass: "external",
            target: { type: "tool", id: capability.id, name: capability.title },
            packageRef: { packageId: capability.packageId, capabilityId: capability.id },
            decision: result.isError ? "deny" : "allow",
            decisionReason: result.isError ? "Execution returned error" : "Executed",
            correlationId,
            outcome: {
              status: result.isError ? "error" : "success",
              latencyMs,
              ...(result.isError ? { errorClass: "ExecutionError" } : {}),
            },
          });

          return result;
        },
      );
    }

    if (capability.kind === "resource" && capability.resource) {
      const resource = capability.resource;
      server.registerResource(
        capability.id,
        resource.uri,
        {
          title: capability.title,
          description: capability.description,
          mimeType: resource.mimeType,
        },
        async () => {
          const correlationId = generateCorrelationId();
          const startMs = Date.now();
          const subjectId = config?.claims?.subjectId ?? "local-stdio";

          const decision = await authorize(config, capability);
          if (!decision.allowed) {
            await auditRuntime(config, {
              actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
              action: "resource_read",
              actionClass: "read",
              target: { type: "resource", id: capability.id, name: capability.title },
              packageRef: { packageId: capability.packageId, capabilityId: capability.id },
              decision: "deny",
              decisionReason: decision.reason,
              correlationId,
              outcome: {
                status: "error",
                latencyMs: Date.now() - startMs,
                errorClass: "AuthorizationDenied",
                errorMessage: decision.reason,
              },
            });
            throw new Error(decision.reason);
          }

          let payload: ReturnType<typeof resourcePayload>;
          try {
            payload = resourcePayload(capability, config);
          } catch (err) {
            await auditRuntime(config, {
              actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
              action: "resource_read",
              actionClass: "read",
              target: { type: "resource", id: capability.id, name: capability.title },
              packageRef: { packageId: capability.packageId, capabilityId: capability.id },
              decision: "deny",
              decisionReason: "Resource payload error",
              correlationId,
              outcome: {
                status: "error",
                latencyMs: Date.now() - startMs,
                errorClass: "ResourcePayloadError",
                errorMessage: String(err),
              },
            });
            throw err;
          }

          await auditRuntime(config, {
            actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
            action: "resource_read",
            actionClass: "read",
            target: { type: "resource", id: capability.id, name: capability.title },
            packageRef: { packageId: capability.packageId, capabilityId: capability.id },
            decision: "allow",
            decisionReason: "Resource read",
            correlationId,
            outcome: { status: "success", latencyMs: Date.now() - startMs },
          });
          return {
            contents: [
              {
                uri: resource.uri,
                mimeType: resource.mimeType,
                ...payload,
              },
            ],
          };
        },
      );
    }

    if (capability.kind === "prompt" && capability.prompt) {
      const prompt = capability.prompt;
      const argsSchema = Object.fromEntries(
        (prompt.arguments ?? []).map((argument) => [
          argument.name,
          argument.required ? z.string() : z.string().optional(),
        ]),
      );
      server.registerPrompt(
        capability.id,
        {
          title: capability.title,
          description: capability.description,
          argsSchema,
        },
        async (args) => {
          const correlationId = generateCorrelationId();
          const startMs = Date.now();
          const subjectId = config?.claims?.subjectId ?? "local-stdio";

          const decision = await authorize(config, capability);
          if (!decision.allowed) {
            await auditRuntime(config, {
              actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
              action: "prompt_get",
              actionClass: "read",
              target: { type: "prompt", id: capability.id, name: capability.title },
              packageRef: { packageId: capability.packageId, capabilityId: capability.id },
              decision: "deny",
              decisionReason: decision.reason,
              correlationId,
              outcome: {
                status: "error",
                latencyMs: Date.now() - startMs,
                errorClass: "AuthorizationDenied",
                errorMessage: decision.reason,
              },
            });
            throw new Error(decision.reason);
          }
          await auditRuntime(config, {
            actor: { subjectId, subjectType: config?.claims?.subjectType ?? "service" },
            action: "prompt_get",
            actionClass: "read",
            target: { type: "prompt", id: capability.id, name: capability.title },
            packageRef: { packageId: capability.packageId, capabilityId: capability.id },
            decision: "allow",
            decisionReason: "Prompt served",
            correlationId,
            outcome: { status: "success", latencyMs: Date.now() - startMs },
          });
          return {
            messages: (prompt.messages ?? []).map((message) => ({
              role: message.role,
              content: {
                type: "text" as const,
                text: interpolate(message.content, args ?? {}),
              },
            })),
          };
        },
      );
    }
  }

  return server;
}
